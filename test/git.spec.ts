import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyGitDiffSelection,
  commitAndSyncGitChanges,
  discardAllGitChanges,
  commitGitChanges,
  getGitBaseline,
  getGitFileDiff,
  getGitLineBlame,
  getGitRepositoryState,
  initializeGitRepository,
  pullGitChanges,
  pushGitChanges,
  stageGitPaths,
} from '../electron/main/git'

const tempRoots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempWorkspace() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'workspace-git-'))
  tempRoots.push(rootPath)
  return rootPath
}

function normalizePath(value: string) {
  return value.replace(/[\\/]+/g, '/')
}

async function runGit(cwd: string, args: string[]) {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  })

  return result.stdout.trim()
}

async function configureGitIdentity(cwd: string) {
  await runGit(cwd, ['config', 'user.name', 'Codex Test'])
  await runGit(cwd, ['config', 'user.email', 'codex@example.com'])
}

describe('git helpers', () => {
  it('detects non-repositories and initializes a repository in the workspace', async () => {
    const rootPath = await createTempWorkspace()

    await expect(getGitRepositoryState(rootPath)).resolves.toMatchObject({
      hasChanges: false,
      isRepository: false,
      repositoryRootPath: null,
    })

    const initializedState = await initializeGitRepository(rootPath)

    expect({
      ...initializedState,
      repositoryRootPath: normalizePath(initializedState.repositoryRootPath ?? ''),
      workspacePath: normalizePath(initializedState.workspacePath),
    }).toMatchObject({
      isRepository: true,
      repositoryRootPath: normalizePath(rootPath),
      workspacePath: normalizePath(rootPath),
    })
  })

  it('separates staged and unstaged file content for diff tabs', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await writeFile(filePath, '# Draft\n', 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await writeFile(filePath, '# Draft\n\nSecond line\n', 'utf8')

    const repositoryState = await getGitRepositoryState(rootPath)

    expect(repositoryState.stagedChanges).toHaveLength(1)
    expect(repositoryState.unstagedChanges).toHaveLength(1)
    expect(repositoryState.stagedChanges[0]).toMatchObject({
      kind: 'added',
      relativePath: 'draft.md',
      scope: 'staged',
    })
    expect(repositoryState.unstagedChanges[0]).toMatchObject({
      kind: 'modified',
      relativePath: 'draft.md',
      scope: 'unstaged',
    })

    await expect(getGitFileDiff(rootPath, filePath, 'staged')).resolves.toMatchObject({
      editorKind: 'rich-text',
      modifiedContent: '# Draft\n',
      modifiedExists: true,
      originalContent: '',
      originalExists: false,
    })

    await expect(getGitFileDiff(rootPath, filePath, 'unstaged')).resolves.toMatchObject({
      editorKind: 'rich-text',
      modifiedContent: '# Draft\n\nSecond line\n',
      modifiedExists: true,
      originalContent: '# Draft\n',
      originalExists: true,
    })
  })

  it('stages files with non-ascii names without quoted path corruption', async () => {
    const rootPath = await createTempWorkspace()
    const unicodeFileName = '\u4f60\u597d\u4e16\u754c.md'
    const filePath = path.join(rootPath, unicodeFileName)

    await initializeGitRepository(rootPath)
    await writeFile(filePath, '# Hello\n', 'utf8')

    const initialState = await getGitRepositoryState(rootPath)
    expect(initialState.unstagedChanges[0]).toMatchObject({
      relativePath: unicodeFileName,
      scope: 'unstaged',
    })

    await expect(stageGitPaths(rootPath, [filePath])).resolves.toMatchObject({
      stagedChanges: [
        expect.objectContaining({
          relativePath: unicodeFileName,
          scope: 'staged',
        }),
      ],
    })
  })

  it('parses modified paths with spaces and non-ascii characters without git quotes', async () => {
    const rootPath = await createTempWorkspace()
    const fileName = '新建 文本文档.html'
    const filePath = path.join(rootPath, fileName)

    await initializeGitRepository(rootPath)
    await writeFile(filePath, '<div>one</div>\n', 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial html')
    await writeFile(filePath, '<div>two</div>\n', 'utf8')

    const repositoryState = await getGitRepositoryState(rootPath)
    expect(repositoryState.unstagedChanges[0]).toMatchObject({
      kind: 'modified',
      path: filePath,
      relativePath: fileName,
      scope: 'unstaged',
    })

    await expect(getGitFileDiff(rootPath, filePath, 'unstaged')).resolves.toMatchObject({
      editorKind: 'code',
      modifiedContent: '<div>two</div>\n',
      modifiedExists: true,
      originalContent: '<div>one</div>\n',
      originalExists: true,
    })
  })

  it('returns commit blame for tracked lines and uncommitted blame for unsaved edits', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, 'alpha\nbeta\n', 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial commit')

    await expect(getGitLineBlame(rootPath, filePath, 1)).resolves.toMatchObject({
      kind: 'commit',
      author: 'Codex Test',
      summary: 'initial commit',
    })

    await expect(getGitLineBlame(rootPath, filePath, 1, 'alpha changed\nbeta\n')).resolves.toMatchObject({
      kind: 'uncommitted',
    })
  })

  it('returns a HEAD baseline payload for tracked files', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, 'alpha\nbeta\n', 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(filePath, 'alpha changed\nbeta\n', 'utf8')

    await expect(getGitBaseline(rootPath, filePath)).resolves.toMatchObject({
      available: true,
      baseText: 'alpha\nbeta\n',
      gitPath: 'draft.md',
      tracked: true,
    })
  })

  it('returns an empty baseline for tracked files that are not yet in HEAD', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await writeFile(filePath, 'alpha\nbeta\n', 'utf8')
    await stageGitPaths(rootPath, [filePath])

    await expect(getGitBaseline(rootPath, filePath)).resolves.toMatchObject({
      available: true,
      baseText: '',
      gitPath: 'draft.md',
      headOid: null,
      tracked: true,
    })
  })

  it('marks untracked files as unavailable for git gutter baseline rendering', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await writeFile(filePath, 'alpha\nbeta\n', 'utf8')

    await expect(getGitBaseline(rootPath, filePath)).resolves.toMatchObject({
      available: true,
      baseText: null,
      gitPath: 'draft.md',
      reason: 'untracked',
      tracked: false,
    })
  })

  it('stages only the selected unstaged diff block', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')
    const originalContent = 'alpha\nbeta\ngamma\ndelta\n'
    const modifiedContent = 'alpha updated\nbeta\ngamma updated\ndelta\n'
    const partiallyStagedContent = 'alpha updated\nbeta\ngamma\ndelta\n'

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, originalContent, 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(filePath, modifiedContent, 'utf8')

    await applyGitDiffSelection(rootPath, filePath, 'unstaged', {
      originalLineCount: 1,
      originalStartLine: 1,
      modifiedLineCount: 1,
      modifiedStartLine: 1,
    }, 'stage')

    await expect(getGitFileDiff(rootPath, filePath, 'staged')).resolves.toMatchObject({
      modifiedContent: partiallyStagedContent,
      originalContent,
    })
    await expect(getGitFileDiff(rootPath, filePath, 'unstaged')).resolves.toMatchObject({
      modifiedContent,
      originalContent: partiallyStagedContent,
    })
  })

  it('stages a top-of-file insertion block with git-style zero line starts', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')
    const originalContent = 'beta\ngamma\n'
    const modifiedContent = 'alpha\nbeta\ngamma\n'

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, originalContent, 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(filePath, modifiedContent, 'utf8')

    await applyGitDiffSelection(rootPath, filePath, 'unstaged', {
      originalLineCount: 0,
      originalStartLine: 0,
      modifiedLineCount: 1,
      modifiedStartLine: 1,
    }, 'stage')

    await expect(getGitFileDiff(rootPath, filePath, 'staged')).resolves.toMatchObject({
      modifiedContent,
      originalContent,
    })
    await expect(getGitRepositoryState(rootPath)).resolves.toMatchObject({
      unstagedChanges: [],
    })
  })

  it('stages an untracked block from an empty original document', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')
    const modifiedContent = 'alpha\nbeta\n'

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, modifiedContent, 'utf8')

    await applyGitDiffSelection(rootPath, filePath, 'unstaged', {
      originalLineCount: 0,
      originalStartLine: 0,
      modifiedLineCount: 2,
      modifiedStartLine: 1,
    }, 'stage')

    await expect(getGitFileDiff(rootPath, filePath, 'staged')).resolves.toMatchObject({
      modifiedContent,
      originalContent: '',
      originalExists: false,
    })
  })

  it('discards an untracked block by removing the new file', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')
    const modifiedContent = 'alpha\nbeta\n'

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, modifiedContent, 'utf8')

    await applyGitDiffSelection(rootPath, filePath, 'unstaged', {
      originalLineCount: 0,
      originalStartLine: 0,
      modifiedLineCount: 2,
      modifiedStartLine: 1,
    }, 'discard')

    await expect(readFile(filePath, 'utf8')).rejects.toThrow()
    await expect(getGitRepositoryState(rootPath)).resolves.toMatchObject({
      unstagedChanges: [],
    })
  })

  it('discards only the selected unstaged diff block', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')
    const originalContent = 'alpha\nbeta\ngamma\ndelta\n'
    const modifiedContent = 'alpha updated\nbeta\ngamma updated\ndelta\n'
    const partiallyDiscardedContent = 'alpha\nbeta\ngamma updated\ndelta\n'

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, originalContent, 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(filePath, modifiedContent, 'utf8')

    await applyGitDiffSelection(rootPath, filePath, 'unstaged', {
      originalLineCount: 1,
      originalStartLine: 1,
      modifiedLineCount: 1,
      modifiedStartLine: 1,
    }, 'discard')

    await expect(readFile(filePath, 'utf8')).resolves.toBe(partiallyDiscardedContent)
    await expect(getGitFileDiff(rootPath, filePath, 'unstaged')).resolves.toMatchObject({
      modifiedContent: partiallyDiscardedContent,
      originalContent,
    })
  })

  it('unstages only the selected staged diff block', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')
    const originalContent = 'alpha\nbeta\ngamma\ndelta\n'
    const modifiedContent = 'alpha updated\nbeta\ngamma updated\ndelta\n'
    const partiallyStagedContent = 'alpha\nbeta\ngamma updated\ndelta\n'

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, originalContent, 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(filePath, modifiedContent, 'utf8')
    await stageGitPaths(rootPath, [filePath])

    await applyGitDiffSelection(rootPath, filePath, 'staged', {
      originalLineCount: 1,
      originalStartLine: 1,
      modifiedLineCount: 1,
      modifiedStartLine: 1,
    }, 'unstage')

    await expect(getGitFileDiff(rootPath, filePath, 'staged')).resolves.toMatchObject({
      modifiedContent: partiallyStagedContent,
      originalContent,
    })
    await expect(getGitFileDiff(rootPath, filePath, 'unstaged')).resolves.toMatchObject({
      modifiedContent,
      originalContent: partiallyStagedContent,
    })
  })

  it('commits all working tree changes when nothing is staged', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await writeFile(filePath, '# Draft\n', 'utf8')
    const pendingState = await getGitRepositoryState(rootPath)

    expect(pendingState.stagedChanges).toHaveLength(0)
    expect(pendingState.unstagedChanges).toHaveLength(1)
    expect(pendingState.unstagedChanges[0]).toMatchObject({
      kind: 'untracked',
      relativePath: 'draft.md',
      scope: 'unstaged',
    })

    const committedState = await commitGitChanges(rootPath, 'initial commit')

    expect(committedState.hasChanges).toBe(false)
    expect(committedState.hasCommits).toBe(true)
    expect(committedState.stagedChanges).toHaveLength(0)
    expect(committedState.unstagedChanges).toHaveLength(0)
  })

  it('discards all working tree changes including untracked files', async () => {
    const rootPath = await createTempWorkspace()
    const trackedFilePath = path.join(rootPath, 'draft.md')
    const untrackedFilePath = path.join(rootPath, 'notes.txt')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(trackedFilePath, '# Draft\n', 'utf8')
    await stageGitPaths(rootPath, [trackedFilePath])
    await commitGitChanges(rootPath, 'initial commit')

    await writeFile(trackedFilePath, '# Changed\n', 'utf8')
    await writeFile(untrackedFilePath, 'scratch\n', 'utf8')

    const discardedState = await discardAllGitChanges(rootPath)

    expect(discardedState.hasChanges).toBe(false)
    await expect(runGit(rootPath, ['status', '--short'])).resolves.toBe('')
  })

  it('tracks unpushed commits and recently pulled files from a remote', async () => {
    const remotePath = await createTempWorkspace()
    const localPath = await createTempWorkspace()
    const collaboratorPath = await createTempWorkspace()
    const filePath = path.join(localPath, 'draft.md')

    await runGit(process.cwd(), ['init', '--bare', remotePath])
    await initializeGitRepository(localPath)
    await configureGitIdentity(localPath)
    await writeFile(filePath, '# Initial\n', 'utf8')
    await stageGitPaths(localPath, [filePath])
    await commitGitChanges(localPath, 'initial commit')
    await runGit(localPath, ['remote', 'add', 'origin', remotePath])
    await runGit(localPath, ['push', '-u', 'origin', 'master'])

    await writeFile(filePath, '# Local change\n', 'utf8')
    await stageGitPaths(localPath, [filePath])
    await commitGitChanges(localPath, 'local change')

    const aheadState = await getGitRepositoryState(localPath)
    expect(aheadState.unpushedCommits).toBe(1)

    const pushedState = await pushGitChanges(localPath)
    expect(pushedState.unpushedCommits).toBe(0)

    await runGit(process.cwd(), ['clone', remotePath, collaboratorPath])
    await configureGitIdentity(collaboratorPath)
    await writeFile(path.join(collaboratorPath, 'remote.md'), '# Remote file\n', 'utf8')
    await runGit(collaboratorPath, ['add', '--', '.'])
    await runGit(collaboratorPath, ['commit', '-m', 'remote change'])
    await runGit(collaboratorPath, ['push', 'origin', 'master'])

    const pulledState = await pullGitChanges(localPath)
    expect(pulledState.recentlyPulledChanges).toEqual([
      expect.objectContaining({
        kind: 'added',
        relativePath: 'remote.md',
      }),
    ])
  })

  it('commit-and-sync auto-sets upstream for a single remote branch', async () => {
    const remotePath = await createTempWorkspace()
    const localPath = await createTempWorkspace()
    const filePath = path.join(localPath, 'draft.md')

    await runGit(process.cwd(), ['init', '--bare', remotePath])
    await initializeGitRepository(localPath)
    await configureGitIdentity(localPath)
    await runGit(localPath, ['remote', 'add', 'origin', remotePath])

    await writeFile(filePath, '# Initial\n', 'utf8')

    const syncedState = await commitAndSyncGitChanges(localPath, 'initial sync commit')

    expect(syncedState.unpushedCommits).toBe(0)
    await expect(runGit(localPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])).resolves.toBe('origin/master')
    await expect(runGit(remotePath, ['show-ref', '--verify', 'refs/heads/master'])).resolves.toContain('refs/heads/master')
  })
})

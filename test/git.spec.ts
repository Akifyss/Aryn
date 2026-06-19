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
  getGitCommitDetails,
  getGitCommitFileDiff,
  getGitCommitHistory,
  getGitFileDiff,
  getGitLineBlame,
  getGitRepositoryState,
  initializeGitRepository,
  pullGitChanges,
  pushGitChanges,
  revertGitCommit,
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

function normalizeLineEndings(content: string) {
  return content.replace(/\r\n/g, '\n')
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
      editorKind: 'prose',
      modifiedContent: '# Draft\n',
      modifiedExists: true,
      originalContent: '',
      originalExists: false,
    })

    await expect(getGitFileDiff(rootPath, filePath, 'unstaged')).resolves.toMatchObject({
      editorKind: 'prose',
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
      indexText: 'alpha\nbeta\n',
      tracked: true,
    })
  })

  it('returns the index text separately for staged rich editor gutter comparisons', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(filePath, 'alpha\nbeta\n', 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(filePath, 'alpha staged\nbeta\n', 'utf8')
    await stageGitPaths(rootPath, [filePath])
    await writeFile(filePath, 'alpha staged\nbeta unstaged\n', 'utf8')

    await expect(getGitBaseline(rootPath, filePath)).resolves.toMatchObject({
      available: true,
      baseText: 'alpha\nbeta\n',
      gitPath: 'draft.md',
      indexText: 'alpha staged\nbeta\n',
      tracked: true,
    })
  })

  it('lists commit history and returns read-only file diffs for a selected commit', async () => {
    const rootPath = await createTempWorkspace()
    const draftPath = path.join(rootPath, 'draft.md')
    const notesPath = path.join(rootPath, 'notes.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(draftPath, 'alpha\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(draftPath, 'alpha changed\n', 'utf8')
    await writeFile(notesPath, 'new note\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath, notesPath])
    await commitGitChanges(rootPath, 'update docs')

    const history = await getGitCommitHistory(rootPath)

    expect(history.commits).toHaveLength(2)
    expect(history.commits[0]).toMatchObject({
      authorName: 'Codex Test',
      subject: 'update docs',
    })
    await expect(getGitCommitHistory(rootPath, Number.NaN)).resolves.toMatchObject({
      commits: expect.arrayContaining([
        expect.objectContaining({ subject: 'update docs' }),
      ]),
    })

    const details = await getGitCommitDetails(rootPath, history.commits[0].hash)

    expect(details).toMatchObject({
      hash: history.commits[0].hash,
      subject: 'update docs',
      changes: expect.arrayContaining([
        expect.objectContaining({
          kind: 'modified',
          relativePath: 'draft.md',
        }),
        expect.objectContaining({
          kind: 'added',
          relativePath: 'notes.md',
        }),
      ]),
    })

    await expect(getGitCommitFileDiff(rootPath, history.commits[0].hash, draftPath)).resolves.toMatchObject({
      change: expect.objectContaining({
        kind: 'modified',
        relativePath: 'draft.md',
        scope: 'staged',
      }),
      modifiedContent: 'alpha changed\n',
      modifiedExists: true,
      originalContent: 'alpha\n',
      originalExists: true,
      source: expect.objectContaining({
        commit: expect.objectContaining({
          hash: history.commits[0].hash,
          subject: 'update docs',
        }),
        kind: 'commit',
      }),
    })

    await expect(getGitCommitFileDiff(rootPath, history.commits[0].hash, notesPath)).resolves.toMatchObject({
      change: expect.objectContaining({
        kind: 'added',
        relativePath: 'notes.md',
      }),
      modifiedContent: 'new note\n',
      modifiedExists: true,
      originalContent: '',
      originalExists: false,
      source: expect.objectContaining({
        kind: 'commit',
      }),
    })
  })

  it('returns commit file diffs for renamed and deleted files', async () => {
    const rootPath = await createTempWorkspace()
    const originalPath = path.join(rootPath, 'original.md')
    const renamedPath = path.join(rootPath, 'renamed.md')
    const deletedPath = path.join(rootPath, 'deleted.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(originalPath, 'rename me\n', 'utf8')
    await writeFile(deletedPath, 'remove me\n', 'utf8')
    await stageGitPaths(rootPath, [originalPath, deletedPath])
    await commitGitChanges(rootPath, 'initial files')
    await runGit(rootPath, ['mv', 'original.md', 'renamed.md'])
    await runGit(rootPath, ['rm', 'deleted.md'])
    await commitGitChanges(rootPath, 'rename and delete files')

    const [targetCommit] = (await getGitCommitHistory(rootPath)).commits
    const details = await getGitCommitDetails(rootPath, targetCommit.hash)

    expect(details.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'deleted',
        relativePath: 'deleted.md',
      }),
      expect.objectContaining({
        kind: 'renamed',
        relativePath: 'renamed.md',
      }),
    ]))

    await expect(getGitCommitFileDiff(rootPath, targetCommit.hash, renamedPath)).resolves.toMatchObject({
      change: expect.objectContaining({
        kind: 'renamed',
        originalPath,
        path: renamedPath,
        relativePath: 'renamed.md',
      }),
      modifiedContent: 'rename me\n',
      modifiedExists: true,
      originalContent: 'rename me\n',
      originalExists: true,
      source: expect.objectContaining({
        kind: 'commit',
      }),
    })

    await expect(getGitCommitFileDiff(rootPath, targetCommit.hash, deletedPath)).resolves.toMatchObject({
      change: expect.objectContaining({
        kind: 'deleted',
        relativePath: 'deleted.md',
      }),
      modifiedContent: '',
      modifiedExists: false,
      originalContent: 'remove me\n',
      originalExists: true,
      source: expect.objectContaining({
        kind: 'commit',
      }),
    })
  })

  it('reverts a commit by creating a new commit without rewriting history', async () => {
    const rootPath = await createTempWorkspace()
    const draftPath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(draftPath, 'alpha\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(draftPath, 'beta\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'update draft')

    const historyBeforeRevert = await getGitCommitHistory(rootPath)
    const revertedCommit = historyBeforeRevert.commits[0]
    const nextState = await revertGitCommit(rootPath, revertedCommit.hash)
    const historyAfterRevert = await getGitCommitHistory(rootPath)

    expect(nextState.hasChanges).toBe(false)
    expect(normalizeLineEndings(await readFile(draftPath, 'utf8'))).toBe('alpha\n')
    expect(historyAfterRevert.commits).toHaveLength(3)
    expect(historyAfterRevert.commits[0].subject).toBe('Revert "update draft"')
    expect(historyAfterRevert.commits[1].hash).toBe(revertedCommit.hash)
  })

  it('refuses to revert while the working tree has uncommitted changes', async () => {
    const rootPath = await createTempWorkspace()
    const draftPath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(draftPath, 'alpha\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(draftPath, 'beta\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'update draft')

    const [targetCommit] = (await getGitCommitHistory(rootPath)).commits
    const headBeforeRevert = await runGit(rootPath, ['rev-parse', 'HEAD'])
    await writeFile(draftPath, 'local change\n', 'utf8')

    await expect(revertGitCommit(rootPath, targetCommit.hash)).rejects.toThrow(
      'Commit or discard the current working tree changes before reverting a commit.',
    )
    await expect(runGit(rootPath, ['rev-parse', 'HEAD'])).resolves.toBe(headBeforeRevert)
    await expect(readFile(draftPath, 'utf8')).resolves.toBe('local change\n')
  })

  it('aborts a conflicted revert and restores the repository state', async () => {
    const rootPath = await createTempWorkspace()
    const draftPath = path.join(rootPath, 'draft.md')

    await initializeGitRepository(rootPath)
    await configureGitIdentity(rootPath)
    await writeFile(draftPath, 'alpha\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'initial commit')
    await writeFile(draftPath, 'beta\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'target change')
    const targetCommit = (await getGitCommitHistory(rootPath)).commits[0]
    await writeFile(draftPath, 'gamma\n', 'utf8')
    await stageGitPaths(rootPath, [draftPath])
    await commitGitChanges(rootPath, 'later change')
    const headBeforeRevert = await runGit(rootPath, ['rev-parse', 'HEAD'])

    await expect(revertGitCommit(rootPath, targetCommit.hash)).rejects.toThrow()
    await expect(runGit(rootPath, ['rev-parse', 'HEAD'])).resolves.toBe(headBeforeRevert)
    await expect(runGit(rootPath, ['status', '--short'])).resolves.toBe('')
    expect(normalizeLineEndings(await readFile(draftPath, 'utf8'))).toBe('gamma\n')
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

    const fileContent = await readFile(filePath, 'utf8')
    expect(normalizeLineEndings(fileContent)).toBe(partiallyDiscardedContent)

    const diff = await getGitFileDiff(rootPath, filePath, 'unstaged')
    expect(diff).toMatchObject({ originalContent })
    expect(normalizeLineEndings(diff.modifiedContent)).toBe(partiallyDiscardedContent)
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

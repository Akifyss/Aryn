import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  commitGitChanges,
  getGitFileDiff,
  getGitRepositoryState,
  initializeGitRepository,
  stageGitPaths,
} from '../electron/main/git'

const tempRoots: string[] = []

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
      modifiedContent: '# Draft\n',
      modifiedExists: true,
      originalContent: '',
      originalExists: false,
    })

    await expect(getGitFileDiff(rootPath, filePath, 'unstaged')).resolves.toMatchObject({
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
})

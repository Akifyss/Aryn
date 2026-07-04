import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorkspaceFile,
  getGitMetadataWatchPaths,
  loadWorkspaceDirectory,
  loadWorkspaceTree,
  moveWorkspaceEntry,
  resolveWorkspaceEditorKind,
  saveWorkspaceImage,
  shouldIgnoreWorkspacePath,
  workspaceFileExists,
} from '../electron/main/workspace'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempWorkspace() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'workspace-'))
  tempRoots.push(rootPath)
  return rootPath
}

describe('workspace helpers', () => {
  it('shows all workspace files while still ignoring internal folders', async () => {
    const rootPath = await createTempWorkspace()
    const assetsPath = path.join(rootPath, 'assets')
    const docsPath = path.join(rootPath, 'docs')

    await mkdir(assetsPath, { recursive: true })
    await mkdir(docsPath, { recursive: true })
    await mkdir(path.join(rootPath, '.tmp-icon-theme-cache', 'icons'), { recursive: true })
    await writeFile(path.join(rootPath, 'draft.md'), '# Draft', 'utf8')
    await writeFile(path.join(docsPath, 'notes.txt'), 'notes', 'utf8')
    await writeFile(path.join(rootPath, 'image.png'), 'png', 'utf8')
    await writeFile(path.join(rootPath, '.tmp-icon-theme-cache', 'icons', 'ghost.svg'), 'ignore me', 'utf8')
    await mkdir(path.join(rootPath, '.pi', 'sessions'), { recursive: true })
    await writeFile(path.join(rootPath, '.pi', 'sessions', 'current.jsonl'), 'ignore me', 'utf8')
    await mkdir(path.join(rootPath, 'node_modules', 'ignored-lib'), { recursive: true })
    await writeFile(path.join(rootPath, 'node_modules', 'ignored-lib', 'readme.md'), 'ignore me', 'utf8')

    const tree = await loadWorkspaceTree(rootPath)

    expect(tree).toMatchObject([
      {
        children: [],
        hasChildren: false,
        kind: 'directory',
        name: 'assets',
        path: assetsPath,
      },
      {
        children: [
          {
            kind: 'file',
            name: 'notes.txt',
            path: path.join(docsPath, 'notes.txt'),
          },
        ],
        hasChildren: true,
        kind: 'directory',
        name: 'docs',
        path: docsPath,
      },
      {
        kind: 'file',
        name: 'draft.md',
        path: path.join(rootPath, 'draft.md'),
      },
      {
        kind: 'file',
        name: 'image.png',
        path: path.join(rootPath, 'image.png'),
      },
    ])
  })

  it('loads direct workspace directory children for lazy file system views', async () => {
    const rootPath = await createTempWorkspace()
    const docsPath = path.join(rootPath, 'docs')
    const emptyPath = path.join(rootPath, 'empty')

    await mkdir(path.join(docsPath, 'nested'), { recursive: true })
    await mkdir(emptyPath, { recursive: true })
    await mkdir(path.join(rootPath, 'node_modules', 'ignored-lib'), { recursive: true })
    await writeFile(path.join(docsPath, 'notes.txt'), 'notes', 'utf8')
    await writeFile(path.join(rootPath, 'README.md'), '# Readme', 'utf8')
    await writeFile(path.join(rootPath, 'node_modules', 'ignored-lib', 'readme.md'), 'ignore me', 'utf8')

    const rootChildren = await loadWorkspaceDirectory(rootPath)

    expect(rootChildren).toHaveLength(3)
    expect(rootChildren).toMatchObject([
      {
        hasChildren: true,
        kind: 'directory',
        name: 'docs',
        path: docsPath,
      },
      {
        hasChildren: false,
        kind: 'directory',
        name: 'empty',
        path: emptyPath,
      },
      {
        kind: 'file',
        name: 'README.md',
        path: path.join(rootPath, 'README.md'),
      },
    ])
    expect(rootChildren[0]?.children).toBeUndefined()

    await expect(loadWorkspaceDirectory(rootPath, 'docs')).resolves.toMatchObject([
      {
        hasChildren: false,
        kind: 'directory',
        name: 'nested',
        path: path.join(docsPath, 'nested'),
      },
      {
        kind: 'file',
        name: 'notes.txt',
        path: path.join(docsPath, 'notes.txt'),
      },
    ])
    await expect(loadWorkspaceDirectory(rootPath, '../outside')).rejects.toThrow(
      'File path must stay inside the current workspace.',
    )
    await expect(loadWorkspaceDirectory(rootPath, 'README.md')).rejects.toThrow(
      'The selected folder no longer exists.',
    )
  })

  it('creates and renames files while keeping them inside the workspace', async () => {
    const rootPath = await createTempWorkspace()

    const createdFilePath = await createWorkspaceFile(rootPath, 'entries/today.md')
    await writeFile(createdFilePath, 'hello', 'utf8')

    const renamedFilePath = await moveWorkspaceEntry(rootPath, createdFilePath, 'archive/today.txt')

    expect(renamedFilePath).toBe(path.join(rootPath, 'archive', 'today.txt'))
    await expect(readFile(renamedFilePath, 'utf8')).resolves.toBe('hello')
    await expect(moveWorkspaceEntry(rootPath, renamedFilePath, '../outside.md')).rejects.toThrow(
      'Path must stay inside the current workspace.',
    )
  })

  it('moves directories and preserves their descendants', async () => {
    const rootPath = await createTempWorkspace()
    const sourceDirectoryPath = path.join(rootPath, 'drafts')

    await mkdir(path.join(sourceDirectoryPath, 'nested'), { recursive: true })
    await writeFile(path.join(sourceDirectoryPath, 'nested', 'chapter.md'), 'chapter', 'utf8')

    const movedDirectoryPath = await moveWorkspaceEntry(rootPath, sourceDirectoryPath, 'archive/drafts')

    expect(movedDirectoryPath).toBe(path.join(rootPath, 'archive', 'drafts'))
    await expect(readFile(path.join(movedDirectoryPath, 'nested', 'chapter.md'), 'utf8')).resolves.toBe('chapter')
  })

  it('prevents moving a directory into itself or its descendants', async () => {
    const rootPath = await createTempWorkspace()
    const sourceDirectoryPath = path.join(rootPath, 'drafts')

    await mkdir(path.join(sourceDirectoryPath, 'nested'), { recursive: true })

    await expect(moveWorkspaceEntry(rootPath, sourceDirectoryPath, 'drafts/nested/drafts')).rejects.toThrow(
      'A folder cannot be moved into itself or one of its descendants.',
    )
  })

  it('ignores git internals for watcher paths across Windows and POSIX separators', () => {
    expect(shouldIgnoreWorkspacePath('C:\\workspace\\.git\\index.lock')).toBe(true)
    expect(shouldIgnoreWorkspacePath('/workspace/.git/index.lock')).toBe(true)
    expect(shouldIgnoreWorkspacePath('C:\\workspace\\.git\\objects\\ab\\cd')).toBe(true)
    expect(shouldIgnoreWorkspacePath('/workspace/docs/draft.md')).toBe(false)
  })

  it('resolves git metadata watch paths for a regular repository', async () => {
    const rootPath = await createTempWorkspace()
    const gitDirPath = path.join(rootPath, '.git')

    await mkdir(path.join(gitDirPath, 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(gitDirPath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')

    await expect(getGitMetadataWatchPaths(rootPath)).resolves.toEqual(expect.arrayContaining([
      path.join(gitDirPath, 'index'),
      path.join(gitDirPath, 'HEAD'),
      path.join(gitDirPath, 'config'),
      path.join(gitDirPath, 'info', 'exclude'),
      path.join(gitDirPath, 'refs'),
      path.join(gitDirPath, 'packed-refs'),
    ]))
  })

  it('does not treat a missing git directory as metadata that should be watched recursively', async () => {
    const rootPath = await createTempWorkspace()

    await expect(getGitMetadataWatchPaths(rootPath)).resolves.toEqual([])
  })

  it('resolves git metadata watch paths for linked worktrees and submodule git files', async () => {
    const rootPath = await createTempWorkspace()
    const gitDirPath = path.join(rootPath, '..', 'repo.git', 'worktrees', 'draft')
    const commonGitDirPath = path.join(rootPath, '..', 'repo.git')

    await mkdir(gitDirPath, { recursive: true })
    await mkdir(path.join(commonGitDirPath, 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(rootPath, '.git'), 'gitdir: ../repo.git/worktrees/draft\n', 'utf8')
    await writeFile(path.join(gitDirPath, 'commondir'), '../..\n', 'utf8')

    await expect(getGitMetadataWatchPaths(rootPath)).resolves.toEqual(expect.arrayContaining([
      path.join(gitDirPath, 'index'),
      path.join(gitDirPath, 'HEAD'),
      path.join(gitDirPath, 'config.worktree'),
      path.join(commonGitDirPath, 'config'),
      path.join(commonGitDirPath, 'info', 'exclude'),
      path.join(commonGitDirPath, 'refs'),
      path.join(commonGitDirPath, 'packed-refs'),
    ]))
  })

  it('falls back unknown text extensions to code and unknown binary files to file tabs', async () => {
    const rootPath = await createTempWorkspace()
    const textFilePath = path.join(rootPath, 'notes.custom')
    const binaryFilePath = path.join(rootPath, 'image.custombin')

    await writeFile(textFilePath, 'plain text body\n', 'utf8')
    await writeFile(binaryFilePath, Buffer.from([0, 159, 146, 150, 0, 1, 2, 3]))

    await expect(resolveWorkspaceEditorKind(textFilePath)).resolves.toBe('code')
    await expect(resolveWorkspaceEditorKind(binaryFilePath)).resolves.toBe('file')
  })

  it('routes delimited table files to file tabs', async () => {
    const rootPath = await createTempWorkspace()

    await expect(resolveWorkspaceEditorKind(path.join(rootPath, 'data.csv'))).resolves.toBe('file')
    await expect(resolveWorkspaceEditorKind(path.join(rootPath, 'export.tsv'))).resolves.toBe('file')
  })

  it('saves pasted images inside the workspace and avoids name collisions', async () => {
    const rootPath = await createTempWorkspace()
    const imageData = 'data:image/png;base64,aGVsbG8='

    const firstImagePath = await saveWorkspaceImage(rootPath, 'assets', 'clipboard.png', imageData)
    const secondImagePath = await saveWorkspaceImage(rootPath, 'assets', 'clipboard.png', imageData)

    expect(firstImagePath).toBe(path.join(rootPath, 'assets', 'clipboard.png'))
    expect(secondImagePath).toBe(path.join(rootPath, 'assets', 'clipboard-1.png'))
    await expect(readFile(firstImagePath)).resolves.toEqual(Buffer.from('hello'))
    await expect(readFile(secondImagePath)).resolves.toEqual(Buffer.from('hello'))
  })

  it('checks file existence only inside the active workspace', async () => {
    const rootPath = await createTempWorkspace()
    const filePath = path.join(rootPath, 'notes.md')
    const outsideRootPath = await createTempWorkspace()
    const outsideFilePath = path.join(outsideRootPath, 'notes.md')

    await writeFile(filePath, '# Notes', 'utf8')
    await writeFile(outsideFilePath, '# Outside', 'utf8')

    await expect(workspaceFileExists(rootPath, filePath)).resolves.toBe(true)
    await expect(workspaceFileExists(rootPath, outsideFilePath)).resolves.toBe(false)
  })
})

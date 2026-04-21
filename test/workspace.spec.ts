import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorkspaceFile,
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

    expect(tree).toEqual([
      {
        children: [],
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

  it('skips symbolic links so recursive workspace loading stays bounded', async () => {
    const rootPath = await createTempWorkspace()
    const linkedDirectoryPath = path.join(rootPath, 'linked-dir')
    const linkedFilePath = path.join(rootPath, 'linked-file.md')

    await mkdir(path.join(rootPath, 'docs'), { recursive: true })
    await writeFile(path.join(rootPath, 'docs', 'draft.md'), '# Draft', 'utf8')
    await writeFile(path.join(rootPath, 'real.md'), '# Real', 'utf8')
    await symlink(path.join(rootPath, 'docs'), linkedDirectoryPath)
    await symlink(path.join(rootPath, 'real.md'), linkedFilePath)

    const tree = await loadWorkspaceTree(rootPath)

    expect(tree).toEqual([
      {
        children: [
          {
            kind: 'file',
            name: 'draft.md',
            path: path.join(rootPath, 'docs', 'draft.md'),
          },
        ],
        kind: 'directory',
        name: 'docs',
        path: path.join(rootPath, 'docs'),
      },
      {
        kind: 'file',
        name: 'real.md',
        path: path.join(rootPath, 'real.md'),
      },
    ])
  })

  it('keeps loading the workspace when one child directory is unreadable', async () => {
    const rootPath = await createTempWorkspace()
    const lockedDirectoryPath = path.join(rootPath, 'locked')

    await mkdir(path.join(rootPath, 'notes'), { recursive: true })
    await mkdir(lockedDirectoryPath, { recursive: true })
    await writeFile(path.join(rootPath, 'notes', 'draft.md'), '# Draft', 'utf8')
    await writeFile(path.join(lockedDirectoryPath, 'secret.md'), 'secret', 'utf8')
    await chmod(lockedDirectoryPath, 0o000)

    try {
      const tree = await loadWorkspaceTree(rootPath)

      expect(tree).toEqual([
        {
          children: [],
          kind: 'directory',
          name: 'locked',
          path: lockedDirectoryPath,
        },
        {
          children: [
            {
              kind: 'file',
              name: 'draft.md',
              path: path.join(rootPath, 'notes', 'draft.md'),
            },
          ],
          kind: 'directory',
          name: 'notes',
          path: path.join(rootPath, 'notes'),
        },
      ])
    } finally {
      await chmod(lockedDirectoryPath, 0o700)
    }
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

  it('falls back unknown text extensions to code and keeps binary files closed', async () => {
    const rootPath = await createTempWorkspace()
    const textFilePath = path.join(rootPath, 'notes.custom')
    const binaryFilePath = path.join(rootPath, 'image.custombin')

    await writeFile(textFilePath, 'plain text body\n', 'utf8')
    await writeFile(binaryFilePath, Buffer.from([0, 159, 146, 150, 0, 1, 2, 3]))

    await expect(resolveWorkspaceEditorKind(textFilePath)).resolves.toBe('code')
    await expect(resolveWorkspaceEditorKind(binaryFilePath)).resolves.toBeNull()
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

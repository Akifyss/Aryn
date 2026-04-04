import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorkspaceFile,
  loadWorkspaceTree,
  renameWorkspaceFile,
  resolveWorkspaceEditorKind,
  shouldIgnoreWorkspacePath,
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

  it('creates and renames files while keeping them inside the workspace', async () => {
    const rootPath = await createTempWorkspace()

    const createdFilePath = await createWorkspaceFile(rootPath, 'entries/today.md')
    await writeFile(createdFilePath, 'hello', 'utf8')

    const renamedFilePath = await renameWorkspaceFile(rootPath, createdFilePath, 'archive/today.txt')

    expect(renamedFilePath).toBe(path.join(rootPath, 'archive', 'today.txt'))
    await expect(readFile(renamedFilePath, 'utf8')).resolves.toBe('hello')
    await expect(renameWorkspaceFile(rootPath, renamedFilePath, '../outside.md')).rejects.toThrow(
      'File path must stay inside the current workspace.',
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
})

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createWorkspaceFile,
  loadWorkspaceTree,
  renameWorkspaceFile,
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
  it('shows only openable text files in the workspace tree', async () => {
    const rootPath = await createTempWorkspace()
    const docsPath = path.join(rootPath, 'docs')

    await mkdir(docsPath, { recursive: true })
    await writeFile(path.join(rootPath, 'draft.md'), '# Draft', 'utf8')
    await writeFile(path.join(docsPath, 'notes.txt'), 'notes', 'utf8')
    await writeFile(path.join(rootPath, 'image.png'), 'png', 'utf8')
    await mkdir(path.join(rootPath, 'node_modules', 'ignored-lib'), { recursive: true })
    await writeFile(path.join(rootPath, 'node_modules', 'ignored-lib', 'readme.md'), 'ignore me', 'utf8')

    const tree = await loadWorkspaceTree(rootPath)

    expect(tree).toEqual([
      {
        children: [
          {
            isOpenable: true,
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
        isOpenable: true,
        kind: 'file',
        name: 'draft.md',
        path: path.join(rootPath, 'draft.md'),
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
})

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getWorkspaceFileDataUrl } from '../electron/main/workspace'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'workspace-file-url-'))
  tempRoots.push(rootPath)
  return rootPath
}

describe('workspace file URL helpers', () => {
  it('returns a data URL for files inside the workspace', async () => {
    const rootPath = await createTempDir()
    const filePath = path.join(rootPath, 'docs', 'sample.txt')

    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, 'hello', 'utf8')

    await expect(getWorkspaceFileDataUrl(rootPath, filePath, 'text/plain')).resolves.toBe('data:text/plain;base64,aGVsbG8=')
  })

  it('rejects files outside the workspace', async () => {
    const rootPath = await createTempDir()
    const outsideRootPath = await createTempDir()
    const filePath = path.join(outsideRootPath, 'sample.txt')

    await writeFile(filePath, 'hello', 'utf8')

    await expect(getWorkspaceFileDataUrl(rootPath, filePath, 'text/plain')).rejects.toThrow('inside the current workspace')
  })
})

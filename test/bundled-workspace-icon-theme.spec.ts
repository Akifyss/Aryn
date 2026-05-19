import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isFlowIconsVsixPath,
  isBundledWorkspaceIconThemePath,
  resolveBundledWorkspaceIconThemePath,
} from '../electron/main/bundled-workspace-icon-theme'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir(prefix: string) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(rootPath)
  return rootPath
}

async function writeEmptyFile(filePath: string) {
  await writeFile(filePath, '', 'utf8')
}

describe('bundled workspace icon theme resolution', () => {
  it('selects the newest bundled Flow Icons VSIX by semantic version', async () => {
    const rootPath = await createTempDir('bundled-workspace-icon-theme-')

    await Promise.all([
      writeEmptyFile(path.join(rootPath, 'thang-nm.flow-icons-1.3.2.vsix')),
      writeEmptyFile(path.join(rootPath, 'thang-nm.flow-icons-2.0.2.vsix')),
      writeEmptyFile(path.join(rootPath, 'thang-nm.flow-icons-2.0.10.vsix')),
      writeEmptyFile(path.join(rootPath, 'unrelated-icons-9.9.9.vsix')),
    ])

    await expect(resolveBundledWorkspaceIconThemePath(rootPath))
      .resolves
      .toBe(path.join(rootPath, 'thang-nm.flow-icons-2.0.10.vsix'))
  })

  it('treats any versioned bundled Flow Icons path as bundled', async () => {
    const rootPath = await createTempDir('bundled-workspace-icon-theme-')
    const legacyBundledPath = path.join(rootPath, 'thang-nm.flow-icons-1.3.2.vsix')
    const currentBundledPath = path.join(rootPath, 'thang-nm.flow-icons-2.0.2.vsix')
    const externalPath = path.join(os.tmpdir(), 'thang-nm.flow-icons-2.0.2.vsix')

    await mkdir(rootPath, { recursive: true })

    expect(isBundledWorkspaceIconThemePath(legacyBundledPath, rootPath)).toBe(true)
    expect(isBundledWorkspaceIconThemePath(currentBundledPath, rootPath)).toBe(true)
    expect(isBundledWorkspaceIconThemePath(externalPath, rootPath)).toBe(false)
  })

  it('recognizes Flow Icons VSIX filenames independently from their directory', () => {
    expect(isFlowIconsVsixPath('/old/app/public/icon-themes/thang-nm.flow-icons-1.3.2.vsix')).toBe(true)
    expect(isFlowIconsVsixPath('/old/app/public/icon-themes/other-icons-1.3.2.vsix')).toBe(false)
  })

  it('reports a clear error when the bundled package is missing', async () => {
    const rootPath = await createTempDir('bundled-workspace-icon-theme-')

    await expect(resolveBundledWorkspaceIconThemePath(rootPath))
      .rejects
      .toThrow(/No bundled Flow Icons VSIX package/u)
  })
})

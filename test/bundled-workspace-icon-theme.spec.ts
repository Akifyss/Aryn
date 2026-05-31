import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isBundledWorkspaceIconThemePath,
  resolveBundledWorkspaceIconThemePath,
  resolveBundledWorkspaceIconThemePaths,
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
  it('selects the newest bundled VSIX for each icon package', async () => {
    const rootPath = await createTempDir('bundled-workspace-icon-theme-')

    await Promise.all([
      writeEmptyFile(path.join(rootPath, 'Catppuccin.catppuccin-vsc-icons-1.25.0.vsix')),
      writeEmptyFile(path.join(rootPath, 'Catppuccin.catppuccin-vsc-icons-1.26.0.vsix')),
      writeEmptyFile(path.join(rootPath, 'PKief.material-icon-theme-5.35.0.vsix')),
      writeEmptyFile(path.join(rootPath, 'miguelsolorio.symbols-0.0.25.vsix')),
      writeEmptyFile(path.join(rootPath, 'readme.txt')),
    ])

    await expect(resolveBundledWorkspaceIconThemePaths(rootPath))
      .resolves
      .toEqual([
        path.join(rootPath, 'Catppuccin.catppuccin-vsc-icons-1.26.0.vsix'),
        path.join(rootPath, 'PKief.material-icon-theme-5.35.0.vsix'),
        path.join(rootPath, 'miguelsolorio.symbols-0.0.25.vsix'),
      ])
  })

  it('returns the default bundled VSIX path', async () => {
    const rootPath = await createTempDir('bundled-workspace-icon-theme-')

    await Promise.all([
      writeEmptyFile(path.join(rootPath, 'Catppuccin.catppuccin-vsc-icons-1.26.0.vsix')),
      writeEmptyFile(path.join(rootPath, 'PKief.material-icon-theme-5.35.0.vsix')),
    ])

    await expect(resolveBundledWorkspaceIconThemePath(rootPath))
      .resolves
      .toBe(path.join(rootPath, 'Catppuccin.catppuccin-vsc-icons-1.26.0.vsix'))
  })

  it('treats any VSIX in the bundled directory as bundled', async () => {
    const rootPath = await createTempDir('bundled-workspace-icon-theme-')
    const bundledPath = path.join(rootPath, 'PKief.material-icon-theme-5.35.0.vsix')
    const externalPath = path.join(os.tmpdir(), 'PKief.material-icon-theme-5.35.0.vsix')
    const nonVsixPath = path.join(rootPath, 'theme.txt')

    await mkdir(rootPath, { recursive: true })

    expect(isBundledWorkspaceIconThemePath(bundledPath, rootPath)).toBe(true)
    expect(isBundledWorkspaceIconThemePath(externalPath, rootPath)).toBe(false)
    expect(isBundledWorkspaceIconThemePath(nonVsixPath, rootPath)).toBe(false)
  })

  it('reports a clear error when the bundled package is missing', async () => {
    const rootPath = await createTempDir('bundled-workspace-icon-theme-')

    await expect(resolveBundledWorkspaceIconThemePath(rootPath))
      .rejects
      .toThrow(/No bundled VSIX icon theme package/u)
  })
})

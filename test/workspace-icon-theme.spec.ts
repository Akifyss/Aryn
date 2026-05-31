import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import archiver from 'archiver'
import { afterEach, describe, expect, it } from 'vitest'
import {
  importWorkspaceIconThemeFromVsix,
  loadWorkspaceIconThemeCatalogFromVsix,
} from '../electron/main/workspace-icon-theme'
import {
  resolveBundledWorkspaceIconThemePaths,
} from '../electron/main/bundled-workspace-icon-theme'
import {
  resolveWorkspaceDirectoryIconUrl,
  resolveWorkspaceFileIconUrl,
} from '../src/features/workspace/lib/icon-theme'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir(prefix: string) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempRoots.push(rootPath)
  return rootPath
}

async function createFixtureVsix() {
  const rootPath = await createTempDir('workspace-icon-theme-')
  const extensionRootPath = path.join(rootPath, 'extension')
  const iconsRootPath = path.join(extensionRootPath, 'icons')
  const vsixPath = path.join(rootPath, 'fixture-theme.vsix')

  await mkdir(iconsRootPath, { recursive: true })

  await writeFile(path.join(extensionRootPath, 'package.json'), JSON.stringify({
    displayName: 'Fixture Icons',
    contributes: {
      iconThemes: [
        {
          id: 'fixture-dark',
          label: 'Fixture Dark',
          path: 'theme.json',
        },
        {
          id: 'fixture-you',
          label: 'Fixture You',
          path: 'theme.json',
        },
      ],
    },
  }, null, 2), 'utf8')

  await writeFile(path.join(extensionRootPath, 'theme.json'), `{
    // JSONC comments are common in VS Code themes.
    "file": "file",
    "folder": "folder",
    "folderExpanded": "folder-open",
    "iconDefinitions": {
      "file": { "iconPath": "./icons/file.png" },
      "folder": { "iconPath": "./icons/folder.png" },
      "folder-open": { "iconPath": "./icons/folder-open.png" },
      "readme": { "iconPath": "./icons/readme.png" },
      "spec-ts": { "iconPath": "./icons/spec-ts.png" },
      "docs": { "iconPath": "./icons/docs.png" },
      "docs-open": { "iconPath": "./icons/docs-open.png" }
    },
    "fileNames": {
      "readme.md": "readme"
    },
    "fileExtensions": {
      "spec.ts": "spec-ts"
    },
    "folderNames": {
      "docs": "docs"
    },
    "folderNamesExpanded": {
      "docs": "docs-open"
    }
  }`, 'utf8')

  const iconFiles = [
    'file.png',
    'folder.png',
    'folder-open.png',
    'readme.png',
    'spec-ts.png',
    'docs.png',
    'docs-open.png',
  ]

  await Promise.all(iconFiles.map((fileName) => writeFile(path.join(iconsRootPath, fileName), fileName, 'utf8')))

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(vsixPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(extensionRootPath, 'extension')
    void archive.finalize()
  })

  return {
    cacheRootPath: path.join(rootPath, 'cache'),
    vsixPath,
  }
}

function expectDataUrl(value: string | null) {
  expect(typeof value).toBe('string')
  expect(value?.startsWith('data:image/png;base64,')).toBe(true)
}

describe('workspace icon theme import', () => {
  it('imports a VSIX icon theme and resolves file URLs', async () => {
    const fixture = await createFixtureVsix()

    const theme = await importWorkspaceIconThemeFromVsix(fixture.vsixPath, fixture.cacheRootPath)

    expect(theme.extensionLabel).toBe('Fixture Icons')
    expect(theme.activeThemeId).toBe('fixture-dark')
    expect(theme.activeThemeLabel).toBe('Fixture Dark')
    expect(theme.sourceKind).toBe('external')
    expectDataUrl(theme.defaultFileIcon)
    expectDataUrl(theme.defaultFolderIcon)
    expectDataUrl(theme.defaultFolderExpandedIcon)
    expectDataUrl(theme.fileNames['readme.md'])
    expectDataUrl(theme.fileExtensions['spec.ts'])
    expectDataUrl(theme.folderNames.docs)
    expectDataUrl(theme.folderNamesExpanded.docs)
  })

  it('exposes every icon theme variant contributed by a VSIX package', async () => {
    const fixture = await createFixtureVsix()

    const theme = await loadWorkspaceIconThemeCatalogFromVsix(fixture.vsixPath, fixture.cacheRootPath)

    expect(theme.themes).toEqual([
      {
        id: 'fixture-dark',
        label: 'Fixture Dark',
      },
      {
        id: 'fixture-you',
        label: 'Fixture You',
      },
    ])
  })

  it('shares one complete VSIX extraction between concurrent catalog and theme imports', async () => {
    const fixture = await createFixtureVsix()

    const [
      catalog,
      theme,
    ] = await Promise.all([
      loadWorkspaceIconThemeCatalogFromVsix(fixture.vsixPath, fixture.cacheRootPath),
      importWorkspaceIconThemeFromVsix(fixture.vsixPath, fixture.cacheRootPath),
    ])

    const cacheEntries = await readdir(fixture.cacheRootPath)

    expect(cacheEntries).toHaveLength(1)
    expect(catalog.themes.map((themeOption) => themeOption.id)).toEqual(['fixture-dark', 'fixture-you'])
    expect(theme.activeThemeLabel).toBe('Fixture Dark')
    expectDataUrl(theme.defaultFileIcon)
  })

  it('re-extracts stale cache entries that only contain a manifest', async () => {
    const fixture = await createFixtureVsix()

    await loadWorkspaceIconThemeCatalogFromVsix(fixture.vsixPath, fixture.cacheRootPath)

    const cacheEntries = await readdir(fixture.cacheRootPath)
    expect(cacheEntries).toHaveLength(1)

    const staleCacheRootPath = path.join(fixture.cacheRootPath, cacheEntries[0])
    const staleExtensionRootPath = path.join(staleCacheRootPath, 'extension')
    await rm(path.join(staleCacheRootPath, '.aryn-extraction-complete'), { force: true })
    await rm(path.join(staleExtensionRootPath, 'theme.json'), { force: true })
    await rm(path.join(staleExtensionRootPath, 'icons'), { recursive: true, force: true })

    const theme = await importWorkspaceIconThemeFromVsix(fixture.vsixPath, fixture.cacheRootPath)

    expect(theme.activeThemeLabel).toBe('Fixture Dark')
    expectDataUrl(theme.defaultFileIcon)
  })

  it('re-extracts stale cache entries when icon files are missing after catalog load', async () => {
    const fixture = await createFixtureVsix()

    await loadWorkspaceIconThemeCatalogFromVsix(fixture.vsixPath, fixture.cacheRootPath)

    const cacheEntries = await readdir(fixture.cacheRootPath)
    expect(cacheEntries).toHaveLength(1)

    const staleExtensionRootPath = path.join(fixture.cacheRootPath, cacheEntries[0], 'extension')
    await rm(path.join(staleExtensionRootPath, 'icons'), { recursive: true, force: true })

    const theme = await importWorkspaceIconThemeFromVsix(fixture.vsixPath, fixture.cacheRootPath)

    expect(theme.activeThemeLabel).toBe('Fixture Dark')
    expectDataUrl(theme.defaultFileIcon)
  })

  it('exposes the bundled Catppuccin, Material, and Symbols icon themes', async () => {
    const bundledThemeDirectoryPath = path.join(process.cwd(), 'public', 'icon-themes')
    const bundledThemePaths = await resolveBundledWorkspaceIconThemePaths(bundledThemeDirectoryPath)
    const cacheRootPath = await createTempDir('workspace-icon-theme-cache-')

    const catalogs = await Promise.all(
      bundledThemePaths.map((themePath) => loadWorkspaceIconThemeCatalogFromVsix(themePath, cacheRootPath, 'bundled')),
    )
    const labels = catalogs.flatMap((theme) => theme.themes.map((themeOption) => themeOption.label))

    expect(catalogs.every((theme) => theme.sourceKind === 'bundled')).toBe(true)
    expect(labels).toEqual(expect.arrayContaining([
      'Catppuccin Latte',
      'Catppuccin Mocha',
      'Material Icon Theme',
      'Symbol Icons',
    ]))
  })

  it('matches exact file names, multi-part extensions, and expanded folder icons', async () => {
    const fixture = await createFixtureVsix()
    const theme = await importWorkspaceIconThemeFromVsix(fixture.vsixPath, fixture.cacheRootPath)

    const readmeIcon = resolveWorkspaceFileIconUrl(theme, 'README.md')
    const specIcon = resolveWorkspaceFileIconUrl(theme, 'workspace-tree.spec.ts')
    const fallbackIcon = resolveWorkspaceFileIconUrl(theme, 'draft.txt')
    const collapsedDocsIcon = resolveWorkspaceDirectoryIconUrl(theme, 'docs', false)
    const expandedDocsIcon = resolveWorkspaceDirectoryIconUrl(theme, 'docs', true)

    expect(readmeIcon).toBe(theme.fileNames['readme.md'])
    expect(specIcon).toBe(theme.fileExtensions['spec.ts'])
    expect(fallbackIcon).toBe(theme.defaultFileIcon)
    expect(collapsedDocsIcon).toBe(theme.folderNames.docs)
    expect(expandedDocsIcon).toBe(theme.folderNamesExpanded.docs)
  })
})

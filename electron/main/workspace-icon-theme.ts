import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import extractZip from 'extract-zip'
import type {
  WorkspaceIconTheme,
  WorkspaceIconThemeOption,
  WorkspaceIconThemeSourceKind,
} from '../../src/features/workspace/types'

export type WorkspaceIconThemeCatalog = Pick<
  WorkspaceIconTheme,
  'extensionLabel' | 'sourceKind' | 'sourceVsixPath' | 'themes'
>

type ThemeContribution = {
  id: string
  label?: string
  path: string
}

type ExtensionPackageManifest = {
  displayName?: string
  name?: string
  contributes?: {
    iconThemes?: ThemeContribution[]
  }
}

type RawIconDefinition = {
  iconPath?: string
}

type RawWorkspaceIconTheme = {
  file?: string
  fileExtensions?: Record<string, string>
  fileNames?: Record<string, string>
  folder?: string
  folderExpanded?: string
  folderNames?: Record<string, string>
  folderNamesExpanded?: Record<string, string>
  iconDefinitions?: Record<string, RawIconDefinition>
  rootFolder?: string
  rootFolderExpanded?: string
}

const preferredDarkThemePattern = /\b(dark|deep|dim|night|midnight)\b/i
const extractionCompleteFileName = '.aryn-extraction-complete'
const packageFileName = 'package.json'
const iconDataUrlCache = new Map<string, Promise<string>>()
const vsixExtractionLocks = new Map<string, Promise<string>>()

function stripJsonComments(source: string) {
  let result = ''
  let isInsideString = false
  let isInsideBlockComment = false
  let isInsideLineComment = false
  let stringDelimiter = ''
  let previousCharacter = ''

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    const nextCharacter = source[index + 1] ?? ''

    if (isInsideLineComment) {
      if (character === '\n') {
        isInsideLineComment = false
        result += character
      }
      previousCharacter = character
      continue
    }

    if (isInsideBlockComment) {
      if (character === '*' && nextCharacter === '/') {
        isInsideBlockComment = false
        index += 1
      }
      previousCharacter = character
      continue
    }

    if (isInsideString) {
      result += character
      if (character === stringDelimiter && previousCharacter !== '\\') {
        isInsideString = false
        stringDelimiter = ''
      }
      previousCharacter = character
      continue
    }

    if ((character === '"' || character === '\'') && previousCharacter !== '\\') {
      isInsideString = true
      stringDelimiter = character
      result += character
      previousCharacter = character
      continue
    }

    if (character === '/' && nextCharacter === '/') {
      isInsideLineComment = true
      index += 1
      previousCharacter = character
      continue
    }

    if (character === '/' && nextCharacter === '*') {
      isInsideBlockComment = true
      index += 1
      previousCharacter = character
      continue
    }

    result += character
    previousCharacter = character
  }

  return result
}

function parseJsonFile<T>(rawValue: string, filePath: string) {
  const normalizedValue = rawValue.replace(/^\uFEFF/, '')

  try {
    return JSON.parse(normalizedValue) as T
  } catch {
    try {
      return JSON.parse(stripJsonComments(normalizedValue)) as T
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown JSON parse error.'
      throw new Error(`Unable to parse icon theme file "${filePath}": ${message}`)
    }
  }
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase()
}

async function normalizeIconMap(
  themeRootPath: string,
  iconDefinitions: Record<string, RawIconDefinition>,
  associations?: Record<string, string>,
) {
  const normalizedAssociations: Record<string, string> = {}

  for (const [rawKey, rawIconId] of Object.entries(associations ?? {})) {
    if (typeof rawKey !== 'string' || typeof rawIconId !== 'string') {
      continue
    }

    const normalizedKey = normalizeIdentifier(rawKey)
    if (!normalizedKey) {
      continue
    }

    const iconUrl = await resolveIconDefinitionUrl(themeRootPath, iconDefinitions, rawIconId)
    if (!iconUrl) {
      continue
    }

    normalizedAssociations[normalizedKey] = iconUrl
  }

  return normalizedAssociations
}

function getMimeTypeForIcon(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.svg':
      return 'image/svg+xml'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return 'image/png'
  }
}

async function readIconAsDataUrl(filePath: string) {
  const cachedValue = iconDataUrlCache.get(filePath)
  if (cachedValue) {
    return cachedValue
  }

  const pendingValue = readFile(filePath)
    .then((buffer) => {
      const mimeType = getMimeTypeForIcon(filePath)
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    })
    .catch((error) => {
      iconDataUrlCache.delete(filePath)
      throw error
    })

  iconDataUrlCache.set(filePath, pendingValue)
  return pendingValue
}

function clearIconDataUrlCacheForRoot(rootPath: string) {
  const normalizedRootPath = path.resolve(rootPath)
  const normalizedRootPathPrefix = `${normalizedRootPath}${path.sep}`

  for (const filePath of iconDataUrlCache.keys()) {
    const normalizedFilePath = path.resolve(filePath)
    if (normalizedFilePath === normalizedRootPath || normalizedFilePath.startsWith(normalizedRootPathPrefix)) {
      iconDataUrlCache.delete(filePath)
    }
  }
}

async function resolveIconDefinitionUrl(
  themeFileDirectoryPath: string,
  iconDefinitions: Record<string, RawIconDefinition>,
  iconId?: string,
) {
  if (!iconId) {
    return null
  }

  const iconDefinition = iconDefinitions[iconId]
  if (!iconDefinition?.iconPath) {
    return null
  }

  const resolvedIconPath = path.resolve(themeFileDirectoryPath, iconDefinition.iconPath)
  return readIconAsDataUrl(resolvedIconPath)
}

async function resolveVsixCacheKey(vsixPath: string) {
  const fileInfo = await stat(vsixPath)
  return createHash('sha1')
    .update(path.resolve(vsixPath))
    .update(':')
    .update(String(fileInfo.size))
    .update(':')
    .update(String(fileInfo.mtimeMs))
    .digest('hex')
}

async function resolveExtractedExtensionRoot(extractRootPath: string) {
  const directPackagePath = path.join(extractRootPath, packageFileName)
  const nestedPackagePath = path.join(extractRootPath, 'extension', packageFileName)

  if (await hasFile(directPackagePath)) {
    return extractRootPath
  }

  if (await hasFile(nestedPackagePath)) {
    return path.join(extractRootPath, 'extension')
  }

  const entries = await readdir(extractRootPath, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const candidateRootPath = path.join(extractRootPath, entry.name)
    if (await hasFile(path.join(candidateRootPath, packageFileName))) {
      return candidateRootPath
    }
  }

  throw new Error('The VSIX package does not contain a resolvable extension manifest.')
}

async function resolveVsixCachePaths(vsixPath: string, cacheRootPath: string) {
  const cacheKey = await resolveVsixCacheKey(vsixPath)
  const extractRootPath = path.join(cacheRootPath, cacheKey)

  return {
    cacheKey,
    extractRootPath,
  }
}

async function rebuildExtractedVsix(vsixPath: string, extractRootPath: string) {
  const tempExtractRootPath = `${extractRootPath}.tmp-${process.pid}-${randomUUID()}`

  await rm(tempExtractRootPath, { recursive: true, force: true })

  try {
    await mkdir(tempExtractRootPath, { recursive: true })
    await extractZip(vsixPath, { dir: tempExtractRootPath })
    await resolveExtractedExtensionRoot(tempExtractRootPath)
    await writeFile(path.join(tempExtractRootPath, extractionCompleteFileName), '', 'utf8')
    clearIconDataUrlCacheForRoot(extractRootPath)
    await rm(extractRootPath, { recursive: true, force: true })
    await rename(tempExtractRootPath, extractRootPath)
    return resolveExtractedExtensionRoot(extractRootPath)
  } catch (error) {
    await rm(tempExtractRootPath, { recursive: true, force: true })
    throw error
  }
}

async function ensureExtractedVsix(
  vsixPath: string,
  cacheRootPath: string,
  options: { force?: boolean } = {},
) {
  const { cacheKey, extractRootPath } = await resolveVsixCachePaths(vsixPath, cacheRootPath)
  const extractionCompletePath = path.join(extractRootPath, extractionCompleteFileName)
  const lockKey = `${path.resolve(cacheRootPath)}:${cacheKey}`

  await mkdir(cacheRootPath, { recursive: true })

  const activeExtraction = vsixExtractionLocks.get(lockKey)
  if (activeExtraction) {
    try {
      return await activeExtraction
    } catch (error) {
      if (!options.force) {
        throw error
      }
    }
  }

  if (!options.force && await hasFile(extractionCompletePath)) {
    try {
      return await resolveExtractedExtensionRoot(extractRootPath)
    } catch {
      return ensureExtractedVsix(vsixPath, cacheRootPath, { force: true })
    }
  }

  const pendingExtraction = rebuildExtractedVsix(vsixPath, extractRootPath)
    .finally(() => {
      if (vsixExtractionLocks.get(lockKey) === pendingExtraction) {
        vsixExtractionLocks.delete(lockKey)
      }
    })

  vsixExtractionLocks.set(lockKey, pendingExtraction)
  return pendingExtraction
}

function pickThemeContribution(
  iconThemes: ThemeContribution[],
  preferredThemeId?: string | null,
) {
  if (preferredThemeId) {
    const matchingTheme = iconThemes.find((theme) => theme.id === preferredThemeId)
    if (matchingTheme) {
      return matchingTheme
    }
  }

  return iconThemes.find((theme) => preferredDarkThemePattern.test(`${theme.id} ${theme.label ?? ''}`))
    ?? iconThemes[0]
}

function toThemeOptions(iconThemes: ThemeContribution[]): WorkspaceIconThemeOption[] {
  return iconThemes.map((theme) => ({
    id: theme.id,
    label: theme.label?.trim() || theme.id,
  }))
}

async function hasFile(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function getExtensionLabel(manifest: ExtensionPackageManifest) {
  return manifest.displayName?.trim() || manifest.name?.trim() || 'VS Code Icon Theme'
}

async function loadExtensionManifest(extensionRootPath: string) {
  const manifestPath = path.join(extensionRootPath, packageFileName)
  const rawManifest = await readFile(manifestPath, 'utf8')
  const manifest = parseJsonFile<ExtensionPackageManifest>(rawManifest, manifestPath)
  const iconThemes = manifest.contributes?.iconThemes ?? []

  if (iconThemes.length === 0) {
    throw new Error('The selected VSIX package does not contribute any icon themes.')
  }

  return {
    iconThemes,
    manifest,
  }
}

export async function loadWorkspaceIconThemeCatalogFromVsix(
  vsixPath: string,
  cacheRootPath: string,
  sourceKind: WorkspaceIconThemeSourceKind = 'external',
): Promise<WorkspaceIconThemeCatalog> {
  const resolvedVsixPath = path.resolve(vsixPath)
  const loadCatalog = async (forceExtract = false) => {
    const extensionRootPath = await ensureExtractedVsix(
      resolvedVsixPath,
      cacheRootPath,
      { force: forceExtract },
    )
    const { iconThemes, manifest } = await loadExtensionManifest(extensionRootPath)

    return {
      extensionLabel: getExtensionLabel(manifest),
      sourceKind,
      sourceVsixPath: resolvedVsixPath,
      themes: toThemeOptions(iconThemes),
    }
  }

  try {
    return await loadCatalog()
  } catch {
    return loadCatalog(true)
  }
}

export async function importWorkspaceIconThemeFromVsix(
  vsixPath: string,
  cacheRootPath: string,
  preferredThemeId?: string | null,
  sourceKind: WorkspaceIconThemeSourceKind = 'external',
): Promise<WorkspaceIconTheme> {
  const resolvedVsixPath = path.resolve(vsixPath)
  const importTheme = async (forceExtract = false) => {
    const extensionRootPath = await ensureExtractedVsix(
      resolvedVsixPath,
      cacheRootPath,
      { force: forceExtract },
    )
    const { iconThemes, manifest } = await loadExtensionManifest(extensionRootPath)
    const selectedTheme = pickThemeContribution(iconThemes, preferredThemeId)

    if (!selectedTheme) {
      throw new Error('The selected VSIX package does not contain a usable icon theme.')
    }

    const themeFilePath = path.resolve(extensionRootPath, selectedTheme.path)
    const themeFileDirectoryPath = path.dirname(themeFilePath)
    const rawTheme = await readFile(themeFilePath, 'utf8')
    const theme = parseJsonFile<RawWorkspaceIconTheme>(rawTheme, themeFilePath)
    const iconDefinitions = theme.iconDefinitions ?? {}

    return {
      activeThemeId: selectedTheme.id,
      activeThemeLabel: selectedTheme.label?.trim() || selectedTheme.id,
      defaultFileIcon: await resolveIconDefinitionUrl(themeFileDirectoryPath, iconDefinitions, theme.file),
      defaultFolderExpandedIcon: await resolveIconDefinitionUrl(themeFileDirectoryPath, iconDefinitions, theme.folderExpanded),
      defaultFolderIcon: await resolveIconDefinitionUrl(themeFileDirectoryPath, iconDefinitions, theme.folder),
      defaultRootFolderExpandedIcon: await resolveIconDefinitionUrl(themeFileDirectoryPath, iconDefinitions, theme.rootFolderExpanded),
      defaultRootFolderIcon: await resolveIconDefinitionUrl(themeFileDirectoryPath, iconDefinitions, theme.rootFolder),
      extensionLabel: getExtensionLabel(manifest),
      fileExtensions: await normalizeIconMap(themeFileDirectoryPath, iconDefinitions, theme.fileExtensions),
      fileNames: await normalizeIconMap(themeFileDirectoryPath, iconDefinitions, theme.fileNames),
      folderNames: await normalizeIconMap(themeFileDirectoryPath, iconDefinitions, theme.folderNames),
      folderNamesExpanded: await normalizeIconMap(themeFileDirectoryPath, iconDefinitions, theme.folderNamesExpanded),
      sourceKind,
      sourceVsixPath: resolvedVsixPath,
      themes: toThemeOptions(iconThemes),
    }
  }

  try {
    return await importTheme()
  } catch {
    return importTheme(true)
  }
}

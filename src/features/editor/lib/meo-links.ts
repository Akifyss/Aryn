type MeoResolvedLinkResult = {
  exists: boolean
  filePath?: string
  target: string
}

export type MeoWorkspaceFileExists = (
  workspacePath: string,
  filePath: string,
) => Promise<{ exists: boolean }>

type ParsedFsPath = {
  root: string
  segments: string[]
  windowsLike: boolean
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx', '.mdc']

function toFileUrl(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, '/')

  if (/^[a-z]+:/i.test(normalizedPath)) {
    const fileUrl = normalizedPath.startsWith('file://')
      ? normalizedPath
      : `file:///${normalizedPath}`
    return encodeURI(fileUrl)
  }

  return encodeURI(normalizedPath)
}

export function resolveImageUrl(filePath: string, target: string) {
  if (!target) {
    return ''
  }

  if (/^(?:https?:|data:|blob:|file:)/i.test(target)) {
    return target
  }

  const [rawPath, hash = ''] = target.split('#', 2)
  const [pathWithoutQuery, query = ''] = rawPath.split('?', 2)
  const normalizedTargetPath = pathWithoutQuery.replace(/\\/g, '/')

  if (/^[A-Za-z]:\//.test(normalizedTargetPath)) {
    const baseUrl = toFileUrl(normalizedTargetPath)
    const querySuffix = query ? `?${query}` : ''
    const hashSuffix = hash ? `#${hash}` : ''
    return `${baseUrl}${querySuffix}${hashSuffix}`
  }

  const directorySegments = filePath.replace(/\\/g, '/').split('/')
  directorySegments.pop()

  for (const segment of normalizedTargetPath.split('/')) {
    if (!segment || segment === '.') {
      continue
    }

    if (segment === '..') {
      directorySegments.pop()
      continue
    }

    directorySegments.push(segment)
  }

  const resolvedPath = directorySegments.join('/')
  const querySuffix = query ? `?${query}` : ''
  const hashSuffix = hash ? `#${hash}` : ''
  return `${toFileUrl(resolvedPath)}${querySuffix}${hashSuffix}`
}

function parseFsPath(filePath: string): ParsedFsPath | null {
  const normalizedPath = filePath.replace(/\\/g, '/').trim()
  const windowsMatch = normalizedPath.match(/^[A-Za-z]:\//)

  if (windowsMatch) {
    return {
      root: windowsMatch[0],
      segments: normalizedPath.slice(windowsMatch[0].length).split('/').filter(Boolean),
      windowsLike: true,
    }
  }

  if (!normalizedPath.startsWith('/')) {
    return null
  }

  return {
    root: '/',
    segments: normalizedPath.slice(1).split('/').filter(Boolean),
    windowsLike: false,
  }
}

function formatFsPath(parsedPath: ParsedFsPath, useBackslashes: boolean) {
  const separator = useBackslashes ? '\\' : '/'
  const renderedRoot = parsedPath.windowsLike && useBackslashes
    ? parsedPath.root.replace(/\//g, '\\')
    : parsedPath.root
  const joinedSegments = parsedPath.segments.join(separator)

  if (!joinedSegments) {
    return renderedRoot
  }

  return `${renderedRoot}${joinedSegments}`
}

function usesBackslashes(filePath: string) {
  return filePath.includes('\\')
}

function normalizeFsPath(filePath: string, preferredFilePath = filePath) {
  const parsedPath = parseFsPath(filePath)
  if (!parsedPath) {
    return filePath
  }

  return formatFsPath(parsedPath, usesBackslashes(preferredFilePath))
}

function getDirectoryPath(filePath: string) {
  const parsedPath = parseFsPath(filePath)

  if (!parsedPath) {
    return filePath
  }

  return formatFsPath({
    ...parsedPath,
    segments: parsedPath.segments.slice(0, -1),
  }, usesBackslashes(filePath))
}

function resolveFsPath(baseDirectoryPath: string, targetPath: string) {
  const normalizedTargetPath = targetPath.replace(/\\/g, '/')
  const absoluteTargetPath = parseFsPath(normalizedTargetPath)

  if (absoluteTargetPath) {
    return formatFsPath(absoluteTargetPath, usesBackslashes(baseDirectoryPath))
  }

  const parsedBasePath = parseFsPath(baseDirectoryPath)
  if (!parsedBasePath) {
    return null
  }

  const nextSegments = [...parsedBasePath.segments]

  for (const segment of normalizedTargetPath.split('/')) {
    if (!segment || segment === '.') {
      continue
    }

    if (segment === '..') {
      if (nextSegments.length > 0) {
        nextSegments.pop()
      }
      continue
    }

    nextSegments.push(segment)
  }

  return formatFsPath({
    ...parsedBasePath,
    segments: nextSegments,
  }, usesBackslashes(baseDirectoryPath))
}

export function getRelativeFsPath(fromFilePath: string, toFilePath: string) {
  const fromPath = parseFsPath(getDirectoryPath(fromFilePath))
  const toPath = parseFsPath(toFilePath)

  if (!fromPath || !toPath || fromPath.root.toLowerCase() !== toPath.root.toLowerCase()) {
    return normalizeFsPath(toFilePath, fromFilePath).replace(/\\/g, '/')
  }

  let commonSegmentCount = 0
  while (
    commonSegmentCount < fromPath.segments.length
    && commonSegmentCount < toPath.segments.length
    && fromPath.segments[commonSegmentCount].toLowerCase() === toPath.segments[commonSegmentCount].toLowerCase()
  ) {
    commonSegmentCount += 1
  }

  const upwardSegments = Array.from(
    { length: fromPath.segments.length - commonSegmentCount },
    () => '..',
  )
  const downwardSegments = toPath.segments.slice(commonSegmentCount)
  return [...upwardSegments, ...downwardSegments].join('/') || '.'
}

function getPathExtension(filePath: string) {
  const baseName = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
  const dotIndex = baseName.lastIndexOf('.')
  return dotIndex > 0 ? baseName.slice(dotIndex).toLowerCase() : ''
}

function stripFragment(value: string) {
  return value.split('#', 1)[0] ?? value
}

function stripQuery(value: string) {
  return value.split('?', 1)[0] ?? value
}

function decodeLinkTarget(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function getDisplayTarget(rawTarget: string) {
  return decodeLinkTarget(stripFragment(rawTarget).trim())
}

function getPathTarget(rawTarget: string) {
  return stripQuery(getDisplayTarget(rawTarget)).trim()
}

export function isExternalHref(href: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href) && !/^meo-wiki:/i.test(href)
}

function fileUrlToFsPath(fileUrl: string, preferredFilePath: string) {
  try {
    const url = new URL(fileUrl)
    if (url.protocol !== 'file:') {
      return null
    }

    let pathname = decodeURIComponent(url.pathname)
    if (/^\/[A-Za-z]:/.test(pathname)) {
      pathname = pathname.slice(1)
    }

    return normalizeFsPath(pathname, preferredFilePath)
  } catch {
    return null
  }
}

function dedupePaths(paths: string[]) {
  const seen = new Set<string>()

  return paths.filter((candidatePath) => {
    const key = candidatePath.replace(/\\/g, '/').toLowerCase()
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function buildCandidatePaths(
  filePath: string,
  workspacePath: string | null | undefined,
  rawTarget: string,
  allowedExtensions: string[],
) {
  const pathTarget = getPathTarget(rawTarget)
  if (!pathTarget || isExternalHref(pathTarget)) {
    return []
  }

  const currentDirectoryPath = getDirectoryPath(filePath)
  const resolvedBasePath = /^file:/i.test(pathTarget)
    ? fileUrlToFsPath(pathTarget, filePath)
    : resolveFsPath(currentDirectoryPath, pathTarget)

  const candidateRoots = resolvedBasePath
    ? [resolvedBasePath]
    : []

  if (workspacePath && !/^file:/i.test(pathTarget) && !parseFsPath(pathTarget)) {
    const workspaceResolvedPath = resolveFsPath(workspacePath, pathTarget)
    if (workspaceResolvedPath) {
      candidateRoots.push(workspaceResolvedPath)
    }
  }

  const directPaths = dedupePaths(candidateRoots)
  const hasExplicitExtension = Boolean(getPathExtension(pathTarget))

  if (hasExplicitExtension || allowedExtensions.length === 0) {
    return directPaths
  }

  return dedupePaths([
    ...directPaths,
    ...directPaths.flatMap((candidatePath) => allowedExtensions.map((extension) => `${candidatePath}${extension}`)),
  ])
}

async function resolveLinkTarget(
  filePath: string,
  workspacePath: string | null | undefined,
  rawTarget: string,
  allowedExtensions: string[],
  workspaceFileExists: MeoWorkspaceFileExists,
) {
  const target = getDisplayTarget(rawTarget)
  if (!target) {
    return { exists: false, target }
  }

  const candidatePaths = buildCandidatePaths(filePath, workspacePath, rawTarget, allowedExtensions)
  for (const candidatePath of candidatePaths) {
    if (!workspacePath) {
      continue
    }

    const { exists } = await workspaceFileExists(workspacePath, candidatePath)
    if (exists) {
      return {
        exists: true,
        filePath: candidatePath,
        target,
      }
    }
  }

  return { exists: false, target }
}

export async function resolveLocalLinkResults(
  filePath: string,
  workspacePath: string | null | undefined,
  targets: unknown[],
  workspaceFileExists: MeoWorkspaceFileExists,
) {
  const results: MeoResolvedLinkResult[] = []

  for (const target of targets) {
    if (typeof target !== 'string') {
      results.push({ exists: false, target: '' })
      continue
    }

    results.push(await resolveLinkTarget(
      filePath,
      workspacePath,
      target,
      MARKDOWN_EXTENSIONS,
      workspaceFileExists,
    ))
  }

  return results
}

export async function resolveWikiLinkResults(
  filePath: string,
  workspacePath: string | null | undefined,
  targets: unknown[],
  workspaceFileExists: MeoWorkspaceFileExists,
) {
  const results: MeoResolvedLinkResult[] = []

  for (const target of targets) {
    if (typeof target !== 'string') {
      results.push({ exists: false, target: '' })
      continue
    }

    results.push(await resolveLinkTarget(
      filePath,
      workspacePath,
      target,
      MARKDOWN_EXTENSIONS,
      workspaceFileExists,
    ))
  }

  return results
}

export async function resolveOpenLinkFilePath(
  filePath: string,
  workspacePath: string | null | undefined,
  href: string,
  workspaceFileExists: MeoWorkspaceFileExists,
) {
  if (/^meo-wiki:/i.test(href)) {
    const wikiTarget = href.replace(/^meo-wiki:/i, '')
    return resolveLinkTarget(filePath, workspacePath, wikiTarget, MARKDOWN_EXTENSIONS, workspaceFileExists)
  }

  return resolveLinkTarget(filePath, workspacePath, href, MARKDOWN_EXTENSIONS, workspaceFileExists)
}

export function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

export function getRelativePath(rootPath: string, filePath: string) {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/')
  const normalizedRootPath = normalizedRoot.replace(/[\\/]+/g, '/')
  const comparableFilePath = normalizedFilePath.toLowerCase()
  const comparableRootPath = normalizedRootPath.toLowerCase()

  if (
    comparableFilePath !== comparableRootPath
    && !comparableFilePath.startsWith(`${comparableRootPath}/`)
  ) {
    return getBaseName(filePath)
  }

  return normalizedFilePath.slice(normalizedRootPath.length).replace(/^\/+/, '')
}

export function getDirectoryRelativePath(rootPath: string, filePath: string) {
  const relativePath = getRelativePath(rootPath, filePath)
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

export function getNextUntitledFileName(existingNames: string[]) {
  const occupiedNames = new Set(existingNames.map((name) => name.toLowerCase()))

  if (!occupiedNames.has('untitled.md')) {
    return 'untitled.md'
  }

  let index = 2
  while (occupiedNames.has(`untitled-${index}.md`)) {
    index += 1
  }

  return `untitled-${index}.md`
}

export function getNextUntitledDirectoryName(existingNames: string[]) {
  const occupiedNames = new Set(existingNames.map((name) => name.toLowerCase()))

  if (!occupiedNames.has('new-folder')) {
    return 'new-folder'
  }

  let index = 1
  while (occupiedNames.has(`new-folder-${index}`)) {
    index += 1
  }

  return `new-folder-${index}`
}

export function normalizeFilePath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').toLowerCase()
}

export function hasPathPrefix(filePath: string, prefixPath: string) {
  const normalizedFilePath = normalizeFilePath(filePath).replace(/\/+$/, '')
  const normalizedPrefixPath = normalizeFilePath(prefixPath).replace(/\/+$/, '')

  return normalizedFilePath === normalizedPrefixPath || normalizedFilePath.startsWith(`${normalizedPrefixPath}/`)
}

export function getPathSeparator(filePath: string) {
  return filePath.includes('\\') ? '\\' : '/'
}

export function joinPath(basePath: string, relativeSuffix: string) {
  const separator = getPathSeparator(basePath)
  const normalizedBasePath = basePath.replace(/[\\/]+$/, '')
  const normalizedSuffix = relativeSuffix.replace(/[\\/]+/g, separator).replace(/^[\\/]+/, '')

  return normalizedSuffix ? `${normalizedBasePath}${separator}${normalizedSuffix}` : normalizedBasePath
}

export function rebasePathPrefix(filePath: string, currentPrefix: string, nextPrefix: string) {
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const normalizedCurrentPrefix = currentPrefix.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const suffix = normalizedFilePath === normalizedCurrentPrefix
    ? ''
    : normalizedFilePath.slice(normalizedCurrentPrefix.length).replace(/^\/+/, '')

  return joinPath(nextPrefix, suffix)
}

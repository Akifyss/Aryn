function normalizePathSlashes(value: string) {
  return value.replace(/[\\/]+/g, '/')
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function hasUriScheme(value: string) {
  return /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(value)
}

function isWindowsAbsolutePath(value: string) {
  return /^[a-zA-Z]:[\\/]/.test(value)
}

function getPathSeparator(basePath: string) {
  return basePath.includes('\\') ? '\\' : '/'
}

export function resolveWorkspaceMessageLink(workspacePath: string | null, href: string | undefined) {
  const rawHref = href?.trim()

  if (!workspacePath || !rawHref) {
    return null
  }

  if (
    rawHref.startsWith('#')
    || rawHref.startsWith('//')
    || rawHref.startsWith('/')
    || hasUriScheme(rawHref)
    || isWindowsAbsolutePath(rawHref)
  ) {
    return null
  }

  const decodedHref = (() => {
    try {
      return decodeURIComponent(rawHref)
    } catch {
      return rawHref
    }
  })()
  const normalizedHref = normalizePathSlashes(decodedHref)
  const segments = normalizedHref.split('/').filter((segment) => segment.length > 0 && segment !== '.')

  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return null
  }

  const separator = getPathSeparator(workspacePath)
  const normalizedWorkspacePath = trimTrailingSlash(workspacePath)

  return `${normalizedWorkspacePath}${separator}${segments.join(separator)}`
}

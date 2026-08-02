type AbsoluteFilePathArgs = { path: string; rootPath?: string | null }

function normalizeSlashes(value: string) {
  return value.replaceAll('\\', '/')
}

export function normalizeAbsoluteFilePath({ path: filePath }: { path: string }): string | null {
  const normalized = normalizeSlashes(filePath.trim())
  const drive = /^([A-Za-z]):\//.exec(normalized)?.[1]
  const isUnc = normalized.startsWith('//')
  if (!drive && !isUnc && !normalized.startsWith('/')) return null

  const prefix = drive ? `${drive.toUpperCase()}:/` : isUnc ? '//' : '/'
  const remainder = drive
    ? normalized.slice(3)
    : isUnc
      ? normalized.slice(2)
      : normalized.slice(1)
  const minimumSegments = isUnc ? 2 : 0
  const output: string[] = []
  for (const segment of remainder.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (output.length > minimumSegments) output.pop()
    } else {
      output.push(segment)
    }
  }
  return `${prefix}${output.join('/')}`
}

export function isAbsoluteFilePathWithinRoot({
  candidatePath,
  rootPath,
}: {
  candidatePath: string
  rootPath: string
}) {
  const normalizedCandidate = normalizeAbsoluteFilePath({ path: candidatePath })
  const normalizedRoot = normalizeAbsoluteFilePath({ path: rootPath })
  if (!normalizedCandidate || !normalizedRoot) return false
  const isWindowsPath = /^[A-Za-z]:\//.test(normalizedRoot) || normalizedRoot.startsWith('//')
  const candidate = isWindowsPath ? normalizedCandidate.toLowerCase() : normalizedCandidate
  const rootValue = isWindowsPath ? normalizedRoot.toLowerCase() : normalizedRoot
  const root = rootValue.replace(/\/$/, '')
  return candidate === root || candidate.startsWith(`${root}/`)
}

export function resolveAbsoluteFilePath({ path: filePath, rootPath }: AbsoluteFilePathArgs) {
  if (/^(?:[A-Za-z]:[\\/]|\/)/.test(filePath)) return filePath
  if (!rootPath) return filePath
  return `${rootPath.replace(/[\\/]$/, '')}/${filePath.replace(/^[\\/]/, '')}`
}

export type FilePreviewLineRange = {
  startLineNumber: number
  endLineNumber: number
}

export function createFilePreviewLineRange(value: FilePreviewLineRange): FilePreviewLineRange {
  return value
}

function localFileUrl(filePath: string) {
  if (/^(?:data:|https?:|file:)/i.test(filePath)) return filePath
  const normalized = normalizeAbsoluteFilePath({ path: filePath })
    ?? `/${normalizeSlashes(filePath).replace(/^\/+/, '')}`
  const encodePath = (value: string) => value.split('/').map(encodeURIComponent).join('/')
  const drive = /^([A-Za-z]):\/(.*)$/.exec(normalized)
  if (drive) return `file:///${drive[1]}:/${encodePath(drive[2] ?? '')}`
  if (normalized.startsWith('//')) {
    const [host = '', ...segments] = normalized.slice(2).split('/')
    return `file://${encodeURIComponent(host)}/${segments.map(encodeURIComponent).join('/')}`
  }
  return `file://${encodePath(normalized)}`
}

export function buildThreadHostFileContentUrl(_threadId: string, filePath: string) {
  return localFileUrl(filePath)
}

export function buildProjectAttachmentContentUrl(_projectId: string, filePath: string) {
  return localFileUrl(filePath)
}

export async function copyToClipboardWithToast(
  text: string,
  _options?: Record<string, unknown>,
) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export function useRewriteLocalhostLinksPreference(): readonly [boolean, (value: boolean) => void] {
  return [false, () => undefined] as const
}

export function rewriteLocalhostLinkHref({ href }: {
  currentHostname: string | undefined
  enabled: boolean
  href: string | undefined
}): string | undefined {
  return href
}

export function resolveRouteHref({ href }: { currentOrigin: string; href: string }) {
  if (!href.startsWith('/')) return null
  return { path: href }
}

export function isRoutePath({ path }: { path: string }) {
  return path.startsWith('/')
}

export function getThreadRoutePath({ threadId }: { projectId: string; threadId: string }) {
  return `/threads/${encodeURIComponent(threadId)}`
}

export function getProjectComposeRoutePath(projectId: string) {
  return `/projects/${encodeURIComponent(projectId)}`
}

export type DesktopBrowserApi = {
  onOpenTab: (callback: (event: { url: string }) => void) => () => void
}

export function getDesktopBrowserApi(): DesktopBrowserApi | null {
  return null
}

export function getThreadDisplayTitle(thread: { title?: string | null; titleFallback?: string | null }) {
  return thread.title?.trim() || thread.titleFallback?.trim() || 'Conversation'
}

export function toUserAttachmentImageSrc(pathOrUrl: string, projectId?: string) {
  return projectId
    ? buildProjectAttachmentContentUrl(projectId, pathOrUrl)
    : localFileUrl(pathOrUrl)
}

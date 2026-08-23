import { useCallback, useEffect, useState } from 'react'

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

export function resolveAbsoluteFilePath({
  path: filePath,
  rootPath,
}: AbsoluteFilePathArgs): string | null {
  if (/^(?:[A-Za-z]:[\\/]|[\\/]{2}|\/)/.test(filePath)) return filePath
  if (!rootPath) return null
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

export interface ClipboardCopyOptions {
  text: string
  successMessage?: string | null
  errorMessage?: string | null
}

function copyWithEditingCommand(text: string): boolean {
  if (
    typeof document === 'undefined'
    || document.body === null
    || typeof document.execCommand !== 'function'
  ) {
    return false
  }

  const activeElement = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) => (
        selection.getRangeAt(index).cloneRange()
      ))
    : []
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  Object.assign(textarea.style, {
    border: '0',
    height: '1px',
    left: '0',
    opacity: '0',
    padding: '0',
    pointerEvents: 'none',
    position: 'fixed',
    top: '0',
    width: '1px',
  })
  document.body.append(textarea)

  let copied = false
  try {
    textarea.focus({ preventScroll: true })
    textarea.select()
    textarea.setSelectionRange(0, textarea.value.length)
    copied = document.execCommand('copy')
  } catch {
    copied = false
  } finally {
    textarea.remove()
    if (activeElement?.isConnected) activeElement.focus({ preventScroll: true })
    if (selection) {
      selection.removeAllRanges()
      for (const range of selectedRanges) selection.addRange(range)
    }
  }
  return copied
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (
    typeof navigator !== 'undefined'
    && typeof navigator.clipboard?.writeText === 'function'
  ) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Electron or browser permissions can reject the modern API even when
      // it exists. bb falls back to the editing command in that case.
    }
  }
  return copyWithEditingCommand(text)
}

export async function copyToClipboardWithToast(
  text: string,
  _options?: Omit<ClipboardCopyOptions, 'text'>,
) {
  return copyTextToClipboard(text)
}

export function useClipboardCopy({
  text,
  successMessage = null,
  errorMessage = 'Failed to copy',
}: ClipboardCopyOptions) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeoutId = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeoutId)
  }, [copied])

  const copy = useCallback(async () => {
    if (!text || copied) return
    const success = await copyToClipboardWithToast(text, { successMessage, errorMessage })
    if (success) setCopied(true)
  }, [copied, errorMessage, successMessage, text])

  return { copied, copy }
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

export function resolveRouteHref(
  _args: { currentOrigin: string; href: string },
): { path: string } | null {
  // The embedded surface does not own bb's application router. Returning an
  // app route here would also misclassify Unix absolute paths before bb's
  // Markdown local-file resolver can hand them to Aryn's workspace bridge.
  return null
}

export function isRoutePath(_args: { path: string }) {
  return false
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

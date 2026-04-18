import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitBaselinePayload, GitRepositoryState } from '@/features/git/types'
import type { MeoSettings } from '@/hooks/use-settings-store'

type MeoEditorBootstrap = {
  extensionLabel: string
  wrapperUrl: string
}

type MeoStoredState = {
  findOptions?: {
    caseSensitive: boolean
    wholeWord: boolean
  }
  gitChangesGutter?: boolean
  gitChangesGutterConfigured?: boolean
  lineNumbers?: boolean
  mode?: 'live' | 'source'
  outlineVisible?: boolean
  topLine?: number
  topLineOffset?: number
}

type MeoResolvedLinkResult = {
  exists: boolean
  filePath?: string
  target: string
}

type MeoHostMessage =
  | { type: 'ready' }
  | {
    type: 'applyChanges'
    baseVersion: number
    changes: Array<{
      from: number
      insert: string
      to: number
    }>
  }
  | { type: 'saveDocument' }
  | { type: 'setMode', mode: 'live' | 'source' }
  | { type: 'setLineNumbers', enabled?: boolean, visible?: boolean }
  | { type: 'setGitChangesGutter', enabled?: boolean, visible?: boolean }
  | { type: 'setOutlineVisible', visible?: boolean }
  | {
    type: 'setFindOptions'
    caseSensitive?: boolean
    wholeWord?: boolean
    findOptions?: {
      caseSensitive?: boolean
      wholeWord?: boolean
    }
  }
  | { type: 'viewPositionChanged', topLine?: number, topLineOffset?: number }
  | { type: 'openLink', href?: string }
  | { type: 'openGitRevisionForLine', lineNumber?: number, text?: string }
  | { type: 'openGitWorktreeForLine', lineNumber?: number, text?: string }
  | { type: 'requestGitBlame', lineNumber?: number, localEditGeneration?: number, requestId?: string, text?: string }
  | { type: 'resolveImageSrc', requestId?: string, url?: string }
  | { type: 'resolveLocalLinks', requestId?: string, targets?: unknown[] }
  | { type: 'resolveWikiLinks', requestId?: string, targets?: unknown[] }
  | { type: 'saveImageFromClipboard', requestId?: string, fileName?: string, imageData?: string }
  | {
    type: string
    [key: string]: unknown
  }

type MeoEditorHostProps = {
  filePath: string
  gitRepositoryState?: GitRepositoryState | null
  meoSettings: MeoSettings
  onCompositionChange?: (isComposing: boolean) => void
  onOpenFile?: (filePath: string) => void
  onOpenGitDiff?: (
    filePath: string,
    options?: {
      lineNumber?: number
      source: 'revision' | 'worktree'
    },
  ) => void
  onSave?: (nextValue: string) => void
  onChange: (nextValue: string) => void
  theme?: 'light' | 'dark' | 'auto'
  value: string
  workspacePath?: string | null
}

type ParsedFsPath = {
  root: string
  segments: string[]
  windowsLike: boolean
}

const MEO_STATE_STORAGE_PREFIX = 'aryn:meo-state:'
const MEO_HOST_CHANNEL_KEY = '__arynMeoChannel'
const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx', '.mdc']
const DEFAULT_FIND_OPTIONS = {
  caseSensitive: false,
  wholeWord: false,
} as const

function createMeoChannelId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `meo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function postMessageToMeoIframe(iframeWindow: Window, channelId: string, payload: Record<string, unknown>) {
  iframeWindow.postMessage({
    [MEO_HOST_CHANNEL_KEY]: channelId,
    ...payload,
  }, '*')
}

function getGitStateRefreshKey(repositoryState: GitRepositoryState | null | undefined) {
  if (!repositoryState) {
    return 'no-state'
  }

  return JSON.stringify({
    ahead: repositoryState.ahead,
    behind: repositoryState.behind,
    branch: repositoryState.branch,
    hasChanges: repositoryState.hasChanges,
    hasCommits: repositoryState.hasCommits,
    isRepository: repositoryState.isRepository,
    repositoryRootPath: repositoryState.repositoryRootPath,
    stagedChanges: repositoryState.stagedChanges.map((change) => ({
      kind: change.kind,
      path: change.path,
      scope: change.scope,
      statusCode: change.statusCode,
    })),
    unstagedChanges: repositoryState.unstagedChanges.map((change) => ({
      kind: change.kind,
      path: change.path,
      scope: change.scope,
      statusCode: change.statusCode,
    })),
  })
}

function resolvePreferredTheme(theme: 'light' | 'dark' | 'auto') {
  if (theme !== 'auto') {
    return theme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function buildIframeSource(wrapperUrl: string, theme: 'light' | 'dark', channelId: string) {
  const url = new URL(wrapperUrl)
  url.searchParams.set('channel', channelId)
  url.searchParams.set('theme', theme)
  return url.toString()
}

function postGitBaselineChanged(iframeWindow: Window, channelId: string, payload: GitBaselinePayload) {
  postMessageToMeoIframe(iframeWindow, channelId, {
    payload,
    type: 'gitBaselineChanged',
    version: undefined,
  })
}

function postThemeChanged(iframeWindow: Window, channelId: string, theme: 'light' | 'dark') {
  postMessageToMeoIframe(iframeWindow, channelId, {
    theme: undefined,
    themeKind: theme,
    type: 'themeChanged',
  })
}

function getIframeOrigin(wrapperUrl: string) {
  try {
    return new URL(wrapperUrl).origin
  } catch {
    return null
  }
}

function countTextLines(value: string) {
  if (!value) {
    return 1
  }

  return value.split(/\r\n|\r|\n/).length
}

function shouldRememberViewPosition(content: string, rememberPositionLines: number) {
  if (rememberPositionLines <= 0) {
    return true
  }

  return countTextLines(content) >= rememberPositionLines
}

function applyTextChanges(
  content: string,
  changes: Array<{
    from: number
    insert: string
    to: number
  }>,
) {
  let nextContent = content
  const sortedChanges = [...changes].sort((left, right) => right.from - left.from)

  for (const change of sortedChanges) {
    nextContent = `${nextContent.slice(0, change.from)}${change.insert}${nextContent.slice(change.to)}`
  }

  return nextContent
}

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

function resolveImageUrl(filePath: string, target: string) {
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

function getRelativeFsPath(fromFilePath: string, toFilePath: string) {
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

function isExternalHref(href: string) {
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

    const { exists } = await window.appApi.workspaceFileExists(workspacePath, candidatePath)
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

function getStoredStateKey(filePath: string) {
  return `${MEO_STATE_STORAGE_PREFIX}${encodeURIComponent(filePath)}`
}

function resolveFindOptions(
  value: unknown,
) {
  const candidate = value && typeof value === 'object'
    ? value as { caseSensitive?: unknown, wholeWord?: unknown }
    : null

  return {
    caseSensitive: candidate?.caseSensitive === true,
    wholeWord: candidate?.wholeWord === true,
  }
}

function resolveOptionalBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function resolveGitChangesGutterEnabled(storedState: MeoStoredState) {
  if (storedState.gitChangesGutterConfigured === true && typeof storedState.gitChangesGutter === 'boolean') {
    return storedState.gitChangesGutter
  }

  return true
}

function readStoredState(filePath: string): MeoStoredState {
  try {
    const rawValue = window.localStorage.getItem(getStoredStateKey(filePath))
    if (!rawValue) {
      return {}
    }

    const parsedValue = JSON.parse(rawValue) as Partial<MeoStoredState>

    return {
      findOptions: resolveFindOptions(parsedValue.findOptions),
      gitChangesGutter: resolveOptionalBoolean(parsedValue.gitChangesGutter),
      gitChangesGutterConfigured: resolveOptionalBoolean(parsedValue.gitChangesGutterConfigured),
      lineNumbers: parsedValue.lineNumbers !== false,
      mode: parsedValue.mode === 'live' || parsedValue.mode === 'source' ? parsedValue.mode : undefined,
      outlineVisible: parsedValue.outlineVisible === true,
      topLine: typeof parsedValue.topLine === 'number' && Number.isFinite(parsedValue.topLine)
        ? parsedValue.topLine
        : undefined,
      topLineOffset: typeof parsedValue.topLineOffset === 'number' && Number.isFinite(parsedValue.topLineOffset)
        ? parsedValue.topLineOffset
        : undefined,
    }
  } catch {
    return {}
  }
}

function writeStoredState(filePath: string, patch: Partial<MeoStoredState>) {
  const nextState = {
    ...readStoredState(filePath),
    ...patch,
  }

  window.localStorage.setItem(getStoredStateKey(filePath), JSON.stringify(nextState))
  return nextState
}

async function resolveLocalLinkResults(
  filePath: string,
  workspacePath: string | null | undefined,
  targets: unknown[],
) {
  const results: MeoResolvedLinkResult[] = []

  for (const target of targets) {
    if (typeof target !== 'string') {
      results.push({ exists: false, target: '' })
      continue
    }

    results.push(await resolveLinkTarget(filePath, workspacePath, target, MARKDOWN_EXTENSIONS))
  }

  return results
}

async function resolveWikiLinkResults(
  filePath: string,
  workspacePath: string | null | undefined,
  targets: unknown[],
) {
  const results: MeoResolvedLinkResult[] = []

  for (const target of targets) {
    if (typeof target !== 'string') {
      results.push({ exists: false, target: '' })
      continue
    }

    results.push(await resolveLinkTarget(filePath, workspacePath, target, MARKDOWN_EXTENSIONS))
  }

  return results
}

async function resolveOpenLinkFilePath(
  filePath: string,
  workspacePath: string | null | undefined,
  href: string,
) {
  if (/^meo-wiki:/i.test(href)) {
    const wikiTarget = href.replace(/^meo-wiki:/i, '')
    return resolveLinkTarget(filePath, workspacePath, wikiTarget, MARKDOWN_EXTENSIONS)
  }

  return resolveLinkTarget(filePath, workspacePath, href, MARKDOWN_EXTENSIONS)
}

export function MeoEditorHost({
  filePath,
  gitRepositoryState,
  meoSettings,
  onCompositionChange,
  onOpenFile,
  onOpenGitDiff,
  onSave,
  onChange,
  theme = 'auto',
  value,
  workspacePath,
}: MeoEditorHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const contentRef = useRef(value)
  const versionRef = useRef(1)
  const modeRef = useRef<'live' | 'source'>(readStoredState(filePath).mode ?? 'source')
  const gitBaselineRequestRef = useRef(0)
  const channelIdRef = useRef(createMeoChannelId())
  const [bootstrap, setBootstrap] = useState<MeoEditorBootstrap | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>('Loading MEO bootstrap...')
  const [isReady, setIsReady] = useState(false)
  const [iframeSource, setIframeSource] = useState<string | null>(null)
  const preferredTheme = useMemo(() => resolvePreferredTheme(theme), [theme])
  const gitStateRefreshKey = useMemo(() => getGitStateRefreshKey(gitRepositoryState), [gitRepositoryState])
  const iframeOrigin = useMemo(() => (
    bootstrap ? getIframeOrigin(bootstrap.wrapperUrl) : null
  ), [bootstrap])

  useEffect(() => {
    const storedState = readStoredState(filePath)
    modeRef.current = storedState.mode ?? 'source'
  }, [filePath])

  useEffect(() => {
    let disposed = false

    void window.appApi.getMeoEditorBootstrap()
      .then((nextBootstrap) => {
        if (disposed) {
          return
        }

        setBootstrap(nextBootstrap)
        setErrorMessage(null)
      })
      .catch((error) => {
        if (disposed) {
          return
        }

        const message = error instanceof Error ? error.message : 'Unable to load Markdown Editor Optimized.'
        setErrorMessage(message)
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    if (!bootstrap) {
      setIframeSource(null)
      return
    }

    // Keep the iframe URL stable after mount so theme changes flow through postMessage
    // instead of forcing a full MEO reload.
    setIframeSource(buildIframeSource(bootstrap.wrapperUrl, preferredTheme, channelIdRef.current))
  }, [bootstrap])

  useEffect(() => {
    setIsReady(false)
    setStatusMessage('Loading MEO iframe...')
  }, [iframeSource])

  useEffect(() => {
    if (!isReady) {
      return
    }

    const iframeWindow = iframeRef.current?.contentWindow
    if (!iframeWindow) {
      return
    }

    postThemeChanged(iframeWindow, channelIdRef.current, preferredTheme)
  }, [isReady, preferredTheme])

  useEffect(() => {
    if (!isReady) {
      return
    }

    const iframeWindow = iframeRef.current?.contentWindow
    if (!iframeWindow) {
      return
    }

    postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
      enabled: meoSettings.gitDiffLineHighlights,
      type: 'gitDiffLineHighlightsChanged',
    })
  }, [isReady, meoSettings.gitDiffLineHighlights])

  useEffect(() => {
    if (!isReady) {
      return
    }

    const iframeWindow = iframeRef.current?.contentWindow
    if (!iframeWindow) {
      return
    }

    postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
      position: meoSettings.outlinePosition,
      type: 'outlinePositionChanged',
    })
  }, [isReady, meoSettings.outlinePosition])

  useEffect(() => {
    if (!isReady) {
      return
    }

    const iframeWindow = iframeRef.current?.contentWindow
    if (!iframeWindow) {
      return
    }

    const requestId = gitBaselineRequestRef.current + 1
    gitBaselineRequestRef.current = requestId

    if (!workspacePath) {
      postGitBaselineChanged(iframeWindow, channelIdRef.current, {
        available: false,
        baseText: null,
        gitPath: null,
        headOid: null,
        reason: 'not-repo',
        repoRoot: null,
        tracked: false,
      })
      return
    }

    void window.appApi.getGitBaseline(workspacePath, filePath)
      .then((baseline) => {
        if (gitBaselineRequestRef.current !== requestId) {
          return
        }

        const currentIframeWindow = iframeRef.current?.contentWindow
        if (!currentIframeWindow) {
          return
        }

        postGitBaselineChanged(currentIframeWindow, channelIdRef.current, baseline)
      })
      .catch(() => {
        if (gitBaselineRequestRef.current !== requestId) {
          return
        }

        const currentIframeWindow = iframeRef.current?.contentWindow
        if (!currentIframeWindow) {
          return
        }

        postGitBaselineChanged(currentIframeWindow, channelIdRef.current, {
          available: false,
          baseText: null,
          gitPath: null,
          headOid: null,
          reason: 'error',
          repoRoot: null,
          tracked: false,
        })
      })
  }, [filePath, gitStateRefreshKey, isReady, workspacePath])

  useEffect(() => {
    onCompositionChange?.(false)

    return () => {
      onCompositionChange?.(false)
    }
  }, [onCompositionChange])

  useEffect(() => {
    if (!isReady) {
      contentRef.current = value
      return
    }

    if (value === contentRef.current) {
      return
    }

    const iframeWindow = iframeRef.current?.contentWindow
    if (!iframeWindow) {
      return
    }

    contentRef.current = value
    versionRef.current += 1
    postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
      text: value,
      type: 'docChanged',
      version: versionRef.current,
    })
  }, [isReady, value])

  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const message = event.data
      if (!message || typeof message !== 'object' || !('__arynMeo' in message)) {
        return
      }

      const { channel, payload } = message as {
        __arynMeo: boolean
        channel?: unknown
        payload?: MeoHostMessage
      }

      if (typeof channel !== 'string' || channel !== channelIdRef.current) {
        return
      }

      if (iframeOrigin && event.origin !== iframeOrigin) {
        return
      }

      if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
        return
      }

      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow) {
        return
      }

      switch (payload.type) {
        case 'ready': {
          const storedState = readStoredState(filePath)
          const gitChangesGutter = resolveGitChangesGutterEnabled(storedState)
          const restoreViewPosition = shouldRememberViewPosition(
            contentRef.current,
            meoSettings.rememberPositionLines,
          )

          setIsReady(true)
          setStatusMessage(null)
          postThemeChanged(iframeWindow, channelIdRef.current, preferredTheme)
          postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
            findOptions: storedState.findOptions ?? DEFAULT_FIND_OPTIONS,
            gitChangesGutter,
            gitDiffLineHighlights: meoSettings.gitDiffLineHighlights,
            lineNumbers: storedState.lineNumbers ?? true,
            mode: modeRef.current,
            outlinePosition: meoSettings.outlinePosition,
            outlineVisible: storedState.outlineVisible ?? false,
            restoreTopLine: restoreViewPosition ? storedState.topLine : undefined,
            restoreTopLineOffset: restoreViewPosition ? storedState.topLineOffset : undefined,
            text: contentRef.current,
            theme: undefined,
            themeKind: preferredTheme,
            type: 'init',
            version: versionRef.current,
            vimMode: false,
          })
          postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
            enabled: gitChangesGutter,
            type: 'gitChangesGutterChanged',
          })
          return
        }

        case 'applyChanges': {
          if (!Array.isArray(payload.changes)) {
            return
          }

          if (payload.baseVersion !== versionRef.current) {
            postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
              text: contentRef.current,
              type: 'docChanged',
              version: versionRef.current,
            })
            return
          }

          const nextContent = applyTextChanges(contentRef.current, payload.changes)
          contentRef.current = nextContent
          versionRef.current += 1
          onChange(nextContent)
          postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
            type: 'applied',
            version: versionRef.current,
          })
          return
        }

        case 'saveDocument': {
          onSave?.(contentRef.current)
          return
        }

        case 'setMode': {
          if (payload.mode === 'live' || payload.mode === 'source') {
            modeRef.current = payload.mode
            writeStoredState(filePath, { mode: payload.mode })
          }
          return
        }

        case 'setLineNumbers': {
          const lineNumbers = payload.visible ?? payload.enabled
          if (typeof lineNumbers === 'boolean') {
            writeStoredState(filePath, { lineNumbers })
          }
          return
        }

        case 'setGitChangesGutter': {
          const gitChangesGutter = payload.visible ?? payload.enabled
          if (typeof gitChangesGutter === 'boolean') {
            writeStoredState(filePath, {
              gitChangesGutter,
              gitChangesGutterConfigured: true,
            })
          }
          return
        }

        case 'setOutlineVisible': {
          if (typeof payload.visible === 'boolean') {
            writeStoredState(filePath, { outlineVisible: payload.visible })
          }
          return
        }

        case 'setFindOptions': {
          writeStoredState(filePath, {
            findOptions: resolveFindOptions(payload.findOptions ?? {
              caseSensitive: payload.caseSensitive,
              wholeWord: payload.wholeWord,
            }),
          })
          return
        }

        case 'viewPositionChanged': {
          const shouldPersistViewPosition = shouldRememberViewPosition(
            contentRef.current,
            meoSettings.rememberPositionLines,
          )
          writeStoredState(filePath, {
            topLine: shouldPersistViewPosition && typeof payload.topLine === 'number'
              ? payload.topLine
              : undefined,
            topLineOffset: shouldPersistViewPosition && typeof payload.topLineOffset === 'number'
              ? payload.topLineOffset
              : undefined,
          })
          return
        }

        case 'openLink': {
          if (typeof payload.href !== 'string' || !payload.href.trim()) {
            return
          }

          const href = payload.href
          if (href.startsWith('#')) {
            return
          }

          if (isExternalHref(href)) {
            window.open(href, '_blank', 'noopener,noreferrer')
            return
          }

          void resolveOpenLinkFilePath(filePath, workspacePath, href)
            .then((result) => {
              if (result.exists && result.filePath) {
                onOpenFile?.(result.filePath)
              }
            })
          return
        }

        case 'openGitRevisionForLine':
        case 'openGitWorktreeForLine': {
          onOpenGitDiff?.(filePath, {
            lineNumber: typeof payload.lineNumber === 'number' ? payload.lineNumber : undefined,
            source: payload.type === 'openGitRevisionForLine' ? 'revision' : 'worktree',
          })
          return
        }

        case 'requestGitBlame': {
          void (async () => {
            if (!workspacePath) {
              postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
                lineNumber: payload.lineNumber,
                localEditGeneration: payload.localEditGeneration,
                requestId: payload.requestId,
                result: { kind: 'unavailable', reason: 'not-repo' },
                type: 'gitBlameResult',
              })
              return
            }

            const result = await window.appApi.getGitLineBlame(
              workspacePath,
              filePath,
              typeof payload.lineNumber === 'number' ? payload.lineNumber : 1,
              typeof payload.text === 'string' ? payload.text : undefined,
            )

            postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
              lineNumber: payload.lineNumber,
              localEditGeneration: payload.localEditGeneration,
              requestId: payload.requestId,
              result,
              type: 'gitBlameResult',
            })
          })()
          return
        }

        case 'resolveImageSrc': {
          postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
            requestId: payload.requestId,
            resolvedUrl: typeof payload.url === 'string' ? resolveImageUrl(filePath, payload.url) : '',
            type: 'resolvedImageSrc',
          })
          return
        }

        case 'resolveLocalLinks': {
          void resolveLocalLinkResults(filePath, workspacePath, Array.isArray(payload.targets) ? payload.targets : [])
            .then((results) => {
              postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
                requestId: payload.requestId,
                results: results.map(({ exists, target }) => ({ exists, target })),
                type: 'resolvedLocalLinks',
              })
            })
          return
        }

        case 'resolveWikiLinks': {
          void resolveWikiLinkResults(filePath, workspacePath, Array.isArray(payload.targets) ? payload.targets : [])
            .then((results) => {
              postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
                requestId: payload.requestId,
                results: results.map(({ exists, target }) => ({ exists, target })),
                type: 'resolvedWikiLinks',
              })
            })
          return
        }

        case 'saveImageFromClipboard': {
          void (async () => {
            if (!workspacePath) {
              postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
                error: 'No workspace folder is open.',
                requestId: payload.requestId,
                success: false,
                type: 'savedImagePath',
              })
              return
            }

            try {
              const { filePath: savedImagePath } = await window.appApi.saveWorkspaceImage(
                workspacePath,
                meoSettings.imageFolder,
                typeof payload.fileName === 'string' ? payload.fileName : 'pasted-image.png',
                typeof payload.imageData === 'string' ? payload.imageData : '',
              )

              postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
                path: getRelativeFsPath(filePath, savedImagePath),
                requestId: payload.requestId,
                success: true,
                type: 'savedImagePath',
              })
            } catch (error) {
              postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
                error: error instanceof Error ? error.message : 'Failed to save image.',
                requestId: payload.requestId,
                success: false,
                type: 'savedImagePath',
              })
            }
          })()
          return
        }

        default:
          return
      }
    }

    window.addEventListener('message', handleWindowMessage)

    return () => {
      window.removeEventListener('message', handleWindowMessage)
    }
  }, [filePath, iframeOrigin, meoSettings.gitDiffLineHighlights, meoSettings.imageFolder, meoSettings.outlinePosition, meoSettings.rememberPositionLines, onChange, onOpenFile, onOpenGitDiff, onSave, preferredTheme, workspacePath])

  if (errorMessage) {
    return (
      <div className='meo-editor-error'>
        <strong>Markdown Editor Optimized failed to load.</strong>
        <span>{errorMessage}</span>
      </div>
    )
  }

  if (!iframeSource) {
    return <div className='meo-editor-loading'>{statusMessage}</div>
  }

  return (
    <div className='meo-editor-shell'>
      {statusMessage ? <div className='meo-editor-loading'>{statusMessage}</div> : null}
      <iframe
        ref={iframeRef}
        className='meo-editor-frame'
        sandbox='allow-same-origin allow-scripts'
        src={iframeSource}
        title={bootstrap?.extensionLabel ?? 'Markdown Editor Optimized'}
        onLoad={() => {
          setStatusMessage('Waiting for MEO webview...')
        }}
      />
    </div>
  )
}

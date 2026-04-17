import { useEffect, useMemo, useRef, useState } from 'react'

type MeoEditorBootstrap = {
  extensionLabel: string
  wrapperUrl: string
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
  | { type: 'openLink', href?: string }
  | { type: 'requestGitBlame', lineNumber?: number, localEditGeneration?: number, requestId?: string }
  | { type: 'resolveImageSrc', requestId?: string, url?: string }
  | { type: 'resolveLocalLinks', requestId?: string, targets?: unknown[] }
  | { type: 'resolveWikiLinks', requestId?: string, targets?: unknown[] }
  | {
    type: string
    [key: string]: unknown
  }

type MeoEditorHostProps = {
  filePath: string
  onCompositionChange?: (isComposing: boolean) => void
  onSave?: (nextValue: string) => void
  onChange: (nextValue: string) => void
  theme?: 'light' | 'dark' | 'auto'
  value: string
}

function resolvePreferredTheme(theme: 'light' | 'dark' | 'auto') {
  if (theme !== 'auto') {
    return theme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function buildIframeSource(wrapperUrl: string, theme: 'light' | 'dark') {
  const url = new URL(wrapperUrl)
  url.searchParams.set('theme', theme)
  return url.toString()
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

export function MeoEditorHost({
  filePath,
  onCompositionChange,
  onSave,
  onChange,
  theme = 'auto',
  value,
}: MeoEditorHostProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const contentRef = useRef(value)
  const versionRef = useRef(1)
  const modeRef = useRef<'live' | 'source'>('source')
  const [bootstrap, setBootstrap] = useState<MeoEditorBootstrap | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>('Loading MEO bootstrap...')
  const [isReady, setIsReady] = useState(false)
  const preferredTheme = useMemo(() => resolvePreferredTheme(theme), [theme])
  const iframeSource = useMemo(() => (
    bootstrap ? buildIframeSource(bootstrap.wrapperUrl, preferredTheme) : null
  ), [bootstrap, preferredTheme])

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
    setIsReady(false)
    setStatusMessage('Loading MEO iframe...')
  }, [iframeSource])

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
    iframeWindow.postMessage({
      text: value,
      type: 'docChanged',
      version: versionRef.current,
    }, '*')
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

      const payload = (message as { __arynMeo: boolean, payload?: MeoHostMessage }).payload
      if (!payload || typeof payload !== 'object' || typeof payload.type !== 'string') {
        return
      }

      const iframeWindow = iframeRef.current?.contentWindow
      if (!iframeWindow) {
        return
      }

      switch (payload.type) {
        case 'ready': {
          setIsReady(true)
          setStatusMessage(null)
          iframeWindow.postMessage({
            findOptions: {
              caseSensitive: false,
              wholeWord: false,
            },
            gitChangesGutter: false,
            gitDiffLineHighlights: false,
            lineNumbers: true,
            mode: modeRef.current,
            outlinePosition: 'right',
            outlineVisible: false,
            text: contentRef.current,
            theme: undefined,
            type: 'init',
            version: versionRef.current,
            vimMode: false,
          }, '*')
          return
        }

        case 'applyChanges': {
          if (!Array.isArray(payload.changes)) {
            return
          }

          if (payload.baseVersion !== versionRef.current) {
            iframeWindow.postMessage({
              text: contentRef.current,
              type: 'docChanged',
              version: versionRef.current,
            }, '*')
            return
          }

          const nextContent = applyTextChanges(contentRef.current, payload.changes)
          contentRef.current = nextContent
          versionRef.current += 1
          onChange(nextContent)
          iframeWindow.postMessage({
            type: 'applied',
            version: versionRef.current,
          }, '*')
          return
        }

        case 'saveDocument': {
          onSave?.(contentRef.current)
          return
        }

        case 'setMode': {
          if (payload.mode === 'live' || payload.mode === 'source') {
            modeRef.current = payload.mode
          }
          return
        }

        case 'openLink': {
          if (typeof payload.href === 'string' && payload.href.trim()) {
            window.open(payload.href, '_blank', 'noopener,noreferrer')
          }
          return
        }

        case 'requestGitBlame': {
          iframeWindow.postMessage({
            lineNumber: payload.lineNumber,
            localEditGeneration: payload.localEditGeneration,
            requestId: payload.requestId,
            result: { kind: 'unavailable', reason: 'error' },
            type: 'gitBlameResult',
          }, '*')
          return
        }

        case 'resolveImageSrc': {
          iframeWindow.postMessage({
            requestId: payload.requestId,
            resolvedUrl: typeof payload.url === 'string' ? resolveImageUrl(filePath, payload.url) : '',
            type: 'resolvedImageSrc',
          }, '*')
          return
        }

        case 'resolveLocalLinks': {
          iframeWindow.postMessage({
            requestId: payload.requestId,
            results: [],
            type: 'resolvedLocalLinks',
          }, '*')
          return
        }

        case 'resolveWikiLinks': {
          iframeWindow.postMessage({
            requestId: payload.requestId,
            results: [],
            type: 'resolvedWikiLinks',
          }, '*')
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
  }, [filePath, onChange, onSave])

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
        src={iframeSource}
        title={bootstrap?.extensionLabel ?? 'Markdown Editor Optimized'}
        onLoad={() => {
          setStatusMessage('Waiting for MEO webview...')
        }}
      />
    </div>
  )
}

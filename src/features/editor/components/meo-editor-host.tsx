import { useEffect, useMemo, useRef, useState } from 'react'
import type { GitRepositoryState } from '@/features/git/types'
import type { MeoSettings } from '@/hooks/use-settings-store'
import { createDefaultMeoHostEnvironment } from '@/features/editor/lib/meo-host-environment'
import type { MeoEditorBootstrap } from '@/features/editor/lib/meo-protocol'
import {
  getGitStateRefreshKey,
  getUnavailableGitBaseline,
  handleMeoHostPayload,
  postGitBaselineChanged,
  postMessageToMeoIframe,
  postThemeChanged,
  resolveMeoHostMessageFromEvent,
} from '@/features/editor/lib/meo-host-bridge'
import {
  buildMeoIframeSource,
  createMeoChannelId,
  getMeoIframeOrigin,
} from '@/features/editor/lib/meo-transport'
import { readStoredState } from '@/features/editor/lib/meo-state'

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

function resolvePreferredTheme(theme: 'light' | 'dark' | 'auto') {
  if (theme !== 'auto') {
    return theme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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
  const isComposingRef = useRef(false)
  const pendingExternalValueRef = useRef<string | null>(null)
  const modeRef = useRef<'live' | 'source'>(readStoredState(filePath).mode ?? 'source')
  const gitBaselineRequestRef = useRef(0)
  const channelIdRef = useRef(createMeoChannelId())
  const [bootstrap, setBootstrap] = useState<MeoEditorBootstrap | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>('Loading MEO bootstrap...')
  const [isReady, setIsReady] = useState(false)
  const [iframeSource, setIframeSource] = useState<string | null>(null)
  const environment = useMemo(() => createDefaultMeoHostEnvironment(), [])
  const preferredTheme = useMemo(() => resolvePreferredTheme(theme), [theme])
  const gitStateRefreshKey = useMemo(() => getGitStateRefreshKey(gitRepositoryState), [gitRepositoryState])
  const iframeOrigin = useMemo(() => (
    bootstrap ? getMeoIframeOrigin(bootstrap.wrapperUrl) : null
  ), [bootstrap])

  function syncDocumentToIframe(iframeWindow: Window, nextValue: string) {
    contentRef.current = nextValue
    versionRef.current += 1
    postMessageToMeoIframe(iframeWindow, channelIdRef.current, {
      text: nextValue,
      type: 'docChanged',
      version: versionRef.current,
    })
  }

  useEffect(() => {
    const storedState = readStoredState(filePath)
    modeRef.current = storedState.mode ?? 'source'
  }, [filePath])

  useEffect(() => {
    let disposed = false

    void environment.appApi.getMeoEditorBootstrap()
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
  }, [environment])

  useEffect(() => {
    if (!bootstrap) {
      setIframeSource(null)
      return
    }

    // Keep the iframe URL stable after mount so theme changes flow through postMessage
    // instead of forcing a full MEO reload.
    setIframeSource(buildMeoIframeSource(bootstrap.wrapperUrl, {
      channelId: channelIdRef.current,
      parentOrigin: window.location.origin,
      theme: preferredTheme,
    }))
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
      postGitBaselineChanged(
        iframeWindow,
        channelIdRef.current,
        getUnavailableGitBaseline('not-repo'),
      )
      return
    }

    void environment.appApi.getGitBaseline(workspacePath, filePath)
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

        postGitBaselineChanged(
          currentIframeWindow,
          channelIdRef.current,
          getUnavailableGitBaseline('error'),
        )
      })
  }, [environment, filePath, gitStateRefreshKey, isReady, workspacePath])

  useEffect(() => {
    onCompositionChange?.(false)
    isComposingRef.current = false
    pendingExternalValueRef.current = null

    return () => {
      isComposingRef.current = false
      pendingExternalValueRef.current = null
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

    if (isComposingRef.current) {
      pendingExternalValueRef.current = value
      return
    }

    pendingExternalValueRef.current = null
    syncDocumentToIframe(iframeWindow, value)
  }, [isReady, value])

  useEffect(() => {
    const handleWindowMessage = (event: MessageEvent<unknown>) => {
      const iframeWindow = iframeRef.current?.contentWindow
      const payload = resolveMeoHostMessageFromEvent(event, {
        channelId: channelIdRef.current,
        iframeOrigin,
        iframeWindow,
      })

      if (!payload || !iframeWindow) {
        return
      }

      if (payload.type === 'compositionChanged') {
        const nextIsComposing = payload.isComposing === true

        if (isComposingRef.current !== nextIsComposing) {
          isComposingRef.current = nextIsComposing
          onCompositionChange?.(nextIsComposing)
        }

        if (!nextIsComposing) {
          const pendingExternalValue = pendingExternalValueRef.current
          pendingExternalValueRef.current = null

          if (
            typeof pendingExternalValue === 'string'
            && pendingExternalValue !== contentRef.current
          ) {
            syncDocumentToIframe(iframeWindow, pendingExternalValue)
          }
        }

        return
      }

      handleMeoHostPayload({
        channelId: channelIdRef.current,
        environment,
        filePath,
        iframeWindow,
        meoSettings,
        modeRef,
        onChange,
        onOpenFile,
        onOpenGitDiff,
        onSave,
        payload,
        preferredTheme,
        setIsReady,
        setStatusMessage,
        valueRef: contentRef,
        versionRef,
        workspacePath,
      })
    }

    window.addEventListener('message', handleWindowMessage)

    return () => {
      window.removeEventListener('message', handleWindowMessage)
    }
  }, [environment, filePath, iframeOrigin, meoSettings.gitDiffLineHighlights, meoSettings.imageFolder, meoSettings.outlinePosition, meoSettings.rememberPositionLines, onChange, onOpenFile, onOpenGitDiff, onSave, preferredTheme, workspacePath])

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

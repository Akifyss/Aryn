import { memo, useEffect, useRef, useState } from 'react'
import type {
  OpenCodeOptimisticUserMessage,
  OpenCodeSessionSurface,
  OpenCodeSessionSurfaceOptions,
  OpenCodeSurfaceEvent,
} from '@aryn/opencode-session-surface'

type OpenCodeSurfaceModule = typeof import('@aryn/opencode-session-surface')

let surfaceModulePromise: Promise<OpenCodeSurfaceModule> | null = null
let surfaceStylesPromise: Promise<void> | null = null

function loadSurfaceModule() {
  if (!surfaceModulePromise) {
    const moduleUrl = new URL('./opencode-session-surface/index.js', document.baseURI).href
    surfaceModulePromise = (import(/* @vite-ignore */ moduleUrl) as Promise<OpenCodeSurfaceModule>)
      .catch((error) => {
        surfaceModulePromise = null
        throw error
      })
  }
  return surfaceModulePromise
}

function ensureSurfaceStyles() {
  const id = 'aryn-opencode-session-surface-styles'
  const href = new URL('./opencode-session-surface/style.css', document.baseURI).href
  const current = document.getElementById(id)
  if (
    surfaceStylesPromise
    && current instanceof HTMLLinkElement
    && current.href === href
  ) return surfaceStylesPromise
  surfaceStylesPromise = null
  let existing = current
  if (current instanceof HTMLLinkElement && current.href !== href) {
    current.remove()
    existing = null
  }
  if (existing instanceof HTMLLinkElement && existing.sheet) return Promise.resolve()
  if (existing && !(existing instanceof HTMLLinkElement)) existing.remove()
  const link = existing instanceof HTMLLinkElement ? existing : document.createElement('link')
  const shouldAppend = !(existing instanceof HTMLLinkElement)
  if (shouldAppend) {
    link.id = id
    link.rel = 'stylesheet'
    link.href = href
  }
  surfaceStylesPromise = new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      link.removeEventListener('load', handleLoad)
      link.removeEventListener('error', handleError)
    }
    const handleLoad = () => {
      cleanup()
      resolve()
    }
    const handleError = () => {
      cleanup()
      link.remove()
      surfaceStylesPromise = null
      reject(new Error('OpenCode 消息样式加载失败。'))
    }
    link.addEventListener('load', handleLoad, { once: true })
    link.addEventListener('error', handleError, { once: true })
    if (shouldAppend) document.head.append(link)
  })
  return surfaceStylesPromise
}

type OpenCodeSessionTimelineProps = {
  onNavigateToSession?: (sessionID: string) => void
  onOpenWorkspaceFile?: (filePath: string) => void
  optimisticUserMessages?: OpenCodeOptimisticUserMessage[]
  sessionID: string
  workspacePath: string
}

export const OpenCodeSessionTimeline = memo(function OpenCodeSessionTimeline({
  onNavigateToSession,
  onOpenWorkspaceFile,
  optimisticUserMessages = [],
  sessionID,
  workspacePath,
}: OpenCodeSessionTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onNavigateToSessionRef = useRef(onNavigateToSession)
  const onOpenWorkspaceFileRef = useRef(onOpenWorkspaceFile)
  const optimisticUserMessagesRef = useRef(optimisticUserMessages)
  const surfaceRef = useRef<OpenCodeSessionSurface | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    onNavigateToSessionRef.current = onNavigateToSession
    onOpenWorkspaceFileRef.current = onOpenWorkspaceFile
  }, [onNavigateToSession, onOpenWorkspaceFile])

  useEffect(() => {
    optimisticUserMessagesRef.current = optimisticUserMessages
    surfaceRef.current?.setOptimisticUserMessages(optimisticUserMessages)
  }, [optimisticUserMessages])

  // The official surface owns live session state. Only a native session identity
  // change may dispose it; unrelated React renders must keep that state intact.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let surface: OpenCodeSessionSurface | null = null

    const bridge: OpenCodeSessionSurfaceOptions['bridge'] = {
      request: (rootPath, request) => window.appApi.requestOpenCodeSurface({
        agentId: 'opencode',
        sessionPath: 'sessionID' in request ? request.sessionID : sessionID,
        workspacePath: rootPath,
      }, request),
      subscribe: (listener) => window.appApi.onAgentEvent((event) => {
        if (event.agentId !== 'opencode') return
        if (event.type === 'opencode_native_event') {
          listener({ event: event.event, type: 'event', workspacePath: event.workspacePath } satisfies OpenCodeSurfaceEvent)
          return
        }
        if (event.type === 'opencode_surface_refresh') {
          listener({
            sessionID: event.sessionId,
            type: 'refresh',
            workspacePath: event.workspacePath,
          } satisfies OpenCodeSurfaceEvent)
        }
      }),
      openExternal: (href) => window.appApi.openExternalLink(href),
      openWorkspaceFile: (filePath) => onOpenWorkspaceFileRef.current?.(filePath),
    }

    void Promise.all([ensureSurfaceStyles(), loadSurfaceModule()]).then(([, module]) => {
      if (cancelled) return
      setLoadError(null)
      surface = module.mountOpenCodeSessionSurface(container, {
        bridge,
        locale: 'zh-CN',
        onNavigateToSession: (nativeSessionID) => onNavigateToSessionRef.current?.(nativeSessionID),
        sessionID,
        workspacePath,
      })
      surfaceRef.current = surface
      surface.setOptimisticUserMessages(optimisticUserMessagesRef.current)
    }).catch((cause) => {
      if (cancelled) return
      setLoadError(cause instanceof Error ? cause.message : String(cause))
    })

    return () => {
      cancelled = true
      if (surfaceRef.current === surface) surfaceRef.current = null
      surface?.dispose()
      container.replaceChildren()
    }
  }, [loadRevision, sessionID, workspacePath])

  return (
    <div className='opencode-session-surface-host'>
      {loadError ? (
        <div className='agent-status-inline is-error' role='alert'>
          <p>{loadError}</p>
          <button className='agent-status-action' type='button' onClick={() => setLoadRevision((value) => value + 1)}>
            重新加载消息
          </button>
        </div>
      ) : null}
      <div ref={containerRef} data-opencode-session-id={sessionID} />
    </div>
  )
})

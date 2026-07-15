import { memo, useEffect, useRef, useState } from 'react'
import type {
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
  PiWebSessionSurface,
  PiWebSessionSurfaceOptions,
  PiWebSurfaceEvent,
} from '@aryn/pi-web-session-surface'

type PiWebSurfaceModule = typeof import('@aryn/pi-web-session-surface')

let surfaceModulePromise: Promise<PiWebSurfaceModule> | null = null
let surfaceStylesPromise: Promise<void> | null = null

function loadSurfaceModule() {
  if (!surfaceModulePromise) {
    const moduleUrl = new URL('./pi-web-session-surface/index.js', document.baseURI).href
    surfaceModulePromise = (import(/* @vite-ignore */ moduleUrl) as Promise<PiWebSurfaceModule>)
      .catch((error) => {
        surfaceModulePromise = null
        throw error
      })
  }
  return surfaceModulePromise
}

function ensureSurfaceStyles() {
  const id = 'aryn-pi-web-session-surface-styles'
  const href = new URL('./pi-web-session-surface/style.css', document.baseURI).href
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
      reject(new Error('pi-web 消息样式加载失败。'))
    }
    link.addEventListener('load', handleLoad, { once: true })
    link.addEventListener('error', handleError, { once: true })
    if (shouldAppend) document.head.append(link)
  })
  return surfaceStylesPromise
}

type PiWebSessionTimelineProps = {
  optimisticUserMessages?: PiWebOptimisticUserMessage[]
  onOpenWorkspaceFile?: (filePath: string) => void
  snapshot: PiWebNativeSessionSnapshot
  workspacePath: string
}

export const PiWebSessionTimeline = memo(function PiWebSessionTimeline({
  optimisticUserMessages = [],
  onOpenWorkspaceFile,
  snapshot,
  workspacePath,
}: PiWebSessionTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onOpenWorkspaceFileRef = useRef(onOpenWorkspaceFile)
  const optimisticUserMessagesRef = useRef(optimisticUserMessages)
  const snapshotRef = useRef(snapshot)
  const surfaceRef = useRef<PiWebSessionSurface | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    onOpenWorkspaceFileRef.current = onOpenWorkspaceFile
  }, [onOpenWorkspaceFile])

  useEffect(() => {
    optimisticUserMessagesRef.current = optimisticUserMessages
    surfaceRef.current?.setOptimisticUserMessages(optimisticUserMessages)
  }, [optimisticUserMessages])

  useEffect(() => {
    snapshotRef.current = snapshot
    surfaceRef.current?.setSnapshot(snapshot)
  }, [snapshot])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let surface: PiWebSessionSurface | null = null
    const bridge: PiWebSessionSurfaceOptions['bridge'] = {
      subscribe: (listener) => window.appApi.onAgentEvent((event) => {
        if (event.type !== 'pi_native_event') return
        if (event.agentId !== snapshotRef.current.agentId) return
        listener({
          agentId: event.agentId,
          event: event.event,
          sessionId: event.sessionId,
        } satisfies PiWebSurfaceEvent)
      }),
      openWorkspaceFile: (filePath) => onOpenWorkspaceFileRef.current?.(filePath),
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (!/^https?:/i.test(anchor.href)) return
      event.preventDefault()
      void window.appApi.openExternalLink(anchor.href)
    }
    container.addEventListener('click', handleClick)

    void Promise.all([ensureSurfaceStyles(), loadSurfaceModule()]).then(([, module]) => {
      if (cancelled) return
      setLoadError(null)
      surface = module.mountPiWebSessionSurface(container, {
        bridge,
        sessionId: snapshotRef.current.sessionId,
        snapshot: snapshotRef.current,
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
      container.removeEventListener('click', handleClick)
      if (surfaceRef.current === surface) surfaceRef.current = null
      surface?.dispose()
      container.replaceChildren()
    }
  }, [loadRevision, snapshot.agentId, snapshot.sessionId, workspacePath])

  return (
    <div className='pi-web-session-surface-host'>
      {loadError ? (
        <div className='agent-status-inline is-error' role='alert'>
          <p>{loadError}</p>
          <button className='agent-status-action' type='button' onClick={() => setLoadRevision((value) => value + 1)}>
            重新加载消息
          </button>
        </div>
      ) : null}
      <div
        ref={containerRef}
        data-pi-web-agent-id={snapshot.agentId}
        data-pi-web-session-id={snapshot.sessionId}
      />
    </div>
  )
})

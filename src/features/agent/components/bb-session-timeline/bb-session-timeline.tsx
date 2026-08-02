import { memo, useEffect, useRef, useState } from 'react'
import type {
  BbNativeFileChange,
  BbNativeSessionSnapshot,
  BbInteractionTimelineRecord,
  BbOptimisticUserMessage,
  BbSessionPaginationState,
  BbSessionRuntimeState,
  BbSessionSurface,
  BbSessionSurfaceOptions,
  BbTheme,
} from '@aryn/bb-session-surface'
import type { AgentNativeSessionSnapshot } from '@/features/agent/types'
import './styles.css'

type BbSurfaceModule = typeof import('@aryn/bb-session-surface')

let surfaceModulePromise: Promise<BbSurfaceModule> | null = null
let surfaceStylesPromise: Promise<void> | null = null

type OpenCodeHistoryState = {
  key: string
  isLoading: boolean
  nextCursor: string | null
  olderMessages: unknown[]
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function openCodeHistoryCursor(snapshot: BbNativeSessionSnapshot) {
  if (snapshot.agentId !== 'opencode') return null
  const history = recordValue(snapshot.history)
  return typeof history?.nextCursor === 'string' && history.nextCursor
    ? history.nextCursor
    : null
}

function openCodeMessageCreatedAt(value: unknown) {
  const info = recordValue(recordValue(value)?.info)
  const time = recordValue(info?.time)
  return typeof time?.created === 'number' && Number.isFinite(time.created)
    ? time.created
    : Number.NaN
}

export function mergeOpenCodeMessages(current: unknown[], older: unknown[]) {
  const keyed = new Map<string, { index: number; value: unknown }>()
  const unkeyed: Array<{ index: number; value: unknown }> = []
  for (const value of [...older, ...current]) {
    const info = recordValue(recordValue(value)?.info)
    const id = typeof info?.id === 'string' ? info.id : ''
    const entry = { index: keyed.size + unkeyed.length, value }
    if (id) keyed.set(id, entry)
    else unkeyed.push(entry)
  }
  return [...keyed.values(), ...unkeyed]
    .sort((left, right) => {
      const leftTime = openCodeMessageCreatedAt(left.value)
      const rightTime = openCodeMessageCreatedAt(right.value)
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
        return leftTime - rightTime
      }
      return left.index - right.index
    })
    .map((entry) => entry.value)
}

export function decorateOpenCodeSnapshot(
  snapshot: BbNativeSessionSnapshot,
  todos: unknown[] | null,
  olderMessages: unknown[],
): BbNativeSessionSnapshot {
  if (snapshot.agentId !== 'opencode') return snapshot
  return {
    ...snapshot,
    ...(todos ? { todos } : {}),
    messages: mergeOpenCodeMessages(
      Array.isArray(snapshot.messages) ? snapshot.messages : [],
      olderMessages,
    ),
  }
}

function loadSurfaceModule() {
  if (!surfaceModulePromise) {
    const moduleUrl = new URL('./bb-session-surface/index.js', document.baseURI).href
    surfaceModulePromise = (import(/* @vite-ignore */ moduleUrl) as Promise<BbSurfaceModule>)
      .catch((error) => {
        surfaceModulePromise = null
        throw error
      })
  }
  return surfaceModulePromise
}

function ensureSurfaceStyles() {
  const id = 'aryn-bb-session-surface-styles'
  const href = new URL('./bb-session-surface/style.css', document.baseURI).href
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
      reject(new Error('统一消息视图样式加载失败。'))
    }
    link.addEventListener('load', handleLoad, { once: true })
    link.addEventListener('error', handleError, { once: true })
    if (shouldAppend) document.head.append(link)
  })

  return surfaceStylesPromise
}

type BbSessionTimelineProps = {
  fileChanges?: BbNativeFileChange[]
  interactionRecords?: BbInteractionTimelineRecord[]
  onOpenWorkspaceFile?: (filePath: string) => void
  onRequestNativeView: () => void
  optimisticUserMessages?: BbOptimisticUserMessage[]
  runtimeState?: BbSessionRuntimeState
  sessionId: string
  snapshot: AgentNativeSessionSnapshot
  theme: BbTheme
  workspacePath: string
}

export const BbSessionTimeline = memo(function BbSessionTimeline({
  fileChanges = [],
  interactionRecords = [],
  onOpenWorkspaceFile,
  onRequestNativeView,
  optimisticUserMessages = [],
  runtimeState = {},
  sessionId,
  snapshot,
  theme,
  workspacePath,
}: BbSessionTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fileChangesRef = useRef(fileChanges)
  const interactionRecordsRef = useRef(interactionRecords)
  const onOpenWorkspaceFileRef = useRef(onOpenWorkspaceFile)
  const onRequestNativeViewRef = useRef(onRequestNativeView)
  const optimisticMessagesRef = useRef(optimisticUserMessages)
  const runtimeStateRef = useRef(runtimeState)
  const themeRef = useRef(theme)
  const nativeSnapshotRef = useRef(snapshot as BbNativeSessionSnapshot)
  const openCodeTodosRef = useRef<unknown[] | null>(null)
  const historyKey = `${snapshot.agentId}:${sessionId}`
  const openCodeTodosKeyRef = useRef(historyKey)
  if (openCodeTodosKeyRef.current !== historyKey) {
    openCodeTodosKeyRef.current = historyKey
    openCodeTodosRef.current = null
  }
  const openCodeHistoryRef = useRef<OpenCodeHistoryState>({
    key: historyKey,
    isLoading: false,
    nextCursor: openCodeHistoryCursor(snapshot as BbNativeSessionSnapshot),
    olderMessages: [],
  })
  if (openCodeHistoryRef.current.key !== historyKey) {
    openCodeHistoryRef.current = {
      key: historyKey,
      isLoading: false,
      nextCursor: openCodeHistoryCursor(snapshot as BbNativeSessionSnapshot),
      olderMessages: [],
    }
  }
  const snapshotRef = useRef(snapshot as BbNativeSessionSnapshot)
  const surfaceRef = useRef<BbSessionSurface | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    onOpenWorkspaceFileRef.current = onOpenWorkspaceFile
    onRequestNativeViewRef.current = onRequestNativeView
  }, [onOpenWorkspaceFile, onRequestNativeView])

  useEffect(() => {
    fileChangesRef.current = fileChanges
    surfaceRef.current?.setFileChanges(fileChanges)
  }, [fileChanges])

  useEffect(() => {
    interactionRecordsRef.current = interactionRecords
    surfaceRef.current?.setInteractionRecords(interactionRecords)
  }, [interactionRecords])

  useEffect(() => {
    optimisticMessagesRef.current = optimisticUserMessages
    surfaceRef.current?.setOptimisticUserMessages(optimisticUserMessages)
  }, [optimisticUserMessages])

  useEffect(() => {
    runtimeStateRef.current = runtimeState
    surfaceRef.current?.setRuntimeState(runtimeState)
  }, [runtimeState])

  useEffect(() => {
    themeRef.current = theme
    surfaceRef.current?.setTheme(theme)
  }, [theme])

  useEffect(() => {
    const nextSnapshot = snapshot as BbNativeSessionSnapshot
    nativeSnapshotRef.current = nextSnapshot
    const history = openCodeHistoryRef.current
    if (nextSnapshot.agentId === 'opencode' && history.olderMessages.length === 0) {
      history.nextCursor = openCodeHistoryCursor(nextSnapshot)
    }
    snapshotRef.current = decorateOpenCodeSnapshot(
      nextSnapshot,
      openCodeTodosRef.current,
      history.olderMessages,
    )
    surfaceRef.current?.setSnapshot(snapshotRef.current)
    surfaceRef.current?.setPaginationState({
      hasOlderTimelineRows: Boolean(history.nextCursor),
      isLoadingOlderTimelineRows: history.isLoading,
    })
  }, [snapshot])

  useEffect(() => {
    if (snapshot.agentId !== 'opencode') {
      openCodeTodosRef.current = null
      return
    }

    let cancelled = false
    const applyTodos = (value: unknown) => {
      if (cancelled || !Array.isArray(value)) return
      openCodeTodosRef.current = value
      snapshotRef.current = decorateOpenCodeSnapshot(
        nativeSnapshotRef.current,
        value,
        openCodeHistoryRef.current.olderMessages,
      )
      surfaceRef.current?.setSnapshot(snapshotRef.current)
    }
    const loadTodos = () => window.appApi.requestOpenCodeSurface({
      agentId: 'opencode',
      sessionPath: sessionId,
      workspacePath,
    }, {
      method: 'session.todo',
      sessionID: sessionId,
    }).then((response) => applyTodos(response.data)).catch((cause) => {
      console.warn('[bb-session-timeline] unable to load OpenCode todos', cause)
    })

    void loadTodos()
    const unsubscribe = window.appApi.onAgentEvent((event) => {
      if (event.agentId !== 'opencode') return
      if (event.type === 'opencode_surface_refresh' && event.sessionId === sessionId) {
        void loadTodos()
        return
      }
      if (event.type !== 'opencode_native_event' || event.event.type !== 'todo.updated') return
      const properties = event.event.properties
      if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return
      const todoProperties = properties as Record<string, unknown>
      if (todoProperties.sessionID !== sessionId) return
      applyTodos(todoProperties.todos)
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [sessionId, snapshot.agentId, workspacePath])

  const loadOlderTimelineRows = async () => {
    if (snapshot.agentId !== 'opencode') return
    const history = openCodeHistoryRef.current
    if (history.isLoading || !history.nextCursor) return
    const requestedHistoryKey = history.key
    const requestedCursor = history.nextCursor
    const isCurrentRequest = () => (
      openCodeHistoryRef.current === history
      && history.key === requestedHistoryKey
    )

    history.isLoading = true
    const loadingState: BbSessionPaginationState = {
      hasOlderTimelineRows: true,
      isLoadingOlderTimelineRows: true,
    }
    surfaceRef.current?.setPaginationState(loadingState)
    try {
      const response = await window.appApi.requestOpenCodeSurface({
        agentId: 'opencode',
        sessionPath: sessionId,
        workspacePath,
      }, {
        before: requestedCursor,
        limit: 200,
        method: 'session.messages',
        sessionID: sessionId,
      })
      if (!Array.isArray(response.data)) {
        throw new Error('OpenCode returned an invalid history page.')
      }
      if (!isCurrentRequest()) return
      history.olderMessages = mergeOpenCodeMessages(history.olderMessages, response.data)
      history.nextCursor = response.nextCursor === requestedCursor && response.data.length === 0
        ? null
        : response.nextCursor ?? null
      snapshotRef.current = decorateOpenCodeSnapshot(
        nativeSnapshotRef.current,
        openCodeTodosRef.current,
        history.olderMessages,
      )
      surfaceRef.current?.setSnapshot(snapshotRef.current)
    } finally {
      if (!isCurrentRequest()) return
      history.isLoading = false
      surfaceRef.current?.setPaginationState({
        hasOlderTimelineRows: Boolean(history.nextCursor),
        isLoadingOlderTimelineRows: false,
      })
    }
  }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let surface: BbSessionSurface | null = null
    setLoadError(null)
    setIsLoading(true)

    const bridge: BbSessionSurfaceOptions['bridge'] = {
      loadOlderTimelineRows,
      openExternal: (href) => {
        if (!/^(?:https?|mailto):/i.test(href)) return undefined
        return window.appApi.openExternalLink(href)
      },
      openWorkspaceFile: (filePath) => onOpenWorkspaceFileRef.current?.(filePath),
      requestNativeView: () => onRequestNativeViewRef.current(),
    }

    void Promise.all([ensureSurfaceStyles(), loadSurfaceModule()]).then(([, module]) => {
      if (cancelled) return
      surface = module.mountBbSessionSurface(container, {
        bridge,
        fileChanges: fileChangesRef.current,
        interactionRecords: interactionRecordsRef.current,
        optimisticUserMessages: optimisticMessagesRef.current,
        paginationState: {
          hasOlderTimelineRows: Boolean(openCodeHistoryRef.current.nextCursor),
          isLoadingOlderTimelineRows: openCodeHistoryRef.current.isLoading,
        },
        runtimeState: runtimeStateRef.current,
        sessionId,
        snapshot: snapshotRef.current,
        theme: themeRef.current,
        workspacePath,
      })
      surfaceRef.current = surface
      setIsLoading(false)
    }).catch((cause) => {
      if (cancelled) return
      setIsLoading(false)
      setLoadError(cause instanceof Error ? cause.message : String(cause))
    })

    return () => {
      cancelled = true
      if (surfaceRef.current === surface) surfaceRef.current = null
      surface?.dispose()
      container.replaceChildren()
    }
  }, [loadRevision, sessionId, snapshot.agentId, workspacePath])

  return (
    <div
      className='bb-session-surface-host'
      aria-busy={isLoading ? 'true' : undefined}
      data-bb-agent-id={snapshot.agentId}
      data-bb-session-id={sessionId}
    >
        {isLoading ? (
          <div className='agent-status-inline bb-session-surface-status' role='status'>
            <p>正在加载统一消息视图…</p>
          </div>
        ) : null}
        {loadError ? (
          <div className='agent-status-inline bb-session-surface-status is-error' role='alert'>
            <p>{loadError}</p>
            <div className='bb-session-surface-status-actions'>
              <button
                className='agent-status-action'
                type='button'
                onClick={() => setLoadRevision((value) => value + 1)}
              >
                重新加载
              </button>
              <button
                className='agent-status-action'
                type='button'
                onClick={onRequestNativeView}
              >
                切换到原生视图
              </button>
            </div>
          </div>
        ) : null}
      <div ref={containerRef} className='bb-session-surface-mount' />
    </div>
  )
})

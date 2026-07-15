import { useEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import type {
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
  PiWebSessionSurface,
  PiWebSessionSurfaceOptions,
} from './contracts'
import {
  createPiWebSessionState,
  getPiWebVisibleMessages,
  reducePiWebSessionState,
} from './session-state'
import { PiWebTimeline } from './timeline'
import 'virtual:aryn-pi-web-globals.css'
import './surface.css'

export type {
  PiWebAgentId,
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
  PiWebSessionSurface,
  PiWebSessionSurfaceOptions,
  PiWebSurfaceEvent,
} from './contracts'
export {
  createPiWebSessionState,
  getPiWebVisibleMessages,
  piWebUserMessageKey,
  reducePiWebSessionState,
} from './session-state'

type SurfaceConfig = {
  optimisticUserMessages: PiWebOptimisticUserMessage[]
  options: PiWebSessionSurfaceOptions
  snapshot: PiWebNativeSessionSnapshot
}

function createSurfaceStore(options: PiWebSessionSurfaceOptions) {
  let snapshot: SurfaceConfig = {
    optimisticUserMessages: [],
    options,
    snapshot: options.snapshot,
  }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    setOptimisticUserMessages(messages: PiWebOptimisticUserMessage[]) {
      snapshot = { ...snapshot, optimisticUserMessages: messages }
      listeners.forEach((listener) => listener())
    },
    setSnapshot(nextSnapshot: PiWebNativeSessionSnapshot) {
      snapshot = { ...snapshot, snapshot: nextSnapshot }
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

type SurfaceStore = ReturnType<typeof createSurfaceStore>

function PiWebSurface({ store }: { store: SurfaceStore }) {
  const config = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const [state, dispatch] = useReducer(
    reducePiWebSessionState,
    config.snapshot,
    createPiWebSessionState,
  )
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)

  useEffect(() => {
    dispatch({ type: 'set_snapshot', snapshot: config.snapshot })
  }, [config.snapshot])

  useEffect(() => {
    dispatch({ type: 'set_optimistic', messages: config.optimisticUserMessages })
  }, [config.optimisticUserMessages])

  useEffect(() => config.options.bridge.subscribe((payload) => {
    if (payload.sessionId !== config.options.sessionId) return
    if (payload.agentId !== config.snapshot.agentId) return
    dispatch({ type: 'native_event', event: payload.event })
  }), [config.options, config.snapshot.agentId])

  useEffect(() => {
    const viewport = surfaceRef.current?.closest('.agent-messages-scroll-viewport')
    if (!(viewport instanceof HTMLElement)) return
    const handleScroll = () => {
      const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
      shouldStickToBottomRef.current = distance <= 80
    }
    viewport.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => viewport.removeEventListener('scroll', handleScroll)
  }, [])

  useLayoutEffect(() => {
    if (!shouldStickToBottomRef.current) return
    const surface = surfaceRef.current
    const viewport = surface?.closest('.agent-messages-scroll-viewport')
    if (!(surface instanceof HTMLElement)) return
    if (!(viewport instanceof HTMLElement)) return
    const frame = requestAnimationFrame(() => {
      viewport.scrollTop = viewport.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [state])

  return (
    <div ref={surfaceRef} className='aryn-pi-web-session-surface'>
      <PiWebTimeline
        agentPhase={state.agentPhase}
        agentRunning={state.agentRunning}
        entryIds={state.entryIds}
        messages={getPiWebVisibleMessages(state)}
        modelNames={config.snapshot.modelNames}
        onOpenFile={config.options.bridge.openWorkspaceFile}
        sessionId={config.options.sessionId}
        streamingMessage={state.streamingMessage}
        workspacePath={config.options.workspacePath}
      />
    </div>
  )
}

export function mountPiWebSessionSurface(
  container: HTMLElement,
  options: PiWebSessionSurfaceOptions,
): PiWebSessionSurface {
  const store = createSurfaceStore(options)
  const root = createRoot(container)
  root.render(<PiWebSurface store={store} />)
  return {
    dispose() {
      root.unmount()
    },
    setOptimisticUserMessages(messages) {
      store.setOptimisticUserMessages(messages)
    },
    setSnapshot(snapshot) {
      store.setSnapshot(snapshot)
    },
  }
}

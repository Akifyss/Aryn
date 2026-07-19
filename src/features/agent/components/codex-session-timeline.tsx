import { memo, useEffect, useRef, useState } from 'react'
import type {
  CodexOptimisticUserMessage,
  CodexSessionSurface,
  CodexSessionSurfaceOptions,
} from '@aryn/codex-session-surface'
import type {
  AgentSidebarMessage,
  CodexNativeSessionSnapshot,
} from '@/features/agent/types'
import { resolveWorkspaceMessageLink } from '@/features/agent/lib/message-links'

type CodexSurfaceModule = typeof import('@aryn/codex-session-surface')

let surfaceModulePromise: Promise<CodexSurfaceModule> | null = null
let surfaceStylesPromise: Promise<void> | null = null

function loadSurfaceModule() {
  if (!surfaceModulePromise) {
    const moduleUrl = new URL('./codex-session-surface/index.js', document.baseURI).href
    surfaceModulePromise = (import(/* @vite-ignore */ moduleUrl) as Promise<CodexSurfaceModule>)
      .catch((error) => {
        surfaceModulePromise = null
        throw error
      })
  }
  return surfaceModulePromise
}

function ensureSurfaceStyles() {
  const id = 'aryn-codex-session-surface-styles'
  const href = new URL('./codex-session-surface/style.css', document.baseURI).href
  const current = document.getElementById(id)

  if (surfaceStylesPromise && current instanceof HTMLLinkElement && current.href === href) {
    return surfaceStylesPromise
  }
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
      reject(new Error('Codex 消息样式加载失败。'))
    }
    link.addEventListener('load', handleLoad, { once: true })
    link.addEventListener('error', handleError, { once: true })
    if (shouldAppend) document.head.append(link)
  })
  return surfaceStylesPromise
}

export function toCodexSurfaceOptimisticMessages(messages: AgentSidebarMessage[]): CodexOptimisticUserMessage[] {
  return messages.map((message) => ({
    id: message.id,
    text: message.text,
    timestamp: message.timestamp,
    attachments: message.attachments?.map((attachment, index) => ({
      id: `${message.id}:attachment:${index}`,
      name: attachment.fileName,
      path: attachment.path,
      url: attachment.data,
      mimeType: attachment.mimeType,
    })),
  }))
}

type CodexSessionTimelineProps = {
  onOpenWorkspaceFile?: (filePath: string) => void
  optimisticUserMessages?: AgentSidebarMessage[]
  snapshot: CodexNativeSessionSnapshot
  workspacePath: string
}

export const CodexSessionTimeline = memo(function CodexSessionTimeline({
  onOpenWorkspaceFile,
  optimisticUserMessages = [],
  snapshot,
  workspacePath,
}: CodexSessionTimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const onOpenWorkspaceFileRef = useRef(onOpenWorkspaceFile)
  const optimisticMessagesRef = useRef(toCodexSurfaceOptimisticMessages(optimisticUserMessages))
  const snapshotRef = useRef(snapshot)
  const surfaceRef = useRef<CodexSessionSurface | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadRevision, setLoadRevision] = useState(0)

  useEffect(() => {
    onOpenWorkspaceFileRef.current = onOpenWorkspaceFile
  }, [onOpenWorkspaceFile])

  useEffect(() => {
    const messages = toCodexSurfaceOptimisticMessages(optimisticUserMessages)
    optimisticMessagesRef.current = messages
    surfaceRef.current?.setOptimisticUserMessages(messages)
  }, [optimisticUserMessages])

  useEffect(() => {
    snapshotRef.current = snapshot
    surfaceRef.current?.setSnapshot(snapshot)
  }, [snapshot])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let surface: CodexSessionSurface | null = null
    setLoadError(null)
    setIsLoading(true)
    const bridge: CodexSessionSurfaceOptions['bridge'] = {
      openWorkspaceFile: (filePath) => onOpenWorkspaceFileRef.current?.(filePath),
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      const rawHref = anchor.getAttribute('href') ?? ''
      const workspaceFilePath = resolveWorkspaceMessageLink(workspacePath, rawHref)
      if (workspaceFilePath) {
        event.preventDefault()
        onOpenWorkspaceFileRef.current?.(workspaceFilePath)
        return
      }
      if (/^(https?|mailto):/i.test(anchor.href)) {
        event.preventDefault()
        void window.appApi.openExternalLink(anchor.href)
        return
      }
      if (rawHref && !rawHref.startsWith('#')) event.preventDefault()
    }
    container.addEventListener('click', handleClick)

    void Promise.all([ensureSurfaceStyles(), loadSurfaceModule()]).then(([, module]) => {
      if (cancelled) return
      setLoadError(null)
      surface = module.mountCodexSessionSurface(container, {
        bridge,
        optimisticUserMessages: optimisticMessagesRef.current,
        snapshot: snapshotRef.current,
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
      container.removeEventListener('click', handleClick)
      if (surfaceRef.current === surface) surfaceRef.current = null
      surface?.dispose()
      container.replaceChildren()
    }
  }, [loadRevision, snapshot.thread.id, workspacePath])

  return (
    <div className='codex-session-surface-host' aria-busy={isLoading ? 'true' : undefined}>
      {isLoading ? (
        <div className='agent-status-inline codex-session-surface-status' role='status'>
          <p>正在加载 Codex 会话…</p>
        </div>
      ) : null}
      {loadError ? (
        <div className='agent-status-inline codex-session-surface-status is-error' role='alert'>
          <p>{loadError}</p>
          <button className='agent-status-action' type='button' onClick={() => setLoadRevision((value) => value + 1)}>
            重新加载消息
          </button>
        </div>
      ) : null}
      <div ref={containerRef} data-codex-thread-id={snapshot.thread.id} />
    </div>
  )
})

import type {
  Agent,
  Event as OpenCodeEvent,
  Message,
  OpencodeClient,
  Part,
  ProviderListResponse,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
  UserMessage,
} from '@opencode-ai/sdk/v2/client'
import { DialogProvider } from '@opencode-ai/ui/context/dialog'
import { FileComponentProvider } from '@opencode-ai/ui/context/file'
import { I18nProvider, type UiI18nKey, type UiI18nParams } from '@opencode-ai/ui/context/i18n'
import { MarkedProvider } from '@opencode-ai/ui/context/marked'
import { dict as en } from '@opencode-ai/ui/i18n/en'
import { dict as zh } from '@opencode-ai/ui/i18n/zh'
import { createMemoryHistory, MemoryRouter } from '@solidjs/router'
import { batch, createMemo, createSignal, ErrorBoundary, For, onCleanup, onMount, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { coalesceOpenCodeEvents, enqueueOpenCodeEvent, type QueuedOpenCodeEvent } from './adapters/event-queue'
import { createServerSession } from './upstream/app/context/server-session'
import { File } from './upstream/session-ui/components/file'
import { SessionTurn } from './upstream/session-ui/components/session-turn'
import { DataProvider } from './upstream/session-ui/context/data'
import './surface.css'

export type OpenCodeSurfaceRequest =
  | { method: 'app.agents' }
  | { method: 'provider.list' }
  | { method: 'session.get'; sessionID: string }
  | { method: 'session.messages'; before?: string; limit: number; sessionID: string }
  | { method: 'session.message'; messageID: string; sessionID: string }
  | { method: 'session.diff'; sessionID: string }
  | { method: 'session.todo'; sessionID: string }
  | { method: 'session.status'; sessionID: string }

export type OpenCodeSurfaceResponse = {
  data: unknown
  nextCursor?: string
}

export type OpenCodeSurfaceEvent =
  | {
      event: OpenCodeEvent
      type: 'event'
      workspacePath: string
    }
  | {
      sessionID: string
      type: 'refresh'
      workspacePath: string
    }

export type OpenCodeOptimisticUserMessage = {
  attachments?: Array<{
    fileName: string
    mimeType?: string
    partId: string
    url: string
  }>
  id: string
  text: string
  textPartId: string
  timestamp: number
}

export type OpenCodeSessionSurfaceOptions = {
  bridge: {
    openExternal?: (href: string) => Promise<unknown> | unknown
    openWorkspaceFile?: (filePath: string) => Promise<unknown> | unknown
    request: (workspacePath: string, request: OpenCodeSurfaceRequest) => Promise<OpenCodeSurfaceResponse>
    subscribe: (listener: (event: OpenCodeSurfaceEvent) => void) => () => void
  }
  locale?: string
  onNavigateToSession?: (sessionID: string) => void
  sessionID: string
  workspacePath: string
}

const PORTAL_THEME_CLASS = 'aryn-opencode-portal-theme'
const NEW_LAYOUT_ATTRIBUTE = 'data-new-layout'
let surfaceOwners = 0
let removeNewLayoutAttributeOnLastRelease = false

function acquireOpenCodeDocumentState(surface: HTMLElement) {
  // Older Aryn builds put the portal theme class directly on body. If HMR or
  // an interrupted unmount left it behind, every official generic selector
  // could match the entire application. It is never a valid owner now:
  // official portals are direct body children, not body itself.
  document.body.classList.remove(PORTAL_THEME_CLASS)
  if (surfaceOwners === 0) {
    removeNewLayoutAttributeOnLastRelease = !document.body.hasAttribute(NEW_LAYOUT_ATTRIBUTE)
  }
  surfaceOwners += 1
  // OpenCode Desktop sets this attribute from BodyDesignClass. Its official
  // Message/Part/Tool CSS uses the attribute to select the current layout;
  // without it the same components fall back to the legacy theme branch.
  document.body.setAttribute(NEW_LAYOUT_ATTRIBUTE, '')

  // Solid portals are direct children of body. Each generated container keeps
  // an internal _$host reference to the marker at its source location. Use
  // that ownership link to theme only portals created by this surface instead
  // of putting the portal class on body and exposing all OpenCode selectors to
  // the rest of Aryn.
  const portalRoots = new Set<HTMLElement>()
  const markOwnedPortal = (node: Node) => {
    if (!(node instanceof HTMLElement) || node.parentElement !== document.body) return
    const host = (node as HTMLElement & { _$host?: Node | null })._$host
    if (!(host instanceof Node) || !surface.contains(host)) return
    node.classList.add(PORTAL_THEME_CLASS)
    portalRoots.add(node)
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(markOwnedPortal)
    }
  })
  observer.observe(document.body, { childList: true })
  document.body.childNodes.forEach(markOwnedPortal)

  return () => {
    observer.disconnect()
    portalRoots.forEach((root) => root.classList.remove(PORTAL_THEME_CLASS))
    portalRoots.clear()
    surfaceOwners = Math.max(0, surfaceOwners - 1)
    if (surfaceOwners === 0) {
      document.body.classList.remove(PORTAL_THEME_CLASS)
      if (removeNewLayoutAttributeOnLastRelease) {
        document.body.removeAttribute(NEW_LAYOUT_ATTRIBUTE)
      }
      removeNewLayoutAttributeOnLastRelease = false
    }
  }
}

function workspaceIdentity(value: string) {
  const normalized = value.replaceAll('\\', '/').replace(/\/$/, '')
  return navigator.userAgent.includes('Windows') ? normalized.toLowerCase() : normalized
}

function interpolate(text: string, params?: UiI18nParams) {
  if (!params) return text
  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_, rawKey: string) => {
    const value = params[rawKey]
    return value === undefined ? '' : String(value)
  })
}

function createTranslator(locale: string) {
  const primary: Record<string, string> = locale.toLowerCase().startsWith('zh') ? zh : en
  return (key: UiI18nKey, params?: UiI18nParams) => {
    const value = primary[key] ?? en[key] ?? String(key)
    return interpolate(value, params)
  }
}

function isAgent(value: unknown): value is Agent {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { mode?: unknown; name?: unknown }
  return typeof candidate.name === 'string'
    && (candidate.mode === 'subagent' || candidate.mode === 'primary' || candidate.mode === 'all')
}

function normalizeAgents(value: unknown) {
  if (Array.isArray(value)) return value.filter(isAgent)
  if (isAgent(value)) return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).filter(isAgent)
}

function normalizeProviders(value: unknown) {
  const candidate = value as Partial<ProviderListResponse> | null
  if (!candidate || !Array.isArray(candidate.all)) return undefined
  return {
    all: new Map(candidate.all.map((provider) => [
      provider.id,
      {
        ...provider,
        models: Object.fromEntries(
          Object.entries(provider.models).filter(([, model]) => model.status !== 'deprecated'),
        ),
      },
    ])),
    connected: Array.isArray(candidate.connected) ? candidate.connected : [],
    default: candidate.default ?? {},
  }
}

function createSurfaceClient(options: OpenCodeSessionSurfaceOptions) {
  const request = (input: OpenCodeSurfaceRequest) => options.bridge.request(options.workspacePath, input)
  async function response<T>(input: OpenCodeSurfaceRequest) {
    const result = await request(input)
    const headers = new Headers()
    if (result.nextCursor) headers.set('x-next-cursor', result.nextCursor)
    return {
      data: result.data as T,
      response: { headers },
    }
  }

  return {
    session: {
      diff: ({ sessionID }: { sessionID: string }) => response<SnapshotFileDiff[]>({ method: 'session.diff', sessionID }),
      get: ({ sessionID }: { sessionID: string }) => response<Session>({ method: 'session.get', sessionID }),
      message: ({ messageID, sessionID }: { messageID: string; sessionID: string }) => (
        response<{ info: Message; parts: Part[] }>({ method: 'session.message', messageID, sessionID })
      ),
      messages: ({ before, limit, sessionID }: { before?: string; limit: number; sessionID: string }) => (
        response<Array<{ info: Message; parts: Part[] }>>({ method: 'session.messages', before, limit, sessionID })
      ),
      todo: ({ sessionID }: { sessionID: string }) => response<Todo[]>({ method: 'session.todo', sessionID }),
    },
  } as unknown as OpencodeClient
}

function normalizeEvent(event: OpenCodeEvent): OpenCodeEvent {
  if ((event as { type: string }).type !== 'session.idle') return event
  const properties = (event as { properties?: { sessionID?: string } }).properties
  return {
    type: 'session.status',
    properties: {
      sessionID: properties?.sessionID ?? '',
      status: { type: 'idle' },
    },
  } as OpenCodeEvent
}

type OpenCodeSessionSurfaceController = {
  setOptimisticUserMessages: (messages: OpenCodeOptimisticUserMessage[]) => void
}

function SessionSurface(props: {
  onReady: (controller: OpenCodeSessionSurfaceController) => void
  options: OpenCodeSessionSurfaceOptions
}) {
  const options = props.options
  const session = createServerSession(createSurfaceClient(options))
  const [loading, setLoading] = createSignal(true)
  const [loadingHistory, setLoadingHistory] = createSignal(false)
  const [error, setError] = createSignal<string>()
  const [agents, setAgents] = createSignal<Agent[]>([])
  const [providers, setProviders] = createSignal<ReturnType<typeof normalizeProviders>>()
  const queue: QueuedOpenCodeEvent[] = []
  const optimisticMessageIDs = new Set<string>()
  const FLUSH_FRAME_MS = 16
  let flushTimer: ReturnType<typeof setTimeout> | undefined
  let lastFlushAt = 0
  let loadGeneration = 0
  let loadPromise: Promise<void> | null = null
  let loadRequested = false
  let forceLoadRequested = false

  const loadMetadata = async () => {
    const [providerResult, agentResult] = await Promise.allSettled([
      options.bridge.request(options.workspacePath, { method: 'provider.list' }),
      options.bridge.request(options.workspacePath, { method: 'app.agents' }),
    ])
    if (providerResult.status === 'fulfilled') {
      const nextProviders = normalizeProviders(providerResult.value.data)
      if (nextProviders) setProviders(nextProviders)
    }
    if (agentResult.status === 'fulfilled') {
      setAgents(normalizeAgents(agentResult.value.data))
    }
  }

  const setOptimisticUserMessages = (messages: OpenCodeOptimisticUserMessage[]) => {
    const nextMessageIDs = new Set(messages.map((message) => message.id))
    batch(() => {
      for (const messageID of optimisticMessageIDs) {
        if (!nextMessageIDs.has(messageID)) {
          session.optimistic.remove({ sessionID: options.sessionID, messageID })
        }
      }

      for (const input of messages) {
        if (optimisticMessageIDs.has(input.id)) continue
        const message: UserMessage = {
          agent: 'build',
          id: input.id,
          model: { modelID: '', providerID: '' },
          role: 'user',
          sessionID: options.sessionID,
          time: { created: input.timestamp },
        }
        const parts: Part[] = [
          {
            id: input.textPartId,
            messageID: input.id,
            sessionID: options.sessionID,
            text: input.text,
            type: 'text',
          },
          ...(input.attachments ?? []).map((attachment, index) => ({
            filename: attachment.fileName,
            id: attachment.partId,
            messageID: input.id,
            mime: attachment.mimeType || 'application/octet-stream',
            sessionID: options.sessionID,
            type: 'file' as const,
            url: attachment.url,
          })),
        ]
        session.optimistic.add({ message, parts, sessionID: options.sessionID })
      }
    })

    optimisticMessageIDs.clear()
    nextMessageIDs.forEach((messageID) => optimisticMessageIDs.add(messageID))
  }

  props.onReady({ setOptimisticUserMessages })

  const flush = () => {
    if (flushTimer) clearTimeout(flushTimer)
    flushTimer = undefined
    if (queue.length === 0) return
    const events = queue.splice(0, queue.length)
    lastFlushAt = Date.now()
    batch(() => coalesceOpenCodeEvents(events).forEach((item) => session.apply(normalizeEvent(item.payload))))
  }

  const scheduleFlush = () => {
    if (flushTimer) return
    const elapsed = Date.now() - lastFlushAt
    flushTimer = setTimeout(flush, Math.max(0, FLUSH_FRAME_MS - elapsed))
  }

  const performLoad = async (force: boolean) => {
    const generation = ++loadGeneration
    setLoading(true)
    setError(undefined)
    try {
      const status = await options.bridge.request(options.workspacePath, {
        method: 'session.status',
        sessionID: options.sessionID,
      })
      session.apply({
        type: 'session.status',
        properties: { sessionID: options.sessionID, status: status.data as SessionStatus },
      })
      await Promise.all([
        session.sync(options.sessionID, { force, messageLimit: 200 }),
        session.diff(options.sessionID, { force }),
        loadMetadata(),
      ])
    } catch (cause) {
      if (generation === loadGeneration) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      flush()
      if (generation === loadGeneration) setLoading(false)
    }
  }

  // A reconnect refresh can arrive while the initial REST sync is still in
  // flight. OpenCode's session store coalesces concurrent syncs, so starting a
  // second call immediately would reuse the older request and lose the
  // reconciliation. Drain refreshes serially and preserve the strongest
  // `force` request instead.
  const load = (force = false) => {
    loadRequested = true
    forceLoadRequested = forceLoadRequested || force
    if (loadPromise) return loadPromise

    loadPromise = (async () => {
      while (loadRequested) {
        const nextForce = forceLoadRequested
        loadRequested = false
        forceLoadRequested = false
        await performLoad(nextForce)
      }
    })().finally(() => {
      loadPromise = null
      if (loadRequested) void load(forceLoadRequested)
    })
    return loadPromise
  }

  const unsubscribe = options.bridge.subscribe((incoming) => {
    if (workspaceIdentity(incoming.workspacePath) !== workspaceIdentity(options.workspacePath)) return
    if (incoming.type === 'refresh') {
      if (incoming.sessionID === options.sessionID) void load(true)
      return
    }
    if (enqueueOpenCodeEvent(queue, { directory: incoming.workspacePath, payload: incoming.event })) {
      scheduleFlush()
    }
  })

  onMount(() => {
    session.pin(options.sessionID)
    void load()
  })

  onCleanup(() => {
    loadGeneration += 1
    loadRequested = false
    forceLoadRequested = false
    unsubscribe()
    session.unpin(options.sessionID)
    if (flushTimer) clearTimeout(flushTimer)
  })

  const messages = createMemo(() => session.data.message[options.sessionID] ?? [])
  const userMessages = createMemo(() => messages().filter((message) => message.role === 'user'))
  const lastUserMessageID = createMemo(() => userMessages().at(-1)?.id)
  const data = createMemo(() => ({
    agent: agents(),
    message: session.data.message,
    part: session.data.part,
    part_text_accum_delta: session.data.part_text_accum_delta,
    provider: providers(),
    session: Object.values(session.data.info).filter((item): item is Session => Boolean(item)),
    session_diff: session.data.session_diff,
    session_status: session.data.session_status,
  }))

  const loadMore = async () => {
    setLoadingHistory(true)
    try {
      await session.history.loadMore(options.sessionID)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoadingHistory(false)
    }
  }

  return (
    <DataProvider
      data={data()}
      directory={options.workspacePath}
      onNavigateToSession={options.onNavigateToSession}
    >
      <FileComponentProvider component={File}>
        <Show when={!loading() || userMessages().length > 0} fallback={<div class='aryn-opencode-surface-state'>正在加载会话…</div>}>
          <Show
            when={!error() || userMessages().length > 0}
            fallback={
              <div class='aryn-opencode-surface-state' data-error='true' role='alert'>
                <div>
                  <div>{error()}</div>
                  <button class='aryn-opencode-surface-retry' type='button' onClick={() => void load(true)}>重新加载</button>
                </div>
              </div>
            }
          >
            <div class='aryn-opencode-session-list' role='log' aria-live='polite'>
              <Show when={session.history.more(options.sessionID)}>
                <button
                  class='aryn-opencode-history-button'
                  disabled={loadingHistory()}
                  type='button'
                  onClick={() => void loadMore()}
                >
                  {loadingHistory() ? '正在加载…' : '加载更早的消息'}
                </button>
              </Show>
              <For each={userMessages()}>
                {(message) => (
                  <div class='aryn-opencode-turn'>
                    <SessionTurn
                      sessionID={options.sessionID}
                      messageID={message.id}
                      messages={messages()}
                      active={message.id === lastUserMessageID()}
                      status={session.data.session_status[options.sessionID]}
                      showReasoningSummaries={false}
                      shellToolDefaultOpen={false}
                      editToolDefaultOpen={false}
                      classes={{
                        root: 'aryn-opencode-turn-root',
                        content: 'aryn-opencode-turn-content',
                        container: 'aryn-opencode-turn-container',
                      }}
                    />
                  </div>
                )}
              </For>
              <Show when={error() && userMessages().length > 0}>
                <div class='aryn-opencode-surface-state' data-error='true' role='alert'>{error()}</div>
              </Show>
            </div>
          </Show>
        </Show>
      </FileComponentProvider>
    </DataProvider>
  )
}

export function mountOpenCodeSessionSurface(element: HTMLElement, options: OpenCodeSessionSurfaceOptions) {
  element.classList.add('aryn-opencode-session-surface')
  const releaseDocumentState = acquireOpenCodeDocumentState(element)
  const history = createMemoryHistory()
  history.set({ value: `/session/${options.sessionID}`, replace: true, scroll: false })
  const findAnchor = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null
    return target instanceof HTMLAnchorElement ? target : null
  }
  const isModifiedClick = (event: MouseEvent) => (
    event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
  )
  const onClickCapture = (event: MouseEvent) => {
    const target = findAnchor(event)
    if (!target) return
    const href = target.getAttribute('href')?.trim()
    if (!href) return
    if (/^(?:https?:\/\/|mailto:)/i.test(href)) {
      event.preventDefault()
      if (event.button === 0) void options.bridge.openExternal?.(href)
      return
    }
    if (isModifiedClick(event) && (
      href.startsWith('/')
      || /^[a-zA-Z]:[\\/]/.test(href)
    )) {
      // Never let a modified click navigate the Electron renderer away from
      // Aryn. Native session and workspace links are handled on primary click.
      event.preventDefault()
    }
  }
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || isModifiedClick(event)) return
    const target = findAnchor(event)
    if (!target) return
    const href = target.getAttribute('href')?.trim()
    if (!href) return
    const sessionMatch = href.match(/^\/session\/([^/?#]+)/)
    if (sessionMatch) {
      event.preventDefault()
      let sessionID = sessionMatch[1]
      try {
        sessionID = decodeURIComponent(sessionID)
      } catch {
        // OpenCode session IDs are normally URL-safe. Keep the raw value for
        // malformed third-party links instead of throwing from a click event.
      }
      options.onNavigateToSession?.(sessionID)
      return
    }
    if (href.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(href)) {
      event.preventDefault()
      void options.bridge.openWorkspaceFile?.(href)
    }
  }
  element.addEventListener('click', onClickCapture, true)
  element.addEventListener('click', onClick)

  let controller: OpenCodeSessionSurfaceController | null = null
  let pendingOptimisticUserMessages: OpenCodeOptimisticUserMessage[] = []
  const SessionRoute = () => (
    <I18nProvider value={{ locale: () => options.locale ?? 'zh-CN', t: createTranslator(options.locale ?? 'zh-CN') }}>
      <DialogProvider>
        <MarkedProvider>
          <SessionSurface
            options={options}
            onReady={(nextController) => {
              controller = nextController
              nextController.setOptimisticUserMessages(pendingOptimisticUserMessages)
            }}
          />
        </MarkedProvider>
      </DialogProvider>
    </I18nProvider>
  )

  const cleanupHost = () => {
    element.removeEventListener('click', onClickCapture, true)
    element.removeEventListener('click', onClick)
    releaseDocumentState()
    element.classList.remove('aryn-opencode-session-surface')
  }

  let disposeSolid: () => void
  try {
    disposeSolid = render(() => (
      <ErrorBoundary fallback={(cause) => <div class='aryn-opencode-surface-state' data-error='true' role='alert'>{String(cause)}</div>}>
        <MemoryRouter history={history} root={SessionRoute} />
      </ErrorBoundary>
    ), element)
  } catch (cause) {
    cleanupHost()
    throw cause
  }

  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      try {
        disposeSolid()
      } finally {
        cleanupHost()
      }
    },
    setOptimisticUserMessages(messages: OpenCodeOptimisticUserMessage[]) {
      if (disposed) return
      pendingOptimisticUserMessages = messages
      controller?.setOptimisticUserMessages(messages)
    },
  }
}

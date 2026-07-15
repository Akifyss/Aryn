import { normalizeToolCalls } from './upstream/pi-web/lib/normalize'
import type { AgentMessage, UserMessage } from './upstream/pi-web/lib/types'
import type { PiWebNativeSessionSnapshot, PiWebOptimisticUserMessage } from './contracts'

export type PiWebAgentPhase =
  | { kind: 'waiting_model' }
  | { kind: 'running_command' }
  | { kind: 'running_tools'; tools: Array<{ id: string; name: string }> }
  | null

export type PiWebSessionState = {
  agentPhase: PiWebAgentPhase
  agentRunning: boolean
  entryIds: string[]
  messages: AgentMessage[]
  optimisticMessages: AgentMessage[]
  streamingMessage: Partial<AgentMessage> | null
}

export type PiWebSessionAction =
  | { type: 'native_event'; event: { type: string; [key: string]: unknown } }
  | { type: 'set_optimistic'; messages: PiWebOptimisticUserMessage[] }
  | { type: 'set_snapshot'; snapshot: PiWebNativeSessionSnapshot }

function extractMessageText(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => (
      block && typeof block === 'object'
        && (block as { type?: string }).type === 'text'
        && typeof (block as { text?: unknown }).text === 'string'
        ? (block as { text: string }).text
        : ''
    ))
    .filter(Boolean)
    .join('\n')
}

function imageSignature(block: unknown): string {
  if (!block || typeof block !== 'object' || (block as { type?: unknown }).type !== 'image') return ''
  const source = (block as { source?: unknown }).source
  if (source && typeof source === 'object') {
    const src = source as { type?: unknown; media_type?: unknown; data?: unknown; url?: unknown }
    return [
      src.type === 'url' ? 'url' : 'base64',
      typeof src.media_type === 'string' ? src.media_type : '',
      typeof src.data === 'string' ? src.data : '',
      typeof src.url === 'string' ? src.url : '',
    ].join(':')
  }
  const flat = block as { data?: unknown; mimeType?: unknown }
  return [
    'base64',
    typeof flat.mimeType === 'string' ? flat.mimeType : '',
    typeof flat.data === 'string' ? flat.data : '',
    '',
  ].join(':')
}

/** Direct logic copy from pi-web/useAgentSession.ts, kept public for tests. */
export function piWebUserMessageKey(message: Partial<AgentMessage>): string {
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return JSON.stringify({ text: content, images: [] })
  if (!Array.isArray(content)) return JSON.stringify({ text: '', images: [] })
  return JSON.stringify({
    text: extractMessageText(message),
    images: content.map(imageSignature).filter(Boolean),
  })
}

function toOptimisticMessage(message: PiWebOptimisticUserMessage): AgentMessage {
  return {
    role: 'user',
    content: message.content as UserMessage['content'],
    timestamp: message.timestamp,
  } as AgentMessage
}

function normalizeSnapshot(snapshot: PiWebNativeSessionSnapshot) {
  return {
    entryIds: snapshot.entryIds.slice(0, snapshot.messages.length),
    messages: snapshot.messages.map(normalizeToolCalls),
  }
}

export function createPiWebSessionState(snapshot: PiWebNativeSessionSnapshot): PiWebSessionState {
  const normalized = normalizeSnapshot(snapshot)
  return {
    agentPhase: snapshot.isStreaming ? { kind: 'waiting_model' } : null,
    agentRunning: snapshot.isStreaming,
    entryIds: normalized.entryIds,
    messages: normalized.messages,
    optimisticMessages: [],
    streamingMessage: null,
  }
}

function reconcileOptimisticMessages(
  persisted: AgentMessage[],
  optimistic: AgentMessage[],
) {
  const unmatchedPersistedMessages = persisted
    .filter((message) => message.role === 'user')
  return optimistic.filter((message) => {
    const index = unmatchedPersistedMessages.findIndex((persistedMessage) => (
      isPersistedDeliveryForOptimistic(persistedMessage, message, false)
    ))
    if (index === -1) return true
    unmatchedPersistedMessages.splice(index, 1)
    return false
  })
}

function isPersistedDeliveryForOptimistic(
  persisted: Partial<AgentMessage>,
  optimistic: Partial<AgentMessage>,
  allowMissingPersistedTimestamp: boolean,
) {
  if (piWebUserMessageKey(persisted) !== piWebUserMessageKey(optimistic)) return false
  const persistedTimestamp = persisted.timestamp
  const optimisticTimestamp = optimistic.timestamp
  if (typeof persistedTimestamp !== 'number') return allowMissingPersistedTimestamp
  if (typeof optimisticTimestamp !== 'number') return true
  return persistedTimestamp >= optimisticTimestamp
}

export function reducePiWebSessionState(
  state: PiWebSessionState,
  action: PiWebSessionAction,
): PiWebSessionState {
  if (action.type === 'set_snapshot') {
    const normalized = normalizeSnapshot(action.snapshot)
    return {
      ...state,
      agentPhase: action.snapshot.isStreaming
        ? state.agentPhase ?? { kind: 'waiting_model' }
        : null,
      agentRunning: action.snapshot.isStreaming,
      entryIds: normalized.entryIds,
      messages: normalized.messages,
      optimisticMessages: reconcileOptimisticMessages(normalized.messages, state.optimisticMessages),
      streamingMessage: action.snapshot.isStreaming ? state.streamingMessage : null,
    }
  }

  if (action.type === 'set_optimistic') {
    const optimisticMessages = action.messages.map(toOptimisticMessage)
    return {
      ...state,
      optimisticMessages: reconcileOptimisticMessages(state.messages, optimisticMessages),
    }
  }

  const event = action.event
  switch (event.type) {
    case 'agent_start':
      return {
        ...state,
        agentPhase: { kind: 'waiting_model' },
        agentRunning: true,
        streamingMessage: null,
      }
    case 'agent_end':
      return {
        ...state,
        agentPhase: null,
        agentRunning: false,
        streamingMessage: null,
      }
    case 'message_start':
    case 'message_update': {
      if (!state.agentRunning) return state
      const message = event.message as AgentMessage | undefined
      if (!message || message.role === 'user') return state
      return {
        ...state,
        agentPhase: null,
        streamingMessage: normalizeToolCalls(message),
      }
    }
    case 'message_end': {
      if (!state.agentRunning) return state
      const completed = event.message as AgentMessage | undefined
      if (!completed) return state
      const delivered = normalizeToolCalls(completed)
      if (delivered.role === 'user') {
        const optimisticIndex = state.optimisticMessages.findIndex((message) => (
          isPersistedDeliveryForOptimistic(delivered, message, true)
        ))
        return {
          ...state,
          agentPhase: { kind: 'waiting_model' },
          entryIds: [...state.entryIds, ''],
          messages: [...state.messages, delivered],
          optimisticMessages: optimisticIndex === -1
            ? state.optimisticMessages
            : state.optimisticMessages.filter((_, index) => index !== optimisticIndex),
          streamingMessage: null,
        }
      }
      return {
        ...state,
        agentPhase: { kind: 'waiting_model' },
        entryIds: [...state.entryIds, ''],
        messages: [...state.messages, delivered],
        streamingMessage: null,
      }
    }
    case 'tool_execution_start': {
      if (!state.agentRunning) return state
      const id = String(event.toolCallId ?? '')
      const name = String(event.toolName ?? 'tool')
      const tools = state.agentPhase?.kind === 'running_tools'
        ? [...state.agentPhase.tools]
        : []
      if (!tools.some((tool) => tool.id === id)) tools.push({ id, name })
      return { ...state, agentPhase: { kind: 'running_tools', tools } }
    }
    case 'tool_execution_end': {
      if (!state.agentRunning) return state
      if (state.agentPhase?.kind !== 'running_tools') return state
      const tools = state.agentPhase.tools.filter((tool) => tool.id !== String(event.toolCallId ?? ''))
      return {
        ...state,
        agentPhase: tools.length > 0 ? { kind: 'running_tools', tools } : { kind: 'waiting_model' },
      }
    }
    default:
      return state
  }
}

export function getPiWebVisibleMessages(state: PiWebSessionState) {
  return [...state.messages, ...state.optimisticMessages]
}

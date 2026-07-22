import type { OpenCodeOptimisticUserMessage } from '@aryn/opencode-session-surface'
import type { PiWebOptimisticUserMessage } from '@aryn/pi-web-session-surface'
import type { AgentId } from '@/features/agent/agent-definition'
import { getOpenCodeUserMessageText } from '@/features/agent/lib/opencode-timeline'
import type {
  AgentSessionSnapshot,
  AgentSidebarMessage,
  PiWebAgentMessage,
} from '@/features/agent/types'

export type OptimisticAgentUserMessage = {
  agentId: AgentId
  message: AgentSidebarMessage
  nativePartIds?: string[]
  sessionPath: string
}

function getPiWebUserMessageText(message: PiWebAgentMessage) {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''

  return message.content.flatMap((part) => (
    part
      && typeof part === 'object'
      && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string'
      ? [(part as { text: string }).text]
      : []
  )).join('\n')
}

export function getPersistedAgentUserMessages(snapshot: AgentSessionSnapshot) {
  const native = snapshot.native

  if (native?.agentId === 'codex') {
    return native.thread.turns.flatMap((turn): AgentSidebarMessage[] => (
      turn.items.flatMap((item): AgentSidebarMessage[] => item.type === 'userMessage'
        ? [{
            id: item.clientId ?? item.id,
            kind: 'user',
            text: item.content.flatMap((input) => input.type === 'text' ? [input.text] : []).join('\n\n'),
            timestamp: (turn.startedAt ?? native.thread.createdAt) * 1_000,
          }]
        : [])
    ))
  }

  if (native?.agentId === 'opencode') {
    return native.messages.flatMap((record): AgentSidebarMessage[] => (
      record.info.role === 'user'
        ? [{
            id: record.info.id,
            kind: 'user',
            text: getOpenCodeUserMessageText(record),
            timestamp: record.info.time.created,
          }]
        : []
    ))
  }

  if (native?.agentId === 'pi' || native?.agentId === 'builtin-pi') {
    return native.messages.flatMap((message, index): AgentSidebarMessage[] => (
      message.role === 'user'
        ? [{
            id: typeof message.id === 'string' ? message.id : `pi-user-${index}`,
            kind: 'user',
            text: getPiWebUserMessageText(message),
            timestamp: typeof message.timestamp === 'number' ? message.timestamp : 0,
          }]
        : []
    ))
  }

  return snapshot.messages.filter((message) => message.kind === 'user')
}

export function reconcileOptimisticAgentUserMessages(
  current: OptimisticAgentUserMessage[],
  runtimeAgentId: AgentId,
  snapshot: AgentSessionSnapshot,
) {
  const persistedUsers = getPersistedAgentUserMessages(snapshot)
  if (persistedUsers.length === 0) {
    return current
  }

  const native = snapshot.native
  const contentFallbackUserIds = native?.agentId === 'codex'
    ? new Set(native.thread.turns.flatMap((turn) => turn.items.flatMap((item) => (
        item.type === 'userMessage' && !item.clientId ? [item.id] : []
      ))))
    : native?.agentId === 'opencode'
      ? new Set<string>()
      : new Set(persistedUsers.map((message) => message.id))
  const usedPersistedIds = new Set<string>()

  return current.filter((entry) => {
    if (
      entry.agentId !== runtimeAgentId
      || entry.sessionPath !== snapshot.sessionPath
    ) {
      return true
    }

    const match = persistedUsers.find((message) => (
      !usedPersistedIds.has(message.id)
      && (
        message.id === entry.message.id
        || (contentFallbackUserIds.has(message.id) && (
          message.text === entry.message.text
          && Math.abs(message.timestamp - entry.message.timestamp) <= 60_000
        ))
      )
    ))

    if (!match) {
      return true
    }

    usedPersistedIds.add(match.id)
    return false
  })
}

export function buildNativeOptimisticUserMessages(entries: OptimisticAgentUserMessage[]) {
  const messages = entries.map((entry) => entry.message)
  const openCodeMessages = entries.map((entry): OpenCodeOptimisticUserMessage => {
    const message = entry.message

    return {
      attachments: message.attachments?.flatMap((attachment, index) => {
        const url = attachment.data ?? (attachment.path
          ? encodeURI(`file:///${attachment.path.replaceAll('\\', '/')}`)
          : '')

        return url
          ? [{
              fileName: attachment.fileName,
              mimeType: attachment.mimeType,
              partId: entry.nativePartIds?.[index + 1] ?? `${message.id}-file-${String(index).padStart(4, '0')}`,
              url,
            }]
          : []
      }),
      id: message.id,
      text: message.text,
      textPartId: entry.nativePartIds?.[0] ?? `${message.id}-text`,
      timestamp: message.timestamp,
    }
  })
  const piWebMessages = entries.map((entry): PiWebOptimisticUserMessage => {
    const imageBlocks = entry.message.attachments?.flatMap((attachment) => {
      if (attachment.kind !== 'image' || !attachment.data) return []
      const match = attachment.data.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) return []

      return [{
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: match[1],
          data: match[2],
        },
      }]
    }) ?? []

    return {
      content: imageBlocks.length > 0
        ? [
            ...(entry.message.text ? [{ type: 'text' as const, text: entry.message.text }] : []),
            ...imageBlocks,
          ]
        : entry.message.text,
      timestamp: entry.message.timestamp,
    }
  })

  return {
    codex: messages,
    openCode: openCodeMessages,
    piWeb: piWebMessages,
  }
}

import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type {
  AssistantMessage,
  ToolResultMessage,
  UserMessage,
} from '@earendil-works/pi-ai'
import type {
  AgentSidebarMessage,
  PiWebAgentMessage,
} from '../../../../../src/features/agent/types'
import {
  AGENT_PROMPT_ATTACHMENT_PREFIX,
  asPiMessageText,
  extractPromptAttachmentsFromMessage,
} from './prompt-attachments'

export function clampText(value: string, maxLength: number) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}...`
}

function stringifyForDisplay(value: unknown) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function summarizeToolPayload(value: unknown, maxLength: number, fallback: string) {
  const summary = clampText(stringifyForDisplay(value), maxLength)
  return summary || fallback
}

function extractAssistantText(message: AssistantMessage) {
  return message.content
    .filter((block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
}

function stripMarkdownNoise(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[>\-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function trimSessionTitleLength(value: string) {
  const normalizedValue = value.trim()
  const maxLength = /[\u4e00-\u9fff]/u.test(normalizedValue) ? 18 : 48
  return normalizedValue.length > maxLength ? normalizedValue.slice(0, maxLength).trim() : normalizedValue
}

export function normalizeSessionTitle(value: string) {
  const normalizedLine = value
    .replace(/^\s*["'`]+/, '')
    .replace(/["'`]+$/, '')
    .replace(/^\s*(title|session title|标题)\s*[:：-]\s*/i, '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!normalizedLine) return null

  const compactTitle = trimSessionTitleLength(
    normalizedLine
      .replace(/[。！？!?;；:：,，、]+$/u, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
  if (!compactTitle) return null
  const lowerTitle = compactTitle.toLowerCase()
  if (lowerTitle === 'untitled' || lowerTitle === 'untitled session' || lowerTitle === 'new session') {
    return null
  }
  return compactTitle
}

export function buildFallbackSessionTitle(sourceText: string) {
  const normalizedSource = stripMarkdownNoise(sourceText)
  if (!normalizedSource) return null
  const firstSegment = normalizedSource
    .split(/[\n。！？!?]/u)
    .map((segment) => segment.trim())
    .find(Boolean)
    ?? normalizedSource
  const simplifiedSegment = firstSegment
    .replace(/^(请|帮我|我想|想要|希望|需要|麻烦|能否|可以|怎么|如何)\s*/u, '')
    .trim()
  return normalizeSessionTitle(simplifiedSegment || normalizedSource)
}

export function getAutoNamingContext(entries: SessionEntry[]) {
  let firstUserText: string | null = null
  let firstAssistantText: string | null = null
  let userMessageCount = 0

  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const { message } = entry
    if ('role' in message && message.role === 'user') {
      userMessageCount += 1
      if (!firstUserText) firstUserText = asPiMessageText(message.content)
      continue
    }
    if ('role' in message && message.role === 'assistant' && !firstAssistantText) {
      firstAssistantText = extractAssistantText(message)
    }
  }

  if (!firstUserText?.trim()) return null
  return {
    firstAssistantText: firstAssistantText?.trim() || null,
    firstUserText: firstUserText.trim(),
    userMessageCount,
  }
}

type SerializedBranchMessage = AgentSidebarMessage & {
  entryId?: string
}

function formatToolPayloadSection(label: string, value: string) {
  const trimmedValue = value.trim()
  return trimmedValue ? `**${label}**\n\`\`\`\n${trimmedValue}\n\`\`\`` : ''
}

function formatToolMessageText(argumentsValue: unknown, resultText?: string) {
  const sections: string[] = []
  const argumentText = stringifyForDisplay(argumentsValue).trim()
  const normalizedResultText = resultText?.trim() ?? ''
  if (argumentText) sections.push(formatToolPayloadSection('Arguments', argumentText))
  if (normalizedResultText) {
    sections.push(argumentText ? `**Result**\n${normalizedResultText}` : normalizedResultText)
  }
  return sections.join('\n\n').trim()
}

function serializeAssistantMessage(message: AssistantMessage, index: number): AgentSidebarMessage | null {
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()
  const thinkingText = message.content
    .filter((block) => block.type === 'thinking')
    .map((block) => block.thinking)
    .join('\n')
    .trim()
  const toolCalls = message.content.filter((block) => block.type === 'toolCall').map((block) => block.name)
  if (!text && toolCalls.length > 0 && !message.errorMessage) return null
  const fallbackText = message.errorMessage ?? (thinkingText ? '' : 'Assistant response')
  return {
    id: `assistant-${message.timestamp}-${index}`,
    kind: 'assistant',
    thinkingText: thinkingText || undefined,
    text: text || fallbackText,
    timestamp: message.timestamp,
    isError: message.stopReason === 'error',
  }
}

function serializeUserMessage(message: UserMessage, index: number): AgentSidebarMessage {
  const attachments = extractPromptAttachmentsFromMessage(message)
  return {
    id: `user-${message.timestamp}-${index}`,
    kind: 'user',
    ...(attachments.length > 0 ? { attachments } : {}),
    text: asPiMessageText(message.content).split(`\n\n${AGENT_PROMPT_ATTACHMENT_PREFIX}\n`)[0]?.trim() || 'User message',
    timestamp: message.timestamp,
  }
}

function serializeToolResult(message: ToolResultMessage, index: number): AgentSidebarMessage {
  const text = asPiMessageText(message.content) || stringifyForDisplay(message.details) || 'Tool finished without output.'
  return {
    id: message.toolCallId || `tool-${message.timestamp}-${index}`,
    kind: 'tool',
    status: message.isError ? 'error' : 'done',
    title: message.toolName,
    text,
    timestamp: message.timestamp,
    isError: message.isError,
  }
}

function serializeCustomMessage(
  message: Extract<AgentMessage, { role: 'bashExecution' | 'branchSummary' | 'compactionSummary' | 'custom' }>,
  index: number,
): AgentSidebarMessage | null {
  if (message.role === 'custom' && !message.display) return null
  if (message.role === 'bashExecution') {
    return {
      id: `bash-${message.timestamp}-${index}`,
      kind: 'system',
      title: message.command,
      text: message.output.trim() || 'Command completed without output.',
      timestamp: message.timestamp,
      isError: typeof message.exitCode === 'number' ? message.exitCode !== 0 : false,
    }
  }
  if (message.role === 'branchSummary') {
    return {
      id: `branch-summary-${message.timestamp}-${index}`,
      kind: 'system',
      title: 'Branch summary',
      text: message.summary,
      timestamp: message.timestamp,
    }
  }
  if (message.role === 'compactionSummary') {
    return {
      id: `compaction-summary-${message.timestamp}-${index}`,
      kind: 'system',
      title: 'Context summary',
      text: message.summary,
      timestamp: message.timestamp,
    }
  }
  return {
    id: `custom-${message.timestamp}-${index}`,
    kind: 'custom',
    title: message.customType,
    text: asPiMessageText(message.content) || message.customType,
    timestamp: message.timestamp,
  }
}

export function serializeMessage(message: AgentMessage, index: number): AgentSidebarMessage | null {
  if ('role' in message && message.role === 'user') return serializeUserMessage(message, index)
  if ('role' in message && message.role === 'assistant') return serializeAssistantMessage(message, index)
  if ('role' in message && message.role === 'toolResult') return serializeToolResult(message, index)
  if (
    'role' in message
    && (
      message.role === 'bashExecution'
      || message.role === 'branchSummary'
      || message.role === 'compactionSummary'
      || message.role === 'custom'
    )
  ) {
    return serializeCustomMessage(message, index)
  }
  return null
}

export function parseEntryTimestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? Date.now() : parsed
}

/** Preserve PI's full native branch for the vendored pi-web renderer. */
export function serializePiWebSessionEntries(entries: SessionEntry[]) {
  const messages: PiWebAgentMessage[] = []
  const entryIds: string[] = []
  for (const entry of entries) {
    let message: PiWebAgentMessage | null = null
    if (entry.type === 'message') {
      message = entry.message as unknown as PiWebAgentMessage
    } else if (entry.type === 'compaction') {
      message = {
        role: 'custom',
        customType: 'compaction',
        content: entry.summary,
        display: true,
        details: { tokensBefore: entry.tokensBefore, firstKeptEntryId: entry.firstKeptEntryId },
        timestamp: parseEntryTimestamp(entry.timestamp),
      }
    } else if (entry.type === 'branch_summary' && entry.summary) {
      message = {
        role: 'user',
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        timestamp: parseEntryTimestamp(entry.timestamp),
      }
    } else if (entry.type === 'custom_message') {
      message = {
        role: 'custom',
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        timestamp: parseEntryTimestamp(entry.timestamp),
      }
    }
    if (message) {
      messages.push(message)
      entryIds.push(entry.id)
    }
  }
  return { entryIds, messages }
}

function pushSerializedMessage(
  messages: SerializedBranchMessage[],
  entryMessages: Map<string, SerializedBranchMessage>,
  message: SerializedBranchMessage,
) {
  messages.push(message)
  if (message.entryId) entryMessages.set(message.entryId, message)
}

export function serializeSessionEntries(entries: SessionEntry[]) {
  const messages: SerializedBranchMessage[] = []
  const entryMessages = new Map<string, SerializedBranchMessage>()
  const toolArguments = new Map<string, unknown>()
  const toolMessages = new Map<string, SerializedBranchMessage>()

  entries.forEach((entry, index) => {
    const timestamp = parseEntryTimestamp(entry.timestamp)
    switch (entry.type) {
      case 'message': {
        const message = entry.message
        if ('role' in message && message.role === 'user') {
          pushSerializedMessage(messages, entryMessages, { ...serializeUserMessage(message, index), entryId: entry.id })
          return
        }
        if ('role' in message && message.role === 'assistant') {
          const assistantMessage = serializeAssistantMessage(message, index)
          let labelTarget: SerializedBranchMessage | null = assistantMessage
            ? { ...assistantMessage, entryId: entry.id }
            : null
          if (labelTarget) pushSerializedMessage(messages, entryMessages, labelTarget)
          message.content.filter((block) => block.type === 'toolCall').forEach((toolCall, toolIndex) => {
            const toolMessage: SerializedBranchMessage = {
              id: toolCall.id || `tool-call-${entry.id}-${toolIndex}`,
              kind: 'tool',
              status: 'running',
              text: formatToolMessageText(toolCall.arguments) || 'Tool was called without arguments.',
              timestamp,
              title: toolCall.name,
            }
            if (!labelTarget) {
              toolMessage.entryId = entry.id
              labelTarget = toolMessage
            }
            pushSerializedMessage(messages, entryMessages, toolMessage)
            if (toolCall.id) {
              toolArguments.set(toolCall.id, toolCall.arguments)
              toolMessages.set(toolCall.id, toolMessage)
            }
          })
          return
        }
        if ('role' in message && message.role === 'toolResult') {
          const resultText = asPiMessageText(message.content)
            || stringifyForDisplay(message.details)
            || 'Tool finished without output.'
          const existingToolMessage = message.toolCallId ? toolMessages.get(message.toolCallId) : undefined
          if (existingToolMessage) {
            entryMessages.set(entry.id, existingToolMessage)
            existingToolMessage.status = message.isError ? 'error' : 'done'
            existingToolMessage.isError = message.isError
            existingToolMessage.text = formatToolMessageText(
              toolArguments.get(message.toolCallId),
              resultText,
            ) || resultText
            return
          }
          pushSerializedMessage(messages, entryMessages, { ...serializeToolResult(message, index), entryId: entry.id })
          return
        }
        const serializedMessage = serializeMessage(message, index)
        if (serializedMessage) {
          pushSerializedMessage(messages, entryMessages, { ...serializedMessage, entryId: entry.id })
        }
        return
      }
      case 'model_change':
      case 'thinking_level_change':
        return
      case 'compaction':
        pushSerializedMessage(messages, entryMessages, {
          id: `${entry.type}-${entry.id}`,
          entryId: entry.id,
          kind: 'system',
          text: entry.summary || 'Session context was compacted.',
          timestamp,
          title: 'Compaction summary',
        })
        return
      case 'branch_summary':
        pushSerializedMessage(messages, entryMessages, {
          id: `${entry.type}-${entry.id}`,
          entryId: entry.id,
          kind: 'system',
          text: entry.summary,
          timestamp,
          title: 'Branch summary',
        })
        return
      case 'custom_message':
        if (!entry.display) return
        pushSerializedMessage(messages, entryMessages, {
          id: `${entry.type}-${entry.id}`,
          entryId: entry.id,
          kind: 'custom',
          text: asPiMessageText(entry.content) || entry.customType,
          timestamp,
          title: entry.customType,
        })
        return
      case 'label': {
        const targetMessage = entryMessages.get(entry.targetId)
        if (targetMessage) targetMessage.label = entry.label?.trim() || undefined
        return
      }
      case 'session_info':
      case 'custom':
      default:
        return
    }
  })

  return messages.map(({ entryId, ...message }) => ({
    ...message,
    ...(entryId ? { sessionEntryId: entryId } : {}),
  }))
}

import type {
  AgentMessageFileChange,
  AgentThinkingLevel,
} from '../../../../../src/features/agent/types'

export type JsonRecord = Record<string, unknown>

export type PiCliSessionRecord = {
  createdAt: string
  cwd: string
  id: string
  materialized: boolean
  modelKey: string | null
  messageCount?: number
  name: string | null
  preview?: string | null
  sessionPath?: string | null
  thinkingLevel: AgentThinkingLevel
  updatedAt: string
}

export type PiCliSessionIndex = {
  sessions: PiCliSessionRecord[]
  version: 1
}

export type PiRpcModel = {
  id: string
  input?: string[]
  name?: string
  provider: string
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<AgentThinkingLevel, unknown>>
}

export const DEFAULT_PI_CLI_SESSION_INDEX: PiCliSessionIndex = { sessions: [], version: 1 }
export const PI_CLI_THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

export function normalizeNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizePiThinkingLevel(value: unknown): AgentThinkingLevel {
  return typeof value === 'string' && PI_CLI_THINKING_LEVELS.includes(value as AgentThinkingLevel)
    ? value as AgentThinkingLevel
    : 'medium'
}

export function normalizePiCliSessionIndex(value: unknown): PiCliSessionIndex {
  const candidate = value && typeof value === 'object' ? value as JsonRecord : {}
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions.flatMap((entry): PiCliSessionRecord[] => {
        const record = entry && typeof entry === 'object' ? entry as JsonRecord : {}
        const id = normalizeNullableString(record.id)
        const cwd = normalizeNullableString(record.cwd)
        if (!id || !cwd) return []
        const createdAt = normalizeNullableString(record.createdAt) ?? new Date(0).toISOString()
        return [{
          createdAt,
          cwd,
          id,
          materialized: typeof record.materialized === 'boolean' ? record.materialized : true,
          modelKey: normalizeNullableString(record.modelKey),
          name: normalizeNullableString(record.name),
          thinkingLevel: normalizePiThinkingLevel(record.thinkingLevel),
          updatedAt: normalizeNullableString(record.updatedAt) ?? createdAt,
        }]
      })
    : []
  return { sessions, version: 1 }
}

export function readPiResponseData(response: JsonRecord) {
  return response.data && typeof response.data === 'object' ? response.data as JsonRecord : {}
}

function textFromContent(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const candidate = part as JsonRecord
      return candidate.type === 'text' ? [String(candidate.text ?? '')] : []
    })
    .filter(Boolean)
    .join('\n\n')
}

export function projectPiFileAnnotations(rawMessages: unknown) {
  const fileChangesByEntryId: Record<string, AgentMessageFileChange[]> = {}
  if (!Array.isArray(rawMessages)) return { fileChangesByEntryId }
  for (const entry of rawMessages) {
    if (!entry || typeof entry !== 'object') continue
    const message = entry as JsonRecord
    if (String(message.role ?? '') !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue
      const toolCall = part as JsonRecord
      if (toolCall.type !== 'toolCall') continue
      const toolName = String(toolCall.name ?? toolCall.toolName ?? '')
      if (toolName !== 'write' && toolName !== 'edit') continue
      const args = toolCall.arguments && typeof toolCall.arguments === 'object'
        ? toolCall.arguments as JsonRecord
        : toolCall.input && typeof toolCall.input === 'object'
          ? toolCall.input as JsonRecord
          : {}
      const filePath = normalizeNullableString(args.path ?? args.filePath)
      const toolCallId = normalizeNullableString(toolCall.id ?? toolCall.toolCallId)
      if (filePath && toolCallId) {
        fileChangesByEntryId[toolCallId] = [{ filePath, kind: 'updated' }]
      }
    }
  }
  return { fileChangesByEntryId }
}

export function summarizePiToolPayload(message: JsonRecord, resultKey: 'partialResult' | 'result') {
  const result = message[resultKey]
  if (result && typeof result === 'object') {
    const text = textFromContent((result as JsonRecord).content)
    if (text) return text
  }
  const args = message.args
  if (args && typeof args === 'object') {
    const candidate = args as JsonRecord
    return String(candidate.command ?? candidate.path ?? JSON.stringify(candidate))
  }
  return String(message.toolName ?? 'tool')
}

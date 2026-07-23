import type { Model } from '../../../../../src/features/agent/codex-protocol/generated/v2/Model'
import type { Thread } from '../../../../../src/features/agent/codex-protocol/generated/v2/Thread'
import type { ThreadSourceKind } from '../../../../../src/features/agent/codex-protocol/generated/v2/ThreadSourceKind'
import type {
  AgentMessageFileChange,
  AgentThinkingLevel,
} from '../../../../../src/features/agent/types'

type JsonRecord = Record<string, unknown>

export type CodexThreadRecord = {
  createdAt: string
  cwd: string
  id: string
  materialized: boolean
  model: string | null
  modelExplicit: boolean
  name: string | null
  preview?: string | null
  reasoningEffort: AgentThinkingLevel
  updatedAt: string
}

export type CodexThreadIndex = {
  threads: CodexThreadRecord[]
  version: 1
}

export const DEFAULT_CODEX_THREAD_INDEX: CodexThreadIndex = { threads: [], version: 1 }
export const CODEX_THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
export const TOP_LEVEL_CODEX_THREAD_SOURCE_KINDS: ThreadSourceKind[] = [
  'cli',
  'vscode',
  'exec',
  'appServer',
  'unknown',
]

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function normalizeCodexReasoningEffort(value: unknown): AgentThinkingLevel {
  if (value === 'none') return 'off'
  return typeof value === 'string' && CODEX_THINKING_LEVELS.includes(value as AgentThinkingLevel)
    ? value as AgentThinkingLevel
    : 'medium'
}

export function toCodexReasoningEffort(value: AgentThinkingLevel) {
  return value === 'off' ? 'none' : value
}

export function getCodexModelThinkingLevels(model: Model): AgentThinkingLevel[] {
  const levels = model.supportedReasoningEfforts
    .map((option) => normalizeCodexReasoningEffort(option.reasoningEffort))
    .filter((effort, index, values) => values.indexOf(effort) === index)
  return levels.length > 0 ? levels : ['low', 'medium', 'high']
}

export function normalizeCodexThreadIndex(value: unknown): CodexThreadIndex {
  const candidate = value && typeof value === 'object' ? value as JsonRecord : {}
  const threads = Array.isArray(candidate.threads)
    ? candidate.threads.flatMap((entry): CodexThreadRecord[] => {
        const thread = entry && typeof entry === 'object' ? entry as JsonRecord : {}
        const id = nullableString(thread.id)
        const cwd = nullableString(thread.cwd)
        if (!id || !cwd) return []
        const createdAt = nullableString(thread.createdAt) ?? new Date(0).toISOString()
        return [{
          createdAt,
          cwd,
          id,
          materialized: typeof thread.materialized === 'boolean' ? thread.materialized : true,
          model: nullableString(thread.model),
          modelExplicit: thread.modelExplicit === true,
          name: nullableString(thread.name),
          preview: nullableString(thread.preview),
          reasoningEffort: normalizeCodexReasoningEffort(thread.reasoningEffort),
          updatedAt: nullableString(thread.updatedAt) ?? createdAt,
        }]
      })
    : []
  return { threads, version: 1 }
}

export function getCodexFileChanges(thread: Thread) {
  const fileChangesByEntryId: Record<string, AgentMessageFileChange[]> = {}
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type !== 'fileChange') continue
      fileChangesByEntryId[item.id] = item.changes.map((change) => ({
        filePath: change.path,
        kind: change.kind.type === 'add'
          ? 'created'
          : change.kind.type === 'delete'
            ? 'deleted'
            : 'updated',
      }))
    }
  }
  return fileChangesByEntryId
}

export function countCodexThreadMessages(thread: Thread) {
  return thread.turns.reduce((count, turn) => count + turn.items.filter((item) => (
    item.type === 'userMessage' || item.type === 'agentMessage'
  )).length, 0)
}

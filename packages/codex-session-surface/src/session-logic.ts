import type {
  OrchestrationThreadActivity,
  ToolLifecycleItemType,
  TurnId,
} from './compat/contracts'
import type { ChatMessage, ProposedPlan } from './types'

export type WorkLogToolLifecycleStatus =
  | 'inProgress'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'stopped'

export interface WorkLogEntry {
  id: string
  createdAt: string
  turnId?: TurnId | null
  label: string
  detail?: string
  command?: string
  rawCommand?: string
  changedFiles?: ReadonlyArray<string>
  tone: 'thinking' | 'tool' | 'info' | 'error'
  toolTitle?: string
  toolData?: unknown
  itemType?: ToolLifecycleItemType
  requestKind?: 'command' | 'file-read' | 'file-change'
  toolLifecycleStatus?: WorkLogToolLifecycleStatus
  sourceActivityKind?: OrchestrationThreadActivity['kind']
}

export type TimelineEntry =
  | { id: string; kind: 'message'; createdAt: string; message: ChatMessage }
  | { id: string; kind: 'proposed-plan'; createdAt: string; proposedPlan: ProposedPlan }
  | { id: string; kind: 'work'; createdAt: string; entry: WorkLogEntry }

export function workLogEntryIsToolLike(entry: WorkLogEntry): boolean {
  if (entry.tone === 'tool' || entry.tone === 'thinking' || entry.tone === 'error') return true
  if (entry.command !== undefined && entry.command.trim().length > 0) return true
  if (entry.requestKind !== undefined) return true
  return entry.itemType !== undefined
}

function toolDetailTextLooksLikeFailure(text: string): boolean {
  const t = text.toLowerCase()
  if (t.includes('file not found') || t.includes('no files found')) return true
  if (t.includes('enoent') || t.includes('no such file or directory') || t.includes('no such file')) return true
  if (t.includes('cannot find path') && t.includes('because it does not exist')) return true
  if (t.includes('commandnotfoundexception')) return true
  if (t.includes('is not recognized as the name of a cmdlet')) return true
  if (t.includes('is not recognized') && t.includes("the term '")) return true
  if (t.includes('a parameter cannot be found that matches parameter name')) return true
  if (t.includes('command not found')) return true
  if (/<exited with exit code\s+[1-9]\d*\s*>/i.test(text)) return true
  if (/exit(?:ed)? with exit code\s+[1-9]\d*/i.test(text)) return true
  return /exit code\s*[:\s]\s*[1-9]\d*\b/i.test(text)
}

export function workEntryIndicatesToolFailure(entry: WorkLogEntry): boolean {
  if (entry.tone === 'error') return true
  const status = entry.toolLifecycleStatus
  if (status === 'failed' || status === 'declined') return true
  if (!workLogEntryIsToolLike(entry)) return false
  const detail = [entry.detail, entry.command].filter(Boolean).join('\n')
  return detail.length > 0 && toolDetailTextLooksLikeFailure(detail)
}

export function workEntryIndicatesToolSuccess(entry: WorkLogEntry): boolean {
  if (!workLogEntryIsToolLike(entry) || workEntryIndicatesToolFailure(entry)) return false
  if (entry.tone === 'thinking') return false
  const status = entry.toolLifecycleStatus
  return status !== 'failed' && status !== 'declined' && status !== 'inProgress' && status !== 'stopped'
}

export function workEntryIndicatesToolNeutralStatus(entry: WorkLogEntry): boolean {
  return workLogEntryIsToolLike(entry)
    && !workEntryIndicatesToolFailure(entry)
    && !workEntryIndicatesToolSuccess(entry)
}

export function formatDuration(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) return '0ms'
  if (durationMs < 1_000) return `${Math.max(1, Math.round(durationMs))}ms`
  if (durationMs < 10_000) {
    const tenths = Math.round(durationMs / 100) / 10
    return tenths >= 10 ? '10s' : `${tenths.toFixed(1)}s`
  }
  if (durationMs < 60_000) return `${Math.round(durationMs / 1_000)}s`
  const minutes = Math.floor(durationMs / 60_000)
  const seconds = Math.round((durationMs % 60_000) / 1_000)
  if (seconds === 0) return `${minutes}m`
  if (seconds === 60) return `${minutes + 1}m`
  return `${minutes}m ${seconds}s`
}

export function deriveTimelineEntries(
  messages: ReadonlyArray<ChatMessage>,
  proposedPlans: ReadonlyArray<ProposedPlan>,
  workEntries: ReadonlyArray<WorkLogEntry>,
): TimelineEntry[] {
  const messageRows: TimelineEntry[] = messages.map((message) => ({
    id: message.id,
    kind: 'message',
    createdAt: message.createdAt,
    message,
  }))
  const proposedPlanRows: TimelineEntry[] = proposedPlans.map((proposedPlan) => ({
    id: proposedPlan.id,
    kind: 'proposed-plan',
    createdAt: proposedPlan.createdAt,
    proposedPlan,
  }))
  const workRows: TimelineEntry[] = workEntries.map((entry) => ({
    id: entry.id,
    kind: 'work',
    createdAt: entry.createdAt,
    entry,
  }))
  return [...messageRows, ...proposedPlanRows, ...workRows].toSorted((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )
}

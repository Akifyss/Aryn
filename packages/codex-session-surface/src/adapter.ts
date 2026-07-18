import type { OrchestrationLatestTurn } from './compat/contracts'
import type {
  CodexNativeSessionSnapshot,
  CodexOptimisticUserMessage,
} from './contracts'
import { deriveTimelineEntries, type WorkLogEntry, type WorkLogToolLifecycleStatus } from './session-logic'
import type { ChatAttachment, ChatMessage, ProposedPlan, TurnDiffSummary } from './types'

type ThreadItem = CodexNativeSessionSnapshot['thread']['turns'][number]['items'][number]

export type CodexTimelineModel = {
  activeTurnInProgress: boolean
  activeTurnStartedAt: string | null
  isWorking: boolean
  latestTurn: OrchestrationLatestTurn | null
  messages: ChatMessage[]
  proposedPlans: ProposedPlan[]
  runningTurnId: string | null
  timelineEntries: ReturnType<typeof deriveTimelineEntries>
  turnDiffSummaryByAssistantMessageId: Map<string, TurnDiffSummary>
  workEntries: WorkLogEntry[]
}

function epochMs(value: number | null | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return value < 1_000_000_000_000 ? value * 1_000 : value
}

function isoAt(base: number, ordinal: number) {
  return new Date(base + ordinal).toISOString()
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function compactText(value: unknown, maxLength = 180) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text
}

function jsonPreview(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return compactText(value)
  try {
    return compactText(JSON.stringify(value))
  } catch {
    return compactText(String(value))
  }
}

function itemStatus(item: ThreadItem): WorkLogToolLifecycleStatus | undefined {
  const status = stringValue(item.status)
  if (status === 'inProgress' || status === 'completed' || status === 'failed' || status === 'declined') return status
  if (status === 'interrupted' || status === 'stopped') return 'stopped'
  if (item.success === false) return 'failed'
  if (item.success === true) return 'completed'
  return undefined
}

function itemTone(item: ThreadItem): WorkLogEntry['tone'] {
  const status = itemStatus(item)
  return status === 'failed' || status === 'declined' ? 'error' : 'tool'
}

function userMessageText(item: ThreadItem) {
  return arrayValue(item.content)
    .map(recordValue)
    .filter((input): input is Record<string, unknown> => input !== null && input.type === 'text')
    .map((input) => stringValue(input.text))
    .filter(Boolean)
    .join('\n\n')
}

function localFileUrl(filePath: string) {
  const normalized = filePath.replace(/\\/g, '/')
  if (normalized.startsWith('//')) {
    const [host, ...segments] = normalized.slice(2).split('/')
    if (!host) return filePath
    const url = new URL(`file://${host}/`)
    url.pathname = `/${segments.join('/')}`
    return url.href
  }
  if (/^[a-z]:\//i.test(normalized) || normalized.startsWith('/')) {
    const url = new URL('file:///')
    url.pathname = normalized.startsWith('/') ? normalized : `/${normalized}`
    return url.href
  }
  return filePath
}

function userMessageAttachments(item: ThreadItem): ChatAttachment[] {
  return arrayValue(item.content).flatMap((value, index) => {
    const input = recordValue(value)
    if (!input || input.type === 'text') return []
    const path = stringValue(input.path)
    const url = stringValue(input.url) || path
    const name = stringValue(input.name) || url.split(/[\\/]/).at(-1) || String(input.type)
    const previewUrl = input.type === 'image'
      ? url
      : input.type === 'localImage' && url
        ? localFileUrl(url)
        : undefined
    return [{
      id: `${item.id}:attachment:${index}`,
      name,
      type: stringValue(input.type),
      previewUrl: previewUrl || undefined,
      url: url || undefined,
    }]
  })
}

function optimisticAttachments(message: CodexOptimisticUserMessage): ChatAttachment[] {
  return (message.attachments ?? []).map((attachment, index) => {
    const url = attachment.url || attachment.path
    const isImage = attachment.mimeType?.startsWith('image/') ?? false
    return {
      id: attachment.id ?? `${message.id}:attachment:${index}`,
      name: attachment.name ?? attachment.path?.split(/[\\/]/).at(-1) ?? 'attachment',
      mimeType: attachment.mimeType,
      previewUrl: isImage && url
        ? attachment.url || localFileUrl(url)
        : undefined,
      type: isImage ? 'image' : 'file',
      url,
    }
  })
}

function changedFiles(item: ThreadItem) {
  return arrayValue(item.changes).flatMap((value) => {
    const change = recordValue(value)
    const path = stringValue(change?.path)
    return path ? [path] : []
  })
}

function countDiffLines(diff: string) {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

function turnDiffSummary(
  turn: CodexNativeSessionSnapshot['thread']['turns'][number],
  completedAt: string,
): TurnDiffSummary | null {
  const files = new Map<string, TurnDiffSummary['files'][number]>()
  for (const item of turn.items) {
    if (item.type !== 'fileChange') continue
    for (const value of arrayValue(item.changes)) {
      const change = recordValue(value)
      const path = stringValue(change?.path)
      if (!path) continue
      const patch = stringValue(change?.diff)
      const stats = countDiffLines(patch)
      files.set(path, { path, patch: patch || undefined, ...stats })
    }
  }
  return files.size > 0 ? { turnId: turn.id, completedAt, files: [...files.values()] } : null
}

function runtimePlanMarkdown(
  runtime: CodexNativeSessionSnapshot['turnRuntime'][string] | undefined,
) {
  const plan = runtime?.plan
  if (!plan || plan.steps.length === 0) return ''
  const explanation = plan.explanation?.trim()
  const steps = plan.steps.map(({ status, step }) => {
    const checkbox = status === 'completed' ? '[x]' : '[ ]'
    const suffix = status === 'inProgress' ? ' _(in progress)_' : ''
    return `- ${checkbox} ${step}${suffix}`
  })
  return [explanation, steps.join('\n')].filter(Boolean).join('\n\n')
}

function workEntryForItem(
  item: ThreadItem,
  createdAt: string,
  turnId: string,
  snapshot: CodexNativeSessionSnapshot,
): WorkLogEntry | null {
  const runtime = snapshot.itemRuntime[item.id]
  const lifecycle = itemStatus(item)
  const base = {
    id: item.id,
    createdAt,
    turnId,
    tone: itemTone(item),
    toolLifecycleStatus: lifecycle,
  } satisfies Pick<WorkLogEntry, 'id' | 'createdAt' | 'turnId' | 'tone' | 'toolLifecycleStatus'>

  switch (item.type) {
    case 'reasoning': {
      const summary = arrayValue(item.summary).map(stringValue).filter(Boolean).join('\n')
      return {
        ...base,
        label: 'Thinking',
        detail: summary || undefined,
        tone: 'thinking',
      }
    }
    case 'commandExecution': {
      const command = stringValue(item.command)
      const output = stringValue(item.aggregatedOutput) || runtime?.output || ''
      const exitCode = typeof item.exitCode === 'number' ? item.exitCode : null
      return {
        ...base,
        label: 'Shell',
        toolTitle: 'Shell',
        command,
        detail: output || undefined,
        itemType: 'command_execution',
        requestKind: 'command',
        tone: exitCode !== null && exitCode !== 0 ? 'error' : base.tone,
        toolLifecycleStatus: exitCode !== null && exitCode !== 0 ? 'failed' : lifecycle,
      }
    }
    case 'fileChange': {
      const files = changedFiles(item)
      return {
        ...base,
        label: files.length === 1 ? 'Updated file' : `Updated ${files.length} files`,
        toolTitle: 'File change',
        changedFiles: files,
        detail: runtime?.output || undefined,
        itemType: 'file_change',
        requestKind: 'file-change',
      }
    }
    case 'mcpToolCall': {
      const server = stringValue(item.server)
      const tool = stringValue(item.tool)
      const error = recordValue(item.error)
      const result = recordValue(item.result)
      return {
        ...base,
        label: `${server} / ${tool}`,
        toolTitle: tool || 'MCP tool',
        detail: error ? jsonPreview(error) : runtime?.progress.at(-1) || jsonPreview(result),
        toolData: item.arguments,
        itemType: 'mcp_tool_call',
        tone: error ? 'error' : base.tone,
        toolLifecycleStatus: error ? 'failed' : lifecycle,
      }
    }
    case 'dynamicToolCall': {
      const tool = stringValue(item.tool)
      return {
        ...base,
        label: tool || 'Dynamic tool',
        toolTitle: tool || 'Dynamic tool',
        detail: jsonPreview(item.contentItems),
        toolData: item.arguments,
        itemType: 'dynamic_tool_call',
      }
    }
    case 'collabAgentToolCall':
      return {
        ...base,
        label: `Agent ${stringValue(item.tool)}`,
        toolTitle: `Agent ${stringValue(item.tool)}`,
        detail: compactText(item.prompt) || undefined,
        itemType: 'collab_agent_tool_call',
      }
    case 'subAgentActivity':
      return {
        ...base,
        label: `Sub-agent ${stringValue(item.kind)}`,
        detail: stringValue(item.agentPath) || undefined,
        itemType: 'collab_agent_tool_call',
      }
    case 'webSearch':
      return {
        ...base,
        label: 'Web search',
        detail: compactText(item.query) || compactText(item.url) || undefined,
        itemType: 'web_search',
      }
    case 'imageView':
      return { ...base, label: 'Viewed image', detail: stringValue(item.path), itemType: 'image_view' }
    case 'imageGeneration':
      return {
        ...base,
        label: 'Generated image',
        detail: stringValue(item.savedPath) || compactText(item.revisedPrompt) || stringValue(item.result),
        itemType: 'image_generation',
      }
    case 'sleep':
      return { ...base, label: 'Waited', detail: `${String(item.durationMs)} ms`, itemType: 'sleep' }
    case 'hookPrompt':
      return { ...base, label: 'Hook prompt', detail: jsonPreview(item.fragments), itemType: 'hook_prompt' }
    case 'enteredReviewMode':
      return { ...base, label: 'Entered review mode', detail: stringValue(item.review), itemType: 'review' }
    case 'exitedReviewMode':
      return { ...base, label: 'Exited review mode', detail: stringValue(item.review), itemType: 'review' }
    case 'contextCompaction':
      return { ...base, label: 'Context compacted', tone: 'info', itemType: 'context_compaction' }
    default:
      return {
        ...base,
        label: 'Codex activity',
        detail: compactText(item.type) || undefined,
        tone: 'info',
      }
  }
}

function turnState(status: string): OrchestrationLatestTurn['state'] {
  if (status === 'inProgress') return 'running'
  if (status === 'interrupted' || status === 'cancelled') return 'interrupted'
  if (status === 'failed') return 'failed'
  return 'completed'
}

export function createCodexTimelineModel(
  snapshot: CodexNativeSessionSnapshot,
  optimisticUserMessages: ReadonlyArray<CodexOptimisticUserMessage> = [],
): CodexTimelineModel {
  const messages: ChatMessage[] = []
  const proposedPlans: ProposedPlan[] = []
  const turnDiffSummaryByAssistantMessageId = new Map<string, TurnDiffSummary>()
  const workEntries: WorkLogEntry[] = []
  const persistedUsers: Array<{
    clientId: string
    id: string
    text: string
    timestamp: number
  }> = []
  const matchedPersistedUserIds = new Set<string>()
  const threadCreatedAt = epochMs(snapshot.thread.createdAt, Date.now())

  for (let turnIndex = 0; turnIndex < snapshot.thread.turns.length; turnIndex += 1) {
    const turn = snapshot.thread.turns[turnIndex]!
    const turnStart = epochMs(turn.startedAt, threadCreatedAt + turnIndex * 10_000)
    const lastAgentMessageIndex = turn.items.findLastIndex((item) => item.type === 'agentMessage')
    for (let itemIndex = 0; itemIndex < turn.items.length; itemIndex += 1) {
      const item = turn.items[itemIndex]!
      const createdAt = isoAt(turnStart, itemIndex * 10)
      const updatedAt = turn.completedAt === null
        ? createdAt
        : new Date(Math.max(epochMs(turn.completedAt, turnStart), Date.parse(createdAt))).toISOString()

      if (item.type === 'userMessage') {
        const clientId = stringValue(item.clientId)
        const text = userMessageText(item)
        persistedUsers.push({
          clientId,
          id: item.id,
          text,
          timestamp: Date.parse(createdAt),
        })
        messages.push({
          id: item.id,
          role: 'user',
          text,
          attachments: userMessageAttachments(item),
          turnId: turn.id,
          streaming: false,
          createdAt,
          updatedAt: createdAt,
        })
        continue
      }

      if (item.type === 'agentMessage') {
        messages.push({
          id: item.id,
          role: 'assistant',
          text: stringValue(item.text),
          turnId: turn.id,
          streaming: turn.status === 'inProgress' && itemIndex === lastAgentMessageIndex,
          createdAt,
          updatedAt,
        })
        continue
      }

      if (item.type === 'plan') {
        proposedPlans.push({
          id: item.id,
          turnId: turn.id,
          planMarkdown: stringValue(item.text),
          implementedAt: null,
          implementationThreadId: null,
          createdAt,
          updatedAt,
        })
        continue
      }

      const workEntry = workEntryForItem(item, createdAt, turn.id, snapshot)
      if (workEntry) workEntries.push(workEntry)
    }

    const runtimePlan = runtimePlanMarkdown(snapshot.turnRuntime[turn.id])
    if (runtimePlan && !turn.items.some((item) => item.type === 'plan')) {
      const createdAt = isoAt(turnStart, turn.items.length * 10 + 1)
      proposedPlans.push({
        id: `${turn.id}:runtime-plan`,
        turnId: turn.id,
        planMarkdown: runtimePlan,
        implementedAt: null,
        implementationThreadId: null,
        createdAt,
        updatedAt: createdAt,
      })
    }

    if (lastAgentMessageIndex >= 0) {
      const assistant = turn.items[lastAgentMessageIndex]!
      const completedAt = new Date(epochMs(turn.completedAt, turnStart)).toISOString()
      const summary = turnDiffSummary(turn, completedAt)
      if (summary) turnDiffSummaryByAssistantMessageId.set(assistant.id, summary)
    }

    if (turn.error?.message) {
      workEntries.push({
        id: `${turn.id}:error`,
        createdAt: isoAt(epochMs(turn.completedAt, turnStart), 1),
        turnId: turn.id,
        label: 'Turn failed',
        detail: turn.error.message,
        tone: 'error',
        toolLifecycleStatus: 'failed',
        sourceActivityKind: 'runtime.error',
      })
    }
  }

  for (const message of optimisticUserMessages) {
    const persisted = persistedUsers.find((candidate) => (
      !matchedPersistedUserIds.has(candidate.id)
      && (
        candidate.clientId === message.id
        || (
          !candidate.clientId
          && candidate.text === message.text
          && Math.abs(candidate.timestamp - message.timestamp) <= 60_000
        )
      )
    ))
    if (persisted) {
      matchedPersistedUserIds.add(persisted.id)
      continue
    }
    const timestamp = new Date(message.timestamp).toISOString()
    messages.push({
      id: `optimistic:${message.id}`,
      role: 'user',
      text: message.text,
      attachments: optimisticAttachments(message),
      turnId: null,
      streaming: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  }

  for (let index = 0; index < snapshot.notices.length; index += 1) {
    const notice = snapshot.notices[index]!
    workEntries.push({
      id: `notice:${notice.id}`,
      createdAt: isoAt(epochMs(snapshot.thread.updatedAt, threadCreatedAt), index + 1),
      turnId: notice.turnId,
      label: notice.willRetry ? 'Retrying' : notice.kind === 'error' ? 'Runtime error' : 'Runtime warning',
      detail: notice.message,
      tone: notice.kind === 'error' ? 'error' : 'info',
      toolLifecycleStatus: notice.kind === 'error' ? 'failed' : undefined,
      sourceActivityKind: notice.kind === 'error' ? 'runtime.error' : 'runtime.warning',
    })
  }

  const latest = snapshot.thread.turns.at(-1) ?? null
  const latestTurn: OrchestrationLatestTurn | null = latest ? {
    turnId: latest.id,
    state: turnState(latest.status),
    startedAt: new Date(epochMs(latest.startedAt, threadCreatedAt)).toISOString(),
    completedAt: latest.completedAt === null ? null : new Date(epochMs(latest.completedAt, threadCreatedAt)).toISOString(),
  } : null
  const runningTurn = [...snapshot.thread.turns].reverse().find((turn) => turn.status === 'inProgress') ?? null
  const isWorking = snapshot.status.type !== 'idle' || runningTurn !== null

  return {
    activeTurnInProgress: runningTurn !== null,
    activeTurnStartedAt: runningTurn
      ? new Date(epochMs(runningTurn.startedAt, threadCreatedAt)).toISOString()
      : null,
    isWorking,
    latestTurn,
    messages,
    proposedPlans,
    runningTurnId: runningTurn?.id ?? null,
    timelineEntries: deriveTimelineEntries(messages, proposedPlans, workEntries),
    turnDiffSummaryByAssistantMessageId,
    workEntries,
  }
}

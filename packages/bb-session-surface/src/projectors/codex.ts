import type {
  ThreadEventItem,
  ThreadEventTokenUsage,
  ThreadEventTokenUsageBreakdown,
  ThreadRuntimeDisplayStatus,
  ThreadStatus,
} from '@bb/domain'
import type { BbNativeSessionSnapshot, BbOptimisticUserMessage } from '../contracts'
import {
  appendOptimisticEvents,
  arrayValue,
  CanonicalEventBuilder,
  itemStatus,
  normalizeEpoch,
  normalizedEpochOrNull,
  numberValue,
  recordValue,
  stableFallbackEpoch,
  stringValue,
  textFromBlocks,
  turnStatus,
  unsupportedUserContentBlocks,
  userContentFromBlocks,
} from './common'
import type { PersistedUserMessageIdentity } from './common'
import type { CanonicalSessionProjection } from './types'

function codexRuntimeStatus(snapshot: BbNativeSessionSnapshot, turns: unknown[]): ThreadRuntimeDisplayStatus {
  const status = recordValue(snapshot.status)
  if (['retry', 'busy'].includes(stringValue(status?.type))) return 'active'
  return turns.some((value) => turnStatus(recordValue(value)?.status) === null) ? 'active' : 'idle'
}

function codexThreadStatus(runtimeStatus: ThreadRuntimeDisplayStatus): ThreadStatus {
  return runtimeStatus === 'active' ? 'active' : 'idle'
}

function nonNegativeDurationMs(value: unknown) {
  const durationMs = numberValue(value)
  return durationMs !== null && durationMs >= 0 ? durationMs : null
}

function codexTurnTiming(
  turn: Record<string, unknown>,
  fallback: number,
  terminal: boolean,
) {
  const nativeStartedAt = normalizedEpochOrNull(turn.startedAt)
  const nativeCompletedAt = normalizedEpochOrNull(turn.completedAt)
  const updatedAt = normalizedEpochOrNull(turn.updatedAt)
  const durationMs = nonNegativeDurationMs(turn.durationMs)
  const startedAt = nativeStartedAt
    ?? (nativeCompletedAt !== null && durationMs !== null ? nativeCompletedAt - durationMs : null)
    ?? (updatedAt !== null && durationMs !== null ? updatedAt - durationMs : null)
    ?? nativeCompletedAt
    ?? updatedAt
    ?? fallback

  if (!terminal) return { completedAt: null, startedAt }

  const completedAt = (nativeCompletedAt !== null && nativeCompletedAt >= startedAt
    ? nativeCompletedAt
    : null)
    ?? (durationMs === null ? null : startedAt + durationMs)
    ?? (updatedAt !== null && updatedAt >= startedAt ? updatedAt : null)
    ?? startedAt
  return { completedAt, startedAt }
}

function tokenUsageBreakdown(value: unknown): ThreadEventTokenUsageBreakdown {
  const usage = recordValue(value)
  return {
    totalTokens: numberValue(usage?.totalTokens) ?? 0,
    inputTokens: numberValue(usage?.inputTokens) ?? 0,
    cachedInputTokens: numberValue(usage?.cachedInputTokens) ?? 0,
    outputTokens: numberValue(usage?.outputTokens) ?? 0,
    reasoningOutputTokens: numberValue(usage?.reasoningOutputTokens) ?? 0,
  }
}

function codexTokenUsage(value: unknown): ThreadEventTokenUsage | null {
  const usage = recordValue(value)
  if (!usage) return null
  return {
    total: tokenUsageBreakdown(usage.total),
    last: tokenUsageBreakdown(usage.last),
    modelContextWindow: numberValue(usage.modelContextWindow),
  }
}

function itemIsTerminal(
  item: Record<string, unknown>,
  itemIndex: number,
  itemCount: number,
  completedTurnStatus: ReturnType<typeof turnStatus>,
) {
  if (completedTurnStatus) return true
  if (item.status !== undefined) return itemStatus(item.status, 'pending') !== 'pending'
  return itemIndex < itemCount - 1
}

function nonEmptyStrings(values: unknown[]): string[] {
  return values.map(stringValue).filter(Boolean)
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)]
}

function codexItemStatus(value: unknown) {
  switch (stringValue(value).toLowerCase()) {
    case 'inprogress':
    case 'in_progress':
      return 'pending' as const
    case 'completed':
      return 'completed' as const
    case 'failed':
      return 'failed' as const
    case 'declined':
      return 'interrupted' as const
    default:
      return null
  }
}

function codexApprovalStatus(value: unknown) {
  return stringValue(value).toLowerCase() === 'declined'
    ? 'denied' as const
    : null
}

function dynamicToolCallResult(value: unknown): {
  result: string | undefined
  valid: boolean
} {
  if (value === null || value === undefined) return { result: undefined, valid: true }
  if (!Array.isArray(value)) return { result: undefined, valid: false }
  let valid = true
  const parts = value.flatMap((entry) => {
    const contentItem = recordValue(entry)
    switch (stringValue(contentItem?.type)) {
      case 'inputText': {
        const text = stringValue(contentItem?.text)
        return text.trim() ? [text] : []
      }
      case 'inputImage': {
        const imageUrl = stringValue(contentItem?.imageUrl)
        return imageUrl ? [`[image: ${imageUrl}]`] : []
      }
      default:
        valid = false
        return []
    }
  })
  return { result: parts.length ? parts.join('\n') : undefined, valid }
}

function dynamicToolCallError(success: unknown, result: string | undefined) {
  if (success !== false) return undefined
  return result?.trim() || 'Dynamic tool call failed'
}

function codexFileChangeKind(value: unknown): 'add' | 'delete' | 'update' | null {
  switch (stringValue(recordValue(value)?.type ?? value).toLowerCase()) {
    case 'add':
    case 'added':
    case 'create':
    case 'created':
      return 'add'
    case 'delete':
    case 'deleted':
    case 'remove':
    case 'removed':
      return 'delete'
    case 'update':
    case 'updated':
    case 'rename':
    case 'renamed':
      return 'update'
    default:
      return null
  }
}

type CodexTrackedSubAgent = {
  agentPath: string
  agentThreadId: string
  callId: string
  parentToolCallId?: string
  parentTurnId: string
  providerThreadId: string
  terminal: boolean
}

function codexSubAgentToolCall(
  tracked: CodexTrackedSubAgent,
  status: 'pending' | 'completed' | 'failed' | 'interrupted',
): Extract<ThreadEventItem, { type: 'toolCall' }> {
  return {
    type: 'toolCall',
    id: tracked.callId,
    tool: 'spawnAgent',
    arguments: {
      senderThreadId: tracked.providerThreadId,
      receiverThreadIds: [tracked.agentThreadId],
      description: tracked.agentPath,
    },
    status,
    ...(tracked.parentToolCallId ? { parentToolCallId: tracked.parentToolCallId } : {}),
    ...(status === 'pending'
      ? {}
      : { result: { agentPath: tracked.agentPath, agentThreadId: tracked.agentThreadId } }),
  }
}

function shouldIgnoreCodexItem(item: Record<string, unknown>): boolean {
  if (stringValue(item.type) !== 'webSearch') return false
  const action = recordValue(item.action)
  return !action || stringValue(action.type) === 'other'
}

function codexWebItem(
  item: Record<string, unknown>,
  itemId: string,
  runtimeOutput: string,
): ThreadEventItem | null {
  const action = recordValue(item.action)
  const resultText = runtimeOutput || stringValue(item.result) || null
  switch (stringValue(action?.type)) {
    case 'search': {
      const queries = dedupeStrings(nonEmptyStrings([
        ...arrayValue(action?.queries),
        action?.query,
        item.query,
      ]))
      return queries.length > 0
        ? { type: 'webSearch', id: itemId, queries, resultText }
        : null
    }
    case 'openPage': {
      const url = stringValue(action?.url)
      return url
        ? { type: 'webFetch', id: itemId, url, prompt: null, pattern: null, resultText }
        : null
    }
    case 'findInPage': {
      const url = stringValue(action?.url)
      return url
        ? {
            type: 'webFetch',
            id: itemId,
            url,
            prompt: null,
            pattern: stringValue(action?.pattern) || null,
            resultText,
          }
        : null
    }
    default:
      return null
  }
}

function codexItem(
  item: Record<string, unknown>,
  itemId: string,
  runtimeOutput: string,
): ThreadEventItem | null {
  const durationMs = nonNegativeDurationMs(item.durationMs)
  switch (stringValue(item.type)) {
    case 'userMessage':
      return {
        type: 'userMessage',
        id: itemId,
        content: userContentFromBlocks(item.content),
      }
    case 'agentMessage':
      return { type: 'agentMessage', id: itemId, text: stringValue(item.text) }
    case 'reasoning':
      return {
        type: 'reasoning',
        id: itemId,
        summary: arrayValue(item.summary).map(stringValue).filter(Boolean),
        content: arrayValue(item.content).map(stringValue).filter(Boolean),
      }
    case 'commandExecution': {
      const status = codexItemStatus(item.status)
      if (!status) return null
      const output = stringValue(item.aggregatedOutput) || runtimeOutput
      const exitCode = numberValue(item.exitCode)
      return {
        type: 'commandExecution',
        id: itemId,
        command: stringValue(item.command) || 'Command',
        cwd: stringValue(item.cwd),
        status: status === 'interrupted'
          ? status
          : exitCode !== null && exitCode !== 0 ? 'failed' : status,
        approvalStatus: codexApprovalStatus(item.status),
        ...(output ? { aggregatedOutput: output } : {}),
        ...(exitCode === null ? {} : { exitCode }),
        ...(durationMs === null ? {} : { durationMs }),
      }
    }
    case 'fileChange': {
      const status = codexItemStatus(item.status)
      if (!status) return null
      const nativeChanges = arrayValue(item.changes)
      const changes = nativeChanges.flatMap((value) => {
        const change = recordValue(value)
        const path = stringValue(change?.path)
        if (!path) return []
        const diff = stringValue(change?.diff)
        const nativeKind = recordValue(change?.kind)
        const kind = codexFileChangeKind(change?.kind)
        if (!kind) return []
        const movePath = kind === 'update'
          ? stringValue(nativeKind?.move_path) || stringValue(change?.movePath)
          : ''
        return [{
          path,
          kind,
          ...(diff ? { diff } : {}),
          ...(movePath ? { movePath } : {}),
        }]
      })
      if (changes.length === 0 || changes.length !== nativeChanges.length) return null
      return {
        type: 'fileChange',
        id: itemId,
        changes,
        status,
        approvalStatus: codexApprovalStatus(item.status),
      }
    }
    case 'mcpToolCall': {
      const status = codexItemStatus(item.status)
      if (!status) return null
      const error = recordValue(item.error)
      const errorMessage = stringValue(error?.message)
      if (error && !errorMessage) return null
      return {
        type: 'toolCall',
        id: itemId,
        server: stringValue(item.server) || undefined,
        tool: stringValue(item.tool) || 'MCP tool',
        arguments: recordValue(item.arguments) ?? undefined,
        status: error ? 'failed' : status,
        ...(errorMessage ? { error: errorMessage } : {}),
        ...(durationMs === null ? {} : { durationMs }),
      }
    }
    case 'dynamicToolCall': {
      const status = codexItemStatus(item.status)
      if (!status) return null
      const normalizedResult = dynamicToolCallResult(item.contentItems)
      if (!normalizedResult.valid) return null
      const result = runtimeOutput || normalizedResult.result
      const error = dynamicToolCallError(item.success, result)
      return {
        type: 'toolCall',
        id: itemId,
        server: stringValue(item.namespace) || undefined,
        tool: stringValue(item.tool) || 'Dynamic tool',
        arguments: recordValue(item.arguments) ?? undefined,
        status: item.success === false ? 'failed' : status,
        ...(result ? { result } : {}),
        ...(error ? { error } : {}),
        ...(durationMs === null ? {} : { durationMs }),
      }
    }
    case 'collabAgentToolCall': {
      const status = codexItemStatus(item.status)
      if (!status) return null
      const nativeTool = stringValue(item.tool) || 'Agent'
      const prompt = stringValue(item.prompt)
      const model = stringValue(item.model)
      const reasoningEffort = stringValue(item.reasoningEffort)
      return {
        type: 'toolCall',
        id: itemId,
        tool: nativeTool,
        arguments: {
          senderThreadId: stringValue(item.senderThreadId),
          receiverThreadIds: arrayValue(item.receiverThreadIds).map(stringValue).filter(Boolean),
          ...(prompt ? { prompt } : {}),
          ...(model ? { model } : {}),
          ...(reasoningEffort ? { reasoningEffort } : {}),
        },
        status,
        result: recordValue(item.agentsStates) ?? {},
      }
    }
    case 'subAgentActivity':
      return null
    case 'webSearch':
      return codexWebItem(item, itemId, runtimeOutput)
    case 'imageView':
      return { type: 'imageView', id: itemId, path: stringValue(item.path) }
    case 'plan':
      return { type: 'plan', id: itemId, text: stringValue(item.text) }
    case 'contextCompaction':
      return { type: 'contextCompaction', id: itemId }
    case 'imageGeneration':
    case 'sleep':
      return null
    default:
      return null
  }
}

export function projectCodexSnapshot(
  snapshot: BbNativeSessionSnapshot,
  optimisticMessages: BbOptimisticUserMessage[],
  projectionRevision: number,
): CanonicalSessionProjection {
  const thread = recordValue(snapshot.thread) ?? {}
  const threadId = stringValue(thread.id) || 'codex-session'
  const fallbackTime = normalizeEpoch(thread.createdAt, stableFallbackEpoch(`codex:${threadId}`))
  const builder = new CanonicalEventBuilder(threadId, 'codex', threadId, fallbackTime, projectionRevision)
  const persistedMessages: PersistedUserMessageIdentity[] = []
  const turns = arrayValue(thread.turns)
  const itemRuntime = recordValue(snapshot.itemRuntime) ?? {}
  const turnRuntime = recordValue(snapshot.turnRuntime) ?? {}
  const tokenUsage = codexTokenUsage(snapshot.tokenUsage)
  const pendingSubAgents: CodexTrackedSubAgent[] = []
  const subAgentsByCallId = new Map<string, CodexTrackedSubAgent>()
  const subAgentsByAgentThreadId = new Map<string, CodexTrackedSubAgent>()
  builder.threadStarted(thread.createdAt)

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = recordValue(turns[turnIndex])
    if (!turn) {
      builder.unhandled(`codex:turn-${turnIndex}`, 'codex/turn', turns[turnIndex], null)
      continue
    }
    const turnId = stringValue(turn.id) || `turn-${turnIndex}`
    const completedStatus = turnStatus(turn.status)
    const items = arrayValue(turn.items)
    let delegatedSubAgent: CodexTrackedSubAgent | undefined
    while (pendingSubAgents.length && !delegatedSubAgent) {
      const candidate = pendingSubAgents.shift()
      if (candidate && !candidate.terminal) delegatedSubAgent = candidate
    }
    const delegatedParentToolCallId = delegatedSubAgent?.callId
    const timing = codexTurnTiming(
      turn,
      fallbackTime + turnIndex * 10_000,
      completedStatus !== null,
    )
    const { completedAt, startedAt } = timing
    const userItems = items.flatMap((value, itemIndex) => {
      const nativeItem = recordValue(value)
      if (stringValue(nativeItem?.type) !== 'userMessage') return []
      const itemId = stringValue(nativeItem?.id) || `${turnId}:item-${itemIndex}`
      const content = userContentFromBlocks(nativeItem?.content)
      const text = content.filter((entry) => entry.type === 'text').map((entry) => entry.text).join('\n\n')
      const clientId = stringValue(nativeItem?.clientId)
      if (!delegatedSubAgent) {
        persistedMessages.push({
          allowContentTimestampMatch: !clientId,
          ids: [itemId, clientId].filter(Boolean),
          text,
          timestamp: startedAt + itemIndex,
        })
      }
      for (const { index, value: unsupported } of unsupportedUserContentBlocks(nativeItem?.content)) {
        builder.unhandled(
          `${itemId}:user-block-${index}`,
          `codex/user/${stringValue(recordValue(unsupported)?.type) || 'block'}`,
          unsupported,
          turnId,
          startedAt + itemIndex + index / 100,
        )
      }
      return [{ content, itemId }]
    })
    if (userItems.length && !delegatedSubAgent) {
      builder.userRequest(
        turnId,
        userItems[0]!.itemId,
        userItems.flatMap(({ content }) => content),
        startedAt,
      )
    } else {
      builder.turnStarted(turnId, startedAt, delegatedParentToolCallId)
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const nativeItem = recordValue(items[itemIndex])
      const itemId = stringValue(nativeItem?.id) || `${turnId}:item-${itemIndex}`
      const timestamp = startedAt + itemIndex
      if (!nativeItem) {
        builder.unhandled(itemId, 'codex/item', items[itemIndex], turnId, timestamp)
        continue
      }
      const runtime = recordValue(itemRuntime[itemId])
      const runtimeOutput = stringValue(runtime?.output)
      if (stringValue(nativeItem.type) === 'subAgentActivity') {
        const kind = stringValue(nativeItem.kind)
        const agentThreadId = stringValue(nativeItem.agentThreadId)
        const agentPath = stringValue(nativeItem.agentPath)
        if (kind === 'started' && agentThreadId && agentPath) {
          if (!subAgentsByCallId.has(itemId)) {
            const tracked: CodexTrackedSubAgent = {
              agentPath,
              agentThreadId,
              callId: itemId,
              ...(delegatedParentToolCallId
                ? { parentToolCallId: delegatedParentToolCallId }
                : {}),
              parentTurnId: turnId,
              providerThreadId: threadId,
              terminal: false,
            }
            subAgentsByCallId.set(itemId, tracked)
            subAgentsByAgentThreadId.set(agentThreadId, tracked)
            pendingSubAgents.push(tracked)
            builder.item(
              turnId,
              codexSubAgentToolCall(tracked, 'pending'),
              false,
              timestamp,
            )
          }
        } else if (kind === 'interrupted' && agentThreadId) {
          const tracked = subAgentsByAgentThreadId.get(agentThreadId)
          if (tracked && !tracked.terminal) {
            tracked.terminal = true
            if (subAgentsByAgentThreadId.get(agentThreadId) === tracked) {
              subAgentsByAgentThreadId.delete(agentThreadId)
            }
            builder.completeItem(
              tracked.parentTurnId,
              codexSubAgentToolCall(tracked, 'interrupted'),
              timestamp,
            )
          }
        } else if (kind !== 'interacted') {
          builder.unhandled(itemId, 'codex/subAgentActivity', nativeItem, turnId, timestamp)
        }
        continue
      }
      if (shouldIgnoreCodexItem(nativeItem)) continue
      const item = codexItem(nativeItem, itemId, runtimeOutput)
      if (!item) {
        builder.unhandled(itemId, `codex/${stringValue(nativeItem.type) || 'item'}`, nativeItem, turnId, timestamp)
        continue
      }
      if (item.type === 'userMessage') {
        continue
      }
      const parentToolCallId = stringValue(nativeItem.parentToolCallId)
        || delegatedParentToolCallId
      const projectedItem = parentToolCallId
        ? { ...item, parentToolCallId } as ThreadEventItem
        : item
      builder.item(
        turnId,
        projectedItem,
        itemIsTerminal(nativeItem, itemIndex, items.length, completedStatus),
        timestamp,
      )
      if (projectedItem.type === 'fileChange') builder.fileOutput(turnId, projectedItem.id, runtimeOutput, timestamp)
      if (projectedItem.type === 'toolCall') {
        builder.toolProgress(
          turnId,
          projectedItem.id,
          arrayValue(runtime?.progress).map(stringValue).filter(Boolean),
          stringValue(nativeItem.type) === 'mcpToolCall',
          timestamp,
        )
      }
      const terminalInput = stringValue(runtime?.terminalInput)
      if (terminalInput) {
        builder.unhandled(
          `${itemId}:terminal-input`,
          'codex/commandExecution/terminalInput',
          { input: terminalInput },
          turnId,
          timestamp,
        )
      }
    }

    const runtime = recordValue(turnRuntime[turnId])
    const runtimePlan = recordValue(runtime?.plan)
    const nativeSteps = arrayValue(runtimePlan?.steps)
    const steps = nativeSteps.flatMap((value) => {
      const step = recordValue(value)
      const text = stringValue(step?.step)
      if (!text) return []
      const nativeStatus = stringValue(step?.status).toLowerCase()
      const status = nativeStatus === 'in_progress' || nativeStatus === 'active'
        ? 'active' as const
        : nativeStatus === 'completed'
          ? 'completed' as const
          : nativeStatus === 'failed'
            ? 'failed' as const
            : 'pending' as const
      return [{ step: text, status }]
    })
    if (steps.length) builder.plan(turnId, steps, stringValue(runtimePlan?.explanation) || undefined)
    for (let stepIndex = 0; stepIndex < nativeSteps.length; stepIndex += 1) {
      const nativeStep = recordValue(nativeSteps[stepIndex])
      if (nativeStep && stringValue(nativeStep.step)) continue
      builder.unhandled(
        `${turnId}:plan-step-${stepIndex}`,
        'codex/plan/step',
        nativeSteps[stepIndex],
        turnId,
        startedAt + items.length + stepIndex / 100,
      )
    }
    const diff = stringValue(runtime?.diff)
    if (diff) builder.diff(turnId, diff)

    if (tokenUsage && turnIndex === turns.length - 1) {
      builder.tokenUsage(turnId, tokenUsage, completedAt ?? turn.updatedAt ?? startedAt)
    }

    if (completedStatus) {
      builder.turnCompleted(
        turnId,
        completedStatus,
        completedAt,
        stringValue(recordValue(turn.error)?.message) || undefined,
      )
      if (delegatedSubAgent && !delegatedSubAgent.terminal) {
        delegatedSubAgent.terminal = true
        if (subAgentsByAgentThreadId.get(delegatedSubAgent.agentThreadId) === delegatedSubAgent) {
          subAgentsByAgentThreadId.delete(delegatedSubAgent.agentThreadId)
        }
        builder.completeItem(
          delegatedSubAgent.parentTurnId,
          codexSubAgentToolCall(delegatedSubAgent, completedStatus),
          completedAt,
        )
      }
    }
  }

  appendOptimisticEvents({ builder, optimisticMessages, persistedMessages })

  const notices = arrayValue(snapshot.notices)
  for (let index = 0; index < notices.length; index += 1) {
    const notice = recordValue(notices[index])
    if (!notice) {
      builder.unhandled(`notice:${index}`, 'codex/notice', notices[index], null, thread.updatedAt)
      continue
    }
    const id = `notice:${stringValue(notice.id) || index}`
    const turnId = stringValue(notice.turnId) || null
    if (stringValue(notice.kind) === 'error') {
      builder.providerError(id, stringValue(notice.message), turnId, thread.updatedAt, notice.willRetry === true)
    } else {
      builder.providerWarning(id, stringValue(notice.message), turnId, thread.updatedAt)
    }
  }

  const runtimeStatus = codexRuntimeStatus(snapshot, turns)
  const threadStatus = codexThreadStatus(runtimeStatus)
  return {
    contextWindowEvents: builder.events.filter(({ event }) => event.type === 'thread/contextWindowUsage/updated'),
    events: builder.events,
    providerDisplayName: 'Codex',
    providerId: 'codex',
    runtimeStatus,
    threadName: stringValue(thread.name),
    threadStatus,
  }
}

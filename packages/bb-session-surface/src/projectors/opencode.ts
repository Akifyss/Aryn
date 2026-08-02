import type {
  ThreadEventItem,
  ThreadEventTokenUsage,
  ThreadRuntimeDisplayStatus,
  ThreadStatus,
} from '@bb/domain'
import type { BbNativeSessionSnapshot, BbOptimisticUserMessage } from '../contracts'
import {
  appendOptimisticEvents,
  arrayValue,
  CanonicalEventBuilder,
  fileChangeKind,
  itemStatus,
  markdownForAttachments,
  normalizeEpoch,
  numberValue,
  recordValue,
  safeJson,
  stableFallbackEpoch,
  stringValue,
  unsupportedUserContentBlocks,
  userContentFromBlocks,
} from './common'
import type { MarkdownAttachment, PersistedUserMessageIdentity } from './common'
import type { CanonicalSessionProjection } from './types'

function partStatus(part: Record<string, unknown>) {
  const state = recordValue(part.state)
  return itemStatus(state?.status ?? part.status, 'completed')
}

function partOutput(part: Record<string, unknown>) {
  const state = recordValue(part.state)
  return stringValue(state?.output)
    || stringValue(state?.error)
    || stringValue(part.output)
    || stringValue(part.error)
    || safeJson(state?.result ?? part.result ?? '')
}

function visibleOpenCodeUserParts(parts: unknown[]) {
  return parts.filter((value) => {
    const part = recordValue(value)
    return !(stringValue(part?.type) === 'text' && part?.synthetic === true)
  })
}

function projectOpenCodeAttachments(value: unknown) {
  const attachments: MarkdownAttachment[] = []
  const unsupported: Array<{ index: number; value: unknown }> = []
  const values = arrayValue(value)
  for (let index = 0; index < values.length; index += 1) {
    const nativeAttachment = values[index]
    const record = recordValue(nativeAttachment)
    const projected = userContentFromBlocks([nativeAttachment]).filter(
      (content): content is MarkdownAttachment['content'] => content.type !== 'text',
    )
    if (!projected.length) {
      unsupported.push({ index, value: nativeAttachment })
      continue
    }
    const label = stringValue(record?.filename) || stringValue(record?.name)
    attachments.push(...projected.map((content) => ({
      content,
      ...(label ? { label } : {}),
    })))
  }
  return { attachments, unsupported }
}

function partInput(part: Record<string, unknown>) {
  return recordValue(recordValue(part.state)?.input) ?? recordValue(part.input)
}

function toolName(part: Record<string, unknown>) {
  return stringValue(part.tool) || stringValue(part.name) || 'Tool'
}

function normalizedToolName(part: Record<string, unknown>) {
  return toolName(part).toLowerCase().replaceAll('-', '_')
}

function isCommandTool(name: string) {
  return ['bash', 'shell', 'command', 'terminal', 'exec', 'run_command'].includes(name)
}

function isFileTool(name: string) {
  return ['apply_patch', 'edit', 'file_edit', 'patch', 'write', 'write_file'].includes(name)
}

function isSearchTool(name: string) {
  return ['websearch', 'web_search', 'search_web'].includes(name)
}

function isFetchTool(name: string) {
  return ['webfetch', 'web_fetch', 'fetch'].includes(name)
}

function isDelegationTool(name: string) {
  return ['task', 'subagent', 'delegate', 'delegation', 'spawn_agent'].includes(name)
}

function isQuestionTool(name: string) {
  return ['question', 'ask_user', 'request_user_input'].includes(name)
}

function isApprovalTool(name: string) {
  return ['permission', 'approval', 'request_permission'].includes(name)
}

function filePathFromTool(part: Record<string, unknown>) {
  const input = partInput(part)
  return stringValue(input?.filePath)
    || stringValue(input?.filepath)
    || stringValue(input?.path)
    || stringValue(recordValue(part.metadata)?.path)
}

function diffFromTool(part: Record<string, unknown>) {
  const state = recordValue(part.state)
  const metadata = recordValue(state?.metadata) ?? recordValue(part.metadata)
  return stringValue(metadata?.diff)
    || stringValue(metadata?.patch)
    || stringValue(part.diff)
}

function normalizeQuestions(input: Record<string, unknown> | null, partId: string) {
  const nativeQuestions = arrayValue(input?.questions)
  return (nativeQuestions.length ? nativeQuestions : [input]).map((value, index) => {
    const question = recordValue(value)
    const options = arrayValue(question?.options).flatMap((option, optionIndex) => {
      const record = recordValue(option)
      const label = stringValue(record?.label) || stringValue(option) || `Option ${optionIndex + 1}`
      const description = stringValue(record?.description)
      return [{
        value: stringValue(record?.value) || label,
        label,
        ...(description ? { description } : {}),
      }]
    })
    const prompt = stringValue(question?.question)
      || stringValue(question?.prompt)
      || stringValue(input?.question)
      || 'Question'
    return {
      id: stringValue(question?.id) || `${partId}:question-${index}`,
      prompt,
      multiSelect: question?.multiple === true || question?.multiSelect === true,
      ...(options.length ? { options } : {}),
      allowFreeText: options.length === 0 || question?.allowFreeText === true,
    }
  })
}

function normalizeQuestionAnswers(
  questions: ReturnType<typeof normalizeQuestions>,
  state: Record<string, unknown> | null,
) {
  const nativeAnswers = arrayValue(recordValue(state?.metadata)?.answers)
  if (nativeAnswers.length === 0) return undefined

  return Object.fromEntries(questions.map((question, index) => {
    const values = arrayValue(nativeAnswers[index]).map(stringValue).filter(Boolean)
    const options = question.options ?? []
    const selected: string[] = []
    const freeText: string[] = []
    for (const value of values) {
      const option = options.find((candidate) => candidate.value === value || candidate.label === value)
      if (option) selected.push(option.value)
      else freeText.push(value)
    }
    return [question.id, {
      selected: [...new Set(selected)],
      ...(freeText.length ? { freeText: freeText.join('\n') } : {}),
    }]
  }))
}

function projectOpenCodeTool(
  builder: CanonicalEventBuilder,
  part: Record<string, unknown>,
  partId: string,
  turnId: string,
  timestamp: number,
): ThreadEventItem | null {
  const name = normalizedToolName(part)
  const displayName = toolName(part)
  const state = recordValue(part.state)
  const status = partStatus(part)
  const input = partInput(part)
  const output = partOutput(part)

  if (isQuestionTool(name)) {
    const lifecycle = status === 'pending' ? 'pending' : status === 'completed' ? 'resolved' : 'interrupted'
    const questions = normalizeQuestions(input, partId)
    builder.userQuestion(
      partId,
      turnId,
      questions,
      lifecycle,
      timestamp,
      stringValue(state?.error),
      lifecycle === 'resolved' ? normalizeQuestionAnswers(questions, state) : undefined,
    )
    return null
  }
  if (isApprovalTool(name)) {
    const lifecycle = status === 'pending' ? 'pending' : status === 'completed' || status === 'failed' ? 'resolved' : 'interrupted'
    builder.permission(partId, turnId, displayName, lifecycle, timestamp, status === 'failed', stringValue(state?.error))
    return null
  }
  if (isCommandTool(name)) {
    const exitCode = numberValue(recordValue(state?.metadata)?.exitCode)
      ?? numberValue(recordValue(state?.metadata)?.exit_code)
    const terminalInput = stringValue(input?.terminalInput)
      || stringValue(input?.stdin)
      || stringValue(recordValue(state?.metadata)?.terminalInput)
    if (terminalInput) {
      builder.unhandled(
        `${partId}:terminal-input`,
        'opencode/command/terminalInput',
        { input: terminalInput },
        turnId,
        timestamp + 0.001,
      )
    }
    return {
      type: 'commandExecution',
      id: partId,
      command: stringValue(input?.command) || stringValue(input?.cmd) || displayName,
      cwd: stringValue(input?.cwd),
      status: exitCode !== null && exitCode !== 0 ? 'failed' : status,
      approvalStatus: null,
      ...(output ? { aggregatedOutput: output } : {}),
      ...(exitCode === null ? {} : { exitCode }),
    }
  }
  if (isFileTool(name)) {
    const path = filePathFromTool(part)
    if (!path) return null
    const diff = diffFromTool(part)
    const movePath = stringValue(input?.movePath)
      || stringValue(input?.newPath)
      || stringValue(input?.destination)
    return {
      type: 'fileChange',
      id: partId,
      changes: [{
        path,
        kind: name.includes('write') ? 'add' : 'update',
        ...(diff ? { diff } : {}),
        ...(movePath ? { movePath } : {}),
      }],
      status,
      approvalStatus: null,
    }
  }
  if (isSearchTool(name)) {
    return {
      type: 'webSearch',
      id: partId,
      queries: [stringValue(input?.query) || stringValue(input?.q) || displayName],
      resultText: output || null,
    }
  }
  if (isFetchTool(name)) {
    return {
      type: 'webFetch',
      id: partId,
      url: stringValue(input?.url),
      prompt: stringValue(input?.prompt) || null,
      pattern: stringValue(input?.pattern) || null,
      resultText: output || null,
    }
  }

  const upstreamToolName = isDelegationTool(name) ? 'Task' : displayName
  return {
    type: 'toolCall',
    id: partId,
    tool: upstreamToolName,
    arguments: input ?? undefined,
    status,
    ...(output ? { result: output } : {}),
    ...(status === 'failed' ? { error: stringValue(state?.error) || output || 'Tool call failed' } : {}),
    ...(name.includes('todo') ? { statusLabels: { pending: 'Updating plan', completed: 'Updated plan' } } : {}),
  }
}

function openCodeRuntimeStatus(snapshot: BbNativeSessionSnapshot): ThreadRuntimeDisplayStatus {
  const type = stringValue(recordValue(snapshot.status)?.type)
  if (['busy', 'retry', 'running'].includes(type)) return 'active'
  if (type === 'error') return 'error'
  return 'idle'
}

function openCodeTokenUsage(part: Record<string, unknown>): ThreadEventTokenUsage | null {
  const tokens = recordValue(part.tokens)
  if (!tokens) return null
  const cache = recordValue(tokens.cache)
  const inputTokens = numberValue(tokens.input) ?? 0
  const cachedInputTokens = numberValue(cache?.read) ?? 0
  const outputTokens = numberValue(tokens.output) ?? 0
  const reasoningOutputTokens = numberValue(tokens.reasoning) ?? 0
  const totalTokens = numberValue(tokens.total)
    ?? inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens
  const breakdown = {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  }
  return { total: breakdown, last: breakdown, modelContextWindow: null }
}

export function projectOpenCodeSnapshot(
  snapshot: BbNativeSessionSnapshot,
  optimisticMessages: BbOptimisticUserMessage[],
  sessionId: string,
  projectionRevision: number,
): CanonicalSessionProjection {
  const threadId = sessionId || 'opencode-session'
  const messages = arrayValue(snapshot.messages)
  const firstMessage = recordValue(messages[0])
  const fallbackTime = normalizeEpoch(
    recordValue(recordValue(firstMessage?.info)?.time)?.created,
    stableFallbackEpoch(`opencode:${threadId}`),
  )
  const builder = new CanonicalEventBuilder(threadId, 'opencode', threadId, fallbackTime, projectionRevision)
  const persistedMessages: PersistedUserMessageIdentity[] = []
  const representedDiffPaths = new Set<string>()
  const runtimeStatus = openCodeRuntimeStatus(snapshot)
  let currentTurnId: string | null = null
  let currentTurnStartedAt = fallbackTime
  builder.threadStarted(fallbackTime)

  const finishCurrentTurn = (timestamp: number, status: 'completed' | 'failed' = 'completed') => {
    if (!currentTurnId) return
    builder.turnCompleted(currentTurnId, status, timestamp)
    currentTurnId = null
  }

  for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
    const message = recordValue(messages[messageIndex])
    const info = recordValue(message?.info)
    if (!message || !info) {
      builder.unhandled(`opencode:message-${messageIndex}`, 'opencode/message', messages[messageIndex], currentTurnId)
      continue
    }
    const messageId = stringValue(info.id) || `message-${messageIndex}`
    const role = stringValue(info.role)
    const time = recordValue(info.time)
    const timestamp = normalizeEpoch(time?.created, fallbackTime + messageIndex * 100)
    const parts = arrayValue(message.parts)

    if (role === 'user') {
      finishCurrentTurn(timestamp - 1)
      currentTurnId = messageId
      currentTurnStartedAt = timestamp
      const visibleParts = visibleOpenCodeUserParts(parts)
      const content = userContentFromBlocks(visibleParts)
      const text = content.filter((entry) => entry.type === 'text').map((entry) => entry.text).join('\n\n')
      persistedMessages.push({ ids: [messageId], text, timestamp })
      builder.userRequest(currentTurnId, messageId, content, timestamp)
      for (const { index: partIndex, value } of unsupportedUserContentBlocks(visibleParts)) {
        const part = recordValue(value)
        builder.unhandled(
          `${messageId}:part-${partIndex}`,
          `opencode/user/${stringValue(part?.type) || 'part'}`,
          value,
          currentTurnId,
          timestamp + partIndex / 100,
        )
      }
      continue
    }

    if (!currentTurnId) {
      currentTurnId = `opencode:turn:${messageId}`
      currentTurnStartedAt = timestamp
      builder.turnStarted(currentTurnId, timestamp)
    }
    if (role !== 'assistant') {
      builder.unhandled(messageId, `opencode/${role || 'message'}`, message, currentTurnId, timestamp)
      continue
    }

    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      const part = recordValue(parts[partIndex])
      const partId = stringValue(part?.id) || `${messageId}:part-${partIndex}`
      const partTimestamp = timestamp + partIndex / 100
      if (!part) {
        builder.unhandled(partId, 'opencode/part', parts[partIndex], currentTurnId, partTimestamp)
        continue
      }
      const explicitStatus = partStatus(part)
      const terminal = explicitStatus !== 'pending'
        || runtimeStatus !== 'active'
        || messageIndex < messages.length - 1
        || partIndex < parts.length - 1
      let item: ThreadEventItem | null = null
      switch (stringValue(part.type)) {
        case 'text':
          item = { type: 'agentMessage', id: partId, text: stringValue(part.text) }
          break
        case 'reasoning':
          item = {
            type: 'reasoning',
            id: partId,
            summary: [stringValue(part.text) || stringValue(part.reasoning)].filter(Boolean),
            content: [],
          }
          break
        case 'tool':
          item = projectOpenCodeTool(builder, part, partId, currentTurnId, partTimestamp)
          if (!item && !isQuestionTool(normalizedToolName(part)) && !isApprovalTool(normalizedToolName(part))) {
            builder.unhandled(partId, `opencode/tool/${toolName(part)}`, part, currentTurnId, partTimestamp)
          }
          break
        case 'subtask':
          item = {
            type: 'backgroundTask',
            id: partId,
            taskType: 'local_subagent',
            description: stringValue(part.description) || stringValue(part.agent) || 'Sub-agent task',
            status: terminal ? 'completed' : 'pending',
            taskStatus: terminal ? 'completed' : 'running',
            skipTranscript: false,
            ...(stringValue(part.prompt) ? { summary: stringValue(part.prompt) } : {}),
          }
          break
        case 'retry': {
          const error = recordValue(part.error)
          builder.providerError(
            `${partId}:retry`,
            stringValue(error?.message) || safeJson(part.error) || `Retry attempt ${numberValue(part.attempt) ?? ''}`,
            currentTurnId,
            partTimestamp,
            true,
          )
          break
        }
        case 'compaction':
          item = { type: 'contextCompaction', id: partId }
          break
        case 'patch': {
          const changes = arrayValue(part.files).flatMap((value) => {
            const path = stringValue(value)
            return path ? [{ path, kind: 'update' as const }] : []
          })
          if (changes.length) {
            item = {
              type: 'fileChange',
              id: partId,
              changes,
              status: explicitStatus,
              approvalStatus: null,
            }
          } else {
            builder.unhandled(partId, 'opencode/patch', part, currentTurnId, partTimestamp)
          }
          break
        }
        case 'step-finish': {
          const usage = openCodeTokenUsage(part)
          if (usage) builder.tokenUsage(currentTurnId, usage, partTimestamp)
          if (part.reason !== undefined || part.cost !== undefined) {
            builder.unhandled(`${partId}:metadata`, 'opencode/step-finish/metadata', {
              reason: part.reason,
              cost: part.cost,
            }, currentTurnId, partTimestamp)
          }
          break
        }
        case 'step-start':
        case 'snapshot':
        case 'agent':
        case 'file':
        case 'image': {
          const projected = projectOpenCodeAttachments([part])
          const text = markdownForAttachments(projected.attachments, 'Attachment')
          if (text) item = { type: 'agentMessage', id: partId, text }
          for (const unsupported of projected.unsupported) {
            builder.unhandled(
              `${partId}:attachment-${unsupported.index}`,
              `opencode/${stringValue(part.type)}`,
              unsupported.value,
              currentTurnId,
              partTimestamp,
            )
          }
          break
        }
        default:
          builder.unhandled(partId, `opencode/${stringValue(part.type) || 'part'}`, part, currentTurnId, partTimestamp)
      }
      if (item) {
        const parentToolCallId = stringValue(part.parentToolCallId) || stringValue(part.parentID)
        const projectedItem = parentToolCallId
          ? { ...item, parentToolCallId } as ThreadEventItem
          : item
        if (projectedItem.type === 'fileChange') {
          projectedItem.changes.forEach((change) => {
            if (change.diff) representedDiffPaths.add(change.path)
          })
        }
        builder.item(currentTurnId, projectedItem, terminal, partTimestamp)
      }
      if (stringValue(part.type) === 'tool') {
        const nativeAttachments = arrayValue(recordValue(part.state)?.attachments)
        const projected = projectOpenCodeAttachments(nativeAttachments)
        for (const unsupported of projected.unsupported) {
          builder.unhandled(
            `${partId}:attachment-${unsupported.index}`,
            'opencode/tool/attachment',
            unsupported.value,
            currentTurnId,
            partTimestamp + (unsupported.index + 1) / 10_000,
          )
        }
        const attachmentText = markdownForAttachments(projected.attachments, 'Tool attachments')
        if (attachmentText) {
          builder.item(currentTurnId, {
            type: 'agentMessage',
            id: `${partId}:attachments`,
            text: attachmentText,
          }, true, partTimestamp + 0.0001)
        }
      }
    }

    const error = stringValue(info.error) || stringValue(recordValue(info.error)?.message)
    if (error) builder.providerError(`${messageId}:error`, error, currentTurnId, timestamp)
  }

  const diffs = arrayValue(snapshot.diffs)
  if (diffs.length) {
    if (!currentTurnId) {
      currentTurnId = 'opencode:session-diff'
      currentTurnStartedAt = fallbackTime + messages.length * 100
      builder.turnStarted(currentTurnId, currentTurnStartedAt)
    }
    for (let index = 0; index < diffs.length; index += 1) {
      const diff = recordValue(diffs[index])
      const path = stringValue(diff?.file) || stringValue(diff?.path)
      if (!diff || !path) {
        builder.unhandled(
          `opencode:diff-${index}`,
          'opencode/diff',
          diffs[index],
          currentTurnId,
          currentTurnStartedAt + index,
        )
        continue
      }
      if (representedDiffPaths.has(path)) continue
      const patch = stringValue(diff?.diff) || stringValue(diff?.patch)
      const movePath = stringValue(diff?.movePath)
        || stringValue(diff?.newPath)
        || stringValue(diff?.destination)
      builder.item(currentTurnId, {
        type: 'fileChange',
        id: `opencode:diff-${index}:${path}`,
        changes: [{
          path,
          kind: fileChangeKind(diff?.status),
          ...(patch ? { diff: patch } : {}),
          ...(movePath ? { movePath } : {}),
        }],
        status: 'completed',
        approvalStatus: null,
      }, true, currentTurnStartedAt + index)
    }
  }

  const nativeTodos = arrayValue(snapshot.todos)
  const todos: Array<{ status: 'active' | 'completed' | 'failed' | 'pending'; step: string }> = []
  const todoNativeDetails: Array<{ detail: Record<string, unknown>; index: number; value: unknown }> = []
  for (let index = 0; index < nativeTodos.length; index += 1) {
    const value = nativeTodos[index]
    const todo = recordValue(value)
    const step = stringValue(todo?.content)
    if (!todo || !step) {
      todoNativeDetails.push({ detail: {}, index, value })
      continue
    }
    const nativeStatus = stringValue(todo?.status).toLowerCase()
    const status = ['in_progress', 'active', 'running'].includes(nativeStatus)
      ? 'active' as const
      : ['completed', 'done'].includes(nativeStatus)
        ? 'completed' as const
        : ['cancelled', 'canceled', 'failed'].includes(nativeStatus)
          ? 'failed' as const
          : 'pending' as const
    todos.push({ step, status })
    const detail = Object.fromEntries(Object.entries(todo).filter(([key]) => (
      key !== 'content' && key !== 'status'
    )))
    if (Object.keys(detail).length) todoNativeDetails.push({ detail, index, value })
  }
  if (nativeTodos.length) {
    if (!currentTurnId) {
      currentTurnId = 'opencode:todos'
      currentTurnStartedAt = fallbackTime + messages.length * 100 + diffs.length
      builder.turnStarted(currentTurnId, currentTurnStartedAt)
    }
    if (todos.length) {
      builder.plan(currentTurnId, todos)
      builder.item(currentTurnId, {
        type: 'plan',
        id: `${currentTurnId}:todo-plan`,
        text: todos.map((todo) => `${todo.status === 'completed' ? '- [x]' : '- [ ]'} ${todo.step}`).join('\n'),
      }, true, currentTurnStartedAt + todos.length)
    }
    for (const { detail, index, value } of todoNativeDetails) {
      builder.unhandled(
        `opencode:todo-${index}:native-detail`,
        Object.keys(detail).length ? 'opencode/todo/nativeDetail' : 'opencode/todo',
        Object.keys(detail).length ? detail : value,
        currentTurnId,
        currentTurnStartedAt + index / 100,
      )
    }
  }

  if (currentTurnId && runtimeStatus !== 'active') {
    finishCurrentTurn(fallbackTime + messages.length * 100 + diffs.length + nativeTodos.length, runtimeStatus === 'error' ? 'failed' : 'completed')
  }
  appendOptimisticEvents({ builder, optimisticMessages, persistedMessages })

  const threadStatus: ThreadStatus = runtimeStatus === 'active'
    ? 'active'
    : runtimeStatus === 'error'
      ? 'error'
      : 'idle'
  return {
    contextWindowEvents: [],
    events: builder.events,
    providerDisplayName: 'OpenCode',
    providerId: 'opencode',
    runtimeStatus,
    threadName: '',
    threadStatus,
  }
}

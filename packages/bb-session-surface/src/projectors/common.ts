import {
  threadEventSchema,
  type ThreadEvent,
  type ThreadEventItem,
  type ThreadEventItemStatus,
  type ThreadEventTokenUsage,
  type ThreadEventTurnStatus,
  type ThreadEventUserContent,
} from '@bb/domain'
import type { ThreadEventWithMeta } from '@bb/thread-view'
import type { BbOptimisticUserMessage } from '../contracts'

export type PersistedUserMessageIdentity = {
  allowContentTimestampMatch?: boolean
  ids: ReadonlyArray<string>
  text: string
  timestamp: number
}

export function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function normalizeEpoch(value: unknown, fallback: number): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  const numeric = numberValue(value)
  if (numeric === null) return fallback
  return numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric
}

export function stableFallbackEpoch(seed: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 0x01000193) >>> 0
  }
  return 1_600_000_000_000 + hash
}

export function safeJson(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const json = JSON.stringify(value, null, 2)
    return json === undefined ? String(value) : json
  } catch {
    return String(value)
  }
}

export function textFromBlocks(value: unknown): string {
  if (typeof value === 'string') return value
  return arrayValue(value)
    .map((entry) => {
      const block = recordValue(entry)
      return block?.type === 'text' ? stringValue(block.text) : ''
    })
    .filter(Boolean)
    .join('\n\n')
}

export function uniqueContent(content: ThreadEventUserContent[]): ThreadEventUserContent[] {
  const seen = new Set<string>()
  return content.filter((entry) => {
    const key = `${entry.type}:${'text' in entry ? entry.text : 'url' in entry ? entry.url : entry.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function normalizeLocalAttachmentPath(value: string): string {
  const trimmed = value.trim()
  if (/^\/[a-zA-Z]:[\\/]/.test(trimmed)) return trimmed.slice(1)
  if (!/^file:/i.test(trimmed)) return trimmed

  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'file:') return trimmed
    const decodedPath = decodeURIComponent(url.pathname)
    if (url.hostname && url.hostname.toLowerCase() !== 'localhost') {
      return `//${url.hostname}${decodedPath}`
    }
    return /^\/[a-zA-Z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath
  } catch {
    return trimmed
  }
}

export function userContentFromBlocks(value: unknown): ThreadEventUserContent[] {
  if (typeof value === 'string') return value ? [{ type: 'text', text: value }] : []
  const content: ThreadEventUserContent[] = []
  for (const entry of arrayValue(value)) {
    const block = recordValue(entry)
    if (!block) continue
    const type = stringValue(block.type)
    if (type === 'text') {
      const text = stringValue(block.text)
      if (text) content.push({ type: 'text', text })
      continue
    }
    const source = recordValue(block.source)
    const mimeType = stringValue(block.mimeType) || stringValue(block.mime) || stringValue(source?.media_type)
    const path = stringValue(block.path) || stringValue(source?.path)
    const isImage = type === 'image' || type === 'localImage' || mimeType.startsWith('image/')
    const explicitUrl = stringValue(block.url) || stringValue(source?.url) || stringValue(source?.uri)
    const encodedData = stringValue(source?.data) || stringValue(block.data)
    const url = explicitUrl || (
      isImage && encodedData
        ? /^(?:https?:|data:|blob:)/i.test(encodedData)
          ? encodedData
          : `data:${mimeType || 'image/png'};base64,${encodedData}`
        : ''
    )
    const localPath = normalizeLocalAttachmentPath(path || url)
    if (isImage && /^(?:https?:|data:|blob:)/i.test(url)) {
      content.push({ type: 'image', url })
    } else if (isImage && localPath) {
      content.push({ type: 'localImage', path: localPath })
    } else if (localPath) {
      content.push({ type: 'localFile', path: localPath })
    }
  }
  return uniqueContent(content)
}

export type MarkdownAttachment = {
  content: Exclude<ThreadEventUserContent, { type: 'text' }>
  label?: string
}

function attachmentFileName(value: string, fallback: string) {
  if (/^(?:data:|blob:)/i.test(value)) return fallback
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value
  const segments = withoutQuery.replace(/\\/g, '/').split('/').filter(Boolean)
  const candidate = segments.at(-1)
  if (!candidate) return fallback
  try {
    return decodeURIComponent(candidate)
  } catch {
    return candidate
  }
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\\[\]])/g, '\\$1')
}

function markdownDestination(value: string) {
  const normalized = value.replace(/\\/g, '/')
  if (/^[a-zA-Z]:\//.test(normalized)) {
    const [drive, ...segments] = normalized.split('/')
    return `file:///${drive}/${segments.map(encodeURIComponent).join('/')}`
  }
  return normalized.replace(/</g, '%3C').replace(/>/g, '%3E')
}

export function markdownForAttachments(
  attachments: readonly MarkdownAttachment[],
  heading: string,
) {
  const lines = attachments.map(({ content, label }, index) => {
    const value = content.type === 'image' ? content.url : content.path
    const fallback = content.type === 'localFile'
      ? `File attachment ${index + 1}`
      : `Image attachment ${index + 1}`
    const resolvedLabel = escapeMarkdownLabel(label?.trim() || attachmentFileName(value, fallback))
    const destination = markdownDestination(value)
    return content.type === 'localFile'
      ? `[${resolvedLabel}](<${destination}>)`
      : `![${resolvedLabel}](<${destination}>)`
  })
  return lines.length ? `**${heading}**\n\n${lines.join('\n\n')}` : ''
}

export function unsupportedUserContentBlocks(value: unknown): Array<{ index: number; value: unknown }> {
  if (typeof value === 'string') return []
  return arrayValue(value).flatMap((entry, index) => (
    userContentFromBlocks([entry]).length > 0 ? [] : [{ index, value: entry }]
  ))
}

export function itemStatus(
  value: unknown,
  fallback: ThreadEventItemStatus = 'completed',
): ThreadEventItemStatus {
  switch (stringValue(value).toLowerCase()) {
    case 'pending':
    case 'inprogress':
    case 'in_progress':
    case 'running':
    case 'busy':
      return 'pending'
    case 'failed':
    case 'failure':
    case 'error':
    case 'declined':
    case 'denied':
      return 'failed'
    case 'interrupted':
    case 'cancelled':
    case 'canceled':
    case 'stopped':
      return 'interrupted'
    case 'completed':
    case 'complete':
    case 'success':
    case 'succeeded':
    case 'done':
      return 'completed'
    default:
      return fallback
  }
}

export function turnStatus(value: unknown): ThreadEventTurnStatus | null {
  const status = itemStatus(value, 'pending')
  return status === 'pending' ? null : status
}

export function fileChangeKind(value: unknown): 'add' | 'delete' | 'update' {
  switch (stringValue(value).toLowerCase()) {
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
    default:
      return 'update'
  }
}

function jsonValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (Array.isArray(value)) return value.map(jsonValue)
  const record = recordValue(value)
  if (record) {
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, jsonValue(entry)]))
  }
  return String(value)
}

function startedItem(item: ThreadEventItem): ThreadEventItem {
  switch (item.type) {
    case 'agentMessage':
      return { ...item, text: '' }
    case 'reasoning':
      return { ...item, summary: [], content: [] }
    case 'plan':
      return { ...item, text: '' }
    case 'commandExecution':
      return { ...item, status: 'pending', aggregatedOutput: undefined, exitCode: undefined }
    case 'fileChange':
    case 'toolCall':
      return { ...item, status: 'pending' }
    case 'backgroundTask':
      return { ...item, status: 'pending', taskStatus: 'running' }
    default:
      return item
  }
}

const CLIENT_REQUEST_ALPHABET = '23456789abcdefghijkmnpqrstuvwxyz'

function stableClientRequestId(value: string): string {
  // bb requires a compact base-32 protocol id. Two independently-seeded
  // 32-bit hashes make the id deterministic across snapshot rebuilds without
  // relying on browser-only crypto APIs.
  let left = 0x811c9dc5
  let right = 0x9e3779b9
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    left = Math.imul(left ^ code, 0x01000193) >>> 0
    right = Math.imul(right ^ code, 0x85ebca6b) >>> 0
  }
  let suffix = ''
  for (let index = 0; index < 10; index += 1) {
    const mixed = index < 5 ? left : right
    const shift = (index % 5) * 6
    suffix += CLIENT_REQUEST_ALPHABET[(mixed >>> shift) & 31]
  }
  return `creq_${suffix}`
}

function promptInputFromContent(content: readonly ThreadEventUserContent[]) {
  return content.map((entry) => {
    switch (entry.type) {
      case 'text':
        return { type: 'text' as const, text: entry.text, mentions: [] }
      case 'image':
        return { type: 'image' as const, url: entry.url }
      case 'localImage':
        return { type: 'localImage' as const, path: entry.path }
      case 'localFile':
        return { type: 'localFile' as const, path: entry.path }
    }
  })
}

export class CanonicalEventBuilder {
  readonly events: ThreadEventWithMeta[] = []
  private sequence: number

  constructor(
    readonly threadId: string,
    readonly providerId: string,
    readonly providerThreadId: string,
    readonly fallbackTime: number,
    projectionRevision: number,
  ) {
    // bb's renderer intentionally omits high-churn text/output from row memo
    // signatures. Advancing the canonical event sequence is the upstream
    // contract for a changed streaming row, including in-place Aryn snapshots.
    this.sequence = projectionRevision * 1_000_000
  }

  private emit(value: unknown, id: string, timestamp?: unknown) {
    const event = threadEventSchema.parse(value) as ThreadEvent
    this.sequence += 1
    this.events.push({
      event,
      meta: {
        id,
        seq: this.sequence,
        createdAt: normalizeEpoch(timestamp, this.fallbackTime + this.sequence),
      },
    })
  }

  threadStarted(timestamp?: unknown) {
    this.emit({
      type: 'thread/started',
      threadId: this.threadId,
      scope: { kind: 'thread' },
    }, `${this.threadId}:thread-started`, timestamp)
    this.emit({
      type: 'thread/identity',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'thread' },
    }, `${this.threadId}:thread-identity`, timestamp)
  }

  turnStarted(turnId: string, timestamp?: unknown) {
    this.emit({
      type: 'turn/started',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
    }, `${turnId}:turn-started`, timestamp)
  }

  userRequest(
    turnId: string,
    sourceId: string,
    content: readonly ThreadEventUserContent[],
    timestamp?: unknown,
    accepted = true,
  ) {
    const requestId = stableClientRequestId(`${this.threadId}\u0000${turnId}\u0000${sourceId}`)
    this.emit({
      type: 'client/turn/requested',
      threadId: this.threadId,
      scope: { kind: 'thread' },
      direction: 'outbound',
      requestId,
      source: 'tell',
      initiator: 'user',
      senderThreadId: null,
      input: promptInputFromContent(content),
      target: { kind: 'new-turn' },
      request: { method: 'turn/start', params: {} },
      execution: {
        model: 'unknown',
        serviceTier: 'default',
        reasoningLevel: 'none',
        permissionMode: 'accept-edits',
        source: 'client/turn/requested',
      },
    }, `${sourceId}:client-turn-requested`, timestamp)
    if (!accepted) return
    this.turnStarted(turnId, timestamp)
    this.emit({
      type: 'turn/input/accepted',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
      clientRequestId: requestId,
    }, `${sourceId}:turn-input-accepted`, timestamp)
  }

  turnCompleted(
    turnId: string,
    status: ThreadEventTurnStatus,
    timestamp?: unknown,
    error?: string,
  ) {
    this.emit({
      type: 'turn/completed',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
      status,
      ...(error ? { error: { message: error } } : {}),
    }, `${turnId}:turn-completed`, timestamp)
  }

  item(turnId: string, item: ThreadEventItem, terminal: boolean, timestamp?: unknown) {
    this.emit({
      type: 'item/started',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
      item: startedItem(item),
    }, `${item.id}:item-started`, timestamp)

    const scope = { kind: 'turn' as const, turnId }
    const parent = 'parentToolCallId' in item && item.parentToolCallId
      ? { parentToolCallId: item.parentToolCallId }
      : {}
    if (item.type === 'agentMessage' && item.text) {
      this.emit({
        type: 'item/agentMessage/delta',
        threadId: this.threadId,
        providerThreadId: this.providerThreadId,
        scope,
        itemId: item.id,
        // Snapshot adapters only receive the current aggregate, not bb's
        // original chunk history. A trailing newline makes the current partial
        // visible through bb's own line-buffering policy; the terminal event
        // below replaces it with the exact final text.
        delta: terminal || item.text.endsWith('\n') ? item.text : `${item.text}\n`,
        ...parent,
      }, `${item.id}:agent-message-delta`, timestamp)
    } else if (item.type === 'reasoning') {
      const summary = item.summary.join('')
      const content = item.content.join('')
      if (summary) {
        this.emit({
          type: 'item/reasoning/summaryTextDelta',
          threadId: this.threadId,
          providerThreadId: this.providerThreadId,
          scope,
          itemId: item.id,
          delta: summary,
          ...parent,
        }, `${item.id}:reasoning-summary-delta`, timestamp)
      }
      if (content) {
        this.emit({
          type: 'item/reasoning/textDelta',
          threadId: this.threadId,
          providerThreadId: this.providerThreadId,
          scope,
          itemId: item.id,
          delta: content,
          ...parent,
        }, `${item.id}:reasoning-text-delta`, timestamp)
      }
    } else if (item.type === 'plan' && item.text) {
      this.emit({
        type: 'item/plan/delta',
        threadId: this.threadId,
        providerThreadId: this.providerThreadId,
        scope,
        itemId: item.id,
        delta: terminal || item.text.endsWith('\n') ? item.text : `${item.text}\n`,
        ...parent,
      }, `${item.id}:plan-delta`, timestamp)
    } else if (item.type === 'commandExecution' && item.aggregatedOutput) {
      this.emit({
        type: 'item/commandExecution/outputDelta',
        threadId: this.threadId,
        providerThreadId: this.providerThreadId,
        scope,
        itemId: item.id,
        delta: item.aggregatedOutput,
        reset: true,
        ...parent,
      }, `${item.id}:command-output-delta`, timestamp)
    }

    if (!terminal) return
    this.emit({
      type: 'item/completed',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
      item,
    }, `${item.id}:item-completed`, timestamp)
  }

  fileOutput(turnId: string, itemId: string, output: string, timestamp?: unknown) {
    if (!output) return
    this.emit({
      type: 'item/fileChange/outputDelta',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
      itemId,
      delta: output,
    }, `${itemId}:file-output-delta`, timestamp)
  }

  toolProgress(
    turnId: string,
    itemId: string,
    messages: readonly string[],
    mcp: boolean,
    timestamp?: unknown,
  ) {
    messages.filter(Boolean).forEach((message, index) => {
      this.emit({
        type: mcp ? 'item/mcpToolCall/progress' : 'item/toolCall/progress',
        threadId: this.threadId,
        providerThreadId: this.providerThreadId,
        scope: { kind: 'turn', turnId },
        itemId,
        message,
      }, `${itemId}:tool-progress-${index}`, normalizeEpoch(timestamp, this.fallbackTime) + index)
    })
  }

  tokenUsage(turnId: string, tokenUsage: ThreadEventTokenUsage, timestamp?: unknown) {
    const scope = { kind: 'turn' as const, turnId }
    this.emit({
      type: 'thread/tokenUsage/updated',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope,
      tokenUsage,
    }, `${turnId}:token-usage`, timestamp)
    this.emit({
      type: 'thread/contextWindowUsage/updated',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope,
      contextWindowUsage: {
        usedTokens: tokenUsage.total.totalTokens,
        modelContextWindow: tokenUsage.modelContextWindow,
        estimated: false,
      },
    }, `${turnId}:context-window-usage`, timestamp)
  }

  plan(turnId: string, plan: Array<{ step: string; status?: 'pending' | 'active' | 'completed' | 'failed' }>, explanation?: string) {
    this.emit({
      type: 'turn/plan/updated',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
      plan,
      ...(explanation ? { explanation } : {}),
    }, `${turnId}:plan`)
  }

  diff(turnId: string, diff: string) {
    this.emit({
      type: 'turn/diff/updated',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: { kind: 'turn', turnId },
      diff,
    }, `${turnId}:diff`)
  }

  providerError(id: string, message: string, turnId: string | null, timestamp?: unknown, willRetry?: boolean) {
    this.emit({
      type: 'provider/error',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: turnId ? { kind: 'turn', turnId } : { kind: 'thread' },
      message,
      ...(willRetry === undefined ? {} : { willRetry }),
      errorInfo: { category: 'unknown', providerCode: null, httpStatusCode: null },
    }, id, timestamp)
  }

  providerWarning(id: string, summary: string, turnId: string | null, timestamp?: unknown, details?: string) {
    this.emit({
      type: 'provider/warning',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      scope: turnId ? { kind: 'turn', turnId } : { kind: 'thread' },
      category: 'general',
      summary,
      ...(details ? { details } : {}),
    }, id, timestamp)
  }

  userQuestion(
    id: string,
    turnId: string,
    questions: Array<{
      id: string
      prompt: string
      multiSelect: boolean
      options?: Array<{ value: string; label: string; description?: string }>
      allowFreeText: boolean
    }>,
    status: 'pending' | 'resolved' | 'interrupted',
    timestamp?: unknown,
    statusReason?: string,
    answers?: Record<string, { selected: string[]; freeText?: string }>,
  ) {
    const expanded = questions.flatMap((question) => {
      const options = question.options ?? []
      if (options.length <= 4) return [{ freeTextTarget: true, question, originalId: question.id }]
      const chunks = Array.from({ length: Math.ceil(options.length / 4) }, (_, chunkIndex) => ({
        freeTextTarget: chunkIndex === Math.ceil(options.length / 4) - 1,
        originalId: question.id,
        question: {
          ...question,
          id: `${question.id}:options-${chunkIndex + 1}`,
          prompt: `${question.prompt} (${chunkIndex * 4 + 1}-${Math.min(options.length, chunkIndex * 4 + 4)}/${options.length})`,
          options: options.slice(chunkIndex * 4, chunkIndex * 4 + 4),
          allowFreeText: question.allowFreeText && chunkIndex === Math.ceil(options.length / 4) - 1,
        },
      }))
      return chunks
    })
    const batches = Array.from(
      { length: Math.ceil(expanded.length / 4) },
      (_, index) => expanded.slice(index * 4, index * 4 + 4),
    )
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
      const batch = batches[batchIndex]!
      const batchId = batches.length === 1 ? id : `${id}:batch-${batchIndex + 1}`
      const batchAnswers = Object.fromEntries(batch.map(({ freeTextTarget, originalId, question }) => {
        const originalAnswer = answers?.[originalId]
        const optionValues = new Set((question.options ?? []).map((option) => option.value))
        return [question.id, {
          selected: (originalAnswer?.selected ?? []).filter((value) => optionValues.has(value)),
          ...(originalAnswer?.freeText && freeTextTarget
            ? { freeText: originalAnswer.freeText }
            : {}),
        }]
      }))
      this.emit({
        type: 'system/userQuestion/lifecycle',
        threadId: this.threadId,
        scope: { kind: 'turn', turnId },
        interactionId: batchId,
        providerId: this.providerId,
        providerRequestId: id,
        status,
        resolution: status === 'resolved' ? { kind: 'user_answer', answers: batchAnswers } : null,
        statusReason: statusReason || null,
        payload: { kind: 'user_question', questions: batch.map(({ question }) => question) },
      }, `${batchId}:question:${status}`, normalizeEpoch(timestamp, this.fallbackTime) + batchIndex / 100)
    }
  }

  permission(
    id: string,
    turnId: string,
    toolName: string,
    status: 'pending' | 'resolved' | 'interrupted',
    timestamp?: unknown,
    denied = false,
    statusReason?: string,
  ) {
    this.emit({
      type: 'system/permissionGrant/lifecycle',
      threadId: this.threadId,
      scope: { kind: 'turn', turnId },
      interactionId: id,
      providerId: this.providerId,
      providerRequestId: id,
      status,
      resolution: status === 'resolved'
        ? denied
          ? { decision: 'deny' }
          : { decision: 'allow_once', grantedPermissions: null }
        : null,
      statusReason: statusReason || null,
      subject: {
        kind: 'permission_grant',
        itemId: id,
        toolName: toolName || null,
        permissions: { network: null, fileSystem: null },
      },
    }, `${id}:permission:${status}`, timestamp)
  }

  unhandled(id: string, rawType: string, payload: unknown, turnId: string | null, timestamp?: unknown) {
    this.emit({
      type: 'provider/unhandled',
      threadId: this.threadId,
      providerThreadId: this.providerThreadId,
      providerId: this.providerId,
      scope: turnId ? { kind: 'turn', turnId } : { kind: 'thread' },
      rawType,
      rawEvent: {
        jsonrpc: '2.0',
        id,
        method: rawType,
        params: { payload: jsonValue(payload) },
      },
    }, id, timestamp)
  }
}

export function appendOptimisticEvents({
  builder,
  optimisticMessages,
  persistedMessages,
}: {
  builder: CanonicalEventBuilder
  optimisticMessages: readonly BbOptimisticUserMessage[]
  persistedMessages: readonly PersistedUserMessageIdentity[]
}) {
  const consumedPersistedMessages = new Set<number>()
  for (let index = 0; index < optimisticMessages.length; index += 1) {
    const message = optimisticMessages[index]!
    const id = stringValue(message.id) || `message-${index}`
    const text = stringValue(message.text) || textFromBlocks(message.content)
    const baselineIds = new Set(arrayValue(message.baselineUserMessageIds).map(stringValue).filter(Boolean))
    let persistedIndex = persistedMessages.findIndex((persisted, candidateIndex) => (
      !consumedPersistedMessages.has(candidateIndex)
      && !persisted.ids.some((persistedId) => baselineIds.has(persistedId))
      && persisted.ids.includes(id)
    ))
    if (persistedIndex < 0) {
      const optimisticTimestamp = numberValue(message.timestamp)
      if (optimisticTimestamp !== null) {
        persistedIndex = persistedMessages.findIndex((persisted, candidateIndex) => (
          !consumedPersistedMessages.has(candidateIndex)
          && persisted.allowContentTimestampMatch === true
          && persisted.text === text
          && !persisted.ids.some((persistedId) => baselineIds.has(persistedId))
          && Math.abs(persisted.timestamp - optimisticTimestamp) <= 60_000
        ))
      }
    }
    if (persistedIndex >= 0) {
      consumedPersistedMessages.add(persistedIndex)
      continue
    }
    const turnId = `optimistic:${id}`
    builder.userRequest(
      turnId,
      `optimistic:${id}`,
      uniqueContent([
        ...userContentFromBlocks(message.content ?? text),
        ...userContentFromBlocks(message.attachments),
      ]),
      message.timestamp,
      false,
    )
  }
}

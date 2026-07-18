import type { ServerNotification } from '../../src/features/agent/codex-protocol/generated/ServerNotification'
import type { Thread } from '../../src/features/agent/codex-protocol/generated/v2/Thread'
import type { ThreadItem } from '../../src/features/agent/codex-protocol/generated/v2/ThreadItem'
import type { Turn } from '../../src/features/agent/codex-protocol/generated/v2/Turn'
import type {
  CodexNativeItemRuntime,
  CodexNativeNotice,
  CodexNativeSessionSnapshot,
  CodexNativeTurnRuntime,
} from '../../src/features/agent/types'

type LoggedNotification = {
  notification: ServerNotification
  revision: number
}

type StoreEntry = {
  hydrationRevisions: Map<number, number>
  notifications: LoggedNotification[]
  revision: number
  snapshot: CodexNativeSessionSnapshot | null
}

export type CodexHydrationCheckpoint = {
  revision: number
  snapshot: CodexNativeSessionSnapshot | null
  threadId: string
}

const MAX_BUFFERED_NOTIFICATIONS = 2_048
const MAX_VISIBLE_NOTICES = 50

function emptyItemRuntime(): CodexNativeItemRuntime {
  return { output: '', progress: [], terminalInput: '' }
}

function emptyTurnRuntime(): CodexNativeTurnRuntime {
  return { diff: null, plan: null }
}

function executionStateFromThread(thread: Thread): CodexNativeSessionSnapshot['status'] {
  return thread.status.type === 'active' ? { type: 'busy' } : { type: 'idle' }
}

function createSnapshot(thread: Thread): CodexNativeSessionSnapshot {
  return {
    agentId: 'codex',
    itemRuntime: {},
    notices: [],
    sequence: 0,
    status: executionStateFromThread(thread),
    thread: normalizeThread(thread),
    tokenUsage: null,
    turnRuntime: {},
  }
}

function getThreadId(notification: ServerNotification) {
  if (notification.method === 'thread/started') return notification.params.thread.id
  if ('threadId' in notification.params) {
    const value = notification.params.threadId
    return typeof value === 'string' ? value : null
  }
  return null
}

function findTurn(snapshot: CodexNativeSessionSnapshot, turnId: string) {
  return snapshot.thread.turns.find((turn) => turn.id === turnId) ?? null
}

function ensureTurn(snapshot: CodexNativeSessionSnapshot, turnId: string) {
  const existing = findTurn(snapshot, turnId)
  if (existing) return existing
  const turn: Turn = {
    completedAt: null,
    durationMs: null,
    error: null,
    id: turnId,
    items: [],
    itemsView: 'full',
    startedAt: null,
    status: 'inProgress',
  }
  snapshot.thread.turns.push(turn)
  return turn
}

function mergeIndexedStrings(current: string[], incoming: string[]) {
  const length = Math.max(current.length, incoming.length)
  return Array.from({ length }, (_, index) => incoming[index] || current[index] || '')
}

function isLegacySynthesizedItemId(id: string) {
  return /^item-\d+$/.test(id)
}

function serializeUserContent(item: Extract<ThreadItem, { type: 'userMessage' }>) {
  return JSON.stringify(item.content)
}

function isLogicalMessageDuplicate(current: ThreadItem, incoming: ThreadItem) {
  if (current.type === 'userMessage' && incoming.type === 'userMessage') {
    if (current.clientId && incoming.clientId) return current.clientId === incoming.clientId
    return serializeUserContent(current) === serializeUserContent(incoming)
      && isLegacySynthesizedItemId(current.id) !== isLegacySynthesizedItemId(incoming.id)
  }

  if (current.type === 'agentMessage' && incoming.type === 'agentMessage') {
    return current.text === incoming.text
      && current.phase === incoming.phase
      && isLegacySynthesizedItemId(current.id) !== isLegacySynthesizedItemId(incoming.id)
  }

  return false
}

function mergeLogicalMessageDuplicate(current: ThreadItem, incoming: ThreadItem): ThreadItem {
  if (current.type === 'userMessage' && incoming.type === 'userMessage') {
    return {
      ...structuredClone(incoming),
      clientId: current.clientId ?? incoming.clientId,
      content: incoming.content.length > 0
        ? structuredClone(incoming.content)
        : structuredClone(current.content),
      id: current.id,
    }
  }

  if (current.type === 'agentMessage' && incoming.type === 'agentMessage') {
    return {
      ...structuredClone(incoming),
      id: current.id,
      memoryCitation: incoming.memoryCitation ?? current.memoryCitation,
      phase: incoming.phase ?? current.phase,
      text: incoming.text || current.text,
    }
  }

  return structuredClone(current)
}

function reconcileThreadItems(items: ThreadItem[]) {
  const reconciled: ThreadItem[] = []
  for (const item of items) {
    const duplicateIndex = reconciled.findIndex((candidate) => isLogicalMessageDuplicate(candidate, item))
    if (duplicateIndex < 0) {
      reconciled.push(structuredClone(item))
      continue
    }
    reconciled[duplicateIndex] = mergeLogicalMessageDuplicate(reconciled[duplicateIndex], item)
  }
  return reconciled
}

function normalizeTurn(turn: Turn): Turn {
  return {
    ...structuredClone(turn),
    items: reconcileThreadItems(turn.items),
  }
}

function normalizeThread(thread: Thread): Thread {
  return {
    ...structuredClone(thread),
    turns: thread.turns.map(normalizeTurn),
  }
}

function mergeThreadItem(current: ThreadItem, incoming: ThreadItem): ThreadItem {
  if (current.id !== incoming.id || current.type !== incoming.type) return structuredClone(incoming)

  if (current.type === 'agentMessage' && incoming.type === 'agentMessage') {
    return { ...structuredClone(incoming), text: incoming.text || current.text }
  }
  if (current.type === 'plan' && incoming.type === 'plan') {
    return { ...structuredClone(incoming), text: incoming.text || current.text }
  }
  if (current.type === 'reasoning' && incoming.type === 'reasoning') {
    return {
      ...structuredClone(incoming),
      content: mergeIndexedStrings(current.content, incoming.content),
      summary: mergeIndexedStrings(current.summary, incoming.summary),
    }
  }

  return structuredClone(incoming)
}

function mergeThreadItems(current: ThreadItem[], incoming: ThreadItem[]) {
  const currentById = new Map(current.map((item) => [item.id, item]))
  const incomingIds = new Set(incoming.map((item) => item.id))
  return reconcileThreadItems([
    ...incoming.map((item) => {
      const existing = currentById.get(item.id)
      return existing ? mergeThreadItem(existing, item) : structuredClone(item)
    }),
    ...current.filter((item) => !incomingIds.has(item.id)).map((item) => structuredClone(item)),
  ])
}

function mergeTurn(current: Turn, incoming: Turn): Turn {
  return {
    ...structuredClone(incoming),
    items: mergeThreadItems(current.items, incoming.items),
  }
}

function upsertTurn(snapshot: CodexNativeSessionSnapshot, turn: Turn) {
  const index = snapshot.thread.turns.findIndex((candidate) => candidate.id === turn.id)
  const next = index < 0 ? normalizeTurn(turn) : mergeTurn(snapshot.thread.turns[index], turn)
  if (index < 0) snapshot.thread.turns.push(next)
  else snapshot.thread.turns[index] = next
}

function upsertItem(snapshot: CodexNativeSessionSnapshot, turnId: string, item: ThreadItem) {
  const turn = ensureTurn(snapshot, turnId)
  const index = turn.items.findIndex((candidate) => candidate.id === item.id)
  const next = structuredClone(item)
  if (index < 0) turn.items.push(next)
  else turn.items[index] = next
  turn.items = reconcileThreadItems(turn.items)
}

function upsertStartedItem(snapshot: CodexNativeSessionSnapshot, turnId: string, item: ThreadItem) {
  const turn = ensureTurn(snapshot, turnId)
  const index = turn.items.findIndex((candidate) => candidate.id === item.id)
  if (index < 0) {
    turn.items.push(structuredClone(item))
    turn.items = reconcileThreadItems(turn.items)
    return
  }
  const current = turn.items[index]
  const next = structuredClone(item)
  if (current.type === 'agentMessage' && next.type === 'agentMessage' && current.text && !next.text) {
    next.text = current.text
  } else if (current.type === 'plan' && next.type === 'plan' && current.text && !next.text) {
    next.text = current.text
  } else if (current.type === 'reasoning' && next.type === 'reasoning') {
    if (next.summary.length === 0) next.summary = current.summary
    if (next.content.length === 0) next.content = current.content
  }
  turn.items[index] = next
  turn.items = reconcileThreadItems(turn.items)
}

function ensureAgentMessage(snapshot: CodexNativeSessionSnapshot, turnId: string, itemId: string) {
  const turn = ensureTurn(snapshot, turnId)
  const existing = turn.items.find((item) => item.id === itemId)
  if (existing?.type === 'agentMessage') return existing
  const item: Extract<ThreadItem, { type: 'agentMessage' }> = {
    id: itemId,
    memoryCitation: null,
    phase: null,
    text: '',
    type: 'agentMessage',
  }
  turn.items.push(item)
  return item
}

function ensurePlan(snapshot: CodexNativeSessionSnapshot, turnId: string, itemId: string) {
  const turn = ensureTurn(snapshot, turnId)
  const existing = turn.items.find((item) => item.id === itemId)
  if (existing?.type === 'plan') return existing
  const item: Extract<ThreadItem, { type: 'plan' }> = { id: itemId, text: '', type: 'plan' }
  turn.items.push(item)
  return item
}

function ensureReasoning(snapshot: CodexNativeSessionSnapshot, turnId: string, itemId: string) {
  const turn = ensureTurn(snapshot, turnId)
  const existing = turn.items.find((item) => item.id === itemId)
  if (existing?.type === 'reasoning') return existing
  const item: Extract<ThreadItem, { type: 'reasoning' }> = {
    content: [],
    id: itemId,
    summary: [],
    type: 'reasoning',
  }
  turn.items.push(item)
  return item
}

function ensureIndexedString(values: string[], index: number) {
  while (values.length <= index) values.push('')
}

function getItemRuntime(snapshot: CodexNativeSessionSnapshot, itemId: string) {
  return snapshot.itemRuntime[itemId] ??= emptyItemRuntime()
}

function getTurnRuntime(snapshot: CodexNativeSessionSnapshot, turnId: string) {
  return snapshot.turnRuntime[turnId] ??= emptyTurnRuntime()
}

function addNotice(snapshot: CodexNativeSessionSnapshot, notice: CodexNativeNotice) {
  snapshot.notices.push(notice)
  if (snapshot.notices.length > MAX_VISIBLE_NOTICES) {
    snapshot.notices.splice(0, snapshot.notices.length - MAX_VISIBLE_NOTICES)
  }
}

function applyNotification(
  current: CodexNativeSessionSnapshot,
  notification: ServerNotification,
  revision: number,
) {
  const snapshot = structuredClone(current)
  snapshot.sequence = revision

  switch (notification.method) {
    case 'thread/started': {
      const existingTurns = snapshot.thread.turns
      snapshot.thread = normalizeThread(notification.params.thread)
      if (snapshot.thread.turns.length === 0 && existingTurns.length > 0) snapshot.thread.turns = existingTurns
      snapshot.status = executionStateFromThread(snapshot.thread)
      break
    }
    case 'thread/status/changed':
      snapshot.thread.status = structuredClone(notification.params.status)
      snapshot.status = notification.params.status.type === 'active' ? { type: 'busy' } : { type: 'idle' }
      break
    case 'thread/name/updated':
      snapshot.thread.name = notification.params.threadName?.trim() || null
      break
    case 'thread/tokenUsage/updated':
      snapshot.tokenUsage = structuredClone(notification.params.tokenUsage)
      break
    case 'thread/closed':
      snapshot.thread.status = { type: 'notLoaded' }
      snapshot.status = { type: 'idle' }
      break
    case 'turn/started':
      upsertTurn(snapshot, notification.params.turn)
      snapshot.status = { type: 'busy' }
      break
    case 'turn/completed':
      upsertTurn(snapshot, notification.params.turn)
      snapshot.status = { type: 'idle' }
      break
    case 'item/started':
      upsertStartedItem(snapshot, notification.params.turnId, notification.params.item)
      break
    case 'item/completed':
      upsertItem(snapshot, notification.params.turnId, notification.params.item)
      break
    case 'item/agentMessage/delta':
      ensureAgentMessage(snapshot, notification.params.turnId, notification.params.itemId).text += notification.params.delta
      break
    case 'item/plan/delta':
      ensurePlan(snapshot, notification.params.turnId, notification.params.itemId).text += notification.params.delta
      break
    case 'item/reasoning/summaryPartAdded': {
      const item = ensureReasoning(snapshot, notification.params.turnId, notification.params.itemId)
      ensureIndexedString(item.summary, notification.params.summaryIndex)
      break
    }
    case 'item/reasoning/summaryTextDelta': {
      const item = ensureReasoning(snapshot, notification.params.turnId, notification.params.itemId)
      ensureIndexedString(item.summary, notification.params.summaryIndex)
      item.summary[notification.params.summaryIndex] += notification.params.delta
      break
    }
    case 'item/reasoning/textDelta': {
      const item = ensureReasoning(snapshot, notification.params.turnId, notification.params.itemId)
      ensureIndexedString(item.content, notification.params.contentIndex)
      item.content[notification.params.contentIndex] += notification.params.delta
      break
    }
    case 'item/commandExecution/outputDelta':
    case 'item/fileChange/outputDelta':
      getItemRuntime(snapshot, notification.params.itemId).output += notification.params.delta
      break
    case 'item/commandExecution/terminalInteraction':
      getItemRuntime(snapshot, notification.params.itemId).terminalInput += notification.params.stdin
      break
    case 'item/fileChange/patchUpdated': {
      const turn = ensureTurn(snapshot, notification.params.turnId)
      const item = turn.items.find((candidate) => candidate.id === notification.params.itemId)
      if (item?.type === 'fileChange') item.changes = structuredClone(notification.params.changes)
      break
    }
    case 'item/mcpToolCall/progress':
      getItemRuntime(snapshot, notification.params.itemId).progress.push(notification.params.message)
      break
    case 'turn/diff/updated':
      getTurnRuntime(snapshot, notification.params.turnId).diff = notification.params.diff
      break
    case 'turn/plan/updated':
      getTurnRuntime(snapshot, notification.params.turnId).plan = {
        explanation: notification.params.explanation,
        steps: structuredClone(notification.params.plan),
      }
      break
    case 'model/rerouted':
      addNotice(snapshot, {
        id: `model-rerouted:${notification.params.turnId}:${revision}`,
        kind: 'warning',
        message: `模型已从 ${notification.params.fromModel} 切换到 ${notification.params.toModel}。`,
        turnId: notification.params.turnId,
      })
      break
    case 'error':
      {
        const attempt = snapshot.status.type === 'retry' ? snapshot.status.attempt + 1 : 1
      addNotice(snapshot, {
        id: `error:${notification.params.turnId}:${revision}`,
        kind: 'error',
        message: notification.params.error.message,
        turnId: notification.params.turnId,
        willRetry: notification.params.willRetry,
      })
      snapshot.status = notification.params.willRetry
        ? {
            attempt,
            message: notification.params.error.message,
            next: Date.now(),
            type: 'retry',
          }
        : { type: 'idle' }
      break
      }
    case 'warning':
      addNotice(snapshot, {
        id: `warning:${notification.params.threadId ?? snapshot.thread.id}:${revision}`,
        kind: 'warning',
        message: notification.params.message,
        turnId: null,
      })
      break
    case 'guardianWarning':
      addNotice(snapshot, {
        id: `guardian-warning:${notification.params.threadId}:${revision}`,
        kind: 'warning',
        message: notification.params.message,
        turnId: null,
      })
      break
  }

  return snapshot
}

function mergeHydratedThread(current: Thread | null, hydrated: Thread) {
  if (!current) return normalizeThread(hydrated)
  const currentById = new Map(current.turns.map((turn) => [turn.id, turn]))
  const hydratedIds = new Set(hydrated.turns.map((turn) => turn.id))
  const turns = hydrated.turns.map((turn) => {
    const existing = currentById.get(turn.id)
    return existing ? mergeTurn(existing, turn) : structuredClone(turn)
  })
  for (const turn of current.turns) {
    if (!hydratedIds.has(turn.id)) turns.push(structuredClone(turn))
  }
  return normalizeThread({ ...structuredClone(hydrated), turns })
}

export class CodexSessionStore {
  private readonly entries = new Map<string, StoreEntry>()

  beginHydration(threadId: string) {
    const entry = this.getEntry(threadId)
    entry.hydrationRevisions.set(
      entry.revision,
      (entry.hydrationRevisions.get(entry.revision) ?? 0) + 1,
    )
    return {
      revision: entry.revision,
      snapshot: entry.snapshot ? structuredClone(entry.snapshot) : null,
      threadId,
    } satisfies CodexHydrationCheckpoint
  }

  hydrate(thread: Thread, checkpoint: CodexHydrationCheckpoint) {
    if (checkpoint.threadId !== thread.id) throw new Error('Codex hydration checkpoint belongs to another thread.')
    const entry = this.getEntry(thread.id)
    const previous = checkpoint.snapshot
    let snapshot = createSnapshot(mergeHydratedThread(previous?.thread ?? null, thread))
    if (previous) {
      snapshot.itemRuntime = structuredClone(previous.itemRuntime)
      snapshot.notices = structuredClone(previous.notices)
      snapshot.tokenUsage = structuredClone(previous.tokenUsage)
      snapshot.turnRuntime = structuredClone(previous.turnRuntime)
    }
    for (const logged of entry.notifications) {
      if (logged.revision > checkpoint.revision) {
        snapshot = applyNotification(snapshot, logged.notification, logged.revision)
      }
    }
    snapshot.sequence = entry.revision
    entry.snapshot = snapshot
    this.releaseHydration(entry, checkpoint.revision)
    this.pruneNotifications(entry)
    return structuredClone(snapshot)
  }

  cancelHydration(checkpoint: CodexHydrationCheckpoint) {
    const entry = this.entries.get(checkpoint.threadId)
    if (!entry) return
    this.releaseHydration(entry, checkpoint.revision)
    this.pruneNotifications(entry)
  }

  install(thread: Thread) {
    const entry = this.getEntry(thread.id)
    const mergedThread = entry.snapshot
      ? mergeHydratedThread(entry.snapshot.thread, thread)
      : normalizeThread(thread)
    const snapshot = entry.snapshot
      ? {
          ...entry.snapshot,
          status: executionStateFromThread(mergedThread),
          thread: mergedThread,
        }
      : createSnapshot(mergedThread)
    snapshot.sequence = entry.revision
    entry.snapshot = snapshot
    return structuredClone(snapshot)
  }

  markDisconnected(threadId: string, message: string) {
    const entry = this.entries.get(threadId)
    if (!entry?.snapshot) return null
    entry.revision += 1
    const snapshot = structuredClone(entry.snapshot)
    snapshot.sequence = entry.revision
    snapshot.status = { type: 'idle' }
    snapshot.thread.status = { type: 'notLoaded' }
    addNotice(snapshot, {
      id: `connection-error:${threadId}:${entry.revision}`,
      kind: 'error',
      message,
      turnId: null,
    })
    entry.snapshot = snapshot
    return structuredClone(snapshot)
  }

  apply(notification: ServerNotification) {
    const threadId = getThreadId(notification)
    if (!threadId) return null
    const entry = this.getEntry(threadId)
    entry.revision += 1
    entry.notifications.push({ notification: structuredClone(notification), revision: entry.revision })
    this.pruneNotifications(entry)

    if (!entry.snapshot && notification.method === 'thread/started') {
      entry.snapshot = createSnapshot(notification.params.thread)
    }
    if (!entry.snapshot) return null
    entry.snapshot = applyNotification(entry.snapshot, notification, entry.revision)
    return structuredClone(entry.snapshot)
  }

  get(threadId: string) {
    const snapshot = this.entries.get(threadId)?.snapshot
    return snapshot ? structuredClone(snapshot) : null
  }

  delete(threadId: string) {
    this.entries.delete(threadId)
  }

  clear() {
    this.entries.clear()
  }

  private getEntry(threadId: string) {
    let entry = this.entries.get(threadId)
    if (!entry) {
      entry = { hydrationRevisions: new Map(), notifications: [], revision: 0, snapshot: null }
      this.entries.set(threadId, entry)
    }
    return entry
  }

  private pruneNotifications(entry: StoreEntry) {
    const oldestHydrationRevision = entry.hydrationRevisions.size > 0
      ? Math.min(...entry.hydrationRevisions.keys())
      : entry.revision
    const minimumRevision = Math.min(
      oldestHydrationRevision,
      Math.max(0, entry.revision - MAX_BUFFERED_NOTIFICATIONS),
    )
    while (entry.notifications[0] && entry.notifications[0].revision <= minimumRevision) {
      entry.notifications.shift()
    }
  }

  private releaseHydration(entry: StoreEntry, revision: number) {
    const count = entry.hydrationRevisions.get(revision) ?? 0
    if (count <= 1) entry.hydrationRevisions.delete(revision)
    else entry.hydrationRevisions.set(revision, count - 1)
  }
}

import type { AgentId } from '@/features/agent/agent-definition'
import { cacheAgentSessionSnapshot } from '@/features/agent/lib/agent-session-snapshot-cache'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'
import type { AgentSessionSnapshot } from '@/features/agent/types'

const PREFETCHED_SESSION_SNAPSHOT_TTL_MS = 5_000
const MAX_PREFETCHED_SESSION_SNAPSHOTS = 8

type AgentSessionSnapshotRequest = {
  agentId: AgentId
  sessionPath: string
  workspacePath: string
}

type PrefetchedSessionSnapshot = {
  loadedAt: number
  snapshot: AgentSessionSnapshot
}

type PendingSessionSnapshot = {
  intent: 'navigation' | 'prefetch'
  promise: Promise<AgentSessionSnapshot>
}

const pendingSnapshots = new Map<string, PendingSessionSnapshot>()
const prefetchedSnapshots = new Map<string, PrefetchedSessionSnapshot>()

function requestKey({
  agentId,
  sessionPath,
  workspacePath,
}: AgentSessionSnapshotRequest) {
  return `${agentId}\n${normalizeAgentProjectPath(workspacePath)}\n${sessionPath}`
}

function getPrefetchedSnapshot(key: string, consume: boolean) {
  const prefetched = prefetchedSnapshots.get(key)
  if (!prefetched) return null
  if (Date.now() - prefetched.loadedAt > PREFETCHED_SESSION_SNAPSHOT_TTL_MS) {
    prefetchedSnapshots.delete(key)
    return null
  }

  prefetchedSnapshots.delete(key)
  if (!consume) prefetchedSnapshots.set(key, prefetched)
  return prefetched.snapshot
}

function rememberPrefetchedSnapshot(key: string, snapshot: AgentSessionSnapshot) {
  prefetchedSnapshots.delete(key)
  prefetchedSnapshots.set(key, { loadedAt: Date.now(), snapshot })
  while (prefetchedSnapshots.size > MAX_PREFETCHED_SESSION_SNAPSHOTS) {
    const oldestKey = prefetchedSnapshots.keys().next().value
    if (typeof oldestKey !== 'string') break
    prefetchedSnapshots.delete(oldestKey)
  }
}

function requestAgentSessionSnapshot({
  agentId,
  sessionPath,
  workspacePath,
}: AgentSessionSnapshotRequest, intent: PendingSessionSnapshot['intent']) {
  const request = { agentId, sessionPath, workspacePath }
  const key = requestKey(request)
  let entry!: PendingSessionSnapshot
  const promise = window.appApi.readAgentSession({
    agentId,
    workspacePath,
  }, sessionPath).then((snapshot) => {
    cacheAgentSessionSnapshot(agentId, workspacePath, sessionPath, snapshot)
    if (entry.intent === 'prefetch') rememberPrefetchedSnapshot(key, snapshot)
    return snapshot
  }).finally(() => {
    if (pendingSnapshots.get(key) === entry) pendingSnapshots.delete(key)
  })

  entry = { intent, promise }
  pendingSnapshots.set(key, entry)
  return promise
}

/**
 * Loads a fresh session snapshot while coalescing it with an in-flight or
 * freshly completed intent prefetch. Results from ordinary navigation are not
 * retained here: the separate stale-while-revalidate cache may paint them
 * immediately, but every later navigation still validates against the source.
 */
export function loadAgentSessionSnapshot(request: AgentSessionSnapshotRequest) {
  const key = requestKey(request)
  const pending = pendingSnapshots.get(key)
  if (pending) {
    pending.intent = 'navigation'
    return pending.promise
  }

  const prefetched = getPrefetchedSnapshot(key, true)
  if (prefetched) return Promise.resolve(prefetched)

  return requestAgentSessionSnapshot(request, 'navigation')
}

export function prefetchAgentSessionSnapshot(request: AgentSessionSnapshotRequest) {
  const key = requestKey(request)
  const pending = pendingSnapshots.get(key)
  if (pending) return pending.promise

  const prefetched = getPrefetchedSnapshot(key, false)
  if (prefetched) return Promise.resolve(prefetched)

  return requestAgentSessionSnapshot(request, 'prefetch')
}

export function clearAgentSessionSnapshotLoaderState() {
  pendingSnapshots.clear()
  prefetchedSnapshots.clear()
}

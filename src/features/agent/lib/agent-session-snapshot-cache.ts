import { isAgentId, type AgentId } from '@/features/agent/agent-definition'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'
import type { AgentSessionSnapshot } from '@/features/agent/types'

const MAX_CACHED_SESSION_SNAPSHOTS = 8
const MAX_PERSISTED_SESSION_SNAPSHOTS = 6
const MAX_PERSISTED_SNAPSHOT_CHARACTERS = 1_500_000
const MAX_PERSISTED_TOTAL_CHARACTERS = 4_000_000
const PERSISTED_CACHE_MANIFEST_KEY = 'aryn:agent-session-snapshots:v1:manifest'
const PERSISTED_CACHE_PREFIX = 'aryn:agent-session-snapshots:v1:'
const snapshots = new Map<string, AgentSessionSnapshot>()
const pendingPersistence = new Map<string, {
  agentId: AgentId
  sessionPath: string
  snapshot: AgentSessionSnapshot
  workspacePath: string
}>()
let persistenceScheduled = false
let warmupGeneration = 0
let warmupScheduled = false

type PersistedCacheManifestEntry = {
  accessedAt: number
  characters: number
  storageKey: string
}

type PersistedCacheManifest = {
  entries: PersistedCacheManifestEntry[]
  version: 1
}

function cacheKey(agentId: AgentId, workspacePath: string, sessionPath: string) {
  return `${agentId}\n${normalizeAgentProjectPath(workspacePath)}\n${sessionPath}`
}

function cacheMemorySnapshot(
  key: string,
  snapshot: AgentSessionSnapshot,
  position: 'newest' | 'oldest' = 'newest',
) {
  snapshots.delete(key)
  if (position === 'oldest') {
    const currentSnapshots = [...snapshots]
    snapshots.clear()
    snapshots.set(key, snapshot)
    for (const [currentKey, currentSnapshot] of currentSnapshots) {
      snapshots.set(currentKey, currentSnapshot)
    }
  } else {
    snapshots.set(key, snapshot)
  }
  while (snapshots.size > MAX_CACHED_SESSION_SNAPSHOTS) {
    const oldestKey = snapshots.keys().next().value
    if (typeof oldestKey !== 'string') break
    snapshots.delete(oldestKey)
  }
}

function browserStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function isAgentSessionSnapshot(value: unknown): value is AgentSessionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const snapshot = value as Partial<AgentSessionSnapshot>
  return typeof snapshot.sessionId === 'string'
    && (snapshot.sessionPath === null || typeof snapshot.sessionPath === 'string')
    && (snapshot.name === null || typeof snapshot.name === 'string')
    && typeof snapshot.workspacePath === 'string'
    && Array.isArray(snapshot.messages)
}

function persistedStorageKey(agentId: AgentId, workspacePath: string, sessionPath: string) {
  return `${PERSISTED_CACHE_PREFIX}${encodeURIComponent(cacheKey(agentId, workspacePath, sessionPath))}`
}

function readManifest(storage: Storage): PersistedCacheManifest {
  try {
    const parsed = JSON.parse(storage.getItem(PERSISTED_CACHE_MANIFEST_KEY) ?? '') as Partial<PersistedCacheManifest>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error('Invalid cache manifest.')
    return {
      entries: parsed.entries.filter((entry): entry is PersistedCacheManifestEntry => (
        Boolean(entry)
        && typeof entry.accessedAt === 'number'
        && Number.isFinite(entry.accessedAt)
        && typeof entry.characters === 'number'
        && Number.isFinite(entry.characters)
        && entry.characters >= 0
        && typeof entry.storageKey === 'string'
      )),
      version: 1,
    }
  } catch {
    return { entries: [], version: 1 }
  }
}

function writeManifest(storage: Storage, manifest: PersistedCacheManifest) {
  storage.setItem(PERSISTED_CACHE_MANIFEST_KEY, JSON.stringify(manifest))
}

function removePersistedEntry(storage: Storage, manifest: PersistedCacheManifest, storageKey: string) {
  storage.removeItem(storageKey)
  manifest.entries = manifest.entries.filter((entry) => entry.storageKey !== storageKey)
}

function touchPersistedEntry(storage: Storage, storageKey: string, characters: number) {
  const manifest = readManifest(storage)
  manifest.entries = manifest.entries.filter((entry) => entry.storageKey !== storageKey)
  manifest.entries.push({ accessedAt: Date.now(), characters, storageKey })
  writeManifest(storage, manifest)
}

function readPersistedSnapshot(
  agentId: AgentId,
  workspacePath: string,
  sessionPath: string,
) {
  const storage = browserStorage()
  if (!storage) return null
  const storageKey = persistedStorageKey(agentId, workspacePath, sessionPath)
  try {
    const serialized = storage.getItem(storageKey)
    if (!serialized) return null
    const parsed = JSON.parse(serialized) as { snapshot?: AgentSessionSnapshot, version?: unknown }
    const snapshot = parsed.version === 1 && isAgentSessionSnapshot(parsed.snapshot)
      ? parsed.snapshot
      : null
    if (
      !snapshot
      || snapshot.sessionPath !== sessionPath
      || (snapshot.native && snapshot.native.agentId !== agentId)
      || normalizeAgentProjectPath(snapshot.workspacePath) !== normalizeAgentProjectPath(workspacePath)
    ) {
      const manifest = readManifest(storage)
      removePersistedEntry(storage, manifest, storageKey)
      writeManifest(storage, manifest)
      return null
    }
    try {
      touchPersistedEntry(storage, storageKey, serialized.length)
    } catch {
      // The snapshot is still valid when only the best-effort LRU metadata
      // cannot be updated (for example, a temporarily full browser store).
    }
    return snapshot
  } catch {
    const manifest = readManifest(storage)
    removePersistedEntry(storage, manifest, storageKey)
    try {
      writeManifest(storage, manifest)
    } catch {
      // A corrupt or unavailable browser store must never block session navigation.
    }
    return null
  }
}

function decodePersistedStorageKey(storageKey: string) {
  if (!storageKey.startsWith(PERSISTED_CACHE_PREFIX)) return null
  try {
    const key = decodeURIComponent(storageKey.slice(PERSISTED_CACHE_PREFIX.length))
    const firstSeparator = key.indexOf('\n')
    const secondSeparator = key.indexOf('\n', firstSeparator + 1)
    if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) return null
    const agentId = key.slice(0, firstSeparator)
    if (!isAgentId(agentId)) return null
    return {
      agentId,
      key,
      sessionPath: key.slice(secondSeparator + 1),
      workspacePath: key.slice(firstSeparator + 1, secondSeparator),
    }
  } catch {
    return null
  }
}

function warmPersistedSnapshot(storage: Storage, storageKey: string) {
  const decoded = decodePersistedStorageKey(storageKey)
  if (!decoded || snapshots.has(decoded.key)) return
  try {
    const serialized = storage.getItem(storageKey)
    if (!serialized) return
    const parsed = JSON.parse(serialized) as { snapshot?: AgentSessionSnapshot, version?: unknown }
    const snapshot = parsed.version === 1 && isAgentSessionSnapshot(parsed.snapshot)
      ? parsed.snapshot
      : null
    if (
      !snapshot
      || snapshot.sessionPath !== decoded.sessionPath
      || (snapshot.native && snapshot.native.agentId !== decoded.agentId)
      || normalizeAgentProjectPath(snapshot.workspacePath) !== decoded.workspacePath
    ) return

    // Entries are warmed most-recent-first for useful early hits. Older entries
    // are inserted at the LRU front so their persisted access order is retained.
    cacheMemorySnapshot(decoded.key, snapshot, 'oldest')
  } catch {
    // A corrupt best-effort cache entry must never interfere with app startup.
  }
}

function persistSnapshot(
  agentId: AgentId,
  workspacePath: string,
  sessionPath: string,
  snapshot: AgentSessionSnapshot,
) {
  const storage = browserStorage()
  if (!storage) return
  const storageKey = persistedStorageKey(agentId, workspacePath, sessionPath)
  let serialized: string
  try {
    serialized = JSON.stringify({ snapshot, version: 1 })
  } catch {
    return
  }
  if (serialized.length > MAX_PERSISTED_SNAPSHOT_CHARACTERS) {
    const manifest = readManifest(storage)
    removePersistedEntry(storage, manifest, storageKey)
    try {
      writeManifest(storage, manifest)
    } catch {
      // Ignore storage quota and privacy-mode failures.
    }
    return
  }

  const manifest = readManifest(storage)
  removePersistedEntry(storage, manifest, storageKey)
  manifest.entries = manifest.entries.filter((entry) => {
    if (storage.getItem(entry.storageKey) !== null) return true
    return false
  })
  let totalCharacters = manifest.entries.reduce((total, entry) => total + entry.characters, 0)
  manifest.entries.sort((left, right) => left.accessedAt - right.accessedAt)
  while (
    manifest.entries.length >= MAX_PERSISTED_SESSION_SNAPSHOTS
    || totalCharacters + serialized.length > MAX_PERSISTED_TOTAL_CHARACTERS
  ) {
    const oldest = manifest.entries.shift()
    if (!oldest) break
    storage.removeItem(oldest.storageKey)
    totalCharacters -= oldest.characters
  }

  try {
    storage.setItem(storageKey, serialized)
    manifest.entries.push({ accessedAt: Date.now(), characters: serialized.length, storageKey })
    writeManifest(storage, manifest)
  } catch {
    storage.removeItem(storageKey)
    manifest.entries = manifest.entries.filter((entry) => entry.storageKey !== storageKey)
    try {
      writeManifest(storage, manifest)
    } catch {
      // Preserve any still-readable snapshots when only LRU metadata cannot be written.
    }
  }
}

function persistNextPendingSnapshot() {
  persistenceScheduled = false
  const next = pendingPersistence.entries().next().value
  if (!next) return
  const [key, value] = next
  pendingPersistence.delete(key)
  persistSnapshot(value.agentId, value.workspacePath, value.sessionPath, value.snapshot)
  schedulePendingPersistence()
}

function schedulePendingPersistence() {
  if (persistenceScheduled || pendingPersistence.size === 0) return
  persistenceScheduled = true
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => persistNextPendingSnapshot(), { timeout: 2_000 })
  } else {
    setTimeout(() => persistNextPendingSnapshot(), 750)
  }
}

export function getCachedAgentSessionSnapshot(
  agentId: AgentId,
  workspacePath: string,
  sessionPath: string,
) {
  const key = cacheKey(agentId, workspacePath, sessionPath)
  const snapshot = snapshots.get(key)
    ?? readPersistedSnapshot(agentId, workspacePath, sessionPath)
    ?? null
  if (!snapshot) return null
  cacheMemorySnapshot(key, snapshot)
  return snapshot
}

export function cacheAgentSessionSnapshot(
  agentId: AgentId,
  workspacePath: string,
  sessionPath: string,
  snapshot: AgentSessionSnapshot,
) {
  const key = cacheKey(agentId, workspacePath, sessionPath)
  cacheMemorySnapshot(key, snapshot)
  pendingPersistence.set(key, { agentId, sessionPath, snapshot, workspacePath })
  schedulePendingPersistence()
}

/**
 * Incrementally hydrates the small persistent LRU into memory after first
 * paint. Each idle callback parses at most one snapshot, avoiding a long
 * renderer task while keeping the next session click fully synchronous.
 */
export function scheduleAgentSessionSnapshotCacheWarmup() {
  if (warmupScheduled) return
  const storage = browserStorage()
  if (!storage) return
  const generation = warmupGeneration
  let entries: PersistedCacheManifestEntry[] | null = null
  warmupScheduled = true

  const run = () => {
    if (generation !== warmupGeneration) return
    if (!entries) {
      entries = readManifest(storage).entries
        .slice()
        .sort((left, right) => right.accessedAt - left.accessedAt)
    }
    const next = entries.shift()
    if (!next) {
      warmupScheduled = false
      return
    }

    warmPersistedSnapshot(storage, next.storageKey)
    scheduleNext()
  }
  const scheduleNext = () => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 2_000 })
    } else {
      setTimeout(run, 250)
    }
  }

  scheduleNext()
}

export function clearAgentSessionSnapshotCache() {
  warmupGeneration += 1
  warmupScheduled = false
  snapshots.clear()
  pendingPersistence.clear()
  persistenceScheduled = false
}

export function clearPersistedAgentSessionSnapshotCache() {
  const storage = browserStorage()
  if (!storage) return
  const manifest = readManifest(storage)
  for (const entry of manifest.entries) storage.removeItem(entry.storageKey)
  storage.removeItem(PERSISTED_CACHE_MANIFEST_KEY)
}

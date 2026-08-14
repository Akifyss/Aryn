import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cacheAgentSessionSnapshot,
  clearAgentSessionSnapshotCache,
  clearPersistedAgentSessionSnapshotCache,
  getCachedAgentSessionSnapshot,
  scheduleAgentSessionSnapshotCacheWarmup,
} from '../src/features/agent/lib/agent-session-snapshot-cache'
import type { AgentSessionSnapshot } from '../src/features/agent/types'

function snapshot(index: number) {
  return {
    messages: [],
    name: `Session ${index}`,
    sessionId: `session-${index}`,
    sessionPath: `session-${index}`,
    workspacePath: 'C:/workspace',
  } as unknown as AgentSessionSnapshot
}

afterEach(() => {
  clearAgentSessionSnapshotCache()
  clearPersistedAgentSessionSnapshotCache()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('agent session snapshot cache', () => {
  it('keeps recent snapshots immediately available with a bounded LRU', () => {
    for (let index = 0; index < 8; index += 1) {
      cacheAgentSessionSnapshot('codex', 'C:/workspace', `session-${index}`, snapshot(index))
    }
    expect(getCachedAgentSessionSnapshot('codex', 'C:/workspace', 'session-0'))
      .toMatchObject({ sessionId: 'session-0' })

    cacheAgentSessionSnapshot('codex', 'C:/workspace', 'session-8', snapshot(8))

    expect(getCachedAgentSessionSnapshot('codex', 'C:/workspace', 'session-1')).toBeNull()
    expect(getCachedAgentSessionSnapshot('codex', 'C:/workspace', 'session-0'))
      .toMatchObject({ sessionId: 'session-0' })
    expect(getCachedAgentSessionSnapshot('codex', 'C:/other-workspace', 'session-0')).toBeNull()
  })

  it('restores a bounded snapshot after an Electron window restart while refreshing stays asynchronous', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.useFakeTimers()

    cacheAgentSessionSnapshot('codex', 'C:/workspace', 'session-1', snapshot(1))
    await vi.advanceTimersByTimeAsync(750)
    clearAgentSessionSnapshotCache()

    expect(getCachedAgentSessionSnapshot('codex', 'C:/workspace', 'session-1'))
      .toMatchObject({ sessionId: 'session-1' })
  })

  it('warms persisted snapshots incrementally before the first session click', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
    vi.useFakeTimers()

    cacheAgentSessionSnapshot('codex', 'C:/workspace', 'session-1', snapshot(1))
    await vi.advanceTimersByTimeAsync(750)
    clearAgentSessionSnapshotCache()

    scheduleAgentSessionSnapshotCacheWarmup()
    await vi.advanceTimersByTimeAsync(250)
    clearPersistedAgentSessionSnapshotCache()

    expect(getCachedAgentSessionSnapshot('codex', 'C:/workspace', 'session-1'))
      .toMatchObject({ sessionId: 'session-1' })
  })

  it('preserves existing snapshots when a later persistence write exceeds storage quota', async () => {
    const values = new Map<string, string>()
    let rejectSnapshotWrites = false
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => {
        if (rejectSnapshotWrites && key.includes('session-2')) throw new Error('quota exceeded')
        values.set(key, value)
      },
    })
    vi.useFakeTimers()

    cacheAgentSessionSnapshot('codex', 'C:/workspace', 'session-1', snapshot(1))
    await vi.advanceTimersByTimeAsync(750)
    rejectSnapshotWrites = true
    cacheAgentSessionSnapshot('codex', 'C:/workspace', 'session-2', snapshot(2))
    await vi.advanceTimersByTimeAsync(750)
    clearAgentSessionSnapshotCache()

    expect(getCachedAgentSessionSnapshot('codex', 'C:/workspace', 'session-1'))
      .toMatchObject({ sessionId: 'session-1' })
    expect(getCachedAgentSessionSnapshot('codex', 'C:/workspace', 'session-2')).toBeNull()
  })
})

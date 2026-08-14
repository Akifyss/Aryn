import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cacheAgentSessionSnapshot,
  clearAgentSessionSnapshotCache,
} from '../src/features/agent/lib/agent-session-snapshot-cache'
import {
  clearAgentSessionSnapshotLoaderState,
  loadAgentSessionSnapshot,
  prefetchAgentSessionSnapshot,
} from '../src/features/agent/lib/agent-session-snapshot-loader'
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
  clearAgentSessionSnapshotLoaderState()
  clearAgentSessionSnapshotCache()
  vi.unstubAllGlobals()
})

describe('agent session snapshot loader', () => {
  it('coalesces an intent prefetch with the subsequent click request', async () => {
    let resolveSnapshot: ((value: AgentSessionSnapshot) => void) | null = null
    const readAgentSession = vi.fn(() => new Promise<AgentSessionSnapshot>((resolve) => {
      resolveSnapshot = resolve
    }))
    vi.stubGlobal('window', { appApi: { readAgentSession } })
    const request = {
      agentId: 'codex' as const,
      sessionPath: 'session-1',
      workspacePath: 'C:/workspace',
    }

    const prefetched = prefetchAgentSessionSnapshot(request)
    const clicked = loadAgentSessionSnapshot(request)

    expect(clicked).toBe(prefetched)
    expect(readAgentSession).toHaveBeenCalledTimes(1)
    resolveSnapshot?.(snapshot(1))
    await expect(clicked).resolves.toMatchObject({ sessionId: 'session-1' })

    readAgentSession.mockResolvedValue(snapshot(2))
    await expect(loadAgentSessionSnapshot(request))
      .resolves.toMatchObject({ sessionId: 'session-2' })
    expect(readAgentSession).toHaveBeenCalledTimes(2)
  })

  it('refreshes an older cache during prefetch and lets the following navigation consume it once', async () => {
    const readAgentSession = vi.fn().mockResolvedValue(snapshot(1))
    vi.stubGlobal('window', { appApi: { readAgentSession } })
    cacheAgentSessionSnapshot('codex', 'C:/workspace', 'session-1', {
      ...snapshot(0),
      sessionPath: 'session-1',
    })
    const request = {
      agentId: 'codex' as const,
      sessionPath: 'session-1',
      workspacePath: 'C:/workspace',
    }

    await expect(prefetchAgentSessionSnapshot(request))
      .resolves.toMatchObject({ sessionId: 'session-1' })
    expect(readAgentSession).toHaveBeenCalledTimes(1)

    await expect(loadAgentSessionSnapshot({
      ...request,
    })).resolves.toMatchObject({ sessionId: 'session-1' })
    expect(readAgentSession).toHaveBeenCalledTimes(1)

    await expect(loadAgentSessionSnapshot(request))
      .resolves.toMatchObject({ sessionId: 'session-1' })
    expect(readAgentSession).toHaveBeenCalledTimes(2)
  })

  it('does not retain the result when navigation joins an in-flight prefetch', async () => {
    let resolveSnapshot: ((value: AgentSessionSnapshot) => void) | null = null
    const readAgentSession = vi.fn(() => new Promise<AgentSessionSnapshot>((resolve) => {
      resolveSnapshot = resolve
    }))
    vi.stubGlobal('window', { appApi: { readAgentSession } })
    const request = {
      agentId: 'codex' as const,
      sessionPath: 'session-1',
      workspacePath: 'C:/workspace',
    }

    const prefetched = prefetchAgentSessionSnapshot(request)
    const navigated = loadAgentSessionSnapshot(request)
    expect(navigated).toBe(prefetched)

    resolveSnapshot?.(snapshot(1))
    await navigated
    readAgentSession.mockResolvedValue(snapshot(2))

    await expect(loadAgentSessionSnapshot(request))
      .resolves.toMatchObject({ sessionId: 'session-2' })
    expect(readAgentSession).toHaveBeenCalledTimes(2)
  })
})

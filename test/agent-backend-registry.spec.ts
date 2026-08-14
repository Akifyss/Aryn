import { describe, expect, it, vi } from 'vitest'
import { AGENT_IDS, type AgentId } from '../src/features/agent/agent-definition'
import { AgentApplicationService } from '../electron/main/agent-host/application/agent-application-service'
import { AgentBackendRegistry } from '../electron/main/agent-host/application/backend-registry'
import type { AgentBackend } from '../electron/main/agent-host/application/agent-backend'
import type { AgentInteractionHistoryStore } from '../electron/main/agent-host/sessions/interaction-history'
import type { AgentSessionSnapshot } from '../src/features/agent/types'

function createBackend(agentId: AgentId) {
  return { agentId, capabilities: {} } as AgentBackend
}

describe('AgentBackendRegistry', () => {
  it('resolves every product Agent through one exhaustive registry', () => {
    const backends = AGENT_IDS.map(createBackend)
    const registry = new AgentBackendRegistry(backends)

    expect(AGENT_IDS.map((agentId) => registry.get(agentId))).toEqual(backends)
    expect([...registry.values()]).toEqual(backends)
  })

  it('rejects an incomplete composition root', () => {
    const backends = AGENT_IDS
      .filter((agentId) => agentId !== 'codex')
      .map(createBackend)

    expect(() => new AgentBackendRegistry(backends)).toThrow(
      'Agent backend registry is incomplete: codex.',
    )
  })

  it('rejects duplicate provider ownership', () => {
    const backends = [...AGENT_IDS.map(createBackend), createBackend('opencode')]

    expect(() => new AgentBackendRegistry(backends)).toThrow(
      'Agent backend "opencode" is registered more than once.',
    )
  })

  it('rejects backends outside the product Agent catalog', () => {
    const unknownBackend = createBackend('codex')
    Object.defineProperty(unknownBackend, 'agentId', { value: 'unknown-agent' })

    expect(() => new AgentBackendRegistry([
      ...AGENT_IDS.map(createBackend),
      unknownBackend,
    ])).toThrow(
      'Agent backend "unknown-agent" has an unknown Agent ID.',
    )
  })

  it('awaits every backend disposal before reporting aggregated failures', async () => {
    let releaseCodexDisposal!: () => void
    const codexDisposal = new Promise<void>((resolve) => {
      releaseCodexDisposal = resolve
    })
    const disposals = Object.fromEntries(AGENT_IDS.map((agentId) => [
      agentId,
      vi.fn(() => {
        if (agentId === 'pi') throw new Error('PI disposal failed')
        if (agentId === 'codex') return codexDisposal
      }),
    ])) as Record<AgentId, ReturnType<typeof vi.fn>>
    const backends = AGENT_IDS.map((agentId) => ({
      ...createBackend(agentId),
      dispose: disposals[agentId],
    }))
    const service = new AgentApplicationService(new AgentBackendRegistry(backends))

    const disposal = service.dispose()
    let settled = false
    void disposal.then(
      () => { settled = true },
      () => { settled = true },
    )
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(AGENT_IDS.map((agentId) => disposals[agentId].mock.calls.length))
      .toEqual(AGENT_IDS.map(() => 1))
    releaseCodexDisposal()
    await expect(disposal).rejects.toThrow(
      'One or more Agent backends could not be disposed.',
    )
    expect(AGENT_IDS.map((agentId) => disposals[agentId].mock.calls.length))
      .toEqual(AGENT_IDS.map(() => 1))

    expect(service.dispose()).toBe(disposal)
    await expect(service.dispose()).rejects.toThrow(
      'One or more Agent backends could not be disposed.',
    )
    expect(AGENT_IDS.map((agentId) => disposals[agentId].mock.calls.length))
      .toEqual(AGENT_IDS.map(() => 1))
  })

  it('clears builtin PI history by session path without changing backend deletion flow', async () => {
    const sessionPath = 'C:/agent/sessions/session.jsonl'
    const deletedState = { activeSession: null, sessions: [] }
    const deleteSession = vi.fn(async () => deletedState)
    const backends = AGENT_IDS.map((agentId) => agentId === 'builtin-pi'
      ? {
          ...createBackend(agentId),
          deleteSession,
        } as AgentBackend
      : createBackend(agentId))
    const clearSession = vi.fn(async () => {
      throw new Error('history storage unavailable')
    })
    const history = { clearSession } as unknown as AgentInteractionHistoryStore
    const service = new AgentApplicationService(new AgentBackendRegistry(backends), history)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await expect(service.deleteSession({
        agentId: 'builtin-pi',
        sessionPath,
        workspacePath: 'C:/workspace',
      }, sessionPath)).resolves.toBe(deletedState)
      expect(clearSession).toHaveBeenCalledWith('builtin-pi', sessionPath)
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  it('returns a session snapshot before loading its interaction history', async () => {
    const snapshot = {
      interactionHistory: [],
      messages: [],
      name: 'Fast snapshot',
      sessionId: 'session-1',
      sessionPath: 'session-1',
      workspacePath: 'C:/workspace',
    } as unknown as AgentSessionSnapshot
    const readSession = vi.fn(async () => snapshot)
    const readHistory = vi.fn(async () => [{ id: 'interaction-1' }])
    const history = { read: readHistory } as unknown as AgentInteractionHistoryStore
    const backends = AGENT_IDS.map((agentId) => agentId === 'codex'
      ? { ...createBackend(agentId), readSession } as AgentBackend
      : createBackend(agentId))
    const service = new AgentApplicationService(new AgentBackendRegistry(backends), history)
    const scope = {
      agentId: 'codex' as const,
      sessionPath: null,
      workspacePath: 'C:/workspace',
    }

    await expect(service.readSession(scope, 'session-1')).resolves.toBe(snapshot)
    expect(readHistory).not.toHaveBeenCalled()

    await expect(service.readSessionInteractionHistory(scope, 'session-1'))
      .resolves.toEqual([{ id: 'interaction-1' }])
    expect(readHistory).toHaveBeenCalledWith('codex', 'session-1', 'C:/workspace')
  })

  it('waits for pending interaction-history writes during disposal', async () => {
    let releaseBackend!: () => void
    const backendDisposal = new Promise<void>((resolve) => {
      releaseBackend = resolve
    })
    let releaseHistory!: () => void
    const historyDrain = new Promise<void>((resolve) => {
      releaseHistory = resolve
    })
    const history = {
      drain: vi.fn(() => historyDrain),
    } as unknown as AgentInteractionHistoryStore
    const backends = AGENT_IDS.map((agentId) => ({
      ...createBackend(agentId),
      dispose: vi.fn(() => agentId === 'codex' ? backendDisposal : undefined),
    }))
    const service = new AgentApplicationService(new AgentBackendRegistry(backends), history)

    const disposal = service.dispose()
    let settled = false
    void disposal.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    expect(history.drain).not.toHaveBeenCalled()

    releaseBackend()
    await vi.waitFor(() => {
      expect(history.drain).toHaveBeenCalledOnce()
    })
    expect(settled).toBe(false)

    releaseHistory()
    await expect(disposal).resolves.toBeUndefined()
  })
})

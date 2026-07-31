import { describe, expect, it, vi } from 'vitest'
import { AGENT_IDS, type AgentId } from '../src/features/agent/agent-definition'
import { AgentApplicationService } from '../electron/main/agent-host/application/agent-application-service'
import { AgentBackendRegistry } from '../electron/main/agent-host/application/backend-registry'
import type { AgentBackend } from '../electron/main/agent-host/application/agent-backend'

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
})

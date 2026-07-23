import { describe, expect, it } from 'vitest'
import { AGENT_IDS, type AgentId } from '../src/features/agent/agent-definition'
import { AgentBackendRegistry } from '../electron/main/agent-backends/registry'
import type { AgentBackend } from '../electron/main/agent-backends/types'

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
})

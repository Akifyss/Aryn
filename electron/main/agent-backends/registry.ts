import {
  AGENT_IDS,
  isAgentId,
  type AgentId,
} from '../../../src/features/agent/agent-definition'
import type { AgentBackend } from './types'

/** Immutable registry used as the single provider lookup boundary. */
export class AgentBackendRegistry {
  private readonly backends: ReadonlyMap<AgentId, AgentBackend>

  constructor(backends: Iterable<AgentBackend>) {
    const registered = new Map<AgentId, AgentBackend>()
    for (const backend of backends) {
      if (!isAgentId(backend.agentId)) {
        throw new Error(`Agent backend "${String(backend.agentId)}" has an unknown Agent ID.`)
      }
      if (registered.has(backend.agentId)) {
        throw new Error(`Agent backend "${backend.agentId}" is registered more than once.`)
      }
      registered.set(backend.agentId, backend)
    }

    const missingAgentIds = AGENT_IDS.filter((agentId) => !registered.has(agentId))
    if (missingAgentIds.length > 0) {
      throw new Error(`Agent backend registry is incomplete: ${missingAgentIds.join(', ')}.`)
    }
    this.backends = registered
  }

  get(agentId: AgentId) {
    const backend = this.backends.get(agentId)
    if (!backend) {
      // The constructor enforces exhaustiveness. Keep a runtime guard here so a
      // future dynamically assembled registry still fails at the routing edge.
      throw new Error(`Agent backend "${agentId}" is not registered.`)
    }
    return backend
  }

  values() {
    return this.backends.values()
  }
}

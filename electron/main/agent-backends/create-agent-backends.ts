import type { AgentClientEvent, AgentClientEventPayload } from '../../../src/features/agent/types'
import type { AgentId } from '../../../src/features/agent/agent-definition'
import { CodexAgentManager } from '../codex-agent'
import { OpenCodeAgentManager } from '../opencode-agent'
import { PiCliAgentManager } from '../pi-cli-agent'
import { BuiltinPiBackend } from './builtin-pi-backend'
import { ExternalAgentBackend } from './external-agent-backend'
import { AgentBackendRegistry } from './registry'

type CreateAgentBackendRegistryOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEvent) => void
}

function bindAgentId(
  agentId: AgentId,
  emitEvent: (event: AgentClientEvent) => void,
) {
  return (event: AgentClientEventPayload) => {
    emitEvent({ ...event, agentId } as AgentClientEvent)
  }
}

/** Production composition root for all Agent backend implementations. */
export function createAgentBackendRegistry(options: CreateAgentBackendRegistryOptions) {
  const codexManager = new CodexAgentManager({
    agentDir: options.agentDir,
    emitEvent: bindAgentId('codex', options.emitEvent),
  })
  const openCodeManager = new OpenCodeAgentManager({
    agentDir: options.agentDir,
    emitEvent: bindAgentId('opencode', options.emitEvent),
  })
  const piCliManager = new PiCliAgentManager({
    agentDir: options.agentDir,
    emitEvent: bindAgentId('pi', options.emitEvent),
  })

  return new AgentBackendRegistry([
    new BuiltinPiBackend(bindAgentId('builtin-pi', options.emitEvent), { agentDir: options.agentDir }),
    new ExternalAgentBackend('pi', piCliManager),
    new ExternalAgentBackend('opencode', openCodeManager, {
      forwardPromptOptions: true,
      openCodeSurface: {
        request: (cwd, request) => openCodeManager.requestSurfaceData(cwd, request),
      },
    }),
    new ExternalAgentBackend('codex', codexManager, { forwardPromptOptions: true }),
  ])
}

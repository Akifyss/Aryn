import type { AgentClientEvent, AgentClientEventPayload } from '../../shared/agent-contracts/types'
import type { AgentId } from '../../shared/agent-contracts/definition'
import { AgentApplicationService } from '../agent-host/application/agent-application-service'
import { AgentBackendRegistry } from '../agent-host/application/backend-registry'
import { BuiltinPiBackend } from '../agent-host/providers/builtin-pi/backend'
import { CodexAgentManager } from '../agent-host/providers/codex/manager'
import { OpenCodeAgentManager } from '../agent-host/providers/opencode/manager'
import { PiCliAgentManager } from '../agent-host/providers/pi-cli/manager'
import { ExternalAgentBackend } from '../agent-host/providers/shared/external-agent-backend'

type CreateAgentHostOptions = {
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

/** Single production composition root for the complete Agent Host. */
export function createAgentHost(options: CreateAgentHostOptions) {
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

  const backends = new AgentBackendRegistry([
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
  return new AgentApplicationService(backends)
}

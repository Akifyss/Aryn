import type { AgentClientEvent, AgentClientEventPayload } from '../../shared/agent-contracts/types'
import type { AgentId } from '../../shared/agent-contracts/definition'
import { AgentApplicationService } from '../agent-host/application/agent-application-service'
import { AgentBackendRegistry } from '../agent-host/application/backend-registry'
import { BuiltinPiBackend } from '../agent-host/providers/builtin-pi/backend'
import { CodexAgentManager } from '../agent-host/providers/codex/manager'
import { OpenCodeAgentManager } from '../agent-host/providers/opencode/manager'
import { PiCliAgentManager } from '../agent-host/providers/pi-cli/manager'
import { ExternalAgentBackend } from '../agent-host/providers/shared/external-agent-backend'
import { AgentInteractionHistoryStore } from '../agent-host/sessions/interaction-history'

type CreateAgentHostOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEvent) => void
}

function bindAgentId(
  agentId: AgentId,
  emitEvent: (event: AgentClientEvent) => void,
  interactionHistory: AgentInteractionHistoryStore,
) {
  return (event: AgentClientEventPayload) => {
    const enrichedEvent = interactionHistory.enrichEvent({ ...event, agentId } as AgentClientEvent)
    emitEvent(enrichedEvent)
    void interactionHistory.observeEvent(enrichedEvent).catch((error) => {
      console.error('[Agent Host] Unable to persist interaction history.', error)
    })
  }
}

/** Single production composition root for the complete Agent Host. */
export function createAgentHost(options: CreateAgentHostOptions) {
  const interactionHistory = new AgentInteractionHistoryStore(options.agentDir)
  const bindEvent = (agentId: AgentId) => bindAgentId(agentId, options.emitEvent, interactionHistory)
  const codexManager = new CodexAgentManager({
    agentDir: options.agentDir,
    emitEvent: bindEvent('codex'),
  })
  if (typeof codexManager.prewarm === 'function') {
    void codexManager.prewarm()
  }
  const openCodeManager = new OpenCodeAgentManager({
    agentDir: options.agentDir,
    emitEvent: bindEvent('opencode'),
  })
  const piCliManager = new PiCliAgentManager({
    agentDir: options.agentDir,
    emitEvent: bindEvent('pi'),
  })

  const backends = new AgentBackendRegistry([
    new BuiltinPiBackend(bindEvent('builtin-pi'), { agentDir: options.agentDir }),
    new ExternalAgentBackend('pi', piCliManager),
    new ExternalAgentBackend('opencode', openCodeManager, {
      forwardPromptOptions: true,
      openCodeSurface: {
        request: (cwd, request) => openCodeManager.requestSurfaceData(cwd, request),
      },
    }),
    new ExternalAgentBackend('codex', codexManager, { forwardPromptOptions: true }),
  ])
  return new AgentApplicationService(backends, interactionHistory)
}

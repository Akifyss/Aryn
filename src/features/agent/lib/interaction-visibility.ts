import type { AgentId } from '@/features/agent/agent-definition'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'
import type { AgentInteractionRequest } from '@/features/agent/types'

export function findVisiblePendingInteraction({
  activeRuntimeSessionId,
  isViewingActiveRuntime,
  pendingInteractions,
  selectedAgentId,
  workspacePath,
}: {
  activeRuntimeSessionId: string | null
  isViewingActiveRuntime: boolean
  pendingInteractions: readonly AgentInteractionRequest[]
  selectedAgentId: AgentId
  workspacePath: string | null
}) {
  if (!isViewingActiveRuntime || !activeRuntimeSessionId) return null
  return pendingInteractions.find((request) => (
    request.agentId === selectedAgentId
    && request.sessionId === activeRuntimeSessionId
    && (!workspacePath
      || normalizeAgentProjectPath(request.workspacePath) === normalizeAgentProjectPath(workspacePath))
  )) ?? null
}

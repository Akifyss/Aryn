import type { AgentSessionSelection } from '@/features/agent/lib/project-session-request'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'

export function shouldShowAgentNewConversationPrompt(
  activeWorkspaceContext: ActiveWorkspaceContext,
  selection: AgentSessionSelection,
) {
  return selection.kind === 'new' && activeWorkspaceContext.kind !== 'conversation'
}

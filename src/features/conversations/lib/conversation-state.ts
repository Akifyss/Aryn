import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationState,
} from '@/features/conversations/types'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'

export const conversationDraftContext: ActiveWorkspaceContext = { kind: 'conversationDraft' }

export function createEmptyConversationState(): ConversationState {
  return {
    version: 2,
    conversations: [],
  }
}

export function getConversationById(
  conversationState: ConversationState,
  conversationId: string,
): ConversationRecord | null {
  return conversationState.conversations.find(
    (conversation) => conversation.id === conversationId,
  ) ?? null
}

export function getConversationForContext(
  conversationState: ConversationState,
  activeWorkspaceContext: ActiveWorkspaceContext,
): ConversationRecord | null {
  return activeWorkspaceContext.kind === 'conversation'
    ? getConversationById(conversationState, activeWorkspaceContext.conversationId)
    : null
}

export function isConversationWorkspaceCurrent(
  currentWorkspacePath: string | null,
  conversationWorkspacePath: string | null,
): boolean {
  return Boolean(
    currentWorkspacePath
    && conversationWorkspacePath
    && normalizeFilePath(currentWorkspacePath) === normalizeFilePath(conversationWorkspacePath),
  )
}

export function shouldDisconnectConversationWorkspace(
  currentWorkspacePath: string | null,
  conversationWorkspacePath: string | null,
): boolean {
  return !conversationWorkspacePath
    || isConversationWorkspaceCurrent(currentWorkspacePath, conversationWorkspacePath)
}

export function resolveSuggestedConversationTitle(
  conversation: ConversationRecord | null,
  suggestion: { agentSessionPath: string, title: string },
): string | null {
  const nextTitle = suggestion.title.trim()

  if (
    !nextTitle
    || !conversation
    || conversation.agentSessionPath !== suggestion.agentSessionPath
    || conversation.titleSource === 'user'
    || conversation.title.trim() === nextTitle
  ) {
    return null
  }

  return nextTitle
}

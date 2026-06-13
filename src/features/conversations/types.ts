export type ActiveWorkspaceContext =
  | { kind: 'project'; projectId: string }
  | { kind: 'conversation'; conversationId: string }
  | { kind: 'conversationDraft' }

export type ConversationStatus = 'draft' | 'active'

export type ConversationTitleSource = 'default' | 'prompt' | 'agent' | 'user'

export type ConversationRecord = {
  id: string
  title: string
  titleSource: ConversationTitleSource
  createdAt: string
  updatedAt: string
  status: ConversationStatus
  workspacePath: string | null
  agentSessionPath: string | null
  lastMessagePreview: string | null
}

export type ConversationState = {
  version: number
  conversations: ConversationRecord[]
}

export type CreateConversationWorkspaceRequest = {
  initialPrompt?: string | null
}

export type UpdateConversationRequest = {
  agentSessionPath?: string | null
  lastMessagePreview?: string | null
  status?: ConversationStatus
  title?: string | null
  titleSource?: ConversationTitleSource
}

export type AgentSidebarMessageKind = 'assistant' | 'system' | 'tool' | 'user'

export type AgentSidebarMessage = {
  id: string
  kind: AgentSidebarMessageKind
  text: string
  timestamp: number
  title?: string
  isError?: boolean
}

export type AgentSessionListItem = {
  id: string
  path: string
  name: string | null
  preview: string
  messageCount: number
  createdAt: string
  modifiedAt: string
}

export type AgentRuntimeState = {
  auth: {
    google: AgentProviderAuthState
    openai: AgentProviderAuthState
    openrouter: AgentProviderAuthState
  }
  workspacePath: string | null
  hasConfiguredModels: boolean
  availableModels: string[]
  selectedModel: string | null
  isStreaming: boolean
  setupHint: string | null
}

export type AgentProviderAuthState = {
  envVarName: string
  hasStoredCredential: boolean
  source: 'env' | 'none' | 'stored'
  usesEnvironmentCredential: boolean
}

export type AgentSessionSnapshot = {
  sessionId: string
  sessionPath: string | null
  name: string | null
  workspacePath: string
  messages: AgentSidebarMessage[]
}

export type AgentWorkspaceState = {
  sessions: AgentSessionListItem[]
  activeSession: AgentSessionSnapshot | null
  runtime: AgentRuntimeState
}

export type AgentClientEvent =
  | {
      type: 'assistant_message_started'
      sessionId: string
    }
  | {
      type: 'assistant_message_delta'
      sessionId: string
      delta: string
    }
  | {
      type: 'tool_execution_started'
      sessionId: string
      toolCallId: string
      toolName: string
      summary: string
    }
  | {
      type: 'tool_execution_updated'
      sessionId: string
      toolCallId: string
      toolName: string
      summary: string
    }
  | {
      type: 'tool_execution_finished'
      sessionId: string
      toolCallId: string
      toolName: string
      summary: string
      isError: boolean
    }
  | {
      type: 'workspace_state'
      state: AgentWorkspaceState
    }
  | {
      type: 'error'
      sessionId: string | null
      message: string
    }

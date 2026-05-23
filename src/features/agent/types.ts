export type AgentSidebarMessageKind = 'assistant' | 'custom' | 'system' | 'tool' | 'user'
export type AgentSidebarMessageStatus = 'done' | 'error' | 'running'

export type AgentMessageFileChangeKind = 'created' | 'deleted' | 'updated'

export type AgentMessageFileChange = {
  filePath: string
  kind: AgentMessageFileChangeKind
}

export type AgentSessionAnnotations = {
  fileChangesByEntryId: Record<string, AgentMessageFileChange[]>
}

export type AgentSidebarMessage = {
  id: string
  kind: AgentSidebarMessageKind
  isThinkingStreaming?: boolean
  label?: string
  sessionEntryId?: string
  status?: AgentSidebarMessageStatus
  text: string
  thinkingText?: string
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
  auth: Record<string, AgentProviderAuthState>
  workspacePath: string | null
  hasConfiguredModels: boolean
  availableModels: string[]
  compactionReason: 'manual' | 'overflow' | 'threshold' | null
  followUpMessageCount: number
  followUpMode: 'all' | 'one-at-a-time'
  isCompacting: boolean
  selectedModel: string | null
  isStreaming: boolean
  pendingMessageCount: number
  retryAttempt: number
  retryMaxAttempts: number | null
  setupHint: string | null
  steeringMessageCount: number
  steeringMode: 'all' | 'one-at-a-time'
}

export type AgentProviderAuthState = {
  category: 'api_key' | 'cloud' | 'subscription'
  environmentCredentialLabel: string | null
  envVarNames: string[]
  envVarName: string
  hasStoredCredential: boolean
  label: string
  source: 'env' | 'none' | 'stored'
  storedCredentialType: 'api_key' | 'oauth' | null
  supportsApiKey: boolean
  supportsOAuth: boolean
  usesEnvironmentCredential: boolean
}

export type AgentProviderAuthUiEvent =
  | {
      type: 'auth'
      provider: string
      url: string
      instructions?: string
    }
  | {
      type: 'progress'
      provider: string
      message: string
    }
  | {
      type: 'prompt'
      requestId: string
      provider: string
      message: string
      placeholder?: string
      allowEmpty?: boolean
    }
  | {
      type: 'complete'
      provider: string
      ok: boolean
      message?: string
    }

export type AgentSessionSnapshot = {
  annotations: AgentSessionAnnotations
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
      type: 'assistant_thinking_delta'
      sessionId: string
      delta: string
    }
  | {
      type: 'assistant_thinking_finished'
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
      type: 'session_annotations_updated'
      sessionId: string
      annotations: AgentSessionAnnotations
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

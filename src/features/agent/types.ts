import type { AgentId } from '@/features/agent/agent-definition'
import type {
  Event as OpenCodeEvent,
  Message as OpenCodeMessage,
  Part as OpenCodePart,
  SnapshotFileDiff as OpenCodeSnapshotFileDiff,
} from '@opencode-ai/sdk/v2'
import type { Thread as CodexThread } from '@/features/agent/codex-protocol/generated/v2/Thread'
import type { ThreadTokenUsage as CodexThreadTokenUsage } from '@/features/agent/codex-protocol/generated/v2/ThreadTokenUsage'
import type { TurnPlanStep as CodexTurnPlanStep } from '@/features/agent/codex-protocol/generated/v2/TurnPlanStep'

export type PiWebAgentId = 'builtin-pi' | 'pi'

export type PiWebAgentMessage = {
  role: string
  content?: unknown
  timestamp?: number
  [key: string]: unknown
}

export type PiWebNativeSessionSnapshot = {
  agentId: PiWebAgentId
  entryIds: string[]
  isStreaming: boolean
  messages: PiWebAgentMessage[]
  modelNames: Record<string, string>
  sessionId: string
}

export type OpenCodeSurfaceRequest =
  | { method: 'app.agents' }
  | { method: 'provider.list' }
  | { method: 'session.get'; sessionID: string }
  | { method: 'session.messages'; before?: string; limit: number; sessionID: string }
  | { method: 'session.message'; messageID: string; sessionID: string }
  | { method: 'session.diff'; sessionID: string }
  | { method: 'session.todo'; sessionID: string }
  | { method: 'session.status'; sessionID: string }

export type OpenCodeSurfaceResponse = {
  data: unknown
  nextCursor?: string
}

export type AgentSidebarMessageKind = 'assistant' | 'custom' | 'system' | 'tool' | 'user'
export type AgentSidebarMessageStatus = 'done' | 'error' | 'running'

export type AgentMessageFileChangeKind = 'created' | 'deleted' | 'updated'

export type AgentAttachmentKind = 'file' | 'image'

export type AgentPromptAttachment = {
  data?: string
  fileName: string
  kind: AgentAttachmentKind
  mimeType?: string
  path?: string
  size?: number
}

export type AgentPromptSendOptions = {
  clientMessageId?: string
  clientPartIds?: string[]
}

export type AgentMessageAttachment = {
  data?: string
  fileName: string
  kind: AgentAttachmentKind
  mimeType?: string
  path?: string
  size?: number
  status?: 'omitted' | 'sent' | 'referenced'
}

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
  attachments?: AgentMessageAttachment[]
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

export type AgentThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type AgentRunningPromptBehavior = 'steer' | 'followUp'

export type AgentSessionExecutionState =
  | { type: 'idle' }
  | { type: 'busy' }
  | {
      type: 'retry'
      action?: {
        label: string
        link?: string
        message: string
        provider: string
        reason: string
        title: string
      }
      attempt: number
      message: string
      next: number
    }

export type OpenCodeNativeMessageRecord = {
  info: OpenCodeMessage
  parts: OpenCodePart[]
}

export type OpenCodeNativeSessionSnapshot = {
  agentId: 'opencode'
  diffs: OpenCodeSnapshotFileDiff[]
  messages: OpenCodeNativeMessageRecord[]
  parentSessionId: string | null
  status: AgentSessionExecutionState
}

export type CodexNativeItemRuntime = {
  output: string
  progress: string[]
  terminalInput: string
}

export type CodexNativeTurnRuntime = {
  diff: string | null
  plan: {
    explanation: string | null
    steps: CodexTurnPlanStep[]
  } | null
}

export type CodexNativeNotice = {
  id: string
  kind: 'error' | 'warning'
  message: string
  turnId: string | null
  willRetry?: boolean
}

export type CodexNativeSessionSnapshot = {
  agentId: 'codex'
  itemRuntime: Record<string, CodexNativeItemRuntime>
  notices: CodexNativeNotice[]
  sequence: number
  status: AgentSessionExecutionState
  thread: CodexThread
  tokenUsage: CodexThreadTokenUsage | null
  turnRuntime: Record<string, CodexNativeTurnRuntime>
}

export type AgentNativeSessionSnapshot =
  | CodexNativeSessionSnapshot
  | OpenCodeNativeSessionSnapshot
  | PiWebNativeSessionSnapshot

export type AgentRequestScope = {
  agentId: AgentId
  sessionPath?: string | null
  workspacePath: string | null
}

export type AgentQueuedMessageKind = AgentRunningPromptBehavior

export type AgentSessionCreateOptions = {
  agentId?: AgentId
  modelKey?: string | null
  name?: string
  thinkingLevel?: AgentThinkingLevel
}

export type AgentQueuedMessageUpdate =
  | {
      action: 'delete'
      expectedText: string
      index: number
      kind: AgentQueuedMessageKind
    }
  | {
      action: 'edit'
      expectedText: string
      index: number
      kind: AgentQueuedMessageKind
      text: string
    }
  | {
      action: 'move'
      expectedText: string
      index: number
      kind: AgentQueuedMessageKind
      targetKind: AgentQueuedMessageKind
    }

export type AgentRuntimeState = {
  agentId: AgentId
  auth: Record<string, AgentProviderAuthState>
  workspacePath: string | null
  hasConfiguredModels: boolean
  availableModels: string[]
  availableModelInputs: Record<string, Array<'text' | 'image'>>
  availableThinkingLevels: AgentThinkingLevel[]
  availableThinkingLevelsByModel: Record<string, AgentThinkingLevel[]>
  compactionReason: 'manual' | 'overflow' | 'threshold' | null
  followUpMessageCount: number
  followUpMessages: string[]
  followUpMode: 'all' | 'one-at-a-time'
  isCompacting: boolean
  defaultModel: string | null
  defaultThinkingLevel: AgentThinkingLevel
  executionState?: AgentSessionExecutionState
  preferredModelByProvider: Record<string, string>
  selectedModel: string | null
  isStreaming: boolean
  pendingMessageCount: number
  retryAttempt: number
  retryMaxAttempts: number | null
  setupHint: string | null
  supportedRunningPromptBehaviors: AgentRunningPromptBehavior[]
  supportsQueuedMessageEditing: boolean
  supportsThinking: boolean
  steeringMessageCount: number
  steeringMessages: string[]
  steeringMode: 'all' | 'one-at-a-time'
  thinkingLevel: AgentThinkingLevel
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

export type AgentInteractionKind = 'permission' | 'question'

export type AgentInteractionOption = {
  description?: string
  id: string
  label: string
}

export type AgentInteractionField = {
  allowsCustomAnswer?: boolean
  id: string
  isSecret?: boolean
  label: string
  message?: string
  multiline?: boolean
  options?: AgentInteractionOption[]
}

export type AgentInteractionRequest = {
  agentId: AgentId
  fields?: AgentInteractionField[]
  id: string
  kind: AgentInteractionKind
  message: string
  options: AgentInteractionOption[]
  sessionId: string
  title: string
  workspacePath: string
}

export type AgentInteractionResponse = {
  agentId: AgentId
  answers?: Record<string, string[]>
  optionId: string
  requestId: string
  sessionId: string
  values?: string[]
}

export function getAgentInteractionKey(sessionId: string, requestId: string) {
  return `${sessionId}\n${requestId}`
}

export type AgentSessionSnapshot = {
  annotations: AgentSessionAnnotations
  native?: AgentNativeSessionSnapshot
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

export type AgentClientEventPayload =
  | {
      type: 'opencode_native_event'
      event: OpenCodeEvent
      workspacePath: string
    }
  | {
      type: 'pi_native_event'
      event: { type: string; [key: string]: unknown }
      sessionId: string
    }
  | {
      type: 'opencode_surface_refresh'
      sessionId: string
      workspacePath: string
    }
  | {
      type: 'interaction_requested'
      request: AgentInteractionRequest
    }
  | {
      type: 'interaction_resolved'
      requestId: string
      resumeRun: boolean
      sessionId: string
    }
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
      type: 'session_snapshot_updated'
      executionState: AgentSessionExecutionState
      session: AgentSessionSnapshot
      sessionId: string
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

type WithAgentId<T> = T extends unknown ? T & { agentId: AgentId } : never

export type AgentClientEvent = WithAgentId<AgentClientEventPayload>

import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentQueuedMessageUpdate,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentWorkspaceState,
  OpenCodeSurfaceRequest,
  OpenCodeSurfaceResponse,
} from '../../../src/features/agent/types'
import type { AgentId } from '../../../src/features/agent/agent-definition'

export type AgentWorkspaceLoadOptions = {
  restoreSession?: boolean
}

export type AgentPromptSendResult = {
  ok: boolean
}

export type AgentProviderAuthPrompt = {
  allowEmpty?: boolean
  message: string
  placeholder?: string
}

export type AgentProviderAuthLoginCallbacks = {
  emitAuth: (provider: string, info: { instructions?: string, url: string }) => void
  emitComplete: (provider: string, ok: boolean, message?: string) => void
  emitProgress: (provider: string, message: string) => void
  openExternal: (url: string) => Promise<void>
  requestInput: (provider: string, prompt: AgentProviderAuthPrompt) => Promise<string>
  signal?: AbortSignal
}

export type AgentBackendCapabilities = {
  interactionResponse?: {
    respond(response: AgentInteractionResponse): boolean | Promise<boolean>
  }
  openCodeSurface?: {
    request(cwd: string, request: OpenCodeSurfaceRequest): Promise<OpenCodeSurfaceResponse>
  }
  providerAuth?: {
    login(
      cwd: string | null,
      provider: string,
      callbacks: AgentProviderAuthLoginCallbacks,
    ): Promise<AgentWorkspaceState>
    logout(cwd: string | null, provider: string): Promise<AgentWorkspaceState>
    update(cwd: string | null, provider: string, apiKey: string | null): Promise<AgentWorkspaceState>
  }
  queuedMessageEditing?: {
    update(cwd: string, sessionPath: string, update: AgentQueuedMessageUpdate): Promise<AgentWorkspaceState>
  }
}

/**
 * Stable product-side contract for every Agent provider.
 *
 * Provider-specific protocol details stay behind this boundary. Features that
 * are not universal are exposed through explicit capabilities rather than
 * being added to the common surface as no-op methods.
 */
export interface AgentBackend {
  readonly agentId: AgentId
  readonly capabilities: Readonly<AgentBackendCapabilities>

  abortActivePrompt(cwd: string, sessionPath: string): Promise<AgentWorkspaceState>
  createSession(cwd: string, options?: string | AgentSessionCreateOptions): Promise<AgentWorkspaceState>
  deleteSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState>
  discardWorkspaceSessions(cwd: string): Promise<void>
  dispose(): void
  listSessionItems(cwd: string): Promise<AgentSessionListItem[]>
  loadDraftState(): Promise<AgentWorkspaceState>
  loadWorkspaceState(
    cwd: string,
    preferredSessionPath: string | null,
    options?: AgentWorkspaceLoadOptions,
  ): Promise<AgentWorkspaceState>
  openSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState>
  readSession(cwd: string, sessionPath: string): Promise<AgentSessionSnapshot>
  releaseWorkspaceRuntime(cwd: string): Promise<void>
  renameSession(cwd: string, sessionPath: string, name: string): Promise<AgentWorkspaceState>
  selectModel(cwd: string, sessionPath: string, modelKey: string): Promise<AgentWorkspaceState>
  selectThinkingLevel(
    cwd: string,
    sessionPath: string,
    level: string,
    modelKey?: string,
  ): Promise<AgentWorkspaceState>
  sendPrompt(
    cwd: string,
    sessionPath: string,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments?: AgentPromptAttachment[],
    options?: AgentPromptSendOptions,
  ): Promise<AgentPromptSendResult>
  sessionExists(cwd: string, sessionPath: string): Promise<boolean>
}

export type AgentBackendEventEmitter = (event: AgentClientEventPayload) => void

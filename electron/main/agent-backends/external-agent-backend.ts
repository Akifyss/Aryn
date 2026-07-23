import type {
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentWorkspaceState,
  OpenCodeSurfaceRequest,
  OpenCodeSurfaceResponse,
} from '../../../src/features/agent/types'
import type { AgentId } from '../../../src/features/agent/agent-definition'
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentPromptSendResult,
  AgentWorkspaceLoadOptions,
} from './types'

export interface ExternalAgentManager {
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
  respondToInteraction?(response: AgentInteractionResponse): boolean | Promise<boolean>
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

type ExternalAgentBackendOptions = {
  forwardPromptOptions?: boolean
  openCodeSurface?: {
    request(cwd: string, request: OpenCodeSurfaceRequest): Promise<OpenCodeSurfaceResponse>
  }
}

/** Keeps native provider managers small while adapting them to the product contract. */
export class ExternalAgentBackend implements AgentBackend {
  readonly capabilities: Readonly<AgentBackendCapabilities>

  constructor(
    readonly agentId: Exclude<AgentId, 'builtin-pi'>,
    private readonly manager: ExternalAgentManager,
    private readonly options: ExternalAgentBackendOptions = {},
  ) {
    this.capabilities = {
      ...(manager.respondToInteraction
        ? { interactionResponse: { respond: (response: AgentInteractionResponse) => manager.respondToInteraction!(response) } }
        : {}),
      ...(options.openCodeSurface ? { openCodeSurface: options.openCodeSurface } : {}),
    }
  }

  abortActivePrompt(cwd: string, sessionPath: string) {
    return this.manager.abortActivePrompt(cwd, sessionPath)
  }

  createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    return this.manager.createSession(cwd, options)
  }

  deleteSession(cwd: string, sessionPath: string) {
    return this.manager.deleteSession(cwd, sessionPath)
  }

  discardWorkspaceSessions(cwd: string) {
    return this.manager.discardWorkspaceSessions(cwd)
  }

  dispose() {
    this.manager.dispose()
  }

  listSessionItems(cwd: string) {
    return this.manager.listSessionItems(cwd)
  }

  loadDraftState() {
    return this.manager.loadDraftState()
  }

  loadWorkspaceState(cwd: string, preferredSessionPath: string | null, options: AgentWorkspaceLoadOptions = {}) {
    return this.manager.loadWorkspaceState(cwd, preferredSessionPath, options)
  }

  openSession(cwd: string, sessionPath: string) {
    return this.manager.openSession(cwd, sessionPath)
  }

  readSession(cwd: string, sessionPath: string) {
    return this.manager.readSession(cwd, sessionPath)
  }

  releaseWorkspaceRuntime(cwd: string) {
    return this.manager.releaseWorkspaceRuntime(cwd)
  }

  renameSession(cwd: string, sessionPath: string, name: string) {
    return this.manager.renameSession(cwd, sessionPath, name)
  }

  selectModel(cwd: string, sessionPath: string, modelKey: string) {
    return this.manager.selectModel(cwd, sessionPath, modelKey)
  }

  selectThinkingLevel(cwd: string, sessionPath: string, level: string, modelKey?: string) {
    return this.manager.selectThinkingLevel(cwd, sessionPath, level, modelKey)
  }

  sendPrompt(
    cwd: string,
    sessionPath: string,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments?: AgentPromptAttachment[],
    options?: AgentPromptSendOptions,
  ) {
    return this.options.forwardPromptOptions
      ? this.manager.sendPrompt(cwd, sessionPath, prompt, streamingBehavior, attachments, options)
      : this.manager.sendPrompt(cwd, sessionPath, prompt, streamingBehavior, attachments)
  }

  sessionExists(cwd: string, sessionPath: string) {
    return this.manager.sessionExists(cwd, sessionPath)
  }
}

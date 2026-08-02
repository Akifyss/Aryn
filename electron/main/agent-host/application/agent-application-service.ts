import type {
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentQueuedMessageUpdate,
  AgentRequestScope,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentSessionSnapshot,
  AgentWorkspaceState,
  OpenCodeSurfaceRequest,
} from '../../../shared/agent-contracts/types'
import { isAgentId, type AgentId } from '../../../shared/agent-contracts/definition'
import type { AgentBackendRegistry } from './backend-registry'
import type { AgentProviderAuthLoginCallbacks } from './agent-backend'
import type { AgentInteractionHistoryStore } from '../sessions/interaction-history'

function requireWorkspacePath(scope: AgentRequestScope) {
  const workspacePath = typeof scope.workspacePath === 'string' ? scope.workspacePath.trim() : ''
  if (!workspacePath) throw new Error('Agent operation requires a workspace path.')
  return workspacePath
}

function requireSessionPath(scope: AgentRequestScope) {
  const sessionPath = typeof scope.sessionPath === 'string' ? scope.sessionPath.trim() : ''
  if (!sessionPath) throw new Error('Agent operation requires a native session identifier.')
  return sessionPath
}

function requireExplicitSessionPath(scope: AgentRequestScope, rawSessionPath: string) {
  const sessionPath = typeof rawSessionPath === 'string' ? rawSessionPath.trim() : ''
  if (!sessionPath) throw new Error('Agent operation requires a native session identifier.')
  if (scope.sessionPath && scope.sessionPath !== sessionPath) {
    throw new Error('Agent session scope does not match the requested native session.')
  }
  return sessionPath
}

function normalizeScope(scope: AgentRequestScope): AgentRequestScope {
  if (!isAgentId(scope?.agentId)) throw new Error('Agent operation requires a valid Agent ID.')
  return {
    agentId: scope.agentId,
    sessionPath: typeof scope.sessionPath === 'string' && scope.sessionPath.trim()
      ? scope.sessionPath.trim()
      : null,
    workspacePath: typeof scope.workspacePath === 'string' && scope.workspacePath.trim()
      ? scope.workspacePath.trim()
      : null,
  }
}

function normalizeInteractionResponse(response: AgentInteractionResponse): AgentInteractionResponse {
  if (
    !response
    || !isAgentId(response.agentId)
    || typeof response.optionId !== 'string'
    || !response.optionId.trim()
    || typeof response.requestId !== 'string'
    || !response.requestId.trim()
    || typeof response.sessionId !== 'string'
    || !response.sessionId.trim()
  ) {
    throw new Error('Agent interaction response is invalid.')
  }
  const values = Array.isArray(response.values)
    ? response.values.filter((value): value is string => typeof value === 'string')
    : undefined
  const answers = response.answers && typeof response.answers === 'object'
    ? Object.fromEntries(Object.entries(response.answers).flatMap(([fieldId, fieldAnswers]) => (
        Array.isArray(fieldAnswers)
          ? [[fieldId, fieldAnswers.filter((answer): answer is string => typeof answer === 'string')]]
          : []
      )))
    : undefined
  return {
    agentId: response.agentId,
    ...(answers ? { answers } : {}),
    optionId: response.optionId.trim(),
    requestId: response.requestId.trim(),
    sessionId: response.sessionId.trim(),
    ...(values ? { values } : {}),
  }
}

function unsupportedQueuedMessageEditingError(agentId: AgentId) {
  const labelByAgentId: Record<Exclude<AgentId, 'builtin-pi'>, string> = {
    codex: 'Codex',
    opencode: 'OpenCode',
    pi: 'PI CLI',
  }
  const label = agentId === 'builtin-pi' ? 'Embedded PI' : labelByAgentId[agentId]
  return new Error(`${label} queued message editing is not supported yet.`)
}

/**
 * Product-level Agent facade.
 *
 * This class owns validation and cross-provider fan-out only. Provider routing,
 * session lifetime and native protocol behavior belong to registered backends.
 */
export class AgentApplicationService {
  private disposed = false
  private disposePromise: Promise<void> | null = null

  constructor(
    private readonly backends: AgentBackendRegistry,
    private readonly interactionHistory?: AgentInteractionHistoryStore,
  ) {}

  async loadWorkspaceState(
    rawScope: AgentRequestScope,
    preferredSessionPath: string | null = null,
    options: { restoreSession?: boolean } = {},
  ) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    const targetPreferredSessionPath = preferredSessionPath === null
      ? null
      : requireExplicitSessionPath(scope, preferredSessionPath)
    return this.withInteractionHistory(
      scope.agentId,
      await backend.loadWorkspaceState(cwd, targetPreferredSessionPath, options),
    )
  }

  async loadDraftState(agentId: AgentId = 'builtin-pi') {
    if (!isAgentId(agentId)) throw new Error('Agent draft state requires a valid Agent ID.')
    return this.requireBackend(agentId).loadDraftState()
  }

  async listSessionItems(rawScope: AgentRequestScope) {
    const { backend, cwd } = this.resolveWorkspaceBackend(rawScope)
    return backend.listSessionItems(cwd)
  }

  async readSession(rawScope: AgentRequestScope, sessionPath: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return this.withSnapshotInteractionHistory(
      scope.agentId,
      await backend.readSession(cwd, requireExplicitSessionPath(scope, sessionPath)),
    )
  }

  async requestOpenCodeSurface(rawScope: AgentRequestScope, rawRequest: OpenCodeSurfaceRequest) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    if (scope.agentId !== 'opencode' || !backend.capabilities.openCodeSurface) {
      throw new Error('OpenCode surface requests require the OpenCode Agent.')
    }
    const request = 'sessionID' in rawRequest
      ? { ...rawRequest, sessionID: requireExplicitSessionPath(scope, rawRequest.sessionID) }
      : rawRequest
    return backend.capabilities.openCodeSurface.request(cwd, request)
  }

  async sessionExists(rawScope: AgentRequestScope, sessionPath: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return backend.sessionExists(cwd, requireExplicitSessionPath(scope, sessionPath))
  }

  async createSession(rawScope: AgentRequestScope, options?: string | AgentSessionCreateOptions) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    if (typeof options !== 'string' && options?.agentId && options.agentId !== scope.agentId) {
      throw new Error('Agent session scope does not match the requested Agent.')
    }
    return this.withInteractionHistory(scope.agentId, await backend.createSession(cwd, options))
  }

  async openSession(rawScope: AgentRequestScope, sessionPath: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return this.withInteractionHistory(
      scope.agentId,
      await backend.openSession(cwd, requireExplicitSessionPath(scope, sessionPath)),
    )
  }

  async deleteSession(rawScope: AgentRequestScope, sessionPath: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    const targetSessionPath = requireExplicitSessionPath(scope, sessionPath)
    const state = await backend.deleteSession(cwd, targetSessionPath)
    await this.clearInteractionHistorySession(scope.agentId, targetSessionPath)
    return this.withInteractionHistory(scope.agentId, state)
  }

  async renameSession(rawScope: AgentRequestScope, sessionPath: string, name: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return this.withInteractionHistory(
      scope.agentId,
      await backend.renameSession(cwd, requireExplicitSessionPath(scope, sessionPath), name),
    )
  }

  async sendPrompt(
    rawScope: AgentRequestScope,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments?: AgentPromptAttachment[],
    options?: AgentPromptSendOptions,
  ) {
    const { backend, cwd, sessionPath } = this.resolveSessionBackend(rawScope)
    return backend.sendPrompt(cwd, sessionPath, prompt, streamingBehavior, attachments, options)
  }

  async updateQueuedMessage(rawScope: AgentRequestScope, update: AgentQueuedMessageUpdate) {
    const { backend, cwd, scope, sessionPath } = this.resolveSessionBackend(rawScope)
    const capability = backend.capabilities.queuedMessageEditing
    if (!capability) throw unsupportedQueuedMessageEditingError(scope.agentId)
    return this.withInteractionHistory(scope.agentId, await capability.update(cwd, sessionPath, update))
  }

  async selectModel(rawScope: AgentRequestScope, modelKey: string) {
    const { backend, cwd, scope, sessionPath } = this.resolveSessionBackend(rawScope)
    return this.withInteractionHistory(
      scope.agentId,
      await backend.selectModel(cwd, sessionPath, modelKey),
    )
  }

  async selectThinkingLevel(rawScope: AgentRequestScope, level: string, modelKey?: string) {
    const { backend, cwd, scope, sessionPath } = this.resolveSessionBackend(rawScope)
    return this.withInteractionHistory(
      scope.agentId,
      await backend.selectThinkingLevel(cwd, sessionPath, level, modelKey),
    )
  }

  async abortActivePrompt(rawScope: AgentRequestScope) {
    const { backend, cwd, scope, sessionPath } = this.resolveSessionBackend(rawScope)
    return this.withInteractionHistory(
      scope.agentId,
      await backend.abortActivePrompt(cwd, sessionPath),
    )
  }

  updateProviderAuth(cwd: string | null, provider: string, apiKey: string | null) {
    return this.requireProviderAuthCapability().update(cwd, provider, apiKey)
  }

  loginProviderAuth(
    cwd: string | null,
    provider: string,
    callbacks: AgentProviderAuthLoginCallbacks,
  ) {
    return this.requireProviderAuthCapability().login(cwd, provider, callbacks)
  }

  logoutProviderAuth(cwd: string | null, provider: string) {
    return this.requireProviderAuthCapability().logout(cwd, provider)
  }

  async respondToInteraction(rawResponse: AgentInteractionResponse) {
    const response = normalizeInteractionResponse(rawResponse)
    const capability = this.requireBackend(response.agentId).capabilities.interactionResponse
    return capability ? capability.respond(response) : false
  }

  async releaseWorkspaceRuntime(cwd: string) {
    this.assertUsable()
    const results = await Promise.allSettled(
      [...this.backends.values()].map((backend) => backend.releaseWorkspaceRuntime(cwd)),
    )
    this.throwFanOutFailures(results, 'One or more Agent workspace runtimes could not be released.')
  }

  async discardWorkspaceSessions(cwd: string) {
    this.assertUsable()
    const results = await Promise.allSettled(
      [...this.backends.values()].map((backend) => backend.discardWorkspaceSessions(cwd)),
    )
    this.throwFanOutFailures(results, 'One or more Agent session stores could not be cleaned up.')
    try {
      await this.interactionHistory?.clearWorkspace(cwd)
    } catch (error) {
      console.warn('[Agent Host] Unable to clear interaction history for the workspace.', error)
    }
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    const disposals = [...this.backends.values()].map((backend) => {
      try {
        return Promise.resolve(backend.dispose())
      } catch (error) {
        return Promise.reject(error)
      }
    })
    this.disposePromise = Promise.allSettled(disposals).then(async (results) => {
      try {
        await this.interactionHistory?.drain()
      } catch (error) {
        console.warn('[Agent Host] Unable to finish persisting interaction history.', error)
      }
      this.throwFanOutFailures(results, 'One or more Agent backends could not be disposed.')
    })
    return this.disposePromise
  }

  private resolveWorkspaceBackend(rawScope: AgentRequestScope) {
    const scope = normalizeScope(rawScope)
    return {
      backend: this.requireBackend(scope.agentId),
      cwd: requireWorkspacePath(scope),
      scope,
    }
  }

  private resolveSessionBackend(rawScope: AgentRequestScope) {
    const resolved = this.resolveWorkspaceBackend(rawScope)
    return { ...resolved, sessionPath: requireSessionPath(resolved.scope) }
  }

  private requireProviderAuthCapability() {
    const capability = this.requireBackend('builtin-pi').capabilities.providerAuth
    if (!capability) throw new Error('Embedded PI provider authentication is unavailable.')
    return capability
  }

  private async withSnapshotInteractionHistory(
    agentId: AgentId,
    snapshot: AgentSessionSnapshot,
  ): Promise<AgentSessionSnapshot> {
    if (!this.interactionHistory) return snapshot
    try {
      if (agentId === 'builtin-pi' && snapshot.sessionPath) {
        await this.interactionHistory.associateSession(
          agentId,
          snapshot.sessionId,
          snapshot.sessionPath,
          snapshot.workspacePath,
        )
      }
      const interactionHistory = await this.interactionHistory.read(agentId, snapshot.sessionId)
      return { ...snapshot, interactionHistory }
    } catch (error) {
      console.warn('[Agent Host] Unable to load interaction history for the session.', error)
      return snapshot
    }
  }

  private async withInteractionHistory(
    agentId: AgentId,
    state: AgentWorkspaceState,
  ): Promise<AgentWorkspaceState> {
    if (!state.activeSession) return state
    return {
      ...state,
      activeSession: await this.withSnapshotInteractionHistory(agentId, state.activeSession),
    }
  }

  private async clearInteractionHistorySession(agentId: AgentId, sessionIdOrPath: string) {
    try {
      await this.interactionHistory?.clearSession(agentId, sessionIdOrPath)
    } catch (error) {
      console.warn('[Agent Host] Unable to clear interaction history for the session.', error)
    }
  }

  private requireBackend(agentId: AgentId) {
    this.assertUsable()
    return this.backends.get(agentId)
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Agent Host has been disposed.')
  }

  private throwFanOutFailures(
    results: PromiseSettledResult<unknown>[],
    message: string,
  ) {
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, message)
  }
}

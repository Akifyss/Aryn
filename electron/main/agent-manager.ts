import type {
  AgentClientEvent,
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentQueuedMessageUpdate,
  AgentRequestScope,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  OpenCodeSurfaceRequest,
} from '../../src/features/agent/types'
import { isAgentId, type AgentId } from '../../src/features/agent/agent-definition'
import {
  createAgentBackendRegistry,
  type AgentBackendRegistry,
  type AgentProviderAuthLoginCallbacks,
} from './agent-backends'

type AgentManagerOptions = {
  agentDir: string
}

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
export class AgentManager {
  private readonly backends: AgentBackendRegistry
  private disposed = false

  constructor(
    emitEvent: (event: AgentClientEvent) => void,
    options: AgentManagerOptions,
  ) {
    this.backends = createAgentBackendRegistry({ agentDir: options.agentDir, emitEvent })
  }

  async loadWorkspaceState(
    rawScope: AgentRequestScope,
    preferredSessionPath: string | null = null,
    options: { restoreSession?: boolean } = {},
  ) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    const targetPreferredSessionPath = preferredSessionPath === null
      ? null
      : requireExplicitSessionPath(scope, preferredSessionPath)
    return backend.loadWorkspaceState(cwd, targetPreferredSessionPath, options)
  }

  async loadDraftState(agentId: AgentId = 'builtin-pi') {
    if (!isAgentId(agentId)) throw new Error('Agent draft state requires a valid Agent ID.')
    return this.backends.get(agentId).loadDraftState()
  }

  async listSessionItems(rawScope: AgentRequestScope) {
    const { backend, cwd } = this.resolveWorkspaceBackend(rawScope)
    return backend.listSessionItems(cwd)
  }

  async readSession(rawScope: AgentRequestScope, sessionPath: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return backend.readSession(cwd, requireExplicitSessionPath(scope, sessionPath))
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
    return backend.createSession(cwd, options)
  }

  async openSession(rawScope: AgentRequestScope, sessionPath: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return backend.openSession(cwd, requireExplicitSessionPath(scope, sessionPath))
  }

  async deleteSession(rawScope: AgentRequestScope, sessionPath: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return backend.deleteSession(cwd, requireExplicitSessionPath(scope, sessionPath))
  }

  async renameSession(rawScope: AgentRequestScope, sessionPath: string, name: string) {
    const { backend, cwd, scope } = this.resolveWorkspaceBackend(rawScope)
    return backend.renameSession(cwd, requireExplicitSessionPath(scope, sessionPath), name)
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
    return capability.update(cwd, sessionPath, update)
  }

  async selectModel(rawScope: AgentRequestScope, modelKey: string) {
    const { backend, cwd, sessionPath } = this.resolveSessionBackend(rawScope)
    return backend.selectModel(cwd, sessionPath, modelKey)
  }

  async selectThinkingLevel(rawScope: AgentRequestScope, level: string, modelKey?: string) {
    const { backend, cwd, sessionPath } = this.resolveSessionBackend(rawScope)
    return backend.selectThinkingLevel(cwd, sessionPath, level, modelKey)
  }

  async abortActivePrompt(rawScope: AgentRequestScope) {
    const { backend, cwd, sessionPath } = this.resolveSessionBackend(rawScope)
    return backend.abortActivePrompt(cwd, sessionPath)
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
    const capability = this.backends.get(response.agentId).capabilities.interactionResponse
    return capability ? capability.respond(response) : false
  }

  async releaseWorkspaceRuntime(cwd: string) {
    const results = await Promise.allSettled(
      [...this.backends.values()].map((backend) => backend.releaseWorkspaceRuntime(cwd)),
    )
    this.throwFanOutFailures(results, 'One or more Agent workspace runtimes could not be released.')
  }

  async discardWorkspaceSessions(cwd: string) {
    const results = await Promise.allSettled(
      [...this.backends.values()].map((backend) => backend.discardWorkspaceSessions(cwd)),
    )
    this.throwFanOutFailures(results, 'One or more Agent session stores could not be cleaned up.')
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const backend of this.backends.values()) backend.dispose()
  }

  private resolveWorkspaceBackend(rawScope: AgentRequestScope) {
    const scope = normalizeScope(rawScope)
    return {
      backend: this.backends.get(scope.agentId),
      cwd: requireWorkspacePath(scope),
      scope,
    }
  }

  private resolveSessionBackend(rawScope: AgentRequestScope) {
    const resolved = this.resolveWorkspaceBackend(rawScope)
    return { ...resolved, sessionPath: requireSessionPath(resolved.scope) }
  }

  private requireProviderAuthCapability() {
    const capability = this.backends.get('builtin-pi').capabilities.providerAuth
    if (!capability) throw new Error('Embedded PI provider authentication is unavailable.')
    return capability
  }

  private throwFanOutFailures(
    results: PromiseSettledResult<unknown>[],
    message: string,
  ) {
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, message)
  }
}

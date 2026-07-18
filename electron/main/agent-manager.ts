import path from 'node:path'
import type {
  AgentClientEvent,
  AgentClientEventPayload,
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
import { PiAgentManager } from './agent'
import { OpenCodeAgentManager } from './opencode-agent'
import { PiCliAgentManager } from './pi-cli-agent'
import { CodexAgentManager } from './codex-agent'

type AgentManagerOptions = {
  agentDir: string
}

function getWorkspaceIdentity(workspacePath: string) {
  const resolvedPath = path.resolve(workspacePath)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

function requireWorkspacePath(scope: AgentRequestScope) {
  const workspacePath = typeof scope.workspacePath === 'string' ? scope.workspacePath.trim() : ''
  if (!workspacePath) {
    throw new Error('Agent operation requires a workspace path.')
  }

  return workspacePath
}

function requireSessionPath(scope: AgentRequestScope) {
  const sessionPath = typeof scope.sessionPath === 'string' ? scope.sessionPath.trim() : ''
  if (!sessionPath) {
    throw new Error('Agent operation requires a native session identifier.')
  }
  return sessionPath
}

function normalizeScope(scope: AgentRequestScope): AgentRequestScope {
  if (!isAgentId(scope?.agentId)) {
    throw new Error('Agent operation requires a valid Agent ID.')
  }
  return {
    agentId: scope.agentId,
    sessionPath: typeof scope.sessionPath === 'string' && scope.sessionPath.trim()
      ? scope.sessionPath.trim()
      : null,
    workspacePath: typeof scope?.workspacePath === 'string' && scope.workspacePath.trim()
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

/**
 * Owns the product-level Agent routing boundary.
 *
 * The embedded PI manager was originally a singleton with one active runtime.
 * We keep that well-tested implementation intact, but allocate managers per
 * active native session so switching the visible conversation no longer aborts
 * background work. External adapters plug into this same boundary without
 * pretending that their process and session models are identical.
 */
export class AgentManager {
  private readonly builtinActiveManagers = new Map<string, PiAgentManager>()
  private readonly builtinManagerWorkspaces = new Map<PiAgentManager, string>()
  private readonly builtinSessionManagers = new Map<string, PiAgentManager>()
  private readonly codexManager: CodexAgentManager
  private readonly draftBuiltinManager: PiAgentManager
  private readonly openCodeManager: OpenCodeAgentManager
  private readonly piCliManager: PiCliAgentManager

  constructor(
    private readonly emitEvent: (event: AgentClientEvent) => void,
    private readonly options: AgentManagerOptions,
  ) {
    this.draftBuiltinManager = this.createBuiltinManager()
    this.codexManager = new CodexAgentManager({ agentDir: options.agentDir, emitEvent: this.createEventEmitter('codex') })
    this.openCodeManager = new OpenCodeAgentManager({ agentDir: options.agentDir, emitEvent: this.createEventEmitter('opencode') })
    this.piCliManager = new PiCliAgentManager({ agentDir: options.agentDir, emitEvent: this.createEventEmitter('pi') })
  }

  async loadWorkspaceState(
    rawScope: AgentRequestScope,
    preferredSessionPath: string | null = null,
    options: { restoreSession?: boolean } = {},
  ) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (scope.agentId === 'opencode') {
      return this.openCodeManager.loadWorkspaceState(cwd, preferredSessionPath, options)
    }
    if (scope.agentId === 'pi') return this.piCliManager.loadWorkspaceState(cwd, preferredSessionPath, options)
    if (scope.agentId === 'codex') return this.codexManager.loadWorkspaceState(cwd, preferredSessionPath, options)
    const { manager, created } = preferredSessionPath
      ? this.getOrCreateBuiltinSessionManager(cwd, preferredSessionPath)
      : options.restoreSession === false
        ? { manager: this.createWorkspaceBuiltinManager(cwd), created: true }
        : this.getOrCreateBuiltinActiveManager(cwd)
    try {
      const state = await manager.loadWorkspaceState(cwd, preferredSessionPath, options)
      this.activateBuiltinManager(cwd, manager, state.activeSession?.sessionPath ?? null)
      return state
    } catch (error) {
      if (created) this.disposeBuiltinManager(manager)
      throw error
    }
  }

  async loadDraftState(agentId: AgentId = 'builtin-pi') {
    if (!isAgentId(agentId)) throw new Error('Agent draft state requires a valid Agent ID.')
    if (agentId === 'opencode') {
      return this.openCodeManager.loadDraftState()
    }
    if (agentId === 'pi') return this.piCliManager.loadDraftState()
    if (agentId === 'codex') return this.codexManager.loadDraftState()

    return this.draftBuiltinManager.loadDraftState()
  }

  async listSessionItems(rawScope: AgentRequestScope) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.listSessionItems(cwd)
    if (scope.agentId === 'pi') return this.piCliManager.listSessionItems(cwd)
    if (scope.agentId === 'codex') return this.codexManager.listSessionItems(cwd)
    return this.getBuiltinActiveManager(cwd).listSessionItems(cwd)
  }

  async readSession(rawScope: AgentRequestScope, sessionPath: string) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.readSession(cwd, sessionPath)
    if (scope.agentId === 'pi') return this.piCliManager.readSession(cwd, sessionPath)
    if (scope.agentId === 'codex') return this.codexManager.readSession(cwd, sessionPath)
    return this.getBuiltinActiveManager(cwd).readSession(cwd, sessionPath)
  }

  async requestOpenCodeSurface(rawScope: AgentRequestScope, request: OpenCodeSurfaceRequest) {
    const scope = normalizeScope(rawScope)
    if (scope.agentId !== 'opencode') throw new Error('OpenCode surface requests require the OpenCode Agent.')
    const cwd = requireWorkspacePath(scope)
    return this.openCodeManager.requestSurfaceData(cwd, request)
  }

  async sessionExists(rawScope: AgentRequestScope, sessionPath: string) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.sessionExists(cwd, sessionPath)
    if (scope.agentId === 'pi') return this.piCliManager.sessionExists(cwd, sessionPath)
    if (scope.agentId === 'codex') return this.codexManager.sessionExists(cwd, sessionPath)
    return this.getBuiltinActiveManager(cwd).sessionExists(cwd, sessionPath)
  }

  async createSession(rawScope: AgentRequestScope, options?: string | AgentSessionCreateOptions) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (typeof options !== 'string' && options?.agentId && options.agentId !== scope.agentId) {
      throw new Error('Agent session scope does not match the requested Agent.')
    }

    if (scope.agentId === 'opencode') return this.openCodeManager.createSession(cwd, options)
    if (scope.agentId === 'pi') return this.piCliManager.createSession(cwd, options)
    if (scope.agentId === 'codex') return this.codexManager.createSession(cwd, options)
    const manager = this.createWorkspaceBuiltinManager(cwd)
    try {
      const state = await manager.createSession(cwd, options)
      this.activateBuiltinManager(cwd, manager, state.activeSession?.sessionPath ?? null)
      return state
    } catch (error) {
      this.disposeBuiltinManager(manager)
      throw error
    }
  }

  async openSession(rawScope: AgentRequestScope, sessionPath: string) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.openSession(cwd, sessionPath)
    if (scope.agentId === 'pi') return this.piCliManager.openSession(cwd, sessionPath)
    if (scope.agentId === 'codex') return this.codexManager.openSession(cwd, sessionPath)
    const { manager, created } = this.getOrCreateBuiltinSessionManager(cwd, sessionPath)
    try {
      const state = await manager.openSession(cwd, sessionPath)
      this.activateBuiltinManager(cwd, manager, state.activeSession?.sessionPath ?? sessionPath)
      return state
    } catch (error) {
      if (created) this.disposeBuiltinManager(manager)
      throw error
    }
  }

  async deleteSession(rawScope: AgentRequestScope, sessionPath: string) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.deleteSession(cwd, sessionPath)
    if (scope.agentId === 'pi') return this.piCliManager.deleteSession(cwd, sessionPath)
    if (scope.agentId === 'codex') return this.codexManager.deleteSession(cwd, sessionPath)
    const sessionKey = this.getBuiltinSessionKey(cwd, sessionPath)
    const manager = this.builtinSessionManagers.get(sessionKey) ?? this.createWorkspaceBuiltinManager(cwd)
    const wasActive = this.builtinActiveManagers.get(getWorkspaceIdentity(cwd)) === manager
    try {
      await manager.deleteSession(cwd, sessionPath, { restoreFallback: false })
    } catch (error) {
      if (!this.builtinSessionManagers.has(sessionKey)) this.disposeBuiltinManager(manager)
      throw error
    }
    this.disposeBuiltinManager(manager)

    if (!wasActive) {
      return this.getBuiltinActiveManager(cwd).loadWorkspaceState(cwd)
    }

    const fallbackManager = this.createWorkspaceBuiltinManager(cwd)
    try {
      const remainingSessions = await fallbackManager.listSessionItems(cwd)
      if (remainingSessions[0]) {
        const state = await fallbackManager.openSession(cwd, remainingSessions[0].path)
        this.activateBuiltinManager(cwd, fallbackManager, state.activeSession?.sessionPath ?? remainingSessions[0].path)
        return state
      }
      const state = await fallbackManager.loadWorkspaceState(cwd, null, { restoreSession: false })
      this.activateBuiltinManager(cwd, fallbackManager, state.activeSession?.sessionPath ?? null)
      return state
    } catch (error) {
      this.disposeBuiltinManager(fallbackManager)
      throw error
    }
  }

  async renameSession(rawScope: AgentRequestScope, sessionPath: string, name: string) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.renameSession(cwd, sessionPath, name)
    if (scope.agentId === 'pi') return this.piCliManager.renameSession(cwd, sessionPath, name)
    if (scope.agentId === 'codex') return this.codexManager.renameSession(cwd, sessionPath, name)
    const activeManager = this.getBuiltinActiveManager(cwd)
    const targetManager = this.builtinSessionManagers.get(this.getBuiltinSessionKey(cwd, sessionPath)) ?? activeManager
    const targetState = await targetManager.renameSession(cwd, sessionPath, name)
    return targetManager === activeManager
      ? targetState
      : activeManager.loadWorkspaceState(cwd)
  }

  async sendPrompt(
    rawScope: AgentRequestScope,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments?: AgentPromptAttachment[],
    options?: AgentPromptSendOptions,
  ) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    const sessionPath = requireSessionPath(scope)
    if (scope.agentId === 'opencode') {
      return this.openCodeManager.sendPrompt(cwd, sessionPath, prompt, streamingBehavior, attachments, options)
    }
    if (scope.agentId === 'pi') return this.piCliManager.sendPrompt(cwd, sessionPath, prompt, streamingBehavior, attachments)
    if (scope.agentId === 'codex') {
      return this.codexManager.sendPrompt(cwd, sessionPath, prompt, streamingBehavior, attachments, options)
    }
    return this.getBuiltinSessionManager(cwd, sessionPath).sendPrompt(prompt, streamingBehavior, attachments)
  }

  async updateQueuedMessage(rawScope: AgentRequestScope, update: AgentQueuedMessageUpdate) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    const sessionPath = requireSessionPath(scope)
    if (scope.agentId === 'opencode') {
      throw new Error('OpenCode queued message editing is not supported yet.')
    }
    if (scope.agentId === 'pi') throw new Error('PI CLI queued message editing is not supported yet.')
    if (scope.agentId === 'codex') throw new Error('Codex queued message editing is not supported yet.')
    return this.getBuiltinSessionManager(cwd, sessionPath).updateQueuedMessage(update)
  }

  async selectModel(rawScope: AgentRequestScope, modelKey: string) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    const sessionPath = requireSessionPath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.selectModel(cwd, sessionPath, modelKey)
    if (scope.agentId === 'pi') return this.piCliManager.selectModel(cwd, sessionPath, modelKey)
    if (scope.agentId === 'codex') return this.codexManager.selectModel(cwd, sessionPath, modelKey)
    return this.getBuiltinSessionManager(cwd, sessionPath).selectModel(modelKey)
  }

  async selectThinkingLevel(rawScope: AgentRequestScope, level: string, modelKey?: string) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    const sessionPath = requireSessionPath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.selectThinkingLevel(cwd, sessionPath, level, modelKey)
    if (scope.agentId === 'pi') return this.piCliManager.selectThinkingLevel(cwd, sessionPath, level, modelKey)
    if (scope.agentId === 'codex') return this.codexManager.selectThinkingLevel(cwd, sessionPath, level, modelKey)
    return this.getBuiltinSessionManager(cwd, sessionPath).selectThinkingLevel(level, modelKey)
  }

  async abortActivePrompt(rawScope: AgentRequestScope) {
    const scope = normalizeScope(rawScope)
    const cwd = requireWorkspacePath(scope)
    const sessionPath = requireSessionPath(scope)
    if (scope.agentId === 'opencode') return this.openCodeManager.abortActivePrompt(cwd, sessionPath)
    if (scope.agentId === 'pi') return this.piCliManager.abortActivePrompt(cwd, sessionPath)
    if (scope.agentId === 'codex') return this.codexManager.abortActivePrompt(cwd, sessionPath)
    return this.getBuiltinSessionManager(cwd, sessionPath).abortActivePrompt()
  }

  updateProviderAuth(cwd: string | null, provider: string, apiKey: string | null) {
    return this.getBuiltinManagerForOptionalWorkspace(cwd).updateProviderAuth(cwd, provider, apiKey)
  }

  loginProviderAuth(
    cwd: string | null,
    provider: string,
    callbacks: Parameters<PiAgentManager['loginProviderAuth']>[2],
  ) {
    return this.getBuiltinManagerForOptionalWorkspace(cwd).loginProviderAuth(cwd, provider, callbacks)
  }

  logoutProviderAuth(cwd: string | null, provider: string) {
    return this.getBuiltinManagerForOptionalWorkspace(cwd).logoutProviderAuth(cwd, provider)
  }

  async respondToInteraction(rawResponse: AgentInteractionResponse) {
    const response = normalizeInteractionResponse(rawResponse)
    if (response.agentId === 'pi') return this.piCliManager.respondToInteraction(response)
    if (response.agentId === 'codex') return this.codexManager.respondToInteraction(response)
    if (response.agentId === 'opencode') return this.openCodeManager.respondToInteraction(response)
    return false
  }

  async releaseWorkspaceRuntime(cwd: string) {
    const identity = getWorkspaceIdentity(cwd)
    const managers = [...this.builtinManagerWorkspaces.entries()]
      .filter(([, managerWorkspace]) => managerWorkspace === identity)
      .map(([manager]) => manager)
    const releaseResults = await Promise.allSettled([
      ...managers.map((manager) => manager.releaseWorkspaceRuntime(cwd)),
      this.openCodeManager.releaseWorkspaceRuntime(cwd),
      this.piCliManager.releaseWorkspaceRuntime(cwd),
      this.codexManager.releaseWorkspaceRuntime(cwd),
    ])
    for (const manager of managers) {
      manager.dispose()
      this.removeBuiltinManager(manager)
    }
    this.builtinActiveManagers.delete(identity)
    const failures = releaseResults.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'One or more Agent workspace runtimes could not be released.')
  }

  async discardWorkspaceSessions(cwd: string) {
    const identity = getWorkspaceIdentity(cwd)
    const manager = this.getBuiltinActiveManager(cwd)
    const workspaceManagers = [...this.builtinManagerWorkspaces.entries()]
      .filter(([, managerWorkspace]) => managerWorkspace === identity)
      .map(([candidate]) => candidate)
    const cleanupResults = await Promise.allSettled([
      ...workspaceManagers.filter((candidate) => candidate !== manager).map((candidate) => (
        candidate.releaseWorkspaceRuntime(cwd)
      )),
      manager.discardWorkspaceSessions(cwd),
      this.openCodeManager.discardWorkspaceSessions(cwd),
      this.piCliManager.discardWorkspaceSessions(cwd),
      this.codexManager.discardWorkspaceSessions(cwd),
    ])
    for (const candidate of workspaceManagers) {
      candidate.dispose()
      this.removeBuiltinManager(candidate)
    }
    this.builtinActiveManagers.delete(identity)
    const failures = cleanupResults.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'One or more Agent session stores could not be cleaned up.')
  }

  dispose() {
    this.draftBuiltinManager.dispose()
    this.openCodeManager.dispose()
    this.piCliManager.dispose()
    this.codexManager.dispose()
    for (const manager of this.builtinManagerWorkspaces.keys()) {
      manager.dispose()
    }
    this.builtinActiveManagers.clear()
    this.builtinManagerWorkspaces.clear()
    this.builtinSessionManagers.clear()
  }

  private createBuiltinManager() {
    return new PiAgentManager(this.createEventEmitter('builtin-pi'), { agentDir: this.options.agentDir })
  }

  private createEventEmitter(agentId: AgentId) {
    return (event: AgentClientEventPayload) => {
      this.emitEvent({ ...event, agentId } as AgentClientEvent)
    }
  }

  private createWorkspaceBuiltinManager(cwd: string) {
    const identity = getWorkspaceIdentity(cwd)
    const manager = this.createBuiltinManager()
    this.builtinManagerWorkspaces.set(manager, identity)
    return manager
  }

  private getBuiltinActiveManager(cwd: string) {
    return this.getOrCreateBuiltinActiveManager(cwd).manager
  }

  private getOrCreateBuiltinActiveManager(cwd: string) {
    const identity = getWorkspaceIdentity(cwd)
    const existingManager = this.builtinActiveManagers.get(identity)
    if (existingManager) return { manager: existingManager, created: false }
    const manager = this.createWorkspaceBuiltinManager(cwd)
    this.builtinActiveManagers.set(identity, manager)
    return { manager, created: true }
  }

  private getBuiltinSessionKey(cwd: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    const sessionIdentity = process.platform === 'win32' ? resolvedSessionPath.toLowerCase() : resolvedSessionPath
    return `${getWorkspaceIdentity(cwd)}\n${sessionIdentity}`
  }

  private getBuiltinSessionManager(cwd: string, sessionPath: string) {
    return this.getOrCreateBuiltinSessionManager(cwd, sessionPath).manager
  }

  private getOrCreateBuiltinSessionManager(cwd: string, sessionPath: string) {
    const key = this.getBuiltinSessionKey(cwd, sessionPath)
    const existingManager = this.builtinSessionManagers.get(key)
    if (existingManager) return { manager: existingManager, created: false }
    const manager = this.createWorkspaceBuiltinManager(cwd)
    this.builtinSessionManagers.set(key, manager)
    return { manager, created: true }
  }

  private activateBuiltinManager(cwd: string, manager: PiAgentManager, sessionPath: string | null) {
    this.builtinActiveManagers.set(getWorkspaceIdentity(cwd), manager)
    if (sessionPath) {
      this.builtinSessionManagers.set(this.getBuiltinSessionKey(cwd, sessionPath), manager)
    }
  }

  private removeBuiltinManager(manager: PiAgentManager) {
    this.builtinManagerWorkspaces.delete(manager)
    for (const [identity, candidate] of this.builtinActiveManagers) {
      if (candidate === manager) this.builtinActiveManagers.delete(identity)
    }
    for (const [key, candidate] of this.builtinSessionManagers) {
      if (candidate === manager) this.builtinSessionManagers.delete(key)
    }
  }

  private disposeBuiltinManager(manager: PiAgentManager) {
    manager.dispose()
    this.removeBuiltinManager(manager)
  }

  private getBuiltinManagerForOptionalWorkspace(cwd: string | null) {
    return cwd ? this.getBuiltinActiveManager(cwd) : this.draftBuiltinManager
  }
}

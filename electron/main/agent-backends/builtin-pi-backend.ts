import path from 'node:path'
import type {
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentQueuedMessageUpdate,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
} from '../../../src/features/agent/types'
import { PiAgentManager } from '../agent'
import { createWorkspaceIdentity as workspaceIdentity } from './runtime-keys'
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentBackendEventEmitter,
  AgentWorkspaceLoadOptions,
} from './types'

type BuiltinPiBackendOptions = {
  agentDir: string
}

type WorkspaceActivation = {
  identity: string
  revision: number
}

/**
 * Session-aware adapter for the embedded PI implementation.
 *
 * PiAgentManager intentionally retains its single-active-runtime invariant.
 * This backend composes one instance per live native session, which allows the
 * product to keep background sessions running without weakening that invariant.
 */
export class BuiltinPiBackend implements AgentBackend {
  readonly agentId = 'builtin-pi' as const
  readonly capabilities: Readonly<AgentBackendCapabilities>

  private readonly activeManagers = new Map<string, PiAgentManager>()
  // A later UI activation must always win, even when an earlier native request
  // resolves last. Workspace teardown advances the same revision boundary.
  private readonly activationRevisions = new Map<string, number>()
  private readonly draftManager: PiAgentManager
  private readonly managerWorkspaces = new Map<PiAgentManager, string>()
  // Session managers are cached before open completes so concurrent callers can
  // share them. Readiness plus pending counts keeps one failed caller from
  // disposing a manager that another caller is still successfully opening.
  private readonly pendingOperationCounts = new Map<PiAgentManager, number>()
  private readonly readyManagers = new Set<PiAgentManager>()
  private readonly sessionManagers = new Map<string, PiAgentManager>()
  private disposed = false

  constructor(
    private readonly emitEvent: AgentBackendEventEmitter,
    private readonly options: BuiltinPiBackendOptions,
  ) {
    this.draftManager = this.createManager()
    this.capabilities = {
      providerAuth: {
        login: (cwd, provider, callbacks) => (
          this.getManagerForOptionalWorkspace(cwd).loginProviderAuth(cwd, provider, callbacks)
        ),
        logout: (cwd, provider) => this.getManagerForOptionalWorkspace(cwd).logoutProviderAuth(cwd, provider),
        update: (cwd, provider, apiKey) => (
          this.getManagerForOptionalWorkspace(cwd).updateProviderAuth(cwd, provider, apiKey)
        ),
      },
      queuedMessageEditing: {
        update: (cwd, sessionPath, update) => this.updateQueuedMessage(cwd, sessionPath, update),
      },
    }
  }

  async loadWorkspaceState(
    cwd: string,
    preferredSessionPath: string | null = null,
    options: AgentWorkspaceLoadOptions = {},
  ) {
    const activation = this.beginWorkspaceActivation(cwd)
    const manager = preferredSessionPath
      ? this.getOrCreateSessionManager(cwd, preferredSessionPath).manager
      : options.restoreSession === false
        ? this.createWorkspaceManager(cwd)
        : this.getOrCreateActiveManager(cwd).manager
    const state = await this.runManagerInitialization(
      manager,
      () => manager.loadWorkspaceState(cwd, preferredSessionPath, options),
    )
    const activated = this.commitWorkspaceActivation(
      activation,
      manager,
      state.activeSession?.sessionPath ?? null,
    )
    if (!activated) this.disposeManagerIfOrphaned(manager)
    return state
  }

  loadDraftState() {
    return this.draftManager.loadDraftState()
  }

  listSessionItems(cwd: string) {
    return this.getActiveManager(cwd).listSessionItems(cwd)
  }

  readSession(cwd: string, sessionPath: string) {
    return this.getActiveManager(cwd).readSession(cwd, sessionPath)
  }

  sessionExists(cwd: string, sessionPath: string) {
    return this.getActiveManager(cwd).sessionExists(cwd, sessionPath)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    const activation = this.beginWorkspaceActivation(cwd)
    const manager = this.createWorkspaceManager(cwd)
    const state = await this.runManagerInitialization(
      manager,
      () => manager.createSession(cwd, options),
    )
    const sessionPath = state.activeSession?.sessionPath ?? null
    if (!this.commitWorkspaceActivation(activation, manager, sessionPath)) {
      const retained = sessionPath
        ? this.retainSessionManager(activation.identity, manager, sessionPath)
        : false
      if (!retained && this.managerWorkspaces.has(manager)) this.disposeManager(manager)
    }
    return state
  }

  async openSession(cwd: string, sessionPath: string) {
    const activation = this.beginWorkspaceActivation(cwd)
    const { manager } = this.getOrCreateSessionManager(cwd, sessionPath)
    const state = await this.runManagerInitialization(
      manager,
      () => manager.openSession(cwd, sessionPath),
    )
    this.commitWorkspaceActivation(
      activation,
      manager,
      state.activeSession?.sessionPath ?? sessionPath,
    )
    return state
  }

  async deleteSession(cwd: string, sessionPath: string) {
    const sessionKey = this.getSessionKey(cwd, sessionPath)
    const manager = this.sessionManagers.get(sessionKey) ?? this.createWorkspaceManager(cwd)
    const wasActive = this.activeManagers.get(workspaceIdentity(cwd)) === manager
    const activation = wasActive ? this.beginWorkspaceActivation(cwd) : null
    const deletedState = await manager.deleteSession(cwd, sessionPath, { restoreFallback: false }).catch((error) => {
      if (!this.sessionManagers.has(sessionKey) && this.managerWorkspaces.has(manager)) {
        this.disposeManager(manager)
      }
      throw error
    })
    if (this.managerWorkspaces.has(manager)) this.disposeManager(manager)

    if (!wasActive) {
      const activeManager = this.activeManagers.get(workspaceIdentity(cwd))
      return activeManager
        ? this.runManagerInitialization(activeManager, () => activeManager.loadWorkspaceState(cwd))
        : deletedState
    }

    if (!activation || !this.isWorkspaceActivationCurrent(activation)) return deletedState

    const fallbackManager = this.createWorkspaceManager(cwd)
    try {
      const remainingSessions = await fallbackManager.listSessionItems(cwd)
      if (!this.isWorkspaceActivationCurrent(activation)) {
        this.disposeManager(fallbackManager)
        return deletedState
      }
      if (remainingSessions[0]) {
        const state = await this.runManagerInitialization(
          fallbackManager,
          () => fallbackManager.openSession(cwd, remainingSessions[0].path),
        )
        if (!this.commitWorkspaceActivation(
          activation,
          fallbackManager,
          state.activeSession?.sessionPath ?? remainingSessions[0].path,
        ) && this.managerWorkspaces.has(fallbackManager)) {
          this.disposeManager(fallbackManager)
        }
        return state
      }
      const state = await this.runManagerInitialization(
        fallbackManager,
        () => fallbackManager.loadWorkspaceState(cwd, null, { restoreSession: false }),
      )
      if (!this.commitWorkspaceActivation(
        activation,
        fallbackManager,
        state.activeSession?.sessionPath ?? null,
      ) && this.managerWorkspaces.has(fallbackManager)) {
        this.disposeManager(fallbackManager)
      }
      return state
    } catch (error) {
      if (this.managerWorkspaces.has(fallbackManager)) this.disposeManager(fallbackManager)
      throw error
    }
  }

  async renameSession(cwd: string, sessionPath: string, name: string) {
    const activeManager = this.getActiveManager(cwd)
    const targetManager = this.sessionManagers.get(this.getSessionKey(cwd, sessionPath)) ?? activeManager
    const targetState = await targetManager.renameSession(cwd, sessionPath, name)
    return targetManager === activeManager
      ? targetState
      : this.runManagerInitialization(activeManager, () => activeManager.loadWorkspaceState(cwd))
  }

  sendPrompt(
    cwd: string,
    sessionPath: string,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments?: AgentPromptAttachment[],
    _options?: AgentPromptSendOptions,
  ) {
    return this.getSessionManager(cwd, sessionPath).sendPrompt(prompt, streamingBehavior, attachments)
  }

  private updateQueuedMessage(cwd: string, sessionPath: string, update: AgentQueuedMessageUpdate) {
    return this.getSessionManager(cwd, sessionPath).updateQueuedMessage(update)
  }

  selectModel(cwd: string, sessionPath: string, modelKey: string) {
    return this.getSessionManager(cwd, sessionPath).selectModel(modelKey)
  }

  selectThinkingLevel(cwd: string, sessionPath: string, level: string, modelKey?: string) {
    return this.getSessionManager(cwd, sessionPath).selectThinkingLevel(level, modelKey)
  }

  abortActivePrompt(cwd: string, sessionPath: string) {
    return this.getSessionManager(cwd, sessionPath).abortActivePrompt()
  }

  async releaseWorkspaceRuntime(cwd: string) {
    const identity = workspaceIdentity(cwd)
    this.invalidateWorkspaceActivation(identity)
    const managers = [...this.managerWorkspaces.entries()]
      .filter(([, managerWorkspace]) => managerWorkspace === identity)
      .map(([manager]) => manager)
    for (const manager of managers) this.removeManager(manager)
    const releaseResults = await Promise.allSettled(
      managers.map((manager) => manager.releaseWorkspaceRuntime(cwd)),
    )
    for (const manager of managers) manager.dispose()
    const failures = releaseResults.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more embedded PI workspace runtimes could not be released.')
    }
  }

  async discardWorkspaceSessions(cwd: string) {
    const identity = workspaceIdentity(cwd)
    this.invalidateWorkspaceActivation(identity)
    const manager = this.getActiveManager(cwd)
    const workspaceManagers = [...this.managerWorkspaces.entries()]
      .filter(([, managerWorkspace]) => managerWorkspace === identity)
      .map(([candidate]) => candidate)
    for (const candidate of workspaceManagers) this.removeManager(candidate)
    const cleanupResults = await Promise.allSettled([
      ...workspaceManagers.filter((candidate) => candidate !== manager).map((candidate) => (
        candidate.releaseWorkspaceRuntime(cwd)
      )),
      manager.discardWorkspaceSessions(cwd),
    ])
    for (const candidate of workspaceManagers) candidate.dispose()
    const failures = cleanupResults.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more embedded PI session stores could not be cleaned up.')
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.draftManager.dispose()
    for (const manager of this.managerWorkspaces.keys()) manager.dispose()
    this.activeManagers.clear()
    this.activationRevisions.clear()
    this.managerWorkspaces.clear()
    this.pendingOperationCounts.clear()
    this.readyManagers.clear()
    this.sessionManagers.clear()
  }

  private createManager() {
    return new PiAgentManager(this.emitEvent, { agentDir: this.options.agentDir })
  }

  private createWorkspaceManager(cwd: string) {
    const identity = workspaceIdentity(cwd)
    const manager = this.createManager()
    this.managerWorkspaces.set(manager, identity)
    return manager
  }

  private getActiveManager(cwd: string) {
    return this.getOrCreateActiveManager(cwd).manager
  }

  private getOrCreateActiveManager(cwd: string) {
    const identity = workspaceIdentity(cwd)
    const existingManager = this.activeManagers.get(identity)
    if (existingManager) return { manager: existingManager, created: false }
    const manager = this.createWorkspaceManager(cwd)
    this.activeManagers.set(identity, manager)
    return { manager, created: true }
  }

  private getSessionKey(cwd: string, sessionPath: string) {
    return this.getSessionKeyForIdentity(workspaceIdentity(cwd), sessionPath)
  }

  private getSessionKeyForIdentity(identity: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    const sessionIdentity = process.platform === 'win32' ? resolvedSessionPath.toLowerCase() : resolvedSessionPath
    return `${identity}\n${sessionIdentity}`
  }

  private getSessionManager(cwd: string, sessionPath: string) {
    return this.getOrCreateSessionManager(cwd, sessionPath).manager
  }

  private getOrCreateSessionManager(cwd: string, sessionPath: string) {
    const key = this.getSessionKey(cwd, sessionPath)
    const existingManager = this.sessionManagers.get(key)
    if (existingManager) return { manager: existingManager, created: false }
    const manager = this.createWorkspaceManager(cwd)
    this.sessionManagers.set(key, manager)
    return { manager, created: true }
  }

  private beginWorkspaceActivation(cwd: string): WorkspaceActivation {
    if (this.disposed) throw new Error('Agent manager is disposed.')
    const identity = workspaceIdentity(cwd)
    const revision = (this.activationRevisions.get(identity) ?? 0) + 1
    this.activationRevisions.set(identity, revision)
    return { identity, revision }
  }

  private invalidateWorkspaceActivation(identity: string) {
    const revision = (this.activationRevisions.get(identity) ?? 0) + 1
    this.activationRevisions.set(identity, revision)
  }

  private isWorkspaceActivationCurrent(activation: WorkspaceActivation) {
    return !this.disposed && this.activationRevisions.get(activation.identity) === activation.revision
  }

  private commitWorkspaceActivation(
    activation: WorkspaceActivation,
    manager: PiAgentManager,
    sessionPath: string | null,
  ) {
    if (
      !this.isWorkspaceActivationCurrent(activation)
      || this.managerWorkspaces.get(manager) !== activation.identity
    ) {
      return false
    }

    const previousActiveManager = this.activeManagers.get(activation.identity)
    this.activeManagers.set(activation.identity, manager)
    if (sessionPath) {
      this.sessionManagers.set(this.getSessionKeyForIdentity(activation.identity, sessionPath), manager)
    }
    if (previousActiveManager && previousActiveManager !== manager) {
      this.disposeManagerIfOrphaned(previousActiveManager)
    }
    return true
  }

  private retainSessionManager(identity: string, manager: PiAgentManager, sessionPath: string) {
    if (this.managerWorkspaces.get(manager) !== identity) return false
    const key = this.getSessionKeyForIdentity(identity, sessionPath)
    const existingManager = this.sessionManagers.get(key)
    if (existingManager && existingManager !== manager) return false
    this.sessionManagers.set(key, manager)
    return true
  }

  private removeManager(manager: PiAgentManager) {
    this.managerWorkspaces.delete(manager)
    this.pendingOperationCounts.delete(manager)
    this.readyManagers.delete(manager)
    for (const [identity, candidate] of this.activeManagers) {
      if (candidate === manager) this.activeManagers.delete(identity)
    }
    for (const [key, candidate] of this.sessionManagers) {
      if (candidate === manager) this.sessionManagers.delete(key)
    }
  }

  private disposeManager(manager: PiAgentManager) {
    manager.dispose()
    this.removeManager(manager)
  }

  private disposeManagerIfOrphaned(manager: PiAgentManager) {
    if (!this.managerWorkspaces.has(manager)) return
    if (this.pendingOperationCounts.has(manager)) return
    if ([...this.activeManagers.values()].includes(manager)) return
    if ([...this.sessionManagers.values()].includes(manager)) return
    this.disposeManager(manager)
  }

  private beginManagerOperation(manager: PiAgentManager) {
    const pendingOperations = this.pendingOperationCounts.get(manager) ?? 0
    this.pendingOperationCounts.set(manager, pendingOperations + 1)
  }

  private finishManagerOperation(manager: PiAgentManager, succeeded: boolean) {
    const pendingOperations = this.pendingOperationCounts.get(manager) ?? 0
    if (pendingOperations <= 1) {
      this.pendingOperationCounts.delete(manager)
    } else {
      this.pendingOperationCounts.set(manager, pendingOperations - 1)
    }
    if (!this.managerWorkspaces.has(manager)) {
      // Teardown may finish before a native open/load/create. PI can establish
      // a runtime after that first dispose, so every detached late completion
      // must be disposed again instead of becoming unreachable live state.
      manager.dispose()
      return
    }
    if (succeeded) this.readyManagers.add(manager)
  }

  private disposeManagerIfUnreadyAndIdle(manager: PiAgentManager) {
    if (!this.managerWorkspaces.has(manager)) return
    if (this.pendingOperationCounts.has(manager)) return
    if (this.readyManagers.has(manager)) return
    this.disposeManager(manager)
  }

  private async runManagerInitialization<T>(manager: PiAgentManager, initialize: () => Promise<T>) {
    this.beginManagerOperation(manager)
    try {
      const result = await initialize()
      this.finishManagerOperation(manager, true)
      return result
    } catch (error) {
      this.finishManagerOperation(manager, false)
      this.disposeManagerIfUnreadyAndIdle(manager)
      this.disposeManagerIfOrphaned(manager)
      throw error
    }
  }

  private getManagerForOptionalWorkspace(cwd: string | null) {
    return cwd ? this.getActiveManager(cwd) : this.draftManager
  }
}

import { lstat, rm } from 'node:fs/promises'
import path from 'node:path'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'
import { clampThinkingLevel, getEnvApiKey, getSupportedThinkingLevels, type Api, type Model } from '@earendil-works/pi-ai'
import type {
  AgentClientEventPayload,
  AgentPromptAttachment,
  AgentProviderAuthState,
  AgentQueuedMessageUpdate,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentRuntimeState,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentWorkspaceState,
} from '../../../../shared/agent-contracts/types'
import {
  AGENT_PROVIDER_AUTH_CONFIGS,
  getAgentProviderAuthConfig,
  getAgentProviderOrder,
  type AgentProviderAuthConfig,
} from '../../../../shared/agent-contracts/provider-auth'
import { AgentSessionAnnotationStore } from '../../sessions/annotations'
import {
  collectDirectToolPathsByEntryId,
  filterAnnotationsByDirectToolPaths,
} from '../../sessions/file-change-extractor'
import type { AgentProviderAuthLoginCallbacks } from '../../application/agent-backend'
import {
  getInputsByModel,
  getProviderPreferredModelKeys,
  getThinkingLevelsByModel,
  isPiThinkingLevel as isThinkingLevel,
  loadPiDefaultModelPerProvider,
  PI_THINKING_LEVELS as THINKING_LEVELS,
  selectPiPreferredModel,
} from './model-selection'
import {
  appendAttachmentText,
  normalizePromptAttachments,
  preparePromptAttachments,
} from './prompt-attachments'
import {
  clampText,
  parseEntryTimestamp,
  serializeMessage,
  serializePiWebSessionEntries,
  serializeSessionEntries,
} from './session-presentation'
import {
  areSameWorkspacePath,
  BuiltinPiSessionCatalog,
  getArynPiSessionDir,
} from './session-catalog'
import {
  applyAgentQueuedMessageUpdate,
  type AgentQueueSnapshot,
} from './message-queue'
import { handleBuiltinPiSessionEvent } from './session-event-handler'
import type { BuiltinPiSessionRuntime as ActiveSessionRuntime } from './runtime'
import { BuiltinPiSessionNamer } from './session-namer'

export {
  applyAgentQueuedMessageUpdate,
  getArynPiSessionDir,
  getThinkingLevelsByModel,
  serializePiWebSessionEntries,
  serializeSessionEntries,
}

type PiAgentManagerOptions = {
  agentDir: string
}

type LoadAgentWorkspaceStateOptions = {
  restoreSession?: boolean
}

type NormalizedCreateSessionOptions = {
  modelKey: string | null
  name: string | null
  thinkingLevel: ThinkingLevel | null
}
const OPENROUTER_ENV_KEY = 'OPENROUTER_API_KEY'
const OPENROUTER_PROVIDER = 'openrouter'
const OPENAI_ENV_KEY = 'OPENAI_API_KEY'
const GOOGLE_ENV_KEY = 'GEMINI_API_KEY'
const AUTH_SETUP_HINT = `No authenticated models are available. Add a provider credential in Settings > Providers, log in to a subscription provider, or set a supported Pi provider environment variable such as ${OPENROUTER_ENV_KEY}, ${OPENAI_ENV_KEY}, or ${GOOGLE_ENV_KEY}.`

export class PiAgentManager {
  private activeRuntime: ActiveSessionRuntime | null = null
  private readonly annotationStore = new AgentSessionAnnotationStore()
  private readonly authStorage: AuthStorage
  private readonly modelRegistry: ModelRegistry
  private readonly sessionNamer: BuiltinPiSessionNamer
  private readonly sessionCatalog: BuiltinPiSessionCatalog

  constructor(
    private readonly emitEvent: (event: AgentClientEventPayload) => void,
    private readonly options: PiAgentManagerOptions,
  ) {
    this.authStorage = AuthStorage.create(path.join(options.agentDir, 'auth.json'))
    this.modelRegistry = ModelRegistry.create(this.authStorage, path.join(options.agentDir, 'models.json'))
    this.sessionCatalog = new BuiltinPiSessionCatalog(options.agentDir, this.annotationStore)
    this.sessionNamer = new BuiltinPiSessionNamer(async (session) => {
      if (this.activeRuntime?.session === session) {
        await this.broadcastWorkspaceState(this.activeRuntime.cwd)
      }
    })
  }

  async loadWorkspaceState(
    cwd: string,
    preferredSessionPath: string | null = null,
    options: LoadAgentWorkspaceStateOptions = {},
  ): Promise<AgentWorkspaceState> {
    if (!areSameWorkspacePath(this.activeRuntime?.cwd, cwd)) {
      await this.releaseActiveSession()
    }

    if (options.restoreSession === false) {
      if (this.activeRuntime) {
        await this.releaseActiveSession()
      }

      return this.buildWorkspaceState(cwd)
    }

    if (!this.activeRuntime) {
      const restorableSessionPath = await this.sessionCatalog.resolveRestorable(cwd, preferredSessionPath)

      if (restorableSessionPath) {
        try {
          await this.activateSession(cwd, this.sessionCatalog.open(cwd, restorableSessionPath))
        } catch {
          return this.buildWorkspaceState(cwd)
        }
      }
    }

    return this.buildWorkspaceState(cwd)
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    await this.releaseActiveSession()
    this.authStorage.reload()
    this.modelRegistry.refresh()

    return {
      activeSession: null,
      runtime: await this.serializeRuntime(null, null),
      sessions: [],
    }
  }

  async releaseWorkspaceRuntime(cwd: string) {
    if (areSameWorkspacePath(this.activeRuntime?.cwd, cwd)) {
      await this.releaseActiveSession()
    }
  }

  async discardWorkspaceSessions(cwd: string) {
    await this.releaseWorkspaceRuntime(cwd)
    await this.sessionCatalog.discard(cwd)
  }

  async listSessionItems(cwd: string): Promise<AgentSessionListItem[]> {
    return this.sessionCatalog.list(cwd)
  }

  async readSession(cwd: string, sessionPath: string): Promise<AgentSessionSnapshot> {
    const resolvedSessionPath = await this.sessionCatalog.resolveFile(cwd, sessionPath)
    const sessionManager = this.sessionCatalog.open(cwd, resolvedSessionPath)

    return this.serializeSessionManager(cwd, sessionManager)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions): Promise<AgentWorkspaceState> {
    const createOptions = this.normalizeCreateSessionOptions(options)
    const session = await this.activateSession(cwd, SessionManager.create(cwd, this.sessionCatalog.sessionDir(cwd)))

    if (createOptions.name) {
      session.setSessionName(createOptions.name)
    }

    if (createOptions.modelKey) {
      await this.applySessionModel(session, createOptions.modelKey)
    }

    if (createOptions.thinkingLevel) {
      session.setThinkingLevel(createOptions.thinkingLevel)
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async openSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = await this.sessionCatalog.resolveFile(cwd, sessionPath)
    const runtime = this.activeRuntime

    if (
      runtime
      && areSameWorkspacePath(runtime.cwd, cwd)
      && runtime.session.sessionFile === resolvedSessionPath
    ) {
      return this.buildWorkspaceState(cwd)
    }

    await this.activateSession(cwd, this.sessionCatalog.open(cwd, resolvedSessionPath))
    return this.broadcastWorkspaceState(cwd)
  }

  async deleteSession(
    cwd: string,
    sessionPath: string,
    options: { restoreFallback?: boolean } = {},
  ): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = await this.sessionCatalog.resolveFile(cwd, sessionPath)
    const runtime = this.activeRuntime
    const isDeletingActiveSession = Boolean(
      runtime
      && areSameWorkspacePath(runtime.cwd, cwd)
      && runtime.session.sessionFile === resolvedSessionPath,
    )

    if (isDeletingActiveSession) {
      await this.releaseActiveSession()
    }

    try {
      const sessionStats = await lstat(resolvedSessionPath)
      await rm(resolvedSessionPath, {
        force: true,
        recursive: sessionStats.isDirectory(),
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    await this.annotationStore.delete(resolvedSessionPath)

    if (isDeletingActiveSession && options.restoreFallback !== false) {
      const remainingSessions = await this.sessionCatalog.list(cwd)

      if (remainingSessions.length > 0) {
        await this.activateSession(cwd, this.sessionCatalog.open(cwd, remainingSessions[0].path))
      }
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async renameSession(cwd: string, sessionPath: string, name: string) {
    const resolvedSessionPath = await this.sessionCatalog.resolveFile(cwd, sessionPath)
    const nextName = name.trim()
    const runtime = this.activeRuntime
    const isRenamingActiveSession = Boolean(
      runtime
      && areSameWorkspacePath(runtime.cwd, cwd)
      && runtime.session.sessionFile === resolvedSessionPath,
    )

    if (runtime && isRenamingActiveSession) {
      runtime.session.setSessionName(nextName)
    } else {
      const sessionManager = this.sessionCatalog.open(cwd, resolvedSessionPath)
      sessionManager.appendSessionInfo(nextName)
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async abortActivePrompt() {
    const runtime = this.requireActiveSession()
    await runtime.session.abort()
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async updateQueuedMessage(update: AgentQueuedMessageUpdate) {
    const runtime = this.requireActiveSession()
    const queue = this.readQueueSnapshot(runtime.session)
    const nextQueue = applyAgentQueuedMessageUpdate(queue, update)

    await this.rebuildQueue(runtime.session, nextQueue)
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  private normalizeCreateSessionOptions(options?: string | AgentSessionCreateOptions): NormalizedCreateSessionOptions {
    if (typeof options === 'string') {
      return {
        modelKey: null,
        name: options.trim() || null,
        thinkingLevel: null,
      }
    }

    const thinkingLevel = options?.thinkingLevel
    if (thinkingLevel && !isThinkingLevel(thinkingLevel)) {
      throw new Error(`Thinking level "${thinkingLevel}" is not supported.`)
    }

    return {
      modelKey: options?.modelKey?.trim() || null,
      name: options?.name?.trim() || null,
      thinkingLevel: thinkingLevel ?? null,
    }
  }

  private async applySessionModel(session: AgentSession, modelKey: string) {
    this.authStorage.reload()
    session.modelRegistry.refresh()

    const selectedModel = this.resolveAvailableModel(session.modelRegistry.getAvailable(), modelKey)

    if (!selectedModel) {
      throw new Error(`Model "${modelKey}" is not available.`)
    }

    if (
      session.model?.provider !== selectedModel.provider
      || session.model?.id !== selectedModel.id
    ) {
      await session.setModel(selectedModel)
    }

    return selectedModel
  }

  async selectModel(modelKey: string) {
    const runtime = this.requireActiveSession()

    const trimmedModelKey = modelKey.trim()
    const selectedModel = await this.applySessionModel(runtime.session, trimmedModelKey)
    runtime.session.settingsManager.setDefaultModelAndProvider(selectedModel.provider, selectedModel.id)
    await runtime.session.settingsManager.flush()

    const settingsErrors = runtime.session.settingsManager.drainErrors()
    if (settingsErrors.length > 0) {
      const firstError = settingsErrors[0]
      this.emitError(firstError.error.message, runtime.session.sessionId)
    }

    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async selectThinkingLevel(level: string, modelKey?: string) {
    const runtime = this.requireActiveSession()

    if (!isThinkingLevel(level)) {
      throw new Error(`Thinking level "${level}" is not supported.`)
    }

    const trimmedModelKey = modelKey?.trim()

    if (trimmedModelKey) {
      await this.applySessionModel(runtime.session, trimmedModelKey)
    }

    runtime.session.setThinkingLevel(level)
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async updateProviderAuth(cwd: string | null, provider: string, apiKey: string | null) {
    this.authStorage.reload()
    const config = getAgentProviderAuthConfig(provider)

    if (!config.supportsApiKey && apiKey?.trim()) {
      throw new Error(`${config.label} does not support API key authentication.`)
    }

    const trimmedApiKey = apiKey?.trim()
    if (trimmedApiKey) {
      this.authStorage.set(provider, {
        type: 'api_key',
        key: trimmedApiKey,
      })
    } else {
      this.authStorage.remove(provider)
    }

    return this.completeProviderAuthChange(cwd)
  }

  async loginProviderAuth(cwd: string | null, provider: string, callbacks: AgentProviderAuthLoginCallbacks) {
    const oauthProvider = this.authStorage.getOAuthProviders().find((candidate) => candidate.id === provider)
    const config = getAgentProviderAuthConfig(provider)

    if (!oauthProvider || !config.supportsOAuth) {
      throw new Error(`${config.label} does not support subscription login.`)
    }

    const manualCodePrompt = {
      message: '如果浏览器登录没有自动完成，请粘贴最终 redirect URL 或授权码。',
      placeholder: 'Redirect URL 或授权码',
    }

    try {
      this.authStorage.reload()
      callbacks.emitProgress(provider, `正在启动 ${config.label} 登录...`)

      await this.authStorage.login(provider, {
        onAuth: (info) => {
          callbacks.emitAuth(provider, info)
          callbacks.openExternal(info.url).catch((error) => {
            callbacks.emitProgress(
              provider,
              `无法自动打开浏览器：${error instanceof Error ? error.message : String(error)}`,
            )
          })
        },
        onManualCodeInput: oauthProvider.usesCallbackServer
          ? () => callbacks.requestInput(provider, manualCodePrompt)
          : undefined,
        onProgress: (message) => callbacks.emitProgress(provider, message),
        onPrompt: (prompt) => callbacks.requestInput(provider, prompt),
        signal: callbacks.signal,
      })

      callbacks.emitComplete(provider, true)
      return this.completeProviderAuthChange(cwd)
    } catch (error) {
      callbacks.emitComplete(provider, false, error instanceof Error ? error.message : String(error))
      throw error
    }
  }

  async logoutProviderAuth(cwd: string | null, provider: string) {
    this.authStorage.reload()
    this.authStorage.logout(provider)
    return this.completeProviderAuthChange(cwd)
  }

  private async completeProviderAuthChange(cwd: string | null) {
    this.modelRegistry.refresh()
    const runtime = this.activeRuntime

    if (runtime) {
      runtime.session.modelRegistry.refresh()
    }

    if (cwd && runtime && areSameWorkspacePath(runtime.cwd, cwd)) {
      if (runtime.session.model && !runtime.session.modelRegistry.hasConfiguredAuth(runtime.session.model)) {
        this.emitError(AUTH_SETUP_HINT, runtime.session.sessionId)
      } else if (!runtime.session.model) {
        await this.ensureModelSelected(runtime.session)
      }

      return this.broadcastWorkspaceState(cwd)
    }

    return cwd ? this.buildWorkspaceState(cwd) : this.loadDraftState()
  }

  async sendPrompt(prompt: string, streamingBehavior?: AgentRunningPromptBehavior, rawAttachments?: unknown) {
    const runtime = this.requireActiveSession()
    const message = prompt.trim()
    const attachments = normalizePromptAttachments(rawAttachments)

    if (!message && attachments.length === 0) {
      throw new Error('Prompt cannot be empty.')
    }

    if (!runtime.session.model || !runtime.session.modelRegistry.hasConfiguredAuth(runtime.session.model)) {
      throw new Error(AUTH_SETUP_HINT)
    }

    const preparedAttachments = attachments.length > 0
      ? await preparePromptAttachments(attachments, runtime.session.model)
      : { images: [], text: '' }
    const messageWithAttachments = appendAttachmentText(
      message || 'Please inspect the attached file(s).',
      preparedAttachments.text,
    )

    const pendingPrompt = streamingBehavior === 'steer'
      ? runtime.session.steer(messageWithAttachments, preparedAttachments.images)
      : streamingBehavior === 'followUp'
        ? runtime.session.followUp(messageWithAttachments, preparedAttachments.images)
        : runtime.session.prompt(messageWithAttachments, {
            images: preparedAttachments.images,
          })
    this.emitEvent({
      type: 'workspace_state',
      state: await this.serializeWorkspaceState(
        runtime.cwd,
        await this.sessionCatalog.list(runtime.cwd),
        runtime.session,
      ),
    })

    void pendingPrompt.catch((error) => {
      this.emitError(error instanceof Error ? error.message : 'Pi Agent failed to process the request.', runtime.session.sessionId)
      void this.broadcastWorkspaceState(runtime.cwd)
    })

    return { ok: true }
  }

  async sessionExists(cwd: string, sessionPath: string) {
    try {
      const resolvedSessionPath = await this.sessionCatalog.resolveFile(cwd, sessionPath)
      const sessionStats = await lstat(resolvedSessionPath)
      return sessionStats.isFile()
    } catch {
      return false
    }
  }

  private readQueueSnapshot(session: AgentSession): AgentQueueSnapshot {
    return {
      followUp: [...session.getFollowUpMessages()],
      steering: [...session.getSteeringMessages()],
    }
  }

  private async rebuildQueue(session: AgentSession, queue: AgentQueueSnapshot) {
    const previousQueue = session.clearQueue()

    try {
      for (const message of queue.steering) {
        await session.steer(message)
      }

      for (const message of queue.followUp) {
        await session.followUp(message)
      }
    } catch (error) {
      session.clearQueue()

      for (const message of previousQueue.steering) {
        await session.steer(message)
      }

      for (const message of previousQueue.followUp) {
        await session.followUp(message)
      }

      throw error
    }
  }

  dispose() {
    return this.releaseActiveSession()
  }

  private async activateSession(cwd: string, sessionManager: SessionManager) {
    await this.releaseActiveSession()
    this.authStorage.reload()
    this.modelRegistry.refresh()
    const settingsManager = this.createSettingsManager(cwd)

    const {
      extensionsResult,
      modelFallbackMessage,
      session,
    } = await createAgentSession({
      agentDir: this.options.agentDir,
      authStorage: this.authStorage,
      cwd,
      modelRegistry: this.modelRegistry,
      sessionManager,
      settingsManager,
      tools: ['read', 'bash', 'edit', 'write'],
    })

    await this.ensureModelSelected(session)
    this.emitSetupDiagnostics(session, extensionsResult.errors, modelFallbackMessage)

    const unsubscribe = session.subscribe((event) => {
      void this.handleSessionEvent(session, event)
    })

    this.activeRuntime = {
      activity: {
        pendingAssistantEntryId: null,
        runningToolCalls: new Map(),
      },
      cwd,
      session,
      status: {
        compactionReason: null,
        retryMaxAttempts: null,
      },
      unsubscribe,
    }

    return session
  }

  private createSettingsManager(cwd: string) {
    const settingsManager = SettingsManager.create(cwd, this.options.agentDir)
    settingsManager.applyOverrides({
      sessionDir: this.sessionCatalog.sessionDir(cwd),
    })
    return settingsManager
  }

  private createDraftSettingsManager() {
    const globalSettings = SettingsManager.create(this.options.agentDir, this.options.agentDir).getGlobalSettings()
    return SettingsManager.inMemory(globalSettings)
  }

  private resolveAvailableModel(availableModels: Model<Api>[], modelKey: string) {
    return availableModels.find((model) => `${model.provider}/${model.id}` === modelKey)
      ?? availableModels.find((model) => `${model.provider}/${model.id}` === `${OPENROUTER_PROVIDER}/${modelKey}`)
      ?? availableModels.find((model) => model.provider === OPENROUTER_PROVIDER && model.id === modelKey)
  }

  private async ensureModelSelected(session: AgentSession) {
    if (session.model) {
      return
    }

    const availableModels = session.modelRegistry.getAvailable()

    if (availableModels.length === 0) {
      return
    }

    const defaultModelPerProvider = await loadPiDefaultModelPerProvider()
    const preferredSelection = selectPiPreferredModel(
      availableModels,
      session.settingsManager,
      defaultModelPerProvider,
    )

    if (!preferredSelection) {
      return
    }

    await session.setModel(preferredSelection)
  }

  private async handleSessionEvent(
    session: AgentSession,
    event: Parameters<typeof handleBuiltinPiSessionEvent>[1],
  ) {
    const runtime = this.activeRuntime
    if (!runtime || runtime.session !== session) return
    await handleBuiltinPiSessionEvent(runtime, event, {
      annotationStore: this.annotationStore,
      emitEvent: this.emitEvent,
      onTurnEnded: (currentSession) => {
        void this.sessionNamer.maybeName(currentSession)
      },
      onWorkspaceStateChanged: (cwd) => this.broadcastWorkspaceState(cwd),
    })
  }

  private async broadcastWorkspaceState(cwd: string) {
    const state = await this.buildWorkspaceState(cwd)
    this.emitEvent({
      type: 'workspace_state',
      state,
    })
    return state
  }

  private async buildWorkspaceState(cwd: string): Promise<AgentWorkspaceState> {
    const sessions = await this.sessionCatalog.list(cwd)
    const runtime = this.activeRuntime
    return this.serializeWorkspaceState(cwd, sessions, runtime && areSameWorkspacePath(runtime.cwd, cwd) ? runtime.session : null)
  }

  private async serializeWorkspaceState(
    cwd: string,
    sessions: AgentSessionListItem[],
    session: AgentSession | null,
  ): Promise<AgentWorkspaceState> {
    const resolvedSessions = session ? this.mergeActiveSessionListItem(sessions, session) : sessions

    return {
      activeSession: session ? await this.serializeSession(session) : null,
      runtime: await this.serializeRuntime(cwd, session),
      sessions: resolvedSessions,
    }
  }

  private mergeActiveSessionListItem(sessions: AgentSessionListItem[], session: AgentSession) {
    const activeSessionItem = this.serializeActiveSessionListItem(session)

    if (!activeSessionItem) {
      return sessions
    }

    const existingIndex = sessions.findIndex((candidate) => candidate.path === activeSessionItem.path)
    const nextSessions = existingIndex >= 0
      ? sessions.map((candidate, index) => index === existingIndex ? activeSessionItem : candidate)
      : [activeSessionItem, ...sessions]

    return nextSessions.sort((left, right) => Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt))
  }

  private serializeActiveSessionListItem(session: AgentSession): AgentSessionListItem | null {
    const sessionPath = session.sessionFile

    if (!sessionPath) {
      return null
    }

    const header = session.sessionManager.getHeader()
    const branchEntries = session.sessionManager.getBranch()
    const messages = serializeSessionEntries(branchEntries)
    const runtimeMessages = session.messages
      .map((message, index) => serializeMessage(message, index))
      .filter((message): message is AgentSidebarMessage => Boolean(message))
    const visibleMessages = runtimeMessages.length > messages.length ? runtimeMessages : messages
    const firstUserMessage = messages.find((message) => message.kind === 'user')
      ?? runtimeMessages.find((message) => message.kind === 'user')
    const name = session.sessionName ?? null

    if (!name && !firstUserMessage) {
      return null
    }

    const createdTimestamp = header ? parseEntryTimestamp(header.timestamp) : Date.now()
    const modifiedAt = visibleMessages.reduce(
      (latestTimestamp, message) => Math.max(latestTimestamp, message.timestamp),
      createdTimestamp,
    )
    const preview = clampText(name || firstUserMessage?.text || 'New session', 72)

    return {
      createdAt: new Date(createdTimestamp).toISOString(),
      id: session.sessionId,
      messageCount: branchEntries.filter((entry) => entry.type === 'message').length,
      modifiedAt: new Date(modifiedAt).toISOString(),
      name,
      path: sessionPath,
      preview,
    }
  }

  private async serializeRuntime(cwd: string | null, session: AgentSession | null): Promise<AgentRuntimeState> {
    const activeRuntimeForCwd = this.activeRuntime && areSameWorkspacePath(this.activeRuntime.cwd, cwd)
      ? this.activeRuntime
      : null
    const modelRegistry = session?.modelRegistry ?? this.modelRegistry
    const availableModels = modelRegistry.getAvailable()
    const defaultModelPerProvider = await loadPiDefaultModelPerProvider()
    const settingsManager = session?.settingsManager
      ?? (cwd ? this.createSettingsManager(cwd) : this.createDraftSettingsManager())
    const defaultModelValue = selectPiPreferredModel(availableModels, settingsManager, defaultModelPerProvider)
    const defaultModel = defaultModelValue ? `${defaultModelValue.provider}/${defaultModelValue.id}` : null
    const defaultThinkingLevel = settingsManager.getDefaultThinkingLevel() ?? 'medium'
    const selectedModelValue = session?.model
      ?? (!session ? defaultModelValue : null)
    const selectedModel = selectedModelValue ? `${selectedModelValue.provider}/${selectedModelValue.id}` : null
    const configuredThinkingLevel = session?.thinkingLevel ?? defaultThinkingLevel
    const availableThinkingLevels = selectedModelValue
      ? getSupportedThinkingLevels(selectedModelValue)
      : THINKING_LEVELS
    const thinkingLevel = selectedModelValue
      ? clampThinkingLevel(selectedModelValue, configuredThinkingLevel)
      : configuredThinkingLevel
    const steeringMessages = session ? [...session.getSteeringMessages()] : []
    const followUpMessages = session ? [...session.getFollowUpMessages()] : []
    const steeringMessageCount = steeringMessages.length
    const followUpMessageCount = followUpMessages.length

    return {
      agentId: 'builtin-pi',
      auth: this.getProviderAuthStates(availableModels.map((model) => model.provider)),
      availableModels: availableModels.map((model) => `${model.provider}/${model.id}`),
      availableModelInputs: getInputsByModel(availableModels),
      availableThinkingLevels,
      availableThinkingLevelsByModel: getThinkingLevelsByModel(availableModels),
      compactionReason: activeRuntimeForCwd?.status.compactionReason ?? null,
      followUpMessageCount,
      followUpMessages,
      followUpMode: session?.followUpMode ?? 'one-at-a-time',
      hasConfiguredModels: availableModels.length > 0,
      isCompacting: session?.isCompacting ?? false,
      isStreaming: session?.isStreaming ?? false,
      defaultModel,
      defaultThinkingLevel,
      pendingMessageCount: session?.pendingMessageCount ?? 0,
      preferredModelByProvider: getProviderPreferredModelKeys(availableModels, defaultModelPerProvider),
      retryAttempt: session?.retryAttempt ?? 0,
      retryMaxAttempts: activeRuntimeForCwd?.status.retryMaxAttempts ?? null,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : AUTH_SETUP_HINT,
      supportedRunningPromptBehaviors: ['steer', 'followUp'],
      supportsQueuedMessageEditing: true,
      supportsThinking: Boolean(selectedModelValue?.reasoning),
      steeringMessageCount,
      steeringMessages,
      steeringMode: session?.steeringMode ?? 'one-at-a-time',
      thinkingLevel,
      workspacePath: cwd,
    }
  }

  private async serializeSession(session: AgentSession): Promise<AgentSessionSnapshot> {
    const workspacePath = this.activeRuntime?.cwd ?? session.sessionManager.getCwd()

    return this.serializeSessionManager(
      workspacePath,
      session.sessionManager,
      session.sessionId,
      session.isStreaming,
    )
  }

  private async serializeSessionManager(
    cwd: string,
    sessionManager: SessionManager,
    sessionId = sessionManager.getSessionId(),
    isStreaming = false,
  ): Promise<AgentSessionSnapshot> {
    const branchEntries = sessionManager.getBranch()
    const messages = serializeSessionEntries(branchEntries)
    const nativeMessages = serializePiWebSessionEntries(branchEntries)
    const sessionPath = sessionManager.getSessionFile() ?? null
    const annotations = sessionPath
      ? filterAnnotationsByDirectToolPaths(
        await this.annotationStore.read(sessionPath),
        collectDirectToolPathsByEntryId(branchEntries, cwd),
      )
      : { fileChangesByEntryId: {} }

    return {
      annotations,
      // Keep the legacy projection during the renderer migration so this
      // backend commit remains compatible with clients that do not consume
      // the native PI snapshot yet.
      messages,
      native: {
        agentId: 'builtin-pi',
        entryIds: nativeMessages.entryIds,
        isStreaming,
        messages: nativeMessages.messages,
        modelNames: {},
        sessionId,
      },
      name: sessionManager.getSessionName() ?? null,
      sessionId,
      sessionPath,
      workspacePath: cwd,
    }
  }

  private getProviderAuthStates(modelProviders: string[]): Record<string, AgentProviderAuthState> {
    const providers = new Set([
      ...AGENT_PROVIDER_AUTH_CONFIGS.map((config) => config.provider),
      ...this.authStorage.list(),
      ...modelProviders,
    ])

    return Object.fromEntries(
      Array.from(providers)
        .sort((left, right) => {
          const orderDelta = getAgentProviderOrder(left) - getAgentProviderOrder(right)
          return orderDelta !== 0 ? orderDelta : left.localeCompare(right)
        })
        .map((provider) => [provider, this.getProviderAuthState(getAgentProviderAuthConfig(provider))]),
    )
  }

  private getProviderAuthState(config: AgentProviderAuthConfig): AgentProviderAuthState {
    const credential = this.authStorage.get(config.provider)
    const environmentCredentialLabel = this.getEnvironmentCredentialLabel(config)
    const hasEnvironmentCredential = Boolean(environmentCredentialLabel)
    const hasStoredCredential = Boolean(credential)
    const source = hasStoredCredential
      ? 'stored'
      : hasEnvironmentCredential
        ? 'env'
        : 'none'

    return {
      category: config.category,
      environmentCredentialLabel,
      envVarName: config.envVarNames[0] ?? '',
      envVarNames: config.envVarNames,
      hasStoredCredential,
      label: config.label,
      source,
      storedCredentialType: credential?.type ?? null,
      supportsApiKey: config.supportsApiKey,
      supportsOAuth: config.supportsOAuth,
      usesEnvironmentCredential: source === 'env',
    }
  }

  private getEnvironmentCredentialLabel(config: AgentProviderAuthConfig) {
    const envCredential = getEnvApiKey(config.provider)

    if (!envCredential?.trim()) {
      return null
    }

    const foundEnvVarNames = config.envVarNames.filter((envVarName) => Boolean(process.env[envVarName]?.trim()))

    if (config.provider === 'google-vertex' && envCredential === '<authenticated>') {
      return foundEnvVarNames.length > 0
        ? `Google ADC (${foundEnvVarNames.join(', ')})`
        : 'Google ADC'
    }

    if (config.provider === 'amazon-bedrock' && envCredential === '<authenticated>') {
      return foundEnvVarNames.join(', ') || 'AWS credentials'
    }

    if (foundEnvVarNames.length > 0) {
      return foundEnvVarNames.join(', ')
    }

    return config.envVarNames.join(', ') || 'environment'
  }

  private emitSetupDiagnostics(
    session: AgentSession,
    extensionErrors: Array<{ path: string, error: string }>,
    modelFallbackMessage?: string,
  ) {
    if (modelFallbackMessage) {
      this.emitError(modelFallbackMessage, session.sessionId)
    }

    const modelRegistryError = session.modelRegistry.getError()
    if (modelRegistryError) {
      this.emitError(modelRegistryError, session.sessionId)
    }

    const authErrors = this.authStorage.drainErrors()
    for (const error of authErrors) {
      this.emitError(error.message, session.sessionId)
    }

    const settingsErrors = session.settingsManager.drainErrors()
    for (const settingsError of settingsErrors) {
      this.emitError(settingsError.error.message, session.sessionId)
    }

    for (const extensionError of extensionErrors) {
      this.emitError(
        `Failed to load extension "${path.basename(extensionError.path)}": ${extensionError.error}`,
        session.sessionId,
      )
    }
  }

  private requireActiveSession() {
    if (!this.activeRuntime) {
      throw new Error('Open or create an Agent session first.')
    }

    return this.activeRuntime
  }

  private async releaseActiveSession() {
    if (!this.activeRuntime) {
      return
    }

    const runtime = this.activeRuntime
    this.activeRuntime = null

    runtime.unsubscribe()

    if (runtime.session.isStreaming) {
      await runtime.session.abort().catch(() => undefined)
    }

    runtime.session.dispose()
  }

  private emitError(message: string, sessionId: string | null = null) {
    this.emitEvent({
      type: 'error',
      message,
      sessionId,
    })
  }
}

import { createHash } from 'node:crypto'
import { lstat, open as openFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@earendil-works/pi-coding-agent'
import { clampThinkingLevel, complete, getEnvApiKey, getSupportedThinkingLevels, type Api, type AssistantMessage, type Model, type UserMessage } from '@earendil-works/pi-ai'
import type {
  AgentMessageFileChange,
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
} from '../../src/features/agent/types'
import {
  AGENT_PROVIDER_AUTH_CONFIGS,
  getAgentProviderAuthConfig,
  getAgentProviderOrder,
  type AgentProviderAuthConfig,
} from '../../src/features/agent/provider-auth'
import { AgentSessionAnnotationStore } from './agent-session-annotations'
import {
  collectDirectToolPathsByEntryId,
  extractExplicitBashFileChanges,
  extractWritableToolFilePath,
  filterAnnotationsByDirectToolPaths,
  resolveDirectToolFileChangeKind,
} from './agent-file-change-extractor'
import type { AgentProviderAuthLoginCallbacks } from './agent-backends/types'
import { pathExists } from './agent-backends/providers/builtin-pi/file-system'
import {
  getInputsByModel,
  getProviderPreferredModelKeys,
  getThinkingLevelsByModel,
  isPiThinkingLevel as isThinkingLevel,
  loadPiDefaultModelPerProvider,
  PI_THINKING_LEVELS as THINKING_LEVELS,
  selectPiPreferredModel,
} from './agent-backends/providers/builtin-pi/model-selection'
import {
  appendAttachmentText,
  normalizePromptAttachments,
  preparePromptAttachments,
} from './agent-backends/providers/builtin-pi/prompt-attachments'
import {
  buildFallbackSessionTitle,
  clampText,
  getAutoNamingContext,
  normalizeSessionTitle,
  parseEntryTimestamp,
  serializeMessage,
  serializePiWebSessionEntries,
  serializeSessionEntries,
  summarizeToolPayload,
} from './agent-backends/providers/builtin-pi/session-presentation'

export {
  getThinkingLevelsByModel,
  serializePiWebSessionEntries,
  serializeSessionEntries,
}

type ActiveSessionRuntime = {
  activity: {
    pendingAssistantEntryId: string | null
    runningToolCalls: Map<string, {
      existedBeforeWrite: boolean | null
      filePath: string | null
      ownerEntryId: string | null
      parsedFileChanges: AgentMessageFileChange[]
      toolName: string
    }>
  }
  cwd: string
  session: AgentSession
  status: {
    compactionReason: 'manual' | 'overflow' | 'threshold' | null
    retryMaxAttempts: number | null
  }
  unsubscribe: () => void
}

type PiAgentManagerOptions = {
  agentDir: string
}

type LoadAgentWorkspaceStateOptions = {
  restoreSession?: boolean
}

const SESSION_HEADER_READ_CHUNK_BYTES = 4096
const SESSION_HEADER_READ_LIMIT_BYTES = 64 * 1024

function getWorkspacePathIdentity(workspacePath: string) {
  const normalizedPath = path.resolve(workspacePath)
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
}

function areSameWorkspacePath(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(left && right && getWorkspacePathIdentity(left) === getWorkspacePathIdentity(right))
}

export function getArynPiSessionDir(cwd: string, agentDir: string) {
  const workspaceIdentity = getWorkspacePathIdentity(cwd)
  const workspaceName = path.basename(workspaceIdentity) || 'workspace'
  const safeWorkspaceName = workspaceName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/[. ]+$/, '')
    .replace(/^\.+$/, '')
    .trim()
    .slice(0, 48) || 'workspace'
  const workspaceHash = createHash('sha256')
    .update(workspaceIdentity)
    .digest('hex')
    .slice(0, 16)

  return path.join(agentDir, 'sessions', `${safeWorkspaceName}-${workspaceHash}`)
}

function getLegacyArynPiSessionDir(cwd: string, agentDir: string) {
  const workspaceIdentity = getWorkspacePathIdentity(cwd)
  const safePath = `--${workspaceIdentity.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return path.join(agentDir, 'sessions', safePath)
}

type AgentQueuedMessageKind = AgentRunningPromptBehavior
type AgentQueueSnapshot = {
  followUp: string[]
  steering: string[]
}
type NormalizedCreateSessionOptions = {
  modelKey: string | null
  name: string | null
  thinkingLevel: ThinkingLevel | null
}
export function applyAgentQueuedMessageUpdate(
  queue: AgentQueueSnapshot,
  update: AgentQueuedMessageUpdate,
): AgentQueueSnapshot {
  validateAgentQueuedMessageUpdate(update, queue)

  const nextQueue: AgentQueueSnapshot = {
    followUp: [...queue.followUp],
    steering: [...queue.steering],
  }
  const sourceQueue = getAgentQueueMessages(nextQueue, update.kind)
  const [message] = sourceQueue.splice(update.index, 1)

  if (!message) {
    throw new Error('Queued message has already been processed.')
  }

  if (update.action === 'edit') {
    sourceQueue.splice(update.index, 0, update.text.trim())
  } else if (update.action === 'move') {
    getAgentQueueMessages(nextQueue, update.targetKind).push(message)
  }

  return nextQueue
}

function getAgentQueueMessages(queue: AgentQueueSnapshot, kind: AgentQueuedMessageKind) {
  return kind === 'steer' ? queue.steering : queue.followUp
}

function validateAgentQueuedMessageUpdate(update: AgentQueuedMessageUpdate, queue: AgentQueueSnapshot) {
  if (update.kind !== 'steer' && update.kind !== 'followUp') {
    throw new Error('Unknown queued message type.')
  }

  if (update.action !== 'delete' && update.action !== 'edit' && update.action !== 'move') {
    throw new Error('Unknown queued message action.')
  }

  if (!Number.isInteger(update.index) || update.index < 0) {
    throw new Error('Queued message index is invalid.')
  }

  if (!update.expectedText.trim()) {
    throw new Error('Queued message text is empty.')
  }

  if (update.action === 'edit' && !update.text.trim()) {
    throw new Error('Queued message cannot be empty.')
  }

  if (update.action === 'move' && update.targetKind !== 'steer' && update.targetKind !== 'followUp') {
    throw new Error('Unknown queued message target.')
  }

  const messages = getAgentQueueMessages(queue, update.kind)

  if (messages[update.index] !== update.expectedText) {
    throw new Error('Queued message changed before this action completed. Please try again.')
  }
}

const OPENROUTER_ENV_KEY = 'OPENROUTER_API_KEY'
const OPENROUTER_PROVIDER = 'openrouter'
const OPENAI_ENV_KEY = 'OPENAI_API_KEY'
const GOOGLE_ENV_KEY = 'GEMINI_API_KEY'
const AUTO_SESSION_NAME_MODEL_ID = 'openrouter/free'
const AUTO_SESSION_NAME_MAX_TOKENS = 48
const AUTH_SETUP_HINT = `No authenticated models are available. Add a provider credential in Settings > Providers, log in to a subscription provider, or set a supported Pi provider environment variable such as ${OPENROUTER_ENV_KEY}, ${OPENAI_ENV_KEY}, or ${GOOGLE_ENV_KEY}.`
const AUTO_SESSION_NAME_SYSTEM_PROMPT = [
  'You generate short chat session titles.',
  'Reply with title text only.',
  'Use the same language as the user when possible.',
  'Do not use quotes, markdown, labels, prefixes, numbering, or ending punctuation.',
  'Keep it compact and specific.',
].join(' ')
const AUTO_SESSION_NAME_MODEL: Model<Api> = {
  api: 'openai-completions',
  baseUrl: 'https://openrouter.ai/api/v1',
  contextWindow: 200000,
  cost: {
    cacheRead: 0,
    cacheWrite: 0,
    input: 0,
    output: 0,
  },
  id: AUTO_SESSION_NAME_MODEL_ID,
  input: ['text'],
  maxTokens: 256,
  name: 'OpenRouter Free Router',
  provider: OPENROUTER_PROVIDER,
  reasoning: false,
}

export class PiAgentManager {
  private activeRuntime: ActiveSessionRuntime | null = null
  private readonly autoNamingSessions = new Set<string>()
  private readonly annotationStore = new AgentSessionAnnotationStore()
  private readonly authStorage: AuthStorage
  private readonly modelRegistry: ModelRegistry

  constructor(
    private readonly emitEvent: (event: AgentClientEventPayload) => void,
    private readonly options: PiAgentManagerOptions,
  ) {
    this.authStorage = AuthStorage.create(path.join(options.agentDir, 'auth.json'))
    this.modelRegistry = ModelRegistry.create(this.authStorage, path.join(options.agentDir, 'models.json'))
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
      const restorableSessionPath = await this.resolveRestorableSessionPath(cwd, preferredSessionPath)

      if (restorableSessionPath) {
        try {
          await this.activateSession(cwd, this.openSessionManager(cwd, restorableSessionPath))
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
    await Promise.all([
      rm(this.getSessionDir(cwd), { force: true, recursive: true }),
      this.discardMatchingSessionFiles(cwd, this.getLegacyArynAppSessionDir(cwd)),
      rm(this.getLegacySessionDir(cwd), { force: true, recursive: true }),
    ])
  }

  async listSessionItems(cwd: string): Promise<AgentSessionListItem[]> {
    return this.listSessions(cwd)
  }

  async readSession(cwd: string, sessionPath: string): Promise<AgentSessionSnapshot> {
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
    const sessionManager = this.openSessionManager(cwd, resolvedSessionPath)

    return this.serializeSessionManager(cwd, sessionManager)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions): Promise<AgentWorkspaceState> {
    const createOptions = this.normalizeCreateSessionOptions(options)
    const session = await this.activateSession(cwd, SessionManager.create(cwd, this.getSessionDir(cwd)))

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
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
    const runtime = this.activeRuntime

    if (
      runtime
      && areSameWorkspacePath(runtime.cwd, cwd)
      && runtime.session.sessionFile === resolvedSessionPath
    ) {
      return this.buildWorkspaceState(cwd)
    }

    await this.activateSession(cwd, this.openSessionManager(cwd, resolvedSessionPath))
    return this.broadcastWorkspaceState(cwd)
  }

  async deleteSession(
    cwd: string,
    sessionPath: string,
    options: { restoreFallback?: boolean } = {},
  ): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
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
      const remainingSessions = await this.listSessions(cwd)

      if (remainingSessions.length > 0) {
        await this.activateSession(cwd, this.openSessionManager(cwd, remainingSessions[0].path))
      }
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async renameSession(cwd: string, sessionPath: string, name: string) {
    const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
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
      const sessionManager = this.openSessionManager(cwd, resolvedSessionPath)
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
        await this.listSessions(runtime.cwd),
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
      const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, sessionPath)
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
    void this.releaseActiveSession()
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
      sessionDir: this.getSessionDir(cwd),
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

  private getAutoNamingModels(session: AgentSession) {
    const models: Model<Api>[] = []
    const preferredNamingModel = session.modelRegistry.find(OPENROUTER_PROVIDER, AUTO_SESSION_NAME_MODEL_ID) ?? AUTO_SESSION_NAME_MODEL

    if (
      session.model
      && session.modelRegistry.hasConfiguredAuth(session.model)
      && !models.some((model) => model.provider === session.model?.provider && model.id === session.model?.id)
    ) {
      models.push(session.model)
    }

    if (
      session.modelRegistry.hasConfiguredAuth(preferredNamingModel)
      && !models.some((model) => model.provider === preferredNamingModel.provider && model.id === preferredNamingModel.id)
    ) {
      models.push(preferredNamingModel)
    }

    return models
  }

  private async generateSessionNameWithModel(session: AgentSession, model: Model<Api>, sourceText: string) {
    const auth = await session.modelRegistry.getApiKeyAndHeaders(model)

    if (!auth.ok) {
      return null
    }

    const response = await complete(
      model,
      {
        messages: [
          {
            content: [{ type: 'text', text: sourceText }],
            role: 'user',
            timestamp: Date.now(),
          } satisfies UserMessage,
        ],
        systemPrompt: AUTO_SESSION_NAME_SYSTEM_PROMPT,
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: AUTO_SESSION_NAME_MAX_TOKENS,
      },
    )

    if (response.stopReason === 'aborted' || response.stopReason === 'error') {
      return null
    }

    const text = response.content
      .filter((block): block is Extract<AssistantMessage['content'][number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    return normalizeSessionTitle(text)
  }

  private async generateSessionName(session: AgentSession, context: NonNullable<ReturnType<typeof getAutoNamingContext>>) {
    const namingSource = [
      `First user message:\n${context.firstUserText}`,
      context.firstAssistantText ? `\nFirst assistant reply:\n${context.firstAssistantText}` : '',
    ]
      .join('\n')
      .trim()

    for (const model of this.getAutoNamingModels(session)) {
      try {
        const title = await this.generateSessionNameWithModel(session, model, namingSource)

        if (title) {
          return title
        }
      } catch {
        // Fall through to the next model or the local fallback.
      }
    }

    return buildFallbackSessionTitle(context.firstUserText)
  }

  private async maybeAutoNameSession(session: AgentSession) {
    if (session.sessionName?.trim() || this.autoNamingSessions.has(session.sessionId)) {
      return
    }

    const namingContext = getAutoNamingContext(session.sessionManager.getBranch())

    if (!namingContext || namingContext.userMessageCount !== 1) {
      return
    }

    this.autoNamingSessions.add(session.sessionId)

    try {
      const title = await this.generateSessionName(session, namingContext)

      if (!title || session.sessionName?.trim()) {
        return
      }

      session.setSessionName(title)

      if (this.activeRuntime?.session === session) {
        await this.broadcastWorkspaceState(this.activeRuntime.cwd)
      }
    } finally {
      this.autoNamingSessions.delete(session.sessionId)
    }
  }

  private async handleSessionEvent(session: AgentSession, event: AgentSessionEvent) {
    if (!this.activeRuntime || this.activeRuntime.session !== session) {
      return
    }

    const runtime = this.activeRuntime

    this.emitEvent({
      type: 'pi_native_event',
      event: event as unknown as { type: string; [key: string]: unknown },
      sessionId: session.sessionId,
    })

    if (event.type === 'compaction_start') {
      runtime.status.compactionReason = event.reason
    }

    if (event.type === 'compaction_end') {
      runtime.status.compactionReason = null
    }

    if (event.type === 'auto_retry_start') {
      runtime.status.retryMaxAttempts = event.maxAttempts
    }

    if (event.type === 'auto_retry_end') {
      runtime.status.retryMaxAttempts = null
    }

    if (event.type === 'message_start' && 'role' in event.message && event.message.role === 'assistant') {
      runtime.activity.pendingAssistantEntryId = null
      this.emitEvent({
        type: 'assistant_message_started',
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      this.emitEvent({
        type: 'assistant_message_delta',
        delta: event.assistantMessageEvent.delta,
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
      this.emitEvent({
        type: 'assistant_thinking_delta',
        delta: event.assistantMessageEvent.delta,
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_end') {
      this.emitEvent({
        type: 'assistant_thinking_finished',
        sessionId: session.sessionId,
      })
      return
    }

    if (event.type === 'tool_execution_start') {
      const ownerEntryId = this.findLatestAssistantEntryId(session) ?? runtime.activity.pendingAssistantEntryId

      const directFilePath = extractWritableToolFilePath(runtime.cwd, event.toolName, event.args)
      const existedBeforeWrite = event.toolName === 'write' && directFilePath
        ? await pathExists(directFilePath)
        : null

      runtime.activity.runningToolCalls.set(event.toolCallId, {
        existedBeforeWrite,
        filePath: directFilePath,
        ownerEntryId,
        parsedFileChanges: event.toolName === 'bash' ? extractExplicitBashFileChanges(runtime.cwd, event.args) : [],
        toolName: event.toolName,
      })
      this.emitEvent({
        type: 'tool_execution_started',
        sessionId: session.sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        summary: summarizeToolPayload(event.args, 240, 'Running tool...'),
      })
      return
    }

    if (event.type === 'tool_execution_update') {
      this.emitEvent({
        type: 'tool_execution_updated',
        sessionId: session.sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        summary: summarizeToolPayload(
          event.partialResult?.content ?? event.partialResult?.details ?? event.partialResult,
          320,
          `${event.toolName} is running...`,
        ),
      })
      return
    }

    if (event.type === 'tool_execution_end') {
      const finishedTool = runtime.activity.runningToolCalls.get(event.toolCallId) ?? null
      runtime.activity.runningToolCalls.delete(event.toolCallId)

      if (
        finishedTool
        && !event.isError
        && runtime.session.sessionFile
        && finishedTool.ownerEntryId
      ) {
        const nextFileChanges = [...finishedTool.parsedFileChanges]

        if (finishedTool.filePath) {
          const directChangeKind = resolveDirectToolFileChangeKind(
            finishedTool.toolName,
            finishedTool.existedBeforeWrite,
          )

          if (directChangeKind) {
            nextFileChanges.push({
              filePath: finishedTool.filePath,
              kind: directChangeKind,
            })
          }
        }

        let nextAnnotations = null

        for (const change of nextFileChanges) {
          nextAnnotations = await this.annotationStore.recordFileChange(
            runtime.session.sessionFile,
            finishedTool.ownerEntryId,
            change,
          )
        }

        if (nextAnnotations) {
          this.emitEvent({
            type: 'session_annotations_updated',
            sessionId: runtime.session.sessionId,
            annotations: nextAnnotations,
          })
        }
      }

      this.emitEvent({
        type: 'tool_execution_finished',
        sessionId: session.sessionId,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        summary: summarizeToolPayload(
          event.result?.content ?? event.result?.details ?? event.result,
          320,
          `${event.toolName} finished.`,
        ),
        isError: event.isError,
      })
      return
    }

    if (event.type === 'message_end' && 'role' in event.message && event.message.role === 'assistant') {
      runtime.activity.pendingAssistantEntryId = this.findEntryIdForMessage(session, event.message)
    }

    if (
      event.type === 'compaction_start'
      || event.type === 'compaction_end'
      || event.type === 'auto_retry_start'
      || event.type === 'auto_retry_end'
      || event.type === 'agent_start'
      || event.type === 'turn_start'
      || event.type === 'turn_end'
      || event.type === 'thinking_level_changed'
    ) {
      await this.broadcastWorkspaceState(runtime.cwd)

      if (event.type === 'turn_end') {
        void this.maybeAutoNameSession(session)
      }

      return
    }

    if (event.type === 'message_end' || event.type === 'agent_end') {
      await this.broadcastWorkspaceState(runtime.cwd)
    }
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
    const sessions = await this.listSessions(cwd)
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

  private async listSessions(cwd: string): Promise<AgentSessionListItem[]> {
    const sessions = (
      await Promise.all(this.getReadableSessionDirs(cwd).map((sessionDir) => (
        SessionManager.list(cwd, sessionDir)
      )))
    )
      .flat()
      .filter((session) => !session.cwd || areSameWorkspacePath(session.cwd, cwd))

    return sessions
      .slice()
      .filter((session) => session.messageCount > 0)
      .sort((left, right) => right.modified.getTime() - left.modified.getTime())
      .map((session) => ({
        createdAt: session.created.toISOString(),
        id: session.id,
        messageCount: session.messageCount,
        modifiedAt: session.modified.toISOString(),
        name: session.name ?? null,
        path: session.path,
        preview: clampText(session.name || session.firstMessage || 'New session', 72),
      }))
  }

  private async discardMatchingSessionFiles(cwd: string, sessionDir: string) {
    const sessions = await SessionManager.list(cwd, sessionDir)

    await Promise.all(sessions.map(async (session) => {
      const sessionCwd = await this.readSessionFileCwd(session.path)

      if (!sessionCwd || !areSameWorkspacePath(sessionCwd, cwd)) {
        return
      }

      await rm(session.path, { force: true })
      await this.annotationStore.delete(session.path)
    }))
  }

  private async resolveRestorableSessionPath(cwd: string, preferredSessionPath: string | null) {
    if (preferredSessionPath) {
      try {
        const resolvedSessionPath = await this.resolveSessionFileForCwd(cwd, preferredSessionPath)
        return await pathExists(resolvedSessionPath) ? resolvedSessionPath : null
      } catch {
        return null
      }
    }

    const sessions = await this.listSessions(cwd)
    return sessions[0]?.path ?? null
  }

  private getSessionDir(cwd: string) {
    return getArynPiSessionDir(cwd, this.options.agentDir)
  }

  private getLegacyArynAppSessionDir(cwd: string) {
    return getLegacyArynPiSessionDir(cwd, this.options.agentDir)
  }

  private getLegacySessionDir(cwd: string) {
    return path.join(cwd, '.pi', 'sessions')
  }

  private getReadableSessionDirs(cwd: string) {
    const primarySessionDir = this.getSessionDir(cwd)
    const legacyAppSessionDir = this.getLegacyArynAppSessionDir(cwd)
    const legacyWorkspaceSessionDir = this.getLegacySessionDir(cwd)

    return [primarySessionDir, legacyAppSessionDir, legacyWorkspaceSessionDir]
      .filter((sessionDir, index, sessionDirs) => (
        sessionDirs.findIndex((candidate) => areSameWorkspacePath(candidate, sessionDir)) === index
      ))
  }

  private openSessionManager(cwd: string, sessionPath: string) {
    return SessionManager.open(sessionPath, this.getSessionDirForPath(cwd, sessionPath), cwd)
  }

  private getSessionDirForPath(cwd: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)
    const matchingSessionDir = this.getReadableSessionDirs(cwd)
      .map((sessionDir) => path.resolve(sessionDir))
      .find((sessionDir) => this.isPathInsideSessionDir(sessionDir, resolvedSessionPath))

    if (!matchingSessionDir) {
      throw new Error('Invalid session path.')
    }

    return matchingSessionDir
  }

  private async resolveSessionFileForCwd(cwd: string, sessionPath: string) {
    const resolvedSessionPath = this.resolveSessionPath(cwd, sessionPath)
    const sessionCwd = await this.readSessionFileCwd(resolvedSessionPath)

    if (!sessionCwd || !areSameWorkspacePath(sessionCwd, cwd)) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
  }

  private resolveSessionPath(cwd: string, sessionPath: string) {
    const resolvedSessionPath = path.resolve(sessionPath)

    if (
      path.extname(resolvedSessionPath).toLowerCase() !== '.jsonl'
      || !this.getReadableSessionDirs(cwd)
        .map((sessionDir) => path.resolve(sessionDir))
        .some((sessionDir) => this.isPathInsideSessionDir(sessionDir, resolvedSessionPath))
    ) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
  }

  private readSessionHeaderCwd(firstLine: string) {
    const line = firstLine.trim()

    if (!line) {
      return null
    }

    try {
      const header = JSON.parse(line) as { cwd?: unknown; type?: unknown }
      return header.type === 'session' && typeof header.cwd === 'string' && header.cwd.trim()
        ? header.cwd
        : null
    } catch {
      return null
    }
  }

  private async readSessionFileCwd(sessionPath: string) {
    let file: Awaited<ReturnType<typeof openFile>> | null = null

    try {
      file = await openFile(sessionPath, 'r')
      const chunks: string[] = []
      const buffer = Buffer.alloc(SESSION_HEADER_READ_CHUNK_BYTES)
      let position = 0

      while (position < SESSION_HEADER_READ_LIMIT_BYTES) {
        const bytesToRead = Math.min(buffer.length, SESSION_HEADER_READ_LIMIT_BYTES - position)
        const { bytesRead } = await file.read(buffer, 0, bytesToRead, position)

        if (bytesRead === 0) {
          break
        }

        chunks.push(buffer.toString('utf8', 0, bytesRead))
        const content = chunks.join('')
        const newlineMatch = content.match(/\r?\n/)

        if (newlineMatch?.index !== undefined) {
          return this.readSessionHeaderCwd(content.slice(0, newlineMatch.index))
        }

        position += bytesRead
      }

      return this.readSessionHeaderCwd(chunks.join(''))
    } catch {
      return null
    } finally {
      await file?.close().catch(() => undefined)
    }
  }

  private isPathInsideSessionDir(sessionDir: string, sessionPath: string) {
    const relativeSessionPath = path.relative(sessionDir, sessionPath)

    return Boolean(relativeSessionPath)
      && !relativeSessionPath.startsWith('..')
      && !path.isAbsolute(relativeSessionPath)
  }

  private findEntryIdForMessage(session: AgentSession, message: AgentMessage) {
    if (!('role' in message) || typeof message.timestamp !== 'number') {
      return null
    }

    const branchEntries = session.sessionManager.getBranch()

    for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
      const entry = branchEntries[index]

      if (entry.type !== 'message' || !('role' in entry.message)) {
        continue
      }

      if (entry.message.role === message.role && entry.message.timestamp === message.timestamp) {
        return entry.id
      }
    }

    return null
  }

  private findLatestAssistantEntryId(session: AgentSession) {
    const branchEntries = session.sessionManager.getBranch()

    for (let index = branchEntries.length - 1; index >= 0; index -= 1) {
      const entry = branchEntries[index]

      if (entry.type === 'message' && 'role' in entry.message && entry.message.role === 'assistant') {
        return entry.id
      }
    }

    return null
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

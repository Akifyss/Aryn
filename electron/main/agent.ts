import { lstat, rm } from 'node:fs/promises'
import path from 'node:path'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AgentSessionEvent } from '@mariozechner/pi-coding-agent'
import {
  AuthStorage,
  createAgentSession,
  createCodingTools,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from '@mariozechner/pi-coding-agent'
import type { AssistantMessage, TextContent, ToolResultMessage, UserMessage } from '@mariozechner/pi-ai'
import type {
  AgentClientEvent,
  AgentProviderAuthState,
  AgentRuntimeState,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentWorkspaceState,
} from '../../src/features/agent/types'

type ActiveSessionRuntime = {
  cwd: string
  session: AgentSession
  unsubscribe: () => void
}

type PiAgentManagerOptions = {
  agentDir: string
}

const OPENROUTER_ENV_KEY = 'OPENROUTER_API_KEY'
const OPENROUTER_PROVIDER = 'openrouter'
const OPENAI_ENV_KEY = 'OPENAI_API_KEY'
const OPENAI_PROVIDER = 'openai'
const GOOGLE_ENV_KEY = 'GEMINI_API_KEY'
const GOOGLE_PROVIDER = 'google'
const DEFAULT_MODEL_ID = 'google/gemini-3.1-flash-lite-preview'
const AUTH_SETUP_HINT = `No authenticated models are available. Add an API key in Agent Auth or set ${OPENROUTER_ENV_KEY}, ${OPENAI_ENV_KEY}, or ${GOOGLE_ENV_KEY}.`

function asText(value: string | Array<TextContent | { type: 'image' }>) {
  if (typeof value === 'string') {
    return value.trim()
  }

  return value
    .map((block) => {
      if (block.type === 'text') {
        return block.text
      }

      return '[Image attachment]'
    })
    .join('\n')
    .trim()
}

function clampText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1)}...`
}

function stringifyForDisplay(value: unknown) {
  if (value == null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function summarizeToolPayload(value: unknown, maxLength: number, fallback: string) {
  const summary = clampText(stringifyForDisplay(value), maxLength)
  return summary || fallback
}

function serializeAssistantMessage(message: AssistantMessage, index: number): AgentSidebarMessage | null {
  const text = message.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim()

  const toolCalls = message.content
    .filter((block) => block.type === 'toolCall')
    .map((block) => block.name)

  if (!text && toolCalls.length > 0 && !message.errorMessage) {
    return null
  }

  const fallbackText = message.errorMessage ?? 'Assistant response'

  return {
    id: `assistant-${message.timestamp}-${index}`,
    kind: 'assistant',
    text: text || fallbackText,
    timestamp: message.timestamp,
    isError: message.stopReason === 'error',
  }
}

function serializeUserMessage(message: UserMessage, index: number): AgentSidebarMessage {
  return {
    id: `user-${message.timestamp}-${index}`,
    kind: 'user',
    text: asText(message.content) || 'User message',
    timestamp: message.timestamp,
  }
}

function serializeToolResult(message: ToolResultMessage, index: number): AgentSidebarMessage {
  const text = asText(message.content) || stringifyForDisplay(message.details) || 'Tool finished without output.'

  return {
    id: message.toolCallId || `tool-${message.timestamp}-${index}`,
    kind: 'tool',
    status: message.isError ? 'error' : 'done',
    title: message.toolName,
    text,
    timestamp: message.timestamp,
    isError: message.isError,
  }
}

function serializeCustomMessage(message: Extract<AgentMessage, { role: 'bashExecution' | 'branchSummary' | 'compactionSummary' | 'custom' }>, index: number): AgentSidebarMessage | null {
  if (message.role === 'custom' && !message.display) {
    return null
  }

  if (message.role === 'bashExecution') {
    const output = message.output.trim() || 'Command completed without output.'
    return {
      id: `bash-${message.timestamp}-${index}`,
      kind: 'system',
      title: message.command,
      text: output,
      timestamp: message.timestamp,
      isError: typeof message.exitCode === 'number' ? message.exitCode !== 0 : false,
    }
  }

  if (message.role === 'branchSummary') {
    return {
      id: `branch-summary-${message.timestamp}-${index}`,
      kind: 'system',
      title: 'Branch summary',
      text: message.summary,
      timestamp: message.timestamp,
    }
  }

  if (message.role === 'compactionSummary') {
    return {
      id: `compaction-summary-${message.timestamp}-${index}`,
      kind: 'system',
      title: 'Context summary',
      text: message.summary,
      timestamp: message.timestamp,
    }
  }

  return {
    id: `custom-${message.timestamp}-${index}`,
    kind: 'system',
    title: message.customType,
    text: asText(message.content) || message.customType,
    timestamp: message.timestamp,
  }
}

function serializeMessage(message: AgentMessage, index: number): AgentSidebarMessage | null {
  if ('role' in message && message.role === 'user') {
    return serializeUserMessage(message, index)
  }

  if ('role' in message && message.role === 'assistant') {
    return serializeAssistantMessage(message, index)
  }

  if ('role' in message && message.role === 'toolResult') {
    return serializeToolResult(message, index)
  }

  if (
    'role' in message
    && (
      message.role === 'bashExecution'
      || message.role === 'branchSummary'
      || message.role === 'compactionSummary'
      || message.role === 'custom'
    )
  ) {
    return serializeCustomMessage(message, index)
  }

  return null
}

export class PiAgentManager {
  private activeRuntime: ActiveSessionRuntime | null = null
  private readonly authStorage: AuthStorage
  private readonly modelRegistry: ModelRegistry

  constructor(
    private readonly emitEvent: (event: AgentClientEvent) => void,
    private readonly options: PiAgentManagerOptions,
  ) {
    this.authStorage = AuthStorage.create(path.join(options.agentDir, 'auth.json'))
    this.modelRegistry = new ModelRegistry(this.authStorage, path.join(options.agentDir, 'models.json'))
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null = null): Promise<AgentWorkspaceState> {
    if (this.activeRuntime?.cwd !== cwd) {
      await this.releaseActiveSession()
    }

    if (!this.activeRuntime) {
      const nextSessionManager = preferredSessionPath
        ? SessionManager.open(preferredSessionPath)
        : SessionManager.continueRecent(cwd, this.getSessionDir(cwd))

      try {
        await this.activateSession(cwd, nextSessionManager)
      } catch {
        return this.buildWorkspaceState(cwd)
      }
    }

    return this.buildWorkspaceState(cwd)
  }

  async createSession(cwd: string, name?: string): Promise<AgentWorkspaceState> {
    const session = await this.activateSession(cwd, SessionManager.create(cwd, this.getSessionDir(cwd)))

    if (name?.trim()) {
      session.setSessionName(name.trim())
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async openSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState> {
    await this.activateSession(cwd, SessionManager.open(sessionPath))
    return this.broadcastWorkspaceState(cwd)
  }

  async deleteSession(cwd: string, sessionPath: string): Promise<AgentWorkspaceState> {
    const resolvedSessionPath = this.resolveSessionPath(cwd, sessionPath)
    const isDeletingActiveSession = this.activeRuntime?.cwd === cwd
      && this.activeRuntime.session.sessionFile === resolvedSessionPath

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

    if (isDeletingActiveSession) {
      const remainingSessions = await this.listSessions(cwd)

      if (remainingSessions.length > 0) {
        await this.activateSession(cwd, SessionManager.open(remainingSessions[0].path))
      }
    }

    return this.broadcastWorkspaceState(cwd)
  }

  async renameActiveSession(name: string) {
    const runtime = this.requireActiveSession()
    runtime.session.setSessionName(name.trim())
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async abortActivePrompt() {
    const runtime = this.requireActiveSession()
    await runtime.session.abort()
    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async selectModel(modelKey: string) {
    const runtime = this.requireActiveSession()
    this.authStorage.reload()
    runtime.session.modelRegistry.refresh()

    const trimmedModelKey = modelKey.trim()
    const availableModels = runtime.session.modelRegistry.getAvailable()
    const selectedModel = availableModels.find((model) => `${model.provider}/${model.id}` === trimmedModelKey)
      ?? availableModels.find((model) => `${model.provider}/${model.id}` === `${OPENROUTER_PROVIDER}/${trimmedModelKey}`)
      ?? availableModels.find((model) => model.provider === OPENROUTER_PROVIDER && model.id === trimmedModelKey)

    if (!selectedModel) {
      throw new Error(`Model "${modelKey}" is not available.`)
    }

    await runtime.session.setModel(selectedModel)
    runtime.session.settingsManager.setDefaultModelAndProvider(selectedModel.provider, selectedModel.id)
    await runtime.session.settingsManager.flush()

    const settingsErrors = runtime.session.settingsManager.drainErrors()
    if (settingsErrors.length > 0) {
      const firstError = settingsErrors[0]
      this.emitError(firstError.error.message, runtime.session.sessionId)
    }

    return this.broadcastWorkspaceState(runtime.cwd)
  }

  async updateProviderAuth(cwd: string, provider: string, apiKey: string | null) {
    this.authStorage.reload()

    const trimmedApiKey = apiKey?.trim()
    if (trimmedApiKey) {
      this.authStorage.set(provider, {
        type: 'api_key',
        key: trimmedApiKey,
      })
    } else {
      this.authStorage.remove(provider)
    }

    this.modelRegistry.refresh()

    if (this.activeRuntime?.cwd === cwd) {
      this.activeRuntime.session.modelRegistry.refresh()
      if (this.activeRuntime.session.model && !this.activeRuntime.session.modelRegistry.hasConfiguredAuth(this.activeRuntime.session.model)) {
        this.emitError(AUTH_SETUP_HINT, this.activeRuntime.session.sessionId)
      } else if (!this.activeRuntime.session.model) {
        await this.ensureModelSelected(this.activeRuntime.session)
      }

      return this.broadcastWorkspaceState(cwd)
    }

    return this.buildWorkspaceState(cwd)
  }

  async sendPrompt(prompt: string) {
    const runtime = this.requireActiveSession()
    const message = prompt.trim()

    if (!message) {
      throw new Error('Prompt cannot be empty.')
    }

    if (!runtime.session.model || !runtime.session.modelRegistry.hasConfiguredAuth(runtime.session.model)) {
      throw new Error(AUTH_SETUP_HINT)
    }

    const pendingPrompt = runtime.session.prompt(message)
    this.emitEvent({
      type: 'workspace_state',
      state: this.serializeWorkspaceState(
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
      tools: createCodingTools(cwd),
    })

    await this.ensureModelSelected(session)
    this.emitSetupDiagnostics(session, extensionsResult.errors, modelFallbackMessage)

    const unsubscribe = session.subscribe((event) => {
      void this.handleSessionEvent(session, event)
    })

    this.activeRuntime = {
      cwd,
      session,
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

  private async ensureModelSelected(session: AgentSession) {
    if (session.model) {
      return
    }

    const availableModels = session.modelRegistry.getAvailable()

    if (availableModels.length === 0) {
      return
    }

    const preferredProvider = session.settingsManager.getDefaultProvider() ?? OPENROUTER_PROVIDER
    const preferredModel = session.settingsManager.getDefaultModel() ?? DEFAULT_MODEL_ID
    const preferredSelection = preferredProvider && preferredModel
      ? availableModels.find((model) => model.provider === preferredProvider && model.id === preferredModel)
      : null

    await session.setModel(preferredSelection ?? availableModels[0])
  }

  private async handleSessionEvent(session: AgentSession, event: AgentSessionEvent) {
    if (!this.activeRuntime || this.activeRuntime.session !== session) {
      return
    }

    if (event.type === 'message_start' && 'role' in event.message && event.message.role === 'assistant') {
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

    if (event.type === 'tool_execution_start') {
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

    if (event.type === 'message_end' || event.type === 'agent_end') {
      await this.broadcastWorkspaceState(this.activeRuntime.cwd)
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
    return this.serializeWorkspaceState(cwd, sessions, this.activeRuntime?.cwd === cwd ? this.activeRuntime.session : null)
  }

  private serializeWorkspaceState(cwd: string, sessions: AgentSessionListItem[], session: AgentSession | null): AgentWorkspaceState {
    return {
      activeSession: session ? this.serializeSession(session) : null,
      runtime: this.serializeRuntime(cwd, session),
      sessions,
    }
  }

  private serializeRuntime(cwd: string, session: AgentSession | null): AgentRuntimeState {
    const availableModels = (session?.modelRegistry ?? this.modelRegistry).getAvailable()
    const selectedModel = session?.model ? `${session.model.provider}/${session.model.id}` : null

    return {
      auth: {
        google: this.getProviderAuthState(GOOGLE_PROVIDER, GOOGLE_ENV_KEY),
        openai: this.getProviderAuthState(OPENAI_PROVIDER, OPENAI_ENV_KEY),
        openrouter: this.getOpenRouterAuthState(),
      },
      availableModels: availableModels.map((model) => `${model.provider}/${model.id}`),
      hasConfiguredModels: availableModels.length > 0,
      isStreaming: session?.isStreaming ?? false,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : AUTH_SETUP_HINT,
      workspacePath: cwd,
    }
  }

  private serializeSession(session: AgentSession): AgentSessionSnapshot {
    const messages = session.messages
      .map((message, index) => serializeMessage(message, index))
      .filter((message): message is AgentSidebarMessage => message !== null)

    return {
      messages,
      name: session.sessionName ?? null,
      sessionId: session.sessionId,
      sessionPath: session.sessionFile ?? null,
      workspacePath: this.activeRuntime?.cwd ?? '',
    }
  }

  private async listSessions(cwd: string): Promise<AgentSessionListItem[]> {
    const sessions = await SessionManager.list(cwd, this.getSessionDir(cwd))

    return sessions
      .slice()
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

  private getSessionDir(cwd: string) {
    return path.join(cwd, '.pi', 'sessions')
  }

  private resolveSessionPath(cwd: string, sessionPath: string) {
    const resolvedSessionDir = path.resolve(this.getSessionDir(cwd))
    const resolvedSessionPath = path.resolve(sessionPath)
    const relativeSessionPath = path.relative(resolvedSessionDir, resolvedSessionPath)

    if (
      relativeSessionPath.startsWith('..')
      || path.isAbsolute(relativeSessionPath)
      || path.extname(resolvedSessionPath).toLowerCase() !== '.jsonl'
    ) {
      throw new Error('Invalid session path.')
    }

    return resolvedSessionPath
  }

  private getOpenRouterAuthState(): AgentProviderAuthState {
    return this.getProviderAuthState(OPENROUTER_PROVIDER, OPENROUTER_ENV_KEY)
  }

  private getProviderAuthState(provider: string, envVarName: string): AgentProviderAuthState {
    const hasEnvironmentCredential = Boolean(process.env[envVarName]?.trim())
    const hasStoredCredential = this.authStorage.has(provider)
    const source = hasStoredCredential
      ? 'stored'
      : hasEnvironmentCredential
        ? 'env'
        : 'none'

    return {
      envVarName,
      hasStoredCredential,
      source,
      usesEnvironmentCredential: source === 'env',
    }
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

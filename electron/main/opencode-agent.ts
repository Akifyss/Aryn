import { randomBytes } from 'node:crypto'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import spawn from 'cross-spawn'
import {
  createOpencodeClient,
  type Event as OpenCodeEvent,
  type GlobalEvent as OpenCodeGlobalEvent,
  type Message,
  type OpencodeClient,
  type Part,
  type PermissionRequest,
  type Provider,
  type QuestionRequest,
  type Session,
  type SnapshotFileDiff,
  type SessionStatus,
  type Todo,
} from '@opencode-ai/sdk/v2'
import { getAgentInteractionKey } from '../../src/features/agent/types'
import {
  formatOpenCodeVersionCompatibilityError,
  isCompatibleOpenCodeVersion,
} from '../../src/features/agent/lib/opencode-version'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentRunningPromptBehavior,
  AgentSessionExecutionState,
  AgentSessionCreateOptions,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentWorkspaceState,
  OpenCodeSurfaceRequest,
  OpenCodeSurfaceResponse,
} from '../../src/features/agent/types'
import {
  isOpenCodeMessageId,
  isOpenCodePartId,
} from '../../src/features/agent/lib/opencode-message-id'
import {
  createExternalCliEnvironment,
  prepareExternalCliEnvironment,
  resolveExternalCliCommand,
} from './external-cli-environment'
import { AtomicJsonStore } from './json-file-store'
import { terminateChildProcessTree } from './child-process-lifecycle'
import {
  getOpenCodeEventSessionId,
  OpenCodeSessionMessageReducer,
} from './opencode-session-reducer'

type OpenCodeServer = {
  close: () => void
  onExit?: (listener: (error: Error) => void) => () => void
  url: string
}
type JsonRecord = Record<string, unknown>

type SessionBinding = {
  cwd: string
  executionState: AgentSessionExecutionState
  isStreaming: boolean
  lastAssistantMessageId: string | null
  parentSessionId: string | null
  rootSessionId: string
  selectedModel: string | null
  thinkingLevel: AgentThinkingLevel
  title: string | null
}

type OpenCodeSessionRecord = {
  createdAt: string
  cwd: string
  id: string
  modelKey: string | null
  thinkingLevel: AgentThinkingLevel
}

type OpenCodeSessionIndex = {
  sessions: OpenCodeSessionRecord[]
  version: 1
}

type PendingOpenCodeInteraction = {
  cwd: string
  kind: 'permission' | 'question'
  ownerSessionId: string
  protocol: 'classic' | 'v2'
  questionIds?: string[]
  requestId: string
  sessionId: string
}

type OpenCodeAgentManagerOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEventPayload) => void
  startServer?: (options: OpenCodeServerLaunchOptions) => Promise<OpenCodeServer>
}

type OpenCodeServerLaunchOptions = {
  command: string
  environment: NodeJS.ProcessEnv
  hostname: string
  port: number
  timeout: number
}

const DEFAULT_THINKING_LEVEL: AgentThinkingLevel = 'medium'
const DEFAULT_SESSION_INDEX: OpenCodeSessionIndex = { sessions: [], version: 1 }
const OPEN_CODE_START_TIMEOUT_MS = 15_000
const OPEN_CODE_SNAPSHOT_COALESCE_MS = 16
const OPEN_CODE_EVENT_RECONNECT_MAX_MS = 3_000
const OPEN_CODE_EVENT_RECONNECT_MIN_MS = 250
const ARYN_SESSION_METADATA_KEY = 'aryn'

function waitForAbortableDelay(delay: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, delay)
    signal.addEventListener('abort', finish, { once: true })
  })
}

async function launchOpenCodeServer(options: OpenCodeServerLaunchOptions): Promise<OpenCodeServer> {
  const child = spawn(options.command, [
    'serve',
    `--hostname=${options.hostname}`,
    `--port=${options.port}`,
  ], {
    env: options.environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const exitListeners = new Set<(error: Error) => void>()
    const finishWithError = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      terminateChildProcessTree(child)
      reject(error)
    }
    const timeout = setTimeout(() => {
      finishWithError(new Error(`Timeout waiting for OpenCode server to start after ${options.timeout}ms.`))
    }, options.timeout)

    child.stdout.on('data', (chunk: string) => {
      if (settled) return
      output = `${output}${chunk}`.slice(-64 * 1024)
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith('opencode server listening')) continue
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (!match) {
          finishWithError(new Error(`Failed to parse OpenCode server URL from output: ${line}`))
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve({
          close: () => terminateChildProcessTree(child),
          onExit: (listener) => {
            exitListeners.add(listener)
            return () => exitListeners.delete(listener)
          },
          url: match[1],
        })
        return
      }
    })
    child.stderr.on('data', (chunk: string) => {
      if (!settled) output = `${output}${chunk}`.slice(-64 * 1024)
    })
    child.once('error', (error) => finishWithError(error))
    child.once('exit', (code) => {
      const error = new Error(
        `OpenCode server (${options.command}) exited with code ${code ?? 'unknown'}${output.trim() ? `\nServer output: ${output.trim()}` : ''}`,
      )
      finishWithError(error)
      for (const listener of exitListeners) listener(error)
      exitListeners.clear()
    })
  })
}

function workspaceIdentity(cwd: string) {
  const resolvedPath = path.resolve(cwd)
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath
}

function unwrapSdkResult<T>(result: T | { data?: T, error?: unknown }, action: string): T {
  if (result && typeof result === 'object' && 'error' in result && result.error) {
    const error = result.error
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : JSON.stringify(error)
    throw new Error(`OpenCode ${action} failed: ${message}`)
  }

  if (result && typeof result === 'object' && 'data' in result) {
    const data = result.data
    if (data === undefined) {
      throw new Error(`OpenCode ${action} returned no data.`)
    }
    return data as T
  }

  return result as T
}

function parseModelKey(modelKey: string | null | undefined) {
  const normalizedKey = modelKey?.trim() ?? ''
  const separatorIndex = normalizedKey.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === normalizedKey.length - 1) {
    return null
  }

  return {
    modelID: normalizedKey.slice(separatorIndex + 1),
    providerID: normalizedKey.slice(0, separatorIndex),
  }
}

function mapThinkingVariant(level: AgentThinkingLevel) {
  return level === 'off' ? undefined : level
}

function supportedThinkingLevels(provider: Provider, modelID: string): AgentThinkingLevel[] {
  const model = provider.models[modelID]
  if (!model?.capabilities.reasoning) {
    return ['off']
  }

  const variantNames = Object.keys(model.variants ?? {})
  const knownLevels = (['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as AgentThinkingLevel[])
    .filter((level) => variantNames.some((variant) => variant.toLowerCase() === level))

  return knownLevels.length > 0 ? knownLevels : ['low', 'medium', 'high']
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object' && 'message' in error.data) {
      return String(error.data.message)
    }
    if ('message' in error) {
      return String(error.message)
    }
  }
  return String(error)
}

function normalizeNullableText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeExecutionState(value: unknown): AgentSessionExecutionState {
  const status = value && typeof value === 'object' ? value as JsonRecord : {}
  if (status.type === 'busy') return { type: 'busy' }
  if (status.type === 'retry') {
    const actionRecord = status.action && typeof status.action === 'object'
      ? status.action as JsonRecord
      : null
    const action = actionRecord
      && typeof actionRecord.label === 'string'
      && typeof actionRecord.message === 'string'
      && typeof actionRecord.provider === 'string'
      && typeof actionRecord.reason === 'string'
      && typeof actionRecord.title === 'string'
      ? {
          label: actionRecord.label,
          ...(typeof actionRecord.link === 'string' ? { link: actionRecord.link } : {}),
          message: actionRecord.message,
          provider: actionRecord.provider,
          reason: actionRecord.reason,
          title: actionRecord.title,
        }
      : undefined
    return {
      type: 'retry',
      ...(action ? { action } : {}),
      attempt: typeof status.attempt === 'number' ? status.attempt : 0,
      message: typeof status.message === 'string' ? status.message : 'OpenCode 正在重试',
      next: typeof status.next === 'number' ? status.next : Date.now(),
    }
  }
  return { type: 'idle' }
}

function normalizeSessionIndex(value: unknown): OpenCodeSessionIndex {
  const candidate = value && typeof value === 'object' ? value as JsonRecord : {}
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions.flatMap((entry): OpenCodeSessionRecord[] => {
        const record = entry && typeof entry === 'object' ? entry as JsonRecord : {}
        const id = normalizeNullableText(record.id)
        const cwd = normalizeNullableText(record.cwd)
        if (!id || !cwd) return []
        return [{
          createdAt: normalizeNullableText(record.createdAt) ?? new Date(0).toISOString(),
          cwd,
          id,
          modelKey: normalizeNullableText(record.modelKey) ?? null,
          thinkingLevel: typeof record.thinkingLevel === 'string'
            && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(record.thinkingLevel)
            ? record.thinkingLevel as AgentThinkingLevel
            : DEFAULT_THINKING_LEVEL,
        }]
      })
    : []
  return { sessions, version: 1 }
}

function sessionConfigurationFromMetadata(session: Session) {
  const metadata = session.metadata?.[ARYN_SESSION_METADATA_KEY]
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as JsonRecord
  const modelKey = normalizeNullableText(record.modelKey) ?? null
  const thinkingLevel = typeof record.thinkingLevel === 'string'
    && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(record.thinkingLevel)
    ? record.thinkingLevel as AgentThinkingLevel
    : null
  if (!modelKey && !thinkingLevel) return null
  return { modelKey, thinkingLevel }
}

function withSessionConfigurationMetadata(
  session: Session,
  modelKey: string | null,
  thinkingLevel: AgentThinkingLevel,
) {
  return {
    ...(session.metadata ?? {}),
    [ARYN_SESSION_METADATA_KEY]: {
      modelKey,
      thinkingLevel,
    },
  }
}

function sessionListItem(session: Session): AgentSessionListItem {
  const title = session.title?.trim() || null
  return {
    createdAt: new Date(session.time.created).toISOString(),
    id: session.id,
    messageCount: 0,
    modifiedAt: new Date(session.time.updated).toISOString(),
    name: title,
    path: session.id,
    preview: title ?? 'OpenCode session',
  }
}

export class OpenCodeAgentManager {
  private client: OpencodeClient | null = null
  private disposed = false
  private eventAbortController: AbortController | null = null
  private eventLoop: Promise<void> | null = null
  private readonly index: AtomicJsonStore<OpenCodeSessionIndex>
  private readonly messageReducer = new OpenCodeSessionMessageReducer()
  private readonly pendingInteractions = new Map<string, PendingOpenCodeInteraction>()
  private readonly sessionDiffs = new Map<string, SnapshotFileDiff[]>()
  private readonly sessionBindingStarts = new Map<string, Promise<SessionBinding>>()
  private readonly sessionBindingStartWorkspaces = new Map<string, string>()
  private readonly sessionBindings = new Map<string, SessionBinding>()
  private readonly sessionSnapshotTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly knownWorkspaces = new Map<string, string>()
  private readonly workspaceActiveSessions = new Map<string, string>()
  private server: OpenCodeServer | null = null
  private serverExitUnsubscribe: (() => void) | null = null
  private serverPromise: Promise<void> | null = null

  constructor(private readonly options: OpenCodeAgentManagerOptions) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_SESSION_INDEX),
      filePath: path.join(options.agentDir, 'external', 'opencode', 'sessions.json'),
      normalize: normalizeSessionIndex,
    })
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    const client = await this.ensureClient()
    const runtime = await this.buildRuntime(client, null, null)
    return { activeSession: null, runtime, sessions: [] }
  }

  async loadWorkspaceState(
    cwd: string,
    preferredSessionPath: string | null = null,
    options: { restoreSession?: boolean } = {},
  ) {
    const client = await this.ensureClient()
    const sessions = await this.listSessions(client, cwd)
    let activeSessionID: string | null = null

    if (options.restoreSession !== false) {
      const identity = workspaceIdentity(cwd)
      const candidates = [preferredSessionPath, this.workspaceActiveSessions.get(identity), sessions[0]?.id]
        .filter((candidate, index, values): candidate is string => Boolean(candidate && values.indexOf(candidate) === index))
      for (const candidate of candidates) {
        if (sessions.some((session) => session.id === candidate)) {
          activeSessionID = candidate
          break
        }
        try {
          await this.requireSession(client, cwd, candidate)
          activeSessionID = candidate
          break
        } catch {
          // A stale child-session preference must not prevent the owned root
          // session list from loading.
        }
      }
    }

    if (activeSessionID) {
      this.workspaceActiveSessions.set(workspaceIdentity(cwd), activeSessionID)
    }

    await this.reconcilePendingInteractions(client, cwd).catch((error) => {
      this.options.emitEvent({
        type: 'error',
        message: `OpenCode 待处理请求同步失败：${formatError(error)}`,
        sessionId: activeSessionID,
      })
    })

    return this.buildWorkspaceState(client, cwd, activeSessionID, sessions)
  }

  async listSessionItems(cwd: string) {
    return (await this.listSessions(await this.ensureClient(), cwd)).map(sessionListItem)
  }

  async readSession(cwd: string, sessionID: string) {
    const client = await this.ensureClient()
    await this.requireSession(client, cwd, sessionID)
    return this.buildSessionSnapshot(client, cwd, sessionID)
  }

  async requestSurfaceData(cwd: string, request: OpenCodeSurfaceRequest): Promise<OpenCodeSurfaceResponse> {
    const client = await this.ensureClient()
    if ('sessionID' in request) {
      await this.requireSession(client, cwd, request.sessionID)
    }

    switch (request.method) {
      case 'app.agents': {
        const response = await client.app.agents({ directory: cwd }, { throwOnError: true })
        return { data: unwrapSdkResult<unknown>(response, 'load surface agents') }
      }
      case 'provider.list': {
        const response = await client.provider.list({ directory: cwd }, { throwOnError: true })
        return { data: unwrapSdkResult<unknown>(response, 'load surface providers') }
      }
      case 'session.get': {
        const response = await client.session.get({ directory: cwd, sessionID: request.sessionID }, { throwOnError: true })
        return { data: unwrapSdkResult<Session>(response, 'load surface session') }
      }
      case 'session.messages': {
        const response = await client.session.messages({
          directory: cwd,
          sessionID: request.sessionID,
          limit: Math.max(1, Math.min(500, request.limit)),
          ...(request.before ? { before: request.before } : {}),
        }, { throwOnError: true })
        const result = unwrapSdkResult<Array<{ info: Message, parts: Part[] }>>(response, 'load surface messages')
        const nextCursor = response && typeof response === 'object' && 'response' in response
          ? response.response.headers.get('x-next-cursor') ?? undefined
          : undefined
        return { data: result, nextCursor }
      }
      case 'session.message': {
        const response = await client.session.message({
          directory: cwd,
          messageID: request.messageID,
          sessionID: request.sessionID,
        }, { throwOnError: true })
        return { data: unwrapSdkResult<{ info: Message, parts: Part[] }>(response, 'load surface message') }
      }
      case 'session.diff': {
        const response = await client.session.diff({ directory: cwd, sessionID: request.sessionID }, { throwOnError: true })
        return { data: unwrapSdkResult<SnapshotFileDiff[]>(response, 'load surface diff') }
      }
      case 'session.todo': {
        const response = await client.session.todo({ directory: cwd, sessionID: request.sessionID }, { throwOnError: true })
        return { data: unwrapSdkResult<Todo[]>(response, 'load surface todos') }
      }
      case 'session.status': {
        const response = await client.session.status({ directory: cwd }, { throwOnError: true })
        const statuses = unwrapSdkResult<Record<string, SessionStatus>>(response, 'load surface status')
        return { data: statuses[request.sessionID] ?? { type: 'idle' } }
      }
    }
  }

  async sessionExists(cwd: string, sessionID: string) {
    try {
      await this.requireSession(await this.ensureClient(), cwd, sessionID)
      return true
    } catch {
      return false
    }
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    const client = await this.ensureClient()
    const normalizedOptions = typeof options === 'string' ? { name: options } : options
    const selectedModel = parseModelKey(normalizedOptions?.modelKey)
    const thinkingLevel = normalizedOptions?.thinkingLevel ?? DEFAULT_THINKING_LEVEL
    if (normalizedOptions?.modelKey) {
      const supportedLevels = await this.requireAvailableModel(client, cwd, normalizedOptions.modelKey)
      if (!supportedLevels.includes(thinkingLevel)) {
        throw new Error(`OpenCode thinking level "${thinkingLevel}" is not supported by "${normalizedOptions.modelKey}".`)
      }
    }
    const response = await client.session.create({
      directory: cwd,
      ...(normalizedOptions?.name?.trim() ? { title: normalizedOptions.name.trim() } : {}),
      metadata: {
        [ARYN_SESSION_METADATA_KEY]: {
          modelKey: selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : null,
          thinkingLevel,
        },
      },
      ...(selectedModel
        ? {
            model: {
              id: selectedModel.modelID,
              providerID: selectedModel.providerID,
              ...(mapThinkingVariant(thinkingLevel) ? { variant: mapThinkingVariant(thinkingLevel) } : {}),
            },
          }
        : {}),
    })
    const session = unwrapSdkResult<Session>(response, 'create session')
    try {
      await this.index.update((state) => ({
        ...state,
        sessions: [{
          createdAt: new Date(session.time.created).toISOString(),
          cwd,
          id: session.id,
          modelKey: selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : null,
          thinkingLevel,
        }, ...state.sessions.filter((record) => record.id !== session.id)],
      }))
    } catch (error) {
      await client.session.delete({ directory: cwd, sessionID: session.id }, { throwOnError: true }).catch(() => undefined)
      throw error
    }
    this.bindSession(session.id, cwd, session, {
      createdAt: new Date(session.time.created).toISOString(),
      cwd,
      id: session.id,
      modelKey: selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : null,
      thinkingLevel,
    })
    const binding = this.sessionBindings.get(session.id)!
    binding.selectedModel = selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : null
    binding.thinkingLevel = thinkingLevel
    this.workspaceActiveSessions.set(workspaceIdentity(cwd), session.id)
    return this.broadcastWorkspaceState(cwd, session.id)
  }

  async openSession(cwd: string, sessionID: string) {
    const client = await this.ensureClient()
    await this.requireSession(client, cwd, sessionID)
    this.workspaceActiveSessions.set(workspaceIdentity(cwd), sessionID)
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  async deleteSession(cwd: string, sessionID: string) {
    const client = await this.ensureClient()
    await this.requireSession(client, cwd, sessionID)
    const ownedSessionIds = new Set(
      [...this.sessionBindings.entries()]
        .filter(([, binding]) => binding.rootSessionId === sessionID)
        .map(([ownedSessionID]) => ownedSessionID),
    )
    ownedSessionIds.add(sessionID)
    await Promise.all([...ownedSessionIds].map((ownedSessionID) => (
      this.sessionBindingStarts.get(ownedSessionID)?.catch(() => undefined)
    )))
    await client.session.delete({ directory: cwd, sessionID }, { throwOnError: true })
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.filter((record) => record.id !== sessionID),
    }))
    this.clearSessionRuntimeState(ownedSessionIds)
    const identity = workspaceIdentity(cwd)
    const activeSessionID = this.workspaceActiveSessions.get(identity) ?? null
    if (activeSessionID && ownedSessionIds.has(activeSessionID)) {
      this.workspaceActiveSessions.delete(identity)
    }
    return this.broadcastWorkspaceState(cwd, activeSessionID && ownedSessionIds.has(activeSessionID) ? null : activeSessionID)
  }

  async renameSession(cwd: string, sessionID: string, name: string) {
    const client = await this.ensureClient()
    await this.requireSession(client, cwd, sessionID)
    await client.session.update({ directory: cwd, sessionID, title: name.trim() }, { throwOnError: true })
    const binding = this.sessionBindings.get(sessionID)
    if (binding) {
      binding.title = name.trim() || null
    }
    return this.broadcastWorkspaceState(cwd, this.workspaceActiveSessions.get(workspaceIdentity(cwd)) ?? null)
  }

  async sendPrompt(
    cwd: string,
    sessionID: string,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments: AgentPromptAttachment[] = [],
    options?: AgentPromptSendOptions,
  ) {
    const client = await this.ensureClient()
    const binding = await this.requireBinding(client, cwd, sessionID)
    if (binding.parentSessionId) {
      throw new Error('OpenCode 子会话由父会话中的子 Agent 管理，不能直接发送消息。')
    }
    if (binding.isStreaming && streamingBehavior === 'followUp') {
      throw new Error('OpenCode 当前不支持客户端排队的后续消息；运行中发送会按官方行为追加引导。')
    }
    const selectedModel = parseModelKey(binding.selectedModel)
    if (options?.clientMessageId && !isOpenCodeMessageId(options.clientMessageId)) {
      throw new Error('OpenCode prompt message ID is invalid.')
    }
    if (options?.clientPartIds?.some((partID) => !isOpenCodePartId(partID))) {
      throw new Error('OpenCode prompt part ID is invalid.')
    }
    if (options?.clientPartIds && options.clientPartIds.length !== attachments.length + 1) {
      throw new Error('OpenCode prompt part IDs do not match the prompt payload.')
    }

    const parts: Array<Record<string, unknown>> = [{
      ...(options?.clientPartIds?.[0] ? { id: options.clientPartIds[0] } : {}),
      type: 'text',
      text: prompt,
    }]

    for (const [index, attachment] of attachments.entries()) {
      const url = attachment.data ?? (attachment.path ? pathToFileURL(attachment.path).href : null)
      if (!url) {
        continue
      }
      parts.push({
        ...(options?.clientPartIds?.[index + 1] ? { id: options.clientPartIds[index + 1] } : {}),
        filename: attachment.fileName,
        mime: attachment.mimeType ?? 'application/octet-stream',
        type: 'file',
        url,
      })
    }

    binding.executionState = { type: 'busy' }
    binding.isStreaming = true
    this.emitSessionSnapshot(sessionID)

    const request = {
      directory: cwd,
      sessionID,
      ...(options?.clientMessageId ? { messageID: options.clientMessageId } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(mapThinkingVariant(binding.thinkingLevel) ? { variant: mapThinkingVariant(binding.thinkingLevel) } : {}),
      parts: parts as never,
    }
    try {
      await client.session.promptAsync({ ...request }, { throwOnError: true })
    } catch (error) {
      binding.executionState = { type: 'idle' }
      binding.isStreaming = false
      this.options.emitEvent({ type: 'error', message: formatError(error), sessionId: sessionID })
      await this.broadcastWorkspaceState(cwd, sessionID).catch(() => undefined)
      throw error
    }

    return { ok: true }
  }

  async selectModel(cwd: string, sessionID: string, modelKey: string) {
    const client = await this.ensureClient()
    const supportedLevels = await this.requireAvailableModel(client, cwd, modelKey)
    const binding = await this.requireBinding(client, cwd, sessionID)
    if (binding.parentSessionId) throw new Error('OpenCode 子会话不能单独修改模型。')
    binding.selectedModel = modelKey
    if (!supportedLevels.includes(binding.thinkingLevel)) {
      binding.thinkingLevel = supportedLevels.includes(DEFAULT_THINKING_LEVEL)
        ? DEFAULT_THINKING_LEVEL
        : supportedLevels[0] ?? 'off'
    }
    await this.updateSessionConfiguration(cwd, sessionID, binding)
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  async selectThinkingLevel(cwd: string, sessionID: string, level: string, modelKey?: string) {
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(level)) {
      throw new Error(`OpenCode thinking level "${level}" is invalid.`)
    }
    const client = await this.ensureClient()
    const binding = await this.requireBinding(client, cwd, sessionID)
    if (binding.parentSessionId) throw new Error('OpenCode 子会话不能单独修改思考等级。')
    const selectedModelKey = modelKey ?? binding.selectedModel
    if (!selectedModelKey) throw new Error('Select an OpenCode model before changing the thinking level.')
    const supportedLevels = await this.requireAvailableModel(client, cwd, selectedModelKey)
    if (!supportedLevels.includes(level as AgentThinkingLevel)) {
      throw new Error(`OpenCode thinking level "${level}" is not supported by "${selectedModelKey}".`)
    }
    binding.thinkingLevel = level as AgentThinkingLevel
    if (modelKey) {
      binding.selectedModel = modelKey
    }
    await this.updateSessionConfiguration(cwd, sessionID, binding)
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  async abortActivePrompt(cwd: string, sessionID: string) {
    const client = await this.ensureClient()
    const binding = await this.requireBinding(client, cwd, sessionID)
    if (binding.parentSessionId) throw new Error('OpenCode 子会话由父会话管理，不能单独停止。')
    await client.session.abort({ directory: cwd, sessionID }, { throwOnError: true })
    binding.executionState = { type: 'idle' }
    binding.isStreaming = false
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  async respondToInteraction(response: AgentInteractionResponse) {
    const pendingEntry = [...this.pendingInteractions.entries()].find(([, candidate]) => (
      candidate.ownerSessionId === response.sessionId
      && candidate.requestId === response.requestId
    ))
    const interactionKey = pendingEntry?.[0]
    const pending = pendingEntry?.[1]
    if (!interactionKey || !pending) return false
    const client = await this.ensureClient()
    if (pending.kind === 'permission') {
      const reply = response.optionId === 'allow_always'
        ? 'always'
        : response.optionId === 'allow_once'
          ? 'once'
          : 'reject'
      if (pending.protocol === 'v2') {
        await client.v2.session.permission.reply({
          requestID: response.requestId,
          reply,
          sessionID: pending.sessionId,
        }, { throwOnError: true })
      } else {
        await client.permission.reply({
          directory: pending.cwd,
          requestID: response.requestId,
          reply,
        }, { throwOnError: true })
      }
    } else if (response.optionId === 'reject' || response.optionId === 'deny') {
      if (pending.protocol === 'v2') {
        await client.v2.session.question.reject({
          requestID: response.requestId,
          sessionID: pending.sessionId,
        }, { throwOnError: true })
      } else {
        await client.question.reject({
          directory: pending.cwd,
          requestID: response.requestId,
        }, { throwOnError: true })
      }
    } else {
      const answers = pending.questionIds?.map((questionId, index) => (
        response.answers?.[questionId]
        ?? (index === 0
          ? [response.optionId.startsWith('answer:')
              ? response.optionId.slice('answer:'.length)
              : response.values?.[0] ?? response.optionId]
          : [])
      )) ?? []
      if (pending.protocol === 'v2') {
        await client.v2.session.question.reply({
          questionV2Reply: { answers },
          requestID: response.requestId,
          sessionID: pending.sessionId,
        }, { throwOnError: true })
      } else {
        await client.question.reply({
          answers,
          directory: pending.cwd,
          requestID: response.requestId,
        }, { throwOnError: true })
      }
    }
    this.resolvePendingInteraction(interactionKey, true)
    return true
  }

  async releaseWorkspaceRuntime(cwd: string) {
    const identity = workspaceIdentity(cwd)
    const pendingStarts = [...this.sessionBindingStarts.entries()]
      .filter(([sessionID]) => this.sessionBindingStartWorkspaces.get(sessionID) === identity)
      .map(([, start]) => start.catch(() => undefined))
    await Promise.all(pendingStarts)
    const bindings = [...this.sessionBindings.entries()].filter(([, binding]) => workspaceIdentity(binding.cwd) === identity)
    let failures: unknown[] = []
    if (this.client) {
      const abortResults = await Promise.allSettled(bindings
        .filter(([, binding]) => binding.isStreaming)
        .map(([sessionID]) => this.client!.session.abort({ directory: cwd, sessionID }, { throwOnError: true })))
      failures = abortResults.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    }
    const sessionIds = new Set(bindings.map(([sessionID]) => sessionID))
    this.clearSessionRuntimeState(sessionIds)
    this.workspaceActiveSessions.delete(identity)
    this.knownWorkspaces.delete(identity)
    if (failures.length > 0) throw new AggregateError(failures, 'One or more OpenCode sessions could not be stopped.')
  }

  async discardWorkspaceSessions(cwd: string) {
    // Draft cleanup is deliberately limited to the Aryn ownership manifest.
    // Official OpenCode sessions discovered for the workspace must never be
    // deleted merely because an Aryn draft is discarded.
    const records = await this.listOwnedRecords(cwd)
    if (records.length === 0) return
    await Promise.all(records.map((record) => this.sessionBindingStarts.get(record.id)?.catch(() => undefined)))
    const client = await this.ensureClient()
    const deletedSessionIds: string[] = []
    let firstError: unknown = null
    for (const record of records) {
      try {
        await client.session.delete({ directory: cwd, sessionID: record.id }, { throwOnError: true })
        deletedSessionIds.push(record.id)
        const ownedSessionIds = new Set(
          [...this.sessionBindings.entries()]
            .filter(([, binding]) => binding.rootSessionId === record.id)
            .map(([ownedSessionID]) => ownedSessionID),
        )
        ownedSessionIds.add(record.id)
        this.clearSessionRuntimeState(ownedSessionIds)
      } catch (error) {
        firstError ??= error
      }
    }
    if (deletedSessionIds.length > 0) {
      const deleted = new Set(deletedSessionIds)
      await this.index.update((state) => ({
        ...state,
        sessions: state.sessions.filter((record) => !deleted.has(record.id)),
      }))
    }
    this.workspaceActiveSessions.delete(workspaceIdentity(cwd))
    if (firstError) throw firstError
  }

  dispose() {
    this.disposed = true
    this.eventAbortController?.abort()
    this.eventAbortController = null
    this.serverExitUnsubscribe?.()
    this.serverExitUnsubscribe = null
    this.server?.close()
    this.server = null
    this.serverPromise = null
    this.client = null
    this.eventLoop = null
    for (const timer of this.sessionSnapshotTimers.values()) clearTimeout(timer)
    this.sessionSnapshotTimers.clear()
    this.messageReducer.clearAll()
    this.pendingInteractions.clear()
    this.sessionDiffs.clear()
    this.sessionBindingStarts.clear()
    this.sessionBindingStartWorkspaces.clear()
    this.sessionBindings.clear()
    this.knownWorkspaces.clear()
    this.workspaceActiveSessions.clear()
  }

  private async ensureClient() {
    if (this.disposed) throw new Error('OpenCode manager has been disposed.')
    if (!this.serverPromise) {
      if (this.client) return this.client
      this.serverPromise = this.startServer()
    }
    try {
      await this.serverPromise
    } catch (error) {
      this.serverPromise = null
      throw error
    }
    return this.client!
  }

  private async startServer() {
    await prepareExternalCliEnvironment()
    if (this.disposed) throw new Error('OpenCode manager has been disposed.')
    const password = randomBytes(24).toString('base64url')
    const environment = createExternalCliEnvironment({
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: 'aryn',
    })
    const command = resolveExternalCliCommand('opencode', environment)
    if (!command) throw new Error('OpenCode CLI was not found in PATH.')
    const server = await (this.options.startServer ?? launchOpenCodeServer)({
      command,
      environment,
      hostname: '127.0.0.1',
      port: 0,
      timeout: OPEN_CODE_START_TIMEOUT_MS,
    })
    if (this.disposed) {
      server.close()
      throw new Error('OpenCode manager was disposed during server initialization.')
    }
    this.server = server

    const authorization = `Basic ${Buffer.from(`aryn:${password}`).toString('base64')}`
    const client = createOpencodeClient({
      baseUrl: this.server.url,
      headers: { Authorization: authorization },
    })
    this.client = client
    try {
      const health = unwrapSdkResult<{ healthy: true, version: string }>(
        await client.global.health({ throwOnError: true }),
        'health check',
      )
      if (!health.healthy || !isCompatibleOpenCodeVersion(health.version)) {
        throw new Error(formatOpenCodeVersionCompatibilityError(health.version))
      }

      await this.startEventLoop(client)
      this.serverExitUnsubscribe = server.onExit?.((error) => {
        if (this.disposed || this.server !== server || this.client !== client) return
        this.handleEventStreamFailure(client, error)
        if (!this.disposed) {
          void this.ensureClient().catch((cause) => {
            this.options.emitEvent({
              type: 'error',
              message: `OpenCode server restart failed: ${formatError(cause)}`,
              sessionId: null,
            })
          })
        }
      }) ?? null
    } catch (error) {
      if (this.client === client) {
        this.eventAbortController?.abort()
        this.eventAbortController = null
        this.eventLoop = null
        this.client = null
      }
      if (this.server === server) {
        this.server = null
        server.close()
      }
      throw error
    }
  }

  private async startEventLoop(client: OpencodeClient) {
    this.eventAbortController = new AbortController()
    const signal = this.eventAbortController.signal
    let subscription: Awaited<ReturnType<OpencodeClient['global']['event']>>
    try {
      // OpenCode Desktop consumes the global stream and routes each envelope by
      // its payload/session identity. The instance-scoped /event endpoint needs
      // workspace routing; subscribing without a directory silently observes a
      // different instance and drops the sessions Aryn created elsewhere.
      subscription = await client.global.event({ signal })
    } catch (error) {
      if (!signal.aborted) this.handleEventStreamFailure(client, error)
      throw error
    }
    this.eventLoop = (async () => {
      let currentSubscription: typeof subscription | null = subscription
      let reconnectAttempt = 0
      while (!signal.aborted && this.client === client) {
        try {
          if (!currentSubscription) {
            currentSubscription = await client.global.event({ signal })
            await this.reconcileAfterEventReconnect(client)
            reconnectAttempt = 0
          }
          for await (const envelope of currentSubscription.stream) {
            if (signal.aborted) break
            reconnectAttempt = 0
            const event = (envelope as OpenCodeGlobalEvent).payload as OpenCodeEvent
            try {
              await this.handleEvent(event)
            } catch (error) {
              const sessionId = getOpenCodeEventSessionId(event)
              this.options.emitEvent({
                type: 'error',
                message: `OpenCode 事件处理失败：${formatError(error)}`,
                sessionId,
              })
            }
          }
          if (signal.aborted || this.client !== client) return
          throw new Error('OpenCode event stream ended unexpectedly.')
        } catch {
          if (signal.aborted || this.client !== client) return
          currentSubscription = null
          reconnectAttempt += 1
          const delay = Math.min(
            OPEN_CODE_EVENT_RECONNECT_MIN_MS * (2 ** Math.min(reconnectAttempt - 1, 4)),
            OPEN_CODE_EVENT_RECONNECT_MAX_MS,
          )
          await waitForAbortableDelay(delay, signal)
        }
      }
    })()
  }

  private async reconcileAfterEventReconnect(client: OpencodeClient) {
    if (this.client !== client || this.disposed) return
    const bindingsByWorkspace = new Map<string, Array<[string, SessionBinding]>>()
    for (const entry of this.sessionBindings.entries()) {
      const identity = workspaceIdentity(entry[1].cwd)
      const entries = bindingsByWorkspace.get(identity)
      if (entries) entries.push(entry)
      else bindingsByWorkspace.set(identity, [entry])
    }

    for (const entries of bindingsByWorkspace.values()) {
      if (this.client !== client || this.disposed) return
      const cwd = entries[0]?.[1].cwd
      if (!cwd) continue

      try {
        const response = await client.session.status({ directory: cwd }, { throwOnError: true })
        const statuses = unwrapSdkResult<Record<string, SessionStatus>>(response, 'reconcile session status')
        for (const [sessionID, binding] of entries) {
          binding.executionState = statuses[sessionID] ?? { type: 'idle' }
          binding.isStreaming = binding.executionState.type !== 'idle'
        }
      } catch (error) {
        this.options.emitEvent({
          type: 'error',
          message: `OpenCode 重连后状态同步失败：${formatError(error)}`,
          sessionId: this.workspaceActiveSessions.get(workspaceIdentity(cwd)) ?? null,
        })
      }

      try {
        await this.reconcilePendingInteractions(client, cwd)
      } catch (error) {
        this.options.emitEvent({
          type: 'error',
          message: `OpenCode 重连后待处理请求同步失败：${formatError(error)}`,
          sessionId: this.workspaceActiveSessions.get(workspaceIdentity(cwd)) ?? null,
        })
      }

      for (const [sessionID] of entries) {
        this.options.emitEvent({
          type: 'opencode_surface_refresh',
          sessionId: sessionID,
          workspacePath: cwd,
        })
      }

      const activeSessionID = this.workspaceActiveSessions.get(workspaceIdentity(cwd)) ?? null
      try {
        await this.broadcastWorkspaceState(cwd, activeSessionID)
      } catch (error) {
        this.options.emitEvent({
          type: 'error',
          message: `OpenCode 重连后会话同步失败：${formatError(error)}`,
          sessionId: activeSessionID,
        })
      }
    }
  }

  /**
   * The event stream is not a durable queue. Match OpenCode Desktop's
   * bootstrap behaviour by reconciling the server's pending permission and
   * question lists after opening a workspace and after every reconnect.
   * Otherwise a request emitted while Aryn is closed or disconnected leaves
   * the native run blocked with no interaction UI.
   */
  private async reconcilePendingInteractions(client: OpencodeClient, cwd: string) {
    const [permissionResponse, questionResponse] = await Promise.all([
      client.permission.list({ directory: cwd }, { throwOnError: true }),
      client.question.list({ directory: cwd }, { throwOnError: true }),
    ])
    const permissions = unwrapSdkResult<PermissionRequest[]>(permissionResponse, 'list pending permissions')
    const questions = unwrapSdkResult<QuestionRequest[]>(questionResponse, 'list pending questions')
    const ownedPermissions: PermissionRequest[] = []
    const ownedQuestions: QuestionRequest[] = []
    const liveInteractionKeys = new Set<string>()

    await Promise.all([
      ...permissions.map(async (request) => {
        const binding = await this.requireBinding(client, cwd, request.sessionID).catch(() => null)
        if (!binding || workspaceIdentity(binding.cwd) !== workspaceIdentity(cwd)) return
        ownedPermissions.push(request)
        liveInteractionKeys.add(getAgentInteractionKey(request.sessionID, request.id))
      }),
      ...questions.map(async (request) => {
        const binding = await this.requireBinding(client, cwd, request.sessionID).catch(() => null)
        if (!binding || workspaceIdentity(binding.cwd) !== workspaceIdentity(cwd)) return
        ownedQuestions.push(request)
        liveInteractionKeys.add(getAgentInteractionKey(request.sessionID, request.id))
      }),
    ])

    for (const [interactionKey, pending] of this.pendingInteractions) {
      if (workspaceIdentity(pending.cwd) !== workspaceIdentity(cwd)) continue
      if (liveInteractionKeys.has(interactionKey)) continue
      this.resolvePendingInteraction(interactionKey, true)
    }

    for (const request of ownedPermissions) {
      await this.handleEvent({ type: 'permission.asked', properties: request } as OpenCodeEvent)
    }
    for (const request of ownedQuestions) {
      await this.handleEvent({ type: 'question.asked', properties: request } as OpenCodeEvent)
    }
  }

  private async handleEvent(event: OpenCodeEvent) {
    const properties = 'properties' in event ? event.properties as Record<string, unknown> : {}
    const sessionID = getOpenCodeEventSessionId(event)
    if (!sessionID) {
      return
    }
    const binding = this.sessionBindings.get(sessionID)
      ?? await this.resolveEventBinding(sessionID, properties)
    if (!binding) {
      return
    }

    this.options.emitEvent({
      type: 'opencode_native_event',
      event,
      workspacePath: binding.cwd,
    })

    if (
      event.type === 'message.updated'
      || event.type === 'message.removed'
      || event.type === 'message.part.updated'
      || event.type === 'message.part.removed'
      || event.type === 'message.part.delta'
    ) {
      const reduction = this.messageReducer.apply(event)
      if (event.type === 'message.updated') {
        const info = properties.info as Message | undefined
        if (info?.role === 'assistant') {
          binding.lastAssistantMessageId = info.id
          if (!info.time.completed && !info.error) {
            binding.executionState = { type: 'busy' }
            binding.isStreaming = true
          }
        }
      }
      if (reduction.awaitingBaseline) {
        // Match OpenCode Desktop's live store semantics: an out-of-order part
        // stays buffered until its parent/complete Part event arrives. Pulling
        // an in-flight REST snapshot here can be older than the SSE stream and
        // overwrite text that was already rendered.
        return
      } else if (reduction.changed) {
        if (event.type === 'message.part.delta') {
          this.scheduleSessionSnapshot(sessionID)
        } else {
          this.emitSessionSnapshot(sessionID)
        }
      }
      return
    }

    if (event.type === 'session.diff') {
      const diffs = Array.isArray(properties.diff) ? properties.diff as SnapshotFileDiff[] : []
      this.sessionDiffs.set(sessionID, diffs)
      this.emitSessionSnapshot(sessionID)
      return
    }

    if (event.type === 'session.status' || event.type === 'session.idle') {
      binding.executionState = event.type === 'session.idle'
        ? { type: 'idle' }
        : normalizeExecutionState(properties.status)
      binding.isStreaming = binding.executionState.type !== 'idle'
      if (binding.isStreaming) {
        this.emitSessionSnapshot(sessionID)
      } else {
        await this.broadcastWorkspaceState(binding.cwd, sessionID)
      }
      return
    }

    if (event.type === 'session.error') {
      binding.executionState = { type: 'idle' }
      binding.isStreaming = false
      this.options.emitEvent({
        type: 'error',
        message: formatError(properties.error ?? 'OpenCode session failed.'),
        sessionId: sessionID,
      })
      await this.broadcastWorkspaceState(binding.cwd, sessionID)
      return
    }

    if (
      event.type === 'permission.replied'
      || event.type === 'permission.v2.replied'
      || event.type === 'question.replied'
      || event.type === 'question.v2.replied'
      || event.type === 'question.rejected'
      || event.type === 'question.v2.rejected'
    ) {
      const requestId = String(properties.requestID ?? properties.id ?? '')
      if (requestId) {
        this.resolvePendingInteraction(getAgentInteractionKey(sessionID, requestId), true)
      }
      return
    }

    if (event.type === 'permission.asked' || event.type === 'permission.v2.asked') {
      const requestId = String(properties.id ?? '')
      if (!requestId) return
      const action = String(properties.permission ?? properties.action ?? 'operation')
      const resources = Array.isArray(properties.patterns)
        ? properties.patterns
        : Array.isArray(properties.resources)
          ? properties.resources
          : []
      this.pendingInteractions.set(getAgentInteractionKey(sessionID, requestId), {
        cwd: binding.cwd,
        kind: 'permission',
        ownerSessionId: binding.rootSessionId,
        protocol: event.type === 'permission.v2.asked' ? 'v2' : 'classic',
        requestId,
        sessionId: sessionID,
      })
      this.options.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'opencode',
          id: requestId,
          kind: 'permission',
          message: resources.length > 0 ? resources.map(String).join('\n') : `OpenCode 请求执行 ${action}`,
          options: [
            { id: 'reject', label: '拒绝' },
            { id: 'allow_once', label: '允许本次' },
            { id: 'allow_always', label: '始终允许' },
          ],
          sessionId: binding.rootSessionId,
          title: `OpenCode 请求：${action}`,
          workspacePath: binding.cwd,
        },
      })
      return
    }

    if (event.type === 'question.asked' || event.type === 'question.v2.asked') {
      const requestId = String(properties.id ?? '')
      const questions = Array.isArray(properties.questions) ? properties.questions as JsonRecord[] : []
      if (!requestId || questions.length === 0) return
      const questionIds = questions.map((question, index) => String(question.id ?? `answer-${index + 1}`))
      const fields = questions.map((question, index) => ({
        allowsCustomAnswer: question.custom === true
          || question.isOther === true
          || !Array.isArray(question.options)
          || question.options.length === 0,
        id: questionIds[index],
        label: String(question.header ?? `问题 ${index + 1}`),
        message: String(question.question ?? question.message ?? ''),
        options: Array.isArray(question.options)
          ? (question.options as JsonRecord[]).map((option) => ({
              description: normalizeNullableText(option.description),
              id: String(option.label ?? option.value ?? ''),
              label: String(option.label ?? option.value ?? '选择'),
            }))
          : [],
      }))
      this.pendingInteractions.set(getAgentInteractionKey(sessionID, requestId), {
        cwd: binding.cwd,
        kind: 'question',
        ownerSessionId: binding.rootSessionId,
        protocol: event.type === 'question.v2.asked' ? 'v2' : 'classic',
        questionIds,
        requestId,
        sessionId: sessionID,
      })
      this.options.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'opencode',
          fields,
          id: requestId,
          kind: 'question',
          message: questions.length === 1
            ? String(questions[0].question ?? questions[0].message ?? 'OpenCode 需要你的回答。')
            : `OpenCode 有 ${questions.length} 个问题需要回答。`,
          options: [{ id: 'reject', label: '取消' }],
          sessionId: binding.rootSessionId,
          title: questions.length === 1 ? String(questions[0].header ?? 'OpenCode 提问') : 'OpenCode 提问',
          workspacePath: binding.cwd,
        },
      })
    }
  }

  private bindSession(
    sessionID: string,
    cwd: string,
    session: Session | null,
    record?: OpenCodeSessionRecord,
    rootSessionId?: string,
  ) {
    const existing = this.sessionBindings.get(sessionID)
    const parentBinding = session?.parentID ? this.sessionBindings.get(session.parentID) : null
    const officialConfiguration = session ? sessionConfigurationFromMetadata(session) : null
    this.sessionBindings.set(sessionID, {
      cwd,
      executionState: existing?.executionState ?? { type: 'idle' },
      isStreaming: existing?.isStreaming ?? false,
      lastAssistantMessageId: existing?.lastAssistantMessageId ?? null,
      parentSessionId: session?.parentID ?? existing?.parentSessionId ?? null,
      rootSessionId: rootSessionId
        ?? existing?.rootSessionId
        ?? parentBinding?.rootSessionId
        ?? sessionID,
      selectedModel: existing?.selectedModel
        ?? officialConfiguration?.modelKey
        ?? record?.modelKey
        ?? (session?.model ? `${session.model.providerID}/${session.model.id}` : null),
      thinkingLevel: existing?.thinkingLevel
        ?? officialConfiguration?.thinkingLevel
        ?? record?.thinkingLevel
        ?? (session?.model?.variant && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(session.model.variant)
          ? session.model.variant as AgentThinkingLevel
          : DEFAULT_THINKING_LEVEL),
      title: session?.title ?? existing?.title ?? null,
    })
  }

  private handleEventStreamFailure(client: OpencodeClient, error: unknown) {
    if (this.client !== client) return
    const message = `OpenCode event stream stopped: ${formatError(error)}`
    const streamingBindings = [...this.sessionBindings.entries()].filter(([, binding]) => binding.isStreaming)
    for (const [sessionId, binding] of streamingBindings) {
      binding.executionState = { type: 'idle' }
      binding.isStreaming = false
      this.options.emitEvent({ type: 'error', message, sessionId })
    }
    if (streamingBindings.length === 0) {
      this.options.emitEvent({ type: 'error', message, sessionId: null })
    }
    this.eventAbortController?.abort()
    this.eventAbortController = null
    this.serverExitUnsubscribe?.()
    this.serverExitUnsubscribe = null
    this.server?.close()
    this.server = null
    this.serverPromise = null
    this.client = null
    this.eventLoop = null
    this.clearPendingInteractions(() => true)
  }

  private clearPendingInteractions(predicate: (pending: PendingOpenCodeInteraction) => boolean) {
    for (const [interactionKey, pending] of this.pendingInteractions) {
      if (!predicate(pending)) continue
      this.pendingInteractions.delete(interactionKey)
      this.options.emitEvent({
        type: 'interaction_resolved',
        requestId: pending.requestId,
        resumeRun: false,
        sessionId: pending.ownerSessionId,
      })
    }
  }

  private clearSessionRuntimeState(sessionIds: Set<string>) {
    for (const sessionID of sessionIds) {
      this.sessionBindings.delete(sessionID)
      this.sessionBindingStarts.delete(sessionID)
      this.clearScheduledSessionSnapshot(sessionID)
      this.messageReducer.clear(sessionID)
      this.sessionDiffs.delete(sessionID)
    }
    this.clearPendingInteractions((pending) => (
      sessionIds.has(pending.sessionId)
      || sessionIds.has(pending.ownerSessionId)
    ))
  }

  private resolvePendingInteraction(interactionKey: string, resumeRun: boolean) {
    const pending = this.pendingInteractions.get(interactionKey)
    if (!pending) return false
    this.pendingInteractions.delete(interactionKey)
    this.options.emitEvent({
      type: 'interaction_resolved',
      requestId: pending.requestId,
      resumeRun,
      sessionId: pending.ownerSessionId,
    })
    return true
  }

  private async resolveEventBinding(sessionID: string, properties: JsonRecord) {
    const info = properties.info as Session | undefined
    if (info?.id === sessionID && info.parentID) {
      const parentBinding = this.sessionBindings.get(info.parentID)
      if (parentBinding) {
        this.bindSession(sessionID, parentBinding.cwd, info, undefined, parentBinding.rootSessionId)
        return this.sessionBindings.get(sessionID) ?? null
      }
    }

    const client = this.client
    if (!client) return null
    const records = (await this.index.read()).sessions
    const workspaces = Array.from(new Map([
      ...records.map((record) => [workspaceIdentity(record.cwd), record.cwd] as const),
      ...this.knownWorkspaces.entries(),
    ]).values())
    for (const cwd of workspaces) {
      try {
        await this.requireSession(client, cwd, sessionID)
        return this.sessionBindings.get(sessionID) ?? null
      } catch {
        // The dedicated OpenCode server can emit events for another workspace.
        // Keep looking until the official root list confirms ownership.
      }
    }
    return null
  }

  private async listSessions(client: OpencodeClient, cwd: string) {
    this.knownWorkspaces.set(workspaceIdentity(cwd), cwd)
    const [response, records] = await Promise.all([
      client.session.list({ directory: cwd, roots: true }, { throwOnError: true }),
      this.listOwnedRecords(cwd),
    ])
    const recordsById = new Map(records.map((record) => [record.id, record]))
    const officialSessions = unwrapSdkResult<Session[]>(response, 'list sessions')
      .filter((session) => !session.parentID)
      .sort((left, right) => right.time.updated - left.time.updated)
    const sessions = await Promise.all(officialSessions.map((session) => (
      this.migrateIndexedSessionConfiguration(client, cwd, session, recordsById.get(session.id))
    )))
    for (const session of sessions) {
      this.bindSession(session.id, cwd, session, recordsById.get(session.id))
    }
    return sessions
  }

  private async requireSession(client: OpencodeClient, cwd: string, sessionID: string) {
    this.knownWorkspaces.set(workspaceIdentity(cwd), cwd)
    const response = await client.session.get({ directory: cwd, sessionID }, { throwOnError: true })
    const session = unwrapSdkResult<Session>(response, 'read session')
    let root = session
    const seen = new Set([root.id])
    while (root.parentID) {
      if (seen.has(root.parentID)) throw new Error(`OpenCode session parent cycle: ${root.parentID}`)
      seen.add(root.parentID)
      const parentResponse = await client.session.get({
        directory: cwd,
        sessionID: root.parentID,
      }, { throwOnError: true })
      root = unwrapSdkResult<Session>(parentResponse, 'read parent session')
    }
    const rootsResponse = await client.session.list({ directory: cwd, roots: true }, { throwOnError: true })
    const belongsToWorkspace = unwrapSdkResult<Session[]>(rootsResponse, 'list workspace sessions')
      .some((candidate) => candidate.id === root.id)
    if (!belongsToWorkspace) throw new Error('OpenCode session not found for this workspace.')
    const rootRecord = (await this.listOwnedRecords(cwd)).find((candidate) => candidate.id === root.id)
    this.bindSession(sessionID, cwd, session, rootRecord, root.id)
    return session
  }

  private async requireBinding(client: OpencodeClient, cwd: string, sessionID: string) {
    const existing = this.sessionBindings.get(sessionID)
    if (existing && workspaceIdentity(existing.cwd) === workspaceIdentity(cwd)) return existing
    const pending = this.sessionBindingStarts.get(sessionID)
    if (pending) {
      const binding = await pending
      if (workspaceIdentity(binding.cwd) !== workspaceIdentity(cwd)) {
        throw new Error('OpenCode session not found for this Aryn workspace.')
      }
      return binding
    }
    const start = this.requireSession(client, cwd, sessionID)
      .then(() => {
        const binding = this.sessionBindings.get(sessionID)
        if (!binding) throw new Error('OpenCode session loaded without creating a runtime binding.')
        return binding
      })
      .finally(() => {
        if (this.sessionBindingStarts.get(sessionID) === start) {
          this.sessionBindingStarts.delete(sessionID)
          this.sessionBindingStartWorkspaces.delete(sessionID)
        }
      })
    this.sessionBindingStarts.set(sessionID, start)
    this.sessionBindingStartWorkspaces.set(sessionID, workspaceIdentity(cwd))
    return start
  }

  private async updateSessionConfiguration(cwd: string, sessionID: string, binding: SessionBinding) {
    const client = await this.ensureClient()
    const session = await this.requireSession(client, cwd, sessionID)
    await client.session.update({
      directory: cwd,
      metadata: withSessionConfigurationMetadata(session, binding.selectedModel, binding.thinkingLevel),
      sessionID,
    }, { throwOnError: true })
    // Keep the old ownership record in sync while it still exists, but never
    // create one for a session that originated in the official client.
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.map((record) => record.id === sessionID
        ? {
            ...record,
            modelKey: binding.selectedModel,
            thinkingLevel: binding.thinkingLevel,
          }
        : record),
    }))
  }

  private async migrateIndexedSessionConfiguration(
    client: OpencodeClient,
    cwd: string,
    session: Session,
    record: OpenCodeSessionRecord | undefined,
  ) {
    if (!record || sessionConfigurationFromMetadata(session)) return session
    const metadata = withSessionConfigurationMetadata(session, record.modelKey, record.thinkingLevel)
    try {
      await client.session.update({
        directory: cwd,
        metadata,
        sessionID: session.id,
      }, { throwOnError: true })
      return { ...session, metadata }
    } catch (error) {
      // Configuration migration is supplementary. A transient write failure
      // or an older OpenCode server must not hide otherwise valid official
      // sessions from the tree; the ownership index remains the read fallback.
      console.warn(`[opencode] Failed to migrate Aryn session metadata for ${session.id}: ${formatError(error)}`)
      return session
    }
  }

  private async listOwnedRecords(cwd: string) {
    const identity = workspaceIdentity(cwd)
    return (await this.index.read()).sessions.filter((record) => workspaceIdentity(record.cwd) === identity)
  }

  private async requireAvailableModel(client: OpencodeClient, cwd: string, modelKey: string) {
    const parsed = parseModelKey(modelKey)
    if (!parsed) throw new Error(`OpenCode model key "${modelKey}" is invalid.`)
    const response = await client.config.providers({ directory: cwd }, { throwOnError: true })
    const providerConfig = unwrapSdkResult<{ default: Record<string, string>, providers: Provider[] }>(response, 'list providers')
    const provider = providerConfig.providers.find((candidate) => candidate.id === parsed.providerID)
    if (!provider?.models[parsed.modelID]) {
      throw new Error(`OpenCode model "${modelKey}" is not available.`)
    }
    return supportedThinkingLevels(provider, parsed.modelID)
  }

  private async buildSessionSnapshot(client: OpencodeClient, cwd: string, sessionID: string): Promise<AgentSessionSnapshot> {
    const session = await this.requireSession(client, cwd, sessionID)
    const hydration = this.messageReducer.beginHydration(sessionID)
    try {
      const [messagesResponse, diffResponse] = await Promise.all([
        client.session.messages({ directory: cwd, sessionID }, { throwOnError: true }),
        client.session.diff({ directory: cwd, sessionID }, { throwOnError: true }).catch(() => ({ data: [] as SnapshotFileDiff[] })),
      ])
      const records = unwrapSdkResult<Array<{ info: Message, parts: Part[] }>>(messagesResponse, 'read messages')
      const diffs = unwrapSdkResult<SnapshotFileDiff[]>(diffResponse, 'read diff')
      const binding = this.sessionBindings.get(sessionID)
      const isStreaming = binding?.isStreaming === true
      // Live state remains authoritative while a prompt is streaming. At every
      // other boundary, reconcile the REST baseline with entity revisions that
      // changed during the request so stale fetches cannot undo native events.
      if (isStreaming && this.messageReducer.hasBufferedState(sessionID)) {
        this.messageReducer.cancelHydration(hydration)
      } else {
        this.messageReducer.hydrate(sessionID, records, hydration)
      }
      if (!isStreaming) {
        this.sessionDiffs.set(sessionID, diffs)
      }
      if (binding) binding.title = session.title?.trim() || null
      return this.createSessionSnapshot(sessionID, cwd, session.title?.trim() || null)
    } catch (error) {
      this.messageReducer.cancelHydration(hydration)
      throw error
    }
  }

  private createSessionSnapshot(sessionID: string, cwd: string, name: string | null): AgentSessionSnapshot {
    const records = this.messageReducer.records(sessionID)
    const lastAssistantMessage = [...records].reverse().find((record) => record.info.role === 'assistant')?.info ?? null
    const binding = this.sessionBindings.get(sessionID)
    if (binding) binding.lastAssistantMessageId = lastAssistantMessage?.id ?? null
    return {
      annotations: { fileChangesByEntryId: {} },
      messages: [],
      name,
      native: {
        agentId: 'opencode',
        diffs: this.sessionDiffs.get(sessionID) ?? [],
        messages: records,
        parentSessionId: binding?.parentSessionId ?? null,
        status: binding?.executionState ?? { type: 'idle' },
      },
      sessionId: sessionID,
      sessionPath: sessionID,
      workspacePath: cwd,
    }
  }

  private emitSessionSnapshot(sessionID: string) {
    this.clearScheduledSessionSnapshot(sessionID)
    const binding = this.sessionBindings.get(sessionID)
    if (!binding) return
    this.options.emitEvent({
      type: 'session_snapshot_updated',
      executionState: binding.executionState,
      session: this.createSessionSnapshot(sessionID, binding.cwd, binding.title),
      sessionId: sessionID,
    })
  }

  private scheduleSessionSnapshot(sessionID: string) {
    if (this.sessionSnapshotTimers.has(sessionID)) return
    this.sessionSnapshotTimers.set(sessionID, setTimeout(() => {
      this.sessionSnapshotTimers.delete(sessionID)
      this.emitSessionSnapshot(sessionID)
    }, OPEN_CODE_SNAPSHOT_COALESCE_MS))
  }

  private clearScheduledSessionSnapshot(sessionID: string) {
    const timer = this.sessionSnapshotTimers.get(sessionID)
    if (!timer) return
    clearTimeout(timer)
    this.sessionSnapshotTimers.delete(sessionID)
  }

  private async buildRuntime(client: OpencodeClient, cwd: string | null, sessionID: string | null): Promise<AgentWorkspaceState['runtime']> {
    const response = await client.config.providers(cwd ? { directory: cwd } : undefined, { throwOnError: true })
    const providerConfig = unwrapSdkResult<{ default: Record<string, string>, providers: Provider[] }>(response, 'list providers')
    const models = providerConfig.providers.flatMap((provider) => (
      Object.values(provider.models).map((model) => ({ key: `${provider.id}/${model.id}`, model, provider }))
    ))
    const binding = sessionID ? this.sessionBindings.get(sessionID) ?? null : null
    const defaultModel = Object.entries(providerConfig.default)
      .map(([providerID, modelID]) => `${providerID}/${modelID}`)
      .find((key) => models.some((model) => model.key === key))
      ?? models[0]?.key
      ?? null
    const selectedModel = binding?.selectedModel ?? defaultModel
    const selected = parseModelKey(selectedModel)
    const selectedProvider = selected
      ? providerConfig.providers.find((provider) => provider.id === selected.providerID) ?? null
      : null
    const levels = selectedProvider && selected
      ? supportedThinkingLevels(selectedProvider, selected.modelID)
      : ['off'] as AgentThinkingLevel[]
    const availableThinkingLevelsByModel = Object.fromEntries(models.map(({ key, model, provider }) => (
      [key, supportedThinkingLevels(provider, model.id)]
    )))

    return {
      agentId: 'opencode',
      auth: {},
      availableModelInputs: Object.fromEntries(models.map(({ key, model }) => (
        [key, model.capabilities.input.image ? ['text', 'image'] : ['text']]
      ))),
      availableModels: models.map((model) => model.key),
      availableThinkingLevels: levels,
      availableThinkingLevelsByModel,
      compactionReason: null,
      defaultModel,
      defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
      executionState: binding?.executionState ?? { type: 'idle' },
      followUpMessageCount: 0,
      followUpMessages: [],
      followUpMode: 'all',
      hasConfiguredModels: models.length > 0,
      isCompacting: false,
      isStreaming: binding?.isStreaming ?? false,
      pendingMessageCount: 0,
      preferredModelByProvider: providerConfig.default,
      retryAttempt: 0,
      retryMaxAttempts: null,
      selectedModel,
      setupHint: models.length > 0 ? null : 'OpenCode 当前没有可用模型，请先在 OpenCode 中配置 Provider。',
      supportedRunningPromptBehaviors: ['steer'],
      supportsQueuedMessageEditing: false,
      steeringMessageCount: 0,
      steeringMessages: [],
      steeringMode: 'all',
      supportsThinking: levels.some((level) => level !== 'off'),
      thinkingLevel: binding?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      workspacePath: cwd,
    }
  }

  private async buildWorkspaceState(
    client: OpencodeClient,
    cwd: string,
    activeSessionID: string | null,
    knownSessions?: Session[],
  ): Promise<AgentWorkspaceState> {
    const sessions = knownSessions ?? await this.listSessions(client, cwd)
    const activeSession = activeSessionID
      ? await this.buildSessionSnapshot(client, cwd, activeSessionID)
      : null
    return {
      activeSession,
      runtime: await this.buildRuntime(client, cwd, activeSessionID),
      sessions: sessions.map(sessionListItem),
    }
  }

  private async broadcastWorkspaceState(cwd: string, activeSessionID: string | null) {
    const state = await this.buildWorkspaceState(await this.ensureClient(), cwd, activeSessionID)
    this.options.emitEvent({ type: 'workspace_state', state })
    return state
  }
}

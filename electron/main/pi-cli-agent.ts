import { createHash, randomUUID } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  getAgentDir as getPiAgentDir,
  SessionManager,
  SettingsManager,
  type SessionInfo,
} from '@earendil-works/pi-coding-agent'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentMessageFileChange,
  AgentPromptAttachment,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentWorkspaceState,
  PiWebAgentMessage,
} from '../../src/features/agent/types'
import { AtomicJsonStore } from './json-file-store'
import { prepareExternalCliEnvironment } from './external-cli-environment'
import { JsonLineProcess } from './json-line-process'
import {
  SessionRuntimeCoordinator,
  type SessionRuntimeLease,
} from './session-runtime-coordinator'

type JsonRecord = Record<string, unknown>

type PiCliSessionRecord = {
  createdAt: string
  cwd: string
  id: string
  materialized: boolean
  modelKey: string | null
  messageCount?: number
  name: string | null
  preview?: string | null
  sessionPath?: string | null
  thinkingLevel: AgentThinkingLevel
  updatedAt: string
}

type PiCliSessionIndex = {
  sessions: PiCliSessionRecord[]
  version: 1
}

type PiRpcModel = {
  id: string
  input?: string[]
  name?: string
  provider: string
  reasoning?: boolean
  thinkingLevelMap?: Partial<Record<AgentThinkingLevel, unknown>>
}

type PiRuntime = {
  isStreaming: boolean
  lease: SessionRuntimeLease
  models: PiRpcModel[]
  process: JsonLineProcess
  record: PiCliSessionRecord
  state: JsonRecord
}

type PiCliAgentManagerOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEventPayload) => void
  removeSessionFile?: (sessionPath: string) => Promise<void>
}

const DEFAULT_INDEX: PiCliSessionIndex = { sessions: [], version: 1 }
const THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

function workspaceIdentity(cwd: string) {
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function runtimeKey(cwd: string, sessionID: string) {
  return `${workspaceIdentity(cwd)}\0${sessionID}`
}

function workspaceRuntimeKeyPrefix(cwd: string) {
  return `${workspaceIdentity(cwd)}\0`
}

function pendingInteractionKey(runtimeKeyValue: string, requestID: string) {
  return `${runtimeKeyValue}\0${requestID}`
}

function normalizeNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeThinkingLevel(value: unknown): AgentThinkingLevel {
  return typeof value === 'string' && THINKING_LEVELS.includes(value as AgentThinkingLevel)
    ? value as AgentThinkingLevel
    : 'medium'
}

function normalizeIndex(value: unknown): PiCliSessionIndex {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions.flatMap((entry): PiCliSessionRecord[] => {
        const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {}
        const id = normalizeNullableString(record.id)
        const cwd = normalizeNullableString(record.cwd)
        if (!id || !cwd) return []
        const createdAt = normalizeNullableString(record.createdAt) ?? new Date(0).toISOString()
        return [{
          createdAt,
          cwd,
          id,
          materialized: typeof record.materialized === 'boolean' ? record.materialized : true,
          modelKey: normalizeNullableString(record.modelKey),
          name: normalizeNullableString(record.name),
          thinkingLevel: normalizeThinkingLevel(record.thinkingLevel),
          updatedAt: normalizeNullableString(record.updatedAt) ?? createdAt,
        }]
      })
    : []

  return { sessions, version: 1 }
}

function legacySessionDirectory(agentDir: string, cwd: string) {
  const identity = workspaceIdentity(cwd)
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 20)
  return path.join(agentDir, 'external', 'pi', 'sessions', hash)
}

function resolvePiSessionDirectory(cwd: string) {
  const environmentDirectory = normalizeNullableString(process.env.PI_CODING_AGENT_SESSION_DIR)
  const configuredDirectory = environmentDirectory ?? SettingsManager.create(cwd, getPiAgentDir()).getSessionDir()
  if (configuredDirectory) {
    if (configuredDirectory === '~') return os.homedir()
    if (configuredDirectory.startsWith('~/')) {
      return path.join(os.homedir(), configuredDirectory.slice(2))
    }
    return path.isAbsolute(configuredDirectory)
      ? configuredDirectory
      : path.resolve(cwd, configuredDirectory)
  }
  // Keep this encoding byte-for-byte compatible with PI's official
  // getDefaultSessionDir implementation (the helper is not part of the
  // package's public export surface in 0.75.x).
  const safePath = `--${cwd.replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`
  return path.join(getPiAgentDir(), 'sessions', safePath)
}

function permissionExtensionPath() {
  const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
  if (resourcesPath) {
    const packagedPath = path.join(resourcesPath, 'agent-extensions', 'pi-permission-gate.mjs')
    if (existsSync(packagedPath)) return packagedPath
  }
  return path.resolve(process.cwd(), 'resources', 'agent-extensions', 'pi-permission-gate.mjs')
}

function readResponseData(response: JsonRecord) {
  return response.data && typeof response.data === 'object' ? response.data as JsonRecord : {}
}

function textFromContent(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const candidate = part as Record<string, unknown>
      return candidate.type === 'text'
        ? [String(candidate.text ?? '')]
        : []
    })
    .filter(Boolean)
    .join('\n\n')
}

export function projectPiFileAnnotations(rawMessages: unknown) {
  const fileChangesByEntryId: Record<string, AgentMessageFileChange[]> = {}
  if (!Array.isArray(rawMessages)) return { fileChangesByEntryId }
  for (const entry of rawMessages) {
    if (!entry || typeof entry !== 'object') continue
    const message = entry as JsonRecord
    if (String(message.role ?? '') !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (!part || typeof part !== 'object') continue
      const toolCall = part as JsonRecord
      if (toolCall.type !== 'toolCall') continue
      const toolName = String(toolCall.name ?? toolCall.toolName ?? '')
      if (toolName !== 'write' && toolName !== 'edit') continue
      const args = toolCall.arguments && typeof toolCall.arguments === 'object'
        ? toolCall.arguments as JsonRecord
        : toolCall.input && typeof toolCall.input === 'object'
          ? toolCall.input as JsonRecord
          : {}
      const filePath = normalizeNullableString(args.path ?? args.filePath)
      const toolCallId = normalizeNullableString(toolCall.id ?? toolCall.toolCallId)
      if (filePath && toolCallId) {
        fileChangesByEntryId[toolCallId] = [{ filePath, kind: 'updated' }]
      }
    }
  }
  return { fileChangesByEntryId }
}

function summarizeToolPayload(message: JsonRecord, resultKey: 'partialResult' | 'result') {
  const result = message[resultKey]
  if (result && typeof result === 'object') {
    const content = (result as JsonRecord).content
    const text = textFromContent(content)
    if (text) return text
  }
  const args = message.args
  if (args && typeof args === 'object') {
    const candidate = args as JsonRecord
    return String(candidate.command ?? candidate.path ?? JSON.stringify(candidate))
  }
  return String(message.toolName ?? 'tool')
}

export class PiCliAgentManager {
  private readonly index: AtomicJsonStore<PiCliSessionIndex>
  private readonly pendingInteractions = new Map<string, {
    lease: SessionRuntimeLease
    method: 'confirm' | 'editor' | 'input' | 'select'
    optionValues?: Record<string, string>
    process: JsonLineProcess
    requestId: string
    runtimeKey: string
    sessionId: string
  }>()
  private disposed = false
  private readonly initializingProcesses = new Set<JsonLineProcess>()
  private readonly legacyMigrations = new Map<string, Promise<void>>()
  private readonly runtimeCoordinator: SessionRuntimeCoordinator<PiRuntime>
  private readonly workspaceActiveSessions = new Map<string, string>()
  private readonly workspaceStateRevisions = new Map<string, number>()

  constructor(private readonly options: PiCliAgentManagerOptions) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_INDEX),
      filePath: path.join(options.agentDir, 'external', 'pi', 'sessions.json'),
      normalize: normalizeIndex,
    })
    this.runtimeCoordinator = new SessionRuntimeCoordinator({
      stopRuntime: (runtime) => runtime.process.stop(),
    })
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    const runtime = await this.createEphemeralRuntime(process.cwd())
    try {
      return { activeSession: null, runtime: this.serializeRuntime(null, runtime), sessions: [] }
    } finally {
      await this.runtimeCoordinator.retireLease(runtime.lease)
    }
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null, options: { restoreSession?: boolean } = {}) {
    const records = await this.listRecords(cwd)
    const identity = workspaceIdentity(cwd)
    const activeID = options.restoreSession === false
      ? null
      : [preferredSessionPath, this.workspaceActiveSessions.get(identity), records[0]?.id]
          .find((candidate): candidate is string => Boolean(candidate && records.some((record) => record.id === candidate)))
        ?? null
    if (!activeID) return this.buildWorkspaceState(cwd, null)
    return this.withRuntime(cwd, activeID, async (runtime) => {
      const state = await this.buildWorkspaceState(cwd, activeID, runtime)
      this.workspaceActiveSessions.set(identity, activeID)
      return state
    })
  }

  async listSessionItems(cwd: string) {
    return (await this.listRecords(cwd)).map((record) => ({
      createdAt: record.createdAt,
      id: record.id,
      messageCount: record.messageCount ?? 0,
      modifiedAt: record.updatedAt,
      name: record.name,
      path: record.id,
      preview: record.name ?? record.preview ?? 'PI CLI session',
    }))
  }

  async readSession(cwd: string, sessionID: string) {
    return this.withRuntime(cwd, sessionID, (runtime) => this.serializeSession(runtime))
  }

  async sessionExists(cwd: string, sessionID: string) {
    return (await this.listRecords(cwd)).some((record) => record.id === sessionID)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    const normalizedOptions = typeof options === 'string' ? { name: options } : options
    const now = new Date().toISOString()
    const record: PiCliSessionRecord = {
      createdAt: now,
      cwd,
      id: randomUUID(),
      materialized: false,
      modelKey: normalizedOptions?.modelKey?.trim() || null,
      name: normalizedOptions?.name?.trim() || null,
      thinkingLevel: normalizedOptions?.thinkingLevel ?? 'medium',
      updatedAt: now,
    }
    await this.index.update((state) => ({ ...state, sessions: [record, ...state.sessions] }))
    try {
      await this.withRuntime(cwd, record.id, async (runtime) => {
        if (record.name) await runtime.process.request({ type: 'set_session_name', name: record.name })
        if (record.modelKey) await this.setRuntimeModel(runtime, record.modelKey)
        await runtime.process.request({ type: 'set_thinking_level', level: record.thinkingLevel })
        this.workspaceActiveSessions.set(workspaceIdentity(cwd), record.id)
      }, { allowCreate: true })
      return await this.broadcastWorkspaceState(cwd, record.id)
    } catch (error) {
      await this.runtimeCoordinator.retire(runtimeKey(cwd, record.id)).catch(() => undefined)
      await this.index.update((state) => ({
        ...state,
        sessions: state.sessions.filter((session) => session.id !== record.id),
      }))
      throw error
    }
  }

  async openSession(cwd: string, sessionID: string) {
    await this.withRuntime(cwd, sessionID, () => {
      this.workspaceActiveSessions.set(workspaceIdentity(cwd), sessionID)
    })
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  async deleteSession(cwd: string, sessionID: string) {
    const nextActiveSessionID = await this.runtimeCoordinator.retireAndRun(runtimeKey(cwd, sessionID), async (retired) => {
      const record = retired
        ? this.requireRuntimeWorkspace(retired.runtime, cwd).record
        : await this.requireRecord(cwd, sessionID)
      this.clearPendingInteractions((pending) => pending.runtimeKey === runtimeKey(cwd, sessionID))
      if (record.sessionPath) {
        if (this.options.removeSessionFile) await this.options.removeSessionFile(record.sessionPath)
        else await rm(record.sessionPath, { force: true })
      }
      await this.index.update((state) => ({
        ...state,
        sessions: state.sessions.filter((session) => session.id !== sessionID),
      }))
      const identity = workspaceIdentity(cwd)
      const activeSessionID = this.workspaceActiveSessions.get(identity) ?? null
      if (activeSessionID === sessionID) this.workspaceActiveSessions.delete(identity)
      return activeSessionID === sessionID ? null : activeSessionID
    })
    return this.broadcastWorkspaceState(cwd, nextActiveSessionID)
  }

  async renameSession(cwd: string, sessionID: string, name: string) {
    const nextName = name.trim()
    if (!nextName) throw new Error('PI CLI 会话名称不能为空。')
    await this.withRuntime(cwd, sessionID, async (runtime) => {
      await this.requireRecord(cwd, sessionID)
      await runtime.process.request({ type: 'set_session_name', name: nextName })
      runtime.record.name = nextName
      await this.index.update((state) => ({
        ...state,
        sessions: state.sessions.map((record) => record.id === sessionID
          ? { ...record, name: nextName, updatedAt: new Date().toISOString() }
          : record),
      }))
    })
    return this.broadcastWorkspaceState(
      cwd,
      this.workspaceActiveSessions.get(workspaceIdentity(cwd)) ?? null,
    )
  }

  async sendPrompt(cwd: string, sessionID: string, prompt: string, streamingBehavior?: AgentRunningPromptBehavior, attachments: AgentPromptAttachment[] = []) {
    const result = await this.withRuntime(cwd, sessionID, async (runtime) => {
      const images = attachments.flatMap((attachment) => {
        if (attachment.kind !== 'image' || !attachment.data) return []
        const match = attachment.data.match(/^data:([^;]+);base64,(.+)$/)
        return match ? [{ type: 'image', data: match[2], mimeType: match[1] }] : []
      })
      const fileReferences = attachments
        .filter((attachment) => attachment.path && !(attachment.kind === 'image' && attachment.data))
        .map((attachment) => `\n\nAttached file: ${attachment.path}`)
        .join('')
      runtime.isStreaming = true
      try {
        await runtime.process.request({
          type: 'prompt',
          message: `${prompt}${fileReferences}`,
          ...(images.length > 0 ? { images } : {}),
          ...(streamingBehavior ? { streamingBehavior } : {}),
        })
        if (!runtime.record.materialized) {
          runtime.record.materialized = true
          await this.updateRecord(runtime.record).catch((error) => {
            this.options.emitEvent({
              type: 'error',
              message: `PI CLI 会话索引更新失败：${error instanceof Error ? error.message : String(error)}`,
              sessionId: runtime.record.id,
            })
          })
        }
        await this.touchRecord(runtime).catch(() => undefined)
        return { ok: true }
      } catch (error) {
        runtime.isStreaming = false
        throw error
      }
    })
    await this.broadcastWorkspaceState(cwd, sessionID).catch(() => undefined)
    return result
  }

  async selectModel(cwd: string, sessionID: string, modelKey: string) {
    await this.withRuntime(cwd, sessionID, async (runtime) => {
      await this.setRuntimeModel(runtime, modelKey)
      runtime.record.modelKey = modelKey
      await this.updateRecord(runtime.record)
    })
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  async selectThinkingLevel(cwd: string, sessionID: string, level: string, modelKey?: string) {
    const thinkingLevel = normalizeThinkingLevel(level)
    await this.withRuntime(cwd, sessionID, async (runtime) => {
      if (modelKey) {
        await this.setRuntimeModel(runtime, modelKey)
        runtime.record.modelKey = modelKey
      }
      await runtime.process.request({ type: 'set_thinking_level', level: thinkingLevel })
      runtime.record.thinkingLevel = thinkingLevel
      await this.updateRecord(runtime.record)
      await this.refreshRuntime(runtime)
    })
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  async abortActivePrompt(cwd: string, sessionID: string) {
    await this.withRuntime(cwd, sessionID, async (runtime) => {
      await runtime.process.request({ type: 'abort' })
      runtime.isStreaming = false
      await this.refreshRuntime(runtime)
    })
    return this.broadcastWorkspaceState(cwd, sessionID)
  }

  respondToInteraction(response: AgentInteractionResponse) {
    const matches = [...this.pendingInteractions.entries()].filter(([, pending]) => (
      pending.sessionId === response.sessionId
      && pending.requestId === response.requestId
      && pending.lease.isCurrent()
    ))
    if (matches.length !== 1) return false
    const [interactionKey, pending] = matches[0]
    const cancelled = response.optionId === 'deny' || response.optionId === 'reject'
    const value = pending.method === 'select'
      ? pending.optionValues?.[response.optionId]
      : response.values?.[0] ?? Object.values(response.answers ?? {})[0]?.[0]
    pending.process.notify(pending.method === 'confirm'
      ? {
          type: 'extension_ui_response',
          id: response.requestId,
          ...(cancelled
            ? { cancelled: true }
            : { confirmed: response.optionId === 'allow_once' || response.optionId === 'allow' }),
        }
      : {
          type: 'extension_ui_response',
          id: response.requestId,
          ...(cancelled || value === undefined ? { cancelled: true } : { value }),
        })
    this.pendingInteractions.delete(interactionKey)
    this.options.emitEvent({
      type: 'interaction_resolved',
      requestId: response.requestId,
      resumeRun: true,
      sessionId: pending.sessionId,
    })
    return true
  }

  async releaseWorkspaceRuntime(cwd: string) {
    const identity = workspaceIdentity(cwd)
    const prefix = workspaceRuntimeKeyPrefix(cwd)
    this.workspaceActiveSessions.delete(identity)
    this.invalidateWorkspaceState(identity)
    try {
      await this.runtimeCoordinator.retireWhere((key) => key.startsWith(prefix))
    } finally {
      this.clearPendingInteractions((pending) => pending.runtimeKey.startsWith(prefix))
    }
  }

  async discardWorkspaceSessions(cwd: string) {
    // Draft cleanup is restricted to sessions created by Aryn. Sessions found
    // only in PI's official store remain untouched.
    const records = await this.listOwnedRecords(cwd)
    const officialRecords = await this.listRecords(cwd)
    const officialById = new Map(officialRecords.map((record) => [record.id, record]))
    await Promise.all(records.map((record) => this.runtimeCoordinator.retireAndRun(
      runtimeKey(cwd, record.id),
      async () => {
        this.clearPendingInteractions((pending) => pending.runtimeKey === runtimeKey(cwd, record.id))
        const sessionPath = officialById.get(record.id)?.sessionPath
        if (sessionPath) await rm(sessionPath, { force: true })
      },
    )))
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.filter((record) => workspaceIdentity(record.cwd) !== workspaceIdentity(cwd)),
    }))
    const identity = workspaceIdentity(cwd)
    this.workspaceActiveSessions.delete(identity)
    this.invalidateWorkspaceState(identity)
  }

  dispose() {
    this.disposed = true
    for (const processHandle of this.initializingProcesses) processHandle.stop()
    this.initializingProcesses.clear()
    void this.runtimeCoordinator.dispose()
    this.pendingInteractions.clear()
    this.legacyMigrations.clear()
    this.workspaceActiveSessions.clear()
    this.workspaceStateRevisions.clear()
  }

  drainSessionEvents(cwd: string, sessionID: string) {
    return this.runtimeCoordinator.drain(runtimeKey(cwd, sessionID))
  }

  private async createEphemeralRuntime(cwd: string) {
    const now = new Date().toISOString()
    const record: PiCliSessionRecord = {
      createdAt: now,
      cwd,
      id: randomUUID(),
      materialized: false,
      modelKey: null,
      name: null,
      thinkingLevel: 'medium',
      updatedAt: now,
    }
    return this.runtimeCoordinator.use(
      runtimeKey(record.cwd, record.id),
      (lease) => this.startRuntime(record, lease, true),
      ({ runtime }) => runtime,
    )
  }

  private async startRuntime(
    record: PiCliSessionRecord,
    lease: SessionRuntimeLease,
    ephemeral = false,
    allowCreate = false,
  ) {
    await prepareExternalCliEnvironment()
    const args = [
      '--mode', 'rpc',
      '--no-approve',
      ...(ephemeral
        ? ['--no-session']
        : allowCreate
          ? ['--session-id', record.id]
          : ['--session', record.id]),
      '--extension', permissionExtensionPath(),
    ]
    let runtime: PiRuntime
    const processHandle = new JsonLineProcess({
      args,
      command: 'pi',
      cwd: record.cwd,
      onEvent: (message) => {
        if (!runtime) return
        lease.enqueue(
          () => this.handleEvent(runtime, message),
          (error) => {
            this.options.emitEvent({
              type: 'error',
              message: `PI CLI 事件处理失败：${error instanceof Error ? error.message : String(error)}`,
              sessionId: runtime.record.id,
            })
          },
        )
      },
      ...(!ephemeral ? {
        onExit: (error: Error) => {
          if (runtime) this.handleRuntimeExit(runtime, error)
        },
      } : {}),
    })
    runtime = { isStreaming: false, lease, models: [], process: processHandle, record, state: {} }
    this.initializingProcesses.add(processHandle)
    try {
      processHandle.start()
      await this.refreshRuntime(runtime)
    } catch (error) {
      processHandle.stop()
      throw error
    } finally {
      this.initializingProcesses.delete(processHandle)
    }
    if (this.disposed || !lease.isCurrent()) {
      processHandle.stop()
      throw new Error('PI CLI runtime was invalidated during session initialization.')
    }
    return runtime
  }

  private async refreshRuntime(runtime: PiRuntime) {
    const [stateResponse, modelsResponse] = await Promise.all([
      runtime.process.request({ type: 'get_state' }),
      runtime.process.request({ type: 'get_available_models' }, 30_000),
    ])
    runtime.state = readResponseData(stateResponse)
    const modelData = readResponseData(modelsResponse)
    runtime.models = Array.isArray(modelData.models) ? modelData.models as PiRpcModel[] : []
    runtime.isStreaming = runtime.state.isStreaming === true
  }

  private async handleEvent(runtime: PiRuntime, message: JsonRecord) {
    const type = String(message.type ?? '')
    const sessionId = runtime.record.id
    this.options.emitEvent({
      type: 'pi_native_event',
      event: message as { type: string; [key: string]: unknown },
      sessionId,
    })
    if (type === 'agent_start') {
      runtime.isStreaming = true
      this.options.emitEvent({ type: 'assistant_message_started', sessionId })
      return
    }
    if (type === 'message_start') {
      const messageValue = message.message && typeof message.message === 'object'
        ? message.message as JsonRecord
        : null
      if (messageValue && String(messageValue.role ?? '') === 'assistant') {
        this.options.emitEvent({ type: 'assistant_message_started', sessionId })
      }
      return
    }
    if (type === 'message_update') {
      const event = message.assistantMessageEvent
      if (!event || typeof event !== 'object') return
      const update = event as JsonRecord
      if (update.type === 'text_delta' && typeof update.delta === 'string') {
        this.options.emitEvent({ type: 'assistant_message_delta', delta: update.delta, sessionId })
      } else if (update.type === 'thinking_delta' && typeof update.delta === 'string') {
        this.options.emitEvent({ type: 'assistant_thinking_delta', delta: update.delta, sessionId })
      } else if (update.type === 'thinking_end') {
        this.options.emitEvent({ type: 'assistant_thinking_finished', sessionId })
      }
      return
    }
    if (type === 'tool_execution_start' || type === 'tool_execution_update' || type === 'tool_execution_end') {
      const toolCallId = String(message.toolCallId ?? randomUUID())
      const toolName = String(message.toolName ?? 'tool')
      if (type === 'tool_execution_end') {
        this.options.emitEvent({
          type: 'tool_execution_finished',
          isError: message.isError === true,
          sessionId,
          summary: summarizeToolPayload(message, 'result'),
          toolCallId,
          toolName,
        })
      } else {
        this.options.emitEvent({
          type: type === 'tool_execution_start' ? 'tool_execution_started' : 'tool_execution_updated',
          sessionId,
          summary: summarizeToolPayload(message, type === 'tool_execution_start' ? 'result' : 'partialResult'),
          toolCallId,
          toolName,
        })
      }
      return
    }
    if (type === 'message_end') {
      const messageValue = message.message && typeof message.message === 'object' ? message.message as JsonRecord : null
      const errorMessage = messageValue && String(messageValue.role ?? '') === 'assistant'
        ? normalizeNullableString(messageValue.errorMessage)
        : null
      if (errorMessage) {
        this.options.emitEvent({ type: 'error', message: errorMessage, sessionId })
      }
      return
    }
    if (type === 'agent_end') {
      runtime.isStreaming = false
      this.clearPendingInteractions((pending) => pending.lease === runtime.lease)
      await this.refreshRuntime(runtime).catch(() => undefined)
      if (!runtime.lease.isCurrent()) return
      await this.touchRecord(runtime)
      if (!runtime.lease.isCurrent()) return
      await this.broadcastWorkspaceState(runtime.record.cwd, sessionId, runtime, runtime.lease)
      return
    }
    if (type === 'queue_update') {
      runtime.state.steering = Array.isArray(message.steering) ? message.steering.map(String) : []
      runtime.state.followUp = Array.isArray(message.followUp) ? message.followUp.map(String) : []
      runtime.state.pendingMessageCount = (runtime.state.steering as string[]).length
        + (runtime.state.followUp as string[]).length
      await this.broadcastWorkspaceState(runtime.record.cwd, sessionId, runtime, runtime.lease)
      return
    }
    if (type === 'compaction_start') {
      runtime.state.isCompacting = true
      runtime.state.compactionReason = message.reason
      await this.broadcastWorkspaceState(runtime.record.cwd, sessionId, runtime, runtime.lease)
      return
    }
    if (type === 'compaction_end') {
      runtime.state.isCompacting = false
      runtime.state.compactionReason = null
      await this.broadcastWorkspaceState(runtime.record.cwd, sessionId, runtime, runtime.lease)
      return
    }
    if (type === 'auto_retry_start') {
      runtime.state.retryAttempt = typeof message.attempt === 'number' ? message.attempt : 0
      runtime.state.retryMaxAttempts = typeof message.maxAttempts === 'number' ? message.maxAttempts : null
      await this.broadcastWorkspaceState(runtime.record.cwd, sessionId, runtime, runtime.lease)
      return
    }
    if (type === 'auto_retry_end') {
      runtime.state.retryAttempt = 0
      runtime.state.retryMaxAttempts = null
      await this.broadcastWorkspaceState(runtime.record.cwd, sessionId, runtime, runtime.lease)
      return
    }
    if (
      type === 'extension_ui_request'
      && (message.method === 'confirm' || message.method === 'select' || message.method === 'input' || message.method === 'editor')
    ) {
      const requestId = String(message.id ?? randomUUID())
      const method = message.method
      const selectOptions = method === 'select' && Array.isArray(message.options)
        ? message.options.map(String)
        : []
      const optionValues = Object.fromEntries(selectOptions.map((option, index) => [`select:${index}`, option]))
      this.pendingInteractions.set(pendingInteractionKey(runtime.lease.key, requestId), {
        lease: runtime.lease,
        method,
        ...(selectOptions.length > 0 ? { optionValues } : {}),
        process: runtime.process,
        requestId,
        runtimeKey: runtime.lease.key,
        sessionId,
      })
      this.options.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'pi',
          id: requestId,
          kind: method === 'confirm' ? 'permission' : 'question',
          message: String(message.message ?? message.placeholder ?? message.prefill ?? 'PI 扩展需要你的输入。'),
          ...(method === 'input' || method === 'editor'
            ? {
                fields: [{
                  id: 'value',
                  label: String(message.title ?? 'PI 输入'),
                  message: String(message.message ?? message.placeholder ?? ''),
                  multiline: method === 'editor',
                }],
              }
            : {}),
          options: method === 'confirm'
            ? [
                { id: 'deny', label: '拒绝' },
                { id: 'allow_once', label: '允许本次' },
              ]
            : method === 'select'
              ? [
                  ...selectOptions.map((option, index) => ({ id: `select:${index}`, label: option })),
                  { id: 'reject', label: '取消' },
                ]
              : [{ id: 'reject', label: '取消' }],
          sessionId,
          title: String(message.title ?? (method === 'confirm' ? 'PI 请求执行工具' : 'PI 提问')),
          workspacePath: runtime.record.cwd,
        },
      })
      return
    }
    if (type === 'extension_error' || type === 'protocol_error') {
      this.options.emitEvent({ type: 'error', message: String(message.error ?? message.message ?? 'PI extension failed.'), sessionId })
    }
  }

  private handleRuntimeExit(runtime: PiRuntime, error: Error) {
    runtime.isStreaming = false
    void this.runtimeCoordinator.retireLease(runtime.lease).then((retired) => {
      if (!retired || this.disposed) return
      this.clearPendingInteractions((pending) => pending.lease === runtime.lease)
      this.options.emitEvent({
        type: 'error',
        message: `PI CLI 会话进程已退出：${error.message}`,
        sessionId: runtime.record.id,
      })
    }).catch((retireError) => {
      if (this.disposed) return
      this.options.emitEvent({
        type: 'error',
        message: `PI CLI 退出清理失败：${retireError instanceof Error ? retireError.message : String(retireError)}`,
        sessionId: runtime.record.id,
      })
    })
  }

  private clearPendingInteractions(predicate: (pending: {
    lease: SessionRuntimeLease
    method: 'confirm' | 'editor' | 'input' | 'select'
    optionValues?: Record<string, string>
    process: JsonLineProcess
    requestId: string
    runtimeKey: string
    sessionId: string
  }) => boolean) {
    for (const [interactionKey, pending] of this.pendingInteractions) {
      if (!predicate(pending)) continue
      this.pendingInteractions.delete(interactionKey)
      this.options.emitEvent({
        type: 'interaction_resolved',
        requestId: pending.requestId,
        resumeRun: false,
        sessionId: pending.sessionId,
      })
    }
  }

  private async serializeSession(runtime: PiRuntime): Promise<AgentSessionSnapshot> {
    const response = await runtime.process.request({ type: 'get_messages' })
    const data = readResponseData(response)
    const nativeMessages = Array.isArray(data.messages)
      ? data.messages.filter((message): message is PiWebAgentMessage => (
          Boolean(message)
          && typeof message === 'object'
          && typeof (message as { role?: unknown }).role === 'string'
        ))
      : []
    return {
      annotations: projectPiFileAnnotations(data.messages),
      messages: [],
      native: {
        agentId: 'pi',
        entryIds: nativeMessages.map((message) => (
          typeof message.id === 'string' ? message.id : ''
        )),
        isStreaming: runtime.isStreaming,
        messages: nativeMessages,
        modelNames: Object.fromEntries(runtime.models.flatMap((model) => {
          if (!model.id || !model.provider) return []
          const label = model.name?.trim() || model.id
          return [
            [`${model.provider}:${model.id}`, label],
            [model.id, label],
          ]
        })),
        sessionId: runtime.record.id,
      },
      name: runtime.record.name,
      sessionId: runtime.record.id,
      sessionPath: runtime.record.id,
      workspacePath: runtime.record.cwd,
    }
  }

  private serializeRuntime(cwd: string | null, runtime: PiRuntime): AgentWorkspaceState['runtime'] {
    const models = runtime.models.filter((model) => model?.id && model?.provider)
    const availableModels = models.map((model) => `${model.provider}/${model.id}`)
    const levelsByModel: Record<string, AgentThinkingLevel[]> = Object.fromEntries(models.map((model) => {
      const mapped: AgentThinkingLevel[] = model.reasoning === false
        ? ['off']
        : model.thinkingLevelMap
          ? THINKING_LEVELS.filter((level) => level === 'off' || Object.prototype.hasOwnProperty.call(model.thinkingLevelMap, level))
          : THINKING_LEVELS
      return [`${model.provider}/${model.id}`, mapped]
    }))
    const stateModel = runtime.state.model && typeof runtime.state.model === 'object'
      ? runtime.state.model as JsonRecord
      : null
    const selectedModel = stateModel?.provider && stateModel.id
      ? `${stateModel.provider}/${stateModel.id}`
      : runtime.record.modelKey
    const selectedLevels: AgentThinkingLevel[] = selectedModel ? levelsByModel[selectedModel] ?? ['off'] : ['off']
    const preferredModelByProvider: Record<string, string> = {}
    const steeringMessages = Array.isArray(runtime.state.steering) ? runtime.state.steering.map(String) : []
    const followUpMessages = Array.isArray(runtime.state.followUp) ? runtime.state.followUp.map(String) : []
    for (const model of models) {
      preferredModelByProvider[model.provider] ??= model.id
    }

    return {
      agentId: 'pi',
      auth: {},
      availableModelInputs: Object.fromEntries(models.map((model) => [
        `${model.provider}/${model.id}`,
        model.input?.includes('image') ? ['text', 'image'] : ['text'],
      ])),
      availableModels,
      availableThinkingLevels: selectedLevels,
      availableThinkingLevelsByModel: levelsByModel,
      compactionReason: runtime.state.compactionReason === 'manual'
        || runtime.state.compactionReason === 'overflow'
        || runtime.state.compactionReason === 'threshold'
        ? runtime.state.compactionReason
        : null,
      defaultModel: selectedModel ?? availableModels[0] ?? null,
      defaultThinkingLevel: normalizeThinkingLevel(runtime.state.thinkingLevel ?? runtime.record.thinkingLevel),
      followUpMessageCount: followUpMessages.length,
      followUpMessages,
      followUpMode: runtime.state.followUpMode === 'all' ? 'all' : 'one-at-a-time',
      hasConfiguredModels: availableModels.length > 0,
      isCompacting: runtime.state.isCompacting === true,
      isStreaming: runtime.isStreaming,
      pendingMessageCount: typeof runtime.state.pendingMessageCount === 'number' ? runtime.state.pendingMessageCount : 0,
      preferredModelByProvider,
      retryAttempt: typeof runtime.state.retryAttempt === 'number' ? runtime.state.retryAttempt : 0,
      retryMaxAttempts: typeof runtime.state.retryMaxAttempts === 'number' ? runtime.state.retryMaxAttempts : null,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : 'PI CLI 当前没有可用模型，请先通过 PI 配置 Provider。',
      supportedRunningPromptBehaviors: ['steer', 'followUp'],
      supportsQueuedMessageEditing: false,
      steeringMessageCount: steeringMessages.length,
      steeringMessages,
      steeringMode: runtime.state.steeringMode === 'all' ? 'all' : 'one-at-a-time',
      supportsThinking: selectedLevels.some((level) => level !== 'off'),
      thinkingLevel: normalizeThinkingLevel(runtime.state.thinkingLevel ?? runtime.record.thinkingLevel),
      workspacePath: cwd,
    }
  }

  private async buildWorkspaceState(
    cwd: string,
    activeSessionID: string | null,
    providedRuntime?: PiRuntime,
  ): Promise<AgentWorkspaceState> {
    const records = await this.listRecords(cwd)
    if (activeSessionID && providedRuntime?.record.id !== activeSessionID) {
      return this.withRuntime(
        cwd,
        activeSessionID,
        (runtime) => this.buildWorkspaceState(cwd, activeSessionID, runtime),
      )
    }
    const activeRuntime = activeSessionID && providedRuntime
      ? this.requireRuntimeWorkspace(providedRuntime, cwd)
      : null
    const draftRuntime = activeRuntime ?? await this.createEphemeralRuntime(cwd)
    try {
      return {
        activeSession: activeRuntime ? await this.serializeSession(activeRuntime) : null,
        runtime: this.serializeRuntime(cwd, draftRuntime),
        sessions: records.map((record) => ({
          createdAt: record.createdAt,
          id: record.id,
          messageCount: record.messageCount ?? 0,
          modifiedAt: record.updatedAt,
          name: record.name,
          path: record.id,
          preview: record.name ?? record.preview ?? 'PI CLI session',
        })),
      }
    } finally {
      if (!activeRuntime) await this.runtimeCoordinator.retireLease(draftRuntime.lease)
    }
  }

  private async broadcastWorkspaceState(
    cwd: string,
    requestedActiveSessionID: string | null,
    providedRuntime?: PiRuntime,
    sourceLease?: SessionRuntimeLease,
  ) {
    const identity = workspaceIdentity(cwd)
    const activeSessionID = sourceLease
      ? this.workspaceActiveSessions.get(identity) ?? null
      : requestedActiveSessionID
    const revision = (this.workspaceStateRevisions.get(identity) ?? 0) + 1
    this.workspaceStateRevisions.set(identity, revision)
    const state = await this.buildWorkspaceState(cwd, activeSessionID, providedRuntime)
    if (
      this.workspaceStateRevisions.get(identity) === revision
      && (!sourceLease || sourceLease.isCurrent())
    ) {
      this.options.emitEvent({ type: 'workspace_state', state })
    }
    return state
  }

  private invalidateWorkspaceState(identity: string) {
    this.workspaceStateRevisions.set(identity, (this.workspaceStateRevisions.get(identity) ?? 0) + 1)
  }

  private async listRecords(cwd: string) {
    await this.ensureLegacySessionsMigrated(cwd)
    const indexedRecords = await this.listOwnedRecords(cwd)
    const indexedById = new Map(indexedRecords.map((record) => [record.id, record]))
    const officialRecords = await this.listOfficialRecords(cwd, indexedById)
    const officialIds = new Set(officialRecords.map((record) => record.id))
    const liveOrUnmaterializedDrafts = indexedRecords.filter((record) => (
      !officialIds.has(record.id)
      && (!record.materialized || Boolean(this.runtimeCoordinator.current(runtimeKey(record.cwd, record.id))))
    ))
    return [...officialRecords, ...liveOrUnmaterializedDrafts]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  private async listOfficialRecords(
    cwd: string,
    indexedById: Map<string, PiCliSessionRecord>,
  ) {
    const sessionDir = resolvePiSessionDirectory(cwd)
    const infos = await SessionManager.list(cwd, sessionDir)
    return infos
      .filter((info) => !info.cwd || workspaceIdentity(info.cwd) === workspaceIdentity(cwd))
      .map((info) => this.officialSessionRecord(cwd, info, indexedById.get(info.id)))
  }

  private officialSessionRecord(
    cwd: string,
    info: SessionInfo,
    indexed: PiCliSessionRecord | undefined,
  ): PiCliSessionRecord {
    return {
      createdAt: info.created.toISOString(),
      cwd: info.cwd || cwd,
      id: info.id,
      materialized: true,
      messageCount: info.messageCount,
      modelKey: indexed?.modelKey ?? null,
      name: info.name?.trim() || null,
      preview: info.firstMessage?.trim() || null,
      sessionPath: info.path,
      thinkingLevel: indexed?.thinkingLevel ?? 'medium',
      updatedAt: info.modified.toISOString(),
    }
  }

  private async listOwnedRecords(cwd: string) {
    const identity = workspaceIdentity(cwd)
    return (await this.index.read()).sessions
      .filter((record) => workspaceIdentity(record.cwd) === identity)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  private async ensureLegacySessionsMigrated(cwd: string) {
    const identity = workspaceIdentity(cwd)
    const existing = this.legacyMigrations.get(identity)
    if (existing) return existing
    const migration = this.migrateLegacySessions(cwd).catch((error) => {
      this.legacyMigrations.delete(identity)
      throw error
    })
    this.legacyMigrations.set(identity, migration)
    return migration
  }

  private async migrateLegacySessions(cwd: string) {
    const sourceDir = legacySessionDirectory(this.options.agentDir, cwd)
    if (!existsSync(sourceDir)) return
    const legacySessions = await SessionManager.list(cwd, sourceDir)
    if (legacySessions.length === 0) return
    const targetDir = resolvePiSessionDirectory(cwd)
    await mkdir(targetDir, { recursive: true })
    const officialById = new Map((await SessionManager.list(cwd, targetDir)).map((info) => [info.id, info]))

    for (const legacy of legacySessions) {
      const existingOfficial = officialById.get(legacy.id)
      if (existingOfficial) {
        const [legacyContent, officialContent] = await Promise.all([
          readFile(legacy.path),
          readFile(existingOfficial.path),
        ])
        if (legacyContent.equals(officialContent)) {
          await rm(legacy.path, { force: true })
        } else {
          console.warn(`[pi cli] Legacy session ${legacy.id} conflicts with an official session and was left at ${legacy.path}.`)
        }
        continue
      }

      const targetPath = path.join(targetDir, path.basename(legacy.path))
      let copiedByMigration = false
      try {
        await copyFile(legacy.path, targetPath, constants.COPYFILE_EXCL)
        copiedByMigration = true
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
        if (code !== 'EEXIST') throw error
        const [legacyContent, targetContent] = await Promise.all([readFile(legacy.path), readFile(targetPath)])
        if (!legacyContent.equals(targetContent)) {
          console.warn(`[pi cli] Legacy session target already exists with different content: ${targetPath}`)
          continue
        }
      }

      const migrated = (await SessionManager.list(cwd, targetDir)).find((info) => (
        info.id === legacy.id && path.resolve(info.path) === path.resolve(targetPath)
      ))
      if (!migrated) {
        if (copiedByMigration) await rm(targetPath, { force: true })
        throw new Error(`PI CLI legacy session ${legacy.id} could not be verified in the official session directory.`)
      }
      officialById.set(migrated.id, migrated)
      await rm(legacy.path, { force: true })
    }

    const remaining = await readdir(sourceDir).catch(() => [])
    if (remaining.length === 0) await rm(sourceDir, { force: true, recursive: true })
  }

  private async requireRecord(cwd: string, sessionID: string) {
    const record = (await this.listRecords(cwd)).find((candidate) => candidate.id === sessionID)
    if (!record) throw new Error('PI CLI session not found for this workspace.')
    return record
  }

  private withRuntime<TResult>(
    cwd: string,
    sessionID: string,
    operation: (runtime: PiRuntime) => Promise<TResult> | TResult,
    options: { allowCreate?: boolean } = {},
  ) {
    return this.runtimeCoordinator.use(
      runtimeKey(cwd, sessionID),
      async (lease) => {
        const record = await this.requireRecord(cwd, sessionID)
        return this.startRuntime(
          record,
          lease,
          false,
          options.allowCreate === true || !record.materialized,
        )
      },
      ({ runtime }) => operation(this.requireRuntimeWorkspace(runtime, cwd)),
    )
  }

  private requireRuntimeWorkspace(runtime: PiRuntime, cwd: string) {
    if (workspaceIdentity(runtime.record.cwd) !== workspaceIdentity(cwd)) {
      throw new Error('PI CLI session not found for this workspace.')
    }
    return runtime
  }

  private async setRuntimeModel(runtime: PiRuntime, modelKey: string) {
    const separator = modelKey.indexOf('/')
    if (separator <= 0 || separator === modelKey.length - 1) throw new Error(`Invalid PI model key "${modelKey}".`)
    await runtime.process.request({
      type: 'set_model',
      provider: modelKey.slice(0, separator),
      modelId: modelKey.slice(separator + 1),
    })
    await this.refreshRuntime(runtime)
  }

  private async updateRecord(record: PiCliSessionRecord) {
    record.updatedAt = new Date().toISOString()
    await this.index.update((state) => ({
      ...state,
      sessions: state.sessions.map((candidate) => candidate.id === record.id
        ? {
            createdAt: record.createdAt,
            cwd: record.cwd,
            id: record.id,
            materialized: record.materialized,
            modelKey: record.modelKey,
            name: record.name,
            thinkingLevel: record.thinkingLevel,
            updatedAt: record.updatedAt,
          }
        : candidate),
    }))
  }

  private async touchRecord(runtime: PiRuntime) {
    if (runtime.lease.isCurrent()) await this.updateRecord(runtime.record)
  }
}

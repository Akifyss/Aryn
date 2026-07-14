import path from 'node:path'
import { getAgentInteractionKey } from '../../src/features/agent/types'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentMessageAttachment,
  AgentMessageFileChange,
  AgentPromptAttachment,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentThinkingLevel,
  AgentWorkspaceState,
} from '../../src/features/agent/types'
import { AtomicJsonStore } from './json-file-store'
import { prepareExternalCliEnvironment } from './external-cli-environment'
import { JsonLineProcess } from './json-line-process'

type JsonRecord = Record<string, unknown>

export type CodexThreadRecord = {
  createdAt: string
  cwd: string
  id: string
  materialized: boolean
  model: string | null
  modelExplicit: boolean
  name: string | null
  reasoningEffort: AgentThinkingLevel
  updatedAt: string
}

type CodexThreadIndex = {
  threads: CodexThreadRecord[]
  version: 1
}

type CodexModel = {
  defaultReasoningEffort?: string
  displayName?: string
  hidden?: boolean
  id: string
  inputModalities?: string[]
  isDefault?: boolean
  model?: string
  supportedReasoningEfforts?: Array<{ reasoningEffort?: string }>
}

type CodexBinding = {
  activeTurnId: string | null
  isStreaming: boolean
  lastError: string | null
  queuedPrompts: Array<{ attachments: AgentPromptAttachment[], prompt: string }>
  record: CodexThreadRecord
}

type PendingCodexInteraction = {
  approvalProtocol?: 'legacy' | 'v2'
  kind: 'approval' | 'permissions' | 'question'
  originalId: unknown
  requestedPermissions?: JsonRecord
  questionIds?: string[]
  requestId: string
  sessionId: string
}

type CodexAgentManagerOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEventPayload) => void
}

const DEFAULT_INDEX: CodexThreadIndex = { threads: [], version: 1 }
const THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

function workspaceIdentity(cwd: string) {
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function codexErrorMessage(value: unknown): string | null {
  if (value && typeof value === 'object') {
    const error = value as JsonRecord
    return codexErrorMessage(error.message) ?? codexErrorMessage(error.error)
  }

  const message = nullableString(value)
  if (!message) return null
  if (message.startsWith('{') || message.startsWith('[')) {
    try {
      return codexErrorMessage(JSON.parse(message)) ?? message
    } catch {
      // Some providers return plain text that happens to start with punctuation.
    }
  }
  return message
}

function reasoningEffort(value: unknown): AgentThinkingLevel {
  if (value === 'none') return 'off'
  return typeof value === 'string' && THINKING_LEVELS.includes(value as AgentThinkingLevel)
    ? value as AgentThinkingLevel
    : 'medium'
}

function codexReasoningEffort(value: AgentThinkingLevel) {
  return value === 'off' ? 'none' : value
}

function codexModelThinkingLevels(model: CodexModel): AgentThinkingLevel[] {
  const levels = (model.supportedReasoningEfforts ?? [])
    .map((effort) => reasoningEffort(effort.reasoningEffort))
    .filter((effort, index, values) => values.indexOf(effort) === index)
  return levels.length > 0 ? levels : ['low', 'medium', 'high']
}

function normalizeIndex(value: unknown): CodexThreadIndex {
  const candidate = value && typeof value === 'object' ? value as JsonRecord : {}
  const threads = Array.isArray(candidate.threads)
    ? candidate.threads.flatMap((entry): CodexThreadRecord[] => {
        const thread = entry && typeof entry === 'object' ? entry as JsonRecord : {}
        const id = nullableString(thread.id)
        const cwd = nullableString(thread.cwd)
        if (!id || !cwd) return []
        const createdAt = nullableString(thread.createdAt) ?? new Date(0).toISOString()
        return [{
          createdAt,
          cwd,
          id,
          materialized: typeof thread.materialized === 'boolean' ? thread.materialized : true,
          model: nullableString(thread.model),
          modelExplicit: thread.modelExplicit === true,
          name: nullableString(thread.name),
          reasoningEffort: reasoningEffort(thread.reasoningEffort),
          updatedAt: nullableString(thread.updatedAt) ?? createdAt,
        }]
      })
    : []
  return { threads, version: 1 }
}

function resultData(response: JsonRecord) {
  const result = response.result
  if (!result || typeof result !== 'object') {
    throw new Error('Codex App Server returned no result.')
  }
  return result as JsonRecord
}

function contentText(value: unknown) {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap((item) => {
    if (typeof item === 'string') return [item]
    if (!item || typeof item !== 'object') return []
    const part = item as JsonRecord
    return typeof part.text === 'string' ? [part.text] : []
  }).join('\n\n')
}

function isTransientThreadReadError(message: string) {
  return message.includes('is not materialized yet')
    || (message.includes('failed to load rollout') && message.includes('is empty'))
}

function contentAttachments(value: unknown): AgentMessageAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index): AgentMessageAttachment[] => {
    if (!item || typeof item !== 'object') return []
    const part = item as JsonRecord
    if (part.type === 'image' && typeof part.url === 'string' && part.url) {
      const mimeType = part.url.match(/^data:([^;,]+)/)?.[1]
      return [{
        data: part.url,
        fileName: `image-${index + 1}`,
        kind: 'image',
        ...(mimeType ? { mimeType } : {}),
        status: 'sent',
      }]
    }
    if (part.type === 'localImage' && typeof part.path === 'string' && part.path) {
      return [{
        fileName: path.basename(part.path),
        kind: 'image',
        path: part.path,
        status: 'referenced',
      }]
    }
    return []
  })
}

function toolStatus(value: unknown): 'done' | 'error' | 'running' {
  const status = String(value ?? '').toLowerCase()
  if (status.includes('fail') || status.includes('error') || status.includes('declin')) return 'error'
  if (status.includes('complete') || status.includes('success')) return 'done'
  return 'running'
}

function projectCodexFileChanges(value: unknown): AgentMessageFileChange[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): AgentMessageFileChange[] => {
    const change = entry && typeof entry === 'object' ? entry as JsonRecord : {}
    const filePath = nullableString(change.path)
    if (!filePath) return []
    const rawKind = change.kind && typeof change.kind === 'object'
      ? String((change.kind as JsonRecord).type ?? '')
      : String(change.kind ?? '')
    return [{
      filePath,
      kind: rawKind === 'add' || rawKind === 'added'
        ? 'created'
        : rawKind === 'delete' || rawKind === 'deleted'
          ? 'deleted'
          : 'updated',
    }]
  })
}

function isServiceTierCompatibilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('service_tier') || (
    message.includes('unknown variant `default`')
    && message.includes('expected `fast` or `flex`')
  )
}

export function buildCodexPermissionApprovalResult(
  requestedPermissions: JsonRecord,
  optionId: string,
) {
  const approved = optionId === 'allow_once' || optionId === 'allow_always'
  return {
    permissions: approved ? requestedPermissions : {},
    scope: optionId === 'allow_always' ? 'session' : 'turn',
  }
}

export function buildCodexApprovalResult(optionId: string, protocol: 'legacy' | 'v2') {
  if (protocol === 'legacy') {
    return {
      decision: optionId === 'allow_always'
        ? 'approved_for_session'
        : optionId === 'allow_once'
          ? 'approved'
          : 'denied',
    }
  }
  return {
    decision: optionId === 'allow_always'
      ? 'acceptForSession'
      : optionId === 'allow_once'
        ? 'accept'
        : 'decline',
  }
}

export function projectCodexThread(thread: JsonRecord, record: CodexThreadRecord): AgentSessionSnapshot {
  const messages: AgentSidebarMessage[] = []
  const fileChangesByEntryId: Record<string, AgentMessageFileChange[]> = {}
  const turns = Array.isArray(thread.turns) ? thread.turns as JsonRecord[] : []
  let timestamp = Date.parse(record.createdAt)

  for (const turn of turns) {
    const items = Array.isArray(turn.items) ? turn.items as JsonRecord[] : []
    for (const item of items) {
      timestamp += 1
      const id = String(item.id ?? `${record.id}-${timestamp}`)
      const type = String(item.type ?? '')
      if (type === 'userMessage') {
        const attachments = contentAttachments(item.content)
        messages.push({
          ...(attachments.length > 0 ? { attachments } : {}),
          id,
          kind: 'user',
          text: contentText(item.content),
          timestamp,
        })
      } else if (type === 'agentMessage') {
        messages.push({ id, kind: 'assistant', status: 'done', text: String(item.text ?? ''), timestamp })
      } else if (type === 'reasoning') {
        const thinkingText = [contentText(item.summary), contentText(item.content)].filter(Boolean).join('\n\n')
        if (thinkingText) messages.push({ id, kind: 'assistant', status: 'done', text: '', thinkingText, timestamp })
      } else if (type === 'plan') {
        messages.push({ id, kind: 'custom', label: 'Plan', text: String(item.text ?? ''), timestamp })
      } else if (type === 'commandExecution') {
        const status = toolStatus(item.status)
        messages.push({
          id,
          isError: status === 'error',
          kind: 'tool',
          status,
          text: String(item.aggregatedOutput ?? item.command ?? ''),
          timestamp,
          title: 'Terminal',
        })
      } else if (type === 'fileChange') {
        const status = toolStatus(item.status)
        const fileChanges = projectCodexFileChanges(item.changes)
        if (fileChanges.length > 0) fileChangesByEntryId[id] = fileChanges
        messages.push({
          id,
          isError: status === 'error',
          kind: 'tool',
          sessionEntryId: id,
          status,
          text: JSON.stringify(item.changes ?? []),
          timestamp,
          title: 'File changes',
        })
      } else if (type === 'mcpToolCall' || type === 'dynamicToolCall' || type === 'collabAgentToolCall' || type === 'webSearch') {
        const status = toolStatus(item.status ?? 'completed')
        messages.push({
          id,
          isError: status === 'error',
          kind: 'tool',
          status,
          text: String(item.result ?? item.query ?? JSON.stringify(item.arguments ?? {})),
          timestamp,
          title: String(item.tool ?? item.server ?? type),
        })
      }
    }
    const turnErrorMessage = codexErrorMessage(turn.error)
    if (String(turn.status ?? '') === 'failed' && turnErrorMessage) {
      timestamp += 1
      messages.push({
        id: `${String(turn.id ?? record.id)}-error`,
        isError: true,
        kind: 'assistant',
        status: 'error',
        text: turnErrorMessage,
        timestamp,
      })
    }
  }

  return {
    annotations: { fileChangesByEntryId },
    messages,
    name: record.name,
    sessionId: record.id,
    sessionPath: record.id,
    workspacePath: record.cwd,
  }
}

export class CodexAgentManager {
  private readonly bindingStarts = new Map<string, Promise<CodexBinding>>()
  private readonly bindings = new Map<string, CodexBinding>()
  private connection: JsonLineProcess | null = null
  private connectionPromise: Promise<JsonLineProcess> | null = null
  private disposed = false
  private readonly index: AtomicJsonStore<CodexThreadIndex>
  private models: CodexModel[] = []
  private readonly pendingInteractions = new Map<string, PendingCodexInteraction>()
  private readonly recordReplacements = new Map<string, Promise<CodexThreadRecord>>()
  private serviceTierCompatibilityOverride = false
  private readonly workspaceActiveThreads = new Map<string, string>()

  constructor(private readonly options: CodexAgentManagerOptions) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_INDEX),
      filePath: path.join(options.agentDir, 'external', 'codex', 'threads.json'),
      normalize: normalizeIndex,
    })
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    await this.ensureConnection()
    return { activeSession: null, runtime: this.serializeRuntime(null, null), sessions: [] }
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null, options: { restoreSession?: boolean } = {}) {
    await this.ensureConnection()
    const records = await this.listRecords(cwd)
    let activeID = options.restoreSession === false
      ? null
      : [preferredSessionPath, this.workspaceActiveThreads.get(workspaceIdentity(cwd)), records[0]?.id]
          .find((candidate): candidate is string => Boolean(candidate && records.some((record) => record.id === candidate)))
        ?? null
    if (activeID) {
      const record = await this.ensureOpenableRecord(cwd, activeID)
      activeID = record.id
      await this.requireBinding(cwd, activeID)
      this.workspaceActiveThreads.set(workspaceIdentity(cwd), activeID)
    }
    return this.buildWorkspaceState(cwd, activeID)
  }

  async listSessionItems(cwd: string) {
    return (await this.listRecords(cwd)).map((record) => ({
      createdAt: record.createdAt,
      id: record.id,
      messageCount: 0,
      modifiedAt: record.updatedAt,
      name: record.name,
      path: record.id,
      preview: record.name ?? 'Codex thread',
    }))
  }

  async readSession(cwd: string, threadID: string) {
    const record = await this.requireRecord(cwd, threadID)
    if (!record.materialized && !this.bindings.has(threadID)) {
      return projectCodexThread({ turns: [] }, record)
    }
    if (record.materialized) await this.requireBinding(cwd, threadID)
    const connection = await this.ensureConnection()
    let response: JsonRecord
    try {
      response = await connection.request({ type: undefined, method: 'thread/read', params: { threadId: threadID, includeTurns: true } })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const binding = this.bindings.get(threadID)
      if (isTransientThreadReadError(message) && (!record.materialized || binding?.isStreaming)) {
        return projectCodexThread({ turns: [] }, record)
      }
      throw error
    }
    const thread = resultData(response).thread
    if (!thread || typeof thread !== 'object') throw new Error('Codex thread could not be read.')
    return projectCodexThread(thread as JsonRecord, record)
  }

  async sessionExists(cwd: string, threadID: string) {
    return (await this.listRecords(cwd)).some((record) => record.id === threadID)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    const connection = await this.ensureConnection()
    const normalized = typeof options === 'string' ? { name: options } : options
    const defaultModel = this.defaultModel()
    const defaultModelKey = defaultModel ? `openai/${defaultModel.model ?? defaultModel.id}` : null
    const modelExplicit = Boolean(normalized?.modelKey && normalized.modelKey !== defaultModelKey)
    const model = modelExplicit && normalized?.modelKey
      ? this.resolveModelKey(normalized.modelKey)
      : null
    const effort = normalized?.thinkingLevel ?? this.defaultModel()?.defaultReasoningEffort ?? 'medium'
    if (normalized?.modelKey) {
      const selected = this.requireModel(normalized.modelKey)
      if (!codexModelThinkingLevels(selected).includes(reasoningEffort(effort))) {
        throw new Error(`Codex thinking level "${effort}" is not supported by "${normalized.modelKey}".`)
      }
    }
    const { result, threadID } = await this.startNativeThread(connection, cwd, model)
    const now = new Date().toISOString()
    const record: CodexThreadRecord = {
      createdAt: now,
      cwd,
      id: threadID,
      materialized: false,
      model: nullableString(result.model) ?? model,
      modelExplicit,
      name: normalized?.name?.trim() || null,
      reasoningEffort: reasoningEffort(effort),
      updatedAt: now,
    }
    try {
      await this.index.update((state) => ({ ...state, threads: [record, ...state.threads] }))
    } catch (error) {
      await this.archiveThread(connection, threadID).catch(() => undefined)
      throw error
    }
    this.bindings.set(threadID, { activeTurnId: null, isStreaming: false, lastError: null, queuedPrompts: [], record })
    this.workspaceActiveThreads.set(workspaceIdentity(cwd), threadID)
    if (record.name) await this.setThreadName(connection, record).catch(() => undefined)
    return this.broadcastWorkspaceState(cwd, threadID)
  }

  async openSession(cwd: string, threadID: string) {
    const record = await this.ensureOpenableRecord(cwd, threadID)
    await this.requireBinding(cwd, record.id)
    this.workspaceActiveThreads.set(workspaceIdentity(cwd), record.id)
    return this.broadcastWorkspaceState(cwd, record.id)
  }

  async deleteSession(cwd: string, threadID: string) {
    await this.requireRecord(cwd, threadID)
    await this.bindingStarts.get(threadID)?.catch(() => undefined)
    const connection = await this.ensureConnection()
    const binding = this.bindings.get(threadID)
    if (binding?.activeTurnId) {
      await connection.request({
        type: undefined,
        method: 'turn/interrupt',
        params: { threadId: threadID, turnId: binding.activeTurnId },
      })
    }
    await this.archiveThread(connection, threadID)
    await this.index.update((state) => ({
      ...state,
      threads: state.threads.filter((record) => record.id !== threadID),
    }))
    this.bindings.delete(threadID)
    this.clearPendingInteractions((pending) => pending.sessionId === threadID)
    const identity = workspaceIdentity(cwd)
    const activeThreadID = this.workspaceActiveThreads.get(identity) ?? null
    if (activeThreadID === threadID) {
      this.workspaceActiveThreads.delete(identity)
    }
    return this.broadcastWorkspaceState(cwd, activeThreadID === threadID ? null : activeThreadID)
  }

  async renameSession(cwd: string, threadID: string, name: string) {
    const record = await this.requireRecord(cwd, threadID)
    record.name = name.trim() || null
    record.updatedAt = new Date().toISOString()
    await this.updateRecord(record)
    await this.setThreadName(await this.ensureConnection(), record)
    const binding = this.bindings.get(threadID)
    if (binding) binding.record = record
    return this.broadcastWorkspaceState(cwd, this.workspaceActiveThreads.get(workspaceIdentity(cwd)) ?? null)
  }

  async sendPrompt(cwd: string, threadID: string, prompt: string, streamingBehavior?: AgentRunningPromptBehavior, attachments: AgentPromptAttachment[] = []) {
    const binding = await this.requireBinding(cwd, threadID)
    if (binding.isStreaming) {
      if (streamingBehavior === 'steer' && binding.activeTurnId) {
        await (await this.ensureConnection()).request({
          type: undefined,
          method: 'turn/steer',
          params: {
            expectedTurnId: binding.activeTurnId,
            input: this.buildInputs(prompt, attachments),
            threadId: threadID,
          },
        })
        await this.broadcastWorkspaceState(cwd, threadID).catch(() => undefined)
        return { ok: true }
      }
      binding.queuedPrompts.push({ attachments, prompt })
      await this.broadcastWorkspaceState(cwd, threadID).catch(() => undefined)
      return { ok: true }
    }
    await this.startTurn(binding, prompt, attachments)
    await this.broadcastWorkspaceState(cwd, threadID).catch(() => undefined)
    return { ok: true }
  }

  async selectModel(cwd: string, threadID: string, modelKey: string) {
    const binding = await this.requireBinding(cwd, threadID)
    const model = this.requireModel(modelKey)
    binding.record.model = model.model ?? model.id
    binding.record.modelExplicit = true
    const levels = codexModelThinkingLevels(model)
    if (!levels.includes(binding.record.reasoningEffort)) {
      binding.record.reasoningEffort = levels.includes('medium') ? 'medium' : levels[0]
    }
    await this.updateRecord(binding.record)
    await this.resumeThread(binding.record)
    return this.broadcastWorkspaceState(cwd, binding.record.id)
  }

  async selectThinkingLevel(cwd: string, threadID: string, level: string, modelKey?: string) {
    const binding = await this.requireBinding(cwd, threadID)
    if (!THINKING_LEVELS.includes(level as AgentThinkingLevel)) {
      throw new Error(`Codex thinking level "${level}" is invalid.`)
    }
    const model = modelKey
      ? this.requireModel(modelKey)
      : this.models.find((candidate) => (candidate.model ?? candidate.id) === binding.record.model)
    if (model && !codexModelThinkingLevels(model).includes(reasoningEffort(level))) {
      throw new Error(`Codex thinking level "${level}" is not supported by "openai/${model.model ?? model.id}".`)
    }
    binding.record.reasoningEffort = reasoningEffort(level)
    if (modelKey && model) binding.record.model = model.model ?? model.id
    if (modelKey && model) binding.record.modelExplicit = true
    await this.updateRecord(binding.record)
    return this.broadcastWorkspaceState(cwd, binding.record.id)
  }

  async abortActivePrompt(cwd: string, threadID: string) {
    const binding = await this.requireBinding(cwd, threadID)
    if (binding.activeTurnId) {
      await (await this.ensureConnection()).request({
        type: undefined,
        method: 'turn/interrupt',
        params: { threadId: binding.record.id, turnId: binding.activeTurnId },
      })
    }
    binding.activeTurnId = null
    binding.isStreaming = false
    return this.broadcastWorkspaceState(cwd, binding.record.id)
  }

  respondToInteraction(response: AgentInteractionResponse) {
    const interactionKey = getAgentInteractionKey(response.sessionId, response.requestId)
    const pending = this.pendingInteractions.get(interactionKey)
    if (!pending || !this.connection) return false
    let result: JsonRecord
    if (pending.kind === 'question' && pending.questionIds) {
      result = {
        answers: Object.fromEntries(pending.questionIds.map((questionId, index) => {
          const directAnswers = response.answers?.[questionId]
          const fallbackAnswer = index === 0
            ? response.optionId.startsWith('answer:')
              ? response.optionId.slice('answer:'.length)
              : response.values?.[0] ?? ''
            : ''
          return [questionId, { answers: directAnswers ?? (fallbackAnswer ? [fallbackAnswer] : []) }]
        })),
      }
    } else if (pending.kind === 'permissions') {
      result = buildCodexPermissionApprovalResult(pending.requestedPermissions ?? {}, response.optionId)
    } else {
      result = buildCodexApprovalResult(response.optionId, pending.approvalProtocol ?? 'v2')
    }
    this.connection.notify({ id: pending.originalId, result })
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
    const recordIds = new Set((await this.listRecords(cwd)).map((record) => record.id))
    await Promise.all([...recordIds].map((threadID) => this.recordReplacements.get(threadID)?.catch(() => undefined)))
    await Promise.all([...recordIds].map((threadID) => this.bindingStarts.get(threadID)?.catch(() => undefined)))
    const bindings = [...this.bindings.values()].filter((binding) => workspaceIdentity(binding.record.cwd) === identity)
    let failures: unknown[] = []
    if (this.connection) {
      const interruptResults = await Promise.allSettled(bindings.flatMap((binding) => binding.activeTurnId
        ? [this.connection!.request({
            type: undefined,
            method: 'turn/interrupt',
            params: { threadId: binding.record.id, turnId: binding.activeTurnId },
          })]
        : []))
      failures = interruptResults.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    }
    const threadIds = new Set(bindings.map((binding) => binding.record.id))
    for (const threadID of threadIds) this.bindings.delete(threadID)
    this.clearPendingInteractions((pending) => threadIds.has(pending.sessionId))
    this.workspaceActiveThreads.delete(identity)
    if (failures.length > 0) throw new AggregateError(failures, 'One or more Codex turns could not be interrupted.')
  }

  async discardWorkspaceSessions(cwd: string) {
    let records = await this.listRecords(cwd)
    if (records.length === 0) return
    await Promise.all(records.map((record) => this.recordReplacements.get(record.id)?.catch(() => undefined)))
    records = await this.listRecords(cwd)
    await Promise.all(records.map((record) => this.bindingStarts.get(record.id)?.catch(() => undefined)))
    const connection = await this.ensureConnection()
    const archivedIds: string[] = []
    let firstError: unknown = null
    for (const record of records) {
      try {
        await this.archiveThread(connection, record.id)
        archivedIds.push(record.id)
        this.bindings.delete(record.id)
        this.clearPendingInteractions((pending) => pending.sessionId === record.id)
      } catch (error) {
        firstError ??= error
      }
    }
    if (archivedIds.length > 0) {
      const archived = new Set(archivedIds)
      await this.index.update((state) => ({
        ...state,
        threads: state.threads.filter((record) => !archived.has(record.id)),
      }))
    }
    if (archivedIds.length === records.length) this.workspaceActiveThreads.delete(workspaceIdentity(cwd))
    if (firstError) throw firstError
  }

  dispose() {
    this.disposed = true
    this.connection?.stop()
    this.connection = null
    this.connectionPromise = null
    this.bindingStarts.clear()
    this.bindings.clear()
    this.pendingInteractions.clear()
    this.recordReplacements.clear()
    this.workspaceActiveThreads.clear()
  }

  private async ensureConnection() {
    if (this.disposed) throw new Error('Codex manager has been disposed.')
    if (!this.connectionPromise) {
      if (this.connection) return this.connection
      this.connectionPromise = this.startConnection()
    }
    try {
      return await this.connectionPromise
    } catch (error) {
      ;(this.connection as JsonLineProcess | null)?.stop()
      this.connection = null
      this.connectionPromise = null
      throw error
    }
  }

  private async startConnection() {
    try {
      return await this.initializeConnection(['app-server'])
    } catch (error) {
      if (this.disposed) throw error
      if (!isServiceTierCompatibilityError(error)) throw error
      this.serviceTierCompatibilityOverride = true
      this.connection?.stop()
      this.connection = null
      return this.initializeConnection(['app-server', '-c', 'service_tier=fast'])
    }
  }

  private async initializeConnection(args: string[]) {
    await prepareExternalCliEnvironment()
    if (this.disposed) throw new Error('Codex manager has been disposed.')
    let connection: JsonLineProcess
    let eventChain = Promise.resolve()
    connection = new JsonLineProcess({
      args,
      command: 'codex',
      onEvent: (message) => {
        eventChain = eventChain
          .then(() => this.handleMessage(message))
          .catch((error) => {
            const params = message.params && typeof message.params === 'object' ? message.params as JsonRecord : {}
            this.options.emitEvent({
              type: 'error',
              message: `Codex 事件处理失败：${error instanceof Error ? error.message : String(error)}`,
              sessionId: nullableString(params.threadId) ?? nullableString(params.conversationId),
            })
          })
      },
      onExit: (error) => {
        this.handleConnectionExit(connection, error)
      },
    })
    this.connection = connection
    connection.start()
    await connection.request({
      type: undefined,
      method: 'initialize',
      params: {
        capabilities: { experimentalApi: true },
        clientInfo: { name: 'aryn', title: 'Aryn', version: '0.1.0' },
      },
    })
    connection.notify({ method: 'initialized', params: {} })
    const modelsResponse = await connection.request({ type: undefined, method: 'model/list', params: { includeHidden: false, limit: 100 } }, 30_000)
    const models = resultData(modelsResponse).data
    if (this.disposed) {
      connection.stop()
      throw new Error('Codex manager was disposed during App Server initialization.')
    }
    this.models = Array.isArray(models) ? models as CodexModel[] : []
    return connection
  }

  private async handleMessage(message: JsonRecord) {
    const method = String(message.method ?? '')
    const params = message.params && typeof message.params === 'object' ? message.params as JsonRecord : {}
    const threadID = nullableString(params.threadId) ?? nullableString(params.conversationId)

    if ('id' in message && (
      method === 'item/commandExecution/requestApproval'
      || method === 'item/fileChange/requestApproval'
      || method === 'item/permissions/requestApproval'
      || method === 'applyPatchApproval'
      || method === 'execCommandApproval'
    )) {
      if (!threadID) {
        this.rejectServerRequest(message, `${method} did not include a thread identifier.`)
        return
      }
      const requestId = `codex:${String(message.id)}`
      const detailValue = params.command ?? params.reason ?? params.grantRoot ?? params.fileChanges
      const detail = Array.isArray(detailValue)
        ? detailValue.map(String).join(' ')
        : detailValue && typeof detailValue === 'object'
          ? JSON.stringify(detailValue)
          : String(detailValue ?? 'Codex 请求执行受保护操作。')
      const isPermissionProfileRequest = method === 'item/permissions/requestApproval'
      const isLegacyApproval = method === 'applyPatchApproval' || method === 'execCommandApproval'
      const requestedPermissions = params.permissions && typeof params.permissions === 'object'
        ? params.permissions as JsonRecord
        : {}
      this.pendingInteractions.set(getAgentInteractionKey(threadID, requestId), {
        approvalProtocol: isLegacyApproval ? 'legacy' : 'v2',
        kind: isPermissionProfileRequest ? 'permissions' : 'approval',
        originalId: message.id,
        requestId,
        ...(isPermissionProfileRequest ? { requestedPermissions } : {}),
        sessionId: threadID,
      })
      this.options.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'codex',
          id: requestId,
          kind: 'permission',
          message: isPermissionProfileRequest
            ? this.describeRequestedPermissions(requestedPermissions, detail)
            : detail,
          options: [
            { id: 'deny', label: '拒绝' },
            { id: 'allow_once', label: '允许本次' },
            { id: 'allow_always', label: '本会话始终允许' },
          ],
          sessionId: threadID,
          title: isPermissionProfileRequest
            ? 'Codex 请求扩展权限'
            : method.includes('fileChange') || method === 'applyPatchApproval'
              ? 'Codex 请求修改文件'
              : 'Codex 请求执行命令',
          workspacePath: this.bindings.get(threadID)?.record.cwd ?? String(params.cwd ?? ''),
        },
      })
      return
    }

    if ('id' in message && method === 'item/tool/requestUserInput') {
      const questions = Array.isArray(params.questions) ? params.questions as JsonRecord[] : []
      if (!threadID || questions.length === 0) {
        this.rejectServerRequest(message, 'Codex user-input request was missing its thread or questions.')
        return
      }
      const requestId = `codex:${String(message.id)}`
      const questionIds = questions.map((question, index) => String(question.id ?? `answer-${index + 1}`))
      const fields = questions.map((question, index) => ({
        allowsCustomAnswer: question.isOther === true || !Array.isArray(question.options) || question.options.length === 0,
        id: questionIds[index],
        isSecret: question.isSecret === true,
        label: String(question.header ?? `问题 ${index + 1}`),
        message: String(question.question ?? ''),
        options: Array.isArray(question.options)
          ? (question.options as JsonRecord[]).map((option) => ({
              description: nullableString(option.description) ?? undefined,
              id: String(option.label ?? ''),
              label: String(option.label ?? '选择'),
            }))
          : [],
      }))
      this.pendingInteractions.set(getAgentInteractionKey(threadID, requestId), {
        kind: 'question',
        originalId: message.id,
        questionIds,
        requestId,
        sessionId: threadID,
      })
      this.options.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'codex',
          fields,
          id: requestId,
          kind: 'question',
          message: questions.length === 1
            ? String(questions[0].question ?? 'Codex 需要你的回答。')
            : `Codex 有 ${questions.length} 个问题需要回答。`,
          options: [{ id: 'deny', label: '取消' }],
          sessionId: threadID,
          title: questions.length === 1 ? String(questions[0].header ?? 'Codex 提问') : 'Codex 提问',
          workspacePath: this.bindings.get(threadID)?.record.cwd ?? '',
        },
      })
      return
    }

    if ('id' in message && method === 'mcpServer/elicitation/request') {
      this.connection?.notify({ id: message.id, result: { action: 'decline' } })
      this.options.emitEvent({
        type: 'error',
        message: `MCP 服务 ${nullableString(params.serverName) ?? ''} 请求了当前版本尚未支持的交互表单，已安全拒绝。`.replace(/\s+/g, ' ').trim(),
        sessionId: threadID,
      })
      return
    }

    if ('id' in message && method === 'item/tool/call') {
      this.connection?.notify({
        id: message.id,
        result: {
          contentItems: [{ type: 'inputText', text: 'Aryn did not register this dynamic tool.' }],
          success: false,
        },
      })
      return
    }

    if ('id' in message && method === 'account/chatgptAuthTokens/refresh') {
      this.rejectServerRequest(message, 'Aryn delegates authentication to the installed Codex CLI and cannot refresh client-managed tokens.')
      return
    }

    if ('id' in message) {
      this.rejectServerRequest(message, `Unsupported Codex server request: ${method || 'unknown'}.`)
      return
    }

    if (!threadID) return
    const binding = this.bindings.get(threadID)
    if (!binding) return

    if (method === 'turn/started') {
      const turn = params.turn as JsonRecord | undefined
      binding.activeTurnId = nullableString(turn?.id)
      binding.isStreaming = true
      binding.lastError = null
      this.options.emitEvent({ type: 'assistant_message_started', sessionId: threadID })
      return
    }
    if (method === 'item/agentMessage/delta' && typeof params.delta === 'string') {
      this.options.emitEvent({ type: 'assistant_message_delta', delta: params.delta, sessionId: threadID })
      return
    }
    if ((method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') && typeof params.delta === 'string') {
      this.options.emitEvent({ type: 'assistant_thinking_delta', delta: params.delta, sessionId: threadID })
      return
    }
    if (method === 'item/started' || method === 'item/completed') {
      const item = params.item as JsonRecord | undefined
      if (!item) return
      const itemType = String(item.type ?? '')
      if (['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall', 'collabAgentToolCall', 'webSearch'].includes(itemType)) {
        const toolName = String(item.tool ?? item.server ?? itemType)
        const summary = String(item.command ?? item.query ?? item.aggregatedOutput ?? JSON.stringify(item.changes ?? item.arguments ?? {}))
        this.options.emitEvent(method === 'item/started'
          ? { type: 'tool_execution_started', sessionId: threadID, summary, toolCallId: String(item.id), toolName }
          : {
              type: 'tool_execution_finished',
              isError: toolStatus(item.status) === 'error',
              sessionId: threadID,
              summary,
              toolCallId: String(item.id),
              toolName,
            })
        if (method === 'item/completed' && itemType === 'fileChange') {
          const fileChanges = projectCodexFileChanges(item.changes)
          if (fileChanges.length > 0) {
            this.options.emitEvent({
              type: 'session_annotations_updated',
              annotations: { fileChangesByEntryId: { [String(item.id)]: fileChanges } },
              sessionId: threadID,
            })
          }
        }
      }
      return
    }
    if (method === 'turn/completed') {
      const turn = params.turn && typeof params.turn === 'object' ? params.turn as JsonRecord : {}
      const turnStatus = String(turn.status ?? '')
      const finalError = codexErrorMessage(turn.error) ?? codexErrorMessage(binding.lastError)
      binding.activeTurnId = null
      binding.isStreaming = false
      binding.lastError = null
      if (turnStatus === 'failed' && finalError) {
        this.options.emitEvent({ type: 'error', message: finalError, sessionId: threadID })
      }
      this.options.emitEvent({ type: 'assistant_thinking_finished', sessionId: threadID })
      await this.touchRecord(binding.record).catch((error) => {
        this.options.emitEvent({
          type: 'error',
          message: `Codex 会话索引更新失败：${error instanceof Error ? error.message : String(error)}`,
          sessionId: threadID,
        })
      })
      await this.broadcastWorkspaceState(binding.record.cwd, threadID).catch((error) => {
        this.options.emitEvent({
          type: 'error',
          message: `Codex 会话状态刷新失败：${error instanceof Error ? error.message : String(error)}`,
          sessionId: threadID,
        })
      })
      const nextPrompt = binding.queuedPrompts.shift()
      if (nextPrompt) {
        try {
          await this.startTurn(binding, nextPrompt.prompt, nextPrompt.attachments)
          await this.broadcastWorkspaceState(binding.record.cwd, threadID).catch(() => undefined)
        } catch (error) {
          binding.activeTurnId = null
          binding.isStreaming = false
          binding.queuedPrompts.unshift(nextPrompt)
          this.options.emitEvent({
            type: 'error',
            message: `Codex 排队消息启动失败：${error instanceof Error ? error.message : String(error)}`,
            sessionId: threadID,
          })
        }
      }
      return
    }
    if (method === 'error') {
      const error = params.error && typeof params.error === 'object' ? params.error as JsonRecord : {}
      if (params.willRetry !== true) {
        binding.lastError = codexErrorMessage(error) ?? 'Codex turn failed.'
      }
    }
  }

  private rejectServerRequest(message: JsonRecord, reason: string) {
    if (!('id' in message)) return
    this.connection?.notify({
      error: { code: -32601, message: reason },
      id: message.id,
    })
  }

  private describeRequestedPermissions(permissions: JsonRecord, fallback: string) {
    const fileSystem = permissions.fileSystem && typeof permissions.fileSystem === 'object'
      ? permissions.fileSystem as JsonRecord
      : null
    const network = permissions.network && typeof permissions.network === 'object'
      ? permissions.network as JsonRecord
      : null
    const lines: string[] = []
    if (Array.isArray(fileSystem?.read) && fileSystem.read.length > 0) {
      lines.push(`读取：${fileSystem.read.map(String).join('\n')}`)
    }
    if (Array.isArray(fileSystem?.write) && fileSystem.write.length > 0) {
      lines.push(`写入：${fileSystem.write.map(String).join('\n')}`)
    }
    if (network?.enabled === true) {
      lines.push('网络：允许访问')
    }
    return lines.join('\n\n') || fallback
  }

  private handleConnectionExit(connection: JsonLineProcess, error: Error) {
    if (this.connection !== connection) return
    this.connection = null
    this.connectionPromise = null
    this.models = []
    for (const binding of this.bindings.values()) {
      if (binding.isStreaming) {
        this.options.emitEvent({
          type: 'error',
          message: `Codex App Server 已退出：${error.message}`,
          sessionId: binding.record.id,
        })
      }
    }
    this.bindings.clear()
    this.clearPendingInteractions(() => true)
  }

  private clearPendingInteractions(predicate: (pending: PendingCodexInteraction) => boolean) {
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

  private buildInputs(prompt: string, attachments: AgentPromptAttachment[]) {
    const inputs: JsonRecord[] = [{ type: 'text', text: prompt, text_elements: [] }]
    for (const attachment of attachments) {
      if (attachment.kind === 'image' && attachment.data) {
        inputs.push({ type: 'image', url: attachment.data })
      } else if (attachment.kind === 'image' && attachment.path) {
        inputs.push({ type: 'localImage', path: attachment.path })
      } else if (attachment.path) {
        inputs[0].text = `${String(inputs[0].text)}\n\nAttached file: ${attachment.path}`
      }
    }
    return inputs
  }

  private async startNativeThread(connection: JsonLineProcess, cwd: string, model: string | null) {
    const startThread = () => connection.request({
      type: undefined,
      method: 'thread/start',
      params: {
        approvalPolicy: 'on-request',
        ...(this.serviceTierCompatibilityOverride ? { config: { service_tier: 'fast' }, serviceTier: 'fast' } : {}),
        cwd,
        ...(model ? { model } : {}),
        sandbox: 'workspace-write',
        serviceName: 'Aryn',
        experimentalRawEvents: false,
        persistExtendedHistory: true,
      },
    }, 30_000)
    let response: JsonRecord
    try {
      response = await startThread()
    } catch (error) {
      if (!isServiceTierCompatibilityError(error) || this.serviceTierCompatibilityOverride) throw error
      this.serviceTierCompatibilityOverride = true
      response = await startThread()
    }
    const result = resultData(response)
    const thread = result.thread as JsonRecord | undefined
    const threadID = nullableString(thread?.id)
    if (!threadID) throw new Error('Codex did not return a thread ID.')
    return { result, threadID }
  }

  private async startTurn(binding: CodexBinding, prompt: string, attachments: AgentPromptAttachment[]) {
    const response = await (await this.ensureConnection()).request({
      type: undefined,
      method: 'turn/start',
      params: {
        effort: codexReasoningEffort(binding.record.reasoningEffort),
        input: this.buildInputs(prompt, attachments),
        ...(binding.record.modelExplicit && binding.record.model ? { model: binding.record.model } : {}),
        ...(this.serviceTierCompatibilityOverride ? { serviceTier: 'fast' } : {}),
        threadId: binding.record.id,
      },
    }, 30_000)
    const turn = resultData(response).turn as JsonRecord | undefined
    binding.activeTurnId = nullableString(turn?.id)
    binding.isStreaming = true
    if (!binding.record.materialized) {
      binding.record.materialized = true
      await this.updateRecord(binding.record).catch((error) => {
        this.options.emitEvent({
          type: 'error',
          message: `Codex 会话索引更新失败：${error instanceof Error ? error.message : String(error)}`,
          sessionId: binding.record.id,
        })
      })
    }
  }

  private async resumeThread(record: CodexThreadRecord) {
    const connection = await this.ensureConnection()
    await connection.request({
      type: undefined,
      method: 'thread/resume',
      params: {
        approvalPolicy: 'on-request',
        ...(this.serviceTierCompatibilityOverride ? { config: { service_tier: 'fast' }, serviceTier: 'fast' } : {}),
        cwd: record.cwd,
        ...(record.modelExplicit && record.model ? { model: record.model } : {}),
        sandbox: 'workspace-write',
        threadId: record.id,
      },
    }, 30_000)
    const existing = this.bindings.get(record.id)
    this.bindings.set(record.id, existing ?? { activeTurnId: null, isStreaming: false, lastError: null, queuedPrompts: [], record })
  }

  private defaultModel() {
    return this.models.find((model) => model.isDefault) ?? this.models[0] ?? null
  }

  private resolveModelKey(modelKey: string) {
    const match = this.requireModel(modelKey)
    return match.model ?? match.id
  }

  private requireModel(modelKey: string) {
    const normalized = modelKey.trim()
    const match = this.models.find((model) => `openai/${model.model ?? model.id}` === normalized)
    if (!match) throw new Error(`Codex model "${modelKey}" is not available.`)
    return match
  }

  private serializeRuntime(cwd: string | null, binding: CodexBinding | null): AgentWorkspaceState['runtime'] {
    const models = this.models.filter((model) => !model.hidden)
    const availableModels = models.map((model) => `openai/${model.model ?? model.id}`)
    const levelsByModel: Record<string, AgentThinkingLevel[]> = Object.fromEntries(models.map((model) => [
      `openai/${model.model ?? model.id}`,
      codexModelThinkingLevels(model),
    ]))
    const defaultModel = this.defaultModel()
    const defaultModelKey = defaultModel ? `openai/${defaultModel.model ?? defaultModel.id}` : null
    const selectedModel = binding?.record.model ? `openai/${binding.record.model}` : defaultModelKey
    const levels: AgentThinkingLevel[] = selectedModel
      ? levelsByModel[selectedModel] ?? ['low', 'medium', 'high']
      : ['low', 'medium', 'high']

    return {
      agentId: 'codex',
      auth: {},
      availableModelInputs: Object.fromEntries(models.map((model) => [
        `openai/${model.model ?? model.id}`,
        model.inputModalities?.includes('image') ? ['text', 'image'] : ['text'],
      ])),
      availableModels,
      availableThinkingLevels: levels,
      availableThinkingLevelsByModel: levelsByModel,
      compactionReason: null,
      defaultModel: defaultModelKey,
      defaultThinkingLevel: reasoningEffort(defaultModel?.defaultReasoningEffort),
      followUpMessageCount: binding?.queuedPrompts.length ?? 0,
      followUpMessages: binding?.queuedPrompts.map((prompt) => prompt.prompt) ?? [],
      followUpMode: 'one-at-a-time',
      hasConfiguredModels: availableModels.length > 0,
      isCompacting: false,
      isStreaming: binding?.isStreaming ?? false,
      pendingMessageCount: binding?.queuedPrompts.length ?? 0,
      preferredModelByProvider: defaultModel ? { openai: defaultModel.model ?? defaultModel.id } : {},
      retryAttempt: 0,
      retryMaxAttempts: null,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : 'Codex 当前没有可用模型，请先通过 Codex CLI 完成登录。',
      supportedRunningPromptBehaviors: ['steer', 'followUp'],
      supportsQueuedMessageEditing: false,
      steeringMessageCount: 0,
      steeringMessages: [],
      steeringMode: 'one-at-a-time',
      supportsThinking: levels.some((level) => level !== 'off'),
      thinkingLevel: binding?.record.reasoningEffort ?? reasoningEffort(defaultModel?.defaultReasoningEffort),
      workspacePath: cwd,
    }
  }

  private async buildWorkspaceState(cwd: string, activeThreadID: string | null): Promise<AgentWorkspaceState> {
    const records = await this.listRecords(cwd)
    const binding = activeThreadID ? await this.requireBinding(cwd, activeThreadID) : null
    return {
      activeSession: binding ? await this.readSession(cwd, binding.record.id) : null,
      runtime: this.serializeRuntime(cwd, binding),
      sessions: records.map((record) => ({
        createdAt: record.createdAt,
        id: record.id,
        messageCount: 0,
        modifiedAt: record.updatedAt,
        name: record.name,
        path: record.id,
        preview: record.name ?? 'Codex thread',
      })),
    }
  }

  private async broadcastWorkspaceState(cwd: string, activeThreadID: string | null) {
    const state = await this.buildWorkspaceState(cwd, activeThreadID)
    this.options.emitEvent({ type: 'workspace_state', state })
    return state
  }

  private async listRecords(cwd: string) {
    const identity = workspaceIdentity(cwd)
    return (await this.index.read()).threads
      .filter((record) => workspaceIdentity(record.cwd) === identity)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  private async requireRecord(cwd: string, threadID: string) {
    const record = (await this.listRecords(cwd)).find((candidate) => candidate.id === threadID)
    if (!record) throw new Error('Codex thread not found for this Aryn workspace.')
    return record
  }

  private async ensureOpenableRecord(cwd: string, threadID: string) {
    const record = await this.requireRecord(cwd, threadID)
    if (record.materialized || this.bindings.has(threadID)) return record
    const pending = this.recordReplacements.get(threadID)
    if (pending) return pending
    const start = (async () => {
      const connection = await this.ensureConnection()
      const { result, threadID: replacementID } = await this.startNativeThread(
        connection,
        cwd,
        record.modelExplicit ? record.model : null,
      )
      const replacement: CodexThreadRecord = {
        ...record,
        id: replacementID,
        model: nullableString(result.model) ?? record.model,
        updatedAt: new Date().toISOString(),
      }
      try {
        await this.index.update((state) => ({
          ...state,
          threads: state.threads.map((candidate) => candidate.id === threadID ? replacement : candidate),
        }))
      } catch (error) {
        await this.archiveThread(connection, replacementID).catch(() => undefined)
        throw error
      }
      this.bindings.delete(threadID)
      this.clearPendingInteractions((candidate) => candidate.sessionId === threadID)
      this.bindings.set(replacementID, {
        activeTurnId: null,
        isStreaming: false,
        lastError: null,
        queuedPrompts: [],
        record: replacement,
      })
      const identity = workspaceIdentity(cwd)
      if (this.workspaceActiveThreads.get(identity) === threadID) {
        this.workspaceActiveThreads.set(identity, replacementID)
      }
      if (replacement.name) await this.setThreadName(connection, replacement).catch(() => undefined)
      return replacement
    })().finally(() => {
      if (this.recordReplacements.get(threadID) === start) this.recordReplacements.delete(threadID)
    })
    this.recordReplacements.set(threadID, start)
    return start
  }

  private async requireBinding(cwd: string, threadID: string) {
    const existing = this.bindings.get(threadID)
    if (existing) return this.requireBindingWorkspace(existing, cwd)
    const pending = this.bindingStarts.get(threadID)
    if (pending) return this.requireBindingWorkspace(await pending, cwd)
    const start = this.requireRecord(cwd, threadID)
      .then(async (record) => {
        await this.resumeThread(record)
        const binding = this.bindings.get(threadID)
        if (!binding) throw new Error('Codex thread resumed without creating a runtime binding.')
        return binding
      })
      .finally(() => {
        if (this.bindingStarts.get(threadID) === start) this.bindingStarts.delete(threadID)
      })
    this.bindingStarts.set(threadID, start)
    return start
  }

  private requireBindingWorkspace(binding: CodexBinding, cwd: string) {
    if (workspaceIdentity(binding.record.cwd) !== workspaceIdentity(cwd)) {
      throw new Error('Codex thread not found for this workspace.')
    }
    return binding
  }

  private async setThreadName(connection: JsonLineProcess, record: CodexThreadRecord) {
    if (!record.name) return
    await connection.request({ type: undefined, method: 'thread/name/set', params: { threadId: record.id, name: record.name } })
  }

  private async archiveThread(connection: JsonLineProcess, threadID: string) {
    await connection.request({ type: undefined, method: 'thread/archive', params: { threadId: threadID } }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('no rollout found')) throw error
    })
  }

  private async updateRecord(record: CodexThreadRecord) {
    record.updatedAt = new Date().toISOString()
    await this.index.update((state) => ({
      ...state,
      threads: state.threads.map((candidate) => candidate.id === record.id ? { ...record } : candidate),
    }))
  }

  private async touchRecord(record: CodexThreadRecord) {
    await this.updateRecord(record)
  }
}

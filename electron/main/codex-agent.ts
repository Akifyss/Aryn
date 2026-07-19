import { copyFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServerNotification } from '../../src/features/agent/codex-protocol/generated/ServerNotification'
import type { ServerRequest } from '../../src/features/agent/codex-protocol/generated/ServerRequest'
import type { Model } from '../../src/features/agent/codex-protocol/generated/v2/Model'
import type { ModelListResponse } from '../../src/features/agent/codex-protocol/generated/v2/ModelListResponse'
import type { McpServerElicitationRequestResponse } from '../../src/features/agent/codex-protocol/generated/v2/McpServerElicitationRequestResponse'
import type { PermissionsRequestApprovalResponse } from '../../src/features/agent/codex-protocol/generated/v2/PermissionsRequestApprovalResponse'
import type { RequestPermissionProfile } from '../../src/features/agent/codex-protocol/generated/v2/RequestPermissionProfile'
import type { Thread } from '../../src/features/agent/codex-protocol/generated/v2/Thread'
import type { ThreadListResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadListResponse'
import type { ThreadSourceKind } from '../../src/features/agent/codex-protocol/generated/v2/ThreadSourceKind'
import type { UserInput } from '../../src/features/agent/codex-protocol/generated/v2/UserInput'
import { getAgentInteractionKey } from '../../src/features/agent/types'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentMessageFileChange,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentWorkspaceState,
  CodexNativeSessionSnapshot,
} from '../../src/features/agent/types'
import { AtomicJsonStore } from './json-file-store'
import { prepareExternalCliEnvironment } from './external-cli-environment'
import { CodexRpcClient } from './codex-rpc-client'
import { CodexSessionStore } from './codex-session-store'

type JsonRecord = Record<string, unknown>

export type CodexThreadRecord = {
  createdAt: string
  cwd: string
  id: string
  materialized: boolean
  model: string | null
  modelExplicit: boolean
  name: string | null
  preview?: string | null
  reasoningEffort: AgentThinkingLevel
  updatedAt: string
}

type CodexThreadIndex = {
  threads: CodexThreadRecord[]
  version: 1
}

type QueuedCodexPrompt = {
  attachments: AgentPromptAttachment[]
  options?: AgentPromptSendOptions
  prompt: string
}

type CodexBinding = {
  activeTurnId: string | null
  isStreaming: boolean
  queuedPrompts: QueuedCodexPrompt[]
  record: CodexThreadRecord
}

type PendingCodexInteraction = {
  approvalProtocol?: 'legacy' | 'v2'
  kind: 'approval' | 'permissions' | 'question'
  originalId: ServerRequest['id']
  questionIds?: string[]
  requestId: string
  requestedPermissions?: RequestPermissionProfile
  sessionId: string
}

type CodexAgentManagerOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEventPayload) => void
}

const DEFAULT_INDEX: CodexThreadIndex = { threads: [], version: 1 }
const THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
const SNAPSHOT_COALESCE_MS = 16
const TOP_LEVEL_THREAD_SOURCE_KINDS: ThreadSourceKind[] = ['cli', 'vscode', 'exec', 'appServer', 'unknown']

function workspaceIdentity(cwd: string) {
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isRecoverableModelsCacheError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const explicitSchemaFailure = message.includes('failed to load models cache:')
    && /missing field|unknown field|invalid type|expected .+ at line|EOF while parsing/i.test(message)
  // Some Codex versions only write an incompatible-cache diagnostic to their
  // own log stream and leave model/list pending. In that case the RPC client
  // can only observe the timeout. Recovery remains bounded to one attempt and
  // recoverModelsCache() is a no-op unless a cache file actually exists.
  const modelListTimeout = /codex request ["']model\/list["'] timed out/i.test(message)
  return explicitSchemaFailure || modelListTimeout
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

function codexModelThinkingLevels(model: Model): AgentThinkingLevel[] {
  const levels = model.supportedReasoningEfforts
    .map((option) => reasoningEffort(option.reasoningEffort))
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
          preview: nullableString(thread.preview),
          reasoningEffort: reasoningEffort(thread.reasoningEffort),
          updatedAt: nullableString(thread.updatedAt) ?? createdAt,
        }]
      })
    : []
  return { threads, version: 1 }
}

function isTransientThreadReadError(message: string) {
  return message.includes('is not materialized yet')
    || (message.includes('failed to load rollout') && message.includes('is empty'))
}

function isServiceTierCompatibilityError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('service_tier') || (
    message.includes('unknown variant `default`')
    && message.includes('expected `fast` or `flex`')
  )
}

function fileChangesFromThread(thread: Thread) {
  const fileChangesByEntryId: Record<string, AgentMessageFileChange[]> = {}
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type !== 'fileChange') continue
      fileChangesByEntryId[item.id] = item.changes.map((change) => ({
        filePath: change.path,
        kind: change.kind.type === 'add'
          ? 'created'
          : change.kind.type === 'delete'
            ? 'deleted'
            : 'updated',
      }))
    }
  }
  return fileChangesByEntryId
}

function countThreadMessages(thread: Thread) {
  return thread.turns.reduce((count, turn) => count + turn.items.filter((item) => (
    item.type === 'userMessage' || item.type === 'agentMessage'
  )).length, 0)
}

export function buildCodexPermissionApprovalResult(
  requestedPermissions: RequestPermissionProfile,
  optionId: string,
): PermissionsRequestApprovalResponse {
  const approved = optionId === 'allow_once' || optionId === 'allow_always'
  const permissions: PermissionsRequestApprovalResponse['permissions'] = approved
    ? {
        ...(requestedPermissions.fileSystem
          ? { fileSystem: structuredClone(requestedPermissions.fileSystem) }
          : {}),
        ...(requestedPermissions.network
          ? { network: structuredClone(requestedPermissions.network) }
          : {}),
      }
    : {}
  return {
    permissions,
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

export function buildCodexUserInputs(
  prompt: string,
  attachments: AgentPromptAttachment[],
): UserInput[] {
  const inputs: UserInput[] = prompt ? [{ type: 'text', text: prompt, text_elements: [] }] : []
  for (const attachment of attachments) {
    if (attachment.kind === 'file' && attachment.path) {
      inputs.push({ type: 'mention', name: attachment.fileName, path: attachment.path })
    } else if (attachment.kind === 'image') {
      if (attachment.data) inputs.push({ type: 'image', url: attachment.data })
      else if (attachment.path) inputs.push({ type: 'localImage', path: attachment.path })
    }
  }
  if (inputs.length === 0) throw new Error('Codex prompt must include text or an attachment.')
  return inputs
}

export class CodexAgentManager {
  private readonly bindingStarts = new Map<string, Promise<CodexBinding>>()
  private readonly bindingStartWorkspaces = new Map<string, string>()
  private readonly bindings = new Map<string, CodexBinding>()
  private client: CodexRpcClient | null = null
  private clientPromise: Promise<CodexRpcClient> | null = null
  private disposed = false
  private readonly index: AtomicJsonStore<CodexThreadIndex>
  private models: Model[] = []
  private readonly pendingInteractions = new Map<string, PendingCodexInteraction>()
  private readonly recordReplacements = new Map<string, Promise<CodexThreadRecord>>()
  private serviceTierCompatibilityOverride = false
  private readonly snapshotTimers = new Map<string, NodeJS.Timeout>()
  private readonly sessionStore = new CodexSessionStore()
  private readonly workspaceActiveThreads = new Map<string, string>()

  constructor(private readonly options: CodexAgentManagerOptions) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_INDEX),
      filePath: path.join(options.agentDir, 'external', 'codex', 'threads.json'),
      normalize: normalizeIndex,
    })
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    await this.ensureClient()
    return { activeSession: null, runtime: this.serializeRuntime(null, null), sessions: [] }
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null, options: { restoreSession?: boolean } = {}) {
    await this.ensureClient()
    const records = await this.listRecords(cwd)
    let activeId = options.restoreSession === false
      ? null
      : [preferredSessionPath, this.workspaceActiveThreads.get(workspaceIdentity(cwd)), records[0]?.id]
          .find((candidate): candidate is string => Boolean(candidate && records.some((record) => record.id === candidate)))
        ?? null
    if (activeId) {
      const record = await this.ensureOpenableRecord(cwd, activeId)
      activeId = record.id
      await this.requireBinding(cwd, activeId)
      this.workspaceActiveThreads.set(workspaceIdentity(cwd), activeId)
    }
    return this.buildWorkspaceState(cwd, activeId)
  }

  async listSessionItems(cwd: string) {
    return (await this.listRecords(cwd)).map((record) => this.createSessionListItem(record))
  }

  async readSession(cwd: string, threadId: string) {
    const record = await this.requireRecord(cwd, threadId)
    if (!record.materialized) {
      const snapshot = this.sessionStore.get(threadId)
      if (!snapshot) throw new Error('Codex thread is not materialized and has no in-memory state.')
      return this.createSessionSnapshot(record, snapshot)
    }
    await this.requireBinding(cwd, threadId)
    const checkpoint = this.sessionStore.beginHydration(threadId)
    try {
      const response = await (await this.ensureClient()).request('thread/read', {
        includeTurns: true,
        threadId,
      })
      const native = this.sessionStore.hydrate(response.thread, checkpoint)
      return this.createSessionSnapshot(record, native)
    } catch (error) {
      this.sessionStore.cancelHydration(checkpoint)
      const current = this.sessionStore.get(threadId)
      const message = error instanceof Error ? error.message : String(error)
      // A newly materialized rollout can be observable through app-server
      // notifications before thread/read can parse the on-disk JSONL. The
      // in-memory snapshot is therefore the authoritative fallback for this
      // narrowly classified transient failure, even if the turn has already
      // flipped back to idle by the time this read races it.
      if (current && isTransientThreadReadError(message)) {
        return this.createSessionSnapshot(record, current)
      }
      throw error
    }
  }

  async sessionExists(cwd: string, threadId: string) {
    return (await this.listRecords(cwd)).some((record) => record.id === threadId)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    const client = await this.ensureClient()
    const normalized = typeof options === 'string' ? { name: options } : options
    const defaultModel = this.defaultModel()
    const defaultModelKey = defaultModel ? `openai/${defaultModel.model}` : null
    const modelExplicit = Boolean(normalized?.modelKey && normalized.modelKey !== defaultModelKey)
    const selectedModel = normalized?.modelKey ? this.requireModel(normalized.modelKey) : defaultModel
    const model = selectedModel?.model ?? null
    const effort = reasoningEffort(normalized?.thinkingLevel ?? selectedModel?.defaultReasoningEffort)
    if (selectedModel) {
      if (!codexModelThinkingLevels(selectedModel).includes(effort)) {
        const selectedModelKey = normalized?.modelKey ?? defaultModelKey ?? selectedModel.model
        throw new Error(`Codex thinking level "${effort}" is not supported by "${selectedModelKey}".`)
      }
    }

    const result = await this.startNativeThread(client, cwd, model)
    const now = new Date().toISOString()
    const record: CodexThreadRecord = {
      createdAt: now,
      cwd,
      id: result.thread.id,
      materialized: false,
      model: result.model || model,
      modelExplicit,
      name: normalized?.name?.trim() || null,
      preview: normalized?.name?.trim() || null,
      reasoningEffort: effort,
      updatedAt: now,
    }
    this.sessionStore.install(result.thread)
    try {
      await this.index.update((state) => ({ ...state, threads: [record, ...state.threads] }))
    } catch (error) {
      this.sessionStore.delete(record.id)
      throw error
    }
    this.bindings.set(record.id, { activeTurnId: null, isStreaming: false, queuedPrompts: [], record })
    this.workspaceActiveThreads.set(workspaceIdentity(cwd), record.id)
    return this.broadcastWorkspaceState(cwd, record.id)
  }

  async openSession(cwd: string, threadId: string) {
    const record = await this.ensureOpenableRecord(cwd, threadId)
    await this.requireBinding(cwd, record.id)
    this.workspaceActiveThreads.set(workspaceIdentity(cwd), record.id)
    return this.broadcastWorkspaceState(cwd, record.id)
  }

  async deleteSession(cwd: string, threadId: string) {
    const originalThreadId = threadId
    let record = await this.requireRecord(cwd, threadId)
    const replacement = this.recordReplacements.get(threadId)
    if (replacement) record = await replacement
    threadId = record.id
    await this.bindingStarts.get(threadId)?.catch(() => undefined)
    const binding = this.bindings.get(threadId)
    if (record.materialized || binding) {
      const client = await this.ensureClient()
      if (binding?.activeTurnId) {
        await client.request('turn/interrupt', { threadId, turnId: binding.activeTurnId })
      }
      await client.request('thread/delete', { threadId }).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('no rollout found') && !message.includes('not found')) throw error
      })
    }
    await this.removeRecord(threadId)
    this.dropThreadRuntime(threadId)
    if (originalThreadId !== threadId) this.dropThreadRuntime(originalThreadId)
    const identity = workspaceIdentity(cwd)
    const activeId = this.workspaceActiveThreads.get(identity) ?? null
    const deletedActiveThread = activeId === threadId || activeId === originalThreadId
    if (deletedActiveThread) this.workspaceActiveThreads.delete(identity)
    return this.broadcastWorkspaceState(cwd, deletedActiveThread ? null : activeId)
  }

  async renameSession(cwd: string, threadId: string, name: string) {
    let record = await this.requireRecord(cwd, threadId)
    const replacement = this.recordReplacements.get(threadId)
    if (replacement) record = await replacement
    threadId = record.id
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('Codex 会话名称不能为空。')
    record.name = normalizedName
    await this.updateRecord(record)
    if (record.materialized) await this.setThreadName(await this.ensureClient(), record)
    const binding = this.bindings.get(threadId)
    if (binding) binding.record = record
    return this.broadcastWorkspaceState(cwd, this.workspaceActiveThreads.get(workspaceIdentity(cwd)) ?? null)
  }

  async sendPrompt(
    cwd: string,
    threadId: string,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments: AgentPromptAttachment[] = [],
    options?: AgentPromptSendOptions,
  ) {
    const binding = await this.requireBinding(cwd, threadId)
    if (binding.isStreaming) {
      if (streamingBehavior === 'steer' && binding.activeTurnId) {
        await (await this.ensureClient()).request('turn/steer', {
          ...(options?.clientMessageId ? { clientUserMessageId: options.clientMessageId } : {}),
          expectedTurnId: binding.activeTurnId,
          input: this.buildInputs(prompt, attachments),
          threadId,
        })
        return { ok: true }
      }
      binding.queuedPrompts.push({ attachments, options, prompt })
      return { ok: true }
    }
    await this.startTurn(binding, prompt, attachments, options)
    return { ok: true }
  }

  async selectModel(cwd: string, threadId: string, modelKey: string) {
    const binding = await this.requireBinding(cwd, threadId)
    const model = this.requireModel(modelKey)
    binding.record.model = model.model
    binding.record.modelExplicit = true
    const levels = codexModelThinkingLevels(model)
    if (!levels.includes(binding.record.reasoningEffort)) {
      binding.record.reasoningEffort = levels.includes('medium') ? 'medium' : levels[0]
    }
    await this.updateRecord(binding.record)
    return this.broadcastWorkspaceState(cwd, threadId)
  }

  async selectThinkingLevel(cwd: string, threadId: string, level: string, modelKey?: string) {
    const binding = await this.requireBinding(cwd, threadId)
    const nextLevel = reasoningEffort(level)
    if (!THINKING_LEVELS.includes(level as AgentThinkingLevel)) throw new Error(`Codex thinking level "${level}" is invalid.`)
    const model = modelKey
      ? this.requireModel(modelKey)
      : this.models.find((candidate) => candidate.model === binding.record.model)
    if (model && !codexModelThinkingLevels(model).includes(nextLevel)) {
      throw new Error(`Codex thinking level "${level}" is not supported by "openai/${model.model}".`)
    }
    binding.record.reasoningEffort = nextLevel
    if (modelKey && model) {
      binding.record.model = model.model
      binding.record.modelExplicit = true
    }
    await this.updateRecord(binding.record)
    return this.broadcastWorkspaceState(cwd, threadId)
  }

  async abortActivePrompt(cwd: string, threadId: string) {
    const binding = await this.requireBinding(cwd, threadId)
    if (binding.activeTurnId) {
      await (await this.ensureClient()).request('turn/interrupt', {
        threadId,
        turnId: binding.activeTurnId,
      })
    }
    // turn/interrupt only acknowledges the request. The turn remains active
    // until App Server publishes its authoritative completion/status event.
    return this.broadcastWorkspaceState(cwd, threadId)
  }

  respondToInteraction(response: AgentInteractionResponse) {
    const key = getAgentInteractionKey(response.sessionId, response.requestId)
    const pending = this.pendingInteractions.get(key)
    if (!pending || !this.client) return false
    let result: JsonRecord
    if (pending.kind === 'question' && pending.questionIds) {
      result = {
        answers: Object.fromEntries(pending.questionIds.map((questionId, index) => {
          const direct = response.answers?.[questionId]
          const fallback = index === 0
            ? response.optionId.startsWith('answer:')
              ? response.optionId.slice('answer:'.length)
              : response.values?.[0] ?? ''
            : ''
          return [questionId, { answers: direct ?? (fallback ? [fallback] : []) }]
        })),
      }
    } else if (pending.kind === 'permissions') {
      result = buildCodexPermissionApprovalResult(
        pending.requestedPermissions ?? { fileSystem: null, network: null },
        response.optionId,
      )
    } else {
      result = buildCodexApprovalResult(response.optionId, pending.approvalProtocol ?? 'v2')
    }
    this.client.respond(pending.originalId, result)
    this.pendingInteractions.delete(key)
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
    const ids = new Set((await this.listIndexedRecords(cwd)).map((record) => record.id))
    await Promise.all([...ids].map((id) => this.recordReplacements.get(id)?.catch(() => undefined)))
    // Official threads discovered outside Aryn have no ownership-index entry.
    // Track pending bindings by workspace so release catches them without
    // blocking unrelated workspaces that are starting in parallel.
    const pendingStarts = [...this.bindingStarts.entries()]
      .filter(([threadId]) => this.bindingStartWorkspaces.get(threadId) === identity)
      .map(([, start]) => start.catch(() => undefined))
    await Promise.all(pendingStarts)
    const bindings = [...this.bindings.values()].filter((binding) => workspaceIdentity(binding.record.cwd) === identity)
    const client = this.client
    const results = client
      ? await Promise.allSettled(bindings.map(async (binding) => {
          const failures: unknown[] = []
          if (binding.activeTurnId) {
            await client.request('turn/interrupt', {
              threadId: binding.record.id,
              turnId: binding.activeTurnId,
            }).catch((error) => failures.push(error))
          }
          await client.request('thread/unsubscribe', {
            threadId: binding.record.id,
          }).catch((error) => failures.push(error))
          if (failures.length === 1) throw failures[0]
          if (failures.length > 1) {
            throw new AggregateError(failures, `Codex thread ${binding.record.id} could not be released.`)
          }
        }))
      : []
    for (const binding of bindings) this.dropThreadRuntime(binding.record.id)
    this.workspaceActiveThreads.delete(identity)
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) throw new AggregateError(failures, 'One or more Codex turns could not be interrupted.')
  }

  async discardWorkspaceSessions(cwd: string) {
    // Only sessions recorded in Aryn's ownership manifest are eligible for
    // draft cleanup. Official Codex threads discovered in the same workspace
    // belong to the user and must not be archived here.
    let records = await this.listIndexedRecords(cwd)
    if (records.length === 0) return
    await Promise.all(records.map((record) => this.recordReplacements.get(record.id)?.catch(() => undefined)))
    records = await this.listIndexedRecords(cwd)
    const client = records.some((record) => record.materialized) ? await this.ensureClient() : null
    const archived = new Set<string>()
    let firstError: unknown = null
    for (const record of records) {
      try {
        if (record.materialized && client) await this.archiveThread(client, record.id)
        archived.add(record.id)
        this.dropThreadRuntime(record.id)
      } catch (error) {
        firstError ??= error
      }
    }
    if (archived.size > 0) {
      await this.index.update((state) => ({
        ...state,
        threads: state.threads.filter((record) => !archived.has(record.id)),
      }))
    }
    if (archived.size === records.length) this.workspaceActiveThreads.delete(workspaceIdentity(cwd))
    if (firstError) throw firstError
  }

  dispose() {
    this.disposed = true
    for (const timer of this.snapshotTimers.values()) clearTimeout(timer)
    this.snapshotTimers.clear()
    this.client?.stop()
    this.client = null
    this.clientPromise = null
    this.bindingStarts.clear()
    this.bindingStartWorkspaces.clear()
    this.bindings.clear()
    this.pendingInteractions.clear()
    this.recordReplacements.clear()
    this.sessionStore.clear()
    this.workspaceActiveThreads.clear()
  }

  private async ensureClient() {
    if (this.disposed) throw new Error('Codex manager has been disposed.')
    if (!this.clientPromise) {
      if (this.client) return this.client
      this.clientPromise = this.startClient()
    }
    try {
      return await this.clientPromise
    } catch (error) {
      this.client = null
      this.clientPromise = null
      throw error
    }
  }

  private async startClient() {
    let cacheRecoveryAttempted = false
    for (;;) {
      const args = this.serviceTierCompatibilityOverride
        ? ['app-server', '-c', 'service_tier=fast']
        : ['app-server']
      try {
        return await this.initializeClient(args)
      } catch (error) {
        if (this.disposed) throw error
        if (!cacheRecoveryAttempted && isRecoverableModelsCacheError(error)) {
          cacheRecoveryAttempted = true
          if (await this.recoverModelsCache()) continue
        }
        if (!this.serviceTierCompatibilityOverride && isServiceTierCompatibilityError(error)) {
          this.serviceTierCompatibilityOverride = true
          continue
        }
        throw error
      }
    }
  }

  private async recoverModelsCache() {
    const configuredHome = process.env.CODEX_HOME?.trim()
    const codexHome = configuredHome ? path.resolve(configuredHome) : path.join(os.homedir(), '.codex')
    const cachePath = path.join(codexHome, 'models_cache.json')
    const backupPath = path.join(codexHome, 'models_cache.aryn-incompatible.json')
    try {
      await copyFile(cachePath, backupPath)
      await rm(cachePath, { force: true })
      console.warn(`[codex app-server] Rebuilt an incompatible models cache. The previous cache is preserved at ${backupPath}.`)
      return true
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as NodeJS.ErrnoException).code)
        : null
      if (code !== 'ENOENT') {
        console.warn(`[codex app-server] Could not preserve and rebuild the incompatible models cache: ${error instanceof Error ? error.message : String(error)}`)
      }
      return false
    }
  }

  private async initializeClient(args: string[]) {
    await prepareExternalCliEnvironment()
    if (this.disposed) throw new Error('Codex manager has been disposed.')
    let client!: CodexRpcClient
    let eventChain = Promise.resolve()
    client = new CodexRpcClient({
      args,
      onExit: (error) => this.handleConnectionExit(client, error),
      onNotification: (notification) => {
        eventChain = eventChain
          .then(() => this.handleNotification(notification))
          .catch((error) => this.options.emitEvent({
            type: 'error',
            message: `Codex event handling failed: ${error instanceof Error ? error.message : String(error)}`,
            sessionId: 'threadId' in notification.params ? String(notification.params.threadId) : null,
          }))
      },
      onProtocolWarning: (message) => console.warn(`[codex app-server] ${message}`),
      onRequest: (request) => this.handleServerRequest(request),
    })
    this.client = client
    client.start()
    try {
      await client.request('initialize', {
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
        clientInfo: { name: 'aryn', title: 'Aryn', version: '0.1.0' },
      })
      client.notifyInitialized()
      const [models] = await Promise.all([
        this.loadModels(client),
        client.request('account/read', { refreshToken: false }).catch(() => null),
      ])
      if (this.disposed) throw new Error('Codex manager was disposed during App Server initialization.')
      this.models = models
      return client
    } catch (error) {
      if (this.client === client) this.client = null
      client.stop()
      throw error
    }
  }

  private async handleNotification(notification: ServerNotification) {
    const native = this.sessionStore.apply(notification)
    const threadId = native?.thread.id
      ?? (notification.method === 'thread/started' ? notification.params.thread.id : null)
      ?? ('threadId' in notification.params && typeof notification.params.threadId === 'string'
        ? notification.params.threadId
        : null)
    if (!threadId) return
    const binding = this.bindings.get(threadId)

    if (notification.method === 'turn/started' && binding) {
      binding.activeTurnId = notification.params.turn.id
      binding.isStreaming = true
    } else if (notification.method === 'turn/completed' && binding) {
      binding.activeTurnId = null
      binding.isStreaming = false
      if (native) this.scheduleSessionSnapshot(threadId)
      await this.touchRecord(binding.record).catch(() => undefined)
      await this.startNextQueuedPrompt(binding)
    } else if (notification.method === 'thread/name/updated' && binding) {
      binding.record.name = notification.params.threadName?.trim() || null
      if (native) this.scheduleSessionSnapshot(threadId)
      await this.updateRecord(binding.record).catch(() => undefined)
    } else if (notification.method === 'thread/status/changed' && binding) {
      binding.isStreaming = notification.params.status.type === 'active'
    } else if (notification.method === 'thread/closed' && binding) {
      binding.activeTurnId = null
      binding.isStreaming = false
    } else if (notification.method === 'serverRequest/resolved') {
      this.clearPendingInteractions((pending) => (
        pending.sessionId === threadId
        && String(pending.originalId) === String(notification.params.requestId)
      ))
    } else if (notification.method === 'error' && !notification.params.willRetry) {
      this.options.emitEvent({
        type: 'error',
        message: notification.params.error.message,
        sessionId: threadId,
      })
    }

    if (binding && native) this.scheduleSessionSnapshot(threadId)
  }

  private handleServerRequest(request: ServerRequest) {
    if (
      request.method === 'account/chatgptAuthTokens/refresh'
      || request.method === 'attestation/generate'
    ) {
      this.client?.respondError(request.id, -32601, `Unsupported Codex server request: ${request.method}.`)
      return
    }
    const threadId = 'threadId' in request.params
      ? request.params.threadId
      : 'conversationId' in request.params
        ? String(request.params.conversationId)
        : null
    if (!threadId) {
      this.client?.respondError(request.id, -32602, `${request.method} did not include a thread identifier.`)
      return
    }

    if (
      request.method === 'item/commandExecution/requestApproval'
      || request.method === 'item/fileChange/requestApproval'
      || request.method === 'item/permissions/requestApproval'
      || request.method === 'applyPatchApproval'
      || request.method === 'execCommandApproval'
    ) {
      const params = request.params as unknown as JsonRecord
      const isPermissions = request.method === 'item/permissions/requestApproval'
      const isLegacy = request.method === 'applyPatchApproval' || request.method === 'execCommandApproval'
      const requestedPermissions = isPermissions
        ? request.params.permissions
        : null
      const detail = this.describeApproval(request)
      const requestId = `codex:${String(request.id)}`
      this.pendingInteractions.set(getAgentInteractionKey(threadId, requestId), {
        approvalProtocol: isLegacy ? 'legacy' : 'v2',
        kind: isPermissions ? 'permissions' : 'approval',
        originalId: request.id,
        requestId,
        ...(requestedPermissions ? { requestedPermissions } : {}),
        sessionId: threadId,
      })
      this.options.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'codex',
          id: requestId,
          kind: 'permission',
          message: requestedPermissions ? this.describeRequestedPermissions(requestedPermissions, detail) : detail,
          options: [
            { id: 'deny', label: '拒绝' },
            { id: 'allow_once', label: '允许本次' },
            { id: 'allow_always', label: '本会话始终允许' },
          ],
          sessionId: threadId,
          title: isPermissions
            ? 'Codex 请求扩展权限'
            : request.method.includes('fileChange') || request.method === 'applyPatchApproval'
              ? 'Codex 请求修改文件'
              : 'Codex 请求执行命令',
          workspacePath: this.bindings.get(threadId)?.record.cwd ?? String(params.cwd ?? ''),
        },
      })
      return
    }

    if (request.method === 'item/tool/requestUserInput') {
      const questions = request.params.questions
      if (questions.length === 0) {
        this.client?.respondError(request.id, -32602, 'Codex user-input request contained no questions.')
        return
      }
      const requestId = `codex:${String(request.id)}`
      const questionIds = questions.map((question) => question.id)
      this.pendingInteractions.set(getAgentInteractionKey(threadId, requestId), {
        kind: 'question',
        originalId: request.id,
        questionIds,
        requestId,
        sessionId: threadId,
      })
      this.options.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'codex',
          fields: questions.map((question) => ({
            allowsCustomAnswer: question.isOther || !question.options?.length,
            id: question.id,
            isSecret: question.isSecret,
            label: question.header,
            message: question.question,
            options: question.options?.map((option) => ({
              description: option.description,
              id: option.label,
              label: option.label,
            })) ?? [],
          })),
          id: requestId,
          kind: 'question',
          message: questions.length === 1 ? questions[0].question : `Codex 有 ${questions.length} 个问题需要回答。`,
          options: [{ id: 'deny', label: '取消' }],
          sessionId: threadId,
          title: questions.length === 1 ? questions[0].header : 'Codex 提问',
          workspacePath: this.bindings.get(threadId)?.record.cwd ?? '',
        },
      })
      return
    }

    if (request.method === 'mcpServer/elicitation/request') {
      const response: McpServerElicitationRequestResponse = {
        _meta: null,
        action: 'decline',
        content: null,
      }
      this.client?.respond(request.id, response)
      console.warn(`[codex app-server] Declined unsupported MCP elicitation from ${request.params.serverName}.`)
      return
    }
    if (request.method === 'item/tool/call') {
      this.client?.respond(request.id, {
        contentItems: [{ type: 'inputText', text: 'Aryn did not register this dynamic tool.' }],
        success: false,
      })
      return
    }
    const unsupportedRequest = request as unknown as { id: string | number, method: string }
    this.client?.respondError(
      unsupportedRequest.id,
      -32601,
      `Unsupported Codex server request: ${unsupportedRequest.method}.`,
    )
  }

  private describeApproval(request: ServerRequest) {
    switch (request.method) {
      case 'item/commandExecution/requestApproval':
        return request.params.command ?? request.params.reason ?? 'Codex 请求执行受保护的命令。'
      case 'item/fileChange/requestApproval':
        return request.params.reason ?? request.params.grantRoot ?? 'Codex 请求修改工作区文件。'
      case 'item/permissions/requestApproval':
        return request.params.reason ?? 'Codex 请求扩展当前权限。'
      case 'execCommandApproval':
        return request.params.command.join(' ')
      case 'applyPatchApproval':
        return request.params.reason ?? Object.keys(request.params.fileChanges).join('\n')
      default:
        return 'Codex 请求批准操作。'
    }
  }

  private describeRequestedPermissions(permissions: RequestPermissionProfile, fallback: string) {
    const fileSystem = permissions.fileSystem
    const network = permissions.network
    const lines: string[] = []
    if (Array.isArray(fileSystem?.read) && fileSystem.read.length > 0) lines.push(`读取：${fileSystem.read.map(String).join('\n')}`)
    if (Array.isArray(fileSystem?.write) && fileSystem.write.length > 0) lines.push(`写入：${fileSystem.write.map(String).join('\n')}`)
    if (network?.enabled === true) lines.push('网络：允许访问')
    return lines.join('\n\n') || fallback
  }

  private handleConnectionExit(client: CodexRpcClient, error: Error) {
    if (this.client !== client) return
    this.client = null
    this.clientPromise = null
    this.models = []
    for (const binding of this.bindings.values()) {
      this.clearScheduledSnapshot(binding.record.id)
      const native = this.sessionStore.markDisconnected(binding.record.id, error.message)
      if (native) {
        this.options.emitEvent({
          type: 'session_snapshot_updated',
          executionState: native.status,
          session: this.createSessionSnapshot(binding.record, native),
          sessionId: binding.record.id,
        })
      }
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

  private async loadModels(client: CodexRpcClient) {
    const models: Model[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    do {
      const response: ModelListResponse = await client.request('model/list', {
        cursor,
        includeHidden: false,
        limit: 100,
      })
      models.push(...response.data)
      const nextCursor = response.nextCursor ?? null
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(`Codex model/list returned the repeated cursor "${nextCursor}".`)
      }
      if (nextCursor) seenCursors.add(nextCursor)
      cursor = nextCursor
    } while (cursor)
    return models
  }

  private buildInputs(prompt: string, attachments: AgentPromptAttachment[]): UserInput[] {
    return buildCodexUserInputs(prompt, attachments)
  }

  private async startNativeThread(client: CodexRpcClient, cwd: string, model: string | null) {
    return client.request('thread/start', {
      approvalPolicy: 'on-request',
      ...(this.serviceTierCompatibilityOverride ? { config: { service_tier: 'fast' }, serviceTier: 'fast' } : {}),
      cwd,
      ...(model ? { model } : {}),
      sandbox: 'workspace-write',
      serviceName: 'Aryn',
      threadSource: 'aryn',
    })
  }

  private async startTurn(
    binding: CodexBinding,
    prompt: string,
    attachments: AgentPromptAttachment[],
    options?: AgentPromptSendOptions,
  ) {
    const client = await this.ensureClient()
    const response = await client.request('turn/start', {
      ...(options?.clientMessageId ? { clientUserMessageId: options.clientMessageId } : {}),
      effort: codexReasoningEffort(binding.record.reasoningEffort),
      input: this.buildInputs(prompt, attachments),
      ...(binding.record.modelExplicit && binding.record.model ? { model: binding.record.model } : {}),
      ...(this.serviceTierCompatibilityOverride ? { serviceTier: 'fast' } : {}),
      threadId: binding.record.id,
    })
    binding.activeTurnId = response.turn.id
    const observedTurn = this.sessionStore.get(binding.record.id)?.thread.turns
      .find((turn) => turn.id === response.turn.id)
    const completedBeforeResponse = Boolean(observedTurn && observedTurn.status !== 'inProgress')
    binding.isStreaming = !completedBeforeResponse
    if (completedBeforeResponse) binding.activeTurnId = null
    if (!binding.record.materialized) {
      binding.record.materialized = true
      await this.updateRecord(binding.record).catch((error) => {
        console.warn(`[codex app-server] Turn started, but its thread metadata could not be persisted: ${error instanceof Error ? error.message : String(error)}`)
      })
      if (binding.record.name) {
        void this.setThreadName(client, binding.record).catch((error) => {
          console.warn(`[codex app-server] Failed to persist thread name: ${error instanceof Error ? error.message : String(error)}`)
        })
      }
    }
  }

  private async startNextQueuedPrompt(binding: CodexBinding) {
    while (!binding.isStreaming) {
      const next = binding.queuedPrompts.shift()
      if (!next) return
      try {
        await this.startTurn(binding, next.prompt, next.attachments, next.options)
      } catch (error) {
        this.options.emitEvent({
          type: 'error',
          message: `Codex queued prompt failed to start: ${error instanceof Error ? error.message : String(error)}`,
          sessionId: binding.record.id,
        })
      }
    }
  }

  private async resumeThread(record: CodexThreadRecord) {
    const checkpoint = this.sessionStore.beginHydration(record.id)
    let response
    try {
      response = await (await this.ensureClient()).request('thread/resume', {
        approvalPolicy: 'on-request',
        ...(this.serviceTierCompatibilityOverride ? { config: { service_tier: 'fast' }, serviceTier: 'fast' } : {}),
        cwd: record.cwd,
        ...(record.modelExplicit && record.model ? { model: record.model } : {}),
        sandbox: 'workspace-write',
        threadId: record.id,
      })
      this.sessionStore.hydrate(response.thread, checkpoint)
    } catch (error) {
      this.sessionStore.cancelHydration(checkpoint)
      throw error
    }
    if (!record.modelExplicit) record.model = response.model || record.model
    record.reasoningEffort = reasoningEffort(response.reasoningEffort)
    record.name = response.thread.name ?? record.name
    record.preview = response.thread.preview || record.preview || null
    const existing = this.bindings.get(record.id)
    this.bindings.set(record.id, existing ?? {
      activeTurnId: null,
      isStreaming: response.thread.status.type === 'active',
      queuedPrompts: [],
      record,
    })
  }

  private defaultModel() {
    return this.models.find((model) => model.isDefault) ?? this.models[0] ?? null
  }

  private requireModel(modelKey: string) {
    const normalized = modelKey.trim()
    const match = this.models.find((model) => `openai/${model.model}` === normalized)
    if (!match) throw new Error(`Codex model "${modelKey}" is not available.`)
    return match
  }

  private serializeRuntime(cwd: string | null, binding: CodexBinding | null): AgentWorkspaceState['runtime'] {
    const models = this.models.filter((model) => !model.hidden)
    const availableModels = models.map((model) => `openai/${model.model}`)
    const levelsByModel: Record<string, AgentThinkingLevel[]> = Object.fromEntries(models.map((model) => [
      `openai/${model.model}`,
      codexModelThinkingLevels(model),
    ]))
    const defaultModel = this.defaultModel()
    const defaultModelKey = defaultModel ? `openai/${defaultModel.model}` : null
    const selectedModel = binding?.record.model ? `openai/${binding.record.model}` : defaultModelKey
    const levels: AgentThinkingLevel[] = selectedModel
      ? levelsByModel[selectedModel] ?? ['low', 'medium', 'high']
      : ['low', 'medium', 'high']
    const native = binding ? this.sessionStore.get(binding.record.id) : null
    const executionState = native?.status ?? (binding?.isStreaming ? { type: 'busy' as const } : { type: 'idle' as const })

    return {
      agentId: 'codex',
      auth: {},
      availableModelInputs: Object.fromEntries(models.map((model) => [
        `openai/${model.model}`,
        model.inputModalities.includes('image') ? ['text', 'image'] : ['text'],
      ])),
      availableModels,
      availableThinkingLevels: levels,
      availableThinkingLevelsByModel: levelsByModel,
      compactionReason: null,
      defaultModel: defaultModelKey,
      defaultThinkingLevel: reasoningEffort(defaultModel?.defaultReasoningEffort),
      executionState,
      followUpMessageCount: binding?.queuedPrompts.length ?? 0,
      followUpMessages: binding?.queuedPrompts.map((queued) => queued.prompt) ?? [],
      followUpMode: 'one-at-a-time',
      hasConfiguredModels: availableModels.length > 0,
      isCompacting: false,
      isStreaming: binding?.isStreaming ?? false,
      pendingMessageCount: binding?.queuedPrompts.length ?? 0,
      preferredModelByProvider: defaultModelKey ? { openai: defaultModelKey } : {},
      retryAttempt: executionState.type === 'retry' ? executionState.attempt : 0,
      retryMaxAttempts: null,
      selectedModel,
      setupHint: availableModels.length > 0 ? null : 'Codex 当前没有可用模型，请先通过 Codex CLI 完成登录。',
      supportedRunningPromptBehaviors: ['steer', 'followUp'],
      supportsQueuedMessageEditing: false,
      supportsThinking: levels.some((level) => level !== 'off'),
      steeringMessageCount: 0,
      steeringMessages: [],
      steeringMode: 'one-at-a-time',
      thinkingLevel: binding?.record.reasoningEffort ?? reasoningEffort(defaultModel?.defaultReasoningEffort),
      workspacePath: cwd,
    }
  }

  private createSessionSnapshot(record: CodexThreadRecord, native: CodexNativeSessionSnapshot): AgentSessionSnapshot {
    return {
      annotations: { fileChangesByEntryId: fileChangesFromThread(native.thread) },
      messages: [],
      name: record.name ?? native.thread.name,
      native,
      sessionId: record.id,
      sessionPath: record.id,
      workspacePath: record.cwd,
    }
  }

  private createSessionListItem(record: CodexThreadRecord) {
    const native = this.sessionStore.get(record.id)
    return {
      createdAt: record.createdAt,
      id: record.id,
      messageCount: native ? countThreadMessages(native.thread) : 0,
      modifiedAt: record.updatedAt,
      name: record.name ?? native?.thread.name ?? null,
      path: record.id,
      preview: record.name ?? native?.thread.preview ?? record.preview ?? 'Codex thread',
    }
  }

  private async buildWorkspaceState(cwd: string, activeThreadId: string | null): Promise<AgentWorkspaceState> {
    const records = await this.listRecords(cwd)
    const binding = activeThreadId ? await this.requireBinding(cwd, activeThreadId) : null
    const native = binding ? this.sessionStore.get(binding.record.id) : null
    return {
      activeSession: binding
        ? native
          ? this.createSessionSnapshot(binding.record, native)
          : await this.readSession(cwd, binding.record.id)
        : null,
      runtime: this.serializeRuntime(cwd, binding),
      sessions: records.map((record) => this.createSessionListItem(record)),
    }
  }

  private async broadcastWorkspaceState(cwd: string, activeThreadId: string | null) {
    const state = await this.buildWorkspaceState(cwd, activeThreadId)
    this.options.emitEvent({ type: 'workspace_state', state })
    return state
  }

  private emitSessionSnapshot(threadId: string) {
    this.clearScheduledSnapshot(threadId)
    const binding = this.bindings.get(threadId)
    const native = this.sessionStore.get(threadId)
    if (!binding || !native) return
    this.options.emitEvent({
      type: 'session_snapshot_updated',
      executionState: native.status,
      session: this.createSessionSnapshot(binding.record, native),
      sessionId: threadId,
    })
  }

  private scheduleSessionSnapshot(threadId: string) {
    if (this.snapshotTimers.has(threadId)) return
    this.snapshotTimers.set(threadId, setTimeout(() => {
      this.snapshotTimers.delete(threadId)
      this.emitSessionSnapshot(threadId)
    }, SNAPSHOT_COALESCE_MS))
  }

  private clearScheduledSnapshot(threadId: string) {
    const timer = this.snapshotTimers.get(threadId)
    if (!timer) return
    clearTimeout(timer)
    this.snapshotTimers.delete(threadId)
  }

  private async listRecords(cwd: string) {
    const [nativeThreads, indexedRecords] = await Promise.all([
      this.listNativeThreads(cwd),
      this.listIndexedRecords(cwd),
    ])
    const indexedById = new Map(indexedRecords.map((record) => [record.id, record]))
    const nativeIds = new Set(nativeThreads.map((thread) => thread.id))
    const officialRecords = nativeThreads.map((thread): CodexThreadRecord => {
      const indexed = indexedById.get(thread.id)
      return {
        createdAt: new Date(thread.createdAt * 1_000).toISOString(),
        cwd: thread.cwd,
        id: thread.id,
        materialized: true,
        model: indexed?.model ?? null,
        modelExplicit: indexed?.modelExplicit ?? false,
        name: thread.name,
        preview: thread.preview || null,
        reasoningEffort: indexed?.reasoningEffort ?? 'medium',
        updatedAt: new Date(thread.updatedAt * 1_000).toISOString(),
      }
    })
    // thread/start can produce a real App Server thread before Codex writes a
    // rollout. Preserve those live drafts, but never revive stale materialized
    // index entries that are absent from the official thread list.
    const liveOrUnmaterializedDrafts = indexedRecords.filter((record) => (
      !nativeIds.has(record.id)
      && (!record.materialized || this.bindings.has(record.id) || this.sessionStore.get(record.id))
    ))
    return [...officialRecords, ...liveOrUnmaterializedDrafts]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  private async listNativeThreads(cwd: string) {
    const client = await this.ensureClient()
    const threads: Thread[] = []
    const seenCursors = new Set<string>()
    const seenThreadIds = new Set<string>()
    let cursor: string | null = null
    do {
      const response: ThreadListResponse = await client.request('thread/list', {
        archived: false,
        cursor,
        cwd,
        limit: 100,
        sortDirection: 'desc',
        sortKey: 'updated_at',
        sourceKinds: TOP_LEVEL_THREAD_SOURCE_KINDS,
      })
      for (const thread of response.data) {
        if (thread.ephemeral || thread.parentThreadId || seenThreadIds.has(thread.id)) continue
        seenThreadIds.add(thread.id)
        threads.push(thread)
      }
      const nextCursor = response.nextCursor ?? null
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(`Codex thread/list returned the repeated cursor "${nextCursor}".`)
      }
      if (nextCursor) seenCursors.add(nextCursor)
      cursor = nextCursor
    } while (cursor)
    return threads
  }

  private async listIndexedRecords(cwd: string) {
    const identity = workspaceIdentity(cwd)
    return (await this.index.read()).threads
      .filter((record) => workspaceIdentity(record.cwd) === identity)
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  }

  private async requireRecord(cwd: string, threadId: string) {
    const record = (await this.listRecords(cwd)).find((candidate) => candidate.id === threadId)
    if (!record) throw new Error('Codex thread not found for this workspace.')
    return record
  }

  private async ensureOpenableRecord(cwd: string, threadId: string) {
    const record = await this.requireRecord(cwd, threadId)
    if (record.materialized || this.bindings.has(threadId)) return record
    const pending = this.recordReplacements.get(threadId)
    if (pending) return pending
    const start = (async () => {
      const client = await this.ensureClient()
      const result = await this.startNativeThread(client, cwd, record.modelExplicit ? record.model : null)
      const replacement: CodexThreadRecord = {
        ...record,
        id: result.thread.id,
        model: result.model || record.model,
        updatedAt: new Date().toISOString(),
      }
      await this.index.update((state) => ({
        ...state,
        threads: state.threads.map((candidate) => candidate.id === threadId ? replacement : candidate),
      }))
      this.dropThreadRuntime(threadId)
      this.sessionStore.install(result.thread)
      this.bindings.set(replacement.id, {
        activeTurnId: null,
        isStreaming: false,
        queuedPrompts: [],
        record: replacement,
      })
      const identity = workspaceIdentity(cwd)
      if (this.workspaceActiveThreads.get(identity) === threadId) this.workspaceActiveThreads.set(identity, replacement.id)
      return replacement
    })().finally(() => {
      if (this.recordReplacements.get(threadId) === start) this.recordReplacements.delete(threadId)
    })
    this.recordReplacements.set(threadId, start)
    return start
  }

  private async requireBinding(cwd: string, threadId: string) {
    const existing = this.bindings.get(threadId)
    if (existing) return this.requireBindingWorkspace(existing, cwd)
    const pending = this.bindingStarts.get(threadId)
    if (pending) return this.requireBindingWorkspace(await pending, cwd)
    const start = this.requireRecord(cwd, threadId)
      .then(async (record) => {
        await this.resumeThread(record)
        const binding = this.bindings.get(threadId)
        if (!binding) throw new Error('Codex thread resumed without creating a runtime binding.')
        return binding
      })
      .finally(() => {
        if (this.bindingStarts.get(threadId) === start) {
          this.bindingStarts.delete(threadId)
          this.bindingStartWorkspaces.delete(threadId)
        }
      })
    this.bindingStarts.set(threadId, start)
    this.bindingStartWorkspaces.set(threadId, workspaceIdentity(cwd))
    return start
  }

  private requireBindingWorkspace(binding: CodexBinding, cwd: string) {
    if (workspaceIdentity(binding.record.cwd) !== workspaceIdentity(cwd)) {
      throw new Error('Codex thread not found for this workspace.')
    }
    return binding
  }

  private async setThreadName(client: CodexRpcClient, record: CodexThreadRecord) {
    if (!record.name) return
    await client.request('thread/name/set', { name: record.name, threadId: record.id })
  }

  private async archiveThread(client: CodexRpcClient, threadId: string) {
    await client.request('thread/archive', { threadId }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('no rollout found') && !message.includes('not found')) throw error
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

  private async removeRecord(threadId: string) {
    await this.index.update((state) => ({
      ...state,
      threads: state.threads.filter((record) => record.id !== threadId),
    }))
  }

  private dropThreadRuntime(threadId: string) {
    this.clearScheduledSnapshot(threadId)
    this.bindings.delete(threadId)
    this.sessionStore.delete(threadId)
    this.clearPendingInteractions((pending) => pending.sessionId === threadId)
  }

  private clearPendingInteractions(predicate: (pending: PendingCodexInteraction) => boolean) {
    for (const [key, pending] of this.pendingInteractions) {
      if (!predicate(pending)) continue
      this.pendingInteractions.delete(key)
      this.options.emitEvent({
        type: 'interaction_resolved',
        requestId: pending.requestId,
        resumeRun: false,
        sessionId: pending.sessionId,
      })
    }
  }
}

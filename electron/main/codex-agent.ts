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
import {
  SessionRuntimeCoordinator,
  type SessionRuntimeLease,
} from './session-runtime-coordinator'

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
  lease: SessionRuntimeLease
  queuedPrompts: QueuedCodexPrompt[]
  record: CodexThreadRecord
}

type PendingCodexInteraction = {
  approvalProtocol?: 'legacy' | 'v2'
  client: CodexRpcClient
  kind: 'approval' | 'permissions' | 'question'
  lease: SessionRuntimeLease
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

type WorkspaceActivation = {
  identity: string
  revision: number
}

type WorkspaceActivationState = {
  revision: number
  targetThreadId?: string | null
}

type WorkspaceOperation = {
  identity: string
  revision: number
}

type WorkspaceStateContext = {
  activation?: WorkspaceActivation
  providedBinding?: CodexBinding
  sourceLease?: SessionRuntimeLease
  state?: AgentWorkspaceState
  workspaceOperation?: WorkspaceOperation
}

type CodexRecordReplacement = {
  promise: Promise<CodexThreadRecord>
  workspaceIdentity: string
}

const DEFAULT_INDEX: CodexThreadIndex = { threads: [], version: 1 }
const THINKING_LEVELS: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']
const SNAPSHOT_COALESCE_MS = 16
const TOP_LEVEL_THREAD_SOURCE_KINDS: ThreadSourceKind[] = ['cli', 'vscode', 'exec', 'appServer', 'unknown']

function workspaceIdentity(cwd: string) {
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function runtimeKey(cwd: string, threadId: string) {
  return `${workspaceIdentity(cwd)}\0${threadId}`
}

function workspaceRuntimeKeyPrefix(cwd: string) {
  return `${workspaceIdentity(cwd)}\0`
}

function notificationThreadId(notification: ServerNotification) {
  return notification.method === 'thread/started'
    ? notification.params.thread.id
    : 'threadId' in notification.params && typeof notification.params.threadId === 'string'
      ? notification.params.threadId
      : null
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

function isMissingNativeThreadError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('no rollout found') || message.includes('not found')
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
  private readonly bindingLeases = new Map<string, SessionRuntimeLease>()
  private readonly bindings = new Map<string, CodexBinding>()
  private client: CodexRpcClient | null = null
  private clientPromise: Promise<CodexRpcClient> | null = null
  private clientStartRevision = 0
  private disposed = false
  private readonly index: AtomicJsonStore<CodexThreadIndex>
  private models: Model[] = []
  private readonly pendingInteractions = new Map<string, PendingCodexInteraction>()
  private readonly recordReplacements = new Map<string, CodexRecordReplacement>()
  private readonly runtimeCoordinator: SessionRuntimeCoordinator<CodexBinding>
  private serviceTierCompatibilityOverride = false
  private readonly snapshotTimers = new Map<string, NodeJS.Timeout>()
  private readonly sessionStore = new CodexSessionStore()
  // Activation revisions preserve the latest foreground selection. Operation
  // revisions are invalidated by release/discard; state revisions suppress an
  // older asynchronous snapshot that completes after a newer one.
  private readonly workspaceActivations = new Map<string, WorkspaceActivationState>()
  private readonly workspaceActiveThreads = new Map<string, string>()
  // thread/start has no coordinator key until Codex returns an id. Teardown
  // waits on these counters so a late creation cannot outlive the workspace.
  private readonly workspaceCreationCounts = new Map<string, number>()
  private readonly workspaceCreationWaiters = new Map<string, Set<() => void>>()
  private readonly workspaceOperationRevisions = new Map<string, number>()
  private readonly workspaceStateRevisions = new Map<string, number>()
  private readonly workspaceTeardownCounts = new Map<string, number>()

  constructor(private readonly options: CodexAgentManagerOptions) {
    this.index = new AtomicJsonStore({
      defaultState: () => structuredClone(DEFAULT_INDEX),
      filePath: path.join(options.agentDir, 'external', 'codex', 'threads.json'),
      normalize: normalizeIndex,
    })
    this.runtimeCoordinator = new SessionRuntimeCoordinator({
      stopRuntime: (binding) => this.dropThreadRuntime(binding.record.id, binding),
    })
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    await this.ensureClient()
    return { activeSession: null, runtime: this.serializeRuntime(null, null), sessions: [] }
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null, options: { restoreSession?: boolean } = {}) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const activation = this.beginWorkspaceActivation(cwd)
    await this.ensureClient()
    const records = await this.listRecords(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    let activeId = options.restoreSession === false
      ? null
      : [preferredSessionPath, this.workspaceActiveThreads.get(activation.identity), records[0]?.id]
          .find((candidate): candidate is string => Boolean(candidate && records.some((record) => record.id === candidate)))
        ?? null
    if (!this.setWorkspaceActivationTarget(activation, activeId)) {
      throw new Error('Codex workspace activation was superseded.')
    }
    if (activeId) {
      const record = await this.ensureOpenableRecord(cwd, activeId, workspaceOperation)
      activeId = record.id
      if (!this.setWorkspaceActivationTarget(activation, activeId)) {
        throw new Error('Codex workspace activation was superseded.')
      }
      let sourceLease!: SessionRuntimeLease
      const state = await this.withBinding(cwd, activeId, async (binding) => {
        sourceLease = binding.lease
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        const nextState = await this.buildWorkspaceState(cwd, activeId, binding, () => (
          this.isWorkspaceOperationCurrent(workspaceOperation)
          && this.isWorkspaceActivationCurrent(activation)
          && binding.lease.isCurrent()
        ))
        if (!this.commitWorkspaceActivation(activation, activeId)) {
          throw new Error('Codex workspace activation was superseded.')
        }
        return nextState
      }, workspaceOperation)
      if (
        !sourceLease.isCurrent()
        || !this.isWorkspaceOperationCurrent(workspaceOperation)
        || !this.isWorkspaceActivationCurrent(activation)
      ) {
        throw new Error('Codex workspace state request was superseded.')
      }
      return state
    }
    const state = await this.buildWorkspaceState(cwd, null, undefined, () => (
      this.isWorkspaceOperationCurrent(workspaceOperation)
      && this.isWorkspaceActivationCurrent(activation)
    ))
    if (!this.commitWorkspaceActivation(activation, null)) {
      throw new Error('Codex workspace activation was superseded.')
    }
    return state
  }

  async listSessionItems(cwd: string) {
    return (await this.listRecords(cwd)).map((record) => this.createSessionListItem(record))
  }

  async readSession(cwd: string, threadId: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const record = await this.requireRecord(cwd, threadId)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    if (!record.materialized) {
      const snapshot = this.sessionStore.get(threadId)
      if (!snapshot) throw new Error('Codex thread is not materialized and has no in-memory state.')
      return this.createSessionSnapshot(record, snapshot)
    }
    return this.withBinding(cwd, threadId, (binding) => this.readBoundSession(binding), workspaceOperation)
  }

  private async readBoundSession(binding: CodexBinding) {
    const { record } = binding
    const threadId = record.id
    if (!binding.lease.isCurrent()) {
      throw new Error('Codex thread binding was superseded.')
    }
    const checkpoint = this.sessionStore.beginHydration(threadId)
    try {
      const response = await (await this.ensureClient()).request('thread/read', {
        includeTurns: true,
        threadId,
      })
      if (!binding.lease.isCurrent()) {
        this.sessionStore.cancelHydration(checkpoint)
        throw new Error('Codex thread binding was superseded.')
      }
      const native = this.sessionStore.hydrate(response.thread, checkpoint)
      return this.createSessionSnapshot(record, native)
    } catch (error) {
      this.sessionStore.cancelHydration(checkpoint)
      if (!binding.lease.isCurrent()) {
        throw new Error('Codex thread binding was superseded.')
      }
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
    return this.withWorkspaceCreation(
      workspaceIdentity(cwd),
      () => this.createSessionInside(cwd, options),
    )
  }

  private async createSessionInside(cwd: string, options?: string | AgentSessionCreateOptions) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const activation = this.beginWorkspaceActivation(cwd)
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
    let indexed = false
    try {
      if (!this.setWorkspaceActivationTarget(activation, record.id)) {
        throw new Error('Codex workspace activation was superseded.')
      }
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      this.sessionStore.install(result.thread)
      await this.index.update((state) => ({ ...state, threads: [record, ...state.threads] }))
      indexed = true
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      await this.installBinding(record, result.thread.status.type === 'active', client)
      if (!this.isWorkspaceActivationCurrent(activation)) {
        throw new Error('Codex workspace activation was superseded.')
      }
      let sourceLease!: SessionRuntimeLease
      const state = await this.withBinding(cwd, record.id, async (binding) => {
        sourceLease = binding.lease
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        const nextState = await this.buildWorkspaceState(cwd, record.id, binding, () => (
          this.isWorkspaceOperationCurrent(workspaceOperation)
          && this.isWorkspaceActivationCurrent(activation)
          && binding.lease.isCurrent()
        ))
        if (!this.commitWorkspaceActivation(activation, record.id)) {
          throw new Error('Codex workspace activation was superseded.')
        }
        return nextState
      }, workspaceOperation)
      return await this.broadcastWorkspaceState(cwd, record.id, {
        activation,
        sourceLease,
        state,
        workspaceOperation,
      })
    } catch (error) {
      const identity = workspaceIdentity(cwd)
      if (this.isWorkspaceActivationCurrent(activation)) {
        this.invalidateWorkspaceActivation(identity)
      }
      if (this.workspaceActiveThreads.get(identity) === record.id) {
        this.workspaceActiveThreads.delete(identity)
      }
      const released = await this.cleanupUncommittedThread(client, record.cwd, record.id, 'failed creation')
      if (indexed && released) {
        await this.removeRecord(record.id).catch((cleanupError) => {
          console.warn(`[codex app-server] Failed to remove a rolled-back thread from the ownership index: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
        })
      } else if (!indexed && !released) {
        await this.index.update((state) => ({
          ...state,
          threads: state.threads.some((candidate) => candidate.id === record.id)
            ? state.threads
            : [record, ...state.threads],
        })).catch((cleanupError) => {
          console.warn(`[codex app-server] Failed to retain ownership of a thread whose rollback cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
        })
      }
      throw error
    }
  }

  async openSession(cwd: string, threadId: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const activation = this.beginWorkspaceActivation(cwd, threadId)
    const record = await this.ensureOpenableRecord(cwd, threadId, workspaceOperation)
    if (!this.setWorkspaceActivationTarget(activation, record.id)) {
      throw new Error('Codex workspace activation was superseded.')
    }
    let sourceLease!: SessionRuntimeLease
    const state = await this.withBinding(cwd, record.id, async (binding) => {
      sourceLease = binding.lease
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      const nextState = await this.buildWorkspaceState(cwd, record.id, binding, () => (
        this.isWorkspaceOperationCurrent(workspaceOperation)
        && this.isWorkspaceActivationCurrent(activation)
        && binding.lease.isCurrent()
      ))
      if (!this.commitWorkspaceActivation(activation, record.id)) {
        throw new Error('Codex workspace activation was superseded.')
      }
      return nextState
    }, workspaceOperation)
    return this.broadcastWorkspaceState(cwd, record.id, {
      activation,
      sourceLease,
      state,
      workspaceOperation,
    })
  }

  async deleteSession(cwd: string, threadId: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const originalThreadId = threadId
    this.invalidateWorkspaceActivationForThread(workspaceIdentity(cwd), originalThreadId)
    const replacement = this.recordReplacements.get(threadId)
    const record = replacement
      ? await this.requireReplacementWorkspace(replacement, cwd)
      : await this.requireRecord(cwd, threadId)
    threadId = record.id
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const nextActiveThreadId = await this.runtimeCoordinator.runAndRetire(
      runtimeKey(cwd, threadId),
      async (current) => {
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        const binding = current?.runtime ?? null
        if (record.materialized || binding) {
          await this.deleteNativeThread(await this.ensureClient(), threadId, binding)
        } else if (this.client) {
          await this.unsubscribeThread(await this.ensureClient(), threadId)
        }
        await this.removeRecord(threadId)
        const identity = workspaceIdentity(cwd)
        const activeId = this.workspaceActiveThreads.get(identity) ?? null
        const deletedActiveThread = activeId === threadId || activeId === originalThreadId
        if (deletedActiveThread) this.workspaceActiveThreads.delete(identity)
        return deletedActiveThread ? null : activeId
      }
    )
    if (originalThreadId !== threadId) {
      await this.runtimeCoordinator.retire(runtimeKey(cwd, originalThreadId))
      this.dropThreadRuntime(originalThreadId)
    }
    return this.broadcastWorkspaceState(cwd, nextActiveThreadId, { workspaceOperation })
  }

  async renameSession(cwd: string, threadId: string, name: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const replacement = this.recordReplacements.get(threadId)
    let record = replacement
      ? await this.requireReplacementWorkspace(replacement, cwd)
      : await this.requireRecord(cwd, threadId)
    threadId = record.id
    const normalizedName = name.trim()
    if (!normalizedName) throw new Error('Codex 会话名称不能为空。')
    await this.runtimeCoordinator.run(runtimeKey(cwd, threadId), async () => {
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      const nextRecord = { ...record, name: normalizedName }
      if (nextRecord.materialized) await this.setThreadName(await this.ensureClient(), nextRecord)
      await this.updateRecord(nextRecord)
      record = nextRecord
      const binding = this.bindings.get(threadId)
      if (binding?.lease.isCurrent()) binding.record = nextRecord
    })
    return this.broadcastWorkspaceState(
      cwd,
      this.workspaceActiveThreads.get(workspaceIdentity(cwd)) ?? null,
      { workspaceOperation },
    )
  }

  async sendPrompt(
    cwd: string,
    threadId: string,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments: AgentPromptAttachment[] = [],
    options?: AgentPromptSendOptions,
  ) {
    return this.withBinding(cwd, threadId, async (binding) => {
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
    })
  }

  async selectModel(cwd: string, threadId: string, modelKey: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, threadId, async (binding) => {
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      sourceLease = binding.lease
      const model = this.requireModel(modelKey)
      const nextRecord = {
        ...binding.record,
        model: model.model,
        modelExplicit: true,
      }
      const levels = codexModelThinkingLevels(model)
      if (!levels.includes(nextRecord.reasoningEffort)) {
        nextRecord.reasoningEffort = levels.includes('medium') ? 'medium' : levels[0]
      }
      await this.updateRecord(nextRecord)
      binding.record = nextRecord
    }, workspaceOperation)
    return this.broadcastWorkspaceState(
      cwd,
      threadId,
      { sourceLease, workspaceOperation },
    )
  }

  async selectThinkingLevel(cwd: string, threadId: string, level: string, modelKey?: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, threadId, async (binding) => {
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      sourceLease = binding.lease
      const nextLevel = reasoningEffort(level)
      if (!THINKING_LEVELS.includes(level as AgentThinkingLevel)) throw new Error(`Codex thinking level "${level}" is invalid.`)
      const model = modelKey
        ? this.requireModel(modelKey)
        : this.models.find((candidate) => candidate.model === binding.record.model)
      if (model && !codexModelThinkingLevels(model).includes(nextLevel)) {
        throw new Error(`Codex thinking level "${level}" is not supported by "openai/${model.model}".`)
      }
      const nextRecord = { ...binding.record, reasoningEffort: nextLevel }
      if (modelKey && model) {
        nextRecord.model = model.model
        nextRecord.modelExplicit = true
      }
      await this.updateRecord(nextRecord)
      binding.record = nextRecord
    }, workspaceOperation)
    return this.broadcastWorkspaceState(
      cwd,
      threadId,
      { sourceLease, workspaceOperation },
    )
  }

  async abortActivePrompt(cwd: string, threadId: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, threadId, async (binding) => {
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      sourceLease = binding.lease
      if (binding.activeTurnId) {
        await (await this.ensureClient()).request('turn/interrupt', {
          threadId,
          turnId: binding.activeTurnId,
        })
      }
    }, workspaceOperation)
    // turn/interrupt only acknowledges the request. The turn remains active
    // until App Server publishes its authoritative completion/status event.
    return this.broadcastWorkspaceState(
      cwd,
      threadId,
      { sourceLease, workspaceOperation },
    )
  }

  respondToInteraction(response: AgentInteractionResponse) {
    const key = getAgentInteractionKey(response.sessionId, response.requestId)
    const pending = this.pendingInteractions.get(key)
    if (
      !pending
      || pending.client !== this.client
      || !pending.lease.isCurrent()
    ) return false
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
    pending.client.respond(pending.originalId, result)
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
    return this.withWorkspaceTeardown(identity, async () => {
      this.invalidateWorkspaceActivation(identity)
      this.invalidateWorkspaceOperations(identity)
      this.workspaceActiveThreads.delete(identity)
      this.invalidateWorkspaceState(identity)
      await Promise.all([
        this.waitForWorkspaceCreations(identity),
        this.waitForRecordReplacements(identity),
      ])
      const keys = this.runtimeCoordinator.keys().filter((key) => key.startsWith(workspaceRuntimeKeyPrefix(cwd)))
      const client = this.client
      const results = await Promise.allSettled(keys.map((key) => this.runtimeCoordinator.retireAndRun(
        key,
        async (retired) => {
          if (!retired || !client) return
          await this.releaseNativeBinding(client, retired.runtime)
        },
      )))
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length > 0) throw new AggregateError(failures, 'One or more Codex thread bindings could not be released.')
    })
  }

  async discardWorkspaceSessions(cwd: string) {
    // Only sessions recorded in Aryn's ownership manifest are eligible for
    // draft cleanup. Official Codex threads discovered in the same workspace
    // belong to the user and must not be archived here.
    const identity = workspaceIdentity(cwd)
    return this.withWorkspaceTeardown(identity, async () => {
      this.invalidateWorkspaceActivation(identity)
      this.invalidateWorkspaceOperations(identity)
      this.invalidateWorkspaceState(identity)
      await Promise.all([
        this.waitForWorkspaceCreations(identity),
        this.waitForRecordReplacements(identity),
      ])
      const records = await this.listIndexedRecords(cwd)
      if (records.length === 0) return
      const client = records.some((record) => record.materialized) || this.client
        ? await this.ensureClient()
        : null
      const nativeThreadIds = client
        ? new Set((await this.listNativeThreads(cwd)).map((thread) => thread.id))
        : new Set<string>()
      const archived = new Set<string>()
      const results = await Promise.allSettled(records.map((record) => this.runtimeCoordinator.runAndRetire(
        runtimeKey(cwd, record.id),
        async (current) => {
          const materialized = record.materialized
            || nativeThreadIds.has(record.id)
            || current?.runtime.record.materialized === true
          if (materialized && client) {
            await this.archiveThread(client, record.id)
          } else if (current && client) {
            await this.releaseNativeBinding(client, current.runtime)
          } else if (client) {
            await this.unsubscribeThread(client, record.id)
          }
          archived.add(record.id)
        },
      )))
      if (archived.size > 0) {
        await this.index.update((state) => ({
          ...state,
          threads: state.threads.filter((record) => !archived.has(record.id)),
        }))
      }
      const activeThreadId = this.workspaceActiveThreads.get(identity)
      if (activeThreadId && archived.has(activeThreadId)) this.workspaceActiveThreads.delete(identity)
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, 'One or more Codex sessions could not be discarded.')
      }
    })
  }

  dispose() {
    this.disposed = true
    for (const timer of this.snapshotTimers.values()) clearTimeout(timer)
    this.snapshotTimers.clear()
    this.client?.stop()
    this.client = null
    this.clientPromise = null
    this.clientStartRevision += 1
    void this.runtimeCoordinator.dispose()
    this.bindingLeases.clear()
    this.bindings.clear()
    this.pendingInteractions.clear()
    this.recordReplacements.clear()
    this.sessionStore.clear()
    this.workspaceActivations.clear()
    this.workspaceActiveThreads.clear()
    this.workspaceCreationCounts.clear()
    for (const waiters of this.workspaceCreationWaiters.values()) {
      for (const resolve of waiters) resolve()
    }
    this.workspaceCreationWaiters.clear()
    this.workspaceOperationRevisions.clear()
    this.workspaceStateRevisions.clear()
    this.workspaceTeardownCounts.clear()
  }

  drainSessionEvents(cwd: string, threadId: string) {
    return this.runtimeCoordinator.drain(runtimeKey(cwd, threadId))
  }

  private async ensureClient() {
    if (this.disposed) throw new Error('Codex manager has been disposed.')
    if (!this.clientPromise) {
      if (this.client) return this.client
      this.clientStartRevision += 1
      this.clientPromise = this.startClient(this.clientStartRevision)
    }
    const clientPromise = this.clientPromise
    try {
      return await clientPromise
    } catch (error) {
      if (this.clientPromise === clientPromise) {
        this.client = null
        this.clientPromise = null
      }
      throw error
    }
  }

  private async startClient(startRevision: number) {
    let cacheRecoveryAttempted = false
    for (;;) {
      if (startRevision !== this.clientStartRevision) {
        throw new Error('Codex App Server startup was superseded.')
      }
      const args = this.serviceTierCompatibilityOverride
        ? ['app-server', '-c', 'service_tier=fast']
        : ['app-server']
      try {
        return await this.initializeClient(args)
      } catch (error) {
        if (this.disposed) throw error
        if (startRevision !== this.clientStartRevision) throw error
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
        if (this.client !== client || this.disposed) return
        const threadId = notificationThreadId(notification)
        const lease = threadId ? this.bindingLeases.get(threadId) : null
        const reportError = (error: Error) => {
          if (this.client !== client || (lease && !lease.isCurrent())) return
          this.options.emitEvent({
            type: 'error',
            message: `Codex event handling failed: ${error.message}`,
            sessionId: threadId,
          })
        }
        const handle = () => {
          if (this.client !== client || this.disposed || (lease && !lease.isCurrent())) return
          return this.handleNotification(notification, lease ?? undefined)
        }
        if (lease) {
          lease.enqueue(handle, reportError)
        } else {
          eventChain = eventChain.then(handle).catch((error) => {
            reportError(error instanceof Error ? error : new Error(String(error)))
          })
        }
      },
      onProtocolWarning: (message) => console.warn(`[codex app-server] ${message}`),
      onRequest: (request) => {
        if (this.client !== client || this.disposed) return
        const threadId = 'threadId' in request.params
          ? request.params.threadId
          : 'conversationId' in request.params
            ? String(request.params.conversationId)
            : null
        this.handleServerRequest(request, client, threadId ? this.bindingLeases.get(threadId) : undefined)
      },
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
      if (this.client !== client) throw new Error('Codex App Server initialization was superseded.')
      this.models = models
      return client
    } catch (error) {
      if (this.client === client) this.client = null
      client.stop()
      throw error
    }
  }

  private async handleNotification(notification: ServerNotification, sourceLease?: SessionRuntimeLease) {
    if (sourceLease && !sourceLease.isCurrent()) return
    const native = this.sessionStore.apply(notification)
    const threadId = native?.thread.id ?? notificationThreadId(notification)
    if (!threadId) return
    const binding = this.bindings.get(threadId)
    if (sourceLease && binding?.lease !== sourceLease) return

    if (notification.method === 'turn/started' && binding) {
      binding.activeTurnId = notification.params.turn.id
      binding.isStreaming = true
    } else if (notification.method === 'turn/completed' && binding) {
      binding.activeTurnId = null
      binding.isStreaming = false
      if (native) this.scheduleSessionSnapshot(threadId, sourceLease ?? binding.lease)
      await this.touchRecord(binding.record).catch(() => undefined)
      if (sourceLease && !sourceLease.isCurrent()) return
      await this.startNextQueuedPrompt(binding)
    } else if (notification.method === 'thread/name/updated' && binding) {
      binding.record.name = notification.params.threadName?.trim() || null
      if (native) this.scheduleSessionSnapshot(threadId, sourceLease ?? binding.lease)
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
        && (!sourceLease || pending.lease === sourceLease)
      ))
    } else if (notification.method === 'error' && !notification.params.willRetry) {
      this.options.emitEvent({
        type: 'error',
        message: notification.params.error.message,
        sessionId: threadId,
      })
    }

    if (binding && native && (!sourceLease || sourceLease.isCurrent())) {
      this.scheduleSessionSnapshot(threadId, sourceLease ?? binding.lease)
    }
  }

  private handleServerRequest(
    request: ServerRequest,
    sourceClient: CodexRpcClient | null = this.client,
    sourceLease?: SessionRuntimeLease,
  ) {
    if (!sourceClient || sourceClient !== this.client || this.disposed) return
    if (
      request.method === 'account/chatgptAuthTokens/refresh'
      || request.method === 'attestation/generate'
    ) {
      sourceClient.respondError(request.id, -32601, `Unsupported Codex server request: ${request.method}.`)
      return
    }
    const threadId = 'threadId' in request.params
      ? request.params.threadId
      : 'conversationId' in request.params
        ? String(request.params.conversationId)
        : null
    if (!threadId) {
      sourceClient.respondError(request.id, -32602, `${request.method} did not include a thread identifier.`)
      return
    }

    const lease = sourceLease ?? this.bindingLeases.get(threadId)

    if (
      request.method === 'item/commandExecution/requestApproval'
      || request.method === 'item/fileChange/requestApproval'
      || request.method === 'item/permissions/requestApproval'
      || request.method === 'applyPatchApproval'
      || request.method === 'execCommandApproval'
    ) {
      if (!lease?.isCurrent()) {
        sourceClient.respondError(request.id, -32000, 'Codex thread binding is no longer active.')
        return
      }
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
        client: sourceClient,
        kind: isPermissions ? 'permissions' : 'approval',
        lease,
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
      if (!lease?.isCurrent()) {
        sourceClient.respondError(request.id, -32000, 'Codex thread binding is no longer active.')
        return
      }
      const questions = request.params.questions
      if (questions.length === 0) {
        sourceClient.respondError(request.id, -32602, 'Codex user-input request contained no questions.')
        return
      }
      const requestId = `codex:${String(request.id)}`
      const questionIds = questions.map((question) => question.id)
      this.pendingInteractions.set(getAgentInteractionKey(threadId, requestId), {
        client: sourceClient,
        kind: 'question',
        lease,
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
      sourceClient.respond(request.id, response)
      console.warn(`[codex app-server] Declined unsupported MCP elicitation from ${request.params.serverName}.`)
      return
    }
    if (request.method === 'item/tool/call') {
      sourceClient.respond(request.id, {
        contentItems: [{ type: 'inputText', text: 'Aryn did not register this dynamic tool.' }],
        success: false,
      })
      return
    }
    const unsupportedRequest = request as unknown as { id: string | number, method: string }
    sourceClient.respondError(
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
    this.clientStartRevision += 1
    this.client = null
    this.clientPromise = null
    this.models = []
    if (this.disposed) return
    const bindings = [...this.bindings.values()]
    for (const binding of bindings) {
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
    this.clearPendingInteractions((pending) => pending.client === client)
    void this.runtimeCoordinator.invalidateWhere(() => true).catch((retirementError) => {
      console.warn(`[codex app-server] Failed to invalidate disconnected thread bindings: ${retirementError instanceof Error ? retirementError.message : String(retirementError)}`)
    })
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
    if (!binding.lease.isCurrent()) return
    const client = await this.ensureClient()
    const response = await client.request('turn/start', {
      ...(options?.clientMessageId ? { clientUserMessageId: options.clientMessageId } : {}),
      effort: codexReasoningEffort(binding.record.reasoningEffort),
      input: this.buildInputs(prompt, attachments),
      ...(binding.record.modelExplicit && binding.record.model ? { model: binding.record.model } : {}),
      ...(this.serviceTierCompatibilityOverride ? { serviceTier: 'fast' } : {}),
      threadId: binding.record.id,
    })
    if (!binding.lease.isCurrent()) return
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
    const startQueuedPrompts = async () => {
      while (binding.lease.isCurrent() && !binding.isStreaming) {
        const next = binding.queuedPrompts.shift()
        if (!next) return
        try {
          await this.startTurn(binding, next.prompt, next.attachments, next.options)
        } catch (error) {
          if (!binding.lease.isCurrent()) return
          this.options.emitEvent({
            type: 'error',
            message: `Codex queued prompt failed to start: ${error instanceof Error ? error.message : String(error)}`,
            sessionId: binding.record.id,
          })
        }
      }
    }
    return this.runtimeCoordinator.run(binding.lease.key, async () => {
      if (!binding.lease.isCurrent()) return
      await startQueuedPrompts()
    })
  }

  private async resumeThread(record: CodexThreadRecord, lease?: SessionRuntimeLease) {
    const checkpoint = this.sessionStore.beginHydration(record.id)
    let response
    let native
    try {
      response = await (await this.ensureClient()).request('thread/resume', {
        approvalPolicy: 'on-request',
        ...(this.serviceTierCompatibilityOverride ? { config: { service_tier: 'fast' }, serviceTier: 'fast' } : {}),
        cwd: record.cwd,
        ...(record.modelExplicit && record.model ? { model: record.model } : {}),
        sandbox: 'workspace-write',
        threadId: record.id,
      })
      if (lease && !lease.isCurrent()) {
        this.sessionStore.cancelHydration(checkpoint)
        throw new Error('Codex thread binding was superseded during resume.')
      }
      native = this.sessionStore.hydrate(response.thread, checkpoint)
    } catch (error) {
      this.sessionStore.cancelHydration(checkpoint)
      throw error
    }
    if (!record.modelExplicit) record.model = response.model || record.model
    record.reasoningEffort = reasoningEffort(response.reasoningEffort)
    record.name = response.thread.name ?? record.name
    record.preview = response.thread.preview || record.preview || null
    return { isStreaming: native.status.type === 'busy', record }
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

  private async buildWorkspaceState(
    cwd: string,
    activeThreadId: string | null,
    providedBinding?: CodexBinding,
    isRequestCurrent: () => boolean = () => true,
  ): Promise<AgentWorkspaceState> {
    const records = await this.listRecords(cwd)
    if (!isRequestCurrent()) throw new Error('Codex workspace state request was superseded.')
    if (activeThreadId && !providedBinding) {
      return this.withBinding(cwd, activeThreadId, (binding) => (
        this.buildWorkspaceState(cwd, activeThreadId, binding, isRequestCurrent)
      ))
    }
    const binding = activeThreadId && providedBinding
      ? this.requireBindingWorkspace(providedBinding, cwd)
      : null
    if (binding && binding.record.id !== activeThreadId) {
      throw new Error('Codex workspace state binding does not match the active thread.')
    }
    const native = binding ? this.sessionStore.get(binding.record.id) : null
    const activeSession = binding
      ? native
        ? this.createSessionSnapshot(binding.record, native)
        : await this.readBoundSession(binding)
      : null
    if (!isRequestCurrent()) throw new Error('Codex workspace state request was superseded.')
    return {
      activeSession,
      runtime: this.serializeRuntime(cwd, binding),
      sessions: records.map((record) => this.createSessionListItem(record)),
    }
  }

  private async broadcastWorkspaceState(
    cwd: string,
    requestedActiveThreadId: string | null,
    context: WorkspaceStateContext = {},
  ) {
    const identity = workspaceIdentity(cwd)
    if (!this.isWorkspaceStateContextCurrent(context)) {
      if (context.state) return context.state
      throw new Error('Codex workspace state request was superseded.')
    }
    const activeThreadId = context.sourceLease
      ? this.workspaceActiveThreads.get(identity) ?? requestedActiveThreadId
      : requestedActiveThreadId
    const revision = (this.workspaceStateRevisions.get(identity) ?? 0) + 1
    this.workspaceStateRevisions.set(identity, revision)
    const state = context.state ?? await this.buildWorkspaceState(
      cwd,
      activeThreadId,
      context.providedBinding,
      () => this.isWorkspaceStateContextCurrent(context),
    )
    if (
      this.workspaceStateRevisions.get(identity) === revision
      && this.isWorkspaceStateContextCurrent(context)
    ) {
      this.options.emitEvent({ type: 'workspace_state', state })
    }
    return state
  }

  private emitSessionSnapshot(threadId: string, expectedLease?: SessionRuntimeLease) {
    this.clearScheduledSnapshot(threadId)
    if (expectedLease && !expectedLease.isCurrent()) return
    const binding = this.bindings.get(threadId)
    const native = this.sessionStore.get(threadId)
    if (!binding || !native || (expectedLease && binding.lease !== expectedLease)) return
    this.options.emitEvent({
      type: 'session_snapshot_updated',
      executionState: native.status,
      session: this.createSessionSnapshot(binding.record, native),
      sessionId: threadId,
    })
  }

  private scheduleSessionSnapshot(threadId: string, expectedLease?: SessionRuntimeLease) {
    if (this.snapshotTimers.has(threadId)) return
    this.snapshotTimers.set(threadId, setTimeout(() => {
      this.snapshotTimers.delete(threadId)
      this.emitSessionSnapshot(threadId, expectedLease)
    }, SNAPSHOT_COALESCE_MS))
  }

  private clearScheduledSnapshot(threadId: string) {
    const timer = this.snapshotTimers.get(threadId)
    if (!timer) return
    clearTimeout(timer)
    this.snapshotTimers.delete(threadId)
  }

  private beginWorkspaceActivation(cwd: string, targetThreadId?: string | null): WorkspaceActivation {
    const identity = workspaceIdentity(cwd)
    const current = this.workspaceActivations.get(identity)
    const reuseCurrent = targetThreadId !== undefined
      && current !== undefined
      && current.targetThreadId === targetThreadId
    const revision = reuseCurrent ? current.revision : (current?.revision ?? 0) + 1
    if (!reuseCurrent) this.workspaceActivations.set(identity, { revision, targetThreadId })
    return {
      identity,
      revision,
    }
  }

  private setWorkspaceActivationTarget(activation: WorkspaceActivation, threadId: string | null) {
    if (!this.isWorkspaceActivationCurrent(activation)) return false
    this.workspaceActivations.set(activation.identity, {
      revision: activation.revision,
      targetThreadId: threadId,
    })
    return true
  }

  private commitWorkspaceActivation(activation: WorkspaceActivation, threadId: string | null) {
    if (!this.isWorkspaceActivationCurrent(activation)) return false
    if (threadId) this.workspaceActiveThreads.set(activation.identity, threadId)
    else this.workspaceActiveThreads.delete(activation.identity)
    return true
  }

  private isWorkspaceActivationCurrent(activation: WorkspaceActivation) {
    return this.workspaceActivations.get(activation.identity)?.revision === activation.revision
  }

  private invalidateWorkspaceActivation(identity: string) {
    this.workspaceActivations.set(identity, {
      revision: (this.workspaceActivations.get(identity)?.revision ?? 0) + 1,
    })
  }

  private invalidateWorkspaceActivationForThread(identity: string, threadId: string) {
    const activation = this.workspaceActivations.get(identity)
    if (
      activation?.targetThreadId !== threadId
      && this.workspaceActiveThreads.get(identity) !== threadId
    ) return
    this.invalidateWorkspaceActivation(identity)
  }

  private captureWorkspaceOperation(cwd: string): WorkspaceOperation {
    const identity = workspaceIdentity(cwd)
    return {
      identity,
      revision: this.workspaceOperationRevisions.get(identity) ?? 0,
    }
  }

  private isWorkspaceOperationCurrent(operation: WorkspaceOperation) {
    return !this.disposed
      && !this.workspaceTeardownCounts.has(operation.identity)
      && (this.workspaceOperationRevisions.get(operation.identity) ?? 0) === operation.revision
  }

  private requireWorkspaceOperationCurrent(operation: WorkspaceOperation) {
    if (!this.isWorkspaceOperationCurrent(operation)) {
      throw new Error('Codex workspace operation was superseded.')
    }
  }

  private invalidateWorkspaceOperations(identity: string) {
    this.workspaceOperationRevisions.set(identity, (this.workspaceOperationRevisions.get(identity) ?? 0) + 1)
  }

  private invalidateWorkspaceState(identity: string) {
    this.workspaceStateRevisions.set(identity, (this.workspaceStateRevisions.get(identity) ?? 0) + 1)
  }

  private async withWorkspaceTeardown<TResult>(identity: string, operation: () => Promise<TResult>) {
    this.workspaceTeardownCounts.set(identity, (this.workspaceTeardownCounts.get(identity) ?? 0) + 1)
    try {
      return await operation()
    } finally {
      const remaining = (this.workspaceTeardownCounts.get(identity) ?? 1) - 1
      if (remaining > 0) this.workspaceTeardownCounts.set(identity, remaining)
      else this.workspaceTeardownCounts.delete(identity)
    }
  }

  private async withWorkspaceCreation<TResult>(identity: string, operation: () => Promise<TResult>) {
    this.workspaceCreationCounts.set(identity, (this.workspaceCreationCounts.get(identity) ?? 0) + 1)
    try {
      return await operation()
    } finally {
      const remaining = (this.workspaceCreationCounts.get(identity) ?? 1) - 1
      if (remaining > 0) {
        this.workspaceCreationCounts.set(identity, remaining)
      } else {
        this.workspaceCreationCounts.delete(identity)
        const waiters = this.workspaceCreationWaiters.get(identity)
        if (waiters) {
          for (const resolve of waiters) resolve()
          this.workspaceCreationWaiters.delete(identity)
        }
      }
    }
  }

  private waitForWorkspaceCreations(identity: string) {
    if (!this.workspaceCreationCounts.has(identity)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const waiters = this.workspaceCreationWaiters.get(identity) ?? new Set<() => void>()
      waiters.add(resolve)
      this.workspaceCreationWaiters.set(identity, waiters)
    })
  }

  private async waitForRecordReplacements(identity: string) {
    const replacements = [...this.recordReplacements.values()]
      .filter((replacement) => replacement.workspaceIdentity === identity)
    await Promise.all(replacements.map((replacement) => replacement.promise.catch(() => undefined)))
  }

  private isWorkspaceStateContextCurrent(context: WorkspaceStateContext) {
    return (!context.sourceLease || context.sourceLease.isCurrent())
      && (!context.activation || this.isWorkspaceActivationCurrent(context.activation))
      && (!context.workspaceOperation || this.isWorkspaceOperationCurrent(context.workspaceOperation))
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

  private requireReplacementWorkspace(replacement: CodexRecordReplacement, cwd: string) {
    if (replacement.workspaceIdentity !== workspaceIdentity(cwd)) {
      throw new Error('Codex thread not found for this workspace.')
    }
    return replacement.promise
  }

  private async ensureOpenableRecord(
    cwd: string,
    threadId: string,
    workspaceOperation?: WorkspaceOperation,
  ) {
    const identity = workspaceIdentity(cwd)
    const existingReplacement = this.recordReplacements.get(threadId)
    if (existingReplacement) return this.requireReplacementWorkspace(existingReplacement, cwd)
    const record = await this.requireRecord(cwd, threadId)
    if (workspaceOperation) this.requireWorkspaceOperationCurrent(workspaceOperation)
    if (record.materialized || this.bindings.has(threadId)) return record
    const pending = this.recordReplacements.get(threadId)
    if (pending) return this.requireReplacementWorkspace(pending, cwd)
    const start = (async () => {
      const client = await this.ensureClient()
      const result = await this.startNativeThread(client, cwd, record.modelExplicit ? record.model : null)
      const replacement: CodexThreadRecord = {
        ...record,
        id: result.thread.id,
        model: result.model || record.model,
        updatedAt: new Date().toISOString(),
      }
      let replacementIndexed = false
      try {
        await this.index.update((state) => ({
          ...state,
          threads: state.threads.map((candidate) => candidate.id === threadId ? replacement : candidate),
        }))
        replacementIndexed = true
        if (workspaceOperation) this.requireWorkspaceOperationCurrent(workspaceOperation)
        await this.runtimeCoordinator.retire(runtimeKey(cwd, threadId))
        this.dropThreadRuntime(threadId)
        if (workspaceOperation) this.requireWorkspaceOperationCurrent(workspaceOperation)
        this.sessionStore.install(result.thread)
        await this.installBinding(replacement, result.thread.status.type === 'active', client)
        if (workspaceOperation) this.requireWorkspaceOperationCurrent(workspaceOperation)
        if (this.workspaceActiveThreads.get(identity) === threadId) {
          this.workspaceActiveThreads.set(identity, replacement.id)
        }
        return replacement
      } catch (error) {
        const released = await this.cleanupUncommittedThread(
          client,
          replacement.cwd,
          replacement.id,
          'failed replacement',
        )
        if (replacementIndexed && released) {
          await this.index.update((state) => ({
            ...state,
            threads: state.threads.map((candidate) => candidate.id === replacement.id ? record : candidate),
          })).catch((cleanupError) => {
            console.warn(`[codex app-server] Failed to restore a rolled-back draft in the ownership index: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
          })
        } else if (!replacementIndexed && !released) {
          await this.index.update((state) => ({
            ...state,
            threads: state.threads.map((candidate) => candidate.id === threadId ? replacement : candidate),
          })).catch((cleanupError) => {
            console.warn(`[codex app-server] Failed to retain ownership of a replacement whose rollback cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
          })
        }
        throw error
      }
    })().finally(() => {
      if (this.recordReplacements.get(threadId)?.promise === start) {
        this.recordReplacements.delete(threadId)
      }
    })
    this.recordReplacements.set(threadId, { promise: start, workspaceIdentity: identity })
    return start
  }

  private async withBinding<TResult>(
    cwd: string,
    threadId: string,
    operation: (binding: CodexBinding) => Promise<TResult> | TResult,
    workspaceOperation: WorkspaceOperation = this.captureWorkspaceOperation(cwd),
  ) {
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const existing = this.bindings.get(threadId)
    if (existing) this.requireBindingWorkspace(existing, cwd)
    return this.runtimeCoordinator.use(
      runtimeKey(cwd, threadId),
      (lease) => {
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        return this.startBinding(cwd, threadId, lease)
      },
      ({ runtime }) => {
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        return operation(this.requireBindingWorkspace(runtime, cwd))
      },
    )
  }

  private async startBinding(cwd: string, threadId: string, lease: SessionRuntimeLease) {
    this.bindingLeases.set(threadId, lease)
    try {
      const record = await this.requireRecord(cwd, threadId)
      const resumed = await this.resumeThread(record, lease)
      const binding: CodexBinding = {
        activeTurnId: null,
        isStreaming: resumed.isStreaming,
        lease,
        queuedPrompts: [],
        record: resumed.record,
      }
      this.bindings.set(threadId, binding)
      return binding
    } catch (error) {
      if (this.bindingLeases.get(threadId) === lease) this.bindingLeases.delete(threadId)
      if (!lease.isCurrent()) {
        this.clearScheduledSnapshot(threadId)
        this.sessionStore.delete(threadId)
        this.clearPendingInteractions((pending) => pending.sessionId === threadId && pending.lease === lease)
      }
      throw error
    }
  }

  private async installBinding(
    record: CodexThreadRecord,
    isStreaming: boolean,
    sourceClient?: CodexRpcClient,
  ) {
    const handle = await this.runtimeCoordinator.ensure(runtimeKey(record.cwd, record.id), async (lease) => {
      if (sourceClient && this.client !== sourceClient) {
        throw new Error('Codex App Server connection was superseded before the thread could be bound.')
      }
      const existing = this.bindings.get(record.id)
      const binding: CodexBinding = existing ?? {
        activeTurnId: null,
        isStreaming,
        lease,
        queuedPrompts: [],
        record,
      }
      binding.lease = lease
      binding.record = record
      this.bindingLeases.set(record.id, lease)
      this.bindings.set(record.id, binding)
      return binding
    })
    return handle.runtime
  }

  private requireBindingWorkspace(binding: CodexBinding, cwd: string) {
    if (workspaceIdentity(binding.record.cwd) !== workspaceIdentity(cwd)) {
      throw new Error('Codex thread not found for this workspace.')
    }
    return binding
  }

  private async cleanupUncommittedThread(
    client: CodexRpcClient,
    cwd: string,
    threadId: string,
    context: string,
  ) {
    await this.runtimeCoordinator.retire(runtimeKey(cwd, threadId)).catch(() => undefined)
    this.dropThreadRuntime(threadId)
    if (this.client !== client) return true
    try {
      await this.unsubscribeThread(client, threadId)
      return true
    } catch (error) {
      console.warn(`[codex app-server] Failed to unsubscribe a thread after ${context}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  private async releaseNativeBinding(client: CodexRpcClient, binding: CodexBinding) {
    const failures: unknown[] = []
    if (binding.activeTurnId) {
      await client.request('turn/interrupt', {
        threadId: binding.record.id,
        turnId: binding.activeTurnId,
      }).catch((error) => failures.push(error))
    }
    await this.unsubscribeThread(client, binding.record.id).catch((error) => failures.push(error))
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1) {
      throw new AggregateError(failures, `Codex thread ${binding.record.id} could not be released.`)
    }
  }

  private async unsubscribeThread(client: CodexRpcClient, threadId: string) {
    await client.request('thread/unsubscribe', { threadId }).catch((error) => {
      if (!isMissingNativeThreadError(error)) throw error
    })
  }

  private async deleteNativeThread(
    client: CodexRpcClient,
    threadId: string,
    binding: CodexBinding | null,
  ) {
    if (binding?.activeTurnId) {
      await client.request('turn/interrupt', { threadId, turnId: binding.activeTurnId })
    }
    await client.request('thread/delete', { threadId }).catch((error) => {
      if (!isMissingNativeThreadError(error)) throw error
    })
  }

  private async setThreadName(client: CodexRpcClient, record: CodexThreadRecord) {
    if (!record.name) return
    await client.request('thread/name/set', { name: record.name, threadId: record.id })
  }

  private async archiveThread(client: CodexRpcClient, threadId: string) {
    await client.request('thread/archive', { threadId }).catch((error) => {
      if (!isMissingNativeThreadError(error)) throw error
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

  private dropThreadRuntime(threadId: string, expectedBinding?: CodexBinding) {
    const binding = this.bindings.get(threadId)
    if (expectedBinding && binding !== expectedBinding) return
    this.clearScheduledSnapshot(threadId)
    this.bindings.delete(threadId)
    if (!expectedBinding || this.bindingLeases.get(threadId) === expectedBinding.lease) {
      this.bindingLeases.delete(threadId)
    }
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

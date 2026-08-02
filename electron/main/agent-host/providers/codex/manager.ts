import type { ServerNotification } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/ServerNotification'
import type { ServerRequest } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/ServerRequest'
import type { UserInput } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/UserInput'
import { getAgentInteractionKey } from '../../../../shared/agent-contracts/types'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentThinkingLevel,
  AgentWorkspaceState,
} from '../../../../shared/agent-contracts/types'
import { CodexRpcClient } from './rpc-client'
import { CodexSessionStore } from './session-store'
import {
  SessionRuntimeCoordinator,
  type SessionRuntimeLease,
} from '../../runtime/session-runtime-coordinator'
import {
  WorkspaceIntentCoordinator,
  type WorkspaceActivation,
  type WorkspaceOperation,
} from '../../runtime/workspace-intent-coordinator'
import {
  createSessionRuntimeKey as runtimeKey,
  createWorkspaceIdentity as workspaceIdentity,
  createWorkspaceRuntimeKeyPrefix as workspaceRuntimeKeyPrefix,
} from '../../runtime/runtime-keys'
import {
  buildCodexApprovalResult,
  buildCodexPermissionApprovalResult,
  buildCodexUserInputs,
} from './interaction-codec'
import {
  getCodexNotificationThreadId as notificationThreadId,
  isCodexThreadDeleteSchemaCompatibilityError,
  isMissingNativeCodexThreadError as isMissingNativeThreadError,
  isTransientCodexThreadReadError as isTransientThreadReadError,
} from './protocol-compatibility'
import {
  CODEX_THINKING_LEVELS as THINKING_LEVELS,
  getCodexModelThinkingLevels as codexModelThinkingLevels,
  normalizeCodexReasoningEffort as reasoningEffort,
  toCodexReasoningEffort as codexReasoningEffort,
  type CodexThreadRecord,
} from './session-model'
import {
  handleCodexServerRequest,
  type PendingCodexInteraction,
} from './server-request-handler'
import { CodexSessionCatalog } from './session-catalog'
import {
  createCodexSessionListItem,
  createCodexSessionSnapshot,
  getDefaultCodexModel,
  requireCodexModel,
  serializeCodexRuntime,
} from './presentation'
import type { CodexBinding, QueuedCodexPrompt } from './runtime'
import { CodexClientSupervisor } from './client-supervisor'

type JsonRecord = Record<string, unknown>

export {
  buildCodexApprovalResult,
  buildCodexPermissionApprovalResult,
  buildCodexUserInputs,
}
export type { CodexThreadRecord }

type CodexAgentManagerOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEventPayload) => void
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

const SNAPSHOT_COALESCE_MS = 16

export class CodexAgentManager {
  private readonly bindingLeases = new Map<string, SessionRuntimeLease>()
  private readonly bindings = new Map<string, CodexBinding>()
  private readonly clientSupervisor: CodexClientSupervisor
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private readonly pendingInteractions = new Map<string, PendingCodexInteraction>()
  private readonly recordReplacements = new Map<string, CodexRecordReplacement>()
  private readonly runtimeCoordinator: SessionRuntimeCoordinator<CodexBinding>
  private readonly sessionCatalog: CodexSessionCatalog
  private readonly snapshotTimers = new Map<string, NodeJS.Timeout>()
  private readonly sessionStore = new CodexSessionStore()
  private readonly unscopedNotificationTails = new WeakMap<CodexRpcClient, Promise<void>>()
  // Activation revisions preserve the latest foreground selection. Operation
  // revisions are invalidated by release/discard; state revisions suppress an
  // older asynchronous snapshot that completes after a newer one.
  private readonly workspaceIntent = new WorkspaceIntentCoordinator({
    canOperate: (identity) => !this.disposed && !this.workspaceTeardownCounts.has(identity),
    reuseActivationForSameTarget: true,
  })
  // thread/start has no coordinator key until Codex returns an id. Teardown
  // waits on these counters so a late creation cannot outlive the workspace.
  private readonly workspaceCreationCounts = new Map<string, number>()
  private readonly workspaceCreationWaiters = new Map<string, Set<() => void>>()
  private readonly workspaceStateRevisions = new Map<string, number>()
  private readonly workspaceTeardownCounts = new Map<string, number>()

  constructor(private readonly options: CodexAgentManagerOptions) {
    this.clientSupervisor = new CodexClientSupervisor({
      onExit: (client, error) => this.handleConnectionExit(client, error),
      onNotification: (client, notification) => this.routeNotification(client, notification),
      onRequest: (client, request) => {
        const threadId = 'threadId' in request.params
          ? request.params.threadId
          : 'conversationId' in request.params
            ? String(request.params.conversationId)
            : null
        this.handleServerRequest(
          request,
          client,
          threadId ? this.bindingLeases.get(threadId) : undefined,
        )
      },
    })
    this.sessionCatalog = new CodexSessionCatalog(options.agentDir)
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
      : [preferredSessionPath, this.workspaceIntent.active(activation.identity), records[0]?.id]
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
    return (await this.listRecords(cwd)).map((record) => (
      createCodexSessionListItem(record, this.sessionStore.get(record.id))
    ))
  }

  async readSession(cwd: string, threadId: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const record = await this.requireRecord(cwd, threadId)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    if (!record.materialized) {
      const snapshot = this.sessionStore.get(threadId)
      if (!snapshot) throw new Error('Codex thread is not materialized and has no in-memory state.')
      return createCodexSessionSnapshot(record, snapshot)
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
      return createCodexSessionSnapshot(record, native)
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
        return createCodexSessionSnapshot(record, current)
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
      await this.sessionCatalog.add(record)
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
      this.workspaceIntent.replaceActive(identity, record.id, null)
      const released = await this.cleanupUncommittedThread(client, record.cwd, record.id, 'failed creation')
      if (indexed && released) {
        await this.removeRecord(record.id).catch((cleanupError) => {
          console.warn(`[codex app-server] Failed to remove a rolled-back thread from the ownership index: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
        })
      } else if (!indexed && !released) {
        await this.sessionCatalog.ensure(record).catch((cleanupError) => {
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
        const activeId = this.workspaceIntent.active(identity)
        const deletedActiveThread = activeId === threadId || activeId === originalThreadId
        if (deletedActiveThread) this.workspaceIntent.setActive(identity, null)
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
      this.workspaceIntent.active(workspaceIdentity(cwd)),
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
      response,
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
      this.workspaceIntent.setActive(identity, null)
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
      const records = await this.sessionCatalog.listIndexed(cwd)
      if (records.length === 0) return
      const client = records.some((record) => record.materialized) || this.client
        ? await this.ensureClient()
        : null
      const nativeThreadIds = client
        ? new Set((await this.sessionCatalog.listNative(client, cwd)).map((thread) => thread.id))
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
        await this.sessionCatalog.removeMany(archived)
      }
      const activeThreadId = this.workspaceIntent.active(identity)
      if (activeThreadId && archived.has(activeThreadId)) {
        this.workspaceIntent.setActive(identity, null)
      }
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length === 1) throw failures[0]
      if (failures.length > 1) {
        throw new AggregateError(failures, 'One or more Codex sessions could not be discarded.')
      }
    })
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    for (const timer of this.snapshotTimers.values()) clearTimeout(timer)
    this.snapshotTimers.clear()
    this.clientSupervisor.dispose()
    this.bindingLeases.clear()
    this.bindings.clear()
    this.pendingInteractions.clear()
    this.recordReplacements.clear()
    this.sessionStore.clear()
    this.workspaceIntent.clear()
    this.workspaceCreationCounts.clear()
    for (const waiters of this.workspaceCreationWaiters.values()) {
      for (const resolve of waiters) resolve()
    }
    this.workspaceCreationWaiters.clear()
    this.workspaceStateRevisions.clear()
    this.workspaceTeardownCounts.clear()
    this.disposePromise = this.runtimeCoordinator.dispose()
    return this.disposePromise
  }

  drainSessionEvents(cwd: string, threadId: string) {
    return this.runtimeCoordinator.drain(runtimeKey(cwd, threadId))
  }

  private async ensureClient() {
    if (this.disposed) throw new Error('Codex manager has been disposed.')
    return this.clientSupervisor.ensureClient()
  }

  private get client() {
    return this.clientSupervisor.currentClient
  }

  private get models() {
    return this.clientSupervisor.models
  }

  private get serviceTierCompatibilityOverride() {
    return this.clientSupervisor.serviceTierCompatibilityOverride
  }

  private routeNotification(client: CodexRpcClient, notification: ServerNotification) {
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
      return
    }
    const tail = this.unscopedNotificationTails.get(client) ?? Promise.resolve()
    const next = tail.then(handle).catch((error) => {
      reportError(error instanceof Error ? error : new Error(String(error)))
    })
    this.unscopedNotificationTails.set(client, next)
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
    handleCodexServerRequest({
      currentClient: this.client,
      disposed: this.disposed,
      emitEvent: this.options.emitEvent,
      findLease: (threadId) => this.bindingLeases.get(threadId),
      findWorkspace: (threadId) => this.bindings.get(threadId)?.record.cwd ?? '',
      pendingInteractions: this.pendingInteractions,
      request,
      sourceClient,
      sourceLease,
    })
  }

  private handleConnectionExit(client: CodexRpcClient, error: Error) {
    if (this.disposed) return
    const bindings = [...this.bindings.values()]
    for (const binding of bindings) {
      this.clearScheduledSnapshot(binding.record.id)
      const native = this.sessionStore.markDisconnected(binding.record.id, error.message)
      if (native) {
        this.options.emitEvent({
          type: 'session_snapshot_updated',
          executionState: native.status,
          session: createCodexSessionSnapshot(binding.record, native),
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
    return getDefaultCodexModel(this.models)
  }

  private requireModel(modelKey: string) {
    return requireCodexModel(this.models, modelKey)
  }

  private serializeRuntime(cwd: string | null, binding: CodexBinding | null): AgentWorkspaceState['runtime'] {
    return serializeCodexRuntime(cwd, binding, this.models, (threadId) => this.sessionStore.get(threadId))
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
        ? createCodexSessionSnapshot(binding.record, native)
        : await this.readBoundSession(binding)
      : null
    if (!isRequestCurrent()) throw new Error('Codex workspace state request was superseded.')
    return {
      activeSession,
      runtime: this.serializeRuntime(cwd, binding),
      sessions: records.map((record) => createCodexSessionListItem(record, this.sessionStore.get(record.id))),
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
      ? this.workspaceIntent.active(identity) ?? requestedActiveThreadId
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
      session: createCodexSessionSnapshot(binding.record, native),
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
    return this.workspaceIntent.beginActivation(workspaceIdentity(cwd), targetThreadId)
  }

  private setWorkspaceActivationTarget(activation: WorkspaceActivation, threadId: string | null) {
    return this.workspaceIntent.setActivationTarget(activation, threadId)
  }

  private commitWorkspaceActivation(activation: WorkspaceActivation, threadId: string | null) {
    return this.workspaceIntent.commitActivation(activation, threadId)
  }

  private isWorkspaceActivationCurrent(activation: WorkspaceActivation) {
    return this.workspaceIntent.isActivationCurrent(activation)
  }

  private invalidateWorkspaceActivation(identity: string) {
    this.workspaceIntent.invalidateActivation(identity)
  }

  private invalidateWorkspaceActivationForThread(identity: string, threadId: string) {
    this.workspaceIntent.invalidateActivationForTarget(identity, threadId)
  }

  private captureWorkspaceOperation(cwd: string): WorkspaceOperation {
    return this.workspaceIntent.captureOperation(workspaceIdentity(cwd))
  }

  private isWorkspaceOperationCurrent(operation: WorkspaceOperation) {
    return this.workspaceIntent.isOperationCurrent(operation)
  }

  private requireWorkspaceOperationCurrent(operation: WorkspaceOperation) {
    this.workspaceIntent.requireOperationCurrent(
      operation,
      'Codex workspace operation was superseded.',
    )
  }

  private invalidateWorkspaceOperations(identity: string) {
    this.workspaceIntent.invalidateOperations(identity)
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
    const client = await this.ensureClient()
    return this.sessionCatalog.list(client, cwd, {
      retainIndexedRecord: (record) => (
        this.bindings.has(record.id) || Boolean(this.sessionStore.get(record.id))
      ),
    })
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
        await this.sessionCatalog.replace(threadId, replacement)
        replacementIndexed = true
        if (workspaceOperation) this.requireWorkspaceOperationCurrent(workspaceOperation)
        await this.runtimeCoordinator.retire(runtimeKey(cwd, threadId))
        this.dropThreadRuntime(threadId)
        if (workspaceOperation) this.requireWorkspaceOperationCurrent(workspaceOperation)
        this.sessionStore.install(result.thread)
        await this.installBinding(replacement, result.thread.status.type === 'active', client)
        if (workspaceOperation) this.requireWorkspaceOperationCurrent(workspaceOperation)
        this.workspaceIntent.replaceActive(identity, threadId, replacement.id)
        return replacement
      } catch (error) {
        const released = await this.cleanupUncommittedThread(
          client,
          replacement.cwd,
          replacement.id,
          'failed replacement',
        )
        if (replacementIndexed && released) {
          await this.sessionCatalog.replace(replacement.id, record).catch((cleanupError) => {
            console.warn(`[codex app-server] Failed to restore a rolled-back draft in the ownership index: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`)
          })
        } else if (!replacementIndexed && !released) {
          await this.sessionCatalog.replace(threadId, replacement).catch((cleanupError) => {
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
    try {
      await client.request('thread/delete', { threadId })
    } catch (error) {
      if (isMissingNativeThreadError(error)) return
      // Codex 0.144.x can create and resume threads in a fresh CODEX_HOME
      // before its optional jobs schema exists. thread/delete then fails while
      // thread/archive remains available, so keep Aryn deletion functional by
      // using the official archive operation for this narrowly scoped server
      // compatibility failure.
      if (!isCodexThreadDeleteSchemaCompatibilityError(error)) throw error
      try {
        await this.archiveThread(client, threadId)
      } catch (archiveError) {
        throw new AggregateError(
          [error, archiveError],
          `Codex thread ${threadId} could not be deleted or archived.`,
        )
      }
    }
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
    await this.sessionCatalog.update(record)
  }

  private async touchRecord(record: CodexThreadRecord) {
    await this.updateRecord(record)
  }

  private async removeRecord(threadId: string) {
    await this.sessionCatalog.remove(threadId)
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

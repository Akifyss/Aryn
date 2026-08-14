import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentWorkspaceState,
} from '../../../../shared/agent-contracts/types'
import { prepareExternalCliEnvironment } from '../../../external-cli-environment'
import { JsonLineProcess } from '../../../json-line-process'
import {
  SessionRuntimeCoordinator,
  type SessionRuntimeLease,
} from '../../runtime/session-runtime-coordinator'
import { PiSessionFileReader } from '../../sessions/pi-session-file-reader'
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
  normalizePiThinkingLevel as normalizeThinkingLevel,
  projectPiFileAnnotations,
  readPiResponseData as readResponseData,
  type PiCliSessionRecord,
  type PiRpcModel,
} from './session-model'
import { PiCliSessionCatalog } from './session-catalog'
import { handlePiCliEvent } from './event-handler'
import { PiCliInteractionRegistry } from './interaction-registry'
import {
  createPiCliSessionListItem,
  serializePiCliRuntime,
  serializePiCliSession,
  serializePiCliSessionFile,
} from './presentation'
import type { PiCliRuntime } from './runtime'

export { projectPiFileAnnotations }

type PiCliAgentManagerOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEventPayload) => void
  removeSessionFile?: (sessionPath: string) => Promise<void>
}

type WorkspaceStateContext = {
  activation?: WorkspaceActivation
  providedRuntime?: PiCliRuntime
  sourceLease?: SessionRuntimeLease
  state?: AgentWorkspaceState
  workspaceOperation?: WorkspaceOperation
}

export class PiCliAgentManager {
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private readonly initializingProcesses = new Set<JsonLineProcess>()
  private readonly interactionRegistry: PiCliInteractionRegistry
  private readonly sessionFileReader = new PiSessionFileReader()
  private readonly runtimeCoordinator: SessionRuntimeCoordinator<PiCliRuntime>
  private readonly sessionCatalog: PiCliSessionCatalog
  // Activation revisions preserve last-user-intent ordering. Operation revisions
  // are invalidated only by workspace release/discard, while state revisions
  // suppress older asynchronous snapshots that finish after newer ones.
  private readonly workspaceIntent = new WorkspaceIntentCoordinator({
    canOperate: () => !this.disposed,
    reuseActivationForSameTarget: true,
  })
  private readonly workspaceStateRevisions = new Map<string, number>()

  constructor(private readonly options: PiCliAgentManagerOptions) {
    this.interactionRegistry = new PiCliInteractionRegistry(options.emitEvent)
    this.runtimeCoordinator = new SessionRuntimeCoordinator({
      stopRuntime: (runtime) => runtime.process.stop(),
    })
    this.sessionCatalog = new PiCliSessionCatalog({
      agentDir: options.agentDir,
      isRuntimeLive: (record) => Boolean(
        this.runtimeCoordinator.current(runtimeKey(record.cwd, record.id)),
      ),
    })
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    const runtime = await this.createEphemeralRuntime(process.cwd())
    try {
      return { activeSession: null, runtime: serializePiCliRuntime(null, runtime), sessions: [] }
    } finally {
      await this.runtimeCoordinator.retireLease(runtime.lease)
    }
  }

  async loadWorkspaceState(cwd: string, preferredSessionPath: string | null, options: { restoreSession?: boolean } = {}) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const activation = this.beginWorkspaceActivation(cwd)
    const records = await this.sessionCatalog.list(cwd)
    if (!this.isWorkspaceOperationCurrent(workspaceOperation)) {
      throw new Error('PI CLI workspace operation was superseded.')
    }
    const activeID = options.restoreSession === false
      ? null
      : [preferredSessionPath, this.workspaceIntent.active(activation.identity), records[0]?.id]
          .find((candidate): candidate is string => Boolean(candidate && records.some((record) => record.id === candidate)))
        ?? null
    if (!this.setWorkspaceActivationTarget(activation, activeID)) {
      throw new Error('PI CLI workspace activation was superseded.')
    }
    if (!activeID) {
      const state = await this.buildWorkspaceState(
        cwd,
        null,
        undefined,
        () => (
          this.isWorkspaceOperationCurrent(workspaceOperation)
          && this.isWorkspaceActivationCurrent(activation)
        ),
      )
      if (!this.commitWorkspaceActivation(activation, null)) {
        throw new Error('PI CLI workspace activation was superseded.')
      }
      return state
    }
    return this.withRuntime(cwd, activeID, async (runtime) => {
      const state = await this.buildWorkspaceState(
        cwd,
        activeID,
        runtime,
        () => (
          this.isWorkspaceOperationCurrent(workspaceOperation)
          && this.isWorkspaceActivationCurrent(activation)
        ),
      )
      if (!this.commitWorkspaceActivation(activation, activeID)) {
        throw new Error('PI CLI workspace activation was superseded.')
      }
      return state
    })
  }

  async listSessionItems(cwd: string) {
    return (await this.sessionCatalog.list(cwd)).map((record) => ({
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
    const current = this.runtimeCoordinator.current(runtimeKey(cwd, sessionID))
    if (!current) {
      const record = await this.sessionCatalog.require(cwd, sessionID)
      if (record.materialized && record.sessionPath) {
        const sessionFile = await this.sessionFileReader.read(record.sessionPath)
        if (
          sessionFile.sessionId !== record.id
          || workspaceIdentity(sessionFile.workspacePath) !== workspaceIdentity(cwd)
        ) {
          throw new Error('PI CLI session not found for this workspace.')
        }
        return serializePiCliSessionFile(record, sessionFile)
      }
    }
    return this.withRuntime(cwd, sessionID, serializePiCliSession)
  }

  async sessionExists(cwd: string, sessionID: string) {
    return (await this.sessionCatalog.list(cwd)).some((record) => record.id === sessionID)
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
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
    const activation = this.beginWorkspaceActivation(cwd, record.id)
    await this.sessionCatalog.insert(record)
    try {
      if (!this.isWorkspaceOperationCurrent(workspaceOperation)) {
        throw new Error('PI CLI workspace operation was superseded.')
      }
      const state = await this.withRuntime(cwd, record.id, async (runtime) => {
        if (record.name) await runtime.process.request({ type: 'set_session_name', name: record.name })
        if (record.modelKey) await this.setRuntimeModel(runtime, record.modelKey)
        await runtime.process.request({ type: 'set_thinking_level', level: record.thinkingLevel })
        this.commitWorkspaceActivation(activation, record.id)
        return this.buildWorkspaceState(cwd, record.id, runtime)
      }, { allowCreate: true })
      return await this.broadcastWorkspaceState(cwd, record.id, { activation, state, workspaceOperation })
    } catch (error) {
      this.rollbackWorkspaceActivation(activation, record.id)
      await this.runtimeCoordinator.retire(runtimeKey(cwd, record.id)).catch(() => undefined)
      await this.sessionCatalog.remove(cwd, record.id)
      throw error
    }
  }

  async openSession(cwd: string, sessionID: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const activation = this.beginWorkspaceActivation(cwd, sessionID)
    const state = await this.withRuntime(cwd, sessionID, (runtime) => {
      if (!this.commitWorkspaceActivation(activation, sessionID)) {
        throw new Error('PI CLI workspace activation was superseded.')
      }
      return this.buildWorkspaceState(cwd, sessionID, runtime)
    })
    return this.broadcastWorkspaceState(cwd, sessionID, { activation, state, workspaceOperation })
  }

  async deleteSession(cwd: string, sessionID: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.invalidateWorkspaceActivation(workspaceIdentity(cwd))
    const nextActiveSessionID = await this.runtimeCoordinator.retireAndRun(runtimeKey(cwd, sessionID), async (retired) => {
      const record = retired
        ? this.requireRuntimeWorkspace(retired.runtime, cwd).record
        : await this.sessionCatalog.require(cwd, sessionID)
      this.interactionRegistry.clear((pending) => pending.runtimeKey === runtimeKey(cwd, sessionID))
      if (record.sessionPath) {
        if (this.options.removeSessionFile) await this.options.removeSessionFile(record.sessionPath)
        else await rm(record.sessionPath, { force: true })
      }
      await this.sessionCatalog.remove(cwd, sessionID)
      const identity = workspaceIdentity(cwd)
      const activeSessionID = this.workspaceIntent.active(identity)
      if (activeSessionID === sessionID) this.workspaceIntent.setActive(identity, null)
      return activeSessionID === sessionID ? null : activeSessionID
    })
    return this.broadcastWorkspaceState(cwd, nextActiveSessionID, { workspaceOperation })
  }

  async renameSession(cwd: string, sessionID: string, name: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const nextName = name.trim()
    if (!nextName) throw new Error('PI CLI 会话名称不能为空。')
    const runtime = await this.withRuntime(cwd, sessionID, async (runtime) => {
      await this.sessionCatalog.require(cwd, sessionID)
      await runtime.process.request({ type: 'set_session_name', name: nextName })
      runtime.record.name = nextName
      await this.sessionCatalog.rename(cwd, sessionID, nextName)
      return runtime
    })
    return this.broadcastWorkspaceState(
      cwd,
      this.workspaceIntent.active(workspaceIdentity(cwd)),
      { providedRuntime: runtime, sourceLease: runtime.lease, workspaceOperation },
    )
  }

  async sendPrompt(cwd: string, sessionID: string, prompt: string, streamingBehavior?: AgentRunningPromptBehavior, attachments: AgentPromptAttachment[] = []) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const { result, runtime } = await this.withRuntime(cwd, sessionID, async (runtime) => {
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
        return { result: { ok: true }, runtime }
      } catch (error) {
        runtime.isStreaming = false
        throw error
      }
    })
    await this.broadcastWorkspaceState(cwd, sessionID, {
      providedRuntime: runtime,
      sourceLease: runtime.lease,
      workspaceOperation,
    }).catch(() => undefined)
    return result
  }

  async selectModel(cwd: string, sessionID: string, modelKey: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const runtime = await this.withRuntime(cwd, sessionID, async (runtime) => {
      await this.setRuntimeModel(runtime, modelKey)
      runtime.record.modelKey = modelKey
      await this.updateRecord(runtime.record)
      return runtime
    })
    return this.broadcastWorkspaceState(cwd, sessionID, {
      providedRuntime: runtime,
      sourceLease: runtime.lease,
      workspaceOperation,
    })
  }

  async selectThinkingLevel(cwd: string, sessionID: string, level: string, modelKey?: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const thinkingLevel = normalizeThinkingLevel(level)
    const runtime = await this.withRuntime(cwd, sessionID, async (runtime) => {
      if (modelKey) {
        await this.setRuntimeModel(runtime, modelKey)
        runtime.record.modelKey = modelKey
      }
      await runtime.process.request({ type: 'set_thinking_level', level: thinkingLevel })
      runtime.record.thinkingLevel = thinkingLevel
      await this.updateRecord(runtime.record)
      await this.refreshRuntime(runtime)
      return runtime
    })
    return this.broadcastWorkspaceState(cwd, sessionID, {
      providedRuntime: runtime,
      sourceLease: runtime.lease,
      workspaceOperation,
    })
  }

  async abortActivePrompt(cwd: string, sessionID: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const runtime = await this.withRuntime(cwd, sessionID, async (runtime) => {
      await runtime.process.request({ type: 'abort' })
      runtime.isStreaming = false
      await this.refreshRuntime(runtime)
      return runtime
    })
    return this.broadcastWorkspaceState(cwd, sessionID, {
      providedRuntime: runtime,
      sourceLease: runtime.lease,
      workspaceOperation,
    })
  }

  respondToInteraction(response: AgentInteractionResponse) {
    return this.interactionRegistry.respond(response)
  }

  async releaseWorkspaceRuntime(cwd: string) {
    const identity = workspaceIdentity(cwd)
    const prefix = workspaceRuntimeKeyPrefix(cwd)
    this.invalidateWorkspaceActivation(identity)
    this.invalidateWorkspaceOperations(identity)
    this.workspaceIntent.setActive(identity, null)
    this.invalidateWorkspaceState(identity)
    try {
      await this.runtimeCoordinator.retireWhere((key) => key.startsWith(prefix))
    } finally {
      this.interactionRegistry.clear((pending) => pending.runtimeKey.startsWith(prefix))
    }
  }

  async discardWorkspaceSessions(cwd: string) {
    // Draft cleanup is restricted to sessions created by Aryn. Sessions found
    // only in PI's official store remain untouched.
    const identity = workspaceIdentity(cwd)
    this.invalidateWorkspaceActivation(identity)
    this.invalidateWorkspaceOperations(identity)
    const records = await this.sessionCatalog.listOwned(cwd)
    const officialRecords = await this.sessionCatalog.list(cwd)
    const officialById = new Map(officialRecords.map((record) => [record.id, record]))
    await Promise.all(records.map((record) => this.runtimeCoordinator.retireAndRun(
      runtimeKey(cwd, record.id),
      async () => {
        this.interactionRegistry.clear((pending) => pending.runtimeKey === runtimeKey(cwd, record.id))
        const sessionPath = officialById.get(record.id)?.sessionPath
        if (sessionPath) await rm(sessionPath, { force: true })
      },
    )))
    await this.sessionCatalog.removeWorkspace(cwd)
    this.workspaceIntent.setActive(identity, null)
    this.invalidateWorkspaceState(identity)
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    for (const processHandle of this.initializingProcesses) processHandle.stop()
    this.initializingProcesses.clear()
    this.interactionRegistry.reset()
    this.sessionCatalog.dispose()
    this.workspaceIntent.clear()
    this.workspaceStateRevisions.clear()
    this.disposePromise = this.runtimeCoordinator.dispose()
    return this.disposePromise
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
    ]
    let runtime: PiCliRuntime
    const processHandle = new JsonLineProcess({
      args,
      command: 'pi',
      cwd: record.cwd,
      onEvent: (message) => {
        if (!runtime) return
        lease.enqueue(
          () => handlePiCliEvent(runtime, message, {
            emitEvent: this.options.emitEvent,
            interactions: this.interactionRegistry,
            onAgentEnd: (currentRuntime) => this.handleAgentEnd(currentRuntime),
            onRuntimeStateChanged: (currentRuntime) => this.broadcastRuntimeState(currentRuntime),
          }),
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

  private async refreshRuntime(runtime: PiCliRuntime) {
    const [stateResponse, modelsResponse] = await Promise.all([
      runtime.process.request({ type: 'get_state' }),
      runtime.process.request({ type: 'get_available_models' }, 30_000),
    ])
    runtime.state = readResponseData(stateResponse)
    const modelData = readResponseData(modelsResponse)
    runtime.models = Array.isArray(modelData.models) ? modelData.models as PiRpcModel[] : []
    runtime.isStreaming = runtime.state.isStreaming === true
  }

  private async handleAgentEnd(runtime: PiCliRuntime) {
    this.interactionRegistry.clear((pending) => pending.lease === runtime.lease)
    await this.refreshRuntime(runtime).catch(() => undefined)
    if (!runtime.lease.isCurrent()) return
    await this.touchRecord(runtime)
    if (!runtime.lease.isCurrent()) return
    await this.broadcastRuntimeState(runtime)
  }

  private broadcastRuntimeState(runtime: PiCliRuntime) {
    return this.broadcastWorkspaceState(runtime.record.cwd, runtime.record.id, {
      providedRuntime: runtime,
      sourceLease: runtime.lease,
    })
  }

  private handleRuntimeExit(runtime: PiCliRuntime, error: Error) {
    runtime.isStreaming = false
    void this.runtimeCoordinator.retireLease(runtime.lease).then((retired) => {
      if (!retired || this.disposed) return
      this.interactionRegistry.clear((pending) => pending.lease === runtime.lease)
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

  private async buildWorkspaceState(
    cwd: string,
    activeSessionID: string | null,
    providedRuntime?: PiCliRuntime,
    isRequestCurrent?: () => boolean,
  ): Promise<AgentWorkspaceState> {
    const records = await this.sessionCatalog.list(cwd)
    if (isRequestCurrent && !isRequestCurrent()) {
      throw new Error('PI CLI workspace state build was superseded.')
    }
    if (activeSessionID && providedRuntime?.record.id !== activeSessionID) {
      return this.withRuntime(
        cwd,
        activeSessionID,
        (runtime) => this.buildWorkspaceState(cwd, activeSessionID, runtime, isRequestCurrent),
      )
    }
    const activeRuntime = activeSessionID && providedRuntime
      ? this.requireRuntimeWorkspace(providedRuntime, cwd)
      : null
    const draftRuntime = activeRuntime ?? await this.createEphemeralRuntime(cwd)
    try {
      return {
        activeSession: activeRuntime ? await serializePiCliSession(activeRuntime) : null,
        runtime: serializePiCliRuntime(cwd, draftRuntime),
        sessions: records.map(createPiCliSessionListItem),
      }
    } finally {
      if (!activeRuntime) await this.runtimeCoordinator.retireLease(draftRuntime.lease)
    }
  }

  private async broadcastWorkspaceState(
    cwd: string,
    requestedActiveSessionID: string | null,
    context: WorkspaceStateContext = {},
  ) {
    const identity = workspaceIdentity(cwd)
    if (!this.isWorkspaceStateContextCurrent(context)) {
      if (context.state) return context.state
      throw new Error('PI CLI workspace state request was superseded.')
    }
    const activeSessionID = context.sourceLease
      ? this.workspaceIntent.active(identity)
      : requestedActiveSessionID
    const revision = (this.workspaceStateRevisions.get(identity) ?? 0) + 1
    this.workspaceStateRevisions.set(identity, revision)
    const state = context.state ?? await this.buildWorkspaceState(
      cwd,
      activeSessionID,
      context.providedRuntime,
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

  private invalidateWorkspaceState(identity: string) {
    this.workspaceStateRevisions.set(identity, (this.workspaceStateRevisions.get(identity) ?? 0) + 1)
  }

  private isWorkspaceStateContextCurrent(context: WorkspaceStateContext) {
    return (!context.sourceLease || context.sourceLease.isCurrent())
      && (!context.activation || this.isWorkspaceActivationCurrent(context.activation))
      && (!context.workspaceOperation || this.isWorkspaceOperationCurrent(context.workspaceOperation))
  }

  private beginWorkspaceActivation(cwd: string, targetSessionID?: string | null): WorkspaceActivation {
    const identity = workspaceIdentity(cwd)
    return this.workspaceIntent.beginActivation(identity, targetSessionID)
  }

  private commitWorkspaceActivation(activation: WorkspaceActivation, sessionID: string | null) {
    return this.workspaceIntent.commitActivation(activation, sessionID)
  }

  private setWorkspaceActivationTarget(activation: WorkspaceActivation, sessionID: string | null) {
    return this.workspaceIntent.setActivationTarget(activation, sessionID)
  }

  private rollbackWorkspaceActivation(activation: WorkspaceActivation, sessionID: string) {
    this.workspaceIntent.rollbackActivation(activation, sessionID)
  }

  private isWorkspaceActivationCurrent(activation: WorkspaceActivation) {
    return this.workspaceIntent.isActivationCurrent(activation)
  }

  private invalidateWorkspaceActivation(identity: string) {
    this.workspaceIntent.invalidateActivation(identity)
  }

  private captureWorkspaceOperation(cwd: string): WorkspaceOperation {
    return this.workspaceIntent.captureOperation(workspaceIdentity(cwd))
  }

  private isWorkspaceOperationCurrent(operation: WorkspaceOperation) {
    return this.workspaceIntent.isOperationCurrent(operation)
  }

  private invalidateWorkspaceOperations(identity: string) {
    this.workspaceIntent.invalidateOperations(identity)
  }

  private withRuntime<TResult>(
    cwd: string,
    sessionID: string,
    operation: (runtime: PiCliRuntime) => Promise<TResult> | TResult,
    options: { allowCreate?: boolean } = {},
  ) {
    return this.runtimeCoordinator.use(
      runtimeKey(cwd, sessionID),
      async (lease) => {
        const record = await this.sessionCatalog.require(cwd, sessionID)
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

  private requireRuntimeWorkspace(runtime: PiCliRuntime, cwd: string) {
    if (workspaceIdentity(runtime.record.cwd) !== workspaceIdentity(cwd)) {
      throw new Error('PI CLI session not found for this workspace.')
    }
    return runtime
  }

  private async setRuntimeModel(runtime: PiCliRuntime, modelKey: string) {
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
    await this.sessionCatalog.update(record)
  }

  private async touchRecord(runtime: PiCliRuntime) {
    if (runtime.lease.isCurrent()) await this.updateRecord(runtime.record)
  }
}

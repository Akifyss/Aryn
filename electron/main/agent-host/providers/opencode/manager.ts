import { pathToFileURL } from 'node:url'
import {
  type Event as OpenCodeEvent,
  type Message,
  type OpencodeClient,
  type Part,
  type Provider,
  type Session,
  type SnapshotFileDiff,
  type SessionStatus,
} from '@opencode-ai/sdk/v2'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
  AgentPromptAttachment,
  AgentPromptSendOptions,
  AgentRunningPromptBehavior,
  AgentSessionCreateOptions,
  AgentSessionListItem,
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentWorkspaceState,
  OpenCodeSurfaceRequest,
  OpenCodeSurfaceResponse,
} from '../../../../shared/agent-contracts/types'
import {
  isOpenCodeMessageId,
  isOpenCodePartId,
} from '../../../../shared/agent-contracts/providers/opencode/message-id'
import {
  getOpenCodeEventSessionId,
  OpenCodeSessionMessageReducer,
} from './session-reducer'
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
  type OpenCodeServer,
  type OpenCodeServerLaunchOptions,
} from './server-process'
import {
  ARYN_SESSION_METADATA_KEY,
  createOpenCodeSessionListItem as sessionListItem,
  DEFAULT_OPEN_CODE_THINKING_LEVEL as DEFAULT_THINKING_LEVEL,
  formatOpenCodeError as formatError,
  getOpenCodeThinkingLevels as supportedThinkingLevels,
  mapOpenCodeThinkingVariant as mapThinkingVariant,
  normalizeNullableText,
  normalizeOpenCodeExecutionState as normalizeExecutionState,
  parseOpenCodeModelKey as parseModelKey,
  unwrapOpenCodeSdkResult as unwrapSdkResult,
  type OpenCodeSessionRecord,
} from './session-model'
import { requestOpenCodeSurfaceData } from './surface-gateway'
import { OpenCodeInteractionRegistry } from './interaction-registry'
import { OpenCodeSessionCatalog } from './session-catalog'
import {
  buildOpenCodeRuntime,
  createOpenCodeSessionSnapshot,
} from './presentation'
import type { OpenCodeSessionBinding as SessionBinding } from './runtime'
import { OpenCodeServerSupervisor } from './server-supervisor'
import { applyOpenCodeSessionEvent } from './event-projector'
import { OpenCodeBindingRegistry } from './binding-registry'
import { OpenCodeReconnectReconciler } from './reconnect-reconciler'

type JsonRecord = Record<string, unknown>

type WorkspaceStateContext = {
  activation?: WorkspaceActivation
  sourceLease?: SessionRuntimeLease
  workspaceOperation?: WorkspaceOperation
}

type OpenCodeAgentManagerOptions = {
  agentDir: string
  emitEvent: (event: AgentClientEventPayload) => void
  startServer?: (options: OpenCodeServerLaunchOptions) => Promise<OpenCodeServer>
}

const OPEN_CODE_SNAPSHOT_COALESCE_MS = 16

export class OpenCodeAgentManager {
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private readonly interactionRegistry: OpenCodeInteractionRegistry
  private readonly bindingRegistry = new OpenCodeBindingRegistry()
  private readonly messageReducer = new OpenCodeSessionMessageReducer()
  private readonly reconnectReconciler: OpenCodeReconnectReconciler
  private readonly runtimeCoordinator: SessionRuntimeCoordinator<SessionBinding>
  private readonly sessionCatalog: OpenCodeSessionCatalog
  private readonly sessionDiffs = new Map<string, SnapshotFileDiff[]>()
  private readonly sessionSnapshotTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly serverSupervisor: OpenCodeServerSupervisor
  private readonly knownWorkspaces = new Map<string, string>()
  private readonly workspaceIntent = new WorkspaceIntentCoordinator({
    canOperate: (identity) => !this.disposed && !this.workspaceTeardownCounts.has(identity),
  })
  private readonly workspaceCreationCounts = new Map<string, number>()
  private readonly workspaceCreationWaiters = new Map<string, Set<() => void>>()
  private readonly workspaceStateRevisions = new Map<string, number>()
  private readonly workspaceTeardownCounts = new Map<string, number>()
  constructor(private readonly options: OpenCodeAgentManagerOptions) {
    this.interactionRegistry = new OpenCodeInteractionRegistry(options.emitEvent)
    this.reconnectReconciler = new OpenCodeReconnectReconciler({
      activeSessionId: (cwd) => this.workspaceIntent.active(workspaceIdentity(cwd)),
      bindings: () => this.bindingRegistry.values(),
      broadcastWorkspaceState: (cwd, activeSessionId, operation) => (
        this.broadcastWorkspaceState(cwd, activeSessionId, { workspaceOperation: operation })
      ),
      captureWorkspaceOperation: (cwd) => this.captureWorkspaceOperation(cwd),
      emitEvent: options.emitEvent,
      enqueueSessionEvent: (client, generation, event, directory) => (
        this.enqueueSessionEvent(client, generation, event, directory)
      ),
      interactionRegistry: this.interactionRegistry,
      isBindingCurrent: (binding) => this.isSessionBindingCurrent(binding),
      isClientCurrent: (client, generation) => this.isClientCurrent(client, generation),
      isWorkspaceOperationCurrent: (operation) => this.isWorkspaceOperationCurrent(operation),
      knownWorkspaces: () => this.knownWorkspaces.entries(),
      requireBinding: (client, cwd, sessionId) => this.requireBinding(client, cwd, sessionId),
    })
    this.serverSupervisor = new OpenCodeServerSupervisor({
      onDisconnected: (error) => this.handleConnectionFailure(error),
      onEvent: async (client, generation, event, directory) => {
        await this.enqueueSessionEvent(client, generation, event, directory)
      },
      onEventError: (error, event) => {
        this.options.emitEvent({
          type: 'error',
          message: `OpenCode 事件处理失败：${formatError(error)}`,
          sessionId: getOpenCodeEventSessionId(event),
        })
      },
      onReconnect: (client, generation) => this.reconnectReconciler.reconcile(client, generation),
      onRestartFailure: (error) => {
        this.options.emitEvent({
          type: 'error',
          message: `OpenCode server restart failed: ${formatError(error)}`,
          sessionId: null,
        })
      },
      startServer: options.startServer,
    })
    this.runtimeCoordinator = new SessionRuntimeCoordinator({
      stopRuntime: (binding) => this.dropSessionBinding(binding),
    })
    this.sessionCatalog = new OpenCodeSessionCatalog(options.agentDir)
  }

  async loadDraftState(): Promise<AgentWorkspaceState> {
    const client = await this.ensureClient()
    const clientGeneration = this.clientGeneration
    const runtime = await this.buildRuntime(client, null, null)
    if (!this.isClientCurrent(client, clientGeneration)) {
      throw new Error('OpenCode draft state request was superseded.')
    }
    return { activeSession: null, runtime, sessions: [] }
  }

  async loadWorkspaceState(
    cwd: string,
    preferredSessionPath: string | null = null,
    options: { restoreSession?: boolean } = {},
  ) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const activation = this.beginWorkspaceActivation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const client = await this.ensureClient()
    const clientGeneration = this.clientGeneration
    const sessions = await this.listSessions(client, cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    let activeSessionID: string | null = null

    if (options.restoreSession !== false) {
      const identity = workspaceIdentity(cwd)
      const candidates = [preferredSessionPath, this.workspaceIntent.active(identity), sessions[0]?.id]
        .filter((candidate, index, values): candidate is string => Boolean(candidate && values.indexOf(candidate) === index))
      for (const candidate of candidates) {
        if (sessions.some((session) => session.id === candidate)) {
          activeSessionID = candidate
          break
        }
        try {
          await this.requireBinding(client, cwd, candidate)
          activeSessionID = candidate
          break
        } catch {
          // A stale child-session preference must not prevent the owned root
          // session list from loading.
        }
      }
    }

    if (!this.setWorkspaceActivationTarget(activation, activeSessionID)) {
      throw new Error('OpenCode workspace activation was superseded.')
    }

    await this.reconnectReconciler.reconcilePendingInteractions(
      client,
      clientGeneration,
      cwd,
      workspaceOperation,
    ).catch((error) => {
      if (
        this.isClientCurrent(client, clientGeneration)
        && this.isWorkspaceOperationCurrent(workspaceOperation)
      ) {
        this.options.emitEvent({
          type: 'error',
          message: `OpenCode 待处理请求同步失败：${formatError(error)}`,
          sessionId: activeSessionID,
        })
      }
    })

    const state = await this.buildWorkspaceState(
      client,
      cwd,
      activeSessionID,
      sessions,
      activeSessionID ? this.currentSessionBinding(cwd, activeSessionID) ?? undefined : undefined,
      () => (
        this.isWorkspaceOperationCurrent(workspaceOperation)
        && this.isWorkspaceActivationCurrent(activation)
        && this.isClientCurrent(client, clientGeneration)
      ),
      clientGeneration,
    )
    if (!this.commitWorkspaceActivation(activation, activeSessionID)) {
      throw new Error('OpenCode workspace activation was superseded.')
    }
    // The loaded state is delivered through the request response rather than a
    // workspace_state event. Suppress any background snapshot that began
    // before this activation committed; otherwise it could arrive just after
    // the response and restore the previously active session in the renderer.
    this.invalidateWorkspaceState(workspaceOperation.identity)
    return state
  }

  async listSessionItems(cwd: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const client = await this.ensureClient()
    const clientGeneration = this.clientGeneration
    const sessions = await this.listSessions(client, cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    if (!this.isClientCurrent(client, clientGeneration)) {
      throw new Error('OpenCode session list request was superseded.')
    }
    return sessions.map(sessionListItem)
  }

  async readSession(cwd: string, sessionID: string) {
    return this.withBinding(cwd, sessionID, (client, binding, clientGeneration) => (
      this.buildSessionSnapshot(client, binding, clientGeneration)
    ))
  }

  async requestSurfaceData(cwd: string, request: OpenCodeSurfaceRequest): Promise<OpenCodeSurfaceResponse> {
    if ('sessionID' in request) {
      return this.withBinding(cwd, request.sessionID, (client) => (
        requestOpenCodeSurfaceData(client, cwd, request)
      ))
    }
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const client = await this.ensureClient()
    const clientGeneration = this.clientGeneration
    const response = await requestOpenCodeSurfaceData(client, cwd, request)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    if (!this.isClientCurrent(client, clientGeneration)) {
      throw new Error('OpenCode surface request was superseded.')
    }
    return response
  }

  async sessionExists(cwd: string, sessionID: string) {
    try {
      await this.requireBinding(await this.ensureClient(), cwd, sessionID)
      return true
    } catch {
      return false
    }
  }

  async createSession(cwd: string, options?: string | AgentSessionCreateOptions) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const previousActiveSessionID = this.workspaceIntent.active(workspaceOperation.identity)
    const activation = this.beginWorkspaceActivation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const client = await this.ensureClient()
    const clientGeneration = this.clientGeneration
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const normalizedOptions = typeof options === 'string' ? { name: options } : options
    const selectedModel = parseModelKey(normalizedOptions?.modelKey)
    const thinkingLevel = normalizedOptions?.thinkingLevel ?? DEFAULT_THINKING_LEVEL
    if (normalizedOptions?.modelKey) {
      const supportedLevels = await this.requireAvailableModel(client, cwd, normalizedOptions.modelKey)
      if (!supportedLevels.includes(thinkingLevel)) {
        throw new Error(`OpenCode thinking level "${thinkingLevel}" is not supported by "${normalizedOptions.modelKey}".`)
      }
    }
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    if (!this.isClientCurrent(client, clientGeneration)) {
      throw new Error('OpenCode server was replaced before session creation.')
    }
    return this.withWorkspaceCreation(workspaceOperation.identity, async () => {
      this.requireWorkspaceOperationCurrent(workspaceOperation)
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
      const record: OpenCodeSessionRecord = {
        createdAt: new Date(session.time.created).toISOString(),
        cwd,
        id: session.id,
        modelKey: selectedModel ? `${selectedModel.providerID}/${selectedModel.modelID}` : null,
        thinkingLevel,
      }
      let indexed = false
      try {
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        if (!this.isClientCurrent(client, clientGeneration)) {
          throw new Error('OpenCode server was replaced during session creation.')
        }
        await this.sessionCatalog.upsert(record)
        indexed = true
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        const binding = await this.installSessionBinding(
          cwd,
          session,
          record,
          session.id,
          undefined,
          clientGeneration,
        )
        binding.selectedModel = record.modelKey
        binding.thinkingLevel = thinkingLevel
        if (
          !this.setWorkspaceActivationTarget(activation, session.id)
          || !this.commitWorkspaceActivation(activation, session.id)
        ) {
          throw new Error('OpenCode workspace activation was superseded.')
        }
        return await this.broadcastWorkspaceState(cwd, session.id, {
          activation,
          sourceLease: binding.lease,
          workspaceOperation,
        })
      } catch (error) {
        if (
          this.isWorkspaceActivationCurrent(activation)
          && this.workspaceIntent.active(workspaceOperation.identity) === session.id
        ) {
          this.setWorkspaceActivationTarget(activation, previousActiveSessionID)
          this.commitWorkspaceActivation(activation, previousActiveSessionID)
        }
        await this.runtimeCoordinator.retire(runtimeKey(cwd, session.id)).catch(() => undefined)
        const deleted = await client.session.delete({
          directory: cwd,
          sessionID: session.id,
        }, { throwOnError: true }).then(() => true, () => false)
        if (indexed && deleted) {
          await this.sessionCatalog.remove(cwd, new Set([session.id])).catch((cleanupError) => {
            console.warn(
              `[opencode] Failed to remove ownership of a rolled-back session ${session.id}: ${formatError(cleanupError)}`,
            )
          })
        } else if (!indexed && !deleted) {
          await this.sessionCatalog.upsert(record).catch((cleanupError) => {
            console.warn(
              `[opencode] Failed to retain ownership of an unrolled session ${session.id}: ${formatError(cleanupError)}`,
            )
          })
        }
        throw error
      }
    })
  }

  async openSession(cwd: string, sessionID: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    const activation = this.beginWorkspaceActivation(cwd, sessionID)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, sessionID, (_client, binding) => {
      sourceLease = binding.lease
      this.requireWorkspaceOperationCurrent(workspaceOperation)
      if (!this.commitWorkspaceActivation(activation, sessionID)) {
        throw new Error('OpenCode workspace activation was superseded.')
      }
    }, workspaceOperation)
    return this.broadcastWorkspaceState(cwd, sessionID, {
      activation,
      sourceLease,
      workspaceOperation,
    })
  }

  async deleteSession(cwd: string, sessionID: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const client = await this.ensureClient()
    await this.requireBinding(client, cwd, sessionID)
    const activeSessionID = this.workspaceIntent.active(workspaceOperation.identity)
    const initiallyAffectedSessionIDs = new Set([
      sessionID,
      ...this.findDescendantSessionBindings(cwd, sessionID).map((binding) => binding.sessionId),
    ])
    if (activeSessionID && initiallyAffectedSessionIDs.has(activeSessionID)) {
      this.invalidateWorkspaceActivation(workspaceOperation.identity)
    } else {
      this.invalidateWorkspaceActivationForSession(workspaceOperation.identity, sessionID)
    }
    let indexFailure: unknown = null
    let descendantKeys: string[] = []
    let deletedSessionIDs = new Set([sessionID])
    let nextActiveSessionID = await this.runtimeCoordinator.runAndRetire(
      runtimeKey(cwd, sessionID),
      async (current) => {
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        const binding = current?.runtime
        if (!binding || !this.isSessionBindingCurrent(binding)) {
          throw new Error('OpenCode session binding was superseded before deletion.')
        }
        await client.session.delete({ directory: cwd, sessionID }, { throwOnError: true })
        try {
          await this.sessionCatalog.remove(cwd, new Set([sessionID]))
        } catch (error) {
          indexFailure = error
        }
        const descendants = this.findDescendantSessionBindings(cwd, sessionID)
        descendantKeys = descendants.map((candidate) => candidate.lease.key)
        deletedSessionIDs = new Set([
          sessionID,
          ...descendants.map((candidate) => candidate.sessionId),
        ])
        const activeSessionID = this.workspaceIntent.active(workspaceOperation.identity)
        const deletedActiveSession = Boolean(activeSessionID && deletedSessionIDs.has(activeSessionID))
        if (deletedActiveSession) {
          this.workspaceIntent.setActive(workspaceOperation.identity, null)
        }
        return deletedActiveSession ? null : activeSessionID
      },
    )
    await Promise.all(descendantKeys.map((key) => this.runtimeCoordinator.retire(key)))
    const latestActiveSessionID = this.workspaceIntent.active(workspaceOperation.identity)
    if (latestActiveSessionID && deletedSessionIDs.has(latestActiveSessionID)) {
      this.invalidateWorkspaceActivation(workspaceOperation.identity)
      this.workspaceIntent.setActive(workspaceOperation.identity, null)
      nextActiveSessionID = null
    } else {
      nextActiveSessionID = latestActiveSessionID
    }
    const state = await this.broadcastWorkspaceState(cwd, nextActiveSessionID, { workspaceOperation })
    if (indexFailure) throw indexFailure
    return state
  }

  async renameSession(cwd: string, sessionID: string, name: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, sessionID, async (client, binding, clientGeneration) => {
      sourceLease = binding.lease
      await client.session.update({ directory: cwd, sessionID, title: name.trim() }, { throwOnError: true })
      if (!this.isClientCurrent(client, clientGeneration) || !this.isSessionBindingCurrent(binding)) {
        throw new Error('OpenCode session rename was superseded.')
      }
      binding.title = name.trim() || null
    }, workspaceOperation)
    return this.broadcastWorkspaceState(
      cwd,
      this.workspaceIntent.active(workspaceIdentity(cwd)),
      { sourceLease, workspaceOperation },
    )
  }

  async sendPrompt(
    cwd: string,
    sessionID: string,
    prompt: string,
    streamingBehavior?: AgentRunningPromptBehavior,
    attachments: AgentPromptAttachment[] = [],
    options?: AgentPromptSendOptions,
  ) {
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

    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let promptError: unknown = null
    try {
      return await this.withBinding(cwd, sessionID, async (client, binding, clientGeneration) => {
        if (binding.parentSessionId) {
          throw new Error('OpenCode 子会话由父会话中的子 Agent 管理，不能直接发送消息。')
        }
        if (binding.isStreaming && streamingBehavior === 'followUp') {
          throw new Error('OpenCode 当前不支持客户端排队的后续消息；运行中发送会按官方行为追加引导。')
        }
        const selectedModel = parseModelKey(binding.selectedModel)
        binding.executionState = { type: 'busy' }
        binding.isStreaming = true
        this.emitSessionSnapshot(binding)

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
          if (
            this.isClientCurrent(client, clientGeneration)
            && this.isSessionBindingCurrent(binding)
          ) {
            binding.executionState = { type: 'idle' }
            binding.isStreaming = false
            this.options.emitEvent({ type: 'error', message: formatError(error), sessionId: sessionID })
            promptError = error
          }
          throw error
        }
        if (!this.isClientCurrent(client, clientGeneration) || !this.isSessionBindingCurrent(binding)) {
          throw new Error('OpenCode prompt was superseded.')
        }
        return { ok: true }
      }, workspaceOperation)
    } catch (error) {
      if (promptError) {
        await this.broadcastWorkspaceState(cwd, sessionID, { workspaceOperation }).catch(() => undefined)
      }
      throw error
    }
  }

  async selectModel(cwd: string, sessionID: string, modelKey: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, sessionID, async (client, binding) => {
      sourceLease = binding.lease
      if (binding.parentSessionId) throw new Error('OpenCode 子会话不能单独修改模型。')
      const supportedLevels = await this.requireAvailableModel(client, cwd, modelKey)
      const nextThinkingLevel = supportedLevels.includes(binding.thinkingLevel)
        ? binding.thinkingLevel
        : supportedLevels.includes(DEFAULT_THINKING_LEVEL)
          ? DEFAULT_THINKING_LEVEL
          : supportedLevels[0] ?? 'off'
      await this.updateSessionConfiguration(
        client,
        cwd,
        sessionID,
        modelKey,
        nextThinkingLevel,
      )
      if (!this.isSessionBindingCurrent(binding)) {
        throw new Error('OpenCode model selection was superseded.')
      }
      binding.selectedModel = modelKey
      binding.thinkingLevel = nextThinkingLevel
    }, workspaceOperation)
    return this.broadcastWorkspaceState(cwd, sessionID, { sourceLease, workspaceOperation })
  }

  async selectThinkingLevel(cwd: string, sessionID: string, level: string, modelKey?: string) {
    if (!['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(level)) {
      throw new Error(`OpenCode thinking level "${level}" is invalid.`)
    }
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, sessionID, async (client, binding) => {
      sourceLease = binding.lease
      if (binding.parentSessionId) throw new Error('OpenCode 子会话不能单独修改思考等级。')
      const selectedModelKey = modelKey ?? binding.selectedModel
      if (!selectedModelKey) throw new Error('Select an OpenCode model before changing the thinking level.')
      const supportedLevels = await this.requireAvailableModel(client, cwd, selectedModelKey)
      if (!supportedLevels.includes(level as AgentThinkingLevel)) {
        throw new Error(`OpenCode thinking level "${level}" is not supported by "${selectedModelKey}".`)
      }
      const nextModel = modelKey ?? binding.selectedModel
      const nextThinkingLevel = level as AgentThinkingLevel
      await this.updateSessionConfiguration(
        client,
        cwd,
        sessionID,
        nextModel,
        nextThinkingLevel,
      )
      if (!this.isSessionBindingCurrent(binding)) {
        throw new Error('OpenCode thinking level selection was superseded.')
      }
      binding.selectedModel = nextModel
      binding.thinkingLevel = nextThinkingLevel
    }, workspaceOperation)
    return this.broadcastWorkspaceState(cwd, sessionID, { sourceLease, workspaceOperation })
  }

  async abortActivePrompt(cwd: string, sessionID: string) {
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    let sourceLease!: SessionRuntimeLease
    await this.withBinding(cwd, sessionID, async (client, binding, clientGeneration) => {
      sourceLease = binding.lease
      if (binding.parentSessionId) throw new Error('OpenCode 子会话由父会话管理，不能单独停止。')
      await client.session.abort({ directory: cwd, sessionID }, { throwOnError: true })
      if (!this.isClientCurrent(client, clientGeneration) || !this.isSessionBindingCurrent(binding)) {
        throw new Error('OpenCode abort was superseded.')
      }
      binding.executionState = { type: 'idle' }
      binding.isStreaming = false
    }, workspaceOperation)
    return this.broadcastWorkspaceState(cwd, sessionID, { sourceLease, workspaceOperation })
  }

  async respondToInteraction(response: AgentInteractionResponse) {
    const pendingEntry = this.interactionRegistry.findResponse(response, this.clientGeneration)
    const interactionKey = pendingEntry?.[0]
    const pending = pendingEntry?.[1]
    if (!interactionKey || !pending) return false
    return this.runtimeCoordinator.run(pending.lease.key, async () => {
      if (!this.interactionRegistry.isCurrent(pending, this.clientGeneration)) return false
      const client = await this.ensureClient()
      if (!this.interactionRegistry.isCurrent(pending, this.clientGeneration)) {
        return false
      }
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
      if (!this.interactionRegistry.isCurrent(pending, this.clientGeneration)) return false
      this.interactionRegistry.resolve(interactionKey, true, response)
      return true
    })
  }

  async releaseWorkspaceRuntime(cwd: string) {
    const identity = workspaceIdentity(cwd)
    this.invalidateWorkspaceOperations(identity)
    this.invalidateWorkspaceActivation(identity)
    this.invalidateWorkspaceState(identity)
    await this.withWorkspaceTeardown(identity, async () => {
      await this.waitForWorkspaceCreations(identity)
      const keys = this.runtimeCoordinator.keys().filter((key) => key.startsWith(workspaceRuntimeKeyPrefix(cwd)))
      const client = this.client
      const results = await Promise.allSettled(keys.map((key) => this.runtimeCoordinator.retireAndRun(
        key,
        async (retired) => {
          const binding = retired?.runtime
          if (!client || !binding?.isStreaming) return
          await client.session.abort({
            directory: binding.cwd,
            sessionID: binding.sessionId,
          }, { throwOnError: true })
        },
      )))
      this.workspaceIntent.setActive(identity, null)
      this.knownWorkspaces.delete(identity)
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more OpenCode sessions could not be stopped.')
      }
    })
  }

  async discardWorkspaceSessions(cwd: string) {
    // Draft cleanup is deliberately limited to the Aryn ownership manifest.
    // Official OpenCode sessions discovered for the workspace must never be
    // deleted merely because an Aryn draft is discarded.
    const identity = workspaceIdentity(cwd)
    this.invalidateWorkspaceOperations(identity)
    this.invalidateWorkspaceActivation(identity)
    this.invalidateWorkspaceState(identity)
    await this.withWorkspaceTeardown(identity, async () => {
      await this.waitForWorkspaceCreations(identity)
      const records = await this.sessionCatalog.listOwned(cwd)
      if (records.length === 0) {
        this.workspaceIntent.setActive(identity, null)
        this.knownWorkspaces.delete(identity)
        return
      }
      const client = await this.ensureClient()
      const results = await Promise.allSettled(records.map((record) => this.runtimeCoordinator.runAndRetire(
        runtimeKey(cwd, record.id),
        async () => {
          // Another delete/discard may have completed while this operation was
          // waiting for the per-session lifecycle lane. Re-check the ownership
          // claim so teardown retries stay idempotent instead of issuing a
          // second native DELETE for a session that is already gone.
          const isStillOwned = (await this.sessionCatalog.listOwned(cwd))
            .some((candidate) => candidate.id === record.id)
          if (!isStillOwned) return { deleted: false, indexFailure: null, sessionID: record.id }
          await client.session.delete({ directory: cwd, sessionID: record.id }, { throwOnError: true })
          let indexFailure: unknown = null
          try {
            await this.sessionCatalog.remove(cwd, new Set([record.id]))
          } catch (error) {
            indexFailure = error
          }
          return { deleted: true, indexFailure, sessionID: record.id }
        },
      )))
      const completed = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
      const deleted = new Set(completed.flatMap((result) => result.deleted ? [result.sessionID] : []))
      const descendantKeys = [...this.bindingRegistry.values()]
        .filter((binding) => (
          deleted.has(binding.rootSessionId)
          && workspaceIdentity(binding.cwd) === identity
        ))
        .map((binding) => binding.lease.key)
      await Promise.all(descendantKeys.map((key) => this.runtimeCoordinator.retire(key)))
      this.workspaceIntent.setActive(identity, null)
      this.knownWorkspaces.delete(identity)
      const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
      failures.push(...completed.flatMap((result) => result.indexFailure ? [result.indexFailure] : []))
      if (failures.length > 0) {
        throw new AggregateError(failures, 'One or more OpenCode sessions could not be discarded.')
      }
    })
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.serverSupervisor.dispose()
    for (const timer of this.sessionSnapshotTimers.values()) clearTimeout(timer)
    this.sessionSnapshotTimers.clear()
    this.messageReducer.clearAll()
    this.interactionRegistry.reset()
    this.sessionDiffs.clear()
    this.knownWorkspaces.clear()
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

  private async ensureClient() {
    if (this.disposed) throw new Error('OpenCode manager has been disposed.')
    return this.serverSupervisor.ensureClient()
  }

  private get client() {
    return this.serverSupervisor.client
  }

  private get clientGeneration() {
    return this.serverSupervisor.generation
  }

  private async enqueueSessionEvent(
    client: OpencodeClient,
    clientGeneration: number,
    event: OpenCodeEvent,
    eventDirectory?: string,
  ) {
    if (!this.isClientCurrent(client, clientGeneration)) return null
    const properties = 'properties' in event ? event.properties as Record<string, unknown> : {}
    const sessionID = getOpenCodeEventSessionId(event)
    if (!sessionID) return null
    const binding = await this.resolveEventBinding(
      client,
      clientGeneration,
      sessionID,
      properties,
      eventDirectory,
    )
    if (!binding) {
      if (event.type === 'session.deleted') {
        void this.applyUnboundSessionDeletedEvent(
          client,
          clientGeneration,
          sessionID,
          event,
          properties,
          eventDirectory,
        ).catch((error) => {
          if (!this.isClientCurrent(client, clientGeneration)) return
          this.options.emitEvent({
            type: 'error',
            message: `OpenCode session deletion sync failed: ${formatError(error)}`,
            sessionId: null,
          })
        })
      }
      return null
    }
    if (!this.isSessionBindingCurrent(binding)) return null
    binding.lease.enqueue(
      () => this.applySessionEvent(client, clientGeneration, binding, event, properties),
      (error) => {
        if (
          !this.isClientCurrent(client, clientGeneration)
          || !this.isSessionBindingCurrent(binding)
        ) return
        this.options.emitEvent({
          type: 'error',
          message: `OpenCode 事件处理失败：${formatError(error)}`,
          sessionId: binding.sessionId,
        })
      },
    )
    return binding
  }

  private async applySessionEvent(
    client: OpencodeClient,
    clientGeneration: number,
    binding: SessionBinding,
    event: OpenCodeEvent,
    properties: Record<string, unknown>,
  ) {
    if (!this.isClientCurrent(client, clientGeneration)) return
    await applyOpenCodeSessionEvent(binding, event, properties, clientGeneration, {
      emitEvent: this.options.emitEvent,
      emitSessionSnapshot: (currentBinding) => this.emitSessionSnapshot(currentBinding),
      interactionRegistry: this.interactionRegistry,
      isCurrent: (currentBinding) => (
        this.isClientCurrent(client, clientGeneration)
        && this.isSessionBindingCurrent(currentBinding)
      ),
      messageReducer: this.messageReducer,
      onSessionDeleted: (currentBinding) => (
        this.applyBoundSessionDeletedEvent(client, clientGeneration, currentBinding)
      ),
      onWorkspaceStateChanged: (currentBinding) => this.broadcastWorkspaceState(
        currentBinding.cwd,
        this.workspaceIntent.active(workspaceIdentity(currentBinding.cwd)),
        { sourceLease: currentBinding.lease },
      ),
      scheduleSessionSnapshot: (currentBinding) => this.scheduleSessionSnapshot(currentBinding),
      sessionDiffs: this.sessionDiffs,
    })
  }

  private async applyBoundSessionDeletedEvent(
    client: OpencodeClient,
    clientGeneration: number,
    binding: SessionBinding,
  ) {
    const workspaceOperation = this.captureWorkspaceOperation(binding.cwd)
    if (!this.isWorkspaceOperationCurrent(workspaceOperation)) return
    const descendants = this.findDescendantSessionBindings(binding.cwd, binding.sessionId)
    const deletedSessionIDs = new Set([
      binding.sessionId,
      ...descendants.map((candidate) => candidate.sessionId),
    ])
    const retired = await this.runtimeCoordinator.retireLease(binding.lease)
    if (!retired) return
    await Promise.all(descendants.map((candidate) => (
      this.runtimeCoordinator.retire(candidate.lease.key)
    )))
    await this.sessionCatalog.remove(binding.cwd, deletedSessionIDs).catch((error) => {
      this.options.emitEvent({
        type: 'error',
        message: `OpenCode ownership cleanup failed: ${formatError(error)}`,
        sessionId: binding.rootSessionId,
      })
    })

    const activeSessionID = this.workspaceIntent.active(workspaceOperation.identity)
    const nextActiveSessionID = activeSessionID && deletedSessionIDs.has(activeSessionID)
      ? null
      : activeSessionID
    if (nextActiveSessionID === null && activeSessionID !== null) {
      this.invalidateWorkspaceActivation(workspaceOperation.identity)
      this.workspaceIntent.setActive(workspaceOperation.identity, null)
    }
    if (
      !this.isClientCurrent(client, clientGeneration)
      || !this.isWorkspaceOperationCurrent(workspaceOperation)
    ) return
    await this.broadcastWorkspaceState(binding.cwd, nextActiveSessionID, { workspaceOperation })
  }

  private async applyUnboundSessionDeletedEvent(
    client: OpencodeClient,
    clientGeneration: number,
    sessionID: string,
    event: OpenCodeEvent,
    properties: JsonRecord,
    eventDirectory?: string,
  ) {
    if (!this.isClientCurrent(client, clientGeneration)) return
    const cwd = this.resolveKnownEventWorkspace(properties, eventDirectory)
    if (!cwd) return
    const workspaceOperation = this.captureWorkspaceOperation(cwd)
    if (!this.isWorkspaceOperationCurrent(workspaceOperation)) return

    this.options.emitEvent({
      type: 'opencode_native_event',
      event,
      workspacePath: cwd,
    })
    await this.sessionCatalog.remove(cwd, new Set([sessionID])).catch((error) => {
      this.options.emitEvent({
        type: 'error',
        message: `OpenCode ownership cleanup failed: ${formatError(error)}`,
        sessionId: null,
      })
    })
    this.interactionRegistry.clear((pending) => (
      pending.sessionId === sessionID
      && workspaceIdentity(pending.cwd) === workspaceOperation.identity
    ))
    const activeSessionID = this.workspaceIntent.active(workspaceOperation.identity)
    const nextActiveSessionID = activeSessionID === sessionID ? null : activeSessionID
    if (nextActiveSessionID === null && activeSessionID !== null) {
      this.invalidateWorkspaceActivation(workspaceOperation.identity)
      this.workspaceIntent.setActive(workspaceOperation.identity, null)
    }
    if (
      !this.isClientCurrent(client, clientGeneration)
      || !this.isWorkspaceOperationCurrent(workspaceOperation)
    ) return
    await this.broadcastWorkspaceState(cwd, nextActiveSessionID, { workspaceOperation })
  }

  private resolveKnownEventWorkspace(properties: JsonRecord, eventDirectory?: string) {
    const info = properties.info && typeof properties.info === 'object'
      ? properties.info as JsonRecord
      : null
    const candidates = [
      eventDirectory,
      normalizeNullableText(info?.directory),
      normalizeNullableText(info?.workspaceDirectory),
    ]
    const populatedCandidates = candidates.filter((candidate): candidate is string => Boolean(candidate))
    for (const candidate of populatedCandidates) {
      const known = this.knownWorkspaces.get(workspaceIdentity(candidate))
      if (known) return known
    }
    if (populatedCandidates.length === 0 && this.knownWorkspaces.size === 1) {
      return this.knownWorkspaces.values().next().value as string | undefined
    }
    return undefined
  }

  private createSessionBinding(
    cwd: string,
    session: Session,
    lease: SessionRuntimeLease,
    record?: OpenCodeSessionRecord,
    rootSessionId = session.id,
    ownerLease = lease,
    parentLease = lease,
  ): SessionBinding {
    return this.bindingRegistry.create(
      cwd,
      session,
      lease,
      record,
      rootSessionId,
      ownerLease,
      parentLease,
    )
  }

  private mergeSessionBinding(
    binding: SessionBinding,
    session: Session,
    record?: OpenCodeSessionRecord,
    rootSessionId = binding.rootSessionId,
    ownerLease = binding.ownerLease,
    parentLease = binding.parentLease,
  ) {
    this.bindingRegistry.merge(
      binding,
      session,
      record,
      rootSessionId,
      ownerLease,
      parentLease,
    )
  }

  private async installSessionBinding(
    cwd: string,
    session: Session,
    record?: OpenCodeSessionRecord,
    rootSessionId = session.id,
    ownerLease?: SessionRuntimeLease,
    clientGeneration?: number,
    parentLease?: SessionRuntimeLease,
  ) {
    const key = runtimeKey(cwd, session.id)
    return this.runtimeCoordinator.use(
      key,
      async (lease) => {
        if (clientGeneration !== undefined && this.clientGeneration !== clientGeneration) {
          throw new Error('OpenCode server was replaced before the session could be bound.')
        }
        let resolvedOwnerLease = ownerLease
        let resolvedParentLease = parentLease
        if (session.parentID) {
          const parentBinding = this.currentSessionBinding(cwd, session.parentID)
          if (!parentBinding) {
            throw new Error(`OpenCode parent session "${session.parentID}" must be bound before its child.`)
          }
          resolvedOwnerLease ??= parentBinding.ownerLease
          resolvedParentLease ??= parentBinding.lease
        } else if (rootSessionId !== session.id) {
          throw new Error(`OpenCode root session "${rootSessionId}" does not match the session hierarchy.`)
        }
        if (resolvedOwnerLease && !resolvedOwnerLease.isCurrent()) {
          throw new Error('OpenCode root session was retired before its child could be bound.')
        }
        if (resolvedParentLease && !resolvedParentLease.isCurrent()) {
          throw new Error('OpenCode parent session was retired before its child could be bound.')
        }
        const binding = this.createSessionBinding(
          cwd,
          session,
          lease,
          record,
          rootSessionId,
          resolvedOwnerLease ?? lease,
          resolvedParentLease ?? lease,
        )
        this.bindingRegistry.install(binding)
        return binding
      },
      ({ runtime: binding }) => {
        if (clientGeneration !== undefined && this.clientGeneration !== clientGeneration) {
          throw new Error('OpenCode server was replaced before the session could be updated.')
        }
        if (!this.isSessionBindingCurrent(binding)) {
          throw new Error('OpenCode session binding was superseded.')
        }
        this.mergeSessionBinding(
          binding,
          session,
          record,
          rootSessionId,
          ownerLease ?? binding.ownerLease,
          parentLease ?? binding.parentLease,
        )
        return binding
      },
    )
  }

  private handleConnectionFailure(error: unknown) {
    const message = `OpenCode event stream stopped: ${formatError(error)}`
    const streamingBindings = [...this.bindingRegistry.values()]
      .filter((binding) => this.isSessionBindingCurrent(binding) && binding.isStreaming)
    for (const binding of streamingBindings) {
      binding.executionState = { type: 'idle' }
      binding.isStreaming = false
      this.options.emitEvent({ type: 'error', message, sessionId: binding.sessionId })
    }
    if (streamingBindings.length === 0) {
      this.options.emitEvent({ type: 'error', message, sessionId: null })
    }
    this.interactionRegistry.clear(() => true)
  }

  private dropSessionBinding(binding: SessionBinding) {
    this.bindingRegistry.remove(binding)
    this.clearScheduledSessionSnapshot(binding.sessionId, binding.lease)
    this.messageReducer.clear(binding.sessionId)
    this.sessionDiffs.delete(binding.sessionId)
    this.interactionRegistry.clear((pending) => (
      pending.lease === binding.lease
      || (
        pending.cwd === binding.cwd
        && (
          pending.sessionId === binding.sessionId
          || pending.ownerSessionId === binding.sessionId
        )
      )
    ))
  }

  private isClientCurrent(client: OpencodeClient, clientGeneration: number) {
    return !this.disposed && this.serverSupervisor.isCurrent(client, clientGeneration)
  }

  private async resolveEventBinding(
    client: OpencodeClient,
    clientGeneration: number,
    sessionID: string,
    properties: JsonRecord,
    eventDirectory?: string,
  ) {
    if (!this.isClientCurrent(client, clientGeneration)) return null
    const current = this.findSessionBinding(sessionID, eventDirectory)
      ?? this.findSessionBinding(sessionID)
    if (current) return current
    const info = properties.info as Session | undefined
    if (info?.id === sessionID && info.parentID) {
      const parentBinding = this.findSessionBinding(info.parentID, eventDirectory)
      if (parentBinding) {
        return this.installSessionBinding(
          parentBinding.cwd,
          info,
          undefined,
          parentBinding.rootSessionId,
          parentBinding.ownerLease,
          clientGeneration,
          parentBinding.lease,
        )
      }
    }

    const eventWorkspaceIdentity = eventDirectory ? workspaceIdentity(eventDirectory) : null
    const workspaces = [...this.knownWorkspaces.entries()]
      .map(([identity, cwd]) => ({
        cwd,
        identity,
        revision: this.workspaceIntent.operationRevision(identity),
      }))
      .sort((left, right) => (
        Number(right.identity === eventWorkspaceIdentity) - Number(left.identity === eventWorkspaceIdentity)
      ))
    for (const workspace of workspaces) {
      const workspaceOperation: WorkspaceOperation = {
        identity: workspace.identity,
        revision: workspace.revision,
      }
      if (
        this.knownWorkspaces.get(workspace.identity) !== workspace.cwd
        || !this.isWorkspaceOperationCurrent(workspaceOperation)
      ) continue
      try {
        const binding = await this.requireBinding(client, workspace.cwd, sessionID)
        if (
          !this.isClientCurrent(client, clientGeneration)
          || this.knownWorkspaces.get(workspace.identity) !== workspace.cwd
          || !this.isWorkspaceOperationCurrent(workspaceOperation)
        ) {
          await this.runtimeCoordinator.retireLease(binding.lease)
          return null
        }
        return binding
      } catch {
        // The dedicated OpenCode server can emit events for another workspace.
        // Keep looking until the official root list confirms ownership.
      }
    }
    return null
  }

  private async listSessions(client: OpencodeClient, cwd: string) {
    const identity = workspaceIdentity(cwd)
    const operationRevision = this.workspaceIntent.operationRevision(identity)
    const sessions = await this.sessionCatalog.list(client, cwd)
    this.rememberWorkspace(cwd, operationRevision)
    return sessions
  }

  private async loadSessionHierarchy(client: OpencodeClient, cwd: string, sessionID: string) {
    const identity = workspaceIdentity(cwd)
    const operationRevision = this.workspaceIntent.operationRevision(identity)
    const hierarchy = await this.sessionCatalog.loadHierarchy(client, cwd, sessionID)
    this.rememberWorkspace(cwd, operationRevision)
    return hierarchy
  }

  private async startSessionBinding(
    client: OpencodeClient,
    clientGeneration: number,
    cwd: string,
    sessionID: string,
    lease: SessionRuntimeLease,
  ) {
    const [hierarchy, statusResponse] = await Promise.all([
      this.loadSessionHierarchy(client, cwd, sessionID),
      client.session.status({ directory: cwd }, { throwOnError: true }).catch(() => null),
    ])
    const { root, rootRecord, session } = hierarchy
    if (!this.isClientCurrent(client, clientGeneration)) {
      throw new Error('OpenCode server was replaced before the session could be bound.')
    }
    let ownerLease = lease
    let parentLease = lease
    if (session.parentID) {
      const parentBinding = await this.requireBinding(client, cwd, session.parentID)
      if (parentBinding.rootSessionId !== root.id) {
        throw new Error('OpenCode session hierarchy changed while the child was being bound.')
      }
      ownerLease = parentBinding.ownerLease
      parentLease = parentBinding.lease
    }
    if (!ownerLease.isCurrent() || !parentLease.isCurrent()) {
      throw new Error('OpenCode parent session was retired before its child could be bound.')
    }
    const binding = this.createSessionBinding(
      cwd,
      session,
      lease,
      rootRecord,
      root.id,
      ownerLease,
      parentLease,
    )
    if (statusResponse) {
      const statuses = unwrapSdkResult<Record<string, SessionStatus>>(statusResponse, 'read session status')
      binding.executionState = normalizeExecutionState(statuses[sessionID])
      binding.isStreaming = binding.executionState.type !== 'idle'
    }
    this.bindingRegistry.install(binding)
    return binding
  }

  private async requireBinding(client: OpencodeClient, cwd: string, sessionID: string) {
    const clientGeneration = this.clientGeneration
    if (!this.isClientCurrent(client, clientGeneration)) {
      throw new Error('OpenCode server connection was superseded.')
    }
    const handle = await this.runtimeCoordinator.ensure(
      runtimeKey(cwd, sessionID),
      (lease) => this.startSessionBinding(client, clientGeneration, cwd, sessionID, lease),
    )
    const binding = handle.runtime
    if (
      workspaceIdentity(binding.cwd) !== workspaceIdentity(cwd)
      || !this.isSessionBindingCurrent(binding)
    ) {
      throw new Error('OpenCode session not found for this Aryn workspace.')
    }
    return binding
  }

  private async withBinding<TResult>(
    cwd: string,
    sessionID: string,
    operation: (
      client: OpencodeClient,
      binding: SessionBinding,
      clientGeneration: number,
    ) => Promise<TResult> | TResult,
    workspaceOperation: WorkspaceOperation = this.captureWorkspaceOperation(cwd),
  ) {
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    const client = await this.ensureClient()
    const clientGeneration = this.clientGeneration
    this.requireWorkspaceOperationCurrent(workspaceOperation)
    return this.runtimeCoordinator.use(
      runtimeKey(cwd, sessionID),
      (lease) => this.startSessionBinding(client, clientGeneration, cwd, sessionID, lease),
      async ({ runtime: binding }) => {
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        if (
          !this.isClientCurrent(client, clientGeneration)
          || !this.isSessionBindingCurrent(binding)
        ) {
          throw new Error('OpenCode session operation was superseded.')
        }
        const result = await operation(client, binding, clientGeneration)
        this.requireWorkspaceOperationCurrent(workspaceOperation)
        if (
          !this.isClientCurrent(client, clientGeneration)
          || !this.isSessionBindingCurrent(binding)
        ) {
          throw new Error('OpenCode session operation was superseded.')
        }
        return result
      },
    )
  }

  private currentSessionBinding(cwd: string, sessionID: string) {
    return this.bindingRegistry.current(cwd, sessionID)
  }

  private findSessionBinding(sessionID: string, cwd?: string) {
    return this.bindingRegistry.find(sessionID, cwd)
  }

  private findDescendantSessionBindings(cwd: string, ancestorSessionID: string) {
    return this.bindingRegistry.descendants(cwd, ancestorSessionID)
  }

  private isSessionBindingCurrent(binding: SessionBinding) {
    return this.bindingRegistry.isCurrent(binding)
  }

  private beginWorkspaceActivation(cwd: string, targetSessionId?: string | null): WorkspaceActivation {
    return this.workspaceIntent.beginActivation(workspaceIdentity(cwd), targetSessionId)
  }

  private setWorkspaceActivationTarget(
    activation: WorkspaceActivation,
    targetSessionId: string | null,
  ) {
    return this.workspaceIntent.setActivationTarget(activation, targetSessionId)
  }

  private commitWorkspaceActivation(
    activation: WorkspaceActivation,
    sessionID: string | null,
  ) {
    return this.workspaceIntent.commitActivation(activation, sessionID)
  }

  private isWorkspaceActivationCurrent(activation: WorkspaceActivation) {
    return this.workspaceIntent.isActivationCurrent(activation)
  }

  private invalidateWorkspaceActivation(identity: string) {
    this.workspaceIntent.invalidateActivation(identity)
  }

  private invalidateWorkspaceActivationForSession(identity: string, sessionID: string) {
    this.workspaceIntent.invalidateActivationForTarget(identity, sessionID)
  }

  private captureWorkspaceOperation(cwd: string): WorkspaceOperation {
    return this.workspaceIntent.captureOperation(workspaceIdentity(cwd))
  }

  private isWorkspaceOperationCurrent(operation: WorkspaceOperation) {
    return this.workspaceIntent.isOperationCurrent(operation)
  }

  private rememberWorkspace(cwd: string, operationRevision: number) {
    const identity = workspaceIdentity(cwd)
    if (
      this.disposed
      || this.workspaceTeardownCounts.has(identity)
      || this.workspaceIntent.operationRevision(identity) !== operationRevision
    ) return
    this.knownWorkspaces.set(identity, cwd)
  }

  private requireWorkspaceOperationCurrent(operation: WorkspaceOperation) {
    this.workspaceIntent.requireOperationCurrent(
      operation,
      'OpenCode workspace operation was superseded.',
    )
  }

  private invalidateWorkspaceOperations(identity: string) {
    this.workspaceIntent.invalidateOperations(identity)
  }

  private invalidateWorkspaceState(identity: string) {
    this.workspaceStateRevisions.set(identity, (this.workspaceStateRevisions.get(identity) ?? 0) + 1)
  }

  private isWorkspaceStateContextCurrent(context: WorkspaceStateContext) {
    return (!context.activation || this.isWorkspaceActivationCurrent(context.activation))
      && this.isWorkspaceStateBuildContextCurrent(context)
  }

  private isWorkspaceStateBuildContextCurrent(context: WorkspaceStateContext) {
    return (!context.sourceLease || context.sourceLease.isCurrent())
      && (!context.workspaceOperation || this.isWorkspaceOperationCurrent(context.workspaceOperation))
  }

  private async withWorkspaceCreation<TResult>(
    identity: string,
    operation: () => Promise<TResult>,
  ) {
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
        this.workspaceCreationWaiters.delete(identity)
        for (const resolve of waiters ?? []) resolve()
      }
    }
  }

  private waitForWorkspaceCreations(identity: string) {
    if (!this.workspaceCreationCounts.has(identity)) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const waiters = this.workspaceCreationWaiters.get(identity)
      if (waiters) waiters.add(resolve)
      else this.workspaceCreationWaiters.set(identity, new Set([resolve]))
    })
  }

  private async withWorkspaceTeardown<TResult>(
    identity: string,
    operation: () => Promise<TResult>,
  ) {
    this.workspaceTeardownCounts.set(identity, (this.workspaceTeardownCounts.get(identity) ?? 0) + 1)
    try {
      return await operation()
    } finally {
      const remaining = (this.workspaceTeardownCounts.get(identity) ?? 1) - 1
      if (remaining > 0) this.workspaceTeardownCounts.set(identity, remaining)
      else this.workspaceTeardownCounts.delete(identity)
    }
  }

  private async updateSessionConfiguration(
    client: OpencodeClient,
    cwd: string,
    sessionID: string,
    modelKey: string | null,
    thinkingLevel: AgentThinkingLevel,
  ) {
    const { session } = await this.loadSessionHierarchy(client, cwd, sessionID)
    await this.sessionCatalog.updateConfiguration(
      client,
      cwd,
      session,
      modelKey,
      thinkingLevel,
    )
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

  private async buildSessionSnapshot(
    client: OpencodeClient,
    binding: SessionBinding,
    clientGeneration: number,
  ): Promise<AgentSessionSnapshot> {
    const { cwd, sessionId: sessionID } = binding
    const { session } = await this.loadSessionHierarchy(client, cwd, sessionID)
    const hydration = this.messageReducer.beginHydration(sessionID)
    try {
      const [messagesResponse, diffResponse] = await Promise.all([
        client.session.messages({ directory: cwd, sessionID, limit: 200 }, { throwOnError: true }),
        client.session.diff({ directory: cwd, sessionID }, { throwOnError: true }).catch(() => ({ data: [] as SnapshotFileDiff[] })),
      ])
      const records = unwrapSdkResult<Array<{ info: Message, parts: Part[] }>>(messagesResponse, 'read messages')
      const nextCursor = messagesResponse && typeof messagesResponse === 'object' && 'response' in messagesResponse
        ? messagesResponse.response.headers.get('x-next-cursor')
        : null
      const diffs = unwrapSdkResult<SnapshotFileDiff[]>(diffResponse, 'read diff')
      if (
        !this.isClientCurrent(client, clientGeneration)
        || !this.isSessionBindingCurrent(binding)
      ) {
        this.messageReducer.cancelHydration(hydration)
        throw new Error('OpenCode session snapshot was superseded.')
      }
      const isStreaming = binding.isStreaming
      // Live state remains authoritative while a prompt is streaming. At every
      // other boundary, reconcile the REST baseline with entity revisions that
      // changed during the request so stale fetches cannot undo native events.
      if (isStreaming && this.messageReducer.hasBufferedState(sessionID)) {
        this.messageReducer.cancelHydration(hydration)
      } else {
        this.messageReducer.hydrate(sessionID, records, hydration)
      }
      binding.historyCursor = nextCursor
      if (!isStreaming) {
        this.sessionDiffs.set(sessionID, diffs)
      }
      binding.title = session.title?.trim() || null
      return this.createSessionSnapshot(binding)
    } catch (error) {
      this.messageReducer.cancelHydration(hydration)
      throw error
    }
  }

  private createSessionSnapshot(binding: SessionBinding): AgentSessionSnapshot {
    return createOpenCodeSessionSnapshot(binding, this.messageReducer, {
      diffs: this.sessionDiffs,
    })
  }

  private emitSessionSnapshot(binding: SessionBinding) {
    this.clearScheduledSessionSnapshot(binding.sessionId, binding.lease)
    if (!this.isSessionBindingCurrent(binding)) return
    this.options.emitEvent({
      type: 'session_snapshot_updated',
      executionState: binding.executionState,
      session: this.createSessionSnapshot(binding),
      sessionId: binding.sessionId,
    })
  }

  private scheduleSessionSnapshot(binding: SessionBinding) {
    const timerKey = binding.lease.key
    if (this.sessionSnapshotTimers.has(timerKey)) return
    this.sessionSnapshotTimers.set(timerKey, setTimeout(() => {
      this.sessionSnapshotTimers.delete(timerKey)
      this.emitSessionSnapshot(binding)
    }, OPEN_CODE_SNAPSHOT_COALESCE_MS))
  }

  private clearScheduledSessionSnapshot(sessionID: string, expectedLease?: SessionRuntimeLease) {
    const timerKey = expectedLease?.key ?? this.findSessionBinding(sessionID)?.lease.key ?? sessionID
    const timer = this.sessionSnapshotTimers.get(timerKey)
    if (!timer) return
    clearTimeout(timer)
    this.sessionSnapshotTimers.delete(timerKey)
  }

  private async buildRuntime(
    client: OpencodeClient,
    cwd: string | null,
    binding: SessionBinding | null,
  ): Promise<AgentWorkspaceState['runtime']> {
    return buildOpenCodeRuntime(client, cwd, binding)
  }

  private async buildWorkspaceState(
    client: OpencodeClient,
    cwd: string,
    activeSessionID: string | null,
    knownSessions?: Session[],
    providedBinding?: SessionBinding,
    isRequestCurrent: () => boolean = () => true,
    clientGeneration = this.clientGeneration,
  ): Promise<AgentWorkspaceState> {
    const sessions = knownSessions ?? await this.listSessions(client, cwd)
    if (
      !isRequestCurrent()
      || !this.isClientCurrent(client, clientGeneration)
    ) throw new Error('OpenCode workspace state request was superseded.')
    const activeSession = activeSessionID
      ? providedBinding
        ? await this.buildSessionSnapshot(client, providedBinding, clientGeneration)
        : await this.withBinding(cwd, activeSessionID, (currentClient, binding, clientGeneration) => (
            this.buildSessionSnapshot(currentClient, binding, clientGeneration)
          ))
      : null
    if (
      !isRequestCurrent()
      || !this.isClientCurrent(client, clientGeneration)
    ) throw new Error('OpenCode workspace state request was superseded.')
    const binding = activeSessionID
      ? providedBinding ?? this.currentSessionBinding(cwd, activeSessionID)
      : null
    const runtime = await this.buildRuntime(client, cwd, binding)
    if (
      !isRequestCurrent()
      || !this.isClientCurrent(client, clientGeneration)
    ) throw new Error('OpenCode workspace state request was superseded.')
    return {
      activeSession,
      runtime,
      sessions: sessions.map(sessionListItem),
    }
  }

  private async broadcastWorkspaceState(
    cwd: string,
    requestedActiveSessionID: string | null,
    context: WorkspaceStateContext = {},
  ) {
    if (!this.isWorkspaceStateBuildContextCurrent(context)) {
      throw new Error('OpenCode workspace state request was superseded.')
    }
    const identity = workspaceIdentity(cwd)
    const activeSessionID = context.sourceLease
      ? this.workspaceIntent.active(identity) ?? requestedActiveSessionID
      : requestedActiveSessionID
    const revision = (this.workspaceStateRevisions.get(identity) ?? 0) + 1
    this.workspaceStateRevisions.set(identity, revision)
    const providedBinding = activeSessionID && context.sourceLease?.key === runtimeKey(cwd, activeSessionID)
      ? this.currentSessionBinding(cwd, activeSessionID) ?? undefined
      : undefined
    const client = await this.ensureClient()
    const clientGeneration = this.clientGeneration
    const state = await this.buildWorkspaceState(
      client,
      cwd,
      activeSessionID,
      undefined,
      providedBinding,
      () => this.isWorkspaceStateBuildContextCurrent(context),
      clientGeneration,
    )
    if (
      this.workspaceStateRevisions.get(identity) === revision
      && this.isClientCurrent(client, clientGeneration)
      && this.isWorkspaceStateContextCurrent(context)
    ) {
      this.options.emitEvent({ type: 'workspace_state', state })
    }
    return state
  }
}

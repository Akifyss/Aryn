import type {
  Event as OpenCodeEvent,
  OpencodeClient,
  PermissionRequest,
  QuestionRequest,
  SessionStatus,
} from '@opencode-ai/sdk/v2'
import { getAgentInteractionKey } from '../../../../shared/agent-contracts/types'
import type { AgentClientEventPayload } from '../../../../shared/agent-contracts/types'
import type { WorkspaceOperation } from '../../runtime/workspace-intent-coordinator'
import { createWorkspaceIdentity as workspaceIdentity } from '../../runtime/runtime-keys'
import type { OpenCodeInteractionRegistry } from './interaction-registry'
import {
  formatOpenCodeError as formatError,
  normalizeOpenCodeExecutionState as normalizeExecutionState,
  unwrapOpenCodeSdkResult as unwrapSdkResult,
} from './session-model'
import type { OpenCodeSessionBinding } from './runtime'

type OpenCodeReconnectReconcilerOptions = {
  activeSessionId: (cwd: string) => string | null
  bindings: () => Iterable<OpenCodeSessionBinding>
  broadcastWorkspaceState: (
    cwd: string,
    activeSessionId: string | null,
    operation: WorkspaceOperation,
  ) => Promise<unknown>
  captureWorkspaceOperation: (cwd: string) => WorkspaceOperation
  emitEvent: (event: AgentClientEventPayload) => void
  enqueueSessionEvent: (
    client: OpencodeClient,
    generation: number,
    event: OpenCodeEvent,
    directory?: string,
  ) => Promise<OpenCodeSessionBinding | null>
  interactionRegistry: OpenCodeInteractionRegistry
  isBindingCurrent: (binding: OpenCodeSessionBinding) => boolean
  isClientCurrent: (client: OpencodeClient, generation: number) => boolean
  isWorkspaceOperationCurrent: (operation: WorkspaceOperation) => boolean
  knownWorkspaces: () => Iterable<[string, string]>
  requireBinding: (
    client: OpencodeClient,
    cwd: string,
    sessionId: string,
  ) => Promise<OpenCodeSessionBinding>
}

/** Restores non-durable OpenCode status and prompts after the SSE stream reconnects. */
export class OpenCodeReconnectReconciler {
  constructor(private readonly options: OpenCodeReconnectReconcilerOptions) {}

  async reconcile(client: OpencodeClient, generation: number) {
    if (!this.options.isClientCurrent(client, generation)) return
    const workspaces = new Map<string, { bindings: OpenCodeSessionBinding[], cwd: string }>()
    for (const [identity, cwd] of this.options.knownWorkspaces()) {
      workspaces.set(identity, { bindings: [], cwd })
    }
    for (const binding of this.options.bindings()) {
      if (!this.options.isBindingCurrent(binding)) continue
      const identity = workspaceIdentity(binding.cwd)
      const workspace = workspaces.get(identity)
      if (workspace) workspace.bindings.push(binding)
      else workspaces.set(identity, { bindings: [binding], cwd: binding.cwd })
    }

    for (const { bindings, cwd } of workspaces.values()) {
      if (!this.options.isClientCurrent(client, generation)) return
      const operation = this.options.captureWorkspaceOperation(cwd)
      if (!this.options.isWorkspaceOperationCurrent(operation)) continue

      try {
        const response = await client.session.status({ directory: cwd }, { throwOnError: true })
        const statuses = unwrapSdkResult<Record<string, SessionStatus>>(
          response,
          'reconcile session status',
        )
        if (!this.options.isClientCurrent(client, generation)) return
        if (!this.options.isWorkspaceOperationCurrent(operation)) continue
        for (const binding of bindings) {
          if (!this.options.isBindingCurrent(binding)) continue
          binding.executionState = normalizeExecutionState(statuses[binding.sessionId])
          binding.isStreaming = binding.executionState.type !== 'idle'
        }
      } catch (error) {
        if (this.isCurrent(client, generation, operation)) {
          this.options.emitEvent({
            type: 'error',
            message: `OpenCode 重连后状态同步失败：${formatError(error)}`,
            sessionId: this.options.activeSessionId(cwd),
          })
        }
      }

      try {
        await this.reconcilePendingInteractions(client, generation, cwd, operation)
      } catch (error) {
        if (this.isCurrent(client, generation, operation)) {
          this.options.emitEvent({
            type: 'error',
            message: `OpenCode 重连后待处理请求同步失败：${formatError(error)}`,
            sessionId: this.options.activeSessionId(cwd),
          })
        }
      }

      if (!this.options.isClientCurrent(client, generation)) return
      if (!this.options.isWorkspaceOperationCurrent(operation)) continue
      for (const binding of bindings) {
        if (!this.options.isBindingCurrent(binding)) continue
        this.options.emitEvent({
          type: 'opencode_surface_refresh',
          sessionId: binding.sessionId,
          workspacePath: cwd,
        })
      }

      const activeSessionId = this.options.activeSessionId(cwd)
      try {
        await this.options.broadcastWorkspaceState(cwd, activeSessionId, operation)
      } catch (error) {
        if (this.isCurrent(client, generation, operation)) {
          this.options.emitEvent({
            type: 'error',
            message: `OpenCode 重连后会话同步失败：${formatError(error)}`,
            sessionId: activeSessionId,
          })
        }
      }
    }
  }

  async reconcilePendingInteractions(
    client: OpencodeClient,
    generation: number,
    cwd: string,
    operation = this.options.captureWorkspaceOperation(cwd),
  ) {
    const [permissionResponse, questionResponse] = await Promise.all([
      client.permission.list({ directory: cwd }, { throwOnError: true }),
      client.question.list({ directory: cwd }, { throwOnError: true }),
    ])
    const permissions = unwrapSdkResult<PermissionRequest[]>(
      permissionResponse,
      'list pending permissions',
    )
    const questions = unwrapSdkResult<QuestionRequest[]>(
      questionResponse,
      'list pending questions',
    )
    if (!this.isCurrent(client, generation, operation)) return

    const ownedPermissions: PermissionRequest[] = []
    const ownedQuestions: QuestionRequest[] = []
    const liveInteractionKeys = new Set<string>()
    let bindingResolutionFailure: unknown = null
    await Promise.all([
      ...permissions.map(async (request) => {
        try {
          const binding = await this.options.requireBinding(client, cwd, request.sessionID)
          if (workspaceIdentity(binding.cwd) !== workspaceIdentity(cwd)) return
          ownedPermissions.push(request)
          liveInteractionKeys.add(getAgentInteractionKey(request.sessionID, request.id))
        } catch (error) {
          bindingResolutionFailure ??= error
        }
      }),
      ...questions.map(async (request) => {
        try {
          const binding = await this.options.requireBinding(client, cwd, request.sessionID)
          if (workspaceIdentity(binding.cwd) !== workspaceIdentity(cwd)) return
          ownedQuestions.push(request)
          liveInteractionKeys.add(getAgentInteractionKey(request.sessionID, request.id))
        } catch (error) {
          bindingResolutionFailure ??= error
        }
      }),
    ])
    if (!this.isCurrent(client, generation, operation)) return

    // A failed lookup makes the server snapshot incomplete. Preserve existing
    // prompts until a complete reconciliation proves they are no longer live.
    if (!bindingResolutionFailure) {
      for (const [key, pending] of this.options.interactionRegistry.entries()) {
        if (!this.options.isWorkspaceOperationCurrent(operation)) return
        if (workspaceIdentity(pending.cwd) !== workspaceIdentity(cwd)) continue
        if (!liveInteractionKeys.has(key)) this.options.interactionRegistry.resolve(key, true)
      }
    }

    for (const request of ownedPermissions) {
      if (!this.options.isWorkspaceOperationCurrent(operation)) return
      const binding = await this.options.enqueueSessionEvent(
        client,
        generation,
        { type: 'permission.asked', properties: request } as OpenCodeEvent,
        cwd,
      )
      await binding?.lease.drain()
    }
    for (const request of ownedQuestions) {
      if (!this.options.isWorkspaceOperationCurrent(operation)) return
      const binding = await this.options.enqueueSessionEvent(
        client,
        generation,
        { type: 'question.asked', properties: request } as OpenCodeEvent,
        cwd,
      )
      await binding?.lease.drain()
    }
    if (bindingResolutionFailure) {
      throw new Error(
        `Could not verify one or more pending OpenCode interactions: ${formatError(bindingResolutionFailure)}`,
      )
    }
  }

  private isCurrent(
    client: OpencodeClient,
    generation: number,
    operation: WorkspaceOperation,
  ) {
    return this.options.isClientCurrent(client, generation)
      && this.options.isWorkspaceOperationCurrent(operation)
  }
}

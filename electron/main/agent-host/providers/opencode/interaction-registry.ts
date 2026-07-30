import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2'
import {
  getAgentInteractionKey,
  type AgentClientEventPayload,
  type AgentInteractionResponse,
} from '../../../../shared/agent-contracts/types'
import type { SessionRuntimeLease } from '../../runtime/session-runtime-coordinator'
import { normalizeNullableText } from './session-model'

type JsonRecord = Record<string, unknown>

export type OpenCodeInteractionBinding = {
  cwd: string
  ownerLease: SessionRuntimeLease
  rootSessionId: string
  sessionId: string
}

export type PendingOpenCodeInteraction = {
  clientGeneration: number
  cwd: string
  kind: 'permission' | 'question'
  lease: SessionRuntimeLease
  ownerSessionId: string
  protocol: 'classic' | 'v2'
  questionIds?: string[]
  requestId: string
  sessionId: string
}

/**
 * Owns native OpenCode permission/question identity and UI projection.
 *
 * Network replies stay in the manager because they share its client lifecycle.
 * This registry keeps interaction keys, lease validity and event projection
 * independent from session/message reduction.
 */
export class OpenCodeInteractionRegistry {
  private readonly pending = new Map<string, PendingOpenCodeInteraction>()

  constructor(private readonly emitEvent: (event: AgentClientEventPayload) => void) {}

  entries() {
    return this.pending.entries()
  }

  set(pending: PendingOpenCodeInteraction) {
    this.pending.set(
      getAgentInteractionKey(pending.sessionId, pending.requestId),
      pending,
    )
  }

  findResponse(
    response: AgentInteractionResponse,
    clientGeneration: number,
  ) {
    const matches = [...this.pending.entries()].filter(([, candidate]) => (
      candidate.ownerSessionId === response.sessionId
      && candidate.requestId === response.requestId
      && this.isCurrent(candidate, clientGeneration)
    ))
    return matches.length === 1 ? matches[0] : null
  }

  isCurrent(pending: PendingOpenCodeInteraction, clientGeneration: number) {
    return this.pending.get(
      getAgentInteractionKey(pending.sessionId, pending.requestId),
    ) === pending
      && pending.clientGeneration === clientGeneration
      && pending.lease.isCurrent()
  }

  resolve(interactionKey: string, resumeRun: boolean) {
    const pending = this.pending.get(interactionKey)
    if (!pending) return false
    this.pending.delete(interactionKey)
    this.emitEvent({
      type: 'interaction_resolved',
      requestId: pending.requestId,
      resumeRun,
      sessionId: pending.ownerSessionId,
    })
    return true
  }

  clear(predicate: (pending: PendingOpenCodeInteraction) => boolean) {
    for (const [interactionKey, pending] of this.pending) {
      if (!predicate(pending)) continue
      this.pending.delete(interactionKey)
      this.emitEvent({
        type: 'interaction_resolved',
        requestId: pending.requestId,
        resumeRun: false,
        sessionId: pending.ownerSessionId,
      })
    }
  }

  /**
   * Drops process-local state without emitting UI events. Used only during
   * manager disposal, matching the previous teardown behavior.
   */
  reset() {
    this.pending.clear()
  }

  projectEvent(
    event: OpenCodeEvent,
    properties: JsonRecord,
    binding: OpenCodeInteractionBinding,
    clientGeneration: number,
  ) {
    const sessionId = binding.sessionId
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
        this.resolve(getAgentInteractionKey(sessionId, requestId), true)
      }
      return true
    }

    if (event.type === 'permission.asked' || event.type === 'permission.v2.asked') {
      const requestId = String(properties.id ?? '')
      if (!requestId) return true
      const action = String(properties.permission ?? properties.action ?? 'operation')
      const resources = Array.isArray(properties.patterns)
        ? properties.patterns
        : Array.isArray(properties.resources)
          ? properties.resources
          : []
      this.set({
        clientGeneration,
        cwd: binding.cwd,
        kind: 'permission',
        lease: binding.ownerLease,
        ownerSessionId: binding.rootSessionId,
        protocol: event.type === 'permission.v2.asked' ? 'v2' : 'classic',
        requestId,
        sessionId,
      })
      this.emitEvent({
        type: 'interaction_requested',
        request: {
          agentId: 'opencode',
          id: requestId,
          kind: 'permission',
          message: resources.length > 0
            ? resources.map(String).join('\n')
            : `OpenCode 请求执行 ${action}`,
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
      return true
    }

    if (event.type === 'question.asked' || event.type === 'question.v2.asked') {
      const requestId = String(properties.id ?? '')
      const questions = Array.isArray(properties.questions)
        ? properties.questions as JsonRecord[]
        : []
      if (!requestId || questions.length === 0) return true
      const questionIds = questions.map((question, index) => (
        String(question.id ?? `answer-${index + 1}`)
      ))
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
      this.set({
        clientGeneration,
        cwd: binding.cwd,
        kind: 'question',
        lease: binding.ownerLease,
        ownerSessionId: binding.rootSessionId,
        protocol: event.type === 'question.v2.asked' ? 'v2' : 'classic',
        questionIds,
        requestId,
        sessionId,
      })
      this.emitEvent({
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
          title: questions.length === 1
            ? String(questions[0].header ?? 'OpenCode 提问')
            : 'OpenCode 提问',
          workspacePath: binding.cwd,
        },
      })
      return true
    }

    return false
  }
}

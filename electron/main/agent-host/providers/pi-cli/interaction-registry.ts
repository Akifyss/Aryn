import { randomUUID } from 'node:crypto'
import type {
  AgentClientEventPayload,
  AgentInteractionResponse,
} from '../../../../shared/agent-contracts/types'
import type { JsonLineProcess } from '../../../json-line-process'
import type { SessionRuntimeLease } from '../../runtime/session-runtime-coordinator'
import type { JsonRecord } from './session-model'
import type { PiCliRuntime } from './runtime'

type PiCliInteractionMethod = 'confirm' | 'editor' | 'input' | 'select'

export type PendingPiCliInteraction = {
  lease: SessionRuntimeLease
  method: PiCliInteractionMethod
  optionValues?: Record<string, string>
  process: JsonLineProcess
  requestId: string
  runtimeKey: string
  sessionId: string
}

function interactionKey(runtimeKey: string, requestId: string) {
  return `${runtimeKey}\0${requestId}`
}

function isInteractionMethod(value: unknown): value is PiCliInteractionMethod {
  return value === 'confirm' || value === 'editor' || value === 'input' || value === 'select'
}

/** Owns PI extension prompt identity, lease validation and UI projection. */
export class PiCliInteractionRegistry {
  private readonly pending = new Map<string, PendingPiCliInteraction>()

  constructor(private readonly emitEvent: (event: AgentClientEventPayload) => void) {}

  register(runtime: PiCliRuntime, message: JsonRecord) {
    if (!isInteractionMethod(message.method)) return false

    const method = message.method
    const requestId = String(message.id ?? randomUUID())
    const selectOptions = method === 'select' && Array.isArray(message.options)
      ? message.options.map(String)
      : []
    const optionValues = Object.fromEntries(
      selectOptions.map((option, index) => [`select:${index}`, option]),
    )
    this.pending.set(interactionKey(runtime.lease.key, requestId), {
      lease: runtime.lease,
      method,
      ...(selectOptions.length > 0 ? { optionValues } : {}),
      process: runtime.process,
      requestId,
      runtimeKey: runtime.lease.key,
      sessionId: runtime.record.id,
    })
    this.emitEvent({
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
        sessionId: runtime.record.id,
        title: String(message.title ?? (method === 'confirm' ? 'PI 请求执行工具' : 'PI 提问')),
        workspacePath: runtime.record.cwd,
      },
    })
    return true
  }

  respond(response: AgentInteractionResponse) {
    const matches = [...this.pending.entries()].filter(([, pending]) => (
      pending.sessionId === response.sessionId
      && pending.requestId === response.requestId
      && pending.lease.isCurrent()
    ))
    if (matches.length !== 1) return false

    const [key, pending] = matches[0]
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
    this.pending.delete(key)
    this.emitEvent({
      type: 'interaction_resolved',
      requestId: response.requestId,
      resumeRun: true,
      sessionId: pending.sessionId,
    })
    return true
  }

  clear(predicate: (pending: PendingPiCliInteraction) => boolean) {
    for (const [key, pending] of this.pending) {
      if (!predicate(pending)) continue
      this.pending.delete(key)
      this.emitEvent({
        type: 'interaction_resolved',
        requestId: pending.requestId,
        resumeRun: false,
        sessionId: pending.sessionId,
      })
    }
  }

  reset() {
    this.pending.clear()
  }
}

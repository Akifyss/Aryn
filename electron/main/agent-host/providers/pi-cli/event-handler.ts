import { randomUUID } from 'node:crypto'
import type { AgentClientEventPayload } from '../../../../shared/agent-contracts/types'
import {
  normalizeNullableString,
  summarizePiToolPayload as summarizeToolPayload,
  type JsonRecord,
} from './session-model'
import type { PiCliInteractionRegistry } from './interaction-registry'
import type { PiCliRuntime } from './runtime'

type PiCliEventHandlerOptions = {
  emitEvent: (event: AgentClientEventPayload) => void
  interactions: PiCliInteractionRegistry
  onAgentEnd: (runtime: PiCliRuntime) => Promise<void>
  onRuntimeStateChanged: (runtime: PiCliRuntime) => Promise<unknown>
}

/** Projects native PI RPC events without owning process or workspace lifetime. */
export async function handlePiCliEvent(
  runtime: PiCliRuntime,
  message: JsonRecord,
  options: PiCliEventHandlerOptions,
) {
  const type = String(message.type ?? '')
  const sessionId = runtime.record.id
  options.emitEvent({
    type: 'pi_native_event',
    event: message as { type: string; [key: string]: unknown },
    sessionId,
  })
  if (type === 'agent_start') {
    runtime.isStreaming = true
    options.emitEvent({ type: 'assistant_message_started', sessionId })
    return
  }
  if (type === 'message_start') {
    const messageValue = message.message && typeof message.message === 'object'
      ? message.message as JsonRecord
      : null
    if (messageValue && String(messageValue.role ?? '') === 'assistant') {
      options.emitEvent({ type: 'assistant_message_started', sessionId })
    }
    return
  }
  if (type === 'message_update') {
    const event = message.assistantMessageEvent
    if (!event || typeof event !== 'object') return
    const update = event as JsonRecord
    if (update.type === 'text_delta' && typeof update.delta === 'string') {
      options.emitEvent({ type: 'assistant_message_delta', delta: update.delta, sessionId })
    } else if (update.type === 'thinking_delta' && typeof update.delta === 'string') {
      options.emitEvent({ type: 'assistant_thinking_delta', delta: update.delta, sessionId })
    } else if (update.type === 'thinking_end') {
      options.emitEvent({ type: 'assistant_thinking_finished', sessionId })
    }
    return
  }
  if (type === 'tool_execution_start' || type === 'tool_execution_update' || type === 'tool_execution_end') {
    const toolCallId = String(message.toolCallId ?? randomUUID())
    const toolName = String(message.toolName ?? 'tool')
    if (type === 'tool_execution_end') {
      options.emitEvent({
        type: 'tool_execution_finished',
        isError: message.isError === true,
        sessionId,
        summary: summarizeToolPayload(message, 'result'),
        toolCallId,
        toolName,
      })
    } else {
      options.emitEvent({
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
    const messageValue = message.message && typeof message.message === 'object'
      ? message.message as JsonRecord
      : null
    const errorMessage = messageValue && String(messageValue.role ?? '') === 'assistant'
      ? normalizeNullableString(messageValue.errorMessage)
      : null
    if (errorMessage) options.emitEvent({ type: 'error', message: errorMessage, sessionId })
    return
  }
  if (type === 'agent_end') {
    runtime.isStreaming = false
    await options.onAgentEnd(runtime)
    return
  }
  if (type === 'queue_update') {
    runtime.state.steering = Array.isArray(message.steering) ? message.steering.map(String) : []
    runtime.state.followUp = Array.isArray(message.followUp) ? message.followUp.map(String) : []
    runtime.state.pendingMessageCount = (runtime.state.steering as string[]).length
      + (runtime.state.followUp as string[]).length
    await options.onRuntimeStateChanged(runtime)
    return
  }
  if (type === 'compaction_start') {
    runtime.state.isCompacting = true
    runtime.state.compactionReason = message.reason
    await options.onRuntimeStateChanged(runtime)
    return
  }
  if (type === 'compaction_end') {
    runtime.state.isCompacting = false
    runtime.state.compactionReason = null
    await options.onRuntimeStateChanged(runtime)
    return
  }
  if (type === 'auto_retry_start') {
    runtime.state.retryAttempt = typeof message.attempt === 'number' ? message.attempt : 0
    runtime.state.retryMaxAttempts = typeof message.maxAttempts === 'number' ? message.maxAttempts : null
    await options.onRuntimeStateChanged(runtime)
    return
  }
  if (type === 'auto_retry_end') {
    runtime.state.retryAttempt = 0
    runtime.state.retryMaxAttempts = null
    await options.onRuntimeStateChanged(runtime)
    return
  }
  if (type === 'extension_ui_request' && options.interactions.register(runtime, message)) return
  if (type === 'extension_error' || type === 'protocol_error') {
    options.emitEvent({
      type: 'error',
      message: String(message.error ?? message.message ?? 'PI extension failed.'),
      sessionId,
    })
  }
}

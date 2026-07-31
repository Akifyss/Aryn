import type {
  Event as OpenCodeEvent,
  Message,
  SnapshotFileDiff,
  Session,
} from '@opencode-ai/sdk/v2'
import type { AgentClientEventPayload } from '../../../../shared/agent-contracts/types'
import {
  formatOpenCodeError as formatError,
  normalizeOpenCodeExecutionState as normalizeExecutionState,
} from './session-model'
import type { OpenCodeInteractionRegistry } from './interaction-registry'
import type { OpenCodeSessionMessageReducer } from './session-reducer'
import type { OpenCodeSessionBinding } from './runtime'

type OpenCodeEventProjectorOptions = {
  emitEvent: (event: AgentClientEventPayload) => void
  emitSessionSnapshot: (binding: OpenCodeSessionBinding) => void
  interactionRegistry: OpenCodeInteractionRegistry
  isCurrent: (binding: OpenCodeSessionBinding) => boolean
  messageReducer: OpenCodeSessionMessageReducer
  onSessionDeleted: (binding: OpenCodeSessionBinding) => Promise<void>
  onWorkspaceStateChanged: (binding: OpenCodeSessionBinding) => Promise<unknown>
  scheduleSessionSnapshot: (binding: OpenCodeSessionBinding) => void
  sessionDiffs: Map<string, SnapshotFileDiff[]>
}

/** Applies one already-routed OpenCode event to its native session projection. */
export async function applyOpenCodeSessionEvent(
  binding: OpenCodeSessionBinding,
  event: OpenCodeEvent,
  properties: Record<string, unknown>,
  clientGeneration: number,
  options: OpenCodeEventProjectorOptions,
) {
  if (!options.isCurrent(binding)) return
  const sessionId = binding.sessionId

  options.emitEvent({
    type: 'opencode_native_event',
    event,
    workspacePath: binding.cwd,
  })
  if (!options.isCurrent(binding)) return

  if (event.type === 'session.created' || event.type === 'session.updated') {
    const info = properties.info as Session | undefined
    if (info?.id === sessionId) binding.title = info.title?.trim() || null
    await options.onWorkspaceStateChanged(binding)
    return
  }

  if (event.type === 'session.deleted') {
    await options.onSessionDeleted(binding)
    return
  }

  if (
    event.type === 'message.updated'
    || event.type === 'message.removed'
    || event.type === 'message.part.updated'
    || event.type === 'message.part.removed'
    || event.type === 'message.part.delta'
  ) {
    const reduction = options.messageReducer.apply(event)
    if (event.type === 'message.updated') {
      const info = properties.info as Message | undefined
      if (info?.role === 'assistant') {
        binding.lastAssistantMessageId = info.id
        if (!info.time.completed && !info.error) {
          binding.executionState = { type: 'busy' }
          binding.isStreaming = true
        }
      }
    }
    // An out-of-order part remains buffered until its baseline arrives. A
    // concurrent REST hydration could otherwise overwrite newer SSE content.
    if (reduction.awaitingBaseline) return
    if (reduction.changed) {
      if (event.type === 'message.part.delta') options.scheduleSessionSnapshot(binding)
      else options.emitSessionSnapshot(binding)
    }
    return
  }

  if (event.type === 'session.diff') {
    const diffs = Array.isArray(properties.diff) ? properties.diff as SnapshotFileDiff[] : []
    options.sessionDiffs.set(sessionId, diffs)
    options.emitSessionSnapshot(binding)
    return
  }

  if (event.type === 'session.status' || event.type === 'session.idle') {
    binding.executionState = event.type === 'session.idle'
      ? { type: 'idle' }
      : normalizeExecutionState(properties.status)
    binding.isStreaming = binding.executionState.type !== 'idle'
    if (binding.isStreaming) options.emitSessionSnapshot(binding)
    else await options.onWorkspaceStateChanged(binding)
    return
  }

  if (event.type === 'session.error') {
    binding.executionState = { type: 'idle' }
    binding.isStreaming = false
    options.emitEvent({
      type: 'error',
      message: formatError(properties.error ?? 'OpenCode session failed.'),
      sessionId,
    })
    await options.onWorkspaceStateChanged(binding)
    return
  }

  options.interactionRegistry.projectEvent(event, properties, binding, clientGeneration)
}

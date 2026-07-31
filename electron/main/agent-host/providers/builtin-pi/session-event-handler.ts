import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type {
  AgentSession,
  AgentSessionEvent,
} from '@earendil-works/pi-coding-agent'
import type { AgentClientEventPayload } from '../../../../shared/agent-contracts/types'
import { AgentSessionAnnotationStore } from '../../sessions/annotations'
import {
  extractExplicitBashFileChanges,
  extractWritableToolFilePath,
  resolveDirectToolFileChangeKind,
} from '../../sessions/file-change-extractor'
import { pathExists } from './file-system'
import type { BuiltinPiSessionRuntime } from './runtime'
import { summarizeToolPayload } from './session-presentation'

type BuiltinPiSessionEventHandlerOptions = {
  annotationStore: AgentSessionAnnotationStore
  emitEvent: (event: AgentClientEventPayload) => void
  onTurnEnded: (session: AgentSession) => void
  onWorkspaceStateChanged: (cwd: string) => Promise<unknown>
}

/** Projects embedded PI events while the manager retains session ownership. */
export async function handleBuiltinPiSessionEvent(
  runtime: BuiltinPiSessionRuntime,
  event: AgentSessionEvent,
  options: BuiltinPiSessionEventHandlerOptions,
) {
  const { session } = runtime
  options.emitEvent({
    type: 'pi_native_event',
    event: event as unknown as { type: string; [key: string]: unknown },
    sessionId: session.sessionId,
  })

  if (event.type === 'compaction_start') runtime.status.compactionReason = event.reason
  if (event.type === 'compaction_end') runtime.status.compactionReason = null
  if (event.type === 'auto_retry_start') runtime.status.retryMaxAttempts = event.maxAttempts
  if (event.type === 'auto_retry_end') runtime.status.retryMaxAttempts = null

  if (event.type === 'message_start' && 'role' in event.message && event.message.role === 'assistant') {
    runtime.activity.pendingAssistantEntryId = null
    options.emitEvent({ type: 'assistant_message_started', sessionId: session.sessionId })
    return
  }
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    options.emitEvent({
      type: 'assistant_message_delta',
      delta: event.assistantMessageEvent.delta,
      sessionId: session.sessionId,
    })
    return
  }
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
    options.emitEvent({
      type: 'assistant_thinking_delta',
      delta: event.assistantMessageEvent.delta,
      sessionId: session.sessionId,
    })
    return
  }
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_end') {
    options.emitEvent({ type: 'assistant_thinking_finished', sessionId: session.sessionId })
    return
  }
  if (event.type === 'tool_execution_start') {
    const ownerEntryId = findLatestAssistantEntryId(session)
      ?? runtime.activity.pendingAssistantEntryId
    const directFilePath = extractWritableToolFilePath(runtime.cwd, event.toolName, event.args)
    const existedBeforeWrite = event.toolName === 'write' && directFilePath
      ? await pathExists(directFilePath)
      : null
    runtime.activity.runningToolCalls.set(event.toolCallId, {
      existedBeforeWrite,
      filePath: directFilePath,
      ownerEntryId,
      parsedFileChanges: event.toolName === 'bash'
        ? extractExplicitBashFileChanges(runtime.cwd, event.args)
        : [],
      toolName: event.toolName,
    })
    options.emitEvent({
      type: 'tool_execution_started',
      sessionId: session.sessionId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      summary: summarizeToolPayload(event.args, 240, 'Running tool...'),
    })
    return
  }
  if (event.type === 'tool_execution_update') {
    options.emitEvent({
      type: 'tool_execution_updated',
      sessionId: session.sessionId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      summary: summarizeToolPayload(
        event.partialResult?.content ?? event.partialResult?.details ?? event.partialResult,
        320,
        `${event.toolName} is running...`,
      ),
    })
    return
  }
  if (event.type === 'tool_execution_end') {
    const finishedTool = runtime.activity.runningToolCalls.get(event.toolCallId) ?? null
    runtime.activity.runningToolCalls.delete(event.toolCallId)
    if (
      finishedTool
      && !event.isError
      && session.sessionFile
      && finishedTool.ownerEntryId
    ) {
      const nextFileChanges = [...finishedTool.parsedFileChanges]
      if (finishedTool.filePath) {
        const directChangeKind = resolveDirectToolFileChangeKind(
          finishedTool.toolName,
          finishedTool.existedBeforeWrite,
        )
        if (directChangeKind) {
          nextFileChanges.push({ filePath: finishedTool.filePath, kind: directChangeKind })
        }
      }
      let nextAnnotations = null
      for (const change of nextFileChanges) {
        nextAnnotations = await options.annotationStore.recordFileChange(
          session.sessionFile,
          finishedTool.ownerEntryId,
          change,
        )
      }
      if (nextAnnotations) {
        options.emitEvent({
          type: 'session_annotations_updated',
          sessionId: session.sessionId,
          annotations: nextAnnotations,
        })
      }
    }
    options.emitEvent({
      type: 'tool_execution_finished',
      sessionId: session.sessionId,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      summary: summarizeToolPayload(
        event.result?.content ?? event.result?.details ?? event.result,
        320,
        `${event.toolName} finished.`,
      ),
      isError: event.isError,
    })
    return
  }

  if (event.type === 'message_end' && 'role' in event.message && event.message.role === 'assistant') {
    runtime.activity.pendingAssistantEntryId = findEntryIdForMessage(session, event.message)
  }
  if (
    event.type === 'compaction_start'
    || event.type === 'compaction_end'
    || event.type === 'auto_retry_start'
    || event.type === 'auto_retry_end'
    || event.type === 'agent_start'
    || event.type === 'turn_start'
    || event.type === 'turn_end'
    || event.type === 'thinking_level_changed'
  ) {
    await options.onWorkspaceStateChanged(runtime.cwd)
    if (event.type === 'turn_end') options.onTurnEnded(session)
    return
  }
  if (event.type === 'message_end' || event.type === 'agent_end') {
    await options.onWorkspaceStateChanged(runtime.cwd)
  }
}

function findEntryIdForMessage(session: AgentSession, message: AgentMessage) {
  const branch = session.sessionManager.getBranch()
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (entry?.type !== 'message') continue
    if (entry.message === message) return entry.id
    if (
      'role' in entry.message
      && 'role' in message
      && entry.message.role === message.role
      && 'timestamp' in entry.message
      && 'timestamp' in message
      && entry.message.timestamp === message.timestamp
    ) return entry.id
  }
  return null
}

function findLatestAssistantEntryId(session: AgentSession) {
  const branch = session.sessionManager.getBranch()
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (
      entry?.type === 'message'
      && 'role' in entry.message
      && entry.message.role === 'assistant'
    ) return entry.id
  }
  return null
}

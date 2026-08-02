import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import {
  getRuntimeDefaultModelDraft,
  getRuntimeSelectedModelDraft,
  normalizeAgentModelDraft,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import {
  shouldApplyAgentWorkspaceState,
  type AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import {
  getAgentSessionActivityKey,
  normalizeAgentProjectPath,
} from '@/features/agent/lib/session-tree'
import {
  EMPTY_AGENT_LIVE_STREAM_STATE,
  reduceAgentLiveStreamState,
  type AgentLiveStreamState,
} from '@/features/agent/runtime/agent-live-stream-state'
import {
  getAgentInteractionKey,
  getAgentInteractionResolution,
  type AgentClientEvent,
  type AgentInteractionRequest,
  type AgentInteractionResponse,
  type AgentInteractionTimelineRecord,
  type AgentSessionAnnotations,
  type AgentSessionListItem,
  type AgentSessionSnapshot,
  type AgentWorkspaceState,
} from '@/features/agent/types'

export type { AgentLiveToolState } from '@/features/agent/runtime/agent-live-stream-state'

const MAX_INTERACTION_TIMELINE_RECORDS = 200

function getInteractionRecordKey(record: AgentInteractionTimelineRecord) {
  return `${record.request.agentId}\n${getAgentInteractionKey(record.request.sessionId, record.request.id)}`
}

function keepRecentInteractionRecords(records: AgentInteractionTimelineRecord[]) {
  return records.length <= MAX_INTERACTION_TIMELINE_RECORDS
    ? records
    : records.slice(records.length - MAX_INTERACTION_TIMELINE_RECORDS)
}

export function mergeInteractionTimelineRecords(
  currentRecords: AgentInteractionTimelineRecord[],
  incomingRecords: AgentInteractionTimelineRecord[],
) {
  const recordsByKey = new Map<string, AgentInteractionTimelineRecord>()
  for (const record of [...currentRecords, ...incomingRecords]) {
    const key = getInteractionRecordKey(record)
    const existing = recordsByKey.get(key)
    if (!existing) {
      recordsByKey.set(key, record)
      continue
    }
    const existingTerminal = existing.status !== 'pending'
    const recordTerminal = record.status !== 'pending'
    if (existingTerminal && !recordTerminal) continue
    if (!existingTerminal && recordTerminal) {
      recordsByKey.set(key, record)
      continue
    }
    if ((record.resolvedAt ?? record.requestedAt) >= (existing.resolvedAt ?? existing.requestedAt)) {
      recordsByKey.set(key, record)
    }
  }
  return keepRecentInteractionRecords(
    [...recordsByKey.values()].sort((left, right) => left.requestedAt - right.requestedAt),
  )
}

type AgentInteractionResolutionEvent = Extract<
  AgentClientEvent,
  { type: 'interaction_resolved' }
>

export function resolveInteractionTimelineRecords(
  currentRecords: AgentInteractionTimelineRecord[],
  event: AgentInteractionResolutionEvent,
  resolvedAt = event.resolvedAt ?? Date.now(),
) {
  return currentRecords.map((record) => {
    const matches = record.request.agentId === event.agentId
      && getAgentInteractionKey(record.request.sessionId, record.request.id)
        === getAgentInteractionKey(event.sessionId, event.requestId)
    if (!matches) return record

    const response = event.response ?? record.response
    const resolution = getAgentInteractionResolution(record.request, response, event.resumeRun)
    return {
      ...record,
      ...(response ? { response } : {}),
      resolvedAt: record.resolvedAt ?? resolvedAt,
      ...resolution,
    }
  })
}

type UseAgentRuntimeEventsOptions = {
  activeRuntimeSessionRef: RefObject<AgentWorkspaceState['activeSession']>
  activeSessionSelectionRef: RefObject<AgentSessionSelection>
  agentState: AgentWorkspaceState
  closeComposerMenu: () => void
  newSessionModelDraftRef: RefObject<AgentModelDraft>
  selectedAgentId: AgentId
  selectedAgentIdRef: RefObject<AgentId>
  setAgentState: Dispatch<SetStateAction<AgentWorkspaceState>>
  setPanelError: Dispatch<SetStateAction<string | null>>
  setViewedSessionSnapshot: Dispatch<SetStateAction<AgentSessionSnapshot | null>>
  storeProjectAgentSessions: (
    targetWorkspacePath: string,
    agentId: AgentId,
    sessions: AgentSessionListItem[],
  ) => void
  syncModelDraft: (draft: AgentModelDraft) => void
  syncNewSessionModelDraft: (draft: AgentModelDraft) => void
  workspacePath: string | null
  workspacePathRef: RefObject<string | null>
}

function mergeSessionAnnotationsState(
  state: AgentWorkspaceState,
  sessionId: string,
  annotations: AgentSessionAnnotations,
) {
  if (!state.activeSession || state.activeSession.sessionId !== sessionId) {
    return state
  }

  return {
    ...state,
    activeSession: {
      ...state.activeSession,
      annotations: {
        fileChangesByEntryId: {
          ...state.activeSession.annotations.fileChangesByEntryId,
          ...annotations.fileChangesByEntryId,
        },
      },
    },
  }
}

export function useAgentRuntimeEvents({
  activeRuntimeSessionRef,
  activeSessionSelectionRef,
  agentState,
  closeComposerMenu,
  newSessionModelDraftRef,
  selectedAgentId,
  selectedAgentIdRef,
  setAgentState,
  setPanelError,
  setViewedSessionSnapshot,
  storeProjectAgentSessions,
  syncModelDraft,
  syncNewSessionModelDraft,
  workspacePath,
  workspacePathRef,
}: UseAgentRuntimeEventsOptions) {
  const [liveStream, setLiveStream] = useState<AgentLiveStreamState>(EMPTY_AGENT_LIVE_STREAM_STATE)
  const [pendingInteractions, setPendingInteractions] = useState<AgentInteractionRequest[]>([])
  const [interactionTimelineRecords, setInteractionTimelineRecords] = useState<AgentInteractionTimelineRecord[]>([])
  const [sessionActivityById, setSessionActivityById] = useState<Record<string, 'running' | 'waiting'>>({})
  const sessionPathByIdRef = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const persisted = agentState.activeSession?.interactionHistory
    if (!persisted?.length) return
    setInteractionTimelineRecords((current) => mergeInteractionTimelineRecords(current, persisted))
  }, [agentState.activeSession?.interactionHistory])

  const updateSessionActivity = useCallback((
    agentId: AgentId,
    sessionKeys: Array<string | null | undefined>,
    activity: 'running' | 'waiting' | null,
    forceClear = false,
  ) => {
    const keys = Array.from(new Set(
      sessionKeys
        .filter((key): key is string => Boolean(key))
        .map((key) => getAgentSessionActivityKey(agentId, key)),
    ))
    if (keys.length === 0) return
    setSessionActivityById((current) => {
      const next = { ...current }
      for (const key of keys) {
        if (activity) next[key] = activity
        else if (forceClear || next[key] !== 'waiting') delete next[key]
      }
      return next
    })
  }, [])

  const clearAssistantDraft = useCallback(() => {
    setLiveStream((current) => ({ ...current, assistantText: '' }))
  }, [])

  const clearLiveTools = useCallback(() => {
    setLiveStream((current) => ({ ...current, tools: [] }))
  }, [])

  const resetRunDrafts = useCallback(() => {
    setLiveStream(EMPTY_AGENT_LIVE_STREAM_STATE)
  }, [])

  useEffect(() => {
    const unsubscribe = window.appApi.onAgentEvent((event: AgentClientEvent) => {
      if (event.type === 'assistant_message_started') {
        updateSessionActivity(event.agentId, [
          event.sessionId,
          sessionPathByIdRef.current.get(getAgentSessionActivityKey(event.agentId, event.sessionId)),
        ], 'running')
      } else if (event.type === 'assistant_thinking_finished') {
        updateSessionActivity(event.agentId, [
          event.sessionId,
          event.sessionId
            ? sessionPathByIdRef.current.get(getAgentSessionActivityKey(event.agentId, event.sessionId))
            : null,
        ], null)
      } else if (event.type === 'error') {
        updateSessionActivity(event.agentId, [
          event.sessionId,
          event.sessionId
            ? sessionPathByIdRef.current.get(getAgentSessionActivityKey(event.agentId, event.sessionId))
            : null,
        ], null, true)
      }

      if (event.type === 'interaction_requested') {
        setPendingInteractions((currentRequests) => [
          ...currentRequests.filter((request) => !(
            request.agentId === event.agentId
            && getAgentInteractionKey(request.sessionId, request.id) === getAgentInteractionKey(event.request.sessionId, event.request.id)
          )),
          event.request,
        ])
        setInteractionTimelineRecords((currentRecords) => {
          const nextRecord: AgentInteractionTimelineRecord = {
            request: event.request,
            requestedAt: event.requestedAt ?? Date.now(),
            status: 'pending',
          }
          const nextKey = getInteractionRecordKey(nextRecord)
          const existing = currentRecords.find((record) => getInteractionRecordKey(record) === nextKey)
          return keepRecentInteractionRecords([
            ...currentRecords.filter((record) => getInteractionRecordKey(record) !== nextKey),
            existing
              ? { ...existing, request: event.request, status: 'pending', resolvedAt: undefined, response: undefined }
              : nextRecord,
          ])
        })
        updateSessionActivity(event.agentId, [event.request.sessionId], 'waiting')
        return
      }

      if (event.type === 'interaction_resolved') {
        setPendingInteractions((currentRequests) => currentRequests.filter((request) => !(
          request.agentId === event.agentId
          && getAgentInteractionKey(request.sessionId, request.id) === getAgentInteractionKey(event.sessionId, event.requestId)
        )))
        setInteractionTimelineRecords((currentRecords) => (
          resolveInteractionTimelineRecords(currentRecords, event, event.resolvedAt)
        ))
        updateSessionActivity(event.agentId, [event.sessionId], event.resumeRun ? 'running' : null, !event.resumeRun)
        return
      }

      if (event.type === 'session_snapshot_updated') {
        const isRunning = event.executionState.type !== 'idle'
        updateSessionActivity(event.agentId, [
          event.sessionId,
          event.session.sessionPath,
        ], isRunning ? 'running' : null, !isRunning)
        if (event.agentId !== selectedAgentIdRef.current) return
        const expectedWorkspacePath = workspacePathRef.current
        if (
          !expectedWorkspacePath
          || normalizeAgentProjectPath(event.session.workspacePath) !== normalizeAgentProjectPath(expectedWorkspacePath)
        ) {
          return
        }
        const currentSelection = activeSessionSelectionRef.current
        if (
          currentSelection.kind !== 'session'
          || currentSelection.agentId !== event.agentId
          || currentSelection.sessionPath !== event.session.sessionPath
        ) {
          return
        }
        if (activeRuntimeSessionRef.current?.sessionPath !== event.session.sessionPath) return
        activeRuntimeSessionRef.current = event.session
        setAgentState((currentState) => {
          if (
            currentState.runtime.agentId !== event.agentId
            || currentState.activeSession?.sessionPath !== event.session.sessionPath
          ) {
            return currentState
          }
          return {
            ...currentState,
            activeSession: event.session,
            runtime: {
              ...currentState.runtime,
              executionState: event.executionState,
              isStreaming: isRunning,
            },
          }
        })
        setViewedSessionSnapshot(null)
        resetRunDrafts()
        return
      }

      if (event.type === 'workspace_state') {
        if (event.state.runtime.workspacePath) {
          storeProjectAgentSessions(
            event.state.runtime.workspacePath,
            event.agentId,
            event.state.sessions,
          )
        }
        if (event.state.activeSession?.sessionId && event.state.activeSession.sessionPath) {
          sessionPathByIdRef.current.set(
            getAgentSessionActivityKey(event.agentId, event.state.activeSession.sessionId),
            event.state.activeSession.sessionPath,
          )
        }
        updateSessionActivity(event.agentId, [
          event.state.activeSession?.sessionId,
          event.state.activeSession?.sessionPath,
        ], event.state.runtime.isStreaming ? 'running' : null)
        if (event.state.runtime.agentId !== selectedAgentIdRef.current) {
          return
        }
        const eventWorkspacePath = event.state.runtime.workspacePath
        const expectedWorkspacePath = workspacePathRef.current
        if (
          !expectedWorkspacePath
          || !eventWorkspacePath
          || normalizeAgentProjectPath(eventWorkspacePath) !== normalizeAgentProjectPath(expectedWorkspacePath)
        ) {
          return
        }

        const nextSessionPath = event.state.activeSession?.sessionPath ?? null
        const currentSelection = activeSessionSelectionRef.current
        const isViewingEventRuntimeSession = currentSelection.kind === 'session'
          && currentSelection.agentId === event.agentId
          && currentSelection.sessionPath === nextSessionPath
        const shouldApplyFullState = shouldApplyAgentWorkspaceState(currentSelection, event.agentId, nextSessionPath)

        if (!shouldApplyFullState) {
          setAgentState((currentState) => ({
            ...currentState,
            sessions: event.state.sessions,
          }))
          return
        }

        activeRuntimeSessionRef.current = event.state.activeSession
        setAgentState(event.state)

        if (isViewingEventRuntimeSession) {
          setViewedSessionSnapshot(null)
          syncModelDraft(getRuntimeSelectedModelDraft(event.state.runtime))
        } else if (currentSelection.kind === 'new') {
          const currentDraft = newSessionModelDraftRef.current
          const defaultDraft = getRuntimeDefaultModelDraft(event.state.runtime)
          const nextDraft = normalizeAgentModelDraft(currentDraft.provider || currentDraft.modelId
            ? currentDraft
            : defaultDraft, event.state.runtime, defaultDraft)
          syncNewSessionModelDraft(nextDraft)
          syncModelDraft(nextDraft)
        }
        setLiveStream((current) => {
          const persistedToolIds = new Set(
            (event.state.activeSession?.messages ?? [])
              .filter((message) => message.kind === 'tool')
              .map((message) => message.id),
          )
          return {
            assistantText: '',
            thinkingText: '',
            isThinkingStreaming: false,
            startedAt: null,
            tools: current.tools.filter((tool) => tool.status === 'running' || !persistedToolIds.has(tool.id)),
          }
        })
        closeComposerMenu()
        return
      }

      if (event.agentId !== selectedAgentIdRef.current) return

      if (event.type === 'session_annotations_updated') {
        setAgentState((currentState) => mergeSessionAnnotationsState(currentState, event.sessionId, event.annotations))
        return
      }

      if (
        event.type === 'assistant_message_started'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        updateSessionActivity(event.agentId, [event.sessionId, activeRuntimeSessionRef.current?.sessionPath], 'running')
        setLiveStream((current) => reduceAgentLiveStreamState(current, event))
        return
      }

      if (
        event.type === 'assistant_thinking_delta'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveStream((current) => reduceAgentLiveStreamState(current, event))
        return
      }

      if (
        event.type === 'assistant_thinking_finished'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        updateSessionActivity(event.agentId, [event.sessionId, activeRuntimeSessionRef.current?.sessionPath], null)
        setLiveStream((current) => reduceAgentLiveStreamState(current, event))
        return
      }

      if (
        event.type === 'assistant_message_delta'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveStream((current) => reduceAgentLiveStreamState(current, event))
        return
      }

      if (
        event.type === 'tool_execution_started'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveStream((current) => reduceAgentLiveStreamState(current, event))
        return
      }

      if (
        event.type === 'tool_execution_updated'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveStream((current) => reduceAgentLiveStreamState(current, event))
        return
      }

      if (
        event.type === 'tool_execution_finished'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveStream((current) => reduceAgentLiveStreamState(current, event))
        return
      }

      if (
        event.type === 'error'
        && activeSessionSelectionRef.current.kind === 'session'
        && activeSessionSelectionRef.current.sessionPath === activeRuntimeSessionRef.current?.sessionPath
        && (!event.sessionId || event.sessionId === activeRuntimeSessionRef.current?.sessionId)
      ) {
        updateSessionActivity(event.agentId, [event.sessionId, activeRuntimeSessionRef.current?.sessionPath], null)
        setPanelError(event.message)
      }
    })

    return unsubscribe
  }, [agentState.activeSession?.sessionId, agentState.activeSession?.sessionPath, selectedAgentId, storeProjectAgentSessions, updateSessionActivity, workspacePath])

  const recordInteractionResponse = useCallback((
    request: AgentInteractionRequest,
    response: AgentInteractionResponse,
  ) => {
    const requestKey = `${request.agentId}\n${getAgentInteractionKey(request.sessionId, request.id)}`
    setInteractionTimelineRecords((currentRecords) => {
      const existing = currentRecords.find((record) => getInteractionRecordKey(record) === requestKey)
      const nextRecord: AgentInteractionTimelineRecord = {
        request,
        requestedAt: existing?.requestedAt ?? Date.now(),
        resolvedAt: Date.now(),
        response,
        ...getAgentInteractionResolution(request, response, true),
      }
      return keepRecentInteractionRecords([
        ...currentRecords.filter((record) => getInteractionRecordKey(record) !== requestKey),
        nextRecord,
      ])
    })
  }, [])

  return {
    clearAssistantDraft,
    clearLiveTools,
    draftAssistant: liveStream.assistantText,
    draftThinking: liveStream.thinkingText,
    isThinkingStreaming: liveStream.isThinkingStreaming,
    interactionTimelineRecords,
    liveTools: liveStream.tools,
    pendingInteractions,
    recordInteractionResponse,
    resetRunDrafts,
    sessionActivityById,
    streamStartedAt: liveStream.startedAt,
    setPendingInteractions,
  }
}

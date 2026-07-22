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
  getAgentInteractionKey,
  type AgentClientEvent,
  type AgentInteractionRequest,
  type AgentSessionAnnotations,
  type AgentSessionListItem,
  type AgentSessionSnapshot,
  type AgentSidebarMessageStatus,
  type AgentWorkspaceState,
} from '@/features/agent/types'

export type AgentLiveToolState = {
  id: string
  name: string
  status: AgentSidebarMessageStatus
  summary: string
  isError?: boolean
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
  const [draftAssistant, setDraftAssistant] = useState('')
  const [draftThinking, setDraftThinking] = useState('')
  const [isThinkingStreaming, setIsThinkingStreaming] = useState(false)
  const [liveTools, setLiveTools] = useState<AgentLiveToolState[]>([])
  const [pendingInteractions, setPendingInteractions] = useState<AgentInteractionRequest[]>([])
  const [sessionActivityById, setSessionActivityById] = useState<Record<string, 'running' | 'waiting'>>({})
  const sessionPathByIdRef = useRef<Map<string, string>>(new Map())

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
    setDraftAssistant('')
  }, [])

  const clearLiveTools = useCallback(() => {
    setLiveTools([])
  }, [])

  const resetRunDrafts = useCallback(() => {
    setDraftAssistant('')
    setDraftThinking('')
    setIsThinkingStreaming(false)
    setLiveTools([])
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
        updateSessionActivity(event.agentId, [event.request.sessionId], 'waiting')
        return
      }

      if (event.type === 'interaction_resolved') {
        setPendingInteractions((currentRequests) => currentRequests.filter((request) => !(
          request.agentId === event.agentId
          && getAgentInteractionKey(request.sessionId, request.id) === getAgentInteractionKey(event.sessionId, event.requestId)
        )))
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
        setDraftAssistant('')
        setDraftThinking('')
        setIsThinkingStreaming(false)
        setLiveTools((currentTools) => {
          const persistedToolIds = new Set(
            (event.state.activeSession?.messages ?? [])
              .filter((message) => message.kind === 'tool')
              .map((message) => message.id),
          )

          return currentTools.filter((tool) => tool.status === 'running' || !persistedToolIds.has(tool.id))
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
        setDraftAssistant('')
        setDraftThinking('')
        setIsThinkingStreaming(false)
        return
      }

      if (
        event.type === 'assistant_thinking_delta'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setIsThinkingStreaming(true)
        setDraftThinking((currentValue) => currentValue + event.delta)
        return
      }

      if (
        event.type === 'assistant_thinking_finished'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        updateSessionActivity(event.agentId, [event.sessionId, activeRuntimeSessionRef.current?.sessionPath], null)
        setIsThinkingStreaming(false)
        return
      }

      if (
        event.type === 'assistant_message_delta'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setDraftAssistant((currentValue) => currentValue + event.delta)
        return
      }

      if (
        event.type === 'tool_execution_started'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveTools((currentTools) => [
          ...currentTools.filter((tool) => tool.id !== event.toolCallId),
          {
            id: event.toolCallId,
            name: event.toolName,
            status: 'running',
            summary: event.summary,
          },
        ])
        return
      }

      if (
        event.type === 'tool_execution_updated'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveTools((currentTools) => {
          const existingTool = currentTools.find((tool) => tool.id === event.toolCallId)

          if (!existingTool) {
            return [
              ...currentTools,
              {
                id: event.toolCallId,
                name: event.toolName,
                status: 'running',
                summary: event.summary,
              },
            ]
          }

          return currentTools.map((tool) => {
            if (tool.id !== event.toolCallId) {
              return tool
            }

            return {
              ...tool,
              status: 'running',
              summary: event.summary,
            }
          })
        })
        return
      }

      if (
        event.type === 'tool_execution_finished'
        && event.sessionId === activeRuntimeSessionRef.current?.sessionId
      ) {
        setLiveTools((currentTools) => {
          const existingTool = currentTools.find((tool) => tool.id === event.toolCallId)

          if (!existingTool) {
            return [
              ...currentTools,
              {
                id: event.toolCallId,
                isError: event.isError,
                name: event.toolName,
                status: event.isError ? 'error' : 'done',
                summary: event.summary,
              },
            ]
          }

          return currentTools.map((tool) => {
            if (tool.id !== event.toolCallId) {
              return tool
            }

            return {
              ...tool,
              isError: event.isError,
              status: event.isError ? 'error' : 'done',
              summary: event.summary,
            }
          })
        })
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

  return {
    clearAssistantDraft,
    clearLiveTools,
    draftAssistant,
    draftThinking,
    isThinkingStreaming,
    liveTools,
    pendingInteractions,
    resetRunDrafts,
    sessionActivityById,
    setPendingInteractions,
  }
}

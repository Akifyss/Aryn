import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
} from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import {
  getRuntimeDefaultModelDraft,
  getRuntimeSelectedModelDraft,
  normalizeAgentModelDraft,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import {
  shouldApplyAgentSessionOperationResult,
  type AgentProjectSessionRequest,
  type AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'
import type {
  AgentSessionSnapshot,
  AgentWorkspaceState,
} from '@/features/agent/types'
import type { ProjectState } from '@/features/workspace/types'

type UseAgentSessionNavigationOptions = {
  externalRequest: {
    hasLoadedWorkspaceState: boolean
    isLoading: boolean
    onExternalSessionRequestHandled?: (requestId: number) => void
    projectState: ProjectState
    request?: AgentProjectSessionRequest | null
  }
  model: {
    newSessionModelDraftRef: RefObject<AgentModelDraft>
    syncModelDraft: (draft: AgentModelDraft) => void
    syncNewSessionModelDraft: (draft: AgentModelDraft) => void
  }
  navigation: {
    activeRuntimeSessionRef: RefObject<AgentWorkspaceState['activeSession']>
    activeSessionSelectionRef: RefObject<AgentSessionSelection>
    selectedAgentId: AgentId
    selectedAgentIdRef: RefObject<AgentId>
    setSelectedAgentIdValue: Dispatch<SetStateAction<AgentId>>
    syncActiveSessionSelection: (selection: AgentSessionSelection) => void
    workspacePath: string | null
    workspacePathRef: RefObject<string | null>
  }
  state: {
    agentState: AgentWorkspaceState
    closeSessionOverlay: () => void
    resetComposer: () => void
    setAgentState: Dispatch<SetStateAction<AgentWorkspaceState>>
    setPanelError: Dispatch<SetStateAction<string | null>>
    setViewedSessionSnapshot: Dispatch<SetStateAction<AgentSessionSnapshot | null>>
  }
}

export function useAgentSessionNavigation({
  externalRequest: {
    hasLoadedWorkspaceState,
    isLoading,
    onExternalSessionRequestHandled,
    projectState,
    request: externalSessionRequest,
  },
  model: {
    newSessionModelDraftRef,
    syncModelDraft,
    syncNewSessionModelDraft,
  },
  navigation: {
    activeRuntimeSessionRef,
    activeSessionSelectionRef,
    selectedAgentId,
    selectedAgentIdRef,
    setSelectedAgentIdValue,
    syncActiveSessionSelection,
    workspacePath,
    workspacePathRef,
  },
  state: {
    agentState,
    closeSessionOverlay,
    resetComposer,
    setAgentState,
    setPanelError,
    setViewedSessionSnapshot,
  },
}: UseAgentSessionNavigationOptions) {
  const openSessionRequestIdRef = useRef(0)
  const handledExternalSessionRequestRef = useRef<number | null>(null)

  function syncActiveRuntimeSessionSnapshot(agentId: AgentId, snapshot: AgentSessionSnapshot) {
    const currentSelection = activeSessionSelectionRef.current
    const currentWorkspacePath = workspacePathRef.current
    if (
      selectedAgentIdRef.current !== agentId
      || !currentWorkspacePath
      || normalizeAgentProjectPath(snapshot.workspacePath) !== normalizeAgentProjectPath(currentWorkspacePath)
      || currentSelection.kind !== 'session'
      || currentSelection.agentId !== agentId
      || currentSelection.sessionPath !== snapshot.sessionPath
      || activeRuntimeSessionRef.current?.sessionPath !== snapshot.sessionPath
    ) {
      return
    }

    activeRuntimeSessionRef.current = snapshot
    setAgentState((currentState) => {
      if (
        currentState.runtime.agentId !== agentId
        || currentState.activeSession?.sessionPath !== snapshot.sessionPath
      ) {
        return currentState
      }

      return {
        ...currentState,
        activeSession: snapshot,
      }
    })
    setViewedSessionSnapshot(null)
  }

  async function ensureSelectedAgentSessionActive(selection = activeSessionSelectionRef.current) {
    if (!workspacePath || selection.kind !== 'session' || selection.agentId !== selectedAgentId) {
      return null
    }

    if (
      agentState.runtime.agentId === selection.agentId
      && agentState.activeSession?.sessionPath === selection.sessionPath
    ) {
      setViewedSessionSnapshot(null)
      return agentState
    }

    const requestId = openSessionRequestIdRef.current
    const nextState = await window.appApi.openAgentSession({
      agentId: selectedAgentId,
      workspacePath,
    }, selection.sessionPath)

    if (
      requestId !== openSessionRequestIdRef.current
      || activeSessionSelectionRef.current.kind !== 'session'
      || activeSessionSelectionRef.current.agentId !== selection.agentId
      || activeSessionSelectionRef.current.sessionPath !== selection.sessionPath
    ) {
      return null
    }

    setAgentState(nextState)
    setViewedSessionSnapshot(null)
    syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
    return nextState
  }

  function isAgentSessionOperationCurrent(
    agentId: AgentId,
    sessionPath: string,
    operationWorkspacePath: string,
  ) {
    return selectedAgentIdRef.current === agentId
      && shouldApplyAgentSessionOperationResult(
        activeSessionSelectionRef.current,
        workspacePathRef.current,
        { agentId, sessionPath, workspacePath: operationWorkspacePath },
      )
  }

  function handleStartNewSession() {
    openSessionRequestIdRef.current += 1
    const nextDraft = normalizeAgentModelDraft(
      newSessionModelDraftRef.current,
      agentState.runtime,
      getRuntimeDefaultModelDraft(agentState.runtime),
    )
    syncNewSessionModelDraft(nextDraft)
    syncActiveSessionSelection({ kind: 'new' })
    setViewedSessionSnapshot(null)
    syncModelDraft(nextDraft)
    resetComposer()
    setPanelError(null)
    closeSessionOverlay()
  }

  async function handleOpenSession(agentId: AgentId, sessionPath: string) {
    if (!workspacePath) {
      return
    }

    setSelectedAgentIdValue(agentId)
    syncActiveSessionSelection({ agentId, kind: 'session', sessionPath })
    setViewedSessionSnapshot(null)
    const requestId = openSessionRequestIdRef.current + 1
    openSessionRequestIdRef.current = requestId

    const isActiveRuntimeSession = agentState.runtime.agentId === agentId
      && agentState.activeSession?.sessionPath === sessionPath
    if (isActiveRuntimeSession && agentId !== 'codex') {
      setViewedSessionSnapshot(null)
      syncModelDraft(getRuntimeSelectedModelDraft(agentState.runtime))
      setPanelError(null)
      closeSessionOverlay()
      return
    }

    try {
      setPanelError(null)
      const nextSnapshot = await window.appApi.readAgentSession({
        agentId,
        workspacePath,
      }, sessionPath)
      if (
        requestId !== openSessionRequestIdRef.current
        || activeSessionSelectionRef.current.kind !== 'session'
        || activeSessionSelectionRef.current.agentId !== agentId
        || activeSessionSelectionRef.current.sessionPath !== sessionPath
      ) {
        return
      }

      const shouldRefreshActiveRuntime = isActiveRuntimeSession || (
        selectedAgentIdRef.current === agentId
        && activeRuntimeSessionRef.current?.sessionPath === sessionPath
      )
      if (shouldRefreshActiveRuntime) {
        syncActiveRuntimeSessionSnapshot(agentId, nextSnapshot)
        syncModelDraft(getRuntimeSelectedModelDraft(agentState.runtime))
      } else {
        setViewedSessionSnapshot(nextSnapshot)
      }
      closeSessionOverlay()
    } catch (error) {
      if (
        requestId !== openSessionRequestIdRef.current
        || activeSessionSelectionRef.current.kind !== 'session'
        || activeSessionSelectionRef.current.agentId !== agentId
        || activeSessionSelectionRef.current.sessionPath !== sessionPath
      ) {
        return
      }

      setPanelError(error instanceof Error ? error.message : 'Unable to open that session.')
    }
  }

  useEffect(() => {
    const requestedProject = externalSessionRequest
      ? projectState.projects.find((project) => project.id === externalSessionRequest.projectId) ?? null
      : null
    const isRequestForCurrentWorkspace = Boolean(
      requestedProject
      && workspacePath
      && normalizeAgentProjectPath(requestedProject.path) === normalizeAgentProjectPath(workspacePath),
    )

    if (
      !externalSessionRequest
      || handledExternalSessionRequestRef.current === externalSessionRequest.requestId
      || !isRequestForCurrentWorkspace
      || isLoading
      || !hasLoadedWorkspaceState
    ) {
      return
    }

    handledExternalSessionRequestRef.current = externalSessionRequest.requestId
    onExternalSessionRequestHandled?.(externalSessionRequest.requestId)

    if (externalSessionRequest.kind === 'new') {
      handleStartNewSession()
      return
    }

    void handleOpenSession(externalSessionRequest.agentId, externalSessionRequest.sessionPath)
  }, [
    externalSessionRequest,
    hasLoadedWorkspaceState,
    isLoading,
    onExternalSessionRequestHandled,
    projectState.projects,
    workspacePath,
  ])

  return {
    ensureSelectedAgentSessionActive,
    handleOpenSession,
    handleStartNewSession,
    isAgentSessionOperationCurrent,
    openSessionRequestIdRef,
  }
}

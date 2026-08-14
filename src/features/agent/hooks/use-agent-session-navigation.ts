import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import {
  getPreloadedBbSessionSurface,
  preloadBbSessionSurface,
} from '@/features/agent/components/bb-session-timeline/bb-session-surface-loader'
import {
  getRuntimeDefaultModelDraft,
  getRuntimeSelectedModelDraft,
  normalizeAgentModelDraft,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import {
  cacheAgentSessionSnapshot,
  getCachedAgentSessionSnapshot,
} from '@/features/agent/lib/agent-session-snapshot-cache'
import {
  loadAgentSessionSnapshot,
  prefetchAgentSessionSnapshot,
} from '@/features/agent/lib/agent-session-snapshot-loader'
import { createDelayedLoadingIndicator } from '@/features/agent/lib/delayed-loading-indicator'
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
    activeSessionSelection: AgentSessionSelection
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

export type AgentSessionPresentation = {
  agentId: AgentId
  selection: AgentSessionSelection
  workspacePath: string | null
}

function presentationsMatch(
  left: AgentSessionPresentation,
  right: AgentSessionPresentation,
) {
  return left.agentId === right.agentId
    && left.workspacePath === right.workspacePath
    && left.selection.kind === right.selection.kind
    && (
      left.selection.kind === 'new'
      || (
        right.selection.kind === 'session'
        && left.selection.agentId === right.selection.agentId
        && left.selection.sessionPath === right.selection.sessionPath
      )
    )
}

function workspacePathsMatch(left: string | null | undefined, right: string | null | undefined) {
  return Boolean(
    left
    && right
    && normalizeAgentProjectPath(left) === normalizeAgentProjectPath(right),
  )
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
    activeSessionSelection,
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
  const [isSessionSnapshotLoading, setIsSessionSnapshotLoading] = useState(false)
  const [showSessionSnapshotLoadingIndicator, setShowSessionSnapshotLoadingIndicator] = useState(false)
  const [sessionPresentation, setSessionPresentation] = useState<AgentSessionPresentation>(() => ({
    agentId: selectedAgentId,
    selection: activeSessionSelection,
    workspacePath,
  }))
  const sessionPresentationRef = useRef(sessionPresentation)
  const loadingIndicatorRef = useRef<ReturnType<typeof createDelayedLoadingIndicator> | null>(null)
  if (!loadingIndicatorRef.current) {
    loadingIndicatorRef.current = createDelayedLoadingIndicator({
      onVisibilityChange: setShowSessionSnapshotLoadingIndicator,
    })
  }
  const loadingIndicator = loadingIndicatorRef.current

  function syncSessionPresentation(presentation: AgentSessionPresentation) {
    sessionPresentationRef.current = presentation
    setSessionPresentation((current) => (
      presentationsMatch(current, presentation) ? current : presentation
    ))
  }

  useEffect(() => {
    openSessionRequestIdRef.current += 1
    loadingIndicator.finish()
    setIsSessionSnapshotLoading(false)
    syncSessionPresentation({
      agentId: selectedAgentIdRef.current,
      selection: { kind: 'new' },
      workspacePath,
    })
  }, [loadingIndicator, workspacePath])

  useEffect(() => () => {
    openSessionRequestIdRef.current += 1
    loadingIndicator.cancelPending()
  }, [loadingIndicator])

  useEffect(() => {
    const runtimeWorkspacePath = agentState.runtime.workspacePath
    const isPresentationWorkspaceReady = workspacePath
      ? Boolean(
          runtimeWorkspacePath
          && normalizeAgentProjectPath(runtimeWorkspacePath) === normalizeAgentProjectPath(workspacePath),
        )
      : activeSessionSelection.kind === 'new'
    if (isLoading || isSessionSnapshotLoading || !isPresentationWorkspaceReady) return
    syncSessionPresentation({
      agentId: activeSessionSelection.kind === 'session'
        ? activeSessionSelection.agentId
        : selectedAgentId,
      selection: activeSessionSelection,
      workspacePath,
    })
  }, [
    activeSessionSelection,
    agentState.runtime.workspacePath,
    isLoading,
    isSessionSnapshotLoading,
    selectedAgentId,
    workspacePath,
  ])

  useEffect(() => {
    const activeSession = agentState.activeSession
    if (
      !workspacePath
      || !activeSession
      || !activeSession.sessionPath
      || normalizeAgentProjectPath(activeSession.workspacePath) !== normalizeAgentProjectPath(workspacePath)
    ) {
      return
    }

    cacheAgentSessionSnapshot(
      agentState.runtime.agentId,
      workspacePath,
      activeSession.sessionPath,
      activeSession,
    )
  }, [agentState.activeSession, agentState.runtime.agentId, workspacePath])

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
        || !workspacePathsMatch(currentState.runtime.workspacePath, snapshot.workspacePath)
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
      && workspacePathsMatch(agentState.runtime.workspacePath, workspacePath)
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
    loadingIndicator.finish()
    setIsSessionSnapshotLoading(false)
    const nextDraft = normalizeAgentModelDraft(
      newSessionModelDraftRef.current,
      agentState.runtime,
      getRuntimeDefaultModelDraft(agentState.runtime),
    )
    syncNewSessionModelDraft(nextDraft)
    syncActiveSessionSelection({ kind: 'new' })
    syncSessionPresentation({
      agentId: selectedAgentId,
      selection: { kind: 'new' },
      workspacePath,
    })
    setViewedSessionSnapshot(null)
    syncModelDraft(nextDraft)
    resetComposer()
    setPanelError(null)
    closeSessionOverlay()
  }

  function handlePrefetchSession(
    operationWorkspacePath: string,
    agentId: AgentId,
    sessionPath: string,
  ) {
    if (
      agentState.runtime.agentId === agentId
      && workspacePathsMatch(agentState.runtime.workspacePath, operationWorkspacePath)
      && agentState.activeSession?.sessionPath === sessionPath
    ) return
    void preloadBbSessionSurface().catch(() => undefined)
    void prefetchAgentSessionSnapshot({
      agentId,
      sessionPath,
      workspacePath: operationWorkspacePath,
    }).catch(() => undefined)
  }

  async function handleOpenSession(agentId: AgentId, sessionPath: string) {
    if (!workspacePath) {
      return
    }

    void preloadBbSessionSurface().catch(() => undefined)
    const isActiveRuntimeSession = agentState.runtime.agentId === agentId
      && workspacePathsMatch(agentState.runtime.workspacePath, workspacePath)
      && agentState.activeSession?.sessionPath === sessionPath
    const cachedSnapshot = isActiveRuntimeSession
      ? null
      : getCachedAgentSessionSnapshot(agentId, workspacePath, sessionPath)
    const canPresentCachedSnapshot = Boolean(
      cachedSnapshot
      && (!cachedSnapshot.native || getPreloadedBbSessionSurface()),
    )
    const fallbackPresentation = sessionPresentationRef.current
    const targetSelection: AgentSessionSelection = { agentId, kind: 'session', sessionPath }
    const targetPresentation: AgentSessionPresentation = {
      agentId,
      selection: targetSelection,
      workspacePath,
    }
    setSelectedAgentIdValue(agentId)
    syncActiveSessionSelection(targetSelection)
    closeSessionOverlay()
    const requestId = openSessionRequestIdRef.current + 1
    openSessionRequestIdRef.current = requestId

    const isCurrentRequest = () => (
      requestId === openSessionRequestIdRef.current
      && shouldApplyAgentSessionOperationResult(
        activeSessionSelectionRef.current,
        workspacePathRef.current,
        { agentId, sessionPath, workspacePath },
      )
    )

    if (isActiveRuntimeSession) {
      loadingIndicator.finish()
      setIsSessionSnapshotLoading(false)
      setViewedSessionSnapshot(null)
      syncSessionPresentation(targetPresentation)
      syncModelDraft(getRuntimeSelectedModelDraft(agentState.runtime))
      setPanelError(null)
      return
    }
    if (cachedSnapshot && canPresentCachedSnapshot) {
      loadingIndicator.finish()
      // Keep mutation/composer actions gated until the source validation
      // finishes, even though the cached conversation is already paintable.
      setIsSessionSnapshotLoading(true)
      setViewedSessionSnapshot(cachedSnapshot)
      syncSessionPresentation(targetPresentation)
    } else {
      setIsSessionSnapshotLoading(true)
      loadingIndicator.begin()
    }

    try {
      setPanelError(null)
      const nextSnapshot = await loadAgentSessionSnapshot({
        agentId,
        sessionPath,
        workspacePath,
      })
      if (nextSnapshot.native) await preloadBbSessionSurface()
      if (!isCurrentRequest()) {
        return
      }

      const retainedInteractionHistory = cachedSnapshot?.interactionHistory ?? (
        agentState.runtime.agentId === agentId
        && workspacePathsMatch(agentState.runtime.workspacePath, workspacePath)
        && agentState.activeSession?.sessionPath === sessionPath
        && workspacePathsMatch(agentState.activeSession.workspacePath, workspacePath)
          ? agentState.activeSession.interactionHistory
          : undefined
      )
      const immediateSnapshot = retainedInteractionHistory
        ? { ...nextSnapshot, interactionHistory: retainedInteractionHistory }
        : nextSnapshot
      cacheAgentSessionSnapshot(agentId, workspacePath, sessionPath, immediateSnapshot)
      loadingIndicator.finish()
      syncSessionPresentation(targetPresentation)

      const shouldRefreshActiveRuntime = isActiveRuntimeSession || (
        selectedAgentIdRef.current === agentId
        && activeRuntimeSessionRef.current?.sessionPath === sessionPath
      )
      if (shouldRefreshActiveRuntime) {
        syncActiveRuntimeSessionSnapshot(agentId, immediateSnapshot)
        syncModelDraft(getRuntimeSelectedModelDraft(agentState.runtime))
      } else {
        setViewedSessionSnapshot(immediateSnapshot)
      }

      window.requestAnimationFrame(() => {
        if (!isCurrentRequest()) return
        void window.appApi.readAgentSessionInteractionHistory({
          agentId,
          workspacePath,
        }, nextSnapshot.sessionId).then((interactionHistory) => {
          if (!isCurrentRequest()) return
          const enrichedSnapshot = { ...immediateSnapshot, interactionHistory }
          cacheAgentSessionSnapshot(agentId, workspacePath, sessionPath, enrichedSnapshot)
          const shouldRefreshCurrentRuntime = (
            selectedAgentIdRef.current === agentId
            && activeRuntimeSessionRef.current?.sessionPath === sessionPath
          )
          if (shouldRefreshCurrentRuntime) {
            syncActiveRuntimeSessionSnapshot(agentId, enrichedSnapshot)
          } else {
            setViewedSessionSnapshot((currentSnapshot) => (
              currentSnapshot?.sessionPath === sessionPath
                ? enrichedSnapshot
                : currentSnapshot
            ))
          }
        }).catch((error) => {
          console.warn('[agent-session-navigation] unable to load interaction history', error)
        })
      })
    } catch (error) {
      if (!isCurrentRequest()) {
        return
      }

      loadingIndicator.finish()
      if (!canPresentCachedSnapshot) {
        syncActiveSessionSelection(fallbackPresentation.selection)
        setSelectedAgentIdValue(fallbackPresentation.agentId)
        syncSessionPresentation(fallbackPresentation)
      }
      setPanelError(error instanceof Error ? error.message : 'Unable to open that session.')
    } finally {
      if (requestId === openSessionRequestIdRef.current) {
        loadingIndicator.finish()
        setIsSessionSnapshotLoading(false)
      }
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
    handlePrefetchSession,
    handleStartNewSession,
    isAgentSessionOperationCurrent,
    isSessionSnapshotLoading,
    openSessionRequestIdRef,
    sessionPresentation,
    showSessionSnapshotLoadingIndicator,
  }
}

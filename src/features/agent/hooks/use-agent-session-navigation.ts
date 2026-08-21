import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useLayoutEffect,
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
  isAgentNewConversationPresentation,
  resolvePendingAgentNewSessionProject,
  resolveAgentSessionNavigationTarget,
  shouldApplyAgentSessionNavigationResult,
  shouldApplyAgentSessionOperationResult,
  type AgentProjectSessionRequest,
  type AgentSessionNavigationTarget,
  type AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'
import type {
  AgentSessionSnapshot,
  AgentWorkspaceState,
} from '@/features/agent/types'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
} from '@/features/conversations/types'
import type { ProjectState } from '@/features/workspace/types'

type UseAgentSessionNavigationOptions = {
  externalRequest: {
    activeConversation: ConversationRecord | null
    activeWorkspaceContext: ActiveWorkspaceContext
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

type OpenAgentSessionOptions = {
  navigationTarget?: AgentSessionNavigationTarget
  rollbackOnError?: boolean
  workspacePath?: string
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
    && workspacePathsMatch(left.workspacePath, right.workspacePath)
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
  if (left == null || right == null) return left === right
  return normalizeAgentProjectPath(left) === normalizeAgentProjectPath(right)
}

export function useAgentSessionNavigation({
  externalRequest: {
    activeConversation,
    activeWorkspaceContext,
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
  const handledNavigationTargetRef = useRef<string | null>(null)
  const presentedExternalNewSessionRequestRef = useRef<number | null>(null)
  const [isSessionSnapshotLoading, setIsSessionSnapshotLoading] = useState(false)
  const [showSessionSnapshotLoadingIndicator, setShowSessionSnapshotLoadingIndicator] = useState(false)
  // undefined means no explicit draft presentation, null means standalone,
  // and a path identifies a project-backed draft.
  const [newConversationPresentationWorkspacePath, setNewConversationPresentationWorkspacePath] = useState<
    string | null | undefined
  >(activeWorkspaceContext.kind === 'conversationDraft' ? null : undefined)
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
  const sessionNavigationTarget = resolveAgentSessionNavigationTarget({
    activeConversation,
    activeWorkspaceContext,
    projects: projectState.projects,
    request: externalSessionRequest,
  })
  const sessionNavigationTargetRef = useRef(sessionNavigationTarget)
  sessionNavigationTargetRef.current = sessionNavigationTarget

  const sessionNavigationTargetKey = sessionNavigationTarget
    ? [
        sessionNavigationTarget.navigationKey,
        sessionNavigationTarget.agentId,
        normalizeAgentProjectPath(sessionNavigationTarget.workspacePath),
        sessionNavigationTarget.sessionPath,
      ].join('\n')
    : null
  const conversationFallbackPresentationKey = activeWorkspaceContext.kind === 'conversation'
    && activeConversation?.id === activeWorkspaceContext.conversationId
    && !sessionNavigationTarget
    ? [
        activeConversation.id,
        activeConversation.agentId,
        activeConversation.workspacePath ?? '',
        activeConversation.agentSessionPath ?? '',
      ].join('\n')
    : null

  function syncSessionPresentation(presentation: AgentSessionPresentation) {
    sessionPresentationRef.current = presentation
    setSessionPresentation((current) => (
      presentationsMatch(current, presentation) ? current : presentation
    ))
  }

  useEffect(() => {
    const navigationTarget = sessionNavigationTargetRef.current
    // The accepted target owns presentation while the workspace connection is
    // catching up. An intermediate or late workspace result must not cancel a
    // snapshot read that is independent from runtime activation.
    if (navigationTarget) {
      return
    }

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

  // A conversation whose workspace or session is unavailable still owns an
  // explicit empty/error presentation. Clear the prior session before paint so
  // it cannot leak beneath the newly accepted conversation title.
  useLayoutEffect(() => {
    if (!conversationFallbackPresentationKey || !activeConversation) return

    openSessionRequestIdRef.current += 1
    loadingIndicator.finish()
    setIsSessionSnapshotLoading(false)
    setSelectedAgentIdValue(activeConversation.agentId)
    syncActiveSessionSelection({ kind: 'new' })
    setViewedSessionSnapshot(null)
    syncSessionPresentation({
      agentId: activeConversation.agentId,
      selection: { kind: 'new' },
      workspacePath: activeConversation.workspacePath,
    })
    setPanelError(null)
    closeSessionOverlay()
  }, [conversationFallbackPresentationKey])

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

  function handleStartNewSession(presentationWorkspacePath = workspacePath) {
    openSessionRequestIdRef.current += 1
    loadingIndicator.finish()
    setIsSessionSnapshotLoading(false)
    setNewConversationPresentationWorkspacePath(presentationWorkspacePath)
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
      workspacePath: presentationWorkspacePath,
    })
    setViewedSessionSnapshot(null)
    syncModelDraft(nextDraft)
    resetComposer()
    setPanelError(null)
    closeSessionOverlay()
  }

  const pendingNewSessionProject = resolvePendingAgentNewSessionProject(
    externalSessionRequest,
    activeWorkspaceContext,
    projectState.projects,
  )

  // A new-conversation command owns the visible surface as soon as its project
  // switch is accepted. Commit that presentation before paint; workspace state,
  // session discovery, and external Agent startup can continue in the background.
  useLayoutEffect(() => {
    if (
      !pendingNewSessionProject
      || externalSessionRequest?.kind !== 'new'
      || presentedExternalNewSessionRequestRef.current === externalSessionRequest.requestId
    ) {
      return
    }

    presentedExternalNewSessionRequestRef.current = externalSessionRequest.requestId
    handleStartNewSession(pendingNewSessionProject.path)
  }, [externalSessionRequest, pendingNewSessionProject])

  const isStandaloneConversationDraft = activeWorkspaceContext.kind === 'conversationDraft'
  const presentedStandaloneConversationDraftRef = useRef(false)
  useLayoutEffect(() => {
    if (!isStandaloneConversationDraft) {
      presentedStandaloneConversationDraftRef.current = false
      return
    }

    if (presentedStandaloneConversationDraftRef.current) {
      return
    }

    presentedStandaloneConversationDraftRef.current = true
    handleStartNewSession(null)
  }, [isStandaloneConversationDraft])

  const isExplicitNewConversationPresentation = isAgentNewConversationPresentation(
    activeSessionSelection,
    newConversationPresentationWorkspacePath,
    activeWorkspaceContext,
    projectState.projects,
  )

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

  async function handleOpenSession(
    agentId: AgentId,
    sessionPath: string,
    options: OpenAgentSessionOptions = {},
  ) {
    const operationWorkspacePath = options.workspacePath ?? workspacePath
    if (!operationWorkspacePath) {
      return
    }

    void preloadBbSessionSurface().catch(() => undefined)
    const isActiveRuntimeSession = agentState.runtime.agentId === agentId
      && workspacePathsMatch(agentState.runtime.workspacePath, operationWorkspacePath)
      && agentState.activeSession?.sessionPath === sessionPath
    const cachedSnapshot = isActiveRuntimeSession
      ? null
      : getCachedAgentSessionSnapshot(agentId, operationWorkspacePath, sessionPath)
    const canPresentCachedSnapshot = Boolean(
      cachedSnapshot
      && (!cachedSnapshot.native || getPreloadedBbSessionSurface()),
    )
    const fallbackPresentation = sessionPresentationRef.current
    const targetSelection: AgentSessionSelection = { agentId, kind: 'session', sessionPath }
    const targetPresentation: AgentSessionPresentation = {
      agentId,
      selection: targetSelection,
      workspacePath: operationWorkspacePath,
    }
    setSelectedAgentIdValue(agentId)
    syncActiveSessionSelection(targetSelection)
    closeSessionOverlay()
    const requestId = openSessionRequestIdRef.current + 1
    openSessionRequestIdRef.current = requestId

    const isCurrentRequest = () => (
      requestId === openSessionRequestIdRef.current
      && (options.navigationTarget
        ? shouldApplyAgentSessionNavigationResult({
            currentNavigationTarget: sessionNavigationTargetRef.current,
            currentSelection: activeSessionSelectionRef.current,
            currentWorkspacePath: workspacePathRef.current,
            operationTarget: options.navigationTarget,
          })
        : shouldApplyAgentSessionOperationResult(
            activeSessionSelectionRef.current,
            workspacePathRef.current,
            { agentId, sessionPath, workspacePath: operationWorkspacePath },
          ))
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
        workspacePath: operationWorkspacePath,
      })
      if (nextSnapshot.native) await preloadBbSessionSurface()
      if (!isCurrentRequest()) {
        return
      }

      const retainedInteractionHistory = cachedSnapshot?.interactionHistory ?? (
        agentState.runtime.agentId === agentId
        && workspacePathsMatch(agentState.runtime.workspacePath, operationWorkspacePath)
        && agentState.activeSession?.sessionPath === sessionPath
        && workspacePathsMatch(agentState.activeSession.workspacePath, operationWorkspacePath)
          ? agentState.activeSession.interactionHistory
          : undefined
      )
      const immediateSnapshot = retainedInteractionHistory
        ? { ...nextSnapshot, interactionHistory: retainedInteractionHistory }
        : nextSnapshot
      cacheAgentSessionSnapshot(agentId, operationWorkspacePath, sessionPath, immediateSnapshot)
      loadingIndicator.finish()
      syncSessionPresentation(targetPresentation)

      const shouldRefreshActiveRuntime = isActiveRuntimeSession || (
        selectedAgentIdRef.current === agentId
        && workspacePathsMatch(activeRuntimeSessionRef.current?.workspacePath, operationWorkspacePath)
        && activeRuntimeSessionRef.current?.sessionPath === sessionPath
      )
      if (shouldRefreshActiveRuntime) {
        syncActiveRuntimeSessionSnapshot(agentId, immediateSnapshot)
        if (isActiveRuntimeSession) {
          syncModelDraft(getRuntimeSelectedModelDraft(agentState.runtime))
        }
      } else {
        setViewedSessionSnapshot(immediateSnapshot)
      }

      window.requestAnimationFrame(() => {
        if (!isCurrentRequest()) return
        void window.appApi.readAgentSessionInteractionHistory({
          agentId,
          workspacePath: operationWorkspacePath,
        }, nextSnapshot.sessionId).then((interactionHistory) => {
          if (!isCurrentRequest()) return
          const enrichedSnapshot = { ...immediateSnapshot, interactionHistory }
          cacheAgentSessionSnapshot(agentId, operationWorkspacePath, sessionPath, enrichedSnapshot)
          const shouldRefreshCurrentRuntime = (
            selectedAgentIdRef.current === agentId
            && workspacePathsMatch(activeRuntimeSessionRef.current?.workspacePath, operationWorkspacePath)
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
      const hasCurrentRuntimeSnapshot = selectedAgentIdRef.current === agentId
        && workspacePathsMatch(activeRuntimeSessionRef.current?.workspacePath, operationWorkspacePath)
        && activeRuntimeSessionRef.current?.sessionPath === sessionPath
      if (hasCurrentRuntimeSnapshot) {
        setViewedSessionSnapshot(null)
        syncSessionPresentation(targetPresentation)
        setPanelError(null)
        return
      }
      if (!canPresentCachedSnapshot) {
        if (options.rollbackOnError === false) {
          setViewedSessionSnapshot(null)
          syncSessionPresentation(targetPresentation)
        } else {
          syncActiveSessionSelection(fallbackPresentation.selection)
          setSelectedAgentIdValue(fallbackPresentation.agentId)
          syncSessionPresentation(fallbackPresentation)
        }
      }
      setPanelError(error instanceof Error ? error.message : '无法打开该会话，请重试。')
    } finally {
      if (requestId === openSessionRequestIdRef.current) {
        loadingIndicator.finish()
        setIsSessionSnapshotLoading(false)
      }
    }
  }

  // Snapshot presentation follows the accepted navigation intent immediately.
  // Workspace discovery, Git setup, file watching, and runtime activation are
  // independent background work and must not delay the first useful frame.
  useLayoutEffect(() => {
    if (!sessionNavigationTarget || !sessionNavigationTargetKey) {
      handledNavigationTargetRef.current = null
      return
    }
    if (handledNavigationTargetRef.current === sessionNavigationTargetKey) {
      return
    }

    handledNavigationTargetRef.current = sessionNavigationTargetKey
    void handleOpenSession(
      sessionNavigationTarget.agentId,
      sessionNavigationTarget.sessionPath,
      {
        navigationTarget: sessionNavigationTarget,
        rollbackOnError: false,
        workspacePath: sessionNavigationTarget.workspacePath,
      },
    )
  }, [sessionNavigationTargetKey])

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

    if (externalSessionRequest.kind === 'session') {
      onExternalSessionRequestHandled?.(externalSessionRequest.requestId)
      return
    }

    onExternalSessionRequestHandled?.(externalSessionRequest.requestId)
    if (presentedExternalNewSessionRequestRef.current !== externalSessionRequest.requestId) {
      handleStartNewSession(requestedProject?.path ?? workspacePath)
    }
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
    isExplicitNewConversationPresentation,
    isSessionSnapshotLoading,
    openSessionRequestIdRef,
    sessionPresentation,
    showSessionSnapshotLoadingIndicator,
  }
}

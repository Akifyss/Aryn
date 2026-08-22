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
  // Source validation can continue after a cached snapshot is paintable.
  // Track missing visual content separately so background validation never
  // replaces useful content with a loading indicator.
  const [isSessionSnapshotContentPending, setIsSessionSnapshotContentPending] = useState(false)
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
  const targetProjectPresentationWorkspacePath = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId)?.path ?? null
    : null
  // Project context is accepted before the workspace/runtime restore finishes.
  // Treat a source-workspace presentation as pending even when there is no
  // explicit session request, so it cannot remain visible indefinitely.
  const isSessionPresentationPending = Boolean(
    (
      sessionNavigationTarget
      && !presentationsMatch(sessionPresentation, {
        agentId: sessionNavigationTarget.agentId,
        selection: {
          agentId: sessionNavigationTarget.agentId,
          kind: 'session',
          sessionPath: sessionNavigationTarget.sessionPath,
        },
        workspacePath: sessionNavigationTarget.workspacePath,
      })
    )
    || (
      targetProjectPresentationWorkspacePath
      && !workspacePathsMatch(
        sessionPresentation.workspacePath,
        targetProjectPresentationWorkspacePath,
      )
    ),
  )
  const sessionTransitionScopeKey = activeWorkspaceContext.kind === 'conversation'
    ? `conversation:${activeWorkspaceContext.conversationId}`
    : activeWorkspaceContext.kind === 'project'
      ? `project:${activeWorkspaceContext.projectId}`
      : 'conversation-draft'
  const sessionTransitionKeyRef = useRef<{
    key: string
    scope: string
  } | null>(null)
  // The workspace controller clears an explicit request as soon as runtime
  // accepts it. Keep that request's identity until the visual transition is
  // complete so acknowledgement cannot restart the loading grace period.
  const isSessionTransitionPending = isSessionSnapshotLoading
    || isSessionSnapshotContentPending
    || isSessionPresentationPending
  const nextNavigationTransitionKey = sessionNavigationTargetKey
    ? `navigation:${sessionNavigationTargetKey}`
    : null
  if (
    !sessionTransitionKeyRef.current
    || sessionTransitionKeyRef.current.scope !== sessionTransitionScopeKey
  ) {
    sessionTransitionKeyRef.current = {
      key: nextNavigationTransitionKey ?? `${sessionTransitionScopeKey}:restore`,
      scope: sessionTransitionScopeKey,
    }
  } else if (nextNavigationTransitionKey) {
    sessionTransitionKeyRef.current.key = nextNavigationTransitionKey
  } else if (!isSessionTransitionPending) {
    sessionTransitionKeyRef.current.key = `${sessionTransitionScopeKey}:restore`
  }
  const sessionTransitionKey = sessionTransitionKeyRef.current.key
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
    setIsSessionSnapshotLoading(false)
    setIsSessionSnapshotContentPending(false)
    syncSessionPresentation({
      agentId: selectedAgentIdRef.current,
      selection: { kind: 'new' },
      workspacePath,
    })
  }, [workspacePath])

  useEffect(() => () => {
    openSessionRequestIdRef.current += 1
  }, [])

  // A conversation whose workspace or session is unavailable still owns an
  // explicit empty/error presentation. Clear the prior session before paint so
  // it cannot leak beneath the newly accepted conversation title.
  useLayoutEffect(() => {
    if (!conversationFallbackPresentationKey || !activeConversation) return

    openSessionRequestIdRef.current += 1
    setIsSessionSnapshotLoading(false)
    setIsSessionSnapshotContentPending(false)
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

  // Commit a restored runtime selection before the browser paints. A passive
  // effect would expose one frame of the temporary new-session presentation.
  useLayoutEffect(() => {
    // An accepted navigation target already owns the visible chrome and
    // message surface. The connected workspace can still point at the source
    // conversation while filesystem, Git, watch, and runtime setup continue in
    // the background; synchronizing from that lagging runtime would hide an
    // already-loaded target snapshot until unrelated workspace work finishes.
    if (sessionNavigationTargetRef.current) return

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
    sessionNavigationTargetKey,
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
    setIsSessionSnapshotLoading(false)
    setIsSessionSnapshotContentPending(false)
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
    sessionPresentation.selection,
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

    const surfaceReadyPromise = preloadBbSessionSurface()
    void surfaceReadyPromise.catch(() => undefined)
    const isActiveRuntimeSession = agentState.runtime.agentId === agentId
      && workspacePathsMatch(agentState.runtime.workspacePath, operationWorkspacePath)
      && agentState.activeSession?.sessionPath === sessionPath
    const cachedSnapshot = isActiveRuntimeSession
      ? null
      : getCachedAgentSessionSnapshot(agentId, operationWorkspacePath, sessionPath)
    const hasCachedSnapshot = cachedSnapshot !== null
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
      setIsSessionSnapshotLoading(false)
      setIsSessionSnapshotContentPending(false)
      setViewedSessionSnapshot(null)
      syncSessionPresentation(targetPresentation)
      syncModelDraft(getRuntimeSelectedModelDraft(agentState.runtime))
      setPanelError(null)
      return
    }
    if (cachedSnapshot && canPresentCachedSnapshot) {
      // Keep mutation/composer actions gated until the source validation
      // finishes, even though the cached conversation is already paintable.
      setIsSessionSnapshotLoading(true)
      setIsSessionSnapshotContentPending(false)
      setViewedSessionSnapshot(cachedSnapshot)
      syncSessionPresentation(targetPresentation)
    } else {
      setIsSessionSnapshotLoading(true)
      setIsSessionSnapshotContentPending(true)
      // Commit the accepted target before reading its snapshot. The message
      // surface owns the loading state; it must never continue showing the
      // previous session under the target session's controls.
      setViewedSessionSnapshot(null)
      syncSessionPresentation(targetPresentation)
      if (cachedSnapshot?.native) {
        // A persisted native snapshot is already useful data. If only the
        // shared message renderer is still warming, reveal that snapshot as
        // soon as the renderer is ready and let source validation continue in
        // the background instead of extending the visual loading gate.
        void surfaceReadyPromise.then(() => {
          if (!isCurrentRequest()) return
          setViewedSessionSnapshot(cachedSnapshot)
          setIsSessionSnapshotContentPending(false)
        }).catch(() => undefined)
      }
    }

    try {
      setPanelError(null)
      const nextSnapshot = await loadAgentSessionSnapshot({
        agentId,
        sessionPath,
        workspacePath: operationWorkspacePath,
      })
      if (nextSnapshot.native) await surfaceReadyPromise
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
      setIsSessionSnapshotContentPending(false)

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

      const hasCurrentRuntimeSnapshot = selectedAgentIdRef.current === agentId
        && workspacePathsMatch(activeRuntimeSessionRef.current?.workspacePath, operationWorkspacePath)
        && activeRuntimeSessionRef.current?.sessionPath === sessionPath
      if (hasCurrentRuntimeSnapshot) {
        setViewedSessionSnapshot(null)
        syncSessionPresentation(targetPresentation)
        setPanelError(null)
        return
      }
      // A cached native snapshot may have become paintable while source
      // validation was in flight. Keep that useful fallback even if it was not
      // immediately presentable at navigation start.
      if (!hasCachedSnapshot) {
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
      setIsSessionSnapshotContentPending(false)
    } finally {
      if (requestId === openSessionRequestIdRef.current) {
        setIsSessionSnapshotLoading(false)
        setIsSessionSnapshotContentPending(false)
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
    isSessionPresentationPending,
    isSessionSnapshotContentPending,
    isSessionSnapshotLoading,
    openSessionRequestIdRef,
    sessionPresentation,
    sessionTransitionKey,
  }
}

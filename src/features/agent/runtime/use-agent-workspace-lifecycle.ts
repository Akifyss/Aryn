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
  parseModelSelection,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import {
  isAgentWorkspacePathReadyForTarget,
  resolveAgentWorkspaceSessionRestore,
  shouldApplyAgentWorkspaceState,
  shouldPersistAgentWorkspaceSelection,
  type AgentProjectSessionRequest,
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
  ConversationSessionStartedPatch,
} from '@/features/conversations/types'
import type { ProjectState } from '@/features/workspace/types'

const INITIAL_MODEL_SELECTION = parseModelSelection(null)

type UseAgentWorkspaceLifecycleOptions = {
  catalog: {
    markAgentUnavailable: (agentId: AgentId, reason: string, guidance?: string) => void
  }
  conversation: {
    activeConversation: ConversationRecord | null
    activeWorkspaceContext: ActiveWorkspaceContext
    onConversationSessionStarted?: (
      conversationId: string,
      patch: ConversationSessionStartedPatch,
    ) => Promise<void> | void
  }
  model: {
    newSessionModelDraftRef: RefObject<AgentModelDraft>
    setModelDrafts: Dispatch<SetStateAction<Record<string, string>>>
    syncModelDraft: (draft: AgentModelDraft) => void
    syncNewSessionModelDraft: (draft: AgentModelDraft) => void
  }
  navigation: {
    activeSessionSelection: AgentSessionSelection
    activeSessionSelectionRef: RefObject<AgentSessionSelection>
    externalSessionRequestRef: RefObject<AgentProjectSessionRequest | null>
    restorableSessionPath: string | null
    selectedAgentId: AgentId
    syncActiveSessionSelection: (selection: AgentSessionSelection) => void
  }
  refresh: {
    revision: number
  }
  state: {
    agentState: AgentWorkspaceState
    hasLoadedWorkspaceState: boolean
    initialAgentState: AgentWorkspaceState
    isLoading: boolean
    resetComposer: () => void
    resetRunDrafts: () => void
    setAgentState: Dispatch<SetStateAction<AgentWorkspaceState>>
    setHasLoadedWorkspaceState: Dispatch<SetStateAction<boolean>>
    setIsLoading: Dispatch<SetStateAction<boolean>>
    setPanelError: Dispatch<SetStateAction<string | null>>
    setViewedSessionSnapshot: Dispatch<SetStateAction<AgentSessionSnapshot | null>>
  }
  workspace: {
    onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
    projectState: ProjectState
    targetAgentSessionPath: string | null | undefined
    targetWorkspacePath: string | null | undefined
    workspacePath: string | null
    workspaceState?: AgentWorkspaceState | null
  }
}

export function useAgentWorkspaceLifecycle({
  catalog: {
    markAgentUnavailable,
  },
  conversation: {
    activeConversation,
    activeWorkspaceContext,
    onConversationSessionStarted,
  },
  model: {
    newSessionModelDraftRef,
    setModelDrafts,
    syncModelDraft,
    syncNewSessionModelDraft,
  },
  navigation: {
    activeSessionSelection,
    activeSessionSelectionRef,
    externalSessionRequestRef,
    restorableSessionPath,
    selectedAgentId,
    syncActiveSessionSelection,
  },
  refresh: {
    revision: runtimeRefreshRevision,
  },
  state: {
    agentState,
    hasLoadedWorkspaceState,
    initialAgentState,
    isLoading,
    resetComposer,
    resetRunDrafts,
    setAgentState,
    setHasLoadedWorkspaceState,
    setIsLoading,
    setPanelError,
    setViewedSessionSnapshot,
  },
  workspace: {
    onWorkspaceStateChange,
    projectState,
    targetAgentSessionPath,
    targetWorkspacePath,
    workspacePath,
    workspaceState,
  },
}: UseAgentWorkspaceLifecycleOptions) {
  const loadAgentStateRequestIdRef = useRef(0)
  const primaryLoadPendingRef = useRef(false)
  const backgroundRefreshRequestIdRef = useRef(0)
  const handledRuntimeRefreshRevisionRef = useRef(0)
  const locallyEmittedWorkspaceStatesRef = useRef<WeakSet<AgentWorkspaceState>>(new WeakSet())
  const pendingExternalWorkspaceStateRef = useRef<AgentWorkspaceState | null>(null)

  useEffect(() => {
    if (
      !workspacePath
      || !workspaceState
      || !isAgentWorkspacePathReadyForTarget(workspacePath, targetWorkspacePath)
      || !shouldPersistAgentWorkspaceSelection(workspaceState.runtime, selectedAgentId, workspacePath)
    ) {
      return
    }

    if (locallyEmittedWorkspaceStatesRef.current.has(workspaceState)) {
      return
    }

    const currentSelection = activeSessionSelectionRef.current
    const nextSessionPath = workspaceState.activeSession?.sessionPath ?? null
    const shouldApplyFullState = shouldApplyAgentWorkspaceState(
      currentSelection,
      workspaceState.runtime.agentId,
      nextSessionPath,
    )

    setAgentState((currentState) => {
      if (shouldApplyFullState) {
        if (currentState === workspaceState) return currentState
        pendingExternalWorkspaceStateRef.current = workspaceState
        return workspaceState
      }

      return currentState.sessions === workspaceState.sessions
        ? currentState
        : { ...currentState, sessions: workspaceState.sessions }
    })
    if (!shouldApplyFullState) {
      setHasLoadedWorkspaceState(true)
      return
    }

    const defaultDraft = getRuntimeDefaultModelDraft(workspaceState.runtime)
    const nextDraft = normalizeAgentModelDraft(newSessionModelDraftRef.current.provider || newSessionModelDraftRef.current.modelId
      ? newSessionModelDraftRef.current
      : defaultDraft, workspaceState.runtime, defaultDraft)
    syncNewSessionModelDraft(nextDraft)
    if (
      currentSelection.kind === 'session'
      && currentSelection.agentId === workspaceState.runtime.agentId
      && currentSelection.sessionPath === workspaceState.activeSession?.sessionPath
    ) {
      syncModelDraft(getRuntimeSelectedModelDraft(workspaceState.runtime))
    } else if (currentSelection.kind === 'new') {
      syncModelDraft(nextDraft)
    }
    setHasLoadedWorkspaceState(true)
  }, [selectedAgentId, targetWorkspacePath, workspacePath, workspaceState])

  useEffect(() => {
    const requestId = loadAgentStateRequestIdRef.current + 1
    loadAgentStateRequestIdRef.current = requestId
    primaryLoadPendingRef.current = true
    backgroundRefreshRequestIdRef.current += 1

    if (!isAgentWorkspacePathReadyForTarget(workspacePath, targetWorkspacePath)) {
      primaryLoadPendingRef.current = false
      setHasLoadedWorkspaceState(false)
      setIsLoading(false)
      return
    }

    if (!workspacePath) {
      setAgentState(initialAgentState)
      setViewedSessionSnapshot(null)
      // Navigation already committed and cleared a standalone draft before
      // paint. A later runtime response must not erase text entered meanwhile.
      if (activeWorkspaceContext.kind !== 'conversationDraft') {
        resetComposer()
      }
      syncNewSessionModelDraft(getRuntimeDefaultModelDraft(initialAgentState.runtime))
      syncModelDraft(getRuntimeDefaultModelDraft(initialAgentState.runtime))
      setModelDrafts({
        [INITIAL_MODEL_SELECTION.provider]: INITIAL_MODEL_SELECTION.modelId,
      })
      resetRunDrafts()
      setPanelError(null)
      setHasLoadedWorkspaceState(false)
      syncActiveSessionSelection({ kind: 'new' })
      setIsLoading(true)

      void window.appApi.loadAgentDraftState(selectedAgentId)
        .then((nextState) => {
          if (loadAgentStateRequestIdRef.current !== requestId) {
            return
          }

          if (!nextState.runtime.hasConfiguredModels) {
            markAgentUnavailable(selectedAgentId, nextState.runtime.setupHint ?? '当前 Agent 没有可用模型。')
          }
          setAgentState(nextState)
          const defaultDraft = getRuntimeDefaultModelDraft(nextState.runtime)
          const nextDraft = normalizeAgentModelDraft(defaultDraft, nextState.runtime, defaultDraft)
          syncNewSessionModelDraft(nextDraft)
          syncModelDraft(nextDraft)
          setModelDrafts(nextDraft.provider ? { [nextDraft.provider]: nextDraft.modelId } : {})
          setHasLoadedWorkspaceState(true)
        })
        .catch((error) => {
          if (loadAgentStateRequestIdRef.current === requestId) {
            const message = error instanceof Error ? error.message : 'Unable to load provider settings.'
            markAgentUnavailable(selectedAgentId, message)
            setPanelError(message)
          }
        })
        .finally(() => {
          if (loadAgentStateRequestIdRef.current === requestId) {
            primaryLoadPendingRef.current = false
            setIsLoading(false)
          }
        })

      return
    }

    setIsLoading(true)
    setPanelError(null)
    // A target snapshot may already be paintable before runtime activation.
    // Keep it committed until the restored runtime state can replace it
    // atomically; session identity filtering prevents stale content leakage.
    setHasLoadedWorkspaceState(false)
    const requestedProject = externalSessionRequestRef.current
      ? projectState.projects.find((project) => project.id === externalSessionRequestRef.current?.projectId) ?? null
      : null
    const matchingExternalRequest = requestedProject
      && normalizeAgentProjectPath(requestedProject.path) === normalizeAgentProjectPath(workspacePath)
      ? externalSessionRequestRef.current
      : null
    const shouldStartNewSession = matchingExternalRequest?.kind === 'new'
      || (
        activeWorkspaceContext.kind === 'conversation'
        && targetAgentSessionPath === null
      )

    if (shouldStartNewSession) {
      syncActiveSessionSelection({ kind: 'new' })
    }

    void window.appApi.getWorkspaceState(workspacePath)
      .then((workspaceState) => {
        const currentSelection = activeSessionSelectionRef.current
        const selectedSessionPath = currentSelection.kind === 'session'
          && currentSelection.agentId === selectedAgentId
          ? currentSelection.sessionPath
          : null
        const matchingRequestForAgent = matchingExternalRequest?.kind === 'session'
          && matchingExternalRequest.agentId !== selectedAgentId
          ? null
          : matchingExternalRequest
        const sessionRestore = selectedSessionPath
          ? { preferredSessionPath: selectedSessionPath }
          : resolveAgentWorkspaceSessionRestore(matchingRequestForAgent, workspaceState)

        return window.appApi.loadAgentWorkspace(
          { agentId: selectedAgentId, workspacePath },
          sessionRestore.preferredSessionPath,
          sessionRestore.options,
        )
      })
      .then(async (nextState) => {
        if (loadAgentStateRequestIdRef.current !== requestId) {
          return
        }

        const currentSelection = activeSessionSelectionRef.current
        const nativeRestoredSessionPath = nextState.activeSession?.sessionPath ?? null
        const acceptedSessionSelection = currentSelection.kind === 'session'
          && targetAgentSessionPath === currentSelection.sessionPath
          ? currentSelection
          : null
        if (
          activeWorkspaceContext.kind === 'conversation'
          && activeConversation
          && nativeRestoredSessionPath
          && activeConversation.agentSessionPath !== nativeRestoredSessionPath
          && onConversationSessionStarted
        ) {
          await onConversationSessionStarted(activeConversation.id, {
            agentSessionPath: nativeRestoredSessionPath,
            lastMessagePreview: activeConversation.lastMessagePreview,
          })
          if (loadAgentStateRequestIdRef.current !== requestId) return
        }
        if (!nextState.runtime.hasConfiguredModels) {
          markAgentUnavailable(selectedAgentId, nextState.runtime.setupHint ?? '当前 Agent 没有可用模型。')
        }
        setAgentState(nextState)
        const nextActiveSessionPath = nextState.activeSession?.sessionPath
        const hasRestoredSession = Boolean(
          nextActiveSessionPath
          && nextState.sessions.some((session) => session.path === nextActiveSessionPath),
        )
        const restoredSessionPath = hasRestoredSession ? nextActiveSessionPath : null
        const nextSelection = shouldStartNewSession
          ? { kind: 'new' as const }
          : acceptedSessionSelection
            ?? (restoredSessionPath
              ? { agentId: selectedAgentId, kind: 'session' as const, sessionPath: restoredSessionPath }
              : { kind: 'new' as const })
        const runtimeOwnsNextSelection = nextSelection.kind === 'session'
          && nextState.activeSession?.sessionPath === nextSelection.sessionPath
          && shouldPersistAgentWorkspaceSelection(nextState.runtime, nextSelection.agentId, workspacePath)
        if (nextSelection.kind === 'new' || runtimeOwnsNextSelection) {
          setViewedSessionSnapshot(null)
        }
        syncActiveSessionSelection(nextSelection)
        const defaultDraft = getRuntimeDefaultModelDraft(nextState.runtime)
        const nextNewSessionDraft = normalizeAgentModelDraft(defaultDraft, nextState.runtime, defaultDraft)
        syncNewSessionModelDraft(nextNewSessionDraft)
        syncModelDraft(nextSelection.kind === 'session'
          ? getRuntimeSelectedModelDraft(nextState.runtime)
          : nextNewSessionDraft)
        setHasLoadedWorkspaceState(true)
      })
      .catch((error) => {
        if (loadAgentStateRequestIdRef.current === requestId) {
          const message = error instanceof Error ? error.message : 'Unable to load Agent sessions.'
          setPanelError(message)
        }
      })
      .finally(() => {
        if (loadAgentStateRequestIdRef.current === requestId) {
          primaryLoadPendingRef.current = false
          setIsLoading(false)
        }
      })
  }, [markAgentUnavailable, selectedAgentId, targetAgentSessionPath, targetWorkspacePath, workspacePath])

  // Opening the Agent selector refreshes discovery in the background. Revalidate
  // the current new-session runtime without replacing the surface with a loader
  // or discarding the user's composer and model drafts.
  useEffect(() => {
    if (runtimeRefreshRevision <= handledRuntimeRefreshRevisionRef.current) {
      return
    }
    handledRuntimeRefreshRevisionRef.current = runtimeRefreshRevision

    const currentSelection = activeSessionSelectionRef.current
    const isCurrentRuntime = workspacePath
      ? shouldPersistAgentWorkspaceSelection(agentState.runtime, selectedAgentId, workspacePath)
      : agentState.runtime.agentId === selectedAgentId && agentState.runtime.workspacePath === null
    if (
      primaryLoadPendingRef.current
      || isLoading
      || !isAgentWorkspacePathReadyForTarget(workspacePath, targetWorkspacePath)
      || currentSelection.kind !== 'new'
      || activeWorkspaceContext.kind === 'conversation'
      || (hasLoadedWorkspaceState && !isCurrentRuntime)
    ) {
      return
    }

    const requestId = backgroundRefreshRequestIdRef.current + 1
    backgroundRefreshRequestIdRef.current = requestId
    setPanelError(null)
    const refreshRequest = workspacePath
      ? window.appApi.loadAgentWorkspace(
          { agentId: selectedAgentId, workspacePath },
          null,
          { restoreSession: false },
        )
      : window.appApi.loadAgentDraftState(selectedAgentId)

    void refreshRequest
      .then((nextState) => {
        if (
          backgroundRefreshRequestIdRef.current !== requestId
          || activeSessionSelectionRef.current.kind !== 'new'
        ) {
          return
        }

        if (!nextState.runtime.hasConfiguredModels) {
          markAgentUnavailable(selectedAgentId, nextState.runtime.setupHint ?? '当前 Agent 没有可用模型。')
        }
        setAgentState(nextState)
        const defaultDraft = getRuntimeDefaultModelDraft(nextState.runtime)
        const nextDraft = normalizeAgentModelDraft(
          newSessionModelDraftRef.current,
          nextState.runtime,
          defaultDraft,
        )
        syncNewSessionModelDraft(nextDraft)
        syncModelDraft(nextDraft)
        setHasLoadedWorkspaceState(true)
      })
      .catch((error) => {
        if (backgroundRefreshRequestIdRef.current !== requestId) {
          return
        }

        const message = error instanceof Error ? error.message : 'Unable to refresh Agent settings.'
        markAgentUnavailable(selectedAgentId, message)
        setPanelError(message)
      })
  }, [
    activeWorkspaceContext.kind,
    agentState.runtime,
    hasLoadedWorkspaceState,
    isLoading,
    markAgentUnavailable,
    newSessionModelDraftRef,
    runtimeRefreshRevision,
    selectedAgentId,
    syncModelDraft,
    syncNewSessionModelDraft,
    targetWorkspacePath,
    workspacePath,
  ])

  useEffect(() => {
    if (
      !workspacePath
      || isLoading
      || !hasLoadedWorkspaceState
      || !isAgentWorkspacePathReadyForTarget(workspacePath, targetWorkspacePath)
      || !shouldPersistAgentWorkspaceSelection(agentState.runtime, selectedAgentId, workspacePath)
    ) {
      return
    }

    const isDraftingNewAgentSession = activeSessionSelection.kind === 'new'
    if (isDraftingNewAgentSession) {
      void window.appApi.updateWorkspaceState(workspacePath, {
        prefersNewAgentSession: true,
      })
    } else {
      void window.appApi.updateWorkspaceState(workspacePath, {
        lastAgentSessionPath: restorableSessionPath ?? null,
        prefersNewAgentSession: false,
      })
    }
  }, [
    activeSessionSelection,
    agentState.runtime.agentId,
    agentState.runtime.workspacePath,
    hasLoadedWorkspaceState,
    isLoading,
    restorableSessionPath,
    selectedAgentId,
    targetWorkspacePath,
    workspacePath,
  ])

  useEffect(() => {
    const pendingExternalState = pendingExternalWorkspaceStateRef.current
    if (pendingExternalState && agentState !== pendingExternalState) {
      return
    }

    if (pendingExternalState === agentState) {
      pendingExternalWorkspaceStateRef.current = null
    }

    locallyEmittedWorkspaceStatesRef.current.add(agentState)
    onWorkspaceStateChange?.(agentState)
  }, [agentState, onWorkspaceStateChange])
}

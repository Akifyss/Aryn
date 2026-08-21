import {
  KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BbTheme } from '@aryn/bb-session-surface'
import {
  type AgentId,
} from '@/features/agent/agent-definition'
import { useAgentCatalog } from '@/features/agent/hooks/use-agent-catalog'
import {
  EMPTY_AGENT_COMPOSER_STATE,
  hasAgentComposerPayload,
  useAgentComposerDraft,
} from '@/features/agent/composer/use-agent-composer-draft'
import {
  resolveSupportedRunningPromptBehavior,
  useAgentComposerActions,
} from '@/features/agent/composer/use-agent-composer-actions'
import { useAgentPromptSubmission } from '@/features/agent/composer/use-agent-prompt-submission'
import {
  type AgentMenuAnchorRect,
  type AgentProjectSwitchMenuOptions,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import {
  AgentChatSurface,
  AgentSessionTree,
} from '@/features/agent/components/agent-chat-surface/agent-chat-surface'
import { useAgentMessagePresentation } from '@/features/agent/components/agent-message-viewport/use-agent-message-presentation'
import { useAgentMessageViewportScroll } from '@/features/agent/components/agent-message-viewport/use-agent-message-viewport-scroll'
import {
  AgentContext,
  type AgentComposerAction,
  type AgentComposerMenu,
  type AgentContextValue,
  type AgentSurfaceMode,
  type ConversationTitleSuggestion,
} from '@/features/agent/components/agent-sidebar/agent-sidebar-context'
import {
  isAgentWorkspaceTargetPreparing,
  resolvePendingAgentNewSessionProject,
  type AgentProjectSessionRequest,
  type AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import type { OptimisticAgentUserMessage } from '@/features/agent/lib/optimistic-user-messages'
import { findVisiblePendingInteraction } from '@/features/agent/lib/interaction-visibility'
import { resolveAgentSessionControlPresentation } from '@/features/agent/lib/agent-surface-state'
import { SESSION_TREE_AGENT_IDS } from '@/features/agent/lib/session-tree'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationSessionStartedPatch,
  ConversationState,
} from '@/features/conversations/types'
import type { ProjectRecord, ProjectState, WorkspaceIconTheme } from '@/features/workspace/types'
import {
  initialAgentFileAutoOpenState,
  resolveNextAgentFileAutoOpen,
  type AgentFileAutoOpenState,
} from '@/features/agent/auto-open-file'
import { useAgentProjectSessions } from '@/features/agent/hooks/use-agent-project-sessions'
import { useAgentSessionMutations } from '@/features/agent/hooks/use-agent-session-mutations'
import { useAgentSessionNavigation } from '@/features/agent/hooks/use-agent-session-navigation'
import { useAgentVisibleSession } from '@/features/agent/hooks/use-agent-visible-session'
import { useAgentModelMutations } from '@/features/agent/model/use-agent-model-mutations'
import {
  useAgentModelDraftState,
  useAgentModelSelectionState,
  useAgentModelSelectionSync,
} from '@/features/agent/model/use-agent-model-state'
import {
  mergeInteractionTimelineRecords,
  useAgentRuntimeEvents,
} from '@/features/agent/runtime/use-agent-runtime-events'
import { useAgentWorkspaceLifecycle } from '@/features/agent/runtime/use-agent-workspace-lifecycle'
import { useSettingsStore } from '@/hooks/use-settings-store'
import type {
  AgentMessageFileChange,
  AgentSessionSnapshot,
  AgentWorkspaceState,
} from '@/features/agent/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'

type AgentSidebarProps = {
  activeWorkspaceContext?: ActiveWorkspaceContext
  conversationState?: ConversationState
  externalSessionRequest?: AgentProjectSessionRequest | null
  onExternalSessionRequestHandled?: (requestId: number) => void
  iconTheme?: WorkspaceIconTheme | null
  onConversationDraftFailed?: (conversationId: string) => Promise<void> | void
  onConversationSessionStarted?: (conversationId: string, patch: ConversationSessionStartedPatch) => Promise<void> | void
  onConversationTitleSuggested?: (conversationId: string, suggestion: ConversationTitleSuggestion) => Promise<void> | void
  onCreateConversationWorkspace?: (request: { agentId?: AgentId, initialPrompt?: string | null }) => Promise<ConversationRecord>
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProviderSettings?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  onOpenProjectFolder?: (project: ProjectRecord) => Promise<void> | void
  onOpenProjectSession?: (
    project: ProjectRecord,
    agentId: AgentId,
    sessionPath: string,
    sessionLabel: string,
  ) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
  projectState?: ProjectState
  isProjectAddMenuOpen?: boolean
  isAgentLayout?: boolean
  surfaceMode?: AgentSurfaceMode
  theme?: BbTheme
  workspaceState?: AgentWorkspaceState | null
  workspacePath: string | null
}

type AgentSurfaceProps = {
  activeWorkspaceContext?: ActiveWorkspaceContext
  conversationState?: ConversationState
  externalSessionRequest?: AgentProjectSessionRequest | null
  onExternalSessionRequestHandled?: (requestId: number) => void
  iconTheme?: WorkspaceIconTheme | null
  onConversationDraftFailed?: (conversationId: string) => Promise<void> | void
  onConversationSessionStarted?: (conversationId: string, patch: ConversationSessionStartedPatch) => Promise<void> | void
  onConversationTitleSuggested?: (conversationId: string, suggestion: ConversationTitleSuggestion) => Promise<void> | void
  onCreateConversationWorkspace?: (request: { agentId?: AgentId, initialPrompt?: string | null }) => Promise<ConversationRecord>
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProviderSettings?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  onOpenProjectFolder?: (project: ProjectRecord) => Promise<void> | void
  onOpenProjectSession?: (
    project: ProjectRecord,
    agentId: AgentId,
    sessionPath: string,
    sessionLabel: string,
  ) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  projectState?: ProjectState
  isProjectAddMenuOpen?: boolean
  isAgentLayout?: boolean
  surfaceMode?: AgentSurfaceMode
  theme?: BbTheme
  workspaceState?: AgentWorkspaceState | null
  workspacePath: string | null
}

type AgentProviderProps = AgentSurfaceProps & {
  children: ReactNode
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
}

const emptyAgentState: AgentWorkspaceState = {
  activeSession: null,
  runtime: {
    agentId: 'builtin-pi',
    auth: {},
    availableModelInputs: {},
    availableModels: [],
    availableThinkingLevels: ['off'],
    availableThinkingLevelsByModel: {},
    compactionReason: null,
    followUpMessageCount: 0,
    followUpMessages: [],
    followUpMode: 'one-at-a-time',
    hasConfiguredModels: false,
    isCompacting: false,
    defaultModel: null,
    defaultThinkingLevel: 'medium',
    isStreaming: false,
    pendingMessageCount: 0,
    preferredModelByProvider: {},
    retryAttempt: 0,
    retryMaxAttempts: null,
    selectedModel: null,
    setupHint: null,
    supportedRunningPromptBehaviors: ['steer', 'followUp'],
    supportsQueuedMessageEditing: true,
    supportsThinking: false,
    steeringMessageCount: 0,
    steeringMessages: [],
    steeringMode: 'one-at-a-time',
    thinkingLevel: 'off',
    workspacePath: null,
  },
  sessions: [],
}

const emptyProjectState: ProjectState = {
  lastProjectId: null,
  projects: [],
}

const emptyConversationState: ConversationState = {
  version: 3,
  conversations: [],
}

const defaultActiveWorkspaceContext: ActiveWorkspaceContext = {
  kind: 'conversationDraft',
}

function AgentProvider({
  activeWorkspaceContext = defaultActiveWorkspaceContext,
  children,
  conversationState = emptyConversationState,
  externalSessionRequest,
  iconTheme,
  onConversationDraftFailed,
  onConversationSessionStarted,
  onConversationTitleSuggested,
  onCreateConversationWorkspace,
  onOpenMessageFile,
  onOpenConversation,
  onRenameConversation,
  onRemoveConversation,
  onExternalSessionRequestHandled,
  onOpenProviderSettings,
  onOpenProjectAddMenu,
  onOpenProjectSwitchMenu,
  onOpenProjectFolder,
  onOpenProjectSession,
  onRemoveProject,
  onStartStandaloneConversation,
  onStartProjectSession,
  onWorkspaceStateChange,
  projectState = emptyProjectState,
  isProjectAddMenuOpen = false,
  isAgentLayout = false,
  surfaceMode = 'docked',
  theme = 'light',
  workspaceState,
  workspacePath,
}: AgentProviderProps) {
  const runningPromptEnterBehavior = useSettingsStore((state) => state.agent.runningPromptEnterBehavior)
  const workspaceTree = useWorkspaceStore((state) => state.tree)
  const [agentState, setAgentState] = useState<AgentWorkspaceState>(emptyAgentState)
  const [viewedSessionSnapshot, setViewedSessionSnapshot] = useState<AgentSessionSnapshot | null>(null)
  const {
    modelDrafts,
    modelInputValue,
    newSessionModelDraftRef,
    selectedProviderValue,
    selectedThinkingLevel,
    setModelDrafts,
    setModelInputValue,
    setSelectedProviderValue,
    syncModelDraft,
    syncNewSessionModelDraft,
  } = useAgentModelDraftState(emptyAgentState.runtime)
  const [activeComposerMenu, setActiveComposerMenu] = useState<AgentComposerMenu>(null)
  const closeComposerMenu = useCallback(() => setActiveComposerMenu(null), [])
  const [activeOverlayPanel, setActiveOverlayPanel] = useState<'sessions' | null>(null)
  const [activeSessionSelection, setActiveSessionSelection] = useState<AgentSessionSelection>({ kind: 'new' })
  const [isLoading, setIsLoading] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<OptimisticAgentUserMessage[]>([])
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false)
  const [agentRuntimeRefreshRevision, setAgentRuntimeRefreshRevision] = useState(0)
  const sessionTreeAgentIds = SESSION_TREE_AGENT_IDS
  const {
    invalidateProjectSessions,
    loadProjectSessions,
    projectSessions,
    storeProjectAgentSessions,
  } = useAgentProjectSessions({ projectState, sessionTreeAgentIds })
  const handleAgentCatalogRefreshed = useCallback(() => {
    invalidateProjectSessions()
    setAgentRuntimeRefreshRevision((revision) => revision + 1)
  }, [invalidateProjectSessions])
  const {
    addComposerFiles,
    clearComposerOptimistically,
    composerAttachments,
    composerAttachmentsRef,
    composerState,
    composerStateRef,
    handlePickComposerAttachments,
    invalidateOptimisticComposerClear,
    removeComposerAttachment,
    restoreOptimisticallyClearedComposer,
    setComposerAttachments,
    setComposerState,
  } = useAgentComposerDraft({ onErrorChange: setPanelError })
  const activeRuntimeSessionRef = useRef<AgentWorkspaceState['activeSession']>(null)
  const modelFieldRef = useRef<HTMLDivElement | null>(null)
  const lastConversationTitleSuggestionKeyRef = useRef<string | null>(null)
  const externalSessionRequestRef = useRef<AgentProjectSessionRequest | null>(externalSessionRequest ?? null)
  const activeSessionSelectionRef = useRef(activeSessionSelection)
  const workspacePathRef = useRef<string | null>(workspacePath)
  const fileAutoOpenStateRef = useRef<AgentFileAutoOpenState>(initialAgentFileAutoOpenState)
  const {
    agentCatalog: resolvedAgentCatalog,
    agentCatalogRefreshError,
    markAgentUnavailable,
    refreshAgentCatalog,
    selectedAgentIdValue,
    setSelectedAgentIdValue,
  } = useAgentCatalog({ onCatalogRefreshed: handleAgentCatalogRefreshed })
  const activeConversation = activeWorkspaceContext.kind === 'conversation'
    ? conversationState.conversations.find((conversation) => conversation.id === activeWorkspaceContext.conversationId) ?? null
    : null
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    : null
  const activeProjectSessionRequest = externalSessionRequest
    && activeWorkspaceContext.kind === 'project'
    && externalSessionRequest.projectId === activeWorkspaceContext.projectId
    ? externalSessionRequest
    : null
  const requestedProjectAgentId = activeProjectSessionRequest?.kind === 'session'
    ? activeProjectSessionRequest.agentId
    : null
  const selectedAgentId = activeConversation?.agentId
    ?? requestedProjectAgentId
    ?? (activeSessionSelection.kind === 'session' ? activeSessionSelection.agentId : selectedAgentIdValue)
  const targetWorkspacePath = activeWorkspaceContext.kind === 'project'
    ? activeProject?.path
    : activeWorkspaceContext.kind === 'conversation'
      ? activeConversation?.workspacePath ?? undefined
      : null
  const targetAgentSessionPath = activeWorkspaceContext.kind === 'conversation'
    ? activeConversation?.agentSessionPath ?? null
    : activeProjectSessionRequest
      ? activeProjectSessionRequest.kind === 'session' ? activeProjectSessionRequest.sessionPath : null
      : undefined
  const isUnavailableConversationWorkspace = activeWorkspaceContext.kind === 'conversation'
    && Boolean(activeConversation)
    && !activeConversation?.workspacePath
  const isWorkspaceContextPreparing = !isUnavailableConversationWorkspace
    && isAgentWorkspaceTargetPreparing({
      currentWorkspacePath: workspacePath,
      hasLoadedWorkspaceState,
      runtime: agentState.runtime,
      selectedAgentId,
      targetWorkspacePath,
    })
  const sessionControlTarget = useMemo(() => {
    return resolveAgentSessionControlPresentation({
      activeProject,
      activeSelection: activeSessionSelection,
      activeWorkspaceContext,
      projectSessions,
      request: externalSessionRequest,
      runtime: agentState.runtime,
      sessions: agentState.sessions,
    })
  }, [
    activeProject,
    activeSessionSelection,
    activeWorkspaceContext,
    agentState.runtime.agentId,
    agentState.runtime.workspacePath,
    agentState.sessions,
    externalSessionRequest,
    projectSessions,
  ])
  const selectedAgentIdRef = useRef(selectedAgentId)
  const effectiveRunningPromptEnterBehavior = resolveSupportedRunningPromptBehavior(
    agentState.runtime.supportedRunningPromptBehaviors,
    runningPromptEnterBehavior,
  )
  activeRuntimeSessionRef.current = agentState.activeSession
  selectedAgentIdRef.current = selectedAgentId

  const setSelectedAgentId = useCallback((agentId: AgentId) => {
    if (activeConversation) {
      return
    }

    const availability = resolvedAgentCatalog.find((item) => item.definition.id === agentId)
    if (availability && !availability.available) {
      return
    }

    setSelectedAgentIdValue(agentId)
  }, [activeConversation, resolvedAgentCatalog])

  const restorableSessionPath = agentState.activeSession?.sessionPath
    && agentState.sessions.some((session) => session.path === agentState.activeSession?.sessionPath)
    ? agentState.activeSession.sessionPath
    : null
  const canUseDraftRuntimeWithoutWorkspace = Boolean(
    !workspacePath
    && activeWorkspaceContext.kind === 'conversationDraft'
    && activeSessionSelection.kind === 'new',
  )

  function syncActiveSessionSelection(selection: AgentSessionSelection) {
    activeSessionSelectionRef.current = selection
    setActiveSessionSelection(selection)
  }

  useEffect(() => {
    activeSessionSelectionRef.current = activeSessionSelection
  }, [activeSessionSelection])

  externalSessionRequestRef.current = externalSessionRequest ?? null
  workspacePathRef.current = workspacePath

  useEffect(() => {
    const agentWorkspacePath = agentState.runtime.workspacePath
    if (!agentWorkspacePath) return
    storeProjectAgentSessions(agentWorkspacePath, agentState.runtime.agentId, agentState.sessions)
  }, [agentState.runtime.agentId, agentState.runtime.workspacePath, agentState.sessions, storeProjectAgentSessions])

  const {
    clearAssistantDraft,
    clearLiveTools,
    draftAssistant,
    draftThinking,
    isThinkingStreaming,
    interactionTimelineRecords,
    liveTools,
    pendingInteractions,
    recordInteractionResponse,
    resetRunDrafts,
    sessionActivityById,
    setPendingInteractions,
    streamStartedAt,
  } = useAgentRuntimeEvents({
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
  })
  useAgentWorkspaceLifecycle({
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
      revision: agentRuntimeRefreshRevision,
    },
    state: {
      agentState,
      hasLoadedWorkspaceState,
      initialAgentState: emptyAgentState,
      isLoading,
      resetComposer: () => {
        setComposerState(EMPTY_AGENT_COMPOSER_STATE)
        setComposerAttachments([])
      },
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
  })

  useEffect(() => {
    if (!activeComposerMenu) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (modelFieldRef.current?.contains(target)) {
        return
      }

      if (target instanceof Element && target.closest('[data-agent-model-cascader="true"]')) {
        return
      }

      setActiveComposerMenu(null)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveComposerMenu(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeComposerMenu])

  const {
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
  } = useAgentSessionNavigation({
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
      closeSessionOverlay: () => setActiveOverlayPanel(null),
      resetComposer: () => {
        setComposerState(EMPTY_AGENT_COMPOSER_STATE)
        setComposerAttachments([])
      },
      setAgentState,
      setPanelError,
      setViewedSessionSnapshot,
    },
  })

  const {
    activeSession,
    activeSessionPath,
    codexNativeSession,
    codexOptimisticUserMessages,
    isOpenCodeChildSession,
    isViewingActiveRuntime,
    openCodeNativeSession,
    openCodeOptimisticUserMessages,
    piWebNativeSession,
    piWebOptimisticUserMessages,
    visiblePersistedMessages,
    visibleRuntime,
    visibleSessionSnapshot,
  } = useAgentVisibleSession({
    activeSessionSelection: sessionPresentation.selection,
    activeSessionSnapshot: agentState.activeSession,
    optimisticUserMessages,
    runtime: agentState.runtime,
    selectedAgentId: sessionPresentation.agentId,
    sessions: agentState.sessions,
    setOptimisticUserMessages,
    viewedSessionSnapshot,
    workspacePath: sessionPresentation.workspacePath,
  })
  const pendingInteraction = findVisiblePendingInteraction({
    activeRuntimeSessionId: agentState.activeSession?.sessionId ?? null,
    isViewingActiveRuntime,
    pendingInteractions,
    selectedAgentId: sessionPresentation.agentId,
    workspacePath: sessionPresentation.workspacePath,
  })
  const visibleInteractionTimelineRecords = useMemo(() => mergeInteractionTimelineRecords(
    interactionTimelineRecords,
    visibleSessionSnapshot?.interactionHistory ?? [],
  ), [interactionTimelineRecords, visibleSessionSnapshot?.interactionHistory])

  useEffect(() => {
    if (activeWorkspaceContext.kind !== 'conversation' || !onConversationTitleSuggested) {
      return
    }

    const runtimeSessionTitle = isViewingActiveRuntime
      && agentState.activeSession?.sessionPath === activeSessionPath
      ? agentState.activeSession.name
      : null
    const suggestedTitle = (runtimeSessionTitle ?? activeSession?.name ?? '').trim()
    const suggestedSessionPath = activeSession?.path
      ?? (
        isViewingActiveRuntime && agentState.activeSession?.sessionPath === activeSessionPath
          ? agentState.activeSession.sessionPath
          : null
      )

    if (!suggestedTitle || !suggestedSessionPath) {
      return
    }

    const conversation = conversationState.conversations.find((item) => (
      item.id === activeWorkspaceContext.conversationId
    )) ?? null

    if (
      !conversation
      || conversation.agentSessionPath !== suggestedSessionPath
      || conversation.titleSource === 'user'
      || conversation.title.trim() === suggestedTitle
    ) {
      return
    }

    const suggestionKey = `${conversation.id}:${suggestedSessionPath}:${suggestedTitle}`
    if (lastConversationTitleSuggestionKeyRef.current === suggestionKey) {
      return
    }
    lastConversationTitleSuggestionKeyRef.current = suggestionKey

    void Promise.resolve(onConversationTitleSuggested(conversation.id, {
      agentSessionPath: suggestedSessionPath,
      title: suggestedTitle,
    })).catch((error) => {
      if (lastConversationTitleSuggestionKeyRef.current === suggestionKey) {
        lastConversationTitleSuggestionKeyRef.current = null
      }
      setPanelError(error instanceof Error ? error.message : 'Unable to update the conversation title.')
    })
  }, [
    activeSession?.name,
    activeSession?.path,
    activeSessionPath,
    activeWorkspaceContext,
    agentState.activeSession?.name,
    agentState.activeSession?.sessionPath,
    conversationState.conversations,
    isViewingActiveRuntime,
    onConversationTitleSuggested,
  ])

  const {
    contentRevisions: messageViewportContentRevisions,
    latestAutoOpenFileChange,
    piWebFileChanges,
    renderedMessages,
    roundFileChangesByMessageId,
    sessionStatus,
  } = useAgentMessagePresentation({
    drafts: {
      assistant: draftAssistant,
      isThinkingStreaming,
      thinking: draftThinking,
    },
    panelError,
    runtime: {
      active: agentState.runtime,
      isViewingActive: isViewingActiveRuntime,
      liveTools,
      visible: visibleRuntime,
    },
    session: {
      optimisticUserMessages: codexOptimisticUserMessages,
      persistedMessages: visiblePersistedMessages,
      snapshot: visibleSessionSnapshot,
    },
    workspacePath: sessionPresentation.workspacePath,
  })

  const isWorkspaceSessionLoading = Boolean(
    isLoading
    && !visibleSessionSnapshot
    && activeWorkspaceContext.kind === 'project'
    && !(
      externalSessionRequest?.kind === 'new'
      && externalSessionRequest.projectId === activeWorkspaceContext.projectId
    ),
  )
  const pendingNewSessionProject = resolvePendingAgentNewSessionProject(
    externalSessionRequest,
    activeWorkspaceContext,
    projectState.projects,
  )
  const isImmediateNewConversationSurface = Boolean(
    isExplicitNewConversationPresentation
    || pendingNewSessionProject
    || activeWorkspaceContext.kind === 'conversationDraft',
  )
  const isSessionLoading = isSessionSnapshotLoading || isWorkspaceSessionLoading
  const showSessionLoadingIndicator = !isImmediateNewConversationSurface && (
    showSessionSnapshotLoadingIndicator || isWorkspaceSessionLoading
  )
  const selectedSessionPath = activeSessionSelection.kind === 'session'
    ? activeSessionSelection.sessionPath
    : null
  const {
    deletingSessionPath,
    handleDeleteSession,
    handleRenameSession,
  } = useAgentSessionMutations({
    model: {
      newSessionModelDraftRef,
      syncModelDraft,
    },
    navigation: {
      activeSessionSelectionRef,
      selectedAgentIdRef,
      syncActiveSessionSelection,
      workspacePathRef,
    },
    state: {
      setAgentState,
      setPanelError,
      setViewedSessionSnapshot,
    },
    storeProjectAgentSessions,
  })

  const {
    isSubmittingComposerPrompt,
    submitComposerPrompt,
  } = useAgentPromptSubmission({
    composer: {
      clearAssistantDraft,
      clearComposerOptimistically,
      clearLiveTools,
      closeComposerMenu,
      composerAttachmentsRef,
      composerStateRef,
      invalidateOptimisticComposerClear,
      restoreOptimisticallyClearedComposer,
    },
    conversation: {
      activeConversation,
      activeWorkspaceContext,
      onConversationDraftFailed,
      onConversationSessionStarted,
      onCreateConversationWorkspace,
    },
    navigation: {
      activeRuntimeSessionRef,
      activeSessionSelectionRef,
      ensureSelectedAgentSessionActive,
      openSessionRequestIdRef,
      selectedAgentId,
      selectedAgentIdRef,
      syncActiveSessionSelection,
      workspacePath,
      workspacePathRef,
    },
    state: {
      agentState,
      markWorkspaceStateLoaded: () => setHasLoadedWorkspaceState(true),
      newSessionModelDraftRef,
      setAgentState,
      setLoading: setIsLoading,
      setOptimisticUserMessages,
      setPanelError,
      setViewedSessionSnapshot,
      syncModelDraft,
      syncNewSessionModelDraft,
    },
  })
  const hasComposerPayload = hasAgentComposerPayload(composerState, composerAttachments)
  const isConversationDraftContext = activeWorkspaceContext.kind === 'conversationDraft'
  const canCreateConversationWorkspace = Boolean(isConversationDraftContext && onCreateConversationWorkspace)
  const canUseComposerWithoutWorkspace = Boolean(!workspacePath && canCreateConversationWorkspace)
  const canSend = Boolean(
    hasComposerPayload
    && !isOpenCodeChildSession
    && !isSubmittingComposerPrompt
    && !isSessionLoading
    && !isWorkspaceContextPreparing
    && (
      (workspacePath && agentState.runtime.hasConfiguredModels)
      || (canUseComposerWithoutWorkspace && agentState.runtime.hasConfiguredModels)
    ),
  )
  const canStopActivePrompt = Boolean(
    workspacePath
    && !isOpenCodeChildSession
    && isViewingActiveRuntime
    && agentState.runtime.isStreaming
    && !isLoading
  )
  const composerAction: AgentComposerAction = canStopActivePrompt && !hasComposerPayload
    ? 'stop'
    : 'send'
  const canPerformComposerAction = composerAction === 'stop'
    ? canStopActivePrompt
    : canSend
  const shouldShowComposerSendSpinner = composerAction === 'send'
    && isSubmittingComposerPrompt
    && activeSessionSelection.kind === 'new'
  const streamingShortcutModifierLabel = window.appApi.platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter'
  const {
    handleComposerKeyDown,
    handleQueuedMessageUpdate,
    handleSubmit,
    respondToInteraction,
    stoppingPrompt,
  } = useAgentComposerActions({
    agentState,
    canPerformComposerAction,
    closeComposerMenu,
    composerAttachmentsRef,
    composerStateRef,
    effectiveRunningPromptEnterBehavior,
    isAgentSessionOperationCurrent,
    isViewingActiveRuntime,
    pendingInteractions,
    recordInteractionResponse,
    resetRunDrafts,
    selectedAgentId,
    setAgentState,
    setPanelError,
    setPendingInteractions,
    submitComposerPrompt,
    workspacePath,
  })

  const {
    configuredProviders,
    hasConfiguredProviders,
    providerModelIds,
    resolvedSelectedProviderValue,
    selectedModelSupportsImages,
    thinkingLevel,
    thinkingLevelLabel,
  } = useAgentModelSelectionState({
    modelInputValue,
    runtime: agentState.runtime,
    selectedProviderValue,
    selectedThinkingLevel,
  })
  const {
    handleSelectModel,
    handleThinkingLevelSelection,
    isSwitchingModel,
    isSwitchingThinkingLevel,
  } = useAgentModelMutations({
    model: {
      modelInputValue,
      resolvedSelectedProviderValue,
      selectedThinkingLevel,
      syncModelDraft,
      syncNewSessionModelDraft,
    },
    navigation: {
      activeSessionSelectionRef,
      ensureSelectedAgentSessionActive,
      isAgentSessionOperationCurrent,
      selectedAgentId,
      workspacePath,
    },
    state: {
      agentState,
      canUseDraftRuntimeWithoutWorkspace,
      closeModelMenu: closeComposerMenu,
      setAgentState,
      setPanelError,
    },
  })
  const hasImageComposerAttachments = composerAttachments.some((attachment) => attachment.kind === 'image')
  const attachmentCapabilityMessage = !isWorkspaceContextPreparing
    && hasImageComposerAttachments
    && !selectedModelSupportsImages
    ? '当前模型不支持图片输入，图片不会作为视觉内容发送。'
    : null
  const statusMessage = isWorkspaceContextPreparing
    ? null
    : isOpenCodeChildSession
    ? 'OpenCode 子会话由父会话中的子 Agent 管理，请返回父会话继续输入。'
    : hasLoadedWorkspaceState && !agentState.runtime.hasConfiguredModels
    ? (agentState.runtime.setupHint ?? '请先配置可用模型。')
    : !workspacePath && activeWorkspaceContext.kind === 'conversation'
    ? '该对话的工作目录不可用。'
    : null
  const {
    messagesScrollElement,
    messagesScrollViewportRef,
  } = useAgentMessageViewportScroll({
    activeSessionPath,
    contentRevisions: messageViewportContentRevisions,
  })

  useAgentModelSelectionSync({
    closeModelMenu: closeComposerMenu,
    hasConfiguredProviders,
    isModelMenuOpen: activeComposerMenu === 'model-cascader',
    modelDrafts,
    preferredModelByProvider: agentState.runtime.preferredModelByProvider,
    providerModelIds,
    resolvedSelectedProviderValue,
    selectedProviderValue,
    setModelInputValue,
    setSelectedProviderValue,
  })

  useEffect(() => {
    const result = resolveNextAgentFileAutoOpen(fileAutoOpenStateRef.current, {
      activeSessionPath,
      isViewingActiveRuntime,
      latestFileChange: latestAutoOpenFileChange,
    })
    fileAutoOpenStateRef.current = result.state

    if (result.fileChange) {
      void onOpenMessageFile?.(result.fileChange.filePath, result.fileChange.kind)
    }
  }, [activeSessionPath, isViewingActiveRuntime, latestAutoOpenFileChange, onOpenMessageFile])

  const contextValue = useMemo<AgentContextValue>(() => ({
    agentCatalog: resolvedAgentCatalog,
    agentCatalogRefreshError,
    activeComposerMenu,
    activeOverlayPanel,
    activeSession,
    activeSessionSelection,
    activeSessionPath: selectedSessionPath,
    activeWorkspaceContext,
    agentState,
    addComposerFiles,
    attachmentCapabilityMessage,
    canPerformComposerAction,
    canUseDraftRuntimeWithoutWorkspace,
    canUseComposerWithoutWorkspace,
    composerAction,
    composerAttachments,
    composerState,
    configuredProviders,
    conversationState,
    deletingSessionPath,
    draftAssistant,
    draftThinking,
    handleComposerKeyDown,
    handleDeleteSession,
    handleOpenSession,
    handlePrefetchSession,
    handleRenameSession,
    handleSelectModel,
    handleThinkingLevelSelection,
    handlePickComposerAttachments,
    handleQueuedMessageUpdate,
    handleStartNewSession,
    handleSubmit,
    hasComposerPayload,
    hasConfiguredProviders,
    iconTheme,
    isAgentLayout,
    isViewingActiveRuntime,
    isProjectAddMenuOpen,
    isLoading,
    isWorkspaceContextPreparing,
    isNewConversationSurfaceImmediate: isImmediateNewConversationSurface,
    isSessionLoading,
    showSessionLoadingIndicator,
    isThinkingStreaming,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    interactionTimelineRecords: visibleInteractionTimelineRecords,
    liveTools,
    loadProjectSessions,
    messagesScrollElement,
    messagesScrollViewportRef,
    modelFieldRef,
    modelInputValue,
    onConversationDraftFailed,
    onConversationSessionStarted,
    onConversationTitleSuggested,
    onCreateConversationWorkspace,
    onOpenMessageFile,
    onOpenConversation,
    onRenameConversation,
    onRemoveConversation,
    onOpenProviderSettings,
    onOpenProjectAddMenu,
    onOpenProjectSwitchMenu,
    onOpenProjectFolder,
    onOpenProjectSession,
    onRemoveProject,
    onStartStandaloneConversation,
    onStartProjectSession,
    codexNativeSession,
    codexOptimisticUserMessages,
    openCodeNativeSession,
    openCodeOptimisticUserMessages,
    piWebFileChanges,
    piWebNativeSession,
    piWebOptimisticUserMessages,
    panelError,
    pendingInteraction,
    projectSessions,
    projectState,
    refreshAgentCatalog,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionActivityById,
    sessionTreeAgentIds,
    shouldShowComposerSendSpinner,
    removeComposerAttachment,
    respondToInteraction,
    sessionStatus,
    sessionControlTarget,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setPanelError,
    selectedAgentId,
    visibleAgentId: sessionPresentation.agentId,
    visibleSessionPath: activeSessionPath,
    visibleSessionSelection: sessionPresentation.selection,
    visibleWorkspacePath: sessionPresentation.workspacePath,
    setSelectedAgentId,
    statusMessage,
    stoppingPrompt,
    streamStartedAt,
    surfaceMode,
    streamingShortcutModifierLabel,
    thinkingLevel,
    thinkingLevelLabel,
    theme,
    workspacePath,
    workspaceTree,
  }), [
    activeWorkspaceContext,
    resolvedAgentCatalog,
    agentCatalogRefreshError,
    activeComposerMenu,
    activeOverlayPanel,
    activeSession,
    activeSessionSelection,
    activeSessionPath,
    selectedSessionPath,
    agentState,
    addComposerFiles,
    attachmentCapabilityMessage,
    canPerformComposerAction,
    canUseDraftRuntimeWithoutWorkspace,
    canUseComposerWithoutWorkspace,
    composerAction,
    composerAttachments,
    composerState,
    configuredProviders,
    conversationState,
    deletingSessionPath,
    draftAssistant,
    draftThinking,
    handleComposerKeyDown,
    handleDeleteSession,
    handleOpenSession,
    handlePrefetchSession,
    handleRenameSession,
    handleSelectModel,
    handleThinkingLevelSelection,
    handlePickComposerAttachments,
    handleQueuedMessageUpdate,
    handleStartNewSession,
    handleSubmit,
    hasComposerPayload,
    hasConfiguredProviders,
    iconTheme,
    isAgentLayout,
    isViewingActiveRuntime,
    isProjectAddMenuOpen,
    isLoading,
    isWorkspaceContextPreparing,
    isImmediateNewConversationSurface,
    isSessionLoading,
    showSessionLoadingIndicator,
    isThinkingStreaming,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    visibleInteractionTimelineRecords,
    liveTools,
    loadProjectSessions,
    messagesScrollElement,
    messagesScrollViewportRef,
    modelInputValue,
    onConversationDraftFailed,
    onConversationSessionStarted,
    onConversationTitleSuggested,
    onCreateConversationWorkspace,
    onOpenMessageFile,
    onOpenConversation,
    onRenameConversation,
    onRemoveConversation,
    onOpenProviderSettings,
    onOpenProjectAddMenu,
    onOpenProjectSwitchMenu,
    onOpenProjectFolder,
    onOpenProjectSession,
    onRemoveProject,
    onStartStandaloneConversation,
    onStartProjectSession,
    codexNativeSession,
    openCodeNativeSession,
    piWebFileChanges,
    piWebNativeSession,
    panelError,
    pendingInteraction,
    projectSessions,
    projectState,
    refreshAgentCatalog,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionActivityById,
    sessionTreeAgentIds,
    shouldShowComposerSendSpinner,
    removeComposerAttachment,
    respondToInteraction,
    sessionStatus,
    codexOptimisticUserMessages,
    openCodeOptimisticUserMessages,
    piWebOptimisticUserMessages,
    selectedAgentId,
    sessionPresentation,
    sessionControlTarget,
    setSelectedAgentId,
    statusMessage,
    stoppingPrompt,
    streamStartedAt,
    surfaceMode,
    streamingShortcutModifierLabel,
    thinkingLevel,
    thinkingLevelLabel,
    theme,
    workspacePath,
    workspaceTree,
  ])

  return (
    <AgentContext.Provider value={contextValue}>
      {children}
    </AgentContext.Provider>
  )
}

function AgentSidebar(props: AgentSidebarProps) {
  return (
    <AgentProvider {...props}>
      <AgentChatSurface />
    </AgentProvider>
  )
}

export {
  AgentChatSurface,
  type AgentProjectSessionRequest,
  AgentProvider,
  AgentSessionTree,
  AgentSidebar,
}

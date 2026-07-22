import {
  createContext,
  FormEvent,
  KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Menu } from '@base-ui/react/menu'
import { Button, ScrollShadow, Spinner } from '@heroui/react'
import type { OpenCodeOptimisticUserMessage } from '@aryn/opencode-session-surface'
import type {
  PiWebAgentMessage,
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
} from '@aryn/pi-web-session-surface'
import {
  AttachmentLine,
  ArrowUpLine,
  DownLine,
  EditLine,
  StopFill,
  ToolLine,
} from '@mingcute/react'
import { AppTooltip, AppTooltipButton } from '@/components/app-tooltip'
import { getAgentProviderOrder } from '@/features/agent/provider-auth'
import {
  getAgentDefinition,
  type AgentAvailability,
  type AgentId,
} from '@/features/agent/agent-definition'
import { useAgentCatalog } from '@/features/agent/hooks/use-agent-catalog'
import {
  EMPTY_AGENT_COMPOSER_STATE,
  hasAgentComposerPayload,
  type AgentComposerAttachment,
  type AgentComposerState,
  useAgentComposerDraft,
} from '@/features/agent/composer/use-agent-composer-draft'
import {
  useAgentComposerActions,
  resolveSupportedRunningPromptBehavior,
} from '@/features/agent/composer/use-agent-composer-actions'
import {
  type OptimisticAgentUserMessage,
  useAgentPromptSubmission,
} from '@/features/agent/composer/use-agent-prompt-submission'
import { AgentComposerMentionInput } from '@/features/agent/components/agent-composer-mention-input'
import { AgentBrandIcon } from '@/features/agent/components/agent-brand-icon/agent-brand-icon'
import { AgentAttachmentFileCard } from '@/features/agent/components/agent-file-card/agent-file-card'
import { AgentTypeSwitch } from '@/features/agent/components/agent-type-switch/agent-type-switch'
import { AgentModelCascader } from '@/features/agent/components/agent-model-cascader/agent-model-cascader'
import {
  AgentQueuedComposerTray,
  type AgentQueuedComposerMessage,
} from '@/features/agent/components/agent-queued-composer-tray/agent-queued-composer-tray'
import {
  AgentProjectSwitchTrigger,
  AgentSessionTreeView,
  type AgentMenuAnchorRect,
  type AgentProjectSwitchMenuOptions,
  type AgentSessionTreeProps,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import { AgentMessageViewport } from '@/features/agent/components/agent-message-viewport/agent-message-viewport'
import { useAgentMessageViewportScroll } from '@/features/agent/components/agent-message-viewport/use-agent-message-viewport-scroll'
import {
  deriveAgentSessionPhase,
  formatAgentSessionStatus,
  type AgentSessionPhase,
  type AgentSessionStatus,
} from '@/features/agent/components/agent-session-status/agent-session-status'
import { CodexSessionTimeline } from '@/features/agent/components/codex-session-timeline'
import { isAgentKeyboardCompositionEvent } from '@/features/agent/lib/keyboard'
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'
import {
  type AgentProjectSessionRequest,
  type AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import { shouldShowAgentNewConversationPrompt } from '@/features/agent/lib/agent-surface-state'
import {
  formatAgentSessionLabel,
  normalizeAgentProjectPath,
  SESSION_TREE_AGENT_IDS,
  type AgentProjectSessionBucket,
} from '@/features/agent/lib/session-tree'
import {
  getOpenCodeNativeRenderKey,
  getOpenCodeUserMessageText,
} from '@/features/agent/lib/opencode-timeline'
import {
  clampAgentThinkingLevel,
  createAgentModelDraft,
  formatThinkingLevelLabel,
  getAgentModelKey,
  getRuntimeDefaultModelDraft,
  getRuntimeSelectedModelDraft,
  normalizeAgentModelDraft,
  parseModelSelection,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationSessionStartedPatch,
  ConversationState,
} from '@/features/conversations/types'
import type { ProjectRecord, ProjectState, WorkspaceIconTheme } from '@/features/workspace/types'
import {
  findLatestOpenableAgentFileChange,
  initialAgentFileAutoOpenState,
  resolveNextAgentFileAutoOpen,
  type AgentFileAutoOpenState,
} from '@/features/agent/auto-open-file'
import { buildRoundFileChangesByMessageId } from '@/features/agent/round-file-changes'
import { mergeFileChangesByPath } from '@/features/agent/file-change-utils'
import { useAgentProjectSessions } from '@/features/agent/hooks/use-agent-project-sessions'
import { useAgentSessionMutations } from '@/features/agent/hooks/use-agent-session-mutations'
import { useAgentSessionNavigation } from '@/features/agent/hooks/use-agent-session-navigation'
import {
  type AgentLiveToolState,
  useAgentRuntimeEvents,
} from '@/features/agent/runtime/use-agent-runtime-events'
import { useAgentWorkspaceLifecycle } from '@/features/agent/runtime/use-agent-workspace-lifecycle'
import {
  AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS,
  getAlternateRunningPromptBehavior,
  useSettingsStore,
} from '@/hooks/use-settings-store'
import type {
  AgentInteractionRequest,
  AgentMessageFileChange,
  AgentQueuedMessageUpdate,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentThinkingLevel,
  AgentWorkspaceState,
  CodexNativeSessionSnapshot,
  OpenCodeNativeSessionSnapshot,
} from '@/features/agent/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import './styles.css'

type AgentSurfaceMode = 'docked' | 'drawer'

type ConversationTitleSuggestion = {
  agentSessionPath: string
  title: string
}

function getPiWebUserMessageText(message: PiWebAgentMessage) {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content.flatMap((part) => (
    part
      && typeof part === 'object'
      && (part as { type?: unknown }).type === 'text'
      && typeof (part as { text?: unknown }).text === 'string'
      ? [(part as { text: string }).text]
      : []
  )).join('\n')
}

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
  onOpenProjectSession?: (project: ProjectRecord, agentId: AgentId, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
  projectState?: ProjectState
  isProjectAddMenuOpen?: boolean
  isAgentLayout?: boolean
  surfaceMode?: AgentSurfaceMode
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
  onOpenProjectSession?: (project: ProjectRecord, agentId: AgentId, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  projectState?: ProjectState
  isProjectAddMenuOpen?: boolean
  isAgentLayout?: boolean
  surfaceMode?: AgentSurfaceMode
  workspaceState?: AgentWorkspaceState | null
  workspacePath: string | null
}

type AgentProviderProps = AgentSurfaceProps & {
  children: ReactNode
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
}

type AgentComposerAction = 'send' | 'stop'

type AgentComposerMenu = 'model-cascader' | null

const AGENT_SESSION_MENU_POSITIONER_PROPS = {
  className: 'agent-session-menu-positioner',
  collisionAvoidance: { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
  collisionPadding: 8,
  positionMethod: 'fixed',
  side: 'bottom',
  sideOffset: 8,
} as const

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

function buildQueuedComposerMessages(runtime: AgentWorkspaceState['runtime']): AgentQueuedComposerMessage[] {
  return [
    ...runtime.steeringMessages.map((text, index) => ({
      id: `steer:${index}:${text}`,
      index,
      kind: 'steer' as const,
      text,
    })),
    ...runtime.followUpMessages.map((text, index) => ({
      id: `followUp:${index}:${text}`,
      index,
      kind: 'followUp' as const,
      text,
    })),
  ]
}

type AgentContextValue = {
  agentCatalog: AgentAvailability[]
  agentCatalogRefreshError: string | null
  activeWorkspaceContext: ActiveWorkspaceContext
  activeComposerMenu: AgentComposerMenu
  activeOverlayPanel: 'sessions' | null
  activeSession: AgentWorkspaceState['sessions'][number] | null
  activeSessionSelection: AgentSessionSelection
  activeSessionPath: string | null
  agentState: AgentWorkspaceState
  addComposerFiles: (files: File[]) => Promise<void>
  attachmentCapabilityMessage: string | null
  canPerformComposerAction: boolean
  canUseDraftRuntimeWithoutWorkspace: boolean
  canUseComposerWithoutWorkspace: boolean
  composerAction: AgentComposerAction
  composerAttachments: AgentComposerAttachment[]
  composerState: AgentComposerState
  configuredProviders: string[]
  conversationState: ConversationState
  deletingSessionPath: string | null
  handleComposerKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  handleDeleteSession: (rootPath: string, agentId: AgentId, sessionPath: string) => Promise<void>
  handleOpenSession: (agentId: AgentId, sessionPath: string) => Promise<void>
  handleRenameSession: (rootPath: string, agentId: AgentId, sessionPath: string, name: string) => Promise<void>
  handleSelectModel: (modelKey: string) => Promise<void>
  handleThinkingLevelSelection: (level: AgentThinkingLevel, modelKey?: string) => Promise<void>
  handlePickComposerAttachments: () => Promise<void>
  handleQueuedMessageUpdate: (update: AgentQueuedMessageUpdate) => Promise<void>
  handleStartNewSession: () => void
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  hasComposerPayload: boolean
  hasConfiguredProviders: boolean
  iconTheme?: WorkspaceIconTheme | null
  isAgentLayout: boolean
  isProjectAddMenuOpen: boolean
  isLoading: boolean
  isSwitchingModel: boolean
  isSwitchingThinkingLevel: boolean
  liveTools: AgentLiveToolState[]
  messagesScrollElement: HTMLDivElement | null
  messagesScrollViewportRef: (element: HTMLDivElement | null) => void
  modelFieldRef: React.RefObject<HTMLDivElement | null>
  modelInputValue: string
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
  onOpenProjectSession?: (project: ProjectRecord, agentId: AgentId, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  codexNativeSession: CodexNativeSessionSnapshot | null
  codexOptimisticUserMessages: AgentSidebarMessage[]
  openCodeNativeSession: OpenCodeNativeSessionSnapshot | null
  openCodeOptimisticUserMessages: OpenCodeOptimisticUserMessage[]
  piWebFileChanges: AgentMessageFileChange[]
  piWebNativeSession: PiWebNativeSessionSnapshot | null
  piWebOptimisticUserMessages: PiWebOptimisticUserMessage[]
  piWebStreamingStatus: AgentSessionStatus | null
  panelError: string | null
  pendingInteraction: AgentInteractionRequest | null
  loadProjectSessions: (project: ProjectRecord) => Promise<void>
  projectSessions: Record<string, AgentProjectSessionBucket>
  projectState: ProjectState
  refreshAgentCatalog: () => Promise<void>
  renderedMessages: AgentSidebarMessage[]
  resolvedSelectedProviderValue: string
  roundFileChangesByMessageId: Map<string, AgentMessageFileChange[]>
  sessionActivityById: Record<string, 'running' | 'waiting'>
  sessionTreeAgentIds: readonly AgentId[]
  shouldShowComposerSendSpinner: boolean
  removeComposerAttachment: (attachmentId: string) => void
  respondToInteraction: (
    requestId: string,
    optionId: string,
    values?: string[],
    answers?: Record<string, string[]>,
  ) => Promise<void>
  sessionStatus: AgentSessionStatus | null
  setActiveComposerMenu: React.Dispatch<React.SetStateAction<AgentComposerMenu>>
  setActiveOverlayPanel: React.Dispatch<React.SetStateAction<'sessions' | null>>
  setComposerState: React.Dispatch<React.SetStateAction<AgentComposerState>>
  setPanelError: React.Dispatch<React.SetStateAction<string | null>>
  selectedAgentId: AgentId
  setSelectedAgentId: (agentId: AgentId) => void
  statusMessage: string | null
  surfaceMode: AgentSurfaceMode
  streamingShortcutModifierLabel: string
  thinkingLevel: AgentThinkingLevel
  thinkingLevelLabel: string
  workspacePath: string | null
  workspaceTree: ReturnType<typeof useWorkspaceStore.getState>['tree']
}

const AgentContext = createContext<AgentContextValue | null>(null)

function useAgentContext() {
  const context = useContext(AgentContext)

  if (!context) {
    throw new Error('Agent surfaces must be rendered inside AgentProvider.')
  }

  return context
}

function isAgentTreeMenuEventTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-agent-tree-menu-root="true"]'))
}

function AgentInlineSpinner({ className }: { className?: string }) {
  return (
    <Spinner
      aria-hidden='true'
      className={`agent-inline-spinner size-4${className ? ` ${className}` : ''}`}
      color='current'
      size='sm'
    />
  )
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
  workspaceState,
  workspacePath,
}: AgentProviderProps) {
  const runningPromptEnterBehavior = useSettingsStore((state) => state.agent.runningPromptEnterBehavior)
  const workspaceTree = useWorkspaceStore((state) => state.tree)
  const defaultModelSelection = parseModelSelection(null)
  const [agentState, setAgentState] = useState<AgentWorkspaceState>(emptyAgentState)
  const [viewedSessionSnapshot, setViewedSessionSnapshot] = useState<AgentSessionSnapshot | null>(null)
  const [modelInputValue, setModelInputValue] = useState(defaultModelSelection.modelId)
  const [selectedProviderValue, setSelectedProviderValue] = useState(defaultModelSelection.provider)
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<AgentThinkingLevel>(emptyAgentState.runtime.defaultThinkingLevel)
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({
    [defaultModelSelection.provider]: defaultModelSelection.modelId,
  })
  const [activeComposerMenu, setActiveComposerMenu] = useState<AgentComposerMenu>(null)
  const [activeOverlayPanel, setActiveOverlayPanel] = useState<'sessions' | null>(null)
  const [activeSessionSelection, setActiveSessionSelection] = useState<AgentSessionSelection>({ kind: 'new' })
  const [isLoading, setIsLoading] = useState(false)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [isSwitchingThinkingLevel, setIsSwitchingThinkingLevel] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<OptimisticAgentUserMessage[]>([])
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false)
  const sessionTreeAgentIds = SESSION_TREE_AGENT_IDS
  const {
    invalidateProjectSessions: handleAgentCatalogRefreshed,
    loadProjectSessions,
    projectSessions,
    storeProjectAgentSessions,
  } = useAgentProjectSessions({ projectState, sessionTreeAgentIds })
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
  const newSessionModelDraftRef = useRef<AgentModelDraft>(getRuntimeDefaultModelDraft(emptyAgentState.runtime))
  const fileAutoOpenStateRef = useRef<AgentFileAutoOpenState>(initialAgentFileAutoOpenState)
  const {
    agentCatalog: resolvedAgentCatalog,
    agentCatalogRefreshError,
    agentCatalogRefreshRevision,
    markAgentUnavailable,
    refreshAgentCatalog,
    selectedAgentIdValue,
    setSelectedAgentIdValue,
  } = useAgentCatalog({ onCatalogRefreshed: handleAgentCatalogRefreshed })
  const activeConversation = activeWorkspaceContext.kind === 'conversation'
    ? conversationState.conversations.find((conversation) => conversation.id === activeWorkspaceContext.conversationId) ?? null
    : null
  const requestedProjectAgentId = externalSessionRequest?.kind === 'session'
    && activeWorkspaceContext.kind === 'project'
    && externalSessionRequest.projectId === activeWorkspaceContext.projectId
    ? externalSessionRequest.agentId
    : null
  const selectedAgentId = activeConversation?.agentId
    ?? requestedProjectAgentId
    ?? (activeSessionSelection.kind === 'session' ? activeSessionSelection.agentId : selectedAgentIdValue)
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

  function syncModelDraft(draft: AgentModelDraft) {
    setSelectedProviderValue(draft.provider)
    setModelInputValue(draft.modelId)
    setSelectedThinkingLevel(draft.thinkingLevel)
    setModelDrafts((currentValue) => ({
      ...currentValue,
      [draft.provider]: draft.modelId,
    }))
  }

  function syncNewSessionModelDraft(draft: AgentModelDraft) {
    newSessionModelDraftRef.current = draft
  }

  function syncActiveSessionSelection(selection: AgentSessionSelection) {
    activeSessionSelectionRef.current = selection
    setActiveSessionSelection(selection)
  }

  function getRuntimePreferredModelId(provider: string) {
    const preferredModelKey = agentState.runtime.preferredModelByProvider[provider]
    const preferredSelection = parseModelSelection(preferredModelKey ?? null)

    return preferredSelection.provider === provider ? preferredSelection.modelId : null
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
    liveTools,
    pendingInteractions,
    resetRunDrafts,
    sessionActivityById,
    setPendingInteractions,
  } = useAgentRuntimeEvents({
    activeRuntimeSessionRef,
    activeSessionSelectionRef,
    agentState,
    closeComposerMenu: () => setActiveComposerMenu(null),
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
  const pendingInteraction = pendingInteractions.find((request) => (
    request.agentId === selectedAgentId
    && request.sessionId === agentState.activeSession?.sessionId
    && (!workspacePath || normalizeAgentProjectPath(request.workspacePath) === normalizeAgentProjectPath(workspacePath))
  )) ?? null

  useAgentWorkspaceLifecycle({
    catalog: {
      markAgentUnavailable,
      refreshRevision: agentCatalogRefreshRevision,
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
    state: {
      agentState,
      closeSessionOverlay: () => setActiveOverlayPanel(null),
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

  const activeSessionPath = activeSessionSelection.kind === 'session' ? activeSessionSelection.sessionPath : null
  const activeSession = activeSessionPath && agentState.runtime.agentId === selectedAgentId
    ? agentState.sessions.find((session) => session.path === activeSessionPath) ?? null
    : null
  useEffect(() => {
    const snapshot = agentState.activeSession
    if (!snapshot) return
    const native = snapshot.native
    const persistedUsers = native?.agentId === 'codex'
      ? native.thread.turns.flatMap((turn): AgentSidebarMessage[] => (
          turn.items.flatMap((item): AgentSidebarMessage[] => item.type === 'userMessage'
            ? [{
                id: item.clientId ?? item.id,
                kind: 'user',
                text: item.content.flatMap((input) => input.type === 'text' ? [input.text] : []).join('\n\n'),
                timestamp: (turn.startedAt ?? native.thread.createdAt) * 1_000,
              }]
            : [])
        ))
      : native?.agentId === 'opencode'
      ? native.messages.flatMap((record): AgentSidebarMessage[] => (
          record.info.role === 'user'
            ? [{
                id: record.info.id,
                kind: 'user',
                text: getOpenCodeUserMessageText(record),
                timestamp: record.info.time.created,
              }]
            : []
        ))
      : native?.agentId === 'pi' || native?.agentId === 'builtin-pi'
        ? native.messages.flatMap((message, index): AgentSidebarMessage[] => (
            message.role === 'user'
              ? [{
                  id: typeof message.id === 'string' ? message.id : `pi-user-${index}`,
                  kind: 'user',
                  text: getPiWebUserMessageText(message),
                  timestamp: typeof message.timestamp === 'number' ? message.timestamp : 0,
                }]
              : []
          ))
        : snapshot.messages.filter((message) => message.kind === 'user')
    if (persistedUsers.length === 0) return
    const contentFallbackUserIds = native?.agentId === 'codex'
      ? new Set(native.thread.turns.flatMap((turn) => turn.items.flatMap((item) => (
          item.type === 'userMessage' && !item.clientId ? [item.id] : []
        ))))
      : native?.agentId === 'opencode'
        ? new Set<string>()
        : new Set(persistedUsers.map((message) => message.id))
    setOptimisticUserMessages((current) => {
      const usedPersistedIds = new Set<string>()
      return current.filter((entry) => {
        if (
          entry.agentId !== agentState.runtime.agentId
          || entry.sessionPath !== snapshot.sessionPath
        ) return true
        const match = persistedUsers.find((message) => (
          !usedPersistedIds.has(message.id)
          && (
             message.id === entry.message.id
             || (contentFallbackUserIds.has(message.id) && (
               message.text === entry.message.text
              && Math.abs(message.timestamp - entry.message.timestamp) <= 60_000
            ))
          )
        ))
        if (!match) return true
        usedPersistedIds.add(match.id)
        return false
      })
    })
  }, [agentState.activeSession, agentState.runtime.agentId])

  useEffect(() => {
    if (activeWorkspaceContext.kind !== 'conversation' || !onConversationTitleSuggested) {
      return
    }

    const runtimeSessionTitle = agentState.activeSession?.sessionPath === activeSessionPath
      ? agentState.activeSession.name
      : null
    const suggestedTitle = (runtimeSessionTitle ?? activeSession?.name ?? '').trim()
    const suggestedSessionPath = activeSession?.path
      ?? (agentState.activeSession?.sessionPath === activeSessionPath ? agentState.activeSession.sessionPath : null)

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
    onConversationTitleSuggested,
  ])

  const isViewingActiveRuntime = Boolean(
    activeSessionPath
    && agentState.runtime.agentId === selectedAgentId
    && agentState.activeSession?.sessionPath === activeSessionPath,
  )
  const viewedSessionForSelection = viewedSessionSnapshot?.sessionPath === activeSessionPath
    ? viewedSessionSnapshot
    : null
  const visibleSessionSnapshot = isViewingActiveRuntime ? agentState.activeSession : viewedSessionForSelection
  const visibleRuntime = useMemo(() => (
    isViewingActiveRuntime
      ? agentState.runtime
      : {
          ...agentState.runtime,
          compactionReason: null,
          followUpMessageCount: 0,
          followUpMessages: [],
          isCompacting: false,
          isStreaming: false,
          pendingMessageCount: 0,
          retryAttempt: 0,
          retryMaxAttempts: null,
          steeringMessageCount: 0,
          steeringMessages: [],
        }
  ), [agentState.runtime, isViewingActiveRuntime])
  const visiblePersistedMessages = visibleSessionSnapshot?.messages ?? []
  const codexNativeSession = workspacePath
    && visibleSessionSnapshot
    && normalizeAgentProjectPath(visibleSessionSnapshot.workspacePath) === normalizeAgentProjectPath(workspacePath)
    && visibleSessionSnapshot.native?.agentId === 'codex'
    ? visibleSessionSnapshot.native
    : null
  const openCodeNativeSession = visibleSessionSnapshot?.native?.agentId === 'opencode'
    ? visibleSessionSnapshot.native
    : null
  const piWebNativeSession = visibleSessionSnapshot?.native?.agentId === 'pi'
    || visibleSessionSnapshot?.native?.agentId === 'builtin-pi'
    ? visibleSessionSnapshot.native
    : null
  const isOpenCodeChildSession = Boolean(openCodeNativeSession?.parentSessionId)
  const visibleOptimisticUserMessageEntries = useMemo(() => (
    activeSessionSelection.kind === 'session'
      ? optimisticUserMessages
        .filter((entry) => (
          entry.agentId === activeSessionSelection.agentId
          && entry.sessionPath === activeSessionSelection.sessionPath
        ))
      : []
  ), [activeSessionSelection, optimisticUserMessages])
  const visibleOptimisticUserMessages = useMemo(
    () => visibleOptimisticUserMessageEntries.map((entry) => entry.message),
    [visibleOptimisticUserMessageEntries],
  )
  const openCodeOptimisticUserMessages = useMemo(() => (
    visibleOptimisticUserMessageEntries.map((entry) => {
      const message = entry.message
      return {
        attachments: message.attachments?.flatMap((attachment, index) => {
          const url = attachment.data ?? (attachment.path
            ? encodeURI(`file:///${attachment.path.replaceAll('\\', '/')}`)
            : '')
          return url
            ? [{
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                partId: entry.nativePartIds?.[index + 1] ?? `${message.id}-file-${String(index).padStart(4, '0')}`,
                url,
              }]
            : []
        }),
        id: message.id,
        text: message.text,
        textPartId: entry.nativePartIds?.[0] ?? `${message.id}-text`,
        timestamp: message.timestamp,
      }
    })
  ), [visibleOptimisticUserMessageEntries])
  const codexOptimisticUserMessages = visibleOptimisticUserMessages
  const piWebOptimisticUserMessages = useMemo(() => (
    visibleOptimisticUserMessageEntries.map((entry): PiWebOptimisticUserMessage => {
      const imageBlocks = entry.message.attachments?.flatMap((attachment) => {
        if (attachment.kind !== 'image' || !attachment.data) return []
        const match = attachment.data.match(/^data:([^;]+);base64,(.+)$/)
        if (!match) return []
        return [{
          type: 'image',
          source: {
            type: 'base64',
            media_type: match[1],
            data: match[2],
          },
        }]
      }) ?? []
      return {
        content: imageBlocks.length > 0
          ? [
              ...(entry.message.text ? [{ type: 'text', text: entry.message.text }] : []),
              ...imageBlocks,
            ]
          : entry.message.text,
        timestamp: entry.message.timestamp,
      }
    })
  ), [visibleOptimisticUserMessageEntries])

  const renderedMessages = useMemo(() => {
    const persistedMessages = visiblePersistedMessages
    const nextMessages = [...persistedMessages, ...visibleOptimisticUserMessages]
    const toolMessageIndices = new Map<string, number>()

    nextMessages.forEach((message, index) => {
      if (message.kind === 'tool') {
        toolMessageIndices.set(message.id, index)
      }
    })

    if (!isViewingActiveRuntime) {
      return nextMessages
    }

    liveTools.forEach((tool) => {
      const liveToolMessage: AgentSidebarMessage = {
        id: tool.id,
        isError: tool.isError,
        kind: 'tool',
        status: tool.status,
        text: tool.summary,
        timestamp: Date.now(),
        title: tool.name,
      }
      const existingIndex = toolMessageIndices.get(tool.id)

      if (existingIndex === undefined) {
        toolMessageIndices.set(tool.id, nextMessages.length)
        nextMessages.push(liveToolMessage)
        return
      }

      nextMessages[existingIndex] = {
        ...nextMessages[existingIndex],
        ...liveToolMessage,
        sessionEntryId: nextMessages[existingIndex].sessionEntryId,
      }
    })

    if (draftAssistant.trim() || draftThinking.trim()) {
      nextMessages.push({
        id: 'draft-assistant',
        kind: 'assistant',
        isThinkingStreaming,
        text: draftAssistant,
        thinkingText: draftThinking || undefined,
        timestamp: Date.now(),
      })
    }

    return nextMessages
  }, [draftAssistant, draftThinking, isThinkingStreaming, isViewingActiveRuntime, liveTools, visibleOptimisticUserMessages, visiblePersistedMessages])

  const {
    ensureSelectedAgentSessionActive,
    handleOpenSession,
    handleStartNewSession,
    isAgentSessionOperationCurrent,
    openSessionRequestIdRef,
  } = useAgentSessionNavigation({
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

  async function handleSelectModel(modelKey: string) {
    if (!workspacePath && !canUseDraftRuntimeWithoutWorkspace) {
      return
    }

    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    const requestSelection = activeSessionSelectionRef.current
    let requestSessionPath: string | null = null

    try {
      setIsSwitchingModel(true)
      setPanelError(null)
      const isNewSelection = requestSelection.kind === 'new'
      const nextDraft = normalizeAgentModelDraft(
        createAgentModelDraft(modelKey, selectedThinkingLevel),
        agentState.runtime,
        getRuntimeDefaultModelDraft(agentState.runtime),
      )
      if (isNewSelection) {
        syncNewSessionModelDraft(nextDraft)
        syncModelDraft(nextDraft)
        setActiveComposerMenu(null)
        return
      }

      const activeState = await ensureSelectedAgentSessionActive(requestSelection)
      if (!activeState?.activeSession) {
        if (
          requestWorkspacePath
          && requestSelection.kind === 'session'
          && isAgentSessionOperationCurrent(requestAgentId, requestSelection.sessionPath, requestWorkspacePath)
        ) {
          setPanelError('Open a session before switching the model.')
          setActiveComposerMenu(null)
        }
        return
      }

      if (!requestWorkspacePath) {
        setPanelError('Open a workspace before switching the model.')
        return
      }

      const activeWorkspacePath = requestWorkspacePath
      const activeSessionPath = activeState.activeSession.sessionPath
      if (!activeSessionPath) {
        setPanelError('The active session does not have a native session identifier.')
        return
      }
      requestSessionPath = activeSessionPath
      const nextState = await window.appApi.selectAgentModel({
        agentId: requestAgentId,
        sessionPath: activeSessionPath,
        workspacePath: activeWorkspacePath,
      }, modelKey)
      if (
        !isAgentSessionOperationCurrent(requestAgentId, activeSessionPath, activeWorkspacePath)
        || nextState.activeSession?.sessionPath !== activeSessionPath
      ) {
        return
      }

      setAgentState(nextState)
      syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
      setActiveComposerMenu(null)
    } catch (error) {
      if (
        !requestSessionPath
        || !requestWorkspacePath
        || isAgentSessionOperationCurrent(requestAgentId, requestSessionPath, requestWorkspacePath)
      ) {
        setPanelError(error instanceof Error ? error.message : 'Unable to switch the model.')
      }
    } finally {
      setIsSwitchingModel(false)
    }
  }

  async function handleThinkingLevelSelection(level: AgentThinkingLevel, modelKey?: string) {
    if (!workspacePath && !canUseDraftRuntimeWithoutWorkspace) {
      return
    }

    const nextModelKey = modelKey?.trim()
      ?? getAgentModelKey(resolvedSelectedProviderValue, modelInputValue.trim())

    if (!nextModelKey || !agentState.runtime.availableModels.includes(nextModelKey)) {
      setPanelError('Select an available model before changing the thinking level.')
      setActiveComposerMenu(null)
      return
    }

    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    const requestSelection = activeSessionSelectionRef.current
    let requestSessionPath: string | null = null

    try {
      setIsSwitchingThinkingLevel(true)
      setPanelError(null)
      const isNewSelection = requestSelection.kind === 'new'
      const nextDraft = normalizeAgentModelDraft(
        createAgentModelDraft(nextModelKey, level),
        agentState.runtime,
        getRuntimeDefaultModelDraft(agentState.runtime),
      )
      if (isNewSelection) {
        syncNewSessionModelDraft(nextDraft)
        syncModelDraft(nextDraft)
        setActiveComposerMenu(null)
        return
      }

      const activeState = await ensureSelectedAgentSessionActive(requestSelection)
      if (!activeState?.activeSession) {
        if (
          requestWorkspacePath
          && requestSelection.kind === 'session'
          && isAgentSessionOperationCurrent(requestAgentId, requestSelection.sessionPath, requestWorkspacePath)
        ) {
          setPanelError('Open a session before changing the thinking level.')
          setActiveComposerMenu(null)
        }
        return
      }

      if (!requestWorkspacePath) {
        setPanelError('Open a workspace before changing the thinking level.')
        return
      }

      const activeWorkspacePath = requestWorkspacePath
      const activeSessionPath = activeState.activeSession.sessionPath
      if (!activeSessionPath) {
        setPanelError('The active session does not have a native session identifier.')
        return
      }
      requestSessionPath = activeSessionPath
      const nextState = await window.appApi.selectAgentThinkingLevel({
        agentId: requestAgentId,
        sessionPath: activeSessionPath,
        workspacePath: activeWorkspacePath,
      }, level, nextModelKey)
      if (
        !isAgentSessionOperationCurrent(requestAgentId, activeSessionPath, activeWorkspacePath)
        || nextState.activeSession?.sessionPath !== activeSessionPath
      ) {
        return
      }

      setAgentState(nextState)
      syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
      setActiveComposerMenu(null)
    } catch (error) {
      if (
        !requestSessionPath
        || !requestWorkspacePath
        || isAgentSessionOperationCurrent(requestAgentId, requestSessionPath, requestWorkspacePath)
      ) {
        setPanelError(error instanceof Error ? error.message : 'Unable to switch the thinking level.')
      }
    } finally {
      setIsSwitchingThinkingLevel(false)
    }
  }

  const {
    isSubmittingComposerPrompt,
    submitComposerPrompt,
  } = useAgentPromptSubmission({
    composer: {
      clearAssistantDraft,
      clearComposerOptimistically,
      clearLiveTools,
      closeComposerMenu: () => setActiveComposerMenu(null),
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
  const {
    handleComposerKeyDown,
    handleQueuedMessageUpdate,
    handleSubmit,
    respondToInteraction,
  } = useAgentComposerActions({
    agentState,
    closeComposerMenu: () => setActiveComposerMenu(null),
    composerAttachmentsRef,
    composerStateRef,
    effectiveRunningPromptEnterBehavior,
    isAgentSessionOperationCurrent,
    isViewingActiveRuntime,
    pendingInteractions,
    resetRunDrafts,
    selectedAgentId,
    setAgentState,
    setPanelError,
    setPendingInteractions,
    submitComposerPrompt,
    workspacePath,
  })

  const configuredProviders = useMemo(() => (
    Array.from(new Set(
      agentState.runtime.availableModels
        .map((model) => model.split('/')[0])
        .filter(Boolean),
    )).sort((left, right) => {
      const orderDelta = getAgentProviderOrder(left) - getAgentProviderOrder(right)
      return orderDelta !== 0 ? orderDelta : left.localeCompare(right)
    })
  ), [agentState.runtime.availableModels])
  const hasConfiguredProviders = configuredProviders.length > 0
  const resolvedSelectedProviderValue = configuredProviders.includes(selectedProviderValue)
    ? selectedProviderValue
    : configuredProviders[0] ?? selectedProviderValue
  const providerModelIds = useMemo(() => (
    Array.from(new Set(
      agentState.runtime.availableModels
        .filter((model) => model.startsWith(`${resolvedSelectedProviderValue}/`))
        .map((model) => model.split('/').slice(1).join('/')),
    ))
  ), [agentState.runtime.availableModels, resolvedSelectedProviderValue])
  const trimmedModelInputValue = modelInputValue.trim()
  const composerModelKey = trimmedModelInputValue
    ? getAgentModelKey(resolvedSelectedProviderValue, trimmedModelInputValue)
    : null
  const hasAvailableComposerModel = composerModelKey
    ? agentState.runtime.availableModels.includes(composerModelKey)
    : false
  const composerThinkingLevels = composerModelKey && hasAvailableComposerModel
    ? (agentState.runtime.availableThinkingLevelsByModel[composerModelKey] ?? agentState.runtime.availableThinkingLevels)
    : []
  const thinkingLevel = clampAgentThinkingLevel(selectedThinkingLevel, composerThinkingLevels)
  const thinkingLevelLabel = formatThinkingLevelLabel(thinkingLevel)
  const hasComposerPayload = hasAgentComposerPayload(composerState, composerAttachments)
  const isConversationDraftContext = activeWorkspaceContext.kind === 'conversationDraft'
  const canCreateConversationWorkspace = Boolean(isConversationDraftContext && onCreateConversationWorkspace)
  const canUseComposerWithoutWorkspace = Boolean(!workspacePath && canCreateConversationWorkspace)
  const canSend = Boolean(
    hasComposerPayload
    && !isOpenCodeChildSession
    && !isSubmittingComposerPrompt
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
  const selectedModelInputs = composerModelKey && hasAvailableComposerModel
    ? agentState.runtime.availableModelInputs[composerModelKey] ?? ['text']
    : []
  const selectedModelSupportsImages = selectedModelInputs.includes('image')
  const hasImageComposerAttachments = composerAttachments.some((attachment) => attachment.kind === 'image')
  const attachmentCapabilityMessage = hasImageComposerAttachments && !selectedModelSupportsImages
    ? '当前模型不支持图片输入，图片不会作为视觉内容发送。'
    : null
  const statusMessage = isOpenCodeChildSession
    ? 'OpenCode 子会话由父会话中的子 Agent 管理，请返回父会话继续输入。'
    : hasLoadedWorkspaceState && !agentState.runtime.hasConfiguredModels
    ? (agentState.runtime.setupHint ?? '请先配置可用模型。')
    : !workspacePath
    ? (
        isConversationDraftContext
          ? null
          : activeWorkspaceContext.kind === 'conversation'
            ? '该对话的工作目录不可用。'
            : '打开工作区以开始。'
      )
    : null
  const runningTools = liveTools.filter((tool) => tool.status === 'running')
  const hasVisibleRunningContent = visiblePersistedMessages.some((message) => (
    message.status === 'running'
    && (
      message.kind === 'tool'
      || Boolean(message.text.trim())
      || Boolean(message.thinkingText?.trim())
    )
  ))
  const sessionPhase = useMemo(() => visibleRuntime.agentId === 'opencode'
    ? null
    : deriveAgentSessionPhase({
        draftAssistant,
        hasRunningTools: isViewingActiveRuntime && runningTools.length > 0,
        hasVisibleRunningContent,
        isStreaming: visibleRuntime.isStreaming,
        isThinkingStreaming,
        panelError,
        pendingMessageCount: visibleRuntime.pendingMessageCount,
        retryAttempt: visibleRuntime.retryAttempt,
        runtime: visibleRuntime,
        workspacePath,
      }), [
    agentState.runtime.compactionReason,
    agentState.runtime.isCompacting,
    agentState.runtime.hasConfiguredModels,
    agentState.runtime.isStreaming,
    agentState.runtime.pendingMessageCount,
    agentState.runtime.retryAttempt,
    draftAssistant,
    draftThinking,
    hasVisibleRunningContent,
    isThinkingStreaming,
    isViewingActiveRuntime,
    panelError,
    runningTools.length,
    visibleRuntime,
    workspacePath,
  ])
  const sessionStatus = useMemo(
    () => sessionPhase ? formatAgentSessionStatus(sessionPhase, {
      followUpMessageCount: visibleRuntime.followUpMessageCount,
      pendingMessageCount: visibleRuntime.pendingMessageCount,
      steeringMessageCount: visibleRuntime.steeringMessageCount,
    }) : null,
    [
      sessionPhase,
      visibleRuntime.followUpMessageCount,
      visibleRuntime.pendingMessageCount,
      visibleRuntime.steeringMessageCount,
    ],
  )
  const piWebStreamingStatus = useMemo(() => {
    if (
      !piWebNativeSession
      || !isViewingActiveRuntime
      || !visibleRuntime.isStreaming
      || runningTools.length > 0
    ) {
      return null
    }

    const phase: AgentSessionPhase | null = isThinkingStreaming && !draftAssistant.trim()
      ? { type: 'thinking' }
      : draftAssistant.trim()
        ? { type: 'streaming' }
        : null

    return phase ? formatAgentSessionStatus(phase, {
      followUpMessageCount: visibleRuntime.followUpMessageCount,
      pendingMessageCount: visibleRuntime.pendingMessageCount,
      steeringMessageCount: visibleRuntime.steeringMessageCount,
    }) : null
  }, [
    draftAssistant,
    isThinkingStreaming,
    isViewingActiveRuntime,
    piWebNativeSession,
    runningTools.length,
    visibleRuntime.followUpMessageCount,
    visibleRuntime.isStreaming,
    visibleRuntime.pendingMessageCount,
    visibleRuntime.steeringMessageCount,
  ])
  const roundFileChangesByMessageId = useMemo(() => {
    const hasInFlightRound = isViewingActiveRuntime && (liveTools.length > 0
      || Boolean(draftAssistant.trim() || draftThinking.trim())
      || agentState.runtime.isStreaming
      || agentState.runtime.pendingMessageCount > 0)
    return buildRoundFileChangesByMessageId({
      annotations: visibleSessionSnapshot?.annotations ?? { fileChangesByEntryId: {} },
      hasInFlightRound,
      messages: visiblePersistedMessages,
    })
  }, [
    agentState.runtime.isStreaming,
    agentState.runtime.pendingMessageCount,
    draftAssistant,
    draftThinking,
    isViewingActiveRuntime,
    liveTools.length,
    visibleSessionSnapshot?.annotations,
    visiblePersistedMessages,
  ])
  const piWebFileChanges = useMemo(() => mergeFileChangesByPath(
    Object.values(visibleSessionSnapshot?.annotations.fileChangesByEntryId ?? {}).flat(),
  ), [visibleSessionSnapshot?.annotations.fileChangesByEntryId])
  const sessionStatusKey = sessionStatus
    ? `${sessionStatus.label}:${sessionStatus.badges?.map((badge) => `${badge.kind}:${badge.label}`).join('|') ?? ''}`
    : 'none'
  const fileChangesKey = [...roundFileChangesByMessageId.entries()]
    .flatMap(([messageId, changes]) => changes.map((change) => `${messageId}:${change.kind}:${change.filePath}`))
    .join('|')
  const renderedMessageCount = renderedMessages.length
  const openCodeNativeRenderKey = getOpenCodeNativeRenderKey(openCodeNativeSession)
  const codexNativeRenderKey = codexNativeSession ? String(codexNativeSession.sequence) : 'none'
  const piWebNativeRenderKey = piWebNativeSession
    ? `${piWebNativeSession.messages.length}:${piWebNativeSession.entryIds.at(-1) ?? ''}`
    : 'none'
  const {
    messagesScrollElement,
    messagesScrollViewportRef,
  } = useAgentMessageViewportScroll({
    activeSessionPath,
    contentRevisions: {
      assistantDraft: draftAssistant,
      codexNative: codexNativeRenderKey,
      fileChanges: fileChangesKey,
      liveTools,
      openCodeNative: openCodeNativeRenderKey,
      piWebNative: piWebNativeRenderKey,
      renderedMessageCount,
      sessionStatus: sessionStatusKey,
      thinkingDraft: draftThinking,
    },
  })
  const latestAutoOpenFileChange = useMemo(() => (
    findLatestOpenableAgentFileChange(visiblePersistedMessages, roundFileChangesByMessageId)
  ), [visiblePersistedMessages, roundFileChangesByMessageId])

  useEffect(() => {
    if (!hasConfiguredProviders && activeComposerMenu === 'model-cascader') {
      setActiveComposerMenu(null)
    }

    if (!hasConfiguredProviders) {
      return
    }

    if (resolvedSelectedProviderValue === selectedProviderValue) {
      return
    }

    setSelectedProviderValue(resolvedSelectedProviderValue)
    setModelInputValue(
      modelDrafts[resolvedSelectedProviderValue]
        ?? getRuntimePreferredModelId(resolvedSelectedProviderValue)
        ?? providerModelIds[0]
        ?? '',
    )
  }, [
    activeComposerMenu,
    agentState.runtime.preferredModelByProvider,
    hasConfiguredProviders,
    modelDrafts,
    providerModelIds,
    resolvedSelectedProviderValue,
    selectedProviderValue,
  ])

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
    activeSessionPath,
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
    handleComposerKeyDown,
    handleDeleteSession,
    handleOpenSession,
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
    isProjectAddMenuOpen,
    isLoading,
    isSwitchingModel,
    isSwitchingThinkingLevel,
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
    piWebStreamingStatus,
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
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setPanelError,
    selectedAgentId,
    setSelectedAgentId,
    statusMessage,
    surfaceMode,
    streamingShortcutModifierLabel,
    thinkingLevel,
    thinkingLevelLabel,
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
    handleComposerKeyDown,
    handleDeleteSession,
    handleOpenSession,
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
    isProjectAddMenuOpen,
    isLoading,
    isSwitchingModel,
    isSwitchingThinkingLevel,
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
    piWebStreamingStatus,
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
    setSelectedAgentId,
    statusMessage,
    surfaceMode,
    streamingShortcutModifierLabel,
    thinkingLevel,
    thinkingLevelLabel,
    workspacePath,
    workspaceTree,
  ])

  return (
    <AgentContext.Provider value={contextValue}>
      {children}
    </AgentContext.Provider>
  )
}

function AgentSessionTree(props: AgentSessionTreeProps) {
  const controller = useAgentContext()
  return <AgentSessionTreeView {...props} controller={controller} />
}

function AgentTypeSwitchTrigger({
  menuPortalTarget,
}: {
  menuPortalTarget?: HTMLElement | null
}) {
  const {
    activeSessionSelection,
    activeWorkspaceContext,
    agentCatalog,
    agentCatalogRefreshError,
    refreshAgentCatalog,
    selectedAgentId,
    setSelectedAgentId,
  } = useAgentContext()
  const isLocked = activeWorkspaceContext.kind === 'conversation' || activeSessionSelection.kind === 'session'

  return (
    <AgentTypeSwitch
      agentCatalog={agentCatalog}
      isLocked={isLocked}
      menuPortalTarget={menuPortalTarget}
      refreshError={agentCatalogRefreshError}
      selectedAgentId={selectedAgentId}
      onRefresh={refreshAgentCatalog}
      onSelect={setSelectedAgentId}
    />
  )
}

function AgentNewConversationPrompt({
  menuPortalTarget,
}: {
  menuPortalTarget?: HTMLElement | null
}) {
  const { activeWorkspaceContext, onOpenProjectSwitchMenu, projectState } = useAgentContext()
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    : null

  return (
    <div className='agent-new-conversation-prompt'>
      <h2>
        {activeProject ? (
          <>
            <span>今天在</span>
            <AgentProjectSwitchTrigger
              activeProject={activeProject}
              onOpenProjectSwitchMenu={onOpenProjectSwitchMenu}
            />
            <span>使用</span>
            <AgentTypeSwitchTrigger menuPortalTarget={menuPortalTarget} />
            <span>处理什么？</span>
          </>
        ) : (
          <>
            <span>今天使用</span>
            <AgentTypeSwitchTrigger menuPortalTarget={menuPortalTarget} />
            <span>处理些什么？</span>
          </>
        )}
      </h2>
    </div>
  )
}

function AgentInteractionPanel({
  onRespond,
  request,
}: {
  onRespond: (
    requestId: string,
    optionId: string,
    values?: string[],
    answers?: Record<string, string[]>,
  ) => Promise<void>
  request: AgentInteractionRequest
}) {
  const [answer, setAnswer] = useState('')
  const [fieldAnswers, setFieldAnswers] = useState<Record<string, string>>({})
  const selectableOptions = request.options.filter((option) => option.id !== 'reject' && option.id !== 'deny')
  const fields = request.fields ?? []
  const needsTextAnswer = request.kind === 'question' && fields.length === 0 && selectableOptions.length === 0
  const canSubmitFields = fields.length > 0 && fields.every((field) => Boolean(fieldAnswers[field.id]?.trim()))

  useEffect(() => {
    setAnswer('')
    setFieldAnswers({})
  }, [request.id])

  return (
    <section className='agent-interaction-panel' aria-label={request.title} aria-live='polite'>
      <div className='agent-interaction-icon' aria-hidden='true'>
        <ToolLine size={17} />
      </div>
      <div className='agent-interaction-copy'>
        <strong>{request.title}</strong>
        <span>{request.message}</span>
      </div>
      <div className='agent-interaction-actions'>
        {fields.length > 0 ? (
          <div className='agent-interaction-fields'>
            {fields.map((field) => {
              const options = field.options ?? []
              const selectedAnswer = fieldAnswers[field.id] ?? ''
              return (
                <div className='agent-interaction-field' key={field.id}>
                  <div className='agent-interaction-field-copy'>
                    <strong>{field.label}</strong>
                    {field.message ? <span>{field.message}</span> : null}
                  </div>
                  {options.length > 0 ? (
                    <div className='agent-interaction-field-options'>
                      {options.map((option) => (
                        <button
                          aria-pressed={selectedAnswer === option.label}
                          className={`agent-interaction-field-option${selectedAnswer === option.label ? ' is-selected' : ''}`}
                          key={option.id}
                          type='button'
                          onClick={() => {
                            setFieldAnswers((current) => ({ ...current, [field.id]: option.label }))
                          }}
                        >
                          <span>{option.label}</span>
                          {option.description ? <small>{option.description}</small> : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {(options.length === 0 || field.allowsCustomAnswer) ? (
                    field.multiline ? (
                      <textarea
                        aria-label={field.label}
                        className='agent-interaction-input is-multiline'
                        placeholder='输入回答'
                        rows={4}
                        value={selectedAnswer}
                        onChange={(event) => {
                          setFieldAnswers((current) => ({ ...current, [field.id]: event.target.value }))
                        }}
                      />
                    ) : (
                      <input
                        aria-label={field.label}
                        className='agent-interaction-input'
                        placeholder='输入回答'
                        type={field.isSecret ? 'password' : 'text'}
                        value={selectedAnswer}
                        onChange={(event) => {
                          setFieldAnswers((current) => ({ ...current, [field.id]: event.target.value }))
                        }}
                      />
                    )
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}
        {needsTextAnswer ? (
          <input
            aria-label='回答 Agent 问题'
            className='agent-interaction-input'
            placeholder='输入回答'
            value={answer}
            onChange={(event) => {
              setAnswer(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && answer.trim()) {
                event.preventDefault()
                void onRespond(request.id, 'answer', [answer.trim()])
              }
            }}
          />
        ) : null}
        {request.options.map((option) => (
          <Button
            key={option.id}
            size='sm'
            variant={option.id.startsWith('allow') ? 'primary' : 'tertiary'}
            onPress={() => {
              void onRespond(request.id, option.id)
            }}
          >
            {option.label}
          </Button>
        ))}
        {fields.length > 0 ? (
          <Button
            size='sm'
            variant='primary'
            isDisabled={!canSubmitFields}
            onPress={() => {
              const answers = Object.fromEntries(fields.map((field) => [field.id, [fieldAnswers[field.id].trim()]]))
              void onRespond(request.id, 'answer', undefined, answers)
            }}
          >
            提交
          </Button>
        ) : null}
        {needsTextAnswer ? (
          <Button
            size='sm'
            variant='primary'
            isDisabled={!answer.trim()}
            onPress={() => {
              void onRespond(request.id, 'answer', [answer.trim()])
            }}
          >
            提交
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function AgentChatSurface() {
  const runningPromptEnterBehavior = useSettingsStore((state) => state.agent.runningPromptEnterBehavior)
  const {
    activeComposerMenu,
    activeOverlayPanel,
    activeWorkspaceContext,
    activeSession,
    activeSessionSelection,
    activeSessionPath,
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
    handleComposerKeyDown,
    handleDeleteSession,
    handleOpenSession,
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
    deletingSessionPath,
    isLoading,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    messagesScrollElement,
    messagesScrollViewportRef,
    modelFieldRef,
    modelInputValue,
    onOpenMessageFile,
    onOpenProviderSettings,
    onOpenProjectSwitchMenu,
    onStartStandaloneConversation,
    codexNativeSession,
    codexOptimisticUserMessages,
    openCodeNativeSession,
    openCodeOptimisticUserMessages,
    piWebFileChanges,
    piWebNativeSession,
    piWebOptimisticUserMessages,
    piWebStreamingStatus,
    panelError,
    pendingInteraction,
    projectState,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    removeComposerAttachment,
    respondToInteraction,
    sessionStatus,
    shouldShowComposerSendSpinner,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setPanelError,
    selectedAgentId,
    statusMessage,
    surfaceMode,
    streamingShortcutModifierLabel,
    thinkingLevel,
    thinkingLevelLabel,
    workspacePath,
    workspaceTree,
  } = useAgentContext()
  const effectiveRunningPromptEnterBehavior = resolveSupportedRunningPromptBehavior(
    agentState.runtime.supportedRunningPromptBehaviors,
    runningPromptEnterBehavior,
  )
  const alternateRunningPromptBehavior = getAlternateRunningPromptBehavior(effectiveRunningPromptEnterBehavior)
  const supportsAlternateRunningPromptBehavior = agentState.runtime.supportedRunningPromptBehaviors
    .includes(alternateRunningPromptBehavior)
  const isOpenCodeChildSession = Boolean(openCodeNativeSession?.parentSessionId)
  const isNewConversation = shouldShowAgentNewConversationPrompt(activeWorkspaceContext, activeSessionSelection)
  const canOpenSessionMenu = Boolean(workspacePath && activeWorkspaceContext.kind === 'project')
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    : null
  const activeConversation = activeWorkspaceContext.kind === 'conversation'
    ? conversationState.conversations.find((conversation) => conversation.id === activeWorkspaceContext.conversationId) ?? null
    : null
  const activeConversationTitle = activeConversation?.title.trim() ?? ''
  const activeSessionSelectLabel = isNewConversation
    ? '新对话'
    : activeConversationTitle || formatAgentSessionLabel(activeSession)
  const handleOpenWorkspaceFileFromMessage = useCallback((filePath: string) => {
    void onOpenMessageFile?.(filePath, 'updated')
  }, [onOpenMessageFile])
  const isViewingActiveRuntime = Boolean(
    activeSessionPath
    && agentState.activeSession?.sessionPath === activeSessionPath,
  )
  const [localOverlayRoot, setLocalOverlayRoot] = useState<HTMLDivElement | null>(null)
  const localOverlayRootRef = useRef<HTMLDivElement | null>(null)
  const handleLocalOverlayRootRef = useCallback((node: HTMLDivElement | null) => {
    localOverlayRootRef.current = node
    setLocalOverlayRoot(node)
  }, [])
  const queuedComposerMessages = useMemo(
    () => isViewingActiveRuntime ? buildQueuedComposerMessages(agentState.runtime) : [],
    [agentState.runtime, isViewingActiveRuntime],
  )
  const sessionMenuPortalTarget = typeof document === 'undefined'
    ? null
    : surfaceMode === 'drawer'
      ? localOverlayRoot
      : document.body

  useEffect(() => {
    if (!canOpenSessionMenu && activeOverlayPanel === 'sessions') {
      setActiveOverlayPanel(null)
    }
  }, [activeOverlayPanel, canOpenSessionMenu, setActiveOverlayPanel])

  const composerActionTitle = composerAction === 'stop'
    ? '停止当前运行'
    : agentState.runtime.isStreaming && hasComposerPayload
      ? supportsAlternateRunningPromptBehavior
        ? `Enter ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[effectiveRunningPromptEnterBehavior]}，${streamingShortcutModifierLabel} ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[alternateRunningPromptBehavior]}`
        : `Enter ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[effectiveRunningPromptEnterBehavior]}`
      : '发送消息'

  const composerHeader = composerAttachments.length > 0 || attachmentCapabilityMessage ? (
    <ScrollShadow
      hideScrollBar
      className='agent-composer-attachments'
      orientation='horizontal'
      size={28}
      onWheel={(event) => {
        const element = event.currentTarget
        const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY

        if (!horizontalDelta || element.scrollWidth <= element.clientWidth) {
          return
        }

        const maxScrollLeft = element.scrollWidth - element.clientWidth
        const nextScrollLeft = Math.min(Math.max(element.scrollLeft + horizontalDelta, 0), maxScrollLeft)

        if (nextScrollLeft === element.scrollLeft) {
          return
        }

        event.preventDefault()
        element.scrollLeft = nextScrollLeft
      }}
    >
      <div className='agent-composer-attachments-content'>
        {composerAttachments.map((attachment) => (
          <AgentAttachmentFileCard
            attachment={attachment}
            iconTheme={iconTheme}
            key={attachment.id}
            onRemove={() => {
              removeComposerAttachment(attachment.id)
            }}
          />
        ))}
        {attachmentCapabilityMessage ? (
          <div className='agent-composer-attachment-warning'>
            {attachmentCapabilityMessage}
          </div>
        ) : null}
      </div>
    </ScrollShadow>
  ) : null
  const composerQueuedTray = queuedComposerMessages.length > 0 ? (
    <AgentQueuedComposerTray
      canUpdate={agentState.runtime.supportsQueuedMessageEditing}
      menuPortalTarget={surfaceMode === 'drawer' ? localOverlayRoot : undefined}
      messages={queuedComposerMessages}
      onUpdate={handleQueuedMessageUpdate}
    />
  ) : null
  const composerHeaderContent = composerQueuedTray || composerHeader ? (
    <>
      {pendingInteraction ? (
        <AgentInteractionPanel request={pendingInteraction} onRespond={respondToInteraction} />
      ) : null}
      {composerQueuedTray}
      {composerHeader}
    </>
  ) : pendingInteraction ? (
    <AgentInteractionPanel request={pendingInteraction} onRespond={respondToInteraction} />
  ) : null
  const projectSwitchBar = isNewConversation ? (
    <div className='agent-new-project-bar'>
      <AgentProjectSwitchTrigger
        activeProject={activeWorkspaceContext.kind === 'project' ? activeProject : null}
        onOpenProjectSwitchMenu={onOpenProjectSwitchMenu}
        placeholder={activeWorkspaceContext.kind === 'conversationDraft' ? '选择工作目录' : undefined}
      />
    </div>
  ) : null

  const composerFooter = (
    <div ref={modelFieldRef} className='agent-composer-meta'>
      <div className='agent-composer-actions'>
        <AgentModelCascader
          availableModels={agentState.runtime.availableModels}
          availableThinkingLevels={agentState.runtime.availableThinkingLevels}
          availableThinkingLevelsByModel={agentState.runtime.availableThinkingLevelsByModel}
          configuredProviders={configuredProviders}
          currentModelId={modelInputValue}
          currentProvider={resolvedSelectedProviderValue}
          currentThinkingLevel={thinkingLevel}
          currentThinkingLevelLabel={thinkingLevelLabel}
          disabled={
            isOpenCodeChildSession
            || (!workspacePath && !canUseDraftRuntimeWithoutWorkspace)
            || !agentState.runtime.hasConfiguredModels
            || isSwitchingModel
            || isSwitchingThinkingLevel
          }
          isOpen={activeComposerMenu === 'model-cascader'}
          onOpenChange={(isOpen) => {
            if (isOpen) {
              setPanelError(null)
            }
            setActiveComposerMenu(isOpen ? 'model-cascader' : null)
          }}
          onOpenProviderSettings={onOpenProviderSettings}
          onSelectModel={handleSelectModel}
          onSelectThinkingLevel={handleThinkingLevelSelection}
        />

        <div className='agent-composer-right-actions'>
          <AppTooltipButton
            type='button'
            aria-label='附加文件'
            className='agent-composer-attach-button'
            disabled={isOpenCodeChildSession || (!workspacePath && !canUseComposerWithoutWorkspace) || isLoading}
            tooltip='附加文件'
            onClick={() => {
              void handlePickComposerAttachments()
            }}
          >
            <AttachmentLine aria-hidden='true' size={16} />
          </AppTooltipButton>

          <AppTooltip tooltip={composerActionTitle} triggerMode='context'>
            <Button
              isIconOnly
              aria-label={composerAction === 'stop' ? '停止当前运行' : '发送消息'}
              isDisabled={!canPerformComposerAction}
              size='sm'
              type='submit'
              variant='ghost'
              className={`agent-send-button${composerAction === 'stop' ? ' is-stop' : ''}`}
            >
              {composerAction === 'stop' ? (
                <StopFill size={16} />
              ) : shouldShowComposerSendSpinner ? (
                <AgentInlineSpinner />
              ) : (
                <ArrowUpLine size={16} />
              )}
            </Button>
          </AppTooltip>
        </div>
      </div>

    </div>
  )

  const composerForm = (
    <form
      className='agent-composer'
      onSubmit={(event) => {
        void handleSubmit(event)
      }}
    >
      <div className={`agent-composer-shell${projectSwitchBar ? ' has-project-bar' : ''}`}>
        {projectSwitchBar}
        <AgentComposerMentionInput
          aria-label={`向 ${getAgentDefinition(selectedAgentId).label} 发送消息`}
          disabled={isOpenCodeChildSession || (!workspacePath && !canUseComposerWithoutWorkspace) || isLoading}
          iconTheme={iconTheme}
          mentions={composerState.mentions}
          onChange={setComposerState}
          onFilesPastedOrDropped={(files) => {
            void addComposerFiles(files)
          }}
          onSubmitShortcut={handleComposerKeyDown}
          portalContainer={surfaceMode === 'drawer' ? localOverlayRoot : undefined}
          placeholder={workspacePath ? '发送消息，输入 @ 来提及文件...' : '发送消息...'}
          value={composerState.value}
          workspaceNodes={workspaceTree}
          workspacePath={workspacePath}
          header={composerHeaderContent}
          footer={composerFooter}
        />
      </div>
    </form>
  )

  const threadbarNewButton = !isNewConversation ? (
    <AppTooltipButton
      type='button'
      disabled={!workspacePath}
      className='agent-toolbar-button agent-threadbar-new-button'
      aria-label='Start new conversation'
      tooltip='新对话'
      onClick={() => {
        if (activeWorkspaceContext.kind === 'project') {
          handleStartNewSession()
          return
        }

        void onStartStandaloneConversation?.()
      }}
    >
      <EditLine size={16} />
    </AppTooltipButton>
  ) : null

  return (
    <div className={`agent-shell${isNewConversation ? ' is-new-conversation' : ''}`}>
      <div className='agent-threadbar'>
        <div className='agent-threadbar-leading'>
          {isAgentLayout ? threadbarNewButton : null}

          <div className='agent-session-select'>
            {canOpenSessionMenu ? (
              <Menu.Root
                modal={false}
                open={activeOverlayPanel === 'sessions'}
                onOpenChange={(open, details) => {
                  if (open) {
                    setActiveOverlayPanel('sessions')
                    return
                  }

                  if (details.reason === 'outside-press' && isAgentTreeMenuEventTarget(details.event.target)) {
                    details.cancel()
                    return
                  }

                  if (shouldCloseClickOpenedMenu(details)) {
                    setActiveOverlayPanel(null)
                  } else {
                    details.cancel()
                  }
                }}
              >
                <Menu.Trigger
                  aria-controls='agent-session-tree-floating-panel'
                  className={`agent-session-trigger ${activeOverlayPanel === 'sessions' ? 'is-open' : ''}`}
                  render={<button type='button' />}
                >
                  <span className='agent-select-current'>
                    {activeSessionSelectLabel}
                  </span>
                  <DownLine aria-hidden='true' className='agent-session-trigger-arrow' size={14} />
                </Menu.Trigger>
                {sessionMenuPortalTarget ? (
                  <Menu.Portal container={sessionMenuPortalTarget}>
                    <Menu.Positioner
                      align='start'
                      {...AGENT_SESSION_MENU_POSITIONER_PROPS}
                    >
                      <Menu.Popup
                        id='agent-session-tree-floating-panel'
                        className='agent-floating-panel'
                        aria-label='Select conversation'
                        finalFocus={false}
                      >
                        <AgentSessionTree
                          className='agent-session-tree-floating'
                          id='agent-session-tree-floating'
                          isFloating
                          menuPortalTarget={surfaceMode === 'drawer' ? localOverlayRoot : null}
                          onRequestClose={() => {
                            setActiveOverlayPanel(null)
                          }}
                        />
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                ) : null}
              </Menu.Root>
            ) : (
              <span className='agent-session-static-label'>
                <span className='agent-select-current'>
                  {activeSessionSelectLabel}
                </span>
              </span>
            )}
          </div>

          {isAgentLayout ? null : threadbarNewButton}
        </div>

        <div className='agent-threadbar-drag-spacer' aria-hidden='true' />
      </div>
      <div ref={handleLocalOverlayRootRef} className='agent-local-overlay-root' />

      {isNewConversation ? (
        <>
          <div className='agent-new-conversation-stage'>
            {statusMessage ? (
              <div className='agent-status-inline'>
                <p>{statusMessage}</p>
              </div>
            ) : null}
            <div className='agent-new-conversation-content'>
              <AgentNewConversationPrompt
                menuPortalTarget={surfaceMode === 'drawer' ? localOverlayRoot : undefined}
              />
            </div>
          </div>
          {composerForm}
        </>
      ) : (
        <>
          {statusMessage ? (
            <div className='agent-status-inline'>
              <p>{statusMessage}</p>
            </div>
          ) : null}

          {workspacePath && codexNativeSession ? (
            <div className='agent-codex-surface-stage'>
              <CodexSessionTimeline
                snapshot={codexNativeSession}
                optimisticUserMessages={codexOptimisticUserMessages}
                onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
                workspacePath={workspacePath}
              />
            </div>
          ) : (
            <AgentMessageViewport
              activeSessionPath={activeSessionPath}
              iconTheme={iconTheme}
              messages={renderedMessages}
              messagesScrollElement={messagesScrollElement}
              messagesScrollViewportRef={messagesScrollViewportRef}
              onNavigateToOpenCodeSession={(sessionId) => {
                void handleOpenSession('opencode', sessionId)
              }}
              onOpenMessageFile={onOpenMessageFile}
              onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
              openCodeNativeSession={openCodeNativeSession}
              openCodeOptimisticUserMessages={openCodeOptimisticUserMessages}
              piWebFileChanges={piWebFileChanges}
              piWebNativeSession={piWebNativeSession}
              piWebOptimisticUserMessages={piWebOptimisticUserMessages}
              piWebStreamingStatus={piWebStreamingStatus}
              roundFileChangesByMessageId={roundFileChangesByMessageId}
              sessionStatus={sessionStatus}
              workspacePath={workspacePath}
            />
          )}

          {composerForm}
        </>
      )}
    </div>
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

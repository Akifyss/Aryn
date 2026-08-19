import {
  createContext,
  useContext,
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import type { BbTheme } from '@aryn/bb-session-surface'
import type {
  AgentAvailability,
  AgentId,
} from '@/features/agent/agent-definition'
import type {
  AgentComposerAttachment,
  AgentComposerState,
} from '@/features/agent/composer/use-agent-composer-draft'
import type { AgentStoppingPromptState } from '@/features/agent/composer/use-agent-composer-actions'
import type {
  AgentMenuAnchorRect,
  AgentProjectSwitchMenuOptions,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import type { AgentSessionStatus } from '@/features/agent/components/agent-session-status/agent-session-status'
import type {
  AgentSessionControlTarget,
  AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import type { AgentProjectSessionBucket } from '@/features/agent/lib/session-tree'
import type { AgentLiveToolState } from '@/features/agent/runtime/use-agent-runtime-events'
import type {
  AgentInteractionRequest,
  AgentInteractionTimelineRecord,
  AgentMessageFileChange,
  OpenCodeOptimisticUserMessage,
  AgentQueuedMessageUpdate,
  AgentSidebarMessage,
  AgentThinkingLevel,
  AgentWorkspaceState,
  CodexNativeSessionSnapshot,
  OpenCodeNativeSessionSnapshot,
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
} from '@/features/agent/types'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationSessionStartedPatch,
  ConversationState,
} from '@/features/conversations/types'
import type {
  ProjectRecord,
  ProjectState,
  WorkspaceIconTheme,
  WorkspaceNode,
} from '@/features/workspace/types'

export type AgentSurfaceMode = 'docked' | 'drawer'

export type ConversationTitleSuggestion = {
  agentSessionPath: string
  title: string
}

export type AgentComposerAction = 'send' | 'stop'

export type AgentComposerMenu = 'model-cascader' | null

export type AgentContextValue = {
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
  draftAssistant: string
  draftThinking: string
  handleComposerKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  handleDeleteSession: (rootPath: string, agentId: AgentId, sessionPath: string) => Promise<void>
  handleOpenSession: (agentId: AgentId, sessionPath: string) => Promise<void>
  handlePrefetchSession: (rootPath: string, agentId: AgentId, sessionPath: string) => void
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
  isViewingActiveRuntime: boolean
  isProjectAddMenuOpen: boolean
  isLoading: boolean
  isWorkspaceContextPreparing: boolean
  isNewConversationSurfaceImmediate: boolean
  isSessionLoading: boolean
  showSessionLoadingIndicator: boolean
  isThinkingStreaming: boolean
  isSwitchingModel: boolean
  isSwitchingThinkingLevel: boolean
  liveTools: AgentLiveToolState[]
  messagesScrollElement: HTMLDivElement | null
  messagesScrollViewportRef: (element: HTMLDivElement | null) => void
  modelFieldRef: RefObject<HTMLDivElement | null>
  modelInputValue: string
  onConversationDraftFailed?: (conversationId: string) => Promise<void> | void
  onConversationSessionStarted?: (
    conversationId: string,
    patch: ConversationSessionStartedPatch,
  ) => Promise<void> | void
  onConversationTitleSuggested?: (
    conversationId: string,
    suggestion: ConversationTitleSuggestion,
  ) => Promise<void> | void
  onCreateConversationWorkspace?: (request: {
    agentId?: AgentId
    initialPrompt?: string | null
  }) => Promise<ConversationRecord>
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProviderSettings?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenProjectSwitchMenu?: (
    anchorRect?: AgentMenuAnchorRect,
    options?: AgentProjectSwitchMenuOptions,
  ) => void
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
  codexNativeSession: CodexNativeSessionSnapshot | null
  codexOptimisticUserMessages: AgentSidebarMessage[]
  openCodeNativeSession: OpenCodeNativeSessionSnapshot | null
  openCodeOptimisticUserMessages: OpenCodeOptimisticUserMessage[]
  piWebFileChanges: AgentMessageFileChange[]
  piWebNativeSession: PiWebNativeSessionSnapshot | null
  piWebOptimisticUserMessages: PiWebOptimisticUserMessage[]
  panelError: string | null
  pendingInteraction: AgentInteractionRequest | null
  interactionTimelineRecords: AgentInteractionTimelineRecord[]
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
  sessionControlTarget: AgentSessionControlTarget
  setActiveComposerMenu: Dispatch<SetStateAction<AgentComposerMenu>>
  setActiveOverlayPanel: Dispatch<SetStateAction<'sessions' | null>>
  setComposerState: Dispatch<SetStateAction<AgentComposerState>>
  setPanelError: Dispatch<SetStateAction<string | null>>
  selectedAgentId: AgentId
  visibleAgentId: AgentId
  visibleSessionPath: string | null
  visibleSessionSelection: AgentSessionSelection
  setSelectedAgentId: (agentId: AgentId) => void
  statusMessage: string | null
  stoppingPrompt: AgentStoppingPromptState | null
  streamStartedAt: number | null
  surfaceMode: AgentSurfaceMode
  streamingShortcutModifierLabel: string
  thinkingLevel: AgentThinkingLevel
  thinkingLevelLabel: string
  theme: BbTheme
  workspacePath: string | null
  workspaceTree: WorkspaceNode[]
}

export const AgentContext = createContext<AgentContextValue | null>(null)

export function useAgentContext() {
  const context = useContext(AgentContext)

  if (!context) {
    throw new Error('Agent surfaces must be rendered inside AgentProvider.')
  }

  return context
}

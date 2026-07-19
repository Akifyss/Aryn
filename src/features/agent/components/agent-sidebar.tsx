import {
  type CSSProperties,
  createContext,
  type Dispatch,
  FormEvent,
  KeyboardEvent,
  memo,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  type SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ContextMenu } from '@base-ui/react/context-menu'
import { Menu } from '@base-ui/react/menu'
import { Button, Disclosure, ScrollShadow, Spinner } from '@heroui/react'
import { Icon } from '@iconify/react'
import type { OpenCodeOptimisticUserMessage } from '@aryn/opencode-session-surface'
import type {
  PiWebAgentMessage,
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
} from '@aryn/pi-web-session-surface'
import {
  AiLine,
  AddLine,
  AttachmentLine,
  ArrowUpLine,
  BrainLine,
  CheckLine,
  CloseLine,
  CodeLine,
  CornerUpLeftLine,
  Delete2Line,
  DownLine,
  Edit2Line,
  EyeglassLine,
  EditLine,
  ExternalLinkLine,
  More1Line,
  Pencil2Line,
  PicLine,
  RightLine,
  SearchLine,
  StopFill,
  TerminalLine,
  ToolLine,
} from '@mingcute/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import spinners, { type BrailleSpinnerName } from 'unicode-animations'
import { AppScrollArea } from '@/components/app-scroll-area'
import { AppTooltip, AppTooltipButton } from '@/components/app-tooltip'
import { ProjectIcon } from '@/components/project-icon'
import {
  TreeItemActionButton,
  TreeItemChildren,
  TreeItem,
  TreeItemIcon,
  TreeList,
  TreeSection,
  TreeStatusItem,
  TreeScrollArea,
  TreeItemMain,
  TreeItemMainButton,
  type TreeItemMainRenderer,
} from '@/components/tree'
import { getAgentProviderOrder } from '@/features/agent/provider-auth'
import {
  DEFAULT_AGENT_ID,
  getAgentDefinition,
  type AgentAvailability,
  type AgentId,
} from '@/features/agent/agent-definition'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
import { AgentComposerMentionInput } from '@/features/agent/components/agent-composer-mention-input'
import { AgentBrandIcon } from '@/features/agent/components/agent-brand-icon'
import { CodexSessionTimeline } from '@/features/agent/components/codex-session-timeline'
import { OpenCodeSessionTimeline } from '@/features/agent/components/opencode-session-timeline'
import { PiWebSessionTimeline } from '@/features/agent/components/pi-web-session-timeline'
import { isAgentKeyboardCompositionEvent } from '@/features/agent/lib/keyboard'
import {
  isAgentMessagesScrollIntentKey,
  resolveAgentMessagesScrollStickiness,
} from '@/features/agent/lib/message-scroll-stickiness'
import {
  startAgentMessagesBottomRestore,
  type AgentMessagesBottomRestoreController,
} from '@/features/agent/lib/message-scroll-restore'
import {
  AGENT_MESSAGE_VIRTUALIZATION_GAP_PX,
  resolveAgentMessageVirtualItemTop,
  resolveAgentMessageVirtualRange,
  shouldRestoreAgentMessageVirtualAnchor,
} from '@/features/agent/lib/message-virtualization'
import { shouldRunAgentModelCascaderDelayedActivation } from '@/features/agent/lib/model-cascader-pointer-intent'
import { SIDEBAR_RESIZE_END_EVENT } from '@/features/layout/shell-layout'
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'
import type { ComposerMentionToken } from '@/features/agent/lib/composer-mentions'
import { resolveWorkspaceMessageLink } from '@/features/agent/lib/message-links'
import {
  resolveAgentWorkspaceSessionRestore,
  shouldApplyAgentSessionOperationResult,
  shouldApplyAgentWorkspaceState,
  shouldPersistAgentWorkspaceSelection,
  type AgentProjectSessionRequest,
  type AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import { shouldShowAgentNewConversationPrompt } from '@/features/agent/lib/agent-surface-state'
import {
  flattenAgentProjectSessions,
  getAgentSessionTreeKey,
  invalidateAgentProjectSessionBuckets,
  SESSION_TREE_AGENT_IDS,
  summarizeAgentProjectSessionBucket,
  type AgentProjectSessionBucket,
  type AgentSessionTreeItem,
} from '@/features/agent/lib/session-tree'
import { serializeComposerText } from '@/features/agent/lib/composer-mentions'
import {
  getOpenCodeNativeRenderKey,
  getOpenCodeUserMessageText,
} from '@/features/agent/lib/opencode-timeline'
import {
  createOpenCodeMessageId,
  createOpenCodePartId,
} from '@/features/agent/lib/opencode-message-id'
import { getAgentInteractionKey } from '@/features/agent/types'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationState,
  ConversationTitleSource,
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
import {
  AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS,
  getAlternateRunningPromptBehavior,
  useSettingsStore,
  type AgentRunningPromptEnterBehavior,
} from '@/hooks/use-settings-store'
import type {
  AgentClientEvent,
  AgentInteractionRequest,
  AgentMessageAttachment,
  AgentMessageFileChange,
  AgentPromptAttachment,
  AgentQueuedMessageKind,
  AgentQueuedMessageUpdate,
  AgentRunningPromptBehavior,
  AgentSessionListItem,
  AgentSessionAnnotations,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentSidebarMessageStatus,
  AgentThinkingLevel,
  AgentWorkspaceState,
  CodexNativeSessionSnapshot,
  OpenCodeNativeSessionSnapshot,
} from '@/features/agent/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'

type AgentProjectSwitchMenuOptions = {
  startNewSession?: boolean
}

type AgentSurfaceMode = 'docked' | 'drawer'

type ConversationSessionStartedPatch = {
  agentSessionPath: string | null
  lastMessagePreview?: string | null
  title?: string | null
  titleSource?: ConversationTitleSource
}

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

type AgentSessionTreeProps = {
  className?: string
  onRequestClose?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  id?: string
  isFloating?: boolean
  isProjectAddMenuOpen?: boolean
  menuPortalTarget?: HTMLElement | null
}

type AgentProviderProps = AgentSurfaceProps & {
  children: ReactNode
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
}

type LiveToolState = {
  id: string
  name: string
  status: AgentSidebarMessageStatus
  summary: string
  isError?: boolean
}

type ComposerState = {
  mentions: ComposerMentionToken[]
  value: string
}

type ComposerAttachment = AgentPromptAttachment & {
  id: string
}

type AgentComposerAction = 'send' | 'stop'
type AgentQueuedComposerMessage = {
  id: string
  index: number
  kind: AgentQueuedMessageKind
  text: string
}

type AgentFileCardAttachmentData = (AgentPromptAttachment | AgentMessageAttachment) & {
  id?: string
  status?: AgentMessageAttachment['status']
}

type AgentFileCardProps = {
  ariaLabel?: string
  className?: string
  fileName: string
  iconSize?: number
  iconTheme?: WorkspaceIconTheme | null
  imageSrc?: string
  isImage?: boolean
  isMuted?: boolean
  meta?: string
  onActivate?: () => void
  onRemove?: () => void
  trailing?: ReactNode
}

type AgentComposerMenu = 'model-cascader' | null

type AgentModelPickerOption = {
  key: string
  modelId: string
  provider: string
  thinkingLevels: AgentThinkingLevel[]
}
type AgentModelDraft = {
  modelId: string
  provider: string
  thinkingLevel: AgentThinkingLevel
}
type AgentModelPickerKeyboardColumn = 'provider' | 'model' | 'thinking'

type AgentModelCascaderStyle = CSSProperties & {
  '--agent-model-cascader-grid-height'?: string
  '--agent-model-cascader-provider-width'?: string
  '--agent-model-cascader-thinking-width'?: string
}

type AgentModelCascaderLayoutMetrics = {
  panelWidth: number
  positioningWidth: number
  providerColumnWidth: number
  thinkingColumnWidth: number
}

type AgentModelPickerPoint = {
  x: number
  y: number
}

type AgentMenuAnchorRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

type AgentModelPickerPointerPoint = AgentModelPickerPoint & {
  time: number
}

type AgentModelPickerSafeTriangleTarget = 'model' | 'thinking'

type AgentModelPickerPendingActivation = {
  run: () => void
  target: AgentModelPickerSafeTriangleTarget
  timeoutId: number
  version: number
}

type OptimisticComposerClearToken = { id: number; revision: number }

const MARKDOWN_PLUGINS = [remarkGfm]
const AGENT_THINKING_AUTO_EXPAND_DELAY_MS = 520
const AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS = 140
const AGENT_THINKING_MIN_EXPANDED_MS = 360
const AGENT_THINKING_SCROLL_STICKY_THRESHOLD_PX = 24
const AGENT_MESSAGES_TRANSIENT_SCROLL_INTENT_MS = 600
const AGENT_MESSAGE_VIRTUALIZATION_MIN_ITEMS = 12
const AGENT_MESSAGE_VIRTUALIZATION_INITIAL_VIEWPORT_HEIGHT = 900
const AGENT_MESSAGE_VIRTUALIZATION_BOTTOM_ANCHOR_THRESHOLD_PX = 24
const MAX_VISIBLE_MESSAGE_FILE_CARDS = 6
const AGENT_MODEL_CASCADER_MARGIN_PX = 12
const AGENT_MODEL_CASCADER_GAP_PX = 10
const AGENT_MODEL_CASCADER_MAX_WIDTH_PX = 680
const AGENT_MODEL_CASCADER_MAX_HEIGHT_PX = 390
const AGENT_MODEL_CASCADER_MIN_PANEL_HEIGHT_PX = 220
const AGENT_MODEL_CASCADER_MIN_GRID_HEIGHT_PX = 172
const AGENT_MODEL_CASCADER_MAX_GRID_HEIGHT_PX = 286
const AGENT_MODEL_CASCADER_SEARCH_HEIGHT_PX = 39
// Delay only when pointer intent is ambiguous inside the safety triangle.
const AGENT_MODEL_CASCADER_SAFE_TRIANGLE_DELAY_MS = 180
const AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX = 18
// Recent movement history used to draw the dynamic triangle. Keep short to avoid stale, oversized triangles.
const AGENT_MODEL_CASCADER_POINTER_TRAIL_MS = 180
const AGENT_MODEL_CASCADER_MIN_WIDTH_PX = 340
const AGENT_MODEL_CASCADER_PROVIDER_MIN_WIDTH_PX = 132
const AGENT_MODEL_CASCADER_PROVIDER_MAX_WIDTH_PX = 190
const AGENT_MODEL_CASCADER_MODEL_MIN_WIDTH_PX = 176
const AGENT_MODEL_CASCADER_MODEL_MAX_WIDTH_PX = 400
const AGENT_MODEL_CASCADER_THINKING_WIDTH_PX = 128
const AGENT_MODEL_CASCADER_SELECTOR = '[data-agent-model-cascader="true"]'
const AGENT_MODEL_CASCADER_PROVIDER_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-provider`
const AGENT_MODEL_CASCADER_MODEL_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-model`
const AGENT_MODEL_CASCADER_RESULTS_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-results`
const AGENT_MODEL_CASCADER_THINKING_COLUMN_SELECTOR = `${AGENT_MODEL_CASCADER_SELECTOR} .agent-model-cascader-column-thinking`

function getAgentMessagesScrollContentElement(scrollElement: HTMLElement) {
  for (const childElement of Array.from(scrollElement.children)) {
    if (
      childElement instanceof HTMLElement
      && childElement.classList.contains('agent-messages-scroll-content')
    ) {
      return childElement
    }
  }

  const firstChildElement = scrollElement.firstElementChild
  return firstChildElement instanceof HTMLElement ? firstChildElement : null
}

function scrollAgentMessagesToBottom(scrollElement: HTMLElement) {
  scrollElement.scrollTop = Number.MAX_SAFE_INTEGER
}

function getAgentMessagesEventTargetElement(event: Event) {
  const target = event.target
  if (target instanceof Element) {
    return target
  }

  return target instanceof Node ? target.parentElement : null
}

function isAgentMessagesScrollAreaEvent(event: Event, scrollRootElement: Element) {
  return getAgentMessagesEventTargetElement(event)?.closest('.app-scroll-area') === scrollRootElement
}

function isAgentMessagesScrollbarPointerEvent(
  event: PointerEvent,
  scrollElement: HTMLElement,
  scrollRootElement: Element,
) {
  const targetElement = getAgentMessagesEventTargetElement(event)
  const scrollbarElement = targetElement?.closest('.app-scroll-area-scrollbar, .app-scroll-area-thumb')

  if (scrollbarElement?.closest('.app-scroll-area') === scrollRootElement) {
    return true
  }

  if (targetElement !== scrollElement) {
    return false
  }

  const rect = scrollElement.getBoundingClientRect()
  const verticalScrollbarWidth = scrollElement.offsetWidth - scrollElement.clientWidth
  const horizontalScrollbarHeight = scrollElement.offsetHeight - scrollElement.clientHeight

  return (
    (verticalScrollbarWidth > 0 && event.clientX >= rect.right - verticalScrollbarWidth)
    || (horizontalScrollbarHeight > 0 && event.clientY >= rect.bottom - horizontalScrollbarHeight)
  )
}

const AGENT_SESSION_MENU_POSITIONER_PROPS = {
  className: 'agent-session-menu-positioner',
  collisionAvoidance: { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
  collisionPadding: 8,
  positionMethod: 'fixed',
  side: 'bottom',
  sideOffset: 8,
} as const
const AGENT_TREE_MENU_POSITIONER_PROPS = {
  className: 'agent-tree-menu-positioner',
  collisionAvoidance: { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
  collisionPadding: 8,
  positionMethod: 'fixed',
  side: 'bottom',
  sideOffset: 2,
} as const
type AgentTreeMenuItemComponent = typeof Menu.Item

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

const emptyComposerState: ComposerState = {
  mentions: [],
  value: '',
}

function getHasComposerPayload(
  composerState: ComposerState,
  composerAttachments: ComposerAttachment[],
) {
  return Boolean(
    serializeComposerText(composerState.value, composerState.mentions).trim()
    || composerAttachments.length > 0
  )
}

function isComposerPristineEmpty(
  composerState: ComposerState,
  composerAttachments: ComposerAttachment[],
) {
  return (
    composerState.value === ''
    && composerState.mentions.length === 0
    && composerAttachments.length === 0
  )
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

const IMAGE_ATTACHMENT_EXTENSIONS = /\.(?:png|jpe?g|webp|gif)$/i
const IMAGE_ATTACHMENT_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const MAX_COMPOSER_ATTACHMENTS = 12

type AgentContextValue = {
  agentCatalog: AgentAvailability[]
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
  composerAttachments: ComposerAttachment[]
  composerState: ComposerState
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
  liveTools: LiveToolState[]
  messagesScrollRef: React.RefObject<HTMLDivElement | null>
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
  setComposerState: React.Dispatch<React.SetStateAction<ComposerState>>
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

function sanitizeFlatAgentSessionPath(value: string) {
  return value
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatSessionLabel(session: AgentSessionListItem | null) {
  return session ? sanitizeFlatAgentSessionPath(session.name ?? session.preview) || 'Untitled session' : 'Session'
}

function formatAgentSessionRelativeTime(timestamp: string) {
  const value = Date.parse(timestamp)

  if (!Number.isFinite(value)) {
    return ''
  }

  const elapsedMs = Math.max(0, Date.now() - value)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (elapsedMs < minute) {
    return '刚刚'
  }

  if (elapsedMs < hour) {
    return `${Math.max(1, Math.floor(elapsedMs / minute))} 分`
  }

  if (elapsedMs < day) {
    return `${Math.floor(elapsedMs / hour)} 小时`
  }

  return `${Math.floor(elapsedMs / day)} 天`
}

function formatConversationPreview(prompt: string) {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  return firstLine ? firstLine.replace(/\s+/g, ' ').slice(0, 48) : '新对话'
}

function formatModelLabel(modelKey: string | null) {
  if (!modelKey) {
    return ''
  }

  const parts = modelKey.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelKey
}

function parseModelSelection(modelKey: string | null): { modelId: string, provider: string } {
  if (!modelKey) {
    return {
      modelId: '',
      provider: '',
    }
  }

  const [providerCandidate, ...modelIdParts] = modelKey.split('/')

  return {
    modelId: modelIdParts.length > 0 ? modelIdParts.join('/') : formatModelLabel(modelKey),
    provider: modelIdParts.length > 0 ? providerCandidate : '',
  }
}

function createAgentModelDraft(modelKey: string | null, thinkingLevel: AgentThinkingLevel): AgentModelDraft {
  return {
    ...parseModelSelection(modelKey),
    thinkingLevel,
  }
}

function getRuntimeSelectedModelDraft(runtime: AgentWorkspaceState['runtime']) {
  return createAgentModelDraft(runtime.selectedModel, runtime.thinkingLevel)
}

function getRuntimeDefaultModelDraft(runtime: AgentWorkspaceState['runtime']) {
  return createAgentModelDraft(runtime.defaultModel ?? runtime.selectedModel, runtime.defaultThinkingLevel)
}

function getAgentModelKey(provider: string, modelId: string) {
  return `${provider}/${modelId}`
}

function getAgentModelDraftKey(draft: AgentModelDraft) {
  return draft.provider && draft.modelId ? getAgentModelKey(draft.provider, draft.modelId) : null
}

function normalizeAgentProjectPath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

type OptimisticAgentUserMessage = {
  agentId: AgentId
  message: AgentSidebarMessage
  nativePartIds?: string[]
  sessionPath: string
}

function getAgentSessionActivityKey(agentId: AgentId, sessionKey: string) {
  return `${agentId}\n${sessionKey}`
}

function normalizeAgentModelDraft(
  draft: AgentModelDraft,
  runtime: AgentWorkspaceState['runtime'],
  fallbackDraft: AgentModelDraft,
) {
  const configuredProviders = Array.from(new Set(
    runtime.availableModels
      .map((model) => model.split('/')[0])
      .filter(Boolean),
  )).sort((left, right) => {
    const orderDelta = getAgentProviderOrder(left) - getAgentProviderOrder(right)
    return orderDelta !== 0 ? orderDelta : left.localeCompare(right)
  })
  const fallbackProvider = fallbackDraft.provider || configuredProviders[0] || draft.provider
  const provider = configuredProviders.includes(draft.provider) ? draft.provider : fallbackProvider
  const modelIds = Array.from(new Set(
    runtime.availableModels
      .filter((model) => model.startsWith(`${provider}/`))
      .map((model) => model.split('/').slice(1).join('/')),
  ))
  const preferredModelKey = runtime.preferredModelByProvider[provider]
  const preferredModel = parseModelSelection(preferredModelKey ?? null)
  const fallbackModelId = fallbackDraft.provider === provider && fallbackDraft.modelId
    ? fallbackDraft.modelId
    : preferredModel.provider === provider
      ? preferredModel.modelId
      : modelIds[0] ?? draft.modelId
  const modelId = modelIds.includes(draft.modelId) ? draft.modelId : fallbackModelId
  const modelKey = provider && modelId ? getAgentModelKey(provider, modelId) : null
  const availableThinkingLevels = modelKey
    ? runtime.availableThinkingLevelsByModel[modelKey] ?? runtime.availableThinkingLevels
    : runtime.availableThinkingLevels

  return {
    modelId,
    provider,
    thinkingLevel: clampAgentThinkingLevel(draft.thinkingLevel, availableThinkingLevels),
  }
}

const THINKING_LEVEL_LABELS: Record<AgentThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
}
const THINKING_LEVEL_ORDER: AgentThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh']

function formatThinkingLevelLabel(level: AgentThinkingLevel) {
  return THINKING_LEVEL_LABELS[level] ?? level
}

function clampAgentThinkingLevel(level: AgentThinkingLevel, availableLevels: AgentThinkingLevel[]) {
  if (availableLevels.includes(level)) {
    return level
  }

  if (availableLevels.length === 0) {
    return level
  }

  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level)

  if (requestedIndex === -1) {
    return availableLevels[0]
  }

  for (let index = requestedIndex; index < THINKING_LEVEL_ORDER.length; index += 1) {
    const candidate = THINKING_LEVEL_ORDER[index]

    if (availableLevels.includes(candidate)) {
      return candidate
    }
  }

  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVEL_ORDER[index]

    if (availableLevels.includes(candidate)) {
      return candidate
    }
  }

  return availableLevels[0]
}

function hasConfigurableAgentThinkingLevel(availableLevels: AgentThinkingLevel[]) {
  return availableLevels.some((level) => level !== 'off')
}

function getLoopedIndex(length: number, currentIndex: number, offset: number) {
  if (length <= 0) {
    return -1
  }

  if (currentIndex < 0) {
    return offset >= 0 ? 0 : length - 1
  }

  return (currentIndex + offset + length) % length
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function estimateAgentCascaderTextWidth(value: string, averageGlyphWidth: number, extraWidth: number) {
  return Math.ceil(value.length * averageGlyphWidth) + extraWidth
}

let agentCascaderTextMeasureCanvas: HTMLCanvasElement | null = null

function measureAgentCascaderTextWidth(value: string, averageGlyphWidth: number, extraWidth: number) {
  if (typeof document === 'undefined') {
    return estimateAgentCascaderTextWidth(value, averageGlyphWidth, extraWidth)
  }

  agentCascaderTextMeasureCanvas ??= document.createElement('canvas')
  const context = agentCascaderTextMeasureCanvas.getContext('2d')

  if (!context) {
    return estimateAgentCascaderTextWidth(value, averageGlyphWidth, extraWidth)
  }

  const bodyElement = document.body as HTMLElement | null
  const computedFontFamily = bodyElement ? window.getComputedStyle(bodyElement).fontFamily : ''
  const fontFamily = computedFontFamily || 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  context.font = `13px ${fontFamily}`

  const measuredWidth = context.measureText(value).width
  if (!Number.isFinite(measuredWidth) || measuredWidth <= 0) {
    return estimateAgentCascaderTextWidth(value, averageGlyphWidth, extraWidth)
  }

  return Math.ceil(measuredWidth) + extraWidth
}

function scoreAgentModelSearchOption(
  option: AgentModelPickerOption,
  normalizedQuery: string,
  preferredProvider: string,
) {
  const modelId = option.modelId.toLowerCase()
  const provider = option.provider.toLowerCase()
  const key = option.key.toLowerCase()
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  const matches = tokens.every((token) => (
    modelId.includes(token) || provider.includes(token) || key.includes(token)
  ))

  if (!matches) {
    return null
  }

  let score = option.provider === preferredProvider ? 0 : 2

  if (modelId === normalizedQuery) {
    score += 0
  } else if (key === normalizedQuery) {
    score += 4
  } else if (modelId.startsWith(normalizedQuery)) {
    score += 8
  } else if (key.startsWith(normalizedQuery)) {
    score += 12
  } else if (modelId.includes(normalizedQuery)) {
    score += 20
  } else if (tokens.every((token) => modelId.includes(token))) {
    score += 24
  } else if (provider === normalizedQuery) {
    score += 30
  } else if (provider.startsWith(normalizedQuery)) {
    score += 34
  } else {
    score += 40
  }

  return score + (option.modelId.length / 1000)
}

function rankAgentModelSearchOptions(
  options: AgentModelPickerOption[],
  normalizedQuery: string,
  preferredProvider: string,
) {
  return options
    .map((option, index) => ({
      index,
      option,
      score: scoreAgentModelSearchOption(option, normalizedQuery, preferredProvider),
    }))
    .filter((entry): entry is { index: number, option: AgentModelPickerOption, score: number } => entry.score !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.option)
}

function areAgentModelCascaderStylesEqual(
  left: AgentModelCascaderStyle,
  right: AgentModelCascaderStyle,
) {
  return left.left === right.left
    && left.maxHeight === right.maxHeight
    && left.top === right.top
    && left.width === right.width
    && left['--agent-model-cascader-grid-height'] === right['--agent-model-cascader-grid-height']
    && left['--agent-model-cascader-provider-width'] === right['--agent-model-cascader-provider-width']
    && left['--agent-model-cascader-thinking-width'] === right['--agent-model-cascader-thinking-width']
}

function scrollAgentModelCascaderActiveItemsIntoView() {
  if (typeof document === 'undefined') {
    return
  }

  const cascaderElement = document.getElementById('agent-model-cascader')
  const activeItems = cascaderElement?.querySelectorAll<HTMLElement>('.agent-model-cascader-option.is-active')

  activeItems?.forEach((activeItem) => {
    const viewportElement = activeItem.closest<HTMLElement>('.app-scroll-area-viewport')

    if (!viewportElement) {
      return
    }

    const viewportRect = viewportElement.getBoundingClientRect()
    const itemRect = activeItem.getBoundingClientRect()
    const itemCenterOffset = itemRect.top - viewportRect.top + (itemRect.height / 2)
    const viewportCenterOffset = viewportRect.height / 2

    viewportElement.scrollTop += itemCenterOffset - viewportCenterOffset
  })
}

function isAgentModelCascaderPointInsideRect(
  point: AgentModelPickerPoint,
  rect: DOMRect,
  padding = 0,
) {
  return point.x >= rect.left - padding
    && point.x <= rect.right + padding
    && point.y >= rect.top - padding
    && point.y <= rect.bottom + padding
}

function getAgentModelCascaderTriangleSign(
  firstPoint: AgentModelPickerPoint,
  secondPoint: AgentModelPickerPoint,
  thirdPoint: AgentModelPickerPoint,
) {
  return (firstPoint.x - thirdPoint.x) * (secondPoint.y - thirdPoint.y)
    - (secondPoint.x - thirdPoint.x) * (firstPoint.y - thirdPoint.y)
}

function isPointInsideAgentModelCascaderTriangle(
  point: AgentModelPickerPoint,
  firstVertex: AgentModelPickerPoint,
  secondVertex: AgentModelPickerPoint,
  thirdVertex: AgentModelPickerPoint,
) {
  const firstSign = getAgentModelCascaderTriangleSign(point, firstVertex, secondVertex)
  const secondSign = getAgentModelCascaderTriangleSign(point, secondVertex, thirdVertex)
  const thirdSign = getAgentModelCascaderTriangleSign(point, thirdVertex, firstVertex)
  const hasNegative = firstSign < 0 || secondSign < 0 || thirdSign < 0
  const hasPositive = firstSign > 0 || secondSign > 0 || thirdSign > 0

  return !(hasNegative && hasPositive)
}

function resolveAgentModelCascaderStyle(
  anchorRect: DOMRect,
  layoutMetrics: AgentModelCascaderLayoutMetrics,
): AgentModelCascaderStyle {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = Math.min(AGENT_MODEL_CASCADER_MARGIN_PX, Math.max(8, viewportWidth / 32))
  const maxWidth = Math.max(280, viewportWidth - (margin * 2))
  const width = Math.min(layoutMetrics.panelWidth, maxWidth)
  const positioningWidth = Math.min(layoutMetrics.positioningWidth, maxWidth)
  const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - positioningWidth - margin))
  const availableAbove = Math.max(0, anchorRect.top - margin - AGENT_MODEL_CASCADER_GAP_PX)
  const availableBelow = Math.max(0, viewportHeight - anchorRect.bottom - margin - AGENT_MODEL_CASCADER_GAP_PX)
  const opensBelow = availableAbove < AGENT_MODEL_CASCADER_MIN_PANEL_HEIGHT_PX && availableBelow > availableAbove
  const availableHeight = opensBelow ? availableBelow : availableAbove
  const fallbackHeight = Math.max(160, viewportHeight - (margin * 2))
  const minimumHeight = Math.min(AGENT_MODEL_CASCADER_MIN_PANEL_HEIGHT_PX, fallbackHeight)
  const panelHeight = Math.min(
    AGENT_MODEL_CASCADER_MAX_HEIGHT_PX,
    Math.max(
      minimumHeight,
      Math.min(availableHeight || fallbackHeight, fallbackHeight),
    ),
  )
  const availableGridHeight = Math.max(96, panelHeight - AGENT_MODEL_CASCADER_SEARCH_HEIGHT_PX)
  const gridHeight = Math.min(
    AGENT_MODEL_CASCADER_MAX_GRID_HEIGHT_PX,
    Math.max(Math.min(AGENT_MODEL_CASCADER_MIN_GRID_HEIGHT_PX, availableGridHeight), availableGridHeight),
  )
  const renderedHeight = Math.min(panelHeight, gridHeight + AGENT_MODEL_CASCADER_SEARCH_HEIGHT_PX)
  const top = opensBelow
    ? Math.min(anchorRect.bottom + AGENT_MODEL_CASCADER_GAP_PX, viewportHeight - renderedHeight - margin)
    : Math.max(margin, anchorRect.top - AGENT_MODEL_CASCADER_GAP_PX - renderedHeight)

  return {
    left: `${left}px`,
    maxHeight: `${panelHeight}px`,
    top: `${Math.max(margin, top)}px`,
    width: `${width}px`,
    '--agent-model-cascader-grid-height': `${gridHeight}px`,
    '--agent-model-cascader-provider-width': `${layoutMetrics.providerColumnWidth}px`,
    '--agent-model-cascader-thinking-width': `${layoutMetrics.thinkingColumnWidth}px`,
  }
}

function isAgentTreeMenuEventTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-agent-tree-menu-root="true"]'))
}

function getAgentRelativePath(rootPath: string | null, filePath: string) {
  if (!rootPath) {
    return filePath.split(/[\\/]/).pop() ?? filePath
  }

  const normalizedRoot = rootPath.replace(/[\\/]+$/, '').replace(/[\\/]+/g, '/')
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/')

  if (!normalizedFilePath.startsWith(normalizedRoot)) {
    return filePath.split(/[\\/]/).pop() ?? filePath
  }

  return normalizedFilePath.slice(normalizedRoot.length).replace(/^\/+/, '') || (filePath.split(/[\\/]/).pop() ?? filePath)
}

function getAgentFileChangeVisualKind(kind: AgentMessageFileChange['kind']) {
  if (kind === 'created') {
    return 'added'
  }

  if (kind === 'deleted') {
    return 'deleted'
  }

  return 'modified'
}

function getMessageFileSectionTitle(fileChanges: AgentMessageFileChange[]) {
  if (fileChanges.length === 0) {
    return ''
  }

  const uniqueKinds = new Set(fileChanges.map((change) => change.kind))

  if (uniqueKinds.size === 1) {
    const [kind] = [...uniqueKinds]

    if (kind === 'created') {
      return 'Files Created'
    }

    if (kind === 'deleted') {
      return 'Files Deleted'
    }

    return 'Files Modified'
  }

  return 'Files Changed'
}

function formatAttachmentSize(size: number | undefined) {
  if (size === undefined) {
    return ''
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB']
  let amount = size / 1024
  let unitIndex = 0

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`
}

function isImageAttachment(fileName: string, mimeType?: string) {
  return Boolean(
    mimeType
      ? IMAGE_ATTACHMENT_MIME_TYPES.has(mimeType.toLowerCase())
      : IMAGE_ATTACHMENT_EXTENSIONS.test(fileName),
  )
}

function getAttachmentStatusLabel(status: AgentMessageAttachment['status']) {
  switch (status) {
    case 'sent':
      return 'sent'
    case 'omitted':
      return 'text only'
    case 'referenced':
      return 'referenced'
    default:
      return null
  }
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

function getMessageStatus(message: AgentSidebarMessage): AgentSidebarMessageStatus {
  return message.status ?? (message.isError ? 'error' : 'done')
}

function getToolStatusLabel(status: AgentSidebarMessageStatus) {
  switch (status) {
    case 'running':
      return '运行中'
    case 'error':
      return '失败'
    default:
      return '完成'
  }
}

function useAutoDisclosureState({
  collapseDelayMs = 0,
  expandDelayMs = 0,
  initialExpanded,
  minExpandedMs = 0,
  nextAutoExpanded,
  stateKey,
}: {
  collapseDelayMs?: number
  expandDelayMs?: number
  initialExpanded: boolean
  minExpandedMs?: number
  nextAutoExpanded: boolean
  stateKey: string
}) {
  const [isExpanded, setIsExpanded] = useState(initialExpanded)
  const expandedRef = useRef(initialExpanded)
  const autoExpandedRef = useRef(false)
  const lastAutoExpandedAtRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const userInteractedRef = useRef(false)

  function clearScheduledTransition() {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  function setExpandedState(nextExpanded: boolean) {
    expandedRef.current = nextExpanded
    setIsExpanded(nextExpanded)
  }

  useEffect(() => {
    expandedRef.current = isExpanded
  }, [isExpanded])

  useEffect(() => {
    clearScheduledTransition()
    userInteractedRef.current = false
    autoExpandedRef.current = false
    lastAutoExpandedAtRef.current = null
    setExpandedState(initialExpanded)
  }, [initialExpanded, stateKey])

  useEffect(() => {
    clearScheduledTransition()

    if (userInteractedRef.current) {
      return
    }

    if (nextAutoExpanded) {
      if (expandedRef.current) {
        return
      }

      if (expandDelayMs <= 0) {
        autoExpandedRef.current = true
        lastAutoExpandedAtRef.current = Date.now()
        setExpandedState(true)
        return
      }

      timerRef.current = window.setTimeout(() => {
        if (userInteractedRef.current) {
          timerRef.current = null
          return
        }

        autoExpandedRef.current = true
        lastAutoExpandedAtRef.current = Date.now()
        setExpandedState(true)
        timerRef.current = null
      }, expandDelayMs)

      return clearScheduledTransition
    }

    if (!expandedRef.current || !autoExpandedRef.current) {
      return
    }

    const minVisibleRemainingMs = lastAutoExpandedAtRef.current !== null
      ? Math.max(0, minExpandedMs - (Date.now() - lastAutoExpandedAtRef.current))
      : 0
    const effectiveDelayMs = Math.max(collapseDelayMs, minVisibleRemainingMs)

    if (effectiveDelayMs <= 0) {
      autoExpandedRef.current = false
      lastAutoExpandedAtRef.current = null
      setExpandedState(false)
      return
    }

    timerRef.current = window.setTimeout(() => {
      if (userInteractedRef.current) {
        timerRef.current = null
        return
      }

      autoExpandedRef.current = false
      lastAutoExpandedAtRef.current = null
      setExpandedState(false)
      timerRef.current = null
    }, effectiveDelayMs)

    return clearScheduledTransition
  }, [collapseDelayMs, expandDelayMs, minExpandedMs, nextAutoExpanded, stateKey])

  useEffect(() => () => {
    clearScheduledTransition()
  }, [])

  function handleExpandedChange(nextExpanded: boolean) {
    clearScheduledTransition()
    userInteractedRef.current = true
    autoExpandedRef.current = false
    lastAutoExpandedAtRef.current = null
    setExpandedState(nextExpanded)
  }

  return [isExpanded, handleExpandedChange] as const
}

const AgentMarkdown = memo(function AgentMarkdown({
  onOpenWorkspaceFile,
  text,
  workspacePath,
}: {
  onOpenWorkspaceFile?: (filePath: string) => void
  text: string
  workspacePath: string | null
}) {
  return (
    <div className='agent-markdown'>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => {
            const workspaceFilePath = resolveWorkspaceMessageLink(workspacePath, href)

            if (workspaceFilePath && onOpenWorkspaceFile) {
              return (
                <a
                  href={href}
                  onClick={(event) => {
                    event.preventDefault()
                    onOpenWorkspaceFile(workspaceFilePath)
                  }}
                >
                  {children}
                </a>
              )
            }

            return (
              <a href={href} rel='noreferrer' target='_blank'>
                {children}
              </a>
            )
          },
        }}
        remarkPlugins={MARKDOWN_PLUGINS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})

function formatDisclosureTitle(title: string) {
  return title.includes('_') || title.includes('-')
    ? title.replace(/[_-]+/g, ' ')
    : title
}

function getMessageDisclosureIcon(kind: 'details' | 'thinking' | 'tool', title: string) {
  const normalizedTitle = title.trim().toLowerCase()
  const iconClassName = 'agent-message-toggle-icon'

  if (kind === 'thinking') {
    return <BrainLine aria-hidden='true' className={iconClassName} />
  }

  if (kind === 'details') {
    return <AiLine aria-hidden='true' className={iconClassName} />
  }

  if (/write|edit|append|replace|rewrite|update|create|save|draft/.test(normalizedTitle)) {
    return <Pencil2Line aria-hidden='true' className={iconClassName} />
  }

  if (/delete|remove/.test(normalizedTitle)) {
    return <Delete2Line aria-hidden='true' className={iconClassName} />
  }

  if (/bash|shell|terminal|command|powershell/.test(normalizedTitle)) {
    return <TerminalLine aria-hidden='true' className={iconClassName} />
  }

  if (/search|find|grep|query|match/.test(normalizedTitle)) {
    return <SearchLine aria-hidden='true' className={iconClassName} />
  }

  if (/read|open|view|inspect/.test(normalizedTitle)) {
    return <EyeglassLine aria-hidden='true' className={iconClassName} />
  }

  if (/patch|code|diff/.test(normalizedTitle)) {
    return <CodeLine aria-hidden='true' className={iconClassName} />
  }

  return <ToolLine aria-hidden='true' className={iconClassName} />
}

function getMessageStatusIcon(status: AgentSidebarMessageStatus) {
  switch (status) {
    case 'running':
      return <Icon aria-hidden='true' className='agent-message-status-icon is-running' icon='svg-spinners:bars-rotate-fade' />
    case 'error':
      return <Icon aria-hidden='true' className='agent-message-status-icon is-error' icon='ci:error-outline' />
    default:
      return null
  }
}

function AgentMessageDisclosure({
  children,
  className,
  expanded,
  kind,
  label,
  onExpandedChange,
  scrollViewportRef,
  status,
  title,
}: {
  children: ReactNode
  className?: string
  expanded: boolean
  kind: 'details' | 'thinking' | 'tool'
  label?: string
  onExpandedChange: (nextExpanded: boolean) => void
  scrollViewportRef?: Ref<HTMLDivElement>
  status?: AgentSidebarMessageStatus
  title: string
}) {
  const displayTitle = formatDisclosureTitle(title)
  const statusIcon = status ? getMessageStatusIcon(status) : null
  const shouldUseScrollArea = kind === 'thinking' || kind === 'tool'

  return (
    <Disclosure
      className={`agent-message agent-message-disclosure-card ${className ?? ''}`.trim()}
      isExpanded={expanded}
      onExpandedChange={onExpandedChange}
    >
      {({ isExpanded: disclosureExpanded }) => (
        <>
          <div className='agent-message-disclosure-header'>
            <Disclosure.Heading className='agent-disclosure-heading'>
              <AppTooltip
                tooltip={status ? getToolStatusLabel(status) : undefined}
                triggerMode='context'
              >
                <Disclosure.Trigger className='agent-message-toggle'>
                  {getMessageDisclosureIcon(kind, title)}
                  <span className='agent-message-toggle-title'>{displayTitle}</span>
                  <span className='agent-message-toggle-trailing'>
                    {statusIcon && !disclosureExpanded ? (
                      <span className='agent-message-toggle-status-slot'>
                        {statusIcon}
                      </span>
                    ) : null}
                    <RightLine
                      aria-hidden='true'
                      className={`agent-message-toggle-arrow ${disclosureExpanded ? 'is-open' : ''} ${statusIcon && !disclosureExpanded ? 'has-status' : ''}`}
                    />
                  </span>
                </Disclosure.Trigger>
              </AppTooltip>
            </Disclosure.Heading>
            {label ? (
              <div className='agent-message-disclosure-meta'>
                {label ? <span className='agent-message-label'>{label}</span> : null}
              </div>
            ) : null}
          </div>

          {disclosureExpanded ? (
            <Disclosure.Content>
              <Disclosure.Body className={`agent-message-disclosure-body agent-message-disclosure-body-${kind}`}>
                {shouldUseScrollArea ? (
                  <AppScrollArea
                    className={`agent-message-disclosure-scroll agent-message-disclosure-scroll-${kind}`}
                    contentClassName={`agent-message-disclosure-scroll-content agent-message-disclosure-scroll-content-${kind}`}
                    viewportClassName={`agent-message-disclosure-scroll-viewport agent-message-disclosure-scroll-viewport-${kind}`}
                    viewportRef={scrollViewportRef}
                  >
                    {children}
                  </AppScrollArea>
                ) : children}
              </Disclosure.Body>
            </Disclosure.Content>
          ) : null}
        </>
      )}
    </Disclosure>
  )
}

function AgentFileCard({
  ariaLabel,
  className,
  fileName,
  iconSize = 18,
  iconTheme,
  imageSrc,
  isImage = false,
  isMuted = false,
  meta,
  onActivate,
  onRemove,
  trailing,
}: AgentFileCardProps) {
  const isInteractive = Boolean(onActivate)
  const fileCardClassName = [
    'agent-file-card',
    className,
    isImage ? 'is-image' : '',
    isMuted ? 'is-muted' : '',
    isInteractive ? 'is-interactive' : '',
  ].filter(Boolean).join(' ')

  function handleActivate() {
    onActivate?.()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    onActivate?.()
  }

  const card = (
    <div
      aria-label={isInteractive ? ariaLabel : undefined}
      className={fileCardClassName}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={isInteractive ? handleActivate : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
    >
      <span className={`agent-file-card-preview${imageSrc ? ' has-image' : ''}`}>
        {imageSrc ? (
          <img alt='' draggable='false' src={imageSrc} />
        ) : isImage ? (
          <PicLine aria-hidden='true' size={iconSize} />
        ) : (
          <WorkspaceFileIcon fileName={fileName} iconTheme={iconTheme ?? null} />
        )}
      </span>
      {isImage ? null : (
        <span className='agent-file-card-text'>
          <span className='agent-file-card-name'>{fileName}</span>
          {meta ? <span className='agent-file-card-meta'>{meta}</span> : null}
        </span>
      )}
      {trailing ? <span className='agent-file-card-trailing'>{trailing}</span> : null}
      {onRemove ? (
        <AppTooltipButton
          type='button'
          className='agent-file-card-remove'
          aria-label={`移除 ${fileName}`}
          tooltip='移除附件'
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <CloseLine aria-hidden='true' size={10} />
        </AppTooltipButton>
      ) : null}
    </div>
  )

  return card
}

const AgentMessageFileCards = memo(function AgentMessageFileCards({
  fileChanges,
  iconTheme,
  onOpenFile,
  workspacePath,
}: {
  fileChanges: AgentMessageFileChange[]
  iconTheme?: WorkspaceIconTheme | null
  onOpenFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  workspacePath: string | null
}) {
  if (fileChanges.length === 0) {
    return null
  }

  const visibleChanges = fileChanges.slice(0, MAX_VISIBLE_MESSAGE_FILE_CARDS)
  const hiddenCount = fileChanges.length - visibleChanges.length
  const title = getMessageFileSectionTitle(fileChanges)

  return (
    <div className='agent-message-footer'>
      <div className='agent-message-files-heading'>
        <span className='agent-message-files-title'>{title}</span>
        <span className='agent-message-files-count'>{fileChanges.length}</span>
      </div>
      <div className='agent-message-files'>
        {visibleChanges.map((change) => {
          const relativePath = getAgentRelativePath(workspacePath, change.filePath)
          const label = relativePath.split('/').pop() ?? relativePath
          const onActivate = change.kind !== 'deleted' && onOpenFile
            ? () => {
                onOpenFile(change.filePath, change.kind)
              }
            : undefined

          return (
            <AgentFileCard
              key={`${change.filePath}:${change.kind}`}
              aria-label={`Open ${relativePath}`}
              className='agent-message-file-card'
              fileName={label}
              iconTheme={iconTheme}
              onActivate={onActivate}
              trailing={<FileChangeStatusBadge className='agent-message-file-card-status' kind={getAgentFileChangeVisualKind(change.kind)} />}
            />
          )
        })}
        {hiddenCount > 0 ? (
          <AppTooltip
            excludeFromTabOrder
            tooltip={`还有 ${hiddenCount} 个文件`}
            triggerRole='img'
          >
            <div className='agent-message-file-overflow-card'>
              <span className='agent-message-file-overflow-label'>+{hiddenCount}</span>
            </div>
          </AppTooltip>
        ) : null}
      </div>
    </div>
  )
})

function getAgentAttachmentFileCardProps({
  attachment,
  iconTheme,
  iconSize = 18,
  onRemove,
}: {
  attachment: AgentFileCardAttachmentData
  iconTheme?: WorkspaceIconTheme | null
  iconSize?: number
  onRemove?: () => void
}): AgentFileCardProps {
  const isImage = attachment.kind === 'image'
  const previewSrc = isImage ? attachment.data : undefined
  const statusLabel = getAttachmentStatusLabel(attachment.status)
  const sizeLabel = formatAttachmentSize(attachment.size)
  const meta = [
    isImage ? 'Image' : 'File',
    isImage ? null : sizeLabel,
    statusLabel,
  ].filter(Boolean).join(' · ')

  return {
    fileName: attachment.fileName,
    iconSize,
    iconTheme,
    imageSrc: previewSrc,
    isImage,
    isMuted: attachment.status === 'omitted',
    meta,
    onRemove,
  }
}

function AgentMessageAttachments({
  attachments,
  iconTheme,
}: {
  attachments: AgentMessageAttachment[]
  iconTheme?: WorkspaceIconTheme | null
}) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className='agent-message-attachments' aria-label='Attachments'>
      {attachments.map((attachment, index) => (
        <AgentFileCard
          key={`${attachment.fileName}-${index}`}
          {...getAgentAttachmentFileCardProps({ attachment, iconTheme })}
        />
      ))}
    </div>
  )
}

const AgentMessageBubble = memo(function AgentMessageBubble({
  iconTheme,
  message,
  onOpenWorkspaceFile,
  workspacePath,
}: {
  iconTheme?: WorkspaceIconTheme | null
  message: AgentSidebarMessage
  onOpenWorkspaceFile?: (filePath: string) => void
  workspacePath: string | null
}) {
  const isToolMessage = message.kind === 'tool'
  const hasThinking = message.kind === 'assistant' && Boolean(message.thinkingText)
  const isCollapsibleSystemMessage = (message.kind === 'system' || message.kind === 'custom')
    && (message.title === 'Compaction summary' || message.title === 'Branch summary')
  const messageStatus = getMessageStatus(message)
  const shouldAutoExpandThinking = hasThinking && Boolean(message.isThinkingStreaming)
  const thinkingViewportRef = useRef<HTMLDivElement | null>(null)
  const shouldStickThinkingToBottomRef = useRef(true)
  const [isToolExpanded, setIsToolExpanded] = useState(false)
  const [isThinkingExpanded, setIsThinkingExpanded] = useAutoDisclosureState({
    collapseDelayMs: AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS,
    expandDelayMs: AGENT_THINKING_AUTO_EXPAND_DELAY_MS,
    initialExpanded: false,
    minExpandedMs: AGENT_THINKING_MIN_EXPANDED_MS,
    nextAutoExpanded: shouldAutoExpandThinking,
    stateKey: message.id,
  })
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(Boolean(message.isError))

  useEffect(() => {
    if (!isCollapsibleSystemMessage) {
      return
    }

    setIsDetailsExpanded(Boolean(message.isError))
  }, [isCollapsibleSystemMessage, message.id, message.isError])

  useEffect(() => {
    shouldStickThinkingToBottomRef.current = true
  }, [message.id])

  useEffect(() => {
    const currentViewport = thinkingViewportRef.current
    if (!currentViewport || !isThinkingExpanded) {
      return
    }

    function updateStickiness(viewport: HTMLDivElement) {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
      shouldStickThinkingToBottomRef.current = distanceFromBottom <= AGENT_THINKING_SCROLL_STICKY_THRESHOLD_PX
    }

    updateStickiness(currentViewport)
    const handleScroll = (event: Event) => {
      if (event.currentTarget instanceof HTMLDivElement) {
        updateStickiness(event.currentTarget)
      }
    }

    currentViewport.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      currentViewport.removeEventListener('scroll', handleScroll)
    }
  }, [isThinkingExpanded, message.id])

  useLayoutEffect(() => {
    if (!message.isThinkingStreaming || !isThinkingExpanded || !shouldStickThinkingToBottomRef.current) {
      return
    }

    const viewport = thinkingViewportRef.current
    if (!viewport) {
      return
    }

    viewport.scrollTop = viewport.scrollHeight
  }, [isThinkingExpanded, message.isThinkingStreaming, message.thinkingText])

  if (isToolMessage) {
    return (
      <AgentMessageDisclosure
        className={`agent-message-tool ${messageStatus === 'running' ? 'is-running' : ''} ${message.isError ? 'is-error' : ''}`}
        expanded={isToolExpanded}
        kind='tool'
        label={message.label}
        onExpandedChange={setIsToolExpanded}
        status={messageStatus}
        title={message.title ?? 'Tool'}
      >
        <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.text} workspacePath={workspacePath} />
      </AgentMessageDisclosure>
    )
  }

  if (isCollapsibleSystemMessage) {
    return (
      <AgentMessageDisclosure
        className={`agent-message-details ${message.isError ? 'is-error' : ''}`}
        expanded={isDetailsExpanded}
        kind='details'
        onExpandedChange={setIsDetailsExpanded}
        title={message.title ?? message.kind}
      >
        <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.text} workspacePath={workspacePath} />
      </AgentMessageDisclosure>
    )
  }

  const roleLabel = message.kind === 'system' || message.kind === 'custom'
    ? (message.title ?? message.kind)
    : null
  const showMeta = Boolean(roleLabel || message.label)
  const messageAttachments = message.attachments ?? []

  return (
    <article className={`agent-message agent-message-${message.kind} ${message.isError ? 'is-error' : ''}`}>
      {showMeta ? (
        <div className='agent-message-meta'>
          {roleLabel ? <span className='agent-message-role'>{roleLabel}</span> : <span />}
          {message.label ? <span className='agent-message-label'>{message.label}</span> : null}
        </div>
      ) : null}

      <div className='agent-message-body'>
        {message.kind === 'assistant' && message.thinkingText ? (
          <AgentMessageDisclosure
            className='agent-message-thinking'
            expanded={isThinkingExpanded}
            kind='thinking'
            onExpandedChange={setIsThinkingExpanded}
            scrollViewportRef={thinkingViewportRef}
            title='Thinking'
          >
            <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.thinkingText} workspacePath={workspacePath} />
          </AgentMessageDisclosure>
        ) : null}
        {messageAttachments.length > 0 ? (
          <AgentMessageAttachments attachments={messageAttachments} iconTheme={iconTheme} />
        ) : null}
        {message.text.trim() ? (
          <div className='agent-message-bubble'>
            <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.text} workspacePath={workspacePath} />
          </div>
        ) : null}
      </div>
    </article>
  )
})

type AgentVirtualMessageListItem =
  | {
      fileChanges: AgentMessageFileChange[]
      key: string
      kind: 'message'
      message: AgentSidebarMessage
    }
  | {
      key: string
      kind: 'status'
      status: AgentSessionStatus
    }

type AgentVirtualMessageAnchor = {
  index: number
  key: string
  offset: number
}

function AgentMessageVirtualSpacer({ height }: { height: number }) {
  if (height <= 0) {
    return null
  }

  return (
    <div
      aria-hidden='true'
      className='agent-message-virtual-spacer'
      style={{ height }}
    />
  )
}

function AgentMessageVirtualRow({
  children,
  itemKey,
  itemIndex,
  isLast,
  onHeightChange,
}: {
  children: ReactNode
  itemKey: string
  itemIndex: number
  isLast: boolean
  onHeightChange: (index: number, key: string, height: number) => void
}) {
  const rowRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const rowElement = rowRef.current
    if (!rowElement || typeof ResizeObserver === 'undefined') {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height
      if (typeof height === 'number') {
        onHeightChange(itemIndex, itemKey, height)
      }
    })

    resizeObserver.observe(rowElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [itemIndex, itemKey, onHeightChange])

  return (
    <div
      ref={rowRef}
      className='agent-message-stack agent-message-virtual-row'
      data-agent-message-index={itemIndex}
      data-agent-message-key={itemKey}
      style={{
        marginBottom: isLast ? 0 : AGENT_MESSAGE_VIRTUALIZATION_GAP_PX,
      }}
    >
      {children}
    </div>
  )
}

function AgentVirtualMessageList({
  activeSessionPath,
  items,
  messagesScrollElement,
  iconTheme,
  onOpenMessageFile,
  onOpenWorkspaceFile,
  workspacePath,
}: {
  activeSessionPath: string | null
  items: AgentVirtualMessageListItem[]
  messagesScrollElement: HTMLDivElement | null
  iconTheme?: WorkspaceIconTheme | null
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenWorkspaceFile?: (filePath: string) => void
  workspacePath: string | null
}) {
  const [viewportState, setViewportState] = useState(() => ({
    scrollTop: Number.MAX_SAFE_INTEGER,
    viewportHeight: AGENT_MESSAGE_VIRTUALIZATION_INITIAL_VIEWPORT_HEIGHT,
  }))
  const [measuredHeights, setMeasuredHeights] = useState<Record<string, number>>({})
  const anchorRestorePendingRef = useRef(false)
  const virtualAnchorRef = useRef<AgentVirtualMessageAnchor | null>(null)
  const measuredHeightsRef = useRef<Record<string, number>>({})
  const shouldVirtualize = items.length >= AGENT_MESSAGE_VIRTUALIZATION_MIN_ITEMS

  useEffect(() => {
    anchorRestorePendingRef.current = false
    measuredHeightsRef.current = {}
    virtualAnchorRef.current = null
    setMeasuredHeights({})
    setViewportState({
      scrollTop: Number.MAX_SAFE_INTEGER,
      viewportHeight: AGENT_MESSAGE_VIRTUALIZATION_INITIAL_VIEWPORT_HEIGHT,
    })
  }, [activeSessionPath])

  const isScrollElementNearBottom = useCallback((scrollElement: HTMLElement) => (
    scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight
      <= AGENT_MESSAGE_VIRTUALIZATION_BOTTOM_ANCHOR_THRESHOLD_PX
  ), [])

  const captureVisibleAnchor = useCallback((scrollElement: HTMLElement) => {
    if (!shouldVirtualize || isScrollElementNearBottom(scrollElement)) {
      virtualAnchorRef.current = null
      return false
    }

    const viewportRect = scrollElement.getBoundingClientRect()
    const rowElements = Array.from(scrollElement.querySelectorAll<HTMLElement>('.agent-message-virtual-row'))
    let firstVisibleRow: HTMLElement | null = null
    let firstVisibleRect: DOMRect | null = null
    let topCrossingRow: HTMLElement | null = null
    let topCrossingRect: DOMRect | null = null

    for (const rowElement of rowElements) {
      const rowRect = rowElement.getBoundingClientRect()
      if (rowRect.bottom <= viewportRect.top || rowRect.top >= viewportRect.bottom) {
        continue
      }

      if (!firstVisibleRow) {
        firstVisibleRow = rowElement
        firstVisibleRect = rowRect
      }

      if (rowRect.top <= viewportRect.top + 1 && rowRect.bottom > viewportRect.top + 1) {
        topCrossingRow = rowElement
        topCrossingRect = rowRect
        break
      }
    }

    const anchorRow = topCrossingRow ?? firstVisibleRow
    const anchorRect = topCrossingRect ?? firstVisibleRect
    const key = anchorRow?.dataset.agentMessageKey
    const index = Number(anchorRow?.dataset.agentMessageIndex)
    if (!anchorRow || !anchorRect || !key || !Number.isInteger(index) || index < 0) {
      virtualAnchorRef.current = null
      return false
    }

    virtualAnchorRef.current = {
      index,
      key,
      offset: topCrossingRow ? Math.max(0, viewportRect.top - anchorRect.top) : 0,
    }
    return true
  }, [isScrollElementNearBottom, shouldVirtualize])

  const restoreVisibleAnchor = useCallback(() => {
    const scrollElement = messagesScrollElement
    const anchor = virtualAnchorRef.current
    if (!scrollElement || !anchor || !shouldVirtualize || isScrollElementNearBottom(scrollElement)) {
      return
    }

    const itemIndex = items.findIndex((item) => item.key === anchor.key)
    if (itemIndex < 0) {
      virtualAnchorRef.current = null
      return
    }

    const nextScrollTop = Math.max(0, resolveAgentMessageVirtualItemTop({
      count: items.length,
      index: itemIndex,
      measuredHeights: items.map((item) => measuredHeightsRef.current[item.key]),
    }) + anchor.offset)

    if (Math.abs(scrollElement.scrollTop - nextScrollTop) > 1) {
      scrollElement.scrollTop = nextScrollTop
      setViewportState({
        scrollTop: scrollElement.scrollTop,
        viewportHeight: scrollElement.clientHeight,
      })
    }
  }, [isScrollElementNearBottom, items, messagesScrollElement, shouldVirtualize])

  useLayoutEffect(() => {
    if (!anchorRestorePendingRef.current) {
      return
    }

    anchorRestorePendingRef.current = false
    restoreVisibleAnchor()
  }, [measuredHeights, restoreVisibleAnchor])

  useLayoutEffect(() => {
    const scrollElement = messagesScrollElement
    if (!scrollElement || !shouldVirtualize) {
      return
    }

    let frameId: number | null = null
    const syncViewportState = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        setViewportState({
          scrollTop: scrollElement.scrollTop,
          viewportHeight: scrollElement.clientHeight,
        })
        captureVisibleAnchor(scrollElement)
      })
    }

    syncViewportState()
    scrollElement.addEventListener('scroll', syncViewportState, { passive: true })

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(syncViewportState)
    resizeObserver?.observe(scrollElement)

    return () => {
      scrollElement.removeEventListener('scroll', syncViewportState)
      resizeObserver?.disconnect()

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [captureVisibleAnchor, items.length, messagesScrollElement, shouldVirtualize])

  const handleHeightChange = useCallback((index: number, key: string, height: number) => {
    const currentHeights = measuredHeightsRef.current
    if (Math.abs((currentHeights[key] ?? 0) - height) < 1) {
      return
    }

    const itemIndex = items[index]?.key === key
      ? index
      : items.findIndex((item) => item.key === key)
    if (itemIndex < 0) {
      return
    }

    const scrollElement = messagesScrollElement
    if (scrollElement && shouldVirtualize && captureVisibleAnchor(scrollElement)) {
      const anchor = virtualAnchorRef.current
      if (anchor && shouldRestoreAgentMessageVirtualAnchor({
        anchorIndex: anchor.index,
        changedIndex: itemIndex,
      })) {
        anchorRestorePendingRef.current = true
      }
    }

    const nextHeights = {
      ...currentHeights,
      [key]: height,
    }
    measuredHeightsRef.current = nextHeights
    setMeasuredHeights(nextHeights)
  }, [captureVisibleAnchor, items, messagesScrollElement, shouldVirtualize])

  const virtualRange = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        afterHeight: 0,
        beforeHeight: 0,
        endIndex: items.length,
        startIndex: 0,
        totalHeight: 0,
      }
    }

    return resolveAgentMessageVirtualRange({
      count: items.length,
      measuredHeights: items.map((item) => measuredHeights[item.key]),
      scrollTop: viewportState.scrollTop,
      viewportHeight: viewportState.viewportHeight,
    })
  }, [items, measuredHeights, shouldVirtualize, viewportState.scrollTop, viewportState.viewportHeight])

  const visibleItems = items.slice(virtualRange.startIndex, virtualRange.endIndex)

  return (
    <>
      <AgentMessageVirtualSpacer height={virtualRange.beforeHeight} />
      {visibleItems.map((item, visibleIndex) => {
        const itemIndex = virtualRange.startIndex + visibleIndex
        const isLast = itemIndex === items.length - 1

        return (
          <AgentMessageVirtualRow
            key={item.key}
            itemKey={item.key}
            itemIndex={itemIndex}
            isLast={isLast}
            onHeightChange={handleHeightChange}
          >
            {item.kind === 'message' ? (
              <>
                <AgentMessageBubble
                  iconTheme={iconTheme}
                  message={item.message}
                  onOpenWorkspaceFile={onOpenWorkspaceFile}
                  workspacePath={workspacePath}
                />
                {item.fileChanges.length > 0 ? (
                  <AgentMessageFileCards
                    fileChanges={item.fileChanges}
                    iconTheme={iconTheme}
                    onOpenFile={onOpenMessageFile}
                    workspacePath={workspacePath}
                  />
                ) : null}
              </>
            ) : (
              <AgentSessionStatusBubble status={item.status} />
            )}
          </AgentMessageVirtualRow>
        )
      })}
      <AgentMessageVirtualSpacer height={virtualRange.afterHeight} />
    </>
  )
}

type AgentSessionStatusTone = 'error' | 'running'

type AgentSessionStatusIndicator =
  | {
      kind: 'spinner'
      name: BrailleSpinnerName
    }
  | {
      kind: 'symbol'
      value: string
    }

type AgentSessionStatusBadgeKind = 'follow-up' | 'pending' | 'steer'

type AgentSessionStatusBadge = {
  kind: AgentSessionStatusBadgeKind
  indicator: Extract<AgentSessionStatusIndicator, { kind: 'spinner' }>
  label: string
  title: string
}

type AgentSessionStatus = {
  badges?: AgentSessionStatusBadge[]
  indicator: AgentSessionStatusIndicator
  label: string
  tone: AgentSessionStatusTone
}

type AgentSessionPhase =
  | {
      type: 'error'
      message: string
    }
  | {
      type: 'tool_execution'
    }
  | {
      type: 'compaction'
    }
  | {
      type: 'auto_retry'
    }
  | {
      type: 'thinking'
    }
  | {
      type: 'streaming'
    }
  | {
      type: 'working'
    }
  | {
      type: 'queued'
    }
  | {
      type: 'idle'
    }

type AnimatedAgentSessionStatusType = Exclude<AgentSessionPhase['type'], 'error' | 'idle'>

const AGENT_SESSION_STATUS_ANIMATIONS: Record<AnimatedAgentSessionStatusType, BrailleSpinnerName> = {
  auto_retry: 'orbit',
  compaction: 'cascade',
  queued: 'columns',
  streaming: 'braillewave',
  thinking: 'dna',
  tool_execution: 'scan',
  working: 'braille',
}

type AgentSessionQueueCounts = Pick<
  AgentWorkspaceState['runtime'],
  'followUpMessageCount' | 'pendingMessageCount' | 'steeringMessageCount'
>

function deriveAgentSessionPhase({
  draftAssistant,
  hasVisibleRunningContent,
  isStreaming,
  isThinkingStreaming,
  panelError,
  pendingMessageCount,
  retryAttempt,
  runningTools,
  runtime,
  workspacePath,
}: {
  draftAssistant: string
  hasVisibleRunningContent: boolean
  isStreaming: boolean
  isThinkingStreaming: boolean
  panelError: string | null
  pendingMessageCount: number
  retryAttempt: number
  runningTools: LiveToolState[]
  runtime: AgentWorkspaceState['runtime']
  workspacePath: string | null
}): AgentSessionPhase | null {
  if (!workspacePath) {
    return null
  }

  if (panelError) {
    return {
      message: panelError,
      type: 'error',
    }
  }

  if (runtime.agentId !== DEFAULT_AGENT_ID) {
    if (runtime.executionState?.type === 'retry') {
      return { type: 'auto_retry' }
    }

    if (isStreaming) {
      if (
        hasVisibleRunningContent
        || runningTools.length > 0
        || draftAssistant.trim()
        || isThinkingStreaming
      ) {
        return null
      }
      return { type: 'thinking' }
    }

    if (pendingMessageCount > 0) {
      return { type: 'queued' }
    }

    return runtime.hasConfiguredModels ? { type: 'idle' } : null
  }

  if (runningTools.length > 0) {
    return {
      type: 'tool_execution',
    }
  }

  if (runtime.isCompacting) {
    return {
      type: 'compaction',
    }
  }

  if (retryAttempt > 0) {
    return {
      type: 'auto_retry',
    }
  }

  if (isStreaming) {
    if (isThinkingStreaming && !draftAssistant.trim()) {
      return {
        type: 'thinking',
      }
    }

    if (draftAssistant.trim()) {
      return {
        type: 'streaming',
      }
    }

    return {
      type: 'working',
    }
  }

  if (pendingMessageCount > 0) {
    return {
      type: 'queued',
    }
  }

  if (!runtime.hasConfiguredModels) {
    return null
  }

  return {
    type: 'idle',
  }
}

function formatQueueCountLabel(label: string, count: number) {
  return `${label} ${count}`
}

function getPositiveQueueCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function getAgentSessionStatusBadges({
  followUpMessageCount,
  pendingMessageCount,
  steeringMessageCount,
}: AgentSessionQueueCounts): AgentSessionStatusBadge[] {
  const steerCount = getPositiveQueueCount(steeringMessageCount)
  const followUpCount = getPositiveQueueCount(followUpMessageCount)
  const pendingCount = getPositiveQueueCount(pendingMessageCount)
  const unresolvedCount = Math.max(0, pendingCount - steerCount - followUpCount)
  const badges: AgentSessionStatusBadge[] = []

  if (steerCount > 0) {
    badges.push({
      kind: 'steer',
      indicator: {
        kind: 'spinner',
        name: 'scan',
      },
      label: formatQueueCountLabel('引导', steerCount),
      title: 'steer：插入当前运行的下一轮之前，用于修正或引导正在进行的任务。',
    })
  }

  if (followUpCount > 0) {
    badges.push({
      kind: 'follow-up',
      indicator: {
        kind: 'spinner',
        name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
      },
      label: formatQueueCountLabel('排队', followUpCount),
      title: 'followUp：当前 agent 停止后再执行，适合追加后续任务。',
    })
  }

  if (unresolvedCount > 0) {
    badges.push({
      kind: 'pending',
      indicator: {
        kind: 'spinner',
        name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
      },
      label: formatQueueCountLabel('等待', unresolvedCount),
      title: '等待处理的消息，当前运行时没有返回更细的 steer/followUp 分类。',
    })
  }

  return badges
}

function getQueuedStatusLabel({
  followUpMessageCount,
  pendingMessageCount,
  steeringMessageCount,
}: AgentSessionQueueCounts) {
  const steerCount = getPositiveQueueCount(steeringMessageCount)
  const followUpCount = getPositiveQueueCount(followUpMessageCount)
  const pendingCount = getPositiveQueueCount(pendingMessageCount)

  if (steerCount > 0 && followUpCount === 0 && steerCount === pendingCount) {
    return '引导等待中'
  }

  if (followUpCount > 0 && steerCount === 0 && followUpCount === pendingCount) {
    return '排队等待中'
  }

  return pendingCount > 0 ? '等待处理' : '等待中'
}

function formatAgentSessionStatus(
  phase: AgentSessionPhase,
  queueCounts: AgentSessionQueueCounts,
): AgentSessionStatus | null {
  const queueBadges = phase.type !== 'error'
    ? getAgentSessionStatusBadges(queueCounts)
    : undefined
  const badges = queueBadges && queueBadges.length > 0
    ? queueBadges
    : undefined

  switch (phase.type) {
    case 'error':
      return {
        indicator: {
          kind: 'symbol',
          value: '•',
        },
        label: 'Error',
        tone: 'error',
    }
    case 'tool_execution': {
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.tool_execution,
        },
        label: 'Tool execution',
        tone: 'running',
      }
    }
    case 'compaction': {
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.compaction,
        },
        label: 'Compaction',
        tone: 'running',
      }
    }
    case 'auto_retry': {
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.auto_retry,
        },
        label: 'Auto-retry',
        tone: 'running',
      }
    }
    case 'thinking': {
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.thinking,
        },
        label: 'Thinking',
        tone: 'running',
      }
    }
    case 'streaming': {
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.streaming,
        },
        label: 'Streaming',
        tone: 'running',
      }
    }
    case 'working': {
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.working,
        },
        label: 'Working',
        tone: 'running',
      }
    }
    case 'queued':
      return {
        badges,
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
        },
        label: getQueuedStatusLabel(queueCounts),
        tone: 'running',
      }
    case 'idle':
      return null
  }
}

function getStreamingPromptBehaviorForShortcut(
  event: Pick<KeyboardEvent<HTMLElement>, 'ctrlKey' | 'metaKey'>,
  platform: NodeJS.Platform,
  defaultBehavior: AgentRunningPromptEnterBehavior,
): AgentRunningPromptEnterBehavior {
  const shouldUseAlternateBehavior = platform === 'darwin'
    ? event.metaKey
    : event.ctrlKey

  return shouldUseAlternateBehavior
    ? getAlternateRunningPromptBehavior(defaultBehavior)
    : defaultBehavior
}

function getSystemFileManagerName(platform: NodeJS.Platform) {
  if (platform === 'darwin') {
    return '访达'
  }

  if (platform === 'win32') {
    return '资源管理器'
  }

  return '文件管理器'
}

function UnicodeSpinner({
  className,
  name,
}: {
  className: string
  name: BrailleSpinnerName
}) {
  const spinner = spinners[name]
  const [frameIndex, setFrameIndex] = useState(0)

  useEffect(() => {
    setFrameIndex(0)

    const timer = window.setInterval(() => {
      setFrameIndex((currentValue) => (currentValue + 1) % spinner.frames.length)
    }, spinner.interval)

    return () => {
      window.clearInterval(timer)
    }
  }, [name, spinner.frames.length, spinner.interval])

  return (
    <span aria-hidden='true' className={className}>
      {spinner.frames[frameIndex] ?? spinner.frames[0]}
    </span>
  )
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

function AgentSessionStatusIndicator({ status }: { status: AgentSessionStatus }) {
  if (status.indicator.kind === 'spinner') {
    return (
      <UnicodeSpinner
        className={`agent-session-status-indicator agent-session-status-indicator-${status.tone}`}
        name={status.indicator.name}
      />
    )
  }

  return (
    <span
      aria-hidden='true'
      className={`agent-session-status-indicator agent-session-status-indicator-${status.tone}`}
    >
      {status.indicator.value}
    </span>
  )
}

function AgentSessionStatusBubble({ status }: { status: AgentSessionStatus }) {
  return (
    <article className={`agent-session-status agent-session-status-${status.tone}`}>
      <AgentSessionStatusIndicator status={status} />
      <span className={`agent-session-status-label agent-session-status-label-${status.tone}`}>
        {status.label}
      </span>
      {status.badges?.map((badge) => (
        <AppTooltip
          excludeFromTabOrder
          key={`${badge.kind}:${badge.label}`}
          tooltip={badge.title}
          triggerRole='status'
        >
          <span
            className={`agent-session-status-badge agent-session-status-badge-${badge.kind}`}
            aria-label={badge.title}
          >
            <UnicodeSpinner
              className='agent-session-status-badge-indicator'
              name={badge.indicator.name}
            />
            <span className='agent-session-status-badge-label'>{badge.label}</span>
          </span>
        </AppTooltip>
      ))}
    </article>
  )
}

function AgentQueuedComposerTray({
  canEdit,
  menuPortalTarget,
  messages,
  onUpdate,
}: {
  canEdit: boolean
  menuPortalTarget?: HTMLElement | null
  messages: AgentQueuedComposerMessage[]
  onUpdate: (update: AgentQueuedMessageUpdate) => Promise<void>
}) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [openMenuMessageId, setOpenMenuMessageId] = useState<string | null>(null)
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null)
  const editingInputRef = useRef<HTMLInputElement | null>(null)
  const canRenderMenuPortal = menuPortalTarget !== null

  useEffect(() => {
    if (!editingMessageId || messages.some((message) => message.id === editingMessageId)) {
      return
    }

    setEditingMessageId(null)
    setEditingText('')
  }, [editingMessageId, messages])

  useEffect(() => {
    if (!openMenuMessageId || messages.some((message) => message.id === openMenuMessageId)) {
      return
    }

    setOpenMenuMessageId(null)
  }, [messages, openMenuMessageId])

  useEffect(() => {
    if (!editingMessageId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      editingInputRef.current?.focus()
      editingInputRef.current?.select()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [editingMessageId])

  if (messages.length === 0) {
    return null
  }

  function beginEdit(message: AgentQueuedComposerMessage) {
    setOpenMenuMessageId(null)
    setEditingMessageId(message.id)
    setEditingText(message.text)
  }

  function cancelEdit() {
    setEditingMessageId(null)
    setEditingText('')
  }

  async function runUpdate(message: AgentQueuedComposerMessage, update: AgentQueuedMessageUpdate) {
    try {
      setUpdatingMessageId(message.id)
      await onUpdate(update)
      if (update.action === 'edit') {
        cancelEdit()
      }
      setOpenMenuMessageId(null)
    } catch {
      // Parent state owns the visible error; keep the row open so the user can retry.
    } finally {
      setUpdatingMessageId(null)
    }
  }

  async function saveEdit(message: AgentQueuedComposerMessage) {
    const nextText = editingText.trim()

    if (!nextText || nextText === message.text) {
      cancelEdit()
      return
    }

    await runUpdate(message, {
      action: 'edit',
      expectedText: message.text,
      index: message.index,
      kind: message.kind,
      text: nextText,
    })
  }

  return (
    <div className='agent-queued-tray' aria-label='待处理的 Agent 消息'>
      {messages.map((message) => {
        const isEditing = editingMessageId === message.id
        const isUpdating = updatingMessageId === message.id
        const isMenuOpen = openMenuMessageId === message.id
        const isFollowUp = message.kind === 'followUp'
        const targetKind = isFollowUp ? 'steer' : 'followUp'

        return (
          <div
            key={message.id}
            className={`agent-queued-row agent-queued-row-${message.kind}${isEditing ? ' is-editing' : ''}`}
          >
            <div className='agent-queued-row-leading' aria-hidden='true'>
              <span className='agent-queued-row-grip'>::</span>
              <CornerUpLeftLine size={16} />
            </div>

            <div className='agent-queued-row-main'>
              <span className={`agent-queued-kind agent-queued-kind-${message.kind}`}>
                {isFollowUp ? '排队' : '引导'}
              </span>
              {!canEdit ? null : isEditing ? (
                <input
                  ref={editingInputRef}
                  className='agent-queued-edit-input'
                  value={editingText}
                  disabled={isUpdating}
                  aria-label='编辑待处理消息'
                  onChange={(event) => {
                    setEditingText(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      cancelEdit()
                    }

                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void saveEdit(message)
                    }
                  }}
                />
              ) : (
                <AppTooltip
                  excludeFromTabOrder
                  tooltip={message.text}
                  triggerClassName='agent-queued-text'
                  triggerRole='note'
                >
                  <span>
                    {message.text}
                  </span>
                </AppTooltip>
              )}
            </div>

            <div className='agent-queued-actions'>
              {isEditing ? (
                <>
                  <button
                    type='button'
                    className='agent-queued-action is-text'
                    disabled={isUpdating || !editingText.trim()}
                    onClick={() => {
                      void saveEdit(message)
                    }}
                  >
                    保存
                  </button>
                  <button
                    type='button'
                    className='agent-queued-action is-text'
                    disabled={isUpdating}
                    onClick={cancelEdit}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <AppTooltipButton
                    type='button'
                    className='agent-queued-action is-text'
                    disabled={isUpdating}
                    onClick={() => {
                      void runUpdate(message, {
                        action: 'move',
                        expectedText: message.text,
                        index: message.index,
                        kind: message.kind,
                        targetKind,
                      })
                    }}
                  >
                    {isFollowUp ? '引导' : '排队'}
                  </AppTooltipButton>
                  <AppTooltipButton
                    type='button'
                    className='agent-queued-action'
                    disabled={isUpdating}
                    aria-label='删除待处理消息'
                    tooltip='删除'
                    onClick={() => {
                      void runUpdate(message, {
                        action: 'delete',
                        expectedText: message.text,
                        index: message.index,
                        kind: message.kind,
                      })
                    }}
                  >
                    <Delete2Line size={16} />
                  </AppTooltipButton>
                  <Menu.Root
                    modal={false}
                    open={isMenuOpen}
                    onOpenChange={(open, details) => {
                      if (open) {
                        setOpenMenuMessageId(message.id)
                        return
                      }

                      if (shouldCloseClickOpenedMenu(details)) {
                        setOpenMenuMessageId((currentValue) => (
                          currentValue === message.id ? null : currentValue
                        ))
                      } else {
                        details.cancel()
                      }
                    }}
                  >
                    <div className='agent-queued-menu-anchor'>
                      <Menu.Trigger
                        className='agent-queued-action'
                        disabled={isUpdating}
                        aria-label='更多待处理消息操作'
                        render={<AppTooltipButton tooltip='更多' />}
                      >
                        <More1Line size={16} />
                      </Menu.Trigger>
                      {canRenderMenuPortal ? (
                        <Menu.Portal container={menuPortalTarget ?? undefined}>
                          <Menu.Positioner
                            align='end'
                            className='agent-queued-menu-positioner'
                            collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
                            collisionPadding={8}
                            positionMethod='fixed'
                            side='bottom'
                            sideOffset={6}
                          >
                            <Menu.Popup className='agent-queued-menu' finalFocus={false}>
                              <Menu.Item
                                nativeButton
                                className={({ highlighted }) => (
                                  `agent-queued-menu-item${highlighted ? ' is-highlighted' : ''}`
                                )}
                                label='编辑消息'
                                render={<button type='button' />}
                                onClick={() => {
                                  beginEdit(message)
                                }}
                              >
                                <EditLine size={16} />
                                <span>编辑消息</span>
                              </Menu.Item>
                              <Menu.Item
                                nativeButton
                                className={({ highlighted }) => (
                                  `agent-queued-menu-item${highlighted ? ' is-highlighted' : ''}`
                                )}
                                label={`关闭${isFollowUp ? '排队' : '引导'}`}
                                render={<button type='button' />}
                                onClick={() => {
                                  void runUpdate(message, {
                                    action: 'delete',
                                    expectedText: message.text,
                                    index: message.index,
                                    kind: message.kind,
                                  })
                                }}
                              >
                                <CornerUpLeftLine size={16} />
                                <span>关闭{isFollowUp ? '排队' : '引导'}</span>
                              </Menu.Item>
                            </Menu.Popup>
                          </Menu.Positioner>
                        </Menu.Portal>
                      ) : null}
                    </div>
                  </Menu.Root>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
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
  const [agentCatalog, setAgentCatalog] = useState<AgentAvailability[]>([])
  const [agentAvailabilityFailures, setAgentAvailabilityFailures] = useState<Partial<Record<AgentId, string>>>({})
  const [agentCatalogRefreshRevision, setAgentCatalogRefreshRevision] = useState(0)
  const [selectedAgentIdValue, setSelectedAgentIdValue] = useState<AgentId>(DEFAULT_AGENT_ID)
  const [viewedSessionSnapshot, setViewedSessionSnapshot] = useState<AgentSessionSnapshot | null>(null)
  const [composerState, setComposerStateValue] = useState<ComposerState>(emptyComposerState)
  const [composerAttachments, setComposerAttachmentsValue] = useState<ComposerAttachment[]>([])
  const [modelInputValue, setModelInputValue] = useState(defaultModelSelection.modelId)
  const [selectedProviderValue, setSelectedProviderValue] = useState(defaultModelSelection.provider)
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<AgentThinkingLevel>(emptyAgentState.runtime.defaultThinkingLevel)
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({
    [defaultModelSelection.provider]: defaultModelSelection.modelId,
  })
  const [activeComposerMenu, setActiveComposerMenu] = useState<AgentComposerMenu>(null)
  const [draftAssistant, setDraftAssistant] = useState('')
  const [draftThinking, setDraftThinking] = useState('')
  const [isThinkingStreaming, setIsThinkingStreaming] = useState(false)
  const [liveTools, setLiveTools] = useState<LiveToolState[]>([])
  const [activeOverlayPanel, setActiveOverlayPanel] = useState<'sessions' | null>(null)
  const [activeSessionSelection, setActiveSessionSelection] = useState<AgentSessionSelection>({ kind: 'new' })
  const [isLoading, setIsLoading] = useState(false)
  const [deletingSessionPath, setDeletingSessionPath] = useState<string | null>(null)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [isSwitchingThinkingLevel, setIsSwitchingThinkingLevel] = useState(false)
  const [isSubmittingComposerPrompt, setIsSubmittingComposerPrompt] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [pendingInteractions, setPendingInteractions] = useState<AgentInteractionRequest[]>([])
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<OptimisticAgentUserMessage[]>([])
  const [sessionActivityById, setSessionActivityById] = useState<Record<string, 'running' | 'waiting'>>({})
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false)
  const [projectSessions, setProjectSessions] = useState<Record<string, AgentProjectSessionBucket>>({})
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const activeRuntimeSessionRef = useRef<AgentWorkspaceState['activeSession']>(null)
  const modelFieldRef = useRef<HTMLDivElement | null>(null)
  const loadAgentStateRequestIdRef = useRef(0)
  const openSessionRequestIdRef = useRef(0)
  const previousSessionPathRef = useRef<string | null>(null)
  const projectSessionRequestsRef = useRef<Set<string>>(new Set())
  const projectSessionRequestGenerationRef = useRef(0)
  const projectSessionsRef = useRef(projectSessions)
  const projectStateRef = useRef(projectState)
  const sessionPathByIdRef = useRef<Map<string, string>>(new Map())
  const shouldStickMessagesToBottomRef = useRef(true)
  const messagesUserScrollIntentRef = useRef(false)
  const messagesUserScrollIntentTimeoutRef = useRef<number | null>(null)
  const messagesBottomRestoreRef = useRef<AgentMessagesBottomRestoreController | null>(null)
  const locallyEmittedWorkspaceStatesRef = useRef<WeakSet<AgentWorkspaceState>>(new WeakSet())
  const pendingExternalWorkspaceStateRef = useRef<AgentWorkspaceState | null>(null)
  const handledExternalSessionRequestRef = useRef<number | null>(null)
  const lastConversationTitleSuggestionKeyRef = useRef<string | null>(null)
  const externalSessionRequestRef = useRef<AgentProjectSessionRequest | null>(externalSessionRequest ?? null)
  const activeSessionSelectionRef = useRef(activeSessionSelection)
  const workspacePathRef = useRef<string | null>(workspacePath)
  const composerStateRef = useRef<ComposerState>(emptyComposerState)
  const composerAttachmentsRef = useRef<ComposerAttachment[]>([])
  const composerRevisionRef = useRef(0)
  const optimisticComposerClearIdRef = useRef(0)
  const isSubmittingComposerPromptRef = useRef(false)
  const newSessionModelDraftRef = useRef<AgentModelDraft>(getRuntimeDefaultModelDraft(emptyAgentState.runtime))
  const fileAutoOpenStateRef = useRef<AgentFileAutoOpenState>(initialAgentFileAutoOpenState)
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
  const resolvedAgentCatalog = useMemo(() => agentCatalog.map((availability) => {
    const failureReason = agentAvailabilityFailures[availability.definition.id]
    return failureReason
      ? { ...availability, available: false, reason: failureReason }
      : availability
  }), [agentAvailabilityFailures, agentCatalog])
  const sessionTreeAgentIds = SESSION_TREE_AGENT_IDS
  const effectiveRunningPromptEnterBehavior = resolveSupportedRunningPromptBehavior(
    agentState.runtime.supportedRunningPromptBehaviors,
    runningPromptEnterBehavior,
  )
  activeRuntimeSessionRef.current = agentState.activeSession
  selectedAgentIdRef.current = selectedAgentId
  projectSessionsRef.current = projectSessions
  projectStateRef.current = projectState
  const pendingInteraction = pendingInteractions.find((request) => (
    request.agentId === selectedAgentId
    && request.sessionId === agentState.activeSession?.sessionId
    && (!workspacePath || normalizeAgentProjectPath(request.workspacePath) === normalizeAgentProjectPath(workspacePath))
  )) ?? null

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

  const storeProjectAgentSessions = useCallback((
    targetWorkspacePath: string,
    agentId: AgentId,
    sessions: AgentSessionListItem[],
  ) => {
    const matchingProjectIds = projectStateRef.current.projects
      .filter((project) => normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(targetWorkspacePath))
      .map((project) => project.id)
    if (matchingProjectIds.length === 0) return

    setProjectSessions((currentValue) => {
      const nextValue = { ...currentValue }
      for (const projectId of matchingProjectIds) {
        nextValue[projectId] = {
          ...nextValue[projectId],
          [agentId]: {
            error: null,
            hasLoaded: true,
            isLoading: false,
            sessions,
          },
        }
      }
      return nextValue
    })
  }, [])

  const refreshAgentCatalog = useCallback(async () => {
    try {
      const catalog = await window.appApi.getAgentCatalog({ force: true })
      projectSessionRequestGenerationRef.current += 1
      projectSessionRequestsRef.current.clear()
      setAgentCatalog(catalog)
      setAgentAvailabilityFailures({})
      setProjectSessions(invalidateAgentProjectSessionBuckets)
      setAgentCatalogRefreshRevision((revision) => revision + 1)
      setSelectedAgentIdValue((currentAgentId) => (
        catalog.some((item) => item.definition.id === currentAgentId && item.available)
          ? currentAgentId
          : DEFAULT_AGENT_ID
      ))
      setPanelError(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '无法重新检测 Agent。')
    }
  }, [])

  const markAgentUnavailable = useCallback((agentId: AgentId, reason: string) => {
    if (agentId === DEFAULT_AGENT_ID) return
    setAgentAvailabilityFailures((current) => ({ ...current, [agentId]: reason }))
  }, [])

  useEffect(() => {
    let cancelled = false

    try {
      const storedAgentId = window.localStorage.getItem('aryn:last-new-conversation-agent')
      if (storedAgentId === 'builtin-pi' || storedAgentId === 'pi' || storedAgentId === 'opencode' || storedAgentId === 'codex') {
        setSelectedAgentIdValue(storedAgentId)
      }
    } catch {
      // The default remains usable when localStorage is unavailable.
    }

    void window.appApi.getAgentCatalog()
      .then((catalog) => {
        if (cancelled) {
          return
        }

        setAgentCatalog(catalog)
        setSelectedAgentIdValue((currentAgentId) => (
          catalog.some((item) => item.definition.id === currentAgentId && item.available)
            ? currentAgentId
            : DEFAULT_AGENT_ID
        ))
      })
      .catch(() => {
        // Built-in PI remains available even if external CLI discovery fails.
      })

    return () => {
      cancelled = true
    }
  }, [])

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

  const setComposerState = useCallback<Dispatch<SetStateAction<ComposerState>>>((nextState) => {
    const resolvedState = typeof nextState === 'function'
      ? nextState(composerStateRef.current)
      : nextState
    if (composerStateRef.current !== resolvedState) {
      composerRevisionRef.current += 1
    }
    composerStateRef.current = resolvedState
    setComposerStateValue(resolvedState)
  }, [])

  const setComposerAttachments = useCallback<Dispatch<SetStateAction<ComposerAttachment[]>>>((nextAttachments) => {
    const resolvedAttachments = typeof nextAttachments === 'function'
      ? nextAttachments(composerAttachmentsRef.current)
      : nextAttachments
    if (composerAttachmentsRef.current !== resolvedAttachments) {
      composerRevisionRef.current += 1
    }
    composerAttachmentsRef.current = resolvedAttachments
    setComposerAttachmentsValue(resolvedAttachments)
  }, [])

  function clearComposerOptimistically() {
    const clearId = optimisticComposerClearIdRef.current + 1
    optimisticComposerClearIdRef.current = clearId
    setComposerState(emptyComposerState)
    setComposerAttachments([])
    return {
      id: clearId,
      revision: composerRevisionRef.current,
    }
  }

  function invalidateOptimisticComposerClear(clearToken: OptimisticComposerClearToken | null) {
    if (clearToken !== null && optimisticComposerClearIdRef.current === clearToken.id) {
      optimisticComposerClearIdRef.current += 1
    }
  }

  function restoreOptimisticallyClearedComposer(
    clearToken: OptimisticComposerClearToken | null,
    snapshot: { attachments: ComposerAttachment[]; state: ComposerState },
  ) {
    if (
      clearToken === null
      || optimisticComposerClearIdRef.current !== clearToken.id
      || composerRevisionRef.current !== clearToken.revision
      || !isComposerPristineEmpty(composerStateRef.current, composerAttachmentsRef.current)
    ) {
      return
    }

    invalidateOptimisticComposerClear(clearToken)
    setComposerState(snapshot.state)
    setComposerAttachments(snapshot.attachments)
  }

  const loadProjectSessions = useCallback(async (project: ProjectRecord) => {
    const requestGeneration = projectSessionRequestGenerationRef.current
    await Promise.all(sessionTreeAgentIds.map(async (requestAgentId) => {
      const requestKey = `${requestGeneration}\n${requestAgentId}\n${project.id}`
      if (projectSessionRequestsRef.current.has(requestKey)) return
      const existingSource = projectSessionsRef.current[project.id]?.[requestAgentId]
      if (existingSource?.isLoading || existingSource?.hasLoaded) return

      projectSessionRequestsRef.current.add(requestKey)
      setProjectSessions((currentValue) => ({
        ...currentValue,
        [project.id]: {
          ...currentValue[project.id],
          [requestAgentId]: {
            error: null,
            hasLoaded: false,
            isLoading: true,
            sessions: currentValue[project.id]?.[requestAgentId]?.sessions ?? [],
          },
        },
      }))

      try {
        const sessions = await window.appApi.listAgentSessions({
          agentId: requestAgentId,
          workspacePath: project.path,
        })
        if (projectSessionRequestGenerationRef.current !== requestGeneration) return
        setProjectSessions((currentValue) => ({
          ...currentValue,
          [project.id]: {
            ...currentValue[project.id],
            [requestAgentId]: {
              error: null,
              hasLoaded: true,
              isLoading: false,
              sessions,
            },
          },
        }))
      } catch (error) {
        if (projectSessionRequestGenerationRef.current !== requestGeneration) return
        setProjectSessions((currentValue) => ({
          ...currentValue,
          [project.id]: {
            ...currentValue[project.id],
            [requestAgentId]: {
              error: error instanceof Error ? error.message : 'Unable to load conversations.',
              hasLoaded: true,
              isLoading: false,
              sessions: currentValue[project.id]?.[requestAgentId]?.sessions ?? [],
            },
          },
        }))
      } finally {
        projectSessionRequestsRef.current.delete(requestKey)
      }
    }))
  }, [agentCatalogRefreshRevision, sessionTreeAgentIds])

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

  function getRuntimePreferredModelId(provider: string) {
    const preferredModelKey = agentState.runtime.preferredModelByProvider[provider]
    const preferredSelection = parseModelSelection(preferredModelKey ?? null)

    return preferredSelection.provider === provider ? preferredSelection.modelId : null
  }

  function readFileAsDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => {
        reject(new Error(`Unable to read ${file.name}.`))
      }
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result)
          return
        }

        reject(new Error(`Unable to read ${file.name}.`))
      }
      reader.readAsDataURL(file)
    })
  }

  async function buildComposerAttachmentFromFile(file: File): Promise<ComposerAttachment> {
    const kind = isImageAttachment(file.name, file.type) ? 'image' : 'file'
    const data = kind === 'image' ? await readFileAsDataUrl(file) : undefined
    const filePath = window.appApi.getFilePath(file).trim()

    if (kind !== 'image' && !filePath) {
      throw new Error(`普通文件需要来自本地磁盘路径。请使用附件按钮选择文件，或从${getSystemFileManagerName(window.appApi.platform)}拖入文件。`)
    }

    return {
      id: `${Date.now()}-${crypto.randomUUID()}`,
      ...(data ? { data } : {}),
      fileName: file.name,
      kind,
      ...(file.type ? { mimeType: file.type } : {}),
      ...(filePath ? { path: filePath } : {}),
      size: file.size,
    }
  }

  function appendComposerAttachments(nextAttachments: ComposerAttachment[]) {
    if (nextAttachments.length === 0) {
      return
    }

    setComposerAttachments((currentAttachments) => {
      const uniqueAttachments = nextAttachments.filter((attachment) => !currentAttachments.some((currentAttachment) => (
        currentAttachment.fileName === attachment.fileName
        && currentAttachment.size === attachment.size
        && currentAttachment.path === attachment.path
      )))

      return [...currentAttachments, ...uniqueAttachments].slice(0, MAX_COMPOSER_ATTACHMENTS)
    })
  }

  async function addComposerFiles(files: File[]) {
    if (files.length === 0) {
      return
    }

    try {
      setPanelError(null)
      const nextAttachments = await Promise.all(files.slice(0, MAX_COMPOSER_ATTACHMENTS).map(buildComposerAttachmentFromFile))
      appendComposerAttachments(nextAttachments)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to attach the selected file.')
    }
  }

  async function handlePickComposerAttachments() {
    try {
      setPanelError(null)
      const pickedAttachments = await window.appApi.pickAgentAttachments()
      appendComposerAttachments(pickedAttachments.map((attachment) => ({
        ...attachment,
        id: `${Date.now()}-${crypto.randomUUID()}`,
      })))
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to attach files.')
    }
  }

  function removeComposerAttachment(attachmentId: string) {
    setComposerAttachments((currentAttachments) => currentAttachments.filter((attachment) => attachment.id !== attachmentId))
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
        setDraftAssistant('')
        setDraftThinking('')
        setIsThinkingStreaming(false)
        setLiveTools([])
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
        setActiveComposerMenu(null)
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

  useEffect(() => {
    if (
      !workspacePath
      || !workspaceState
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
  }, [selectedAgentId, workspacePath, workspaceState])

  useEffect(() => {
    const requestId = loadAgentStateRequestIdRef.current + 1
    loadAgentStateRequestIdRef.current = requestId

    if (!workspacePath) {
      setAgentState(emptyAgentState)
      setViewedSessionSnapshot(null)
      setComposerState(emptyComposerState)
      setComposerAttachments([])
      syncNewSessionModelDraft(getRuntimeDefaultModelDraft(emptyAgentState.runtime))
      syncModelDraft(getRuntimeDefaultModelDraft(emptyAgentState.runtime))
      setModelDrafts({
        [defaultModelSelection.provider]: defaultModelSelection.modelId,
      })
      setDraftAssistant('')
      setDraftThinking('')
      setIsThinkingStreaming(false)
      setLiveTools([])
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
            setIsLoading(false)
          }
        })

      return
    }

    setIsLoading(true)
    setPanelError(null)
    setViewedSessionSnapshot(null)
    setHasLoadedWorkspaceState(false)
    const requestedProject = externalSessionRequestRef.current
      ? projectState.projects.find((project) => project.id === externalSessionRequestRef.current?.projectId) ?? null
      : null
    const matchingExternalRequest = requestedProject
      && normalizeAgentProjectPath(requestedProject.path) === normalizeAgentProjectPath(workspacePath)
      ? externalSessionRequestRef.current
      : null
    const shouldStartNewSession = matchingExternalRequest?.kind === 'new'

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

        const nativeRestoredSessionPath = nextState.activeSession?.sessionPath ?? null
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
        setViewedSessionSnapshot(null)
        const nextActiveSessionPath = nextState.activeSession?.sessionPath
        const hasRestoredSession = Boolean(
          nextActiveSessionPath
          && nextState.sessions.some((session) => session.path === nextActiveSessionPath),
        )
        const restoredSessionPath = hasRestoredSession ? nextActiveSessionPath : null
        const nextSelection = shouldStartNewSession
          ? { kind: 'new' as const }
          : restoredSessionPath
            ? { agentId: selectedAgentId, kind: 'session' as const, sessionPath: restoredSessionPath }
            : { kind: 'new' as const }
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
          setIsLoading(false)
        }
      })
  }, [agentCatalogRefreshRevision, markAgentUnavailable, selectedAgentId, workspacePath])

  useEffect(() => {
    if (
      !workspacePath
      || isLoading
      || !hasLoadedWorkspaceState
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
    workspacePath,
  ])

  useEffect(() => {
    if (!workspacePath || activeWorkspaceContext.kind !== 'project') {
      setActiveOverlayPanel(null)
    }
  }, [activeWorkspaceContext.kind, workspacePath])

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
    setComposerState(emptyComposerState)
    setComposerAttachments([])
    setPanelError(null)
    setActiveOverlayPanel(null)
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
      setActiveOverlayPanel(null)
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
      setActiveOverlayPanel(null)
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

  async function handleDeleteSession(rootPath: string, agentId: AgentId, sessionPath: string) {
    if (!rootPath) {
      return
    }

    const deletingKey = getAgentSessionTreeKey(agentId, sessionPath)
    try {
      setDeletingSessionPath(deletingKey)
      setPanelError(null)
      const nextState = await window.appApi.deleteAgentSession({
        agentId,
        workspacePath: rootPath,
      }, sessionPath)
      storeProjectAgentSessions(rootPath, agentId, nextState.sessions)
      const currentSelection = activeSessionSelectionRef.current
      const currentWorkspacePath = workspacePathRef.current
      const isCurrentWorkspaceAgent = Boolean(
        currentWorkspacePath
        && selectedAgentIdRef.current === agentId
        && normalizeAgentProjectPath(rootPath) === normalizeAgentProjectPath(currentWorkspacePath),
      )
      const isDeletingCurrentSession = Boolean(
        isCurrentWorkspaceAgent
        && currentSelection.kind === 'session'
        && currentSelection.agentId === agentId
        && currentSelection.sessionPath === sessionPath
      )
      if (isCurrentWorkspaceAgent) {
        setAgentState((currentState) => isDeletingCurrentSession
          ? nextState
          : { ...currentState, sessions: nextState.sessions })
      }
      if (isDeletingCurrentSession) {
        setViewedSessionSnapshot(null)
        const nextActiveSessionPath = nextState.activeSession?.sessionPath
        const nextSelection = nextActiveSessionPath
          && nextState.sessions.some((session) => session.path === nextActiveSessionPath)
          ? { agentId, kind: 'session' as const, sessionPath: nextActiveSessionPath }
          : { kind: 'new' as const }
        syncActiveSessionSelection(nextSelection)
        syncModelDraft(nextSelection.kind === 'session'
          ? getRuntimeSelectedModelDraft(nextState.runtime)
          : newSessionModelDraftRef.current)
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to delete that session.')
    } finally {
      setDeletingSessionPath((currentKey) => currentKey === deletingKey ? null : currentKey)
    }
  }

  async function handleRenameSession(rootPath: string, agentId: AgentId, sessionPath: string, name: string) {
    const nextName = name.trim()

    if (!nextName) {
      return
    }

    try {
      setPanelError(null)
      const nextState = await window.appApi.renameAgentSession({
        agentId,
        workspacePath: rootPath,
      }, sessionPath, nextName)
      const currentSelection = activeSessionSelectionRef.current
      const currentWorkspacePath = workspacePathRef.current
      const isCurrentWorkspace = Boolean(
        currentWorkspacePath
        && selectedAgentIdRef.current === agentId
        && normalizeAgentProjectPath(rootPath) === normalizeAgentProjectPath(currentWorkspacePath),
      )

      if (isCurrentWorkspace) {
        setAgentState((currentState) => ({ ...currentState, sessions: nextState.sessions }))
        setViewedSessionSnapshot((currentSnapshot) => (
          currentSelection.kind === 'session'
          && currentSelection.agentId === agentId
          && currentSelection.sessionPath === sessionPath
          && currentSnapshot?.sessionPath === sessionPath
            ? { ...currentSnapshot, name: nextName }
            : currentSnapshot
        ))
      }

      storeProjectAgentSessions(rootPath, agentId, nextState.sessions)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to rename that session.')
      throw error
    }
  }

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

  async function submitComposerPrompt(streamingBehavior?: AgentRunningPromptEnterBehavior) {
    const submittedComposerState = composerStateRef.current
    const submittedComposerAttachments = composerAttachmentsRef.current
    const serializedPrompt = serializeComposerText(submittedComposerState.value, submittedComposerState.mentions)
    const trimmedPrompt = serializedPrompt.trim()

    if (
      agentState.activeSession?.native?.agentId === 'opencode'
      && agentState.activeSession.native.parentSessionId
    ) {
      setPanelError('OpenCode 子会话由父会话中的子 Agent 管理，请返回父会话继续输入。')
      return
    }

    if (!trimmedPrompt && submittedComposerAttachments.length === 0) {
      return
    }

    if (!agentState.runtime.hasConfiguredModels) {
      setPanelError(agentState.runtime.setupHint ?? 'Configure a model first.')
      return
    }

    let targetWorkspacePath = workspacePath
    const requiresConversationWorkspace = !targetWorkspacePath && activeWorkspaceContext.kind === 'conversationDraft'
    const createConversationWorkspace = onCreateConversationWorkspace

    if (requiresConversationWorkspace && !createConversationWorkspace) {
      setPanelError('Unable to create a conversation workspace.')
      return
    }

    if (!targetWorkspacePath && !requiresConversationWorkspace) {
      return
    }

    if (isSubmittingComposerPromptRef.current) {
      return
    }

    isSubmittingComposerPromptRef.current = true
    setIsSubmittingComposerPrompt(true)

    const requestAgentId = selectedAgentId
    const requestSelection = activeSessionSelectionRef.current
    let expectedNavigationRevision = openSessionRequestIdRef.current
    let createdConversation: ConversationRecord | null = null
    let runtimeForSubmit = agentState.runtime
    const draftBeforeWorkspaceCreation = newSessionModelDraftRef.current
    const composerSnapshot = {
      attachments: submittedComposerAttachments,
      state: submittedComposerState,
    }
    const optimisticClearId = clearComposerOptimistically()
    let didSendPromptToAgent = false
    let didPersistConversationBinding = false
    let optimisticUserMessageId: string | null = null
    let nextSessionPath: string | null = null
    let fallbackErrorMessage = 'Unable to send your prompt.'

    const isSubmissionContextCurrent = () => {
      const currentWorkspacePath = workspacePathRef.current
      const isCurrentWorkspace = targetWorkspacePath
        ? Boolean(
            currentWorkspacePath
            && normalizeAgentProjectPath(targetWorkspacePath) === normalizeAgentProjectPath(currentWorkspacePath),
          )
        : currentWorkspacePath === null
      if (
        expectedNavigationRevision !== openSessionRequestIdRef.current
        || selectedAgentIdRef.current !== requestAgentId
        || !isCurrentWorkspace
      ) {
        return false
      }

      return true
    }

    const isSubmissionViewCurrent = (sessionPath?: string | null) => {
      if (!isSubmissionContextCurrent()) {
        return false
      }

      const currentSelection = activeSessionSelectionRef.current
      if (sessionPath) {
        return currentSelection.kind === 'session'
          && currentSelection.agentId === requestAgentId
          && currentSelection.sessionPath === sessionPath
      }

      return requestSelection.kind === 'new'
        ? currentSelection.kind === 'new'
        : currentSelection.kind === 'session'
          && currentSelection.agentId === requestSelection.agentId
          && currentSelection.sessionPath === requestSelection.sessionPath
    }

    try {
      setActiveComposerMenu(null)
      setPanelError(null)

      if (requiresConversationWorkspace) {
        fallbackErrorMessage = 'Unable to create a conversation workspace.'
        setIsLoading(true)
        try {
          if (!createConversationWorkspace) {
            throw new Error('Unable to create a conversation workspace.')
          }
          createdConversation = await createConversationWorkspace({
            agentId: requestAgentId,
            initialPrompt: trimmedPrompt,
          })
          targetWorkspacePath = createdConversation.workspacePath
          workspacePathRef.current = targetWorkspacePath

          if (!targetWorkspacePath) {
            throw new Error('Conversation workspace was not created.')
          }

          const nextState = await window.appApi.loadAgentWorkspace({
            agentId: requestAgentId,
            workspacePath: targetWorkspacePath,
          }, null, { restoreSession: false })
          runtimeForSubmit = nextState.runtime
          const defaultDraft = getRuntimeDefaultModelDraft(nextState.runtime)
          const nextNewSessionDraft = normalizeAgentModelDraft(draftBeforeWorkspaceCreation, nextState.runtime, defaultDraft)
          syncNewSessionModelDraft(nextNewSessionDraft)
          if (isSubmissionViewCurrent()) {
            setAgentState(nextState)
            setViewedSessionSnapshot(null)
            setHasLoadedWorkspaceState(true)
            syncModelDraft(nextNewSessionDraft)
          }
        } finally {
          setIsLoading(false)
        }
      }

      if (!targetWorkspacePath) {
        throw new Error('Open a workspace before sending your prompt.')
      }

      nextSessionPath = requestSelection.kind === 'session' ? requestSelection.sessionPath : null

      if (requestSelection.kind === 'new') {
        fallbackErrorMessage = 'Unable to create an agent session.'
        openSessionRequestIdRef.current += 1
        expectedNavigationRevision = openSessionRequestIdRef.current
        const nextDraft = normalizeAgentModelDraft(
          newSessionModelDraftRef.current,
          runtimeForSubmit,
          getRuntimeDefaultModelDraft(runtimeForSubmit),
        )
        syncNewSessionModelDraft(nextDraft)
        const draftModelKey = getAgentModelDraftKey(nextDraft)
        const nextState = await window.appApi.createAgentSession({
          agentId: requestAgentId,
          workspacePath: targetWorkspacePath,
        }, {
          agentId: requestAgentId,
          ...(draftModelKey && runtimeForSubmit.availableModels.includes(draftModelKey) ? { modelKey: draftModelKey } : {}),
          thinkingLevel: nextDraft.thinkingLevel,
        })
        nextSessionPath = nextState.activeSession?.sessionPath ?? null
        if (isSubmissionContextCurrent()) {
          activeRuntimeSessionRef.current = nextState.activeSession
          setAgentState(nextState)
          setViewedSessionSnapshot(null)
          if (nextSessionPath) {
            syncActiveSessionSelection({ agentId: requestAgentId, kind: 'session', sessionPath: nextSessionPath })
          }
          syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
        }
      } else {
        fallbackErrorMessage = 'Open a session before sending your prompt.'
        const activeState = await ensureSelectedAgentSessionActive(requestSelection)
        if (!activeState?.activeSession) {
          throw new Error('Open a session before sending your prompt.')
        }
        nextSessionPath = activeState.activeSession.sessionPath
      }

      fallbackErrorMessage = 'Unable to send your prompt.'
      if (!nextSessionPath) {
        throw new Error('Agent session did not return a native session identifier.')
      }
      const promptSessionPath = nextSessionPath
      const conversationId = createdConversation?.id
        ?? (activeWorkspaceContext.kind === 'conversation' ? activeWorkspaceContext.conversationId : null)
      const persistedSessionPath = createdConversation?.agentSessionPath ?? activeConversation?.agentSessionPath ?? null
      if (conversationId && persistedSessionPath !== promptSessionPath) {
        if (!onConversationSessionStarted) {
          throw new Error('Unable to persist the conversation Agent session binding.')
        }
        fallbackErrorMessage = 'Unable to update the conversation index.'
        const preview = formatConversationPreview(trimmedPrompt)
        await onConversationSessionStarted(conversationId, {
          agentSessionPath: promptSessionPath,
          lastMessagePreview: createdConversation ? preview : activeConversation?.lastMessagePreview ?? null,
          ...(createdConversation ? { title: preview, titleSource: 'prompt' } : {}),
        })
        didPersistConversationBinding = true
      }

      fallbackErrorMessage = 'Unable to send your prompt.'
      const promptAttachments = submittedComposerAttachments.map(({ id: _id, ...attachment }) => attachment)
      const isOpenCodePrompt = requestAgentId === 'opencode'
      const supportsClientMessageId = isOpenCodePrompt || requestAgentId === 'codex'
      const nextOptimisticUserMessageId = isOpenCodePrompt
        ? createOpenCodeMessageId()
        : `optimistic-user-${crypto.randomUUID()}`
      const nativePartIds = isOpenCodePrompt
        ? Array.from({ length: submittedComposerAttachments.length + 1 }, createOpenCodePartId)
        : undefined
      optimisticUserMessageId = nextOptimisticUserMessageId
      const optimisticAttachments: AgentMessageAttachment[] = submittedComposerAttachments.map(({ id: _id, ...attachment }) => ({
        ...attachment,
        status: attachment.kind === 'image' ? 'sent' : 'referenced',
      }))
      setOptimisticUserMessages((current) => [...current, {
        agentId: requestAgentId,
        message: {
          ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
          id: nextOptimisticUserMessageId,
          kind: 'user',
          text: trimmedPrompt,
          timestamp: Date.now(),
        },
        ...(nativePartIds ? { nativePartIds } : {}),
        sessionPath: promptSessionPath,
      }])
      await window.appApi.sendAgentPrompt({
        agentId: requestAgentId,
        sessionPath: promptSessionPath,
        workspacePath: targetWorkspacePath,
      }, trimmedPrompt, streamingBehavior, promptAttachments, supportsClientMessageId ? {
        clientMessageId: nextOptimisticUserMessageId,
        ...(nativePartIds ? { clientPartIds: nativePartIds } : {}),
      } : undefined)
      didSendPromptToAgent = true
      try {
        window.localStorage.setItem('aryn:last-new-conversation-agent', requestAgentId)
      } catch {
        // Persisting this preference is best effort. Conversation records remain authoritative.
      }
      invalidateOptimisticComposerClear(optimisticClearId)
      if (isSubmissionViewCurrent(promptSessionPath)) {
        syncActiveSessionSelection({ agentId: requestAgentId, kind: 'session', sessionPath: promptSessionPath })
      }
      if (conversationId && !createdConversation) {
        const preview = formatConversationPreview(trimmedPrompt)
        try {
          await onConversationSessionStarted?.(conversationId, {
            agentSessionPath: promptSessionPath,
            lastMessagePreview: preview,
          })
        } catch (error) {
          if (isSubmissionViewCurrent(promptSessionPath)) {
            setPanelError(error instanceof Error ? error.message : 'Unable to update the conversation index.')
          }
        }
      }
      if (!streamingBehavior && isSubmissionViewCurrent(promptSessionPath)) {
        setDraftAssistant('')
        setLiveTools([])
      }
    } catch (error) {
      if (createdConversation && !didSendPromptToAgent && !didPersistConversationBinding) {
        void onConversationDraftFailed?.(createdConversation.id)
      }
      if (!didSendPromptToAgent) {
        if (optimisticUserMessageId) {
          setOptimisticUserMessages((current) => current.filter((entry) => entry.message.id !== optimisticUserMessageId))
        }
        if (isSubmissionViewCurrent(nextSessionPath)) {
          restoreOptimisticallyClearedComposer(optimisticClearId, composerSnapshot)
        }
      }
      if (isSubmissionViewCurrent(nextSessionPath)) {
        setPanelError(error instanceof Error ? error.message : fallbackErrorMessage)
      }
    } finally {
      isSubmittingComposerPromptRef.current = false
      setIsSubmittingComposerPrompt(false)
    }
  }

  async function handleQueuedMessageUpdate(update: AgentQueuedMessageUpdate) {
    const sessionPath = agentState.activeSession?.sessionPath
    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    if (!sessionPath || !requestWorkspacePath) {
      setPanelError('Open a session before editing queued messages.')
      return
    }
    try {
      setActiveComposerMenu(null)
      setPanelError(null)
      const nextState = await window.appApi.updateAgentQueuedMessage({
        agentId: requestAgentId,
        sessionPath,
        workspacePath: requestWorkspacePath,
      }, update)
      if (
        !isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)
        || nextState.activeSession?.sessionPath !== sessionPath
      ) {
        return
      }
      setAgentState(nextState)
    } catch (error) {
      if (isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)) {
        setPanelError(error instanceof Error ? error.message : 'Unable to update queued message.')
      }
      throw error
    }
  }

  async function stopActivePrompt() {
    const sessionPath = agentState.activeSession?.sessionPath
    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    if (!requestWorkspacePath || !sessionPath || !isViewingActiveRuntime || !agentState.runtime.isStreaming) {
      return
    }

    try {
      setActiveComposerMenu(null)
      setPanelError(null)
      const nextState = await window.appApi.abortAgentPrompt({
        agentId: requestAgentId,
        sessionPath,
        workspacePath: requestWorkspacePath,
      })
      if (
        !isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)
        || nextState.activeSession?.sessionPath !== sessionPath
      ) {
        return
      }
      setAgentState(nextState)
      setDraftAssistant('')
      setDraftThinking('')
      setIsThinkingStreaming(false)
      setLiveTools([])
    } catch (error) {
      if (isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)) {
        setPanelError(error instanceof Error ? error.message : 'Unable to stop the current run.')
      }
    }
  }

  async function respondToInteraction(
    requestId: string,
    optionId: string,
    values?: string[],
    answers?: Record<string, string[]>,
  ) {
    try {
      setPanelError(null)
      const request = pendingInteractions.find((candidate) => (
        candidate.agentId === selectedAgentId
        && candidate.id === requestId
        && candidate.sessionId === agentState.activeSession?.sessionId
      ))
      if (!request) {
        throw new Error('这个请求已经失效，请等待 Agent 更新状态。')
      }
      const result = await window.appApi.respondAgentInteraction({
        agentId: request.agentId,
        answers,
        optionId,
        requestId,
        sessionId: request.sessionId,
        values,
      })
      if (!result.ok) {
        throw new Error('这个请求已经失效，请等待 Agent 更新状态。')
      }
      setPendingInteractions((currentRequests) => currentRequests.filter((candidate) => !(
        candidate.agentId === request.agentId
        && candidate.id === requestId
        && candidate.sessionId === request.sessionId
      )))
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to respond to Agent request.')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const hasPayload = getHasComposerPayload(composerStateRef.current, composerAttachmentsRef.current)

    if (isViewingActiveRuntime && agentState.runtime.isStreaming) {
      if (!hasPayload) {
        await stopActivePrompt()
        return
      }

      await submitComposerPrompt(effectiveRunningPromptEnterBehavior)
      return
    }

    await submitComposerPrompt()
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      if (!getHasComposerPayload(composerStateRef.current, composerAttachmentsRef.current)) {
        return
      }

      if (isViewingActiveRuntime && agentState.runtime.isStreaming) {
        const requestedStreamingBehavior = getStreamingPromptBehaviorForShortcut(
          event,
          window.appApi.platform,
          effectiveRunningPromptEnterBehavior,
        )
        const streamingBehavior = resolveSupportedRunningPromptBehavior(
          agentState.runtime.supportedRunningPromptBehaviors,
          requestedStreamingBehavior,
        )
        void submitComposerPrompt(streamingBehavior)
        return
      }

      void submitComposerPrompt()
    }
  }

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
  const hasComposerPayload = getHasComposerPayload(composerState, composerAttachments)
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
        hasVisibleRunningContent,
        isStreaming: visibleRuntime.isStreaming,
        isThinkingStreaming,
        panelError,
        pendingMessageCount: visibleRuntime.pendingMessageCount,
        retryAttempt: visibleRuntime.retryAttempt,
        runningTools: isViewingActiveRuntime ? runningTools : [],
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
    runningTools,
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
  const latestAutoOpenFileChange = useMemo(() => (
    findLatestOpenableAgentFileChange(visiblePersistedMessages, roundFileChangesByMessageId)
  ), [visiblePersistedMessages, roundFileChangesByMessageId])

  function clearMessagesUserScrollIntent() {
    messagesUserScrollIntentRef.current = false

    if (messagesUserScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(messagesUserScrollIntentTimeoutRef.current)
      messagesUserScrollIntentTimeoutRef.current = null
    }
  }

  function markMessagesUserScrollIntent(options: { transient: boolean }) {
    messagesUserScrollIntentRef.current = true

    if (messagesUserScrollIntentTimeoutRef.current !== null) {
      window.clearTimeout(messagesUserScrollIntentTimeoutRef.current)
      messagesUserScrollIntentTimeoutRef.current = null
    }

    if (!options.transient) {
      return
    }

    messagesUserScrollIntentTimeoutRef.current = window.setTimeout(() => {
      messagesUserScrollIntentRef.current = false
      messagesUserScrollIntentTimeoutRef.current = null
    }, AGENT_MESSAGES_TRANSIENT_SCROLL_INTENT_MS)
  }

  function updateMessagesScrollStickiness(scrollElement: HTMLElement, hasUserScrollIntent: boolean) {
    shouldStickMessagesToBottomRef.current = resolveAgentMessagesScrollStickiness(scrollElement, {
      currentShouldStick: shouldStickMessagesToBottomRef.current,
      hasUserScrollIntent,
    })
  }

  function cancelMessagesBottomRestore() {
    messagesBottomRestoreRef.current?.cancel()
    messagesBottomRestoreRef.current = null
  }

  function startMessagesBottomRestore(scrollElement: HTMLElement, scrollToBottom: () => void) {
    cancelMessagesBottomRestore()

    const scrollRootElement = scrollElement.closest('.agent-shell')
      ?? scrollElement.closest('.agent-messages-scroll')
      ?? scrollElement

    messagesBottomRestoreRef.current = startAgentMessagesBottomRestore({
      getScrollTop: () => scrollElement.scrollTop,
      scrollRootElement,
      scrollToBottom,
    })
  }

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
    const scrollElement = messagesScrollRef.current
    clearMessagesUserScrollIntent()

    if (!scrollElement) {
      shouldStickMessagesToBottomRef.current = true
      return
    }

    const scrollRootElement = scrollElement.closest('.agent-messages-scroll') ?? scrollElement
    let isScrollbarPointerIntentActive = false

    const stopScrollbarPointerIntent = () => {
      if (!isScrollbarPointerIntentActive) {
        return
      }

      isScrollbarPointerIntentActive = false
      clearMessagesUserScrollIntent()
      window.removeEventListener('pointerup', stopScrollbarPointerIntent)
      window.removeEventListener('pointercancel', stopScrollbarPointerIntent)
    }

    const userScrollIntentListenerOptions = { capture: true, passive: true }

    const handleUserScrollIntent = (event: Event) => {
      if (!isAgentMessagesScrollAreaEvent(event, scrollRootElement)) {
        return
      }

      markMessagesUserScrollIntent({ transient: true })
    }

    const handleKeyDown = (event: Event) => {
      if (!(event instanceof globalThis.KeyboardEvent)) {
        return
      }

      if (!isAgentMessagesScrollAreaEvent(event, scrollRootElement)) {
        return
      }

      if (event.altKey || event.ctrlKey || event.metaKey) {
        return
      }

      if (isAgentMessagesScrollIntentKey(event.key, event.code)) {
        markMessagesUserScrollIntent({ transient: true })
      }
    }

    const handlePointerDown = (event: Event) => {
      if (!(event instanceof PointerEvent)) {
        return
      }

      if (!isAgentMessagesScrollbarPointerEvent(event, scrollElement, scrollRootElement)) {
        return
      }

      if (isScrollbarPointerIntentActive) {
        stopScrollbarPointerIntent()
      }

      isScrollbarPointerIntentActive = true
      markMessagesUserScrollIntent({ transient: false })
      window.addEventListener('pointerup', stopScrollbarPointerIntent)
      window.addEventListener('pointercancel', stopScrollbarPointerIntent)
    }

    const handleScroll = () => {
      updateMessagesScrollStickiness(scrollElement, messagesUserScrollIntentRef.current)
    }

    handleScroll()
    scrollRootElement.addEventListener('wheel', handleUserScrollIntent, userScrollIntentListenerOptions)
    scrollRootElement.addEventListener('touchmove', handleUserScrollIntent, userScrollIntentListenerOptions)
    scrollRootElement.addEventListener('keydown', handleKeyDown)
    scrollElement.addEventListener('scroll', handleScroll, { passive: true })
    scrollRootElement.addEventListener('pointerdown', handlePointerDown, true)

    return () => {
      stopScrollbarPointerIntent()
      clearMessagesUserScrollIntent()
      scrollRootElement.removeEventListener('wheel', handleUserScrollIntent, userScrollIntentListenerOptions)
      scrollRootElement.removeEventListener('touchmove', handleUserScrollIntent, userScrollIntentListenerOptions)
      scrollRootElement.removeEventListener('keydown', handleKeyDown)
      scrollElement.removeEventListener('scroll', handleScroll)
      scrollRootElement.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [activeSessionPath])

  useEffect(() => () => {
    cancelMessagesBottomRestore()
    clearMessagesUserScrollIntent()
  }, [])

  useEffect(() => {
    const scrollElement = messagesScrollRef.current
    if (!scrollElement || typeof ResizeObserver === 'undefined') {
      return
    }

    let frameId: number | null = null
    const appShellElement = scrollElement.closest<HTMLElement>('.app-shell')
      ?? document.querySelector<HTMLElement>('.app-shell')
    const scrollToBottomIfSticky = () => {
      if (!shouldStickMessagesToBottomRef.current) {
        return
      }

      scrollAgentMessagesToBottom(scrollElement)
      shouldStickMessagesToBottomRef.current = true
    }

    const syncPinnedScrollAfterResize = () => {
      if (appShellElement?.getAttribute('data-resizing') === 'true') {
        return
      }

      updateMessagesScrollStickiness(scrollElement, false)

      if (!shouldStickMessagesToBottomRef.current) {
        return
      }

      scrollToBottomIfSticky()

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = null
        scrollToBottomIfSticky()
      })
    }

    const resizeObserver = new ResizeObserver(syncPinnedScrollAfterResize)
    resizeObserver.observe(scrollElement)
    window.addEventListener(SIDEBAR_RESIZE_END_EVENT, syncPinnedScrollAfterResize)

    const contentElement = getAgentMessagesScrollContentElement(scrollElement)
    if (contentElement) {
      resizeObserver.observe(contentElement)
    }

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener(SIDEBAR_RESIZE_END_EVENT, syncPinnedScrollAfterResize)

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId)
      }
    }
  }, [activeSessionPath])

  useLayoutEffect(() => {
    const scrollElement = messagesScrollRef.current
    const isSessionChanged = previousSessionPathRef.current !== activeSessionPath

    if (isSessionChanged) {
      cancelMessagesBottomRestore()
    }

    if (!scrollElement) {
      return
    }

    previousSessionPathRef.current = activeSessionPath

    const forceScrollToBottom = () => {
      scrollAgentMessagesToBottom(scrollElement)
      shouldStickMessagesToBottomRef.current = true
    }

    if (isSessionChanged) {
      clearMessagesUserScrollIntent()
      startMessagesBottomRestore(scrollElement, forceScrollToBottom)
      return
    }

    updateMessagesScrollStickiness(scrollElement, false)

    if (!shouldStickMessagesToBottomRef.current) {
      return
    }

    forceScrollToBottom()

    const frameId = window.requestAnimationFrame(() => {
      if (shouldStickMessagesToBottomRef.current) {
        forceScrollToBottom()
      }
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activeSessionPath, codexNativeRenderKey, draftAssistant, draftThinking, fileChangesKey, liveTools, openCodeNativeRenderKey, piWebNativeRenderKey, renderedMessageCount, sessionStatusKey])

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
    messagesScrollRef,
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

function AgentTreeActionMenuItems({
  disabled,
  ItemComponent = Menu.Item,
  onDelete,
  onRename,
}: {
  disabled: boolean
  ItemComponent?: AgentTreeMenuItemComponent
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-session-tree-menu-item${highlighted ? ' is-highlighted' : ''}`
        )}
        disabled={disabled}
        label='重命名'
        render={<button type='button' />}
        onClick={onRename}
      >
        <Edit2Line size={16} />
        <span>重命名</span>
      </ItemComponent>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-session-tree-menu-item is-danger${highlighted ? ' is-highlighted' : ''}`
        )}
        disabled={disabled}
        label='删除'
        render={<button type='button' />}
        onClick={onDelete}
      >
        <Delete2Line size={16} />
        <span>删除</span>
      </ItemComponent>
    </>
  )
}

function AgentTreeMenuPopup({
  disabled,
  menuPortalTarget,
  onDelete,
  onRename,
}: {
  disabled: boolean
  menuPortalTarget?: HTMLElement | null
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <Menu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Positioner
        align='end'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Popup
          className='agent-session-tree-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentTreeActionMenuItems disabled={disabled} onDelete={onDelete} onRename={onRename} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function AgentTreeContextMenuPopup({
  disabled,
  menuPortalTarget,
  onDelete,
  onRename,
}: {
  disabled: boolean
  menuPortalTarget?: HTMLElement | null
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <ContextMenu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <ContextMenu.Positioner
        align='start'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <ContextMenu.Popup
          className='agent-session-tree-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentTreeActionMenuItems
            disabled={disabled}
            ItemComponent={ContextMenu.Item}
            onDelete={onDelete}
            onRename={onRename}
          />
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  )
}

function AgentProjectMenuItems({
  ItemComponent = Menu.Item,
  onOpenFolder,
  onRemoveProject,
}: {
  ItemComponent?: AgentTreeMenuItemComponent
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  const systemFileManagerName = getSystemFileManagerName(window.appApi.platform)

  return (
    <>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-project-menu-item${highlighted ? ' is-highlighted' : ''}`
        )}
        label={`在${systemFileManagerName}中打开`}
        render={<button type='button' />}
        onClick={onOpenFolder}
      >
        <ExternalLinkLine size={16} />
        <span>在“{systemFileManagerName}”中打开</span>
      </ItemComponent>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-project-menu-item is-danger${highlighted ? ' is-highlighted' : ''}`
        )}
        label='移除'
        render={<button type='button' />}
        onClick={onRemoveProject}
      >
        <Delete2Line size={16} />
        <span>移除</span>
      </ItemComponent>
    </>
  )
}

function AgentProjectMenuPopup({
  menuPortalTarget,
  onOpenFolder,
  onRemoveProject,
}: {
  menuPortalTarget?: HTMLElement | null
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  return (
    <Menu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Positioner
        align='end'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Popup
          className='agent-project-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentProjectMenuItems onOpenFolder={onOpenFolder} onRemoveProject={onRemoveProject} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function AgentProjectContextMenuPopup({
  menuPortalTarget,
  onOpenFolder,
  onRemoveProject,
}: {
  menuPortalTarget?: HTMLElement | null
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  return (
    <ContextMenu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <ContextMenu.Positioner
        align='start'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <ContextMenu.Popup
          className='agent-project-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentProjectMenuItems
            ItemComponent={ContextMenu.Item}
            onOpenFolder={onOpenFolder}
            onRemoveProject={onRemoveProject}
          />
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  )
}

function AgentSessionTreeRow({
  activity,
  agentId,
  isActive,
  isDeleting,
  isRenaming,
  label,
  menuPortalTarget,
  menuTitle = '更多',
  itemClassName,
  relativeTime,
  rowClassName,
  onOpen,
  onCancelRename,
  onDelete,
  onRename,
  onRequestRename,
}: {
  activity?: 'running' | 'waiting'
  agentId?: AgentId
  isActive: boolean
  isDeleting: boolean
  isRenaming: boolean
  label: string
  menuPortalTarget?: HTMLElement | null
  menuTitle?: string
  itemClassName?: string
  relativeTime?: string
  rowClassName?: string
  onOpen: () => void
  onCancelRename: () => void
  onDelete: () => void
  onRename: (name: string) => Promise<void>
  onRequestRename: () => void
}) {
  const [draftName, setDraftName] = useState(label)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const isMenuOpen = isActionMenuOpen || isContextMenuOpen
  const accessibleLabel = agentId ? `${label}，${getAgentDefinition(agentId).label}` : label
  const activityLabel = activity === 'waiting' ? '等待操作' : '运行中'
  const sessionInfo = !isRenaming
    ? activity === 'running'
      ? <AgentInlineSpinner className='agent-session-running-spinner' />
      : relativeTime
    : undefined

  useEffect(() => {
    if (!isRenaming) {
      setDraftName(label)
      setError(null)
      return
    }

    setDraftName(label)
  }, [isRenaming, label])

  useEffect(() => {
    if (!isRenaming) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const input = renameInputRef.current
      if (!input) return

      input.focus()
      input.setSelectionRange(0, input.value.length)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isRenaming])

  const handleSubmitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    const nextName = draftName.trim()

    if (!nextName || nextName === label.trim()) {
      onCancelRename()
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await onRename(nextName)
      onCancelRename()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const rowMain = isRenaming ? (
    <TreeItemMain
      className='agent-session-rename-trigger'
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={renameInputRef}
        aria-label='Rename conversation'
        className='raw-rename-input'
        value={draftName}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void handleSubmitRename()
          }
          if (event.key === 'Escape') {
            onCancelRename()
          }
        }}
        onBlur={(event) => {
          if (isSubmitting) return

          const nextFocusedElement = event.relatedTarget
          if (nextFocusedElement instanceof Node && rowRef.current?.contains(nextFocusedElement)) {
            return
          }

          onCancelRename()
        }}
      />
    </TreeItemMain>
  ) : undefined
  const renderSessionMain: TreeItemMainRenderer | undefined = isRenaming
    ? undefined
    : (content, mainProps) => {
      const { className, hasDescription } = mainProps

      return (
        <ContextMenu.Root onOpenChange={setIsContextMenuOpen}>
          <ContextMenu.Trigger
            aria-label={accessibleLabel}
            render={<TreeItemMainButton className={className} hasDescription={hasDescription} role='button' />}
            title={accessibleLabel}
            onClick={onOpen}
          >
            {content}
          </ContextMenu.Trigger>
          <AgentTreeContextMenuPopup
            disabled={isDeleting}
            menuPortalTarget={menuPortalTarget}
            onDelete={onDelete}
            onRename={onRequestRename}
          />
        </ContextMenu.Root>
      )
    }
  const rowActions = isRenaming ? (
    <>
      <TreeItemActionButton
        aria-label='Confirm rename'
        title='确认重命名'
        disabled={isSubmitting}
        onClick={() => void handleSubmitRename()}
      >
        <CheckLine size={16} />
      </TreeItemActionButton>
      <TreeItemActionButton
        aria-label='Cancel rename'
        title='取消重命名'
        disabled={isSubmitting}
        onClick={onCancelRename}
      >
        <CloseLine size={16} />
      </TreeItemActionButton>
    </>
  ) : (
    <Menu.Root modal={false} onOpenChange={setIsActionMenuOpen}>
      <Menu.Trigger
        aria-label={`Open ${accessibleLabel} menu`}
        disabled={isDeleting}
        render={<TreeItemActionButton />}
        title={menuTitle}
      >
        <More1Line size={16} />
      </Menu.Trigger>
      <AgentTreeMenuPopup
        disabled={isDeleting}
        menuPortalTarget={menuPortalTarget}
        onDelete={onDelete}
        onRename={onRequestRename}
      />
    </Menu.Root>
  )

  return (
    <TreeItem
      itemClassName={`agent-project-session-node${itemClassName ? ` ${itemClassName}` : ''}`}
      ref={rowRef}
      rowClassName={`agent-project-session-row${rowClassName ? ` ${rowClassName}` : ''}`}
      isActive={isActive}
      isEditing={isRenaming}
      isMenuOpen={isMenuOpen}
      after={error ? <p className='tree-error agent-session-rename-error'>{error}</p> : null}
      icon={agentId ? (
        <TreeItemIcon>
          <AgentBrandIcon agentId={agentId} className='agent-brand-icon' size={16} tone='muted' />
        </TreeItemIcon>
      ) : undefined}
      main={rowMain}
      label={!isRenaming ? label : undefined}
      labelClassName={!isRenaming ? 'agent-project-session-label' : undefined}
      labelSuffix={!isRenaming && activity === 'waiting' ? (
        <span
          aria-label={activityLabel}
          className={`agent-session-activity is-${activity}`}
          role='status'
          title={activityLabel}
        />
      ) : undefined}
      renderMain={renderSessionMain}
      actions={rowActions}
      actionsAlwaysVisible={isRenaming}
      actionsClassName={isRenaming ? 'agent-session-rename-actions' : undefined}
      info={sessionInfo}
      infoProps={activity === 'running' ? {
        'aria-label': activityLabel,
        role: 'status',
        title: activityLabel,
      } : undefined}
      infoVariant={activity === 'running' ? 'status' : 'text'}
    />
  )

}

function FlatAgentSessionTree({
  className,
  onRequestClose,
  id = 'agent-session-tree',
  isFloating,
  menuPortalTarget,
}: AgentSessionTreeProps) {
  const {
    activeSessionPath,
    activeSessionSelection,
    agentState,
    deletingSessionPath,
    handleDeleteSession,
    handleOpenSession,
    handleRenameSession,
    handleStartNewSession,
    loadProjectSessions,
    projectSessions,
    projectState,
    selectedAgentId,
    sessionActivityById,
    sessionTreeAgentIds,
    workspacePath,
  } = useAgentContext()
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null)
  const currentProject = workspacePath
    ? projectState.projects.find((project) => (
        normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(workspacePath)
      )) ?? null
    : null
  const currentProjectBucket = currentProject ? projectSessions[currentProject.id] : undefined
  const sessions = currentProject
    ? flattenAgentProjectSessions(currentProjectBucket)
    : agentState.sessions.map((session): AgentSessionTreeItem => ({ ...session, agentId: selectedAgentId }))
  const loadSummary = summarizeAgentProjectSessionBucket(currentProjectBucket, sessionTreeAgentIds)
  const isSessionListLoading = Boolean(currentProject && (!loadSummary.hasLoaded || loadSummary.isLoading))

  useEffect(() => {
    if (currentProject) void loadProjectSessions(currentProject)
  }, [currentProject, loadProjectSessions])

  return (
    <div className={`agent-session-tree-shell${className ? ` ${className}` : ''}`}>
      {!isFloating ? (
        <button
          type='button'
          disabled={!workspacePath}
          className='agent-session-new-button'
          aria-label='Start new conversation'
          onClick={() => {
            handleStartNewSession()
            onRequestClose?.()
          }}
        >
          <EditLine size={16} />
          <span>新对话</span>
        </button>
      ) : null}

      <TreeScrollArea
        className='agent-session-tree-scroll'
        contentClassName='agent-session-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <TreeList id={id} className='agent-project-list agent-flat-session-list' aria-label='Agent sessions'>
          {isSessionListLoading ? <TreeStatusItem>加载中</TreeStatusItem> : null}
          {loadSummary.errors.length > 0 ? <TreeStatusItem tone='danger'>部分 Agent 无法加载</TreeStatusItem> : null}
          {!isSessionListLoading && sessions.length === 0 ? (
            <TreeStatusItem>暂无对话</TreeStatusItem>
          ) : sessions.map((session) => {
            const label = formatSessionLabel(session)
            const sessionKey = getAgentSessionTreeKey(session.agentId, session.path)
            const isActiveSession = activeSessionSelection.kind === 'session'
              && activeSessionSelection.agentId === session.agentId
              && activeSessionPath === session.path

            return (
              <AgentSessionTreeRow
                activity={sessionActivityById[getAgentSessionActivityKey(session.agentId, session.path)]}
                agentId={session.agentId}
                key={sessionKey}
                isActive={isActiveSession}
                isDeleting={deletingSessionPath === sessionKey}
                isRenaming={renamingSessionPath === sessionKey}
                label={label}
                menuPortalTarget={menuPortalTarget}
                onCancelRename={() => setRenamingSessionPath(null)}
                onDelete={() => {
                  if (workspacePath) void handleDeleteSession(workspacePath, session.agentId, session.path)
                }}
                onOpen={() => {
                  setRenamingSessionPath(null)
                  void handleOpenSession(session.agentId, session.path).then(() => {
                    onRequestClose?.()
                  })
                }}
                onRename={(name) => workspacePath
                  ? handleRenameSession(workspacePath, session.agentId, session.path, name)
                  : Promise.resolve()}
                onRequestRename={() => setRenamingSessionPath(sessionKey)}
              />
            )
          })}
        </TreeList>
      </TreeScrollArea>

    </div>
  )
}

function AgentConversationRow({
  activity,
  conversation,
  isDeleting,
  isRenaming,
  isActive,
  menuPortalTarget,
  onOpen,
  onCancelRename,
  onDelete,
  onRename,
  onRequestRename,
}: {
  activity?: 'running' | 'waiting'
  conversation: ConversationRecord
  isDeleting: boolean
  isRenaming: boolean
  isActive: boolean
  menuPortalTarget?: HTMLElement | null
  onOpen: () => void
  onCancelRename: () => void
  onDelete: () => void
  onRename: (name: string) => Promise<void>
  onRequestRename: () => void
}) {
  const relativeTime = formatAgentSessionRelativeTime(conversation.updatedAt)

  return (
    <AgentSessionTreeRow
      activity={activity}
      agentId={conversation.agentId}
      isActive={isActive}
      isDeleting={isDeleting}
      isRenaming={isRenaming}
      label={conversation.title}
      menuPortalTarget={menuPortalTarget}
      menuTitle='更多'
      itemClassName='agent-conversation-node'
      relativeTime={relativeTime}
      rowClassName='agent-conversation-row'
      onCancelRename={onCancelRename}
      onDelete={onDelete}
      onOpen={onOpen}
      onRename={onRename}
      onRequestRename={onRequestRename}
    />
  )
}

function AgentProjectTree({
  className,
  onRequestClose,
  onOpenProjectAddMenu: onOpenProjectAddMenuOverride,
  isFloating,
  isProjectAddMenuOpen: isProjectAddMenuOpenOverride,
  menuPortalTarget,
}: AgentSessionTreeProps) {
  const {
    activeWorkspaceContext,
    activeSessionPath,
    activeSessionSelection,
    conversationState,
    deletingSessionPath,
    handleDeleteSession,
    handleOpenSession,
    handleRenameSession,
    loadProjectSessions,
    onOpenProjectAddMenu,
    onOpenConversation,
    onRenameConversation,
    onRemoveConversation,
    onOpenProjectFolder,
    onOpenProjectSession,
    onRemoveProject,
    onStartStandaloneConversation,
    onStartProjectSession,
    projectSessions,
    projectState,
    sessionActivityById,
    sessionTreeAgentIds,
    isProjectAddMenuOpen: contextIsProjectAddMenuOpen,
    workspacePath,
  } = useAgentContext()
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set())
  const [isProjectSectionExpanded, setIsProjectSectionExpanded] = useState(true)
  const [isConversationSectionExpanded, setIsConversationSectionExpanded] = useState(true)
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null)
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null)
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
  const projectRecordsRef = useRef(projectState.projects)
  projectRecordsRef.current = projectState.projects
  const isProjectAddMenuOpen = isProjectAddMenuOpenOverride ?? contextIsProjectAddMenuOpen
  const activeSessionProjectId = useMemo(() => {
    if (activeSessionSelection.kind !== 'session' || !activeSessionPath) {
      return null
    }

    for (const [projectId, bucket] of Object.entries(projectSessions)) {
      if (flattenAgentProjectSessions(bucket).some((session) => (
        session.agentId === activeSessionSelection.agentId
        && session.path === activeSessionPath
      ))) {
        return projectId
      }
    }

    return null
  }, [activeSessionPath, activeSessionSelection, projectSessions])
  const visibleConversations = useMemo(() => (
    conversationState.conversations
      .filter((conversation) => conversation.status === 'active')
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  ), [conversationState.conversations])

  useEffect(() => {
    for (const projectId of expandedProjectIds) {
      const project = projectRecordsRef.current.find((candidate) => candidate.id === projectId)
      if (project) void loadProjectSessions(project)
    }
  }, [expandedProjectIds, loadProjectSessions])
  const activeProject = useMemo(() => {
    if (activeWorkspaceContext.kind === 'project') {
      return projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    }

    return workspacePath
      ? projectState.projects.find((project) => (
        normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(workspacePath)
      )) ?? null
      : null
  }, [activeWorkspaceContext, projectState.projects, workspacePath])

  function handleProjectMenuOpenChange(projectId: string, open: boolean) {
    setOpenProjectMenuId((currentProjectId) => {
      if (open) {
        return projectId
      }

      return currentProjectId === projectId ? null : currentProjectId
    })
  }

  function startPrimaryNewConversation() {
    setOpenProjectMenuId(null)
    setRenamingConversationId(null)

    if (activeProject && onStartProjectSession) {
      void onStartProjectSession(activeProject)
    } else {
      void onStartStandaloneConversation?.()
    }

    onRequestClose?.()
  }

  useEffect(() => {
    if (!activeSessionProjectId) {
      return
    }

    setIsProjectSectionExpanded(true)
    setExpandedProjectIds((currentExpandedProjectIds) => {
      if (currentExpandedProjectIds.has(activeSessionProjectId)) {
        return currentExpandedProjectIds
      }

      const nextExpandedProjectIds = new Set(currentExpandedProjectIds)
      nextExpandedProjectIds.add(activeSessionProjectId)
      return nextExpandedProjectIds
    })
  }, [activeSessionProjectId])

  useEffect(() => {
    if (activeWorkspaceContext.kind === 'conversation') {
      setIsConversationSectionExpanded(true)
    }
  }, [activeWorkspaceContext])

  function toggleProjectSection() {
    setOpenProjectMenuId(null)
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    setIsProjectSectionExpanded((currentValue) => !currentValue)
  }

  function toggleConversationSection() {
    setOpenProjectMenuId(null)
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    setIsConversationSectionExpanded((currentValue) => !currentValue)
  }

  function toggleProject(project: ProjectRecord) {
    setOpenProjectMenuId(null)
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    const shouldLoadSessions = !expandedProjectIds.has(project.id)

    setExpandedProjectIds((currentExpandedProjectIds) => {
      const nextExpandedProjectIds = new Set(currentExpandedProjectIds)
      if (nextExpandedProjectIds.has(project.id)) {
        nextExpandedProjectIds.delete(project.id)
      } else {
        nextExpandedProjectIds.add(project.id)
      }

      return nextExpandedProjectIds
    })

    if (shouldLoadSessions) {
      void loadProjectSessions(project)
    }
  }

  return (
    <div className={`agent-session-tree-shell agent-project-tree-shell${className ? ` ${className}` : ''}`}>
      {!isFloating ? (
        <AppTooltipButton
          type='button'
          className='agent-session-new-button'
          aria-label='Start new conversation'
          aria-keyshortcuts='Control+Alt+N'
          onClick={() => {
            startPrimaryNewConversation()
          }}
        >
          <EditLine size={16} />
          <span>新对话</span>
        </AppTooltipButton>
      ) : null}

      <TreeScrollArea
        className='agent-session-tree-scroll'
        contentClassName='agent-session-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <TreeList className='agent-session-section-stack' aria-label='项目与对话'>
          <TreeSection className={`agent-project-tree-section agent-project-section${isProjectSectionExpanded ? '' : ' is-collapsed'}${isFloating ? ' is-floating' : ''}`}>
            {!isFloating ? (
              <TreeItem
                variant='header'
                itemClassName='agent-project-tree-header'
                label='项目'
                isExpanded={isProjectSectionExpanded}
                isMenuOpen={isProjectAddMenuOpen}
                actions={(
                  <TreeItemActionButton
                    className={isProjectAddMenuOpen ? 'is-menu-open' : undefined}
                    aria-label='添加项目'
                    title='添加项目'
                    onClick={(event) => {
                      const openProjectAddMenu = onOpenProjectAddMenuOverride ?? onOpenProjectAddMenu
                      openProjectAddMenu?.(event.currentTarget.getBoundingClientRect())
                    }}
                  >
                    <AddLine size={16} />
                  </TreeItemActionButton>
                )}
                onToggle={toggleProjectSection}
              />
            ) : null}
            {isProjectSectionExpanded ? (
              <TreeList className='agent-project-list'>
                {projectState.projects.length === 0 ? (
                  <TreeStatusItem>暂无项目</TreeStatusItem>
                ) : projectState.projects.map((project) => {
            const bucket = projectSessions[project.id]
            const isExpanded = expandedProjectIds.has(project.id)
            const sessions = flattenAgentProjectSessions(bucket)
            const loadSummary = summarizeAgentProjectSessionBucket(bucket, sessionTreeAgentIds)
            const showChildren = isExpanded && (
              sessions.length > 0
              || loadSummary.isLoading
              || loadSummary.errors.length > 0
              || loadSummary.hasLoaded
            )

            const projectIcon = <ProjectIcon />
            const renderProjectMain: TreeItemMainRenderer = (content, mainProps) => {
              const { className, hasDescription } = mainProps

              return (
                <ContextMenu.Root onOpenChange={(open) => handleProjectMenuOpenChange(project.id, open)}>
                  <ContextMenu.Trigger
                    aria-expanded={isExpanded}
                    render={<TreeItemMainButton className={className} hasDescription={hasDescription} role='button' />}
                    title={project.path}
                    onClick={() => toggleProject(project)}
                  >
                    {content}
                  </ContextMenu.Trigger>
                  <AgentProjectContextMenuPopup
                    menuPortalTarget={menuPortalTarget}
                    onOpenFolder={() => {
                      void onOpenProjectFolder?.(project)
                    }}
                    onRemoveProject={() => {
                      void onRemoveProject?.(project)
                    }}
                  />
                </ContextMenu.Root>
              )
            }
            const projectRowActions = (
              <>
                <TreeItemActionButton
                  aria-label={`Start new conversation in ${project.name}`}
                  title='新建对话'
                  onClick={() => {
                    setRenamingConversationId(null)
                    void onStartProjectSession?.(project)
                    onRequestClose?.()
                  }}
                >
                  <EditLine size={16} />
                </TreeItemActionButton>
                <Menu.Root modal={false} onOpenChange={(open) => handleProjectMenuOpenChange(project.id, open)}>
                  <Menu.Trigger
                    aria-label={`Open ${project.name} menu`}
                    render={<TreeItemActionButton />}
                    title='更多'
                  >
                    <More1Line size={16} />
                  </Menu.Trigger>
                  <AgentProjectMenuPopup
                    menuPortalTarget={menuPortalTarget}
                    onOpenFolder={() => {
                      void onOpenProjectFolder?.(project)
                    }}
                    onRemoveProject={() => {
                      void onRemoveProject?.(project)
                    }}
                  />
                </Menu.Root>
              </>
            )

            return (
              <TreeItem
                key={project.id}
                itemClassName='agent-project-node'
                rowClassName='agent-project-row'
                isMenuOpen={openProjectMenuId === project.id}
                after={showChildren ? (
                  <TreeItemChildren className='agent-project-session-children'>
                    <TreeList className='agent-project-session-list'>
                      {loadSummary.isLoading ? <TreeStatusItem>加载中</TreeStatusItem> : null}
                      {loadSummary.errors.length > 0 ? <TreeStatusItem tone='danger'>部分 Agent 无法加载</TreeStatusItem> : null}
                      {!loadSummary.isLoading && loadSummary.errors.length === 0 && loadSummary.hasLoaded && sessions.length === 0 ? (
                        <TreeStatusItem>暂无对话</TreeStatusItem>
                      ) : null}
                      {sessions.map((session) => {
                        const sessionKey = getAgentSessionTreeKey(session.agentId, session.path)
                        const isActiveSession = activeSessionSelection.kind === 'session'
                          && activeSessionSelection.agentId === session.agentId
                          && activeSessionPath === session.path
                        const isCurrentActiveProject = Boolean(
                          activeWorkspaceContext.kind === 'project'
                          && activeWorkspaceContext.projectId === project.id
                          && workspacePath
                          && normalizeAgentProjectPath(workspacePath) === normalizeAgentProjectPath(project.path),
                        )
                        const label = formatSessionLabel(session)
                        const relativeTime = formatAgentSessionRelativeTime(session.modifiedAt)

                        return (
                          <AgentSessionTreeRow
                            activity={sessionActivityById[getAgentSessionActivityKey(session.agentId, session.path)]}
                            agentId={session.agentId}
                            key={sessionKey}
                            isActive={isActiveSession}
                            isDeleting={deletingSessionPath === sessionKey}
                            isRenaming={renamingSessionPath === sessionKey}
                            label={label}
                            menuPortalTarget={menuPortalTarget}
                            onCancelRename={() => setRenamingSessionPath(null)}
                            relativeTime={relativeTime}
                            onDelete={() => {
                              void handleDeleteSession(project.path, session.agentId, session.path)
                            }}
                            onOpen={() => {
                              setRenamingSessionPath(null)
                              setRenamingConversationId(null)
                              const openSession = isCurrentActiveProject
                                ? handleOpenSession(session.agentId, session.path)
                                : onOpenProjectSession?.(project, session.agentId, session.path)
                              void Promise.resolve(openSession).then(() => {
                                onRequestClose?.()
                              })
                            }}
                            onRename={(name) => handleRenameSession(project.path, session.agentId, session.path, name)}
                            onRequestRename={() => setRenamingSessionPath(sessionKey)}
                          />
                        )
                      })}
                    </TreeList>
                  </TreeItemChildren>
                ) : null}
                icon={projectIcon}
                label={project.name}
                labelClassName='agent-project-row-label'
                renderMain={renderProjectMain}
                actions={projectRowActions}
              />
            )
          })}
              </TreeList>
            ) : null}
          </TreeSection>
          <TreeSection className={`agent-project-tree-section agent-conversation-section${isConversationSectionExpanded ? '' : ' is-collapsed'}`}>
            <TreeItem
              variant='header'
              itemClassName='agent-project-tree-header agent-conversation-tree-header'
              label='对话'
              isExpanded={isConversationSectionExpanded}
              actions={(
                <TreeItemActionButton
                  aria-label='新对话'
                  aria-keyshortcuts='Control+Alt+N'
                  title='新对话 Ctrl+Alt+N'
                  onClick={() => {
                    setRenamingConversationId(null)
                    void onStartStandaloneConversation?.()
                    onRequestClose?.()
                  }}
                >
                  <EditLine size={16} />
                </TreeItemActionButton>
              )}
              onToggle={toggleConversationSection}
            />
            {isConversationSectionExpanded ? (
              <TreeList className='agent-project-session-list agent-conversation-list'>
                {visibleConversations.length === 0 ? (
                  <TreeStatusItem>暂无对话</TreeStatusItem>
                ) : visibleConversations.map((conversation) => (
                  <AgentConversationRow
                    activity={conversation.agentSessionPath
                      ? sessionActivityById[getAgentSessionActivityKey(conversation.agentId, conversation.agentSessionPath)]
                      : undefined}
                    key={conversation.id}
                    conversation={conversation}
                    isDeleting={deletingConversationId === conversation.id}
                    isRenaming={renamingConversationId === conversation.id}
                    isActive={activeWorkspaceContext.kind === 'conversation' && activeWorkspaceContext.conversationId === conversation.id}
                    menuPortalTarget={menuPortalTarget}
                    onCancelRename={() => setRenamingConversationId(null)}
                    onDelete={() => {
                      setDeletingConversationId(conversation.id)
                      void Promise.resolve(onRemoveConversation?.(conversation)).finally(() => {
                        setDeletingConversationId((currentId) => (
                          currentId === conversation.id ? null : currentId
                        ))
                      })
                    }}
                    onOpen={() => {
                      setRenamingSessionPath(null)
                      setRenamingConversationId(null)
                      void Promise.resolve(onOpenConversation?.(conversation)).then(() => {
                        onRequestClose?.()
                      })
                    }}
                    onRename={(title) => Promise.resolve(onRenameConversation?.(conversation, title))}
                    onRequestRename={() => setRenamingConversationId(conversation.id)}
                  />
                ))}
              </TreeList>
            ) : null}
          </TreeSection>
        </TreeList>
      </TreeScrollArea>

    </div>
  )
}

function AgentSessionTree(props: AgentSessionTreeProps) {
  return props.isFloating ? <FlatAgentSessionTree {...props} /> : <AgentProjectTree {...props} />
}

function AgentProjectSwitchTrigger({
  activeProject,
  className,
  onOpenProjectSwitchMenu,
  placeholder,
}: {
  activeProject: ProjectRecord | null
  className?: string
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  placeholder?: string
}) {
  const label = activeProject?.name ?? placeholder ?? '未选择项目'
  const isEnabled = Boolean(onOpenProjectSwitchMenu && (activeProject || placeholder))

  return (
    <AppTooltipButton
      type='button'
      className={[
        'agent-project-switch-trigger',
        className,
      ].filter(Boolean).join(' ')}
      disabled={!isEnabled}
      aria-label={activeProject ? `切换项目，当前项目：${activeProject.name}` : label}
      onClick={(event) => {
        onOpenProjectSwitchMenu?.(event.currentTarget.getBoundingClientRect(), { startNewSession: true })
      }}
    >
      <ProjectIcon />
      <span className='agent-project-switch-trigger-label'>{label}</span>
      <DownLine className='agent-project-switch-chevron' aria-hidden='true' size={14} />
    </AppTooltipButton>
  )
}

function resolveSupportedRunningPromptBehavior(
  supportedBehaviors: AgentRunningPromptBehavior[],
  requestedBehavior: AgentRunningPromptEnterBehavior,
): AgentRunningPromptEnterBehavior {
  return supportedBehaviors.includes(requestedBehavior)
    ? requestedBehavior
    : supportedBehaviors[0] ?? 'followUp'
}

function AgentTypeSwitchTrigger() {
  const {
    activeSessionSelection,
    activeWorkspaceContext,
    agentCatalog,
    refreshAgentCatalog,
    selectedAgentId,
    setSelectedAgentId,
  } = useAgentContext()
  const selectedAvailability = agentCatalog.find((item) => item.definition.id === selectedAgentId) ?? null
  const selectedDefinition = selectedAvailability?.definition ?? getAgentDefinition(selectedAgentId)
  const isLocked = activeWorkspaceContext.kind === 'conversation' || activeSessionSelection.kind === 'session'

  return (
    <Menu.Root
      modal={false}
      onOpenChange={(open) => {
        if (open) void refreshAgentCatalog()
      }}
    >
      <Menu.Trigger
        aria-label={`选择 Agent，当前：${selectedDefinition.label}`}
        className='agent-type-switch-trigger'
        disabled={isLocked}
        render={<button type='button' />}
      >
        <AgentBrandIcon agentId={selectedAgentId} className='agent-brand-icon' size={16} />
        <span className='agent-type-switch-label'>{selectedDefinition.label}</span>
        <DownLine aria-hidden='true' className='agent-type-switch-chevron' size={14} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align='start' sideOffset={6}>
          <Menu.Popup className='agent-type-switch-menu' aria-label='选择用于新会话的 Agent'>
            {(agentCatalog.length > 0
              ? agentCatalog
              : [{
                  available: true,
                  command: null,
                  definition: getAgentDefinition(DEFAULT_AGENT_ID),
                  reason: null,
                  version: null,
                }]
            ).map((availability) => {
              const isSelected = availability.definition.id === selectedAgentId
              const optionDescription = availability.available ? null : '需检查配置'

              return (
                <Menu.Item
                  key={availability.definition.id}
                  nativeButton
                  className={({ highlighted }) => (
                    `agent-type-switch-option${highlighted ? ' is-highlighted' : ''}${isSelected ? ' is-selected' : ''}`
                  )}
                  disabled={!availability.available}
                  label={availability.definition.label}
                  render={<button
                    type='button'
                    title={!availability.available ? availability.reason ?? '当前不可用' : undefined}
                  />}
                  onClick={() => {
                    setSelectedAgentId(availability.definition.id)
                  }}
                >
                  <span className='agent-type-switch-option-icon'>
                    <AgentBrandIcon
                      agentId={availability.definition.id}
                      className='agent-brand-icon'
                      size={16}
                    />
                  </span>
                  <span className='agent-type-switch-option-copy'>
                    <span className='agent-type-switch-option-title'>
                      {availability.definition.label}
                    </span>
                    {optionDescription ? (
                      <span className='agent-type-switch-option-description'>
                        {optionDescription}
                      </span>
                    ) : null}
                  </span>
                  {isSelected ? <CheckLine aria-hidden='true' size={16} /> : null}
                </Menu.Item>
              )
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

function AgentNewConversationPrompt() {
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
            <AgentTypeSwitchTrigger />
            <span>处理什么？</span>
          </>
        ) : (
          <>
            <span>今天使用</span>
            <AgentTypeSwitchTrigger />
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
    messagesScrollRef,
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
  const [messagesScrollElement, setMessagesScrollElement] = useState<HTMLDivElement | null>(null)
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
    : activeConversationTitle || formatSessionLabel(activeSession)
  const handleOpenWorkspaceFileFromMessage = useCallback((filePath: string) => {
    void onOpenMessageFile?.(filePath, 'updated')
  }, [onOpenMessageFile])
  const handleMessagesScrollViewportRef = useCallback((element: HTMLDivElement | null) => {
    messagesScrollRef.current = element
    setMessagesScrollElement((currentElement) => (
      currentElement === element ? currentElement : element
    ))
  }, [messagesScrollRef])
  const virtualMessageItems = useMemo<AgentVirtualMessageListItem[]>(() => {
    const messageItems = renderedMessages.map((message) => ({
      fileChanges: roundFileChangesByMessageId.get(message.id) ?? [],
      key: `message:${message.id}`,
      kind: 'message' as const,
      message,
    }))

    if (!sessionStatus) {
      return messageItems
    }

    return [
      ...messageItems,
      {
        key: `status:${sessionStatus.label}:${sessionStatus.badges?.map((badge) => `${badge.kind}:${badge.label}`).join('|') ?? ''}`,
        kind: 'status' as const,
        status: sessionStatus,
      },
    ]
  }, [renderedMessages, roundFileChangesByMessageId, sessionStatus])
  const shouldVirtualizeMessages = virtualMessageItems.length >= AGENT_MESSAGE_VIRTUALIZATION_MIN_ITEMS
  const isViewingActiveRuntime = Boolean(
    activeSessionPath
    && agentState.activeSession?.sessionPath === activeSessionPath,
  )
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelPickerProvider, setModelPickerProvider] = useState(resolvedSelectedProviderValue)
  const [modelPickerActiveModelKey, setModelPickerActiveModelKey] = useState<string | null>(null)
  const [modelPickerActiveThinkingLevel, setModelPickerActiveThinkingLevel] = useState<AgentThinkingLevel | null>(null)
  const [modelPickerKeyboardColumn, setModelPickerKeyboardColumn] = useState<AgentModelPickerKeyboardColumn>('model')
  const [localOverlayRoot, setLocalOverlayRoot] = useState<HTMLDivElement | null>(null)
  const modelPickerSearchRef = useRef<HTMLInputElement | null>(null)
  const modelPickerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const localOverlayRootRef = useRef<HTMLDivElement | null>(null)
  const handleLocalOverlayRootRef = useCallback((node: HTMLDivElement | null) => {
    localOverlayRootRef.current = node
    setLocalOverlayRoot(node)
  }, [])
  const modelPickerPointerTrailRef = useRef<AgentModelPickerPointerPoint[]>([])
  const modelPickerLatestPointerPointRef = useRef<AgentModelPickerPointerPoint | null>(null)
  const modelPickerPendingActivationRef = useRef<AgentModelPickerPendingActivation | null>(null)
  const modelPickerActivationVersionRef = useRef(0)
  const [modelCascaderStyle, setModelCascaderStyle] = useState<AgentModelCascaderStyle>({})
  const queuedComposerMessages = useMemo(
    () => isViewingActiveRuntime ? buildQueuedComposerMessages(agentState.runtime) : [],
    [agentState.runtime, isViewingActiveRuntime],
  )
  const trimmedModelValue = modelInputValue.trim()
  const composerModelKey = trimmedModelValue
    ? getAgentModelKey(resolvedSelectedProviderValue, trimmedModelValue)
    : null
  const modelPickerOptions = useMemo<AgentModelPickerOption[]>(() => (
    agentState.runtime.availableModels
      .map((modelKey) => {
        const selection = parseModelSelection(modelKey)

        if (!selection.provider || !selection.modelId) {
          return null
        }

        return {
          key: modelKey,
          modelId: selection.modelId,
          provider: selection.provider,
          thinkingLevels: agentState.runtime.availableThinkingLevelsByModel[modelKey]
            ?? agentState.runtime.availableThinkingLevels,
        }
      })
      .filter((option): option is AgentModelPickerOption => Boolean(option))
  ), [
    agentState.runtime.availableModels,
    agentState.runtime.availableThinkingLevels,
    agentState.runtime.availableThinkingLevelsByModel,
  ])
  const modelPickerOptionByKey = useMemo(() => new Map(
    modelPickerOptions.map((option) => [option.key, option]),
  ), [modelPickerOptions])
  const resolvedModelPickerProvider = configuredProviders.includes(modelPickerProvider)
    ? modelPickerProvider
    : resolvedSelectedProviderValue
  const modelPickerProviderOptions = configuredProviders
  const modelPickerProviderModels = useMemo(() => (
    modelPickerOptions.filter((option) => option.provider === resolvedModelPickerProvider)
  ), [modelPickerOptions, resolvedModelPickerProvider])
  const normalizedModelPickerQuery = modelPickerQuery.trim().toLowerCase()
  const isModelPickerSearching = normalizedModelPickerQuery.length > 0
  const modelPickerSearchResults = useMemo(() => (
    isModelPickerSearching
      ? rankAgentModelSearchOptions(modelPickerOptions, normalizedModelPickerQuery, resolvedSelectedProviderValue)
      : []
  ), [isModelPickerSearching, modelPickerOptions, normalizedModelPickerQuery, resolvedSelectedProviderValue])
  const activeModelCandidate = modelPickerActiveModelKey
    ? modelPickerOptionByKey.get(modelPickerActiveModelKey) ?? null
    : null
  const selectedModelOption = composerModelKey
    ? modelPickerOptionByKey.get(composerModelKey) ?? null
    : null
  const fallbackModelOption = modelPickerProviderModels[0] ?? modelPickerOptions[0] ?? null
  const activeModelOption = isModelPickerSearching
    ? (
        activeModelCandidate && modelPickerSearchResults.some((option) => option.key === activeModelCandidate.key)
          ? activeModelCandidate
          : modelPickerSearchResults[0] ?? null
      )
    : (
        activeModelCandidate?.provider === resolvedModelPickerProvider
          ? activeModelCandidate
          : selectedModelOption?.provider === resolvedModelPickerProvider
            ? selectedModelOption
            : fallbackModelOption
      )
  const activeModelThinkingLevels = activeModelOption?.thinkingLevels ?? []
  const activeModelThinkingLevel = clampAgentThinkingLevel(
    thinkingLevel,
    activeModelThinkingLevels,
  )
  const activeModelPickerThinkingLevel = modelPickerActiveThinkingLevel
    && activeModelThinkingLevels.includes(modelPickerActiveThinkingLevel)
    ? modelPickerActiveThinkingLevel
    : activeModelThinkingLevel
  const selectedModelThinkingLevels = selectedModelOption?.thinkingLevels
    ?? (
      composerModelKey
        ? agentState.runtime.availableThinkingLevelsByModel[composerModelKey] ?? agentState.runtime.availableThinkingLevels
        : []
    )
  const showModelPickerThinkingColumn = hasConfigurableAgentThinkingLevel(activeModelThinkingLevels)
  const modelCascaderLayoutMetrics = useMemo<AgentModelCascaderLayoutMetrics>(() => {
    const providerColumnWidth = clampNumber(
      modelPickerProviderOptions.reduce((maxWidth, provider) => Math.max(
        maxWidth,
        estimateAgentCascaderTextWidth(provider, 8, 44),
      ), AGENT_MODEL_CASCADER_PROVIDER_MIN_WIDTH_PX),
      AGENT_MODEL_CASCADER_PROVIDER_MIN_WIDTH_PX,
      AGENT_MODEL_CASCADER_PROVIDER_MAX_WIDTH_PX,
    )
    const listedModelOptions = isModelPickerSearching
      ? modelPickerSearchResults
      : modelPickerProviderModels
    const fallbackModelOptions = listedModelOptions.length > 0 ? listedModelOptions : modelPickerProviderModels
    const hasAnyListedThinkingColumn = listedModelOptions.some((option) => (
      hasConfigurableAgentThinkingLevel(option.thinkingLevels)
    ))
    const modelColumnWidth = clampNumber(
      fallbackModelOptions.reduce((maxWidth, option) => {
        const estimatedWidth = isModelPickerSearching
          ? measureAgentCascaderTextWidth(`${option.modelId} ${option.provider}`, 8, 42)
          : measureAgentCascaderTextWidth(option.modelId, 8.2, 34)

        return Math.max(maxWidth, estimatedWidth)
      }, AGENT_MODEL_CASCADER_MODEL_MIN_WIDTH_PX),
      AGENT_MODEL_CASCADER_MODEL_MIN_WIDTH_PX,
      AGENT_MODEL_CASCADER_MODEL_MAX_WIDTH_PX,
    )
    const thinkingColumnWidth = showModelPickerThinkingColumn ? AGENT_MODEL_CASCADER_THINKING_WIDTH_PX : 0
    const rawPanelWidth = isModelPickerSearching
      ? modelColumnWidth + thinkingColumnWidth
      : providerColumnWidth + modelColumnWidth + thinkingColumnWidth

    return {
      panelWidth: clampNumber(
        rawPanelWidth,
        AGENT_MODEL_CASCADER_MIN_WIDTH_PX,
        AGENT_MODEL_CASCADER_MAX_WIDTH_PX,
      ),
      positioningWidth: clampNumber(
        rawPanelWidth + (hasAnyListedThinkingColumn ? AGENT_MODEL_CASCADER_THINKING_WIDTH_PX - thinkingColumnWidth : 0),
        AGENT_MODEL_CASCADER_MIN_WIDTH_PX,
        AGENT_MODEL_CASCADER_MAX_WIDTH_PX,
      ),
      providerColumnWidth,
      thinkingColumnWidth: AGENT_MODEL_CASCADER_THINKING_WIDTH_PX,
    }
  }, [
    isModelPickerSearching,
    modelPickerProviderModels,
    modelPickerProviderOptions,
    modelPickerSearchResults,
    showModelPickerThinkingColumn,
  ])
  const showTriggerThinkingLevel = thinkingLevel !== 'off'
    && hasConfigurableAgentThinkingLevel(selectedModelThinkingLevels)
  const modelPickerTriggerLabel = trimmedModelValue || 'model'
  const modelPickerTriggerTitle = composerModelKey
    ? showTriggerThinkingLevel
      ? `${composerModelKey}, thinking ${thinkingLevelLabel}`
      : composerModelKey
    : 'Model'
  const modelPickerListedModels = isModelPickerSearching
    ? modelPickerSearchResults
    : modelPickerProviderModels
  const sessionMenuPortalTarget = typeof document === 'undefined'
    ? null
    : surfaceMode === 'drawer'
      ? localOverlayRoot
      : document.body

  const updateModelCascaderPosition = useCallback(() => {
    const triggerElement = modelPickerTriggerRef.current
    if (!triggerElement) {
      return
    }

    const nextStyle = resolveAgentModelCascaderStyle(
      triggerElement.getBoundingClientRect(),
      modelCascaderLayoutMetrics,
    )
    setModelCascaderStyle((currentStyle) => (
      areAgentModelCascaderStylesEqual(currentStyle, nextStyle) ? currentStyle : nextStyle
    ))
  }, [
    modelCascaderLayoutMetrics.panelWidth,
    modelCascaderLayoutMetrics.positioningWidth,
    modelCascaderLayoutMetrics.providerColumnWidth,
    modelCascaderLayoutMetrics.thinkingColumnWidth,
  ])

  function scrollModelCascaderActiveItemsOnNextFrame() {
    window.requestAnimationFrame(scrollAgentModelCascaderActiveItemsIntoView)
  }

  function clearModelPickerPendingActivation() {
    const pendingActivation = modelPickerPendingActivationRef.current
    if (!pendingActivation) {
      return
    }

    window.clearTimeout(pendingActivation.timeoutId)
    modelPickerPendingActivationRef.current = null
  }

  function clearModelPickerPointerIntent() {
    clearModelPickerPendingActivation()
    modelPickerPointerTrailRef.current = []
    modelPickerLatestPointerPointRef.current = null
  }

  function flushModelPickerPendingActivation(target?: AgentModelPickerSafeTriangleTarget) {
    const pendingActivation = modelPickerPendingActivationRef.current
    if (!pendingActivation || target && pendingActivation.target !== target) {
      return
    }

    window.clearTimeout(pendingActivation.timeoutId)
    modelPickerPendingActivationRef.current = null
    pendingActivation.run()
  }

  function invalidateModelPickerPointerIntent() {
    modelPickerActivationVersionRef.current += 1
    clearModelPickerPointerIntent()
  }

  function createModelPickerPointerPoint(event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) {
    return {
      time: window.performance.now(),
      x: event.clientX,
      y: event.clientY,
    }
  }

  function seedModelPickerPointerTrailFromTrigger(event: ReactMouseEvent<HTMLElement>) {
    const triggerRect = modelPickerTriggerRef.current?.getBoundingClientRect()
    const point = createModelPickerPointerPoint(event)

    modelPickerPointerTrailRef.current = [{
      ...point,
      x: triggerRect ? Math.min(point.x, triggerRect.left + 8) : point.x,
    }]
  }

  function recordModelPickerPointerPoint(event: ReactPointerEvent<HTMLElement>) {
    const nextPoint = createModelPickerPointerPoint(event)
    modelPickerLatestPointerPointRef.current = nextPoint
    const currentTrail = modelPickerPointerTrailRef.current
    const lastPoint = currentTrail[currentTrail.length - 1]

    if (
      lastPoint
      && Math.abs(lastPoint.x - nextPoint.x) < 0.5
      && Math.abs(lastPoint.y - nextPoint.y) < 0.5
    ) {
      return lastPoint
    }

    modelPickerPointerTrailRef.current = [
      ...currentTrail.filter((point) => nextPoint.time - point.time <= AGENT_MODEL_CASCADER_POINTER_TRAIL_MS),
      nextPoint,
    ].slice(-8)

    return nextPoint
  }

  function getModelPickerPointerTriangleOrigin(
    currentPoint: AgentModelPickerPointerPoint,
    sourceColumnRect: DOMRect,
  ) {
    const trail = modelPickerPointerTrailRef.current
    return trail.find((point) => (
      point.time < currentPoint.time
      && (Math.abs(point.x - currentPoint.x) >= 0.5 || Math.abs(point.y - currentPoint.y) >= 0.5)
      && isAgentModelCascaderPointInsideRect(
        point,
        sourceColumnRect,
        AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX,
      )
    )) ?? null
  }

  function activateModelPickerModelPreview(
    modelKey: string,
  ) {
    clearModelPickerPendingActivation()
    setModelPickerActiveModelKey(modelKey)
    setModelPickerActiveThinkingLevel(null)
  }

  function isPointerInsideModelPickerColumnSafeTriangle(
    currentPoint: AgentModelPickerPointerPoint,
    sourceSelector: string,
    targetSelector: string,
  ) {
    const sourceColumnElement = document.querySelector<HTMLElement>(sourceSelector)
    const targetColumnElement = document.querySelector<HTMLElement>(targetSelector)

    if (!sourceColumnElement || !targetColumnElement) {
      return false
    }

    const sourceColumnRect = sourceColumnElement.getBoundingClientRect()
    const targetColumnRect = targetColumnElement.getBoundingClientRect()
    const originPoint = getModelPickerPointerTriangleOrigin(currentPoint, sourceColumnRect)

    if (!originPoint || originPoint.x >= targetColumnRect.left || currentPoint.x <= originPoint.x + 1) {
      return false
    }

    if (currentPoint.x >= targetColumnRect.left - 1) {
      return true
    }

    return isPointInsideAgentModelCascaderTriangle(
      currentPoint,
      originPoint,
      {
        x: targetColumnRect.left,
        y: targetColumnRect.top - AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX,
      },
      {
        x: targetColumnRect.left,
        y: targetColumnRect.bottom + AGENT_MODEL_CASCADER_SAFE_TRIANGLE_PADDING_PX,
      },
    )
  }

  // Preserve the active provider while the pointer crosses sibling rows toward the Model submenu.
  function isPointerInsideModelPickerModelSafeTriangle(currentPoint: AgentModelPickerPointerPoint) {
    if (isModelPickerSearching || modelPickerProviderOptions.length <= 1) {
      return false
    }

    return isPointerInsideModelPickerColumnSafeTriangle(
      currentPoint,
      AGENT_MODEL_CASCADER_PROVIDER_COLUMN_SELECTOR,
      AGENT_MODEL_CASCADER_MODEL_COLUMN_SELECTOR,
    )
  }

  // Preserve the active model while the pointer crosses sibling rows toward the Thinking submenu.
  function isPointerInsideModelPickerThinkingSafeTriangle(currentPoint: AgentModelPickerPointerPoint) {
    if (!showModelPickerThinkingColumn || !activeModelOption) {
      return false
    }

    const sourceSelector = isModelPickerSearching
      ? AGENT_MODEL_CASCADER_RESULTS_COLUMN_SELECTOR
      : AGENT_MODEL_CASCADER_MODEL_COLUMN_SELECTOR

    return isPointerInsideModelPickerColumnSafeTriangle(
      currentPoint,
      sourceSelector,
      AGENT_MODEL_CASCADER_THINKING_COLUMN_SELECTOR,
    )
  }

  function isPointerInsideModelPickerSafeTriangle(
    currentPoint: AgentModelPickerPointerPoint,
    target: AgentModelPickerSafeTriangleTarget,
  ) {
    return target === 'model'
      ? isPointerInsideModelPickerModelSafeTriangle(currentPoint)
      : isPointerInsideModelPickerThinkingSafeTriangle(currentPoint)
  }

  function scheduleModelPickerDelayedActivation(run: () => void, target: AgentModelPickerSafeTriangleTarget) {
    clearModelPickerPendingActivation()

    const version = modelPickerActivationVersionRef.current
    const timeoutId = window.setTimeout(() => {
      const latestPoint = modelPickerLatestPointerPointRef.current
      if (
        modelPickerPendingActivationRef.current?.timeoutId !== timeoutId
        || modelPickerPendingActivationRef.current.version !== version
        || modelPickerActivationVersionRef.current !== version
      ) {
        return
      }

      if (!shouldRunAgentModelCascaderDelayedActivation(
        latestPoint,
        target,
        isPointerInsideModelPickerSafeTriangle,
      )) {
        return
      }

      modelPickerPendingActivationRef.current = null
      run()
    }, AGENT_MODEL_CASCADER_SAFE_TRIANGLE_DELAY_MS)

    modelPickerPendingActivationRef.current = {
      run,
      target,
      timeoutId,
      version,
    }
  }

  function flushModelPickerPendingActivationIfOutsideSafeTriangle(currentPoint: AgentModelPickerPointerPoint) {
    const pendingActivation = modelPickerPendingActivationRef.current
    if (!pendingActivation || isPointerInsideModelPickerSafeTriangle(currentPoint, pendingActivation.target)) {
      return
    }

    flushModelPickerPendingActivation()
  }

  function handleModelPickerPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const currentPoint = recordModelPickerPointerPoint(event)
    flushModelPickerPendingActivationIfOutsideSafeTriangle(currentPoint)
  }

  function runOrDelayModelPickerPointerActivation(
    event: ReactPointerEvent<HTMLElement>,
    target: AgentModelPickerSafeTriangleTarget,
    run: () => void,
  ) {
    const currentPoint = recordModelPickerPointerPoint(event)

    if (isPointerInsideModelPickerSafeTriangle(currentPoint, target)) {
      scheduleModelPickerDelayedActivation(run, target)
      return
    }

    clearModelPickerPendingActivation()
    run()
  }

  function handleModelPickerModelPointerPreview(modelKey: string, event: ReactPointerEvent<HTMLElement>) {
    if (modelKey === activeModelOption?.key) {
      recordModelPickerPointerPoint(event)
      clearModelPickerPendingActivation()
      return
    }

    runOrDelayModelPickerPointerActivation(event, 'thinking', () => {
      activateModelPickerModelPreview(modelKey)
    })
  }

  function handleModelPickerProviderPointerFocus(provider: string, event: ReactPointerEvent<HTMLElement>) {
    runOrDelayModelPickerPointerActivation(event, 'model', () => {
      setModelPickerKeyboardColumn('provider')
      handleModelPickerProviderFocus(provider)
    })
  }

  function openModelCascader(event?: ReactMouseEvent<HTMLButtonElement>) {
    if (!hasConfiguredProviders || (!workspacePath && !canUseDraftRuntimeWithoutWorkspace) || isSwitchingModel || isSwitchingThinkingLevel) {
      return
    }

    invalidateModelPickerPointerIntent()

    if (activeComposerMenu === 'model-cascader') {
      setActiveComposerMenu(null)
      return
    }

    const initialModelKey = selectedModelOption?.key ?? fallbackModelOption?.key ?? null
    setPanelError(null)
    setModelPickerQuery('')
    setModelPickerProvider(resolvedSelectedProviderValue)
    setModelPickerActiveModelKey(initialModelKey)
    setModelPickerActiveThinkingLevel(null)
    setModelPickerKeyboardColumn('model')
    if (event && initialModelKey) {
      seedModelPickerPointerTrailFromTrigger(event)
    } else {
      modelPickerPointerTrailRef.current = []
    }

    updateModelCascaderPosition()
    setActiveComposerMenu('model-cascader')
  }

  function handleModelPickerProviderFocus(provider: string) {
    clearModelPickerPointerIntent()
    setModelPickerProvider(provider)
    setModelPickerActiveModelKey(
      modelPickerOptions.find((option) => option.provider === provider)?.key ?? null,
    )
    setModelPickerActiveThinkingLevel(null)
  }

  function handleModelPickerQueryChange(value: string) {
    clearModelPickerPointerIntent()
    setModelPickerQuery(value)
    setModelPickerKeyboardColumn('model')
    setModelPickerActiveThinkingLevel(null)

    const nextQuery = value.trim().toLowerCase()
    if (!nextQuery) {
      setModelPickerActiveModelKey(selectedModelOption?.key ?? fallbackModelOption?.key ?? null)
      return
    }

    setModelPickerActiveModelKey(
      rankAgentModelSearchOptions(modelPickerOptions, nextQuery, resolvedSelectedProviderValue)[0]?.key ?? null,
    )
  }

  function handleModelPickerKeyboardMove(offset: number) {
    if (modelPickerKeyboardColumn === 'provider' && !isModelPickerSearching) {
      const currentIndex = modelPickerProviderOptions.indexOf(resolvedModelPickerProvider)
      const nextProvider = modelPickerProviderOptions[getLoopedIndex(modelPickerProviderOptions.length, currentIndex, offset)]

      if (nextProvider) {
        handleModelPickerProviderFocus(nextProvider)
        scrollModelCascaderActiveItemsOnNextFrame()
      }

      return
    }

    if (modelPickerKeyboardColumn === 'thinking' && showModelPickerThinkingColumn) {
      const currentIndex = activeModelThinkingLevels.indexOf(activeModelPickerThinkingLevel)
      const nextThinkingLevel = activeModelThinkingLevels[getLoopedIndex(activeModelThinkingLevels.length, currentIndex, offset)]

      if (nextThinkingLevel) {
        setModelPickerActiveThinkingLevel(nextThinkingLevel)
        scrollModelCascaderActiveItemsOnNextFrame()
      }

      return
    }

    const currentIndex = modelPickerListedModels.findIndex((option) => option.key === activeModelOption?.key)
    const nextModel = modelPickerListedModels[getLoopedIndex(modelPickerListedModels.length, currentIndex, offset)]

    if (nextModel) {
      activateModelPickerModelPreview(nextModel.key)
      scrollModelCascaderActiveItemsOnNextFrame()
    }
  }

  function handleModelPickerKeyboardLeft() {
    if (modelPickerKeyboardColumn === 'thinking') {
      setModelPickerKeyboardColumn('model')
      scrollModelCascaderActiveItemsOnNextFrame()
      return
    }

    if (modelPickerKeyboardColumn === 'model' && !isModelPickerSearching) {
      setModelPickerKeyboardColumn('provider')
      scrollModelCascaderActiveItemsOnNextFrame()
    }
  }

  function handleModelPickerKeyboardRight() {
    if (modelPickerKeyboardColumn === 'provider') {
      setModelPickerKeyboardColumn('model')
      scrollModelCascaderActiveItemsOnNextFrame()
      return
    }

    if (modelPickerKeyboardColumn === 'model' && showModelPickerThinkingColumn) {
      setModelPickerKeyboardColumn('thinking')
      setModelPickerActiveThinkingLevel(activeModelThinkingLevel)
      scrollModelCascaderActiveItemsOnNextFrame()
    }
  }

  function handleModelPickerKeyboardEnter() {
    if (modelPickerKeyboardColumn === 'provider') {
      setModelPickerKeyboardColumn('model')
      scrollModelCascaderActiveItemsOnNextFrame()
      return
    }

    if (modelPickerKeyboardColumn === 'thinking' && showModelPickerThinkingColumn && activeModelOption) {
      void handleModelPickerThinkingSelect(activeModelPickerThinkingLevel, activeModelOption.key)
      return
    }

    if (activeModelOption) {
      void handleModelPickerModelSelect(activeModelOption)
    }
  }

  function handleModelPickerSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (isAgentKeyboardCompositionEvent(event)) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setActiveComposerMenu(null)
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      handleModelPickerKeyboardMove(1)
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      handleModelPickerKeyboardMove(-1)
      return
    }

    if (event.key === 'ArrowLeft') {
      if (isModelPickerSearching) {
        return
      }

      event.preventDefault()
      handleModelPickerKeyboardLeft()
      return
    }

    if (event.key === 'ArrowRight') {
      if (isModelPickerSearching) {
        return
      }

      event.preventDefault()
      handleModelPickerKeyboardRight()
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      handleModelPickerKeyboardEnter()
    }
  }

  async function handleModelPickerModelSelect(option: AgentModelPickerOption) {
    clearModelPickerPointerIntent()
    setModelPickerActiveModelKey(option.key)
    setActiveComposerMenu(null)
    await handleSelectModel(option.key)
  }

  async function handleModelPickerThinkingSelect(level: AgentThinkingLevel, modelKey: string) {
    // Choosing a thinking level belongs to the currently open submenu.
    // A delayed model hover is only a preview candidate and must not steal this click.
    clearModelPickerPendingActivation()
    const option = modelPickerOptionByKey.get(modelKey)

    if (!option || !option.thinkingLevels.includes(level)) {
      return
    }

    clearModelPickerPointerIntent()
    setModelPickerActiveModelKey(modelKey)
    setActiveComposerMenu(null)
    await handleThinkingLevelSelection(level, modelKey)
  }

  useLayoutEffect(() => {
    if (activeComposerMenu !== 'model-cascader') {
      invalidateModelPickerPointerIntent()
    }
  }, [activeComposerMenu])

  useEffect(() => () => {
    invalidateModelPickerPointerIntent()
  }, [])

  useEffect(() => {
    if (!canOpenSessionMenu && activeOverlayPanel === 'sessions') {
      setActiveOverlayPanel(null)
    }
  }, [activeOverlayPanel, canOpenSessionMenu, setActiveOverlayPanel])

  useLayoutEffect(() => {
    if (activeComposerMenu !== 'model-cascader') {
      return
    }

    updateModelCascaderPosition()

    const frameId = window.requestAnimationFrame(updateModelCascaderPosition)
    window.addEventListener('resize', updateModelCascaderPosition)
    window.addEventListener('scroll', updateModelCascaderPosition, true)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateModelCascaderPosition)
      window.removeEventListener('scroll', updateModelCascaderPosition, true)
    }
  }, [
    activeComposerMenu,
    modelCascaderLayoutMetrics.panelWidth,
    modelCascaderLayoutMetrics.positioningWidth,
    modelCascaderLayoutMetrics.providerColumnWidth,
    modelCascaderLayoutMetrics.thinkingColumnWidth,
    updateModelCascaderPosition,
  ])

  useEffect(() => {
    if (activeComposerMenu !== 'model-cascader') {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      modelPickerSearchRef.current?.focus()
      scrollAgentModelCascaderActiveItemsIntoView()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activeComposerMenu])

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
          <AgentFileCard
            key={attachment.id}
            {...getAgentAttachmentFileCardProps({
              attachment,
              iconTheme,
              onRemove: () => {
                removeComposerAttachment(attachment.id)
              },
            })}
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
      canEdit={agentState.runtime.supportsQueuedMessageEditing}
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
        <div className='agent-model-field'>
          {hasConfiguredProviders ? (
            <AppTooltipButton
              ref={modelPickerTriggerRef}
              type='button'
              aria-expanded={activeComposerMenu === 'model-cascader'}
              aria-controls='agent-model-cascader'
              aria-haspopup='dialog'
              aria-label={modelPickerTriggerTitle}
              className='agent-model-cascader-trigger'
              disabled={
                isOpenCodeChildSession
                || (!workspacePath && !canUseDraftRuntimeWithoutWorkspace)
                || !agentState.runtime.hasConfiguredModels
                || isSwitchingModel
                || isSwitchingThinkingLevel
              }
              onClick={openModelCascader}
              onPointerMove={(event) => {
                if (activeComposerMenu === 'model-cascader') {
                  recordModelPickerPointerPoint(event)
                }
              }}
            >
              <span className='agent-model-cascader-trigger-model'>{modelPickerTriggerLabel}</span>
              {showTriggerThinkingLevel ? (
                <>
                  <span className='agent-model-cascader-trigger-separator'>/</span>
                  <span className='agent-model-cascader-trigger-thinking'>
                    {thinkingLevelLabel}
                  </span>
                </>
              ) : null}
            </AppTooltipButton>
          ) : (
            <Button
              className='agent-provider-setup-button'
              size='sm'
              variant='ghost'
              onPress={() => {
                setActiveComposerMenu(null)
                onOpenProviderSettings?.()
              }}
            >
              配置提供商
            </Button>
          )}
        </div>

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

      {activeComposerMenu === 'model-cascader' && hasConfiguredProviders && typeof document !== 'undefined' ? createPortal(
        <div
          id='agent-model-cascader'
          className='agent-model-cascader'
          data-agent-model-cascader='true'
          role='dialog'
          aria-label='Select model and thinking level'
          style={modelCascaderStyle}
          onPointerMove={handleModelPickerPointerMove}
          onPointerLeave={clearModelPickerPointerIntent}
        >
          <div className='agent-model-cascader-search'>
            <SearchLine aria-hidden='true' size={16} />
            <input
              ref={modelPickerSearchRef}
              type='search'
              aria-label='Search models'
              placeholder='Search models'
              value={modelPickerQuery}
              onChange={(event) => {
                handleModelPickerQueryChange(event.target.value)
              }}
              onKeyDown={handleModelPickerSearchKeyDown}
            />
            {modelPickerQuery ? (
              <AppTooltipButton
                type='button'
                className='agent-model-cascader-search-clear'
                aria-label='Clear model search'
                tooltip='清除搜索'
                onPointerDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  handleModelPickerQueryChange('')
                  window.requestAnimationFrame(() => {
                    modelPickerSearchRef.current?.focus()
                  })
                }}
              >
                <CloseLine aria-hidden='true' size={14} />
              </AppTooltipButton>
            ) : null}
          </div>

          <div className={`agent-model-cascader-grid${isModelPickerSearching ? ' is-searching' : ''}${showModelPickerThinkingColumn ? '' : ' has-no-thinking'}`}>
            {isModelPickerSearching ? (
              <section className='agent-model-cascader-column agent-model-cascader-column-results'>
                <div className='agent-model-cascader-column-title'>Models</div>
                <AppScrollArea
                  className='agent-model-cascader-scroll'
                  contentClassName='agent-model-cascader-scroll-content'
                >
                  <div className='agent-model-cascader-list' role='listbox' aria-label='Matching models'>
                    {modelPickerSearchResults.length > 0 ? modelPickerSearchResults.map((option) => (
                      <button
                        key={option.key}
                        type='button'
                        role='option'
                        aria-selected={option.key === composerModelKey}
                        className={`agent-model-cascader-option agent-model-cascader-model-option${option.key === activeModelOption?.key ? ' is-active' : ''}${option.key === composerModelKey ? ' is-selected' : ''}`}
                        onFocus={() => {
                          activateModelPickerModelPreview(option.key)
                          setModelPickerKeyboardColumn('model')
                        }}
                        onPointerEnter={(event) => {
                          setModelPickerKeyboardColumn('model')
                          handleModelPickerModelPointerPreview(option.key, event)
                        }}
                        onPointerMove={(event) => {
                          handleModelPickerModelPointerPreview(option.key, event)
                        }}
                        onClick={() => {
                          void handleModelPickerModelSelect(option)
                        }}
                      >
                        <span className='agent-model-cascader-option-main'>{option.modelId}</span>
                        <span className='agent-model-cascader-option-sub'>{option.provider}</span>
                      </button>
                    )) : (
                      <div className='agent-model-cascader-empty'>No matching models</div>
                    )}
                  </div>
                </AppScrollArea>
              </section>
            ) : (
              <>
                <section className='agent-model-cascader-column agent-model-cascader-column-provider'>
                  <div className='agent-model-cascader-column-title'>Provider</div>
                  <AppScrollArea
                    className='agent-model-cascader-scroll'
                    contentClassName='agent-model-cascader-scroll-content'
                  >
                    <div className='agent-model-cascader-list' role='listbox' aria-label='Available providers'>
                      {modelPickerProviderOptions.map((provider) => (
                        <button
                          key={provider}
                          type='button'
                          role='option'
                          aria-selected={provider === resolvedModelPickerProvider}
                          className={`agent-model-cascader-option${provider === resolvedModelPickerProvider ? ' is-active' : ''}${provider === resolvedSelectedProviderValue ? ' is-selected' : ''}`}
                          onFocus={() => {
                            setModelPickerKeyboardColumn('provider')
                            handleModelPickerProviderFocus(provider)
                          }}
                          onPointerEnter={(event) => {
                            handleModelPickerProviderPointerFocus(provider, event)
                          }}
                          onClick={() => {
                            setModelPickerKeyboardColumn('provider')
                            handleModelPickerProviderFocus(provider)
                          }}
                        >
                          <span className='agent-model-cascader-option-main'>{provider}</span>
                          <RightLine aria-hidden='true' className='agent-model-cascader-option-arrow' size={13} />
                        </button>
                      ))}
                    </div>
                  </AppScrollArea>
                </section>

                <section
                  className='agent-model-cascader-column agent-model-cascader-column-model'
                  onPointerEnter={() => {
                    if (modelPickerPendingActivationRef.current?.target === 'model') {
                      clearModelPickerPendingActivation()
                    }
                  }}
                >
                  <div className='agent-model-cascader-column-title'>Model</div>
                  <AppScrollArea
                    className='agent-model-cascader-scroll'
                    contentClassName='agent-model-cascader-scroll-content'
                  >
                    <div className='agent-model-cascader-list' role='listbox' aria-label='Available models'>
                      {modelPickerProviderModels.map((option) => (
                        <button
                          key={option.key}
                          type='button'
                          role='option'
                          aria-selected={option.key === composerModelKey}
                          className={`agent-model-cascader-option agent-model-cascader-model-option${option.key === activeModelOption?.key ? ' is-active' : ''}${option.key === composerModelKey ? ' is-selected' : ''}`}
                          onFocus={() => {
                            activateModelPickerModelPreview(option.key)
                            setModelPickerKeyboardColumn('model')
                          }}
                          onPointerEnter={(event) => {
                            setModelPickerKeyboardColumn('model')
                            handleModelPickerModelPointerPreview(option.key, event)
                          }}
                          onPointerMove={(event) => {
                            handleModelPickerModelPointerPreview(option.key, event)
                          }}
                          onClick={() => {
                            void handleModelPickerModelSelect(option)
                          }}
                        >
                          <span className='agent-model-cascader-option-main'>{option.modelId}</span>
                        </button>
                      ))}
                    </div>
                  </AppScrollArea>
                </section>
              </>
            )}

            {showModelPickerThinkingColumn && activeModelOption ? (
              <section
                key={activeModelOption.key}
                data-model-key={activeModelOption.key}
                className='agent-model-cascader-column agent-model-cascader-column-thinking'
                onPointerEnter={() => {
                  clearModelPickerPendingActivation()
                }}
              >
                <div className='agent-model-cascader-column-title'>Thinking level</div>
                <AppScrollArea
                  className='agent-model-cascader-scroll'
                  contentClassName='agent-model-cascader-scroll-content'
                >
                  <div className='agent-model-cascader-list' role='listbox' aria-label='Available thinking levels'>
                    {activeModelThinkingLevels.map((level) => (
                      <button
                        key={level}
                        type='button'
                        role='option'
                        aria-selected={level === activeModelThinkingLevel}
                        className={`agent-model-cascader-option${level === activeModelPickerThinkingLevel ? ' is-active' : ''}${level === activeModelThinkingLevel ? ' is-selected' : ''}`}
                        onFocus={() => {
                          setModelPickerActiveThinkingLevel(level)
                          setModelPickerKeyboardColumn('thinking')
                        }}
                        onPointerEnter={() => {
                          clearModelPickerPendingActivation()
                          setModelPickerActiveThinkingLevel(level)
                          setModelPickerKeyboardColumn('thinking')
                        }}
                        onClick={() => {
                          void handleModelPickerThinkingSelect(level, activeModelOption.key)
                        }}
                      >
                        <span className='agent-model-cascader-option-main'>{formatThinkingLevelLabel(level)}</span>
                      </button>
                    ))}
                  </div>
                </AppScrollArea>
              </section>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
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
              <AgentNewConversationPrompt />
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
            <AppScrollArea
              className='agent-messages-scroll'
              contentClassName='agent-messages-scroll-content'
              viewportClassName='agent-messages-scroll-viewport'
              viewportRef={handleMessagesScrollViewportRef}
            >
              <div
                className={`agent-messages${shouldVirtualizeMessages ? ' agent-messages-virtual' : ''}`}
                data-agent-virtual-enabled={openCodeNativeSession || piWebNativeSession
                  ? undefined
                  : (shouldVirtualizeMessages ? 'true' : 'false')}
                data-agent-virtual-total-items={openCodeNativeSession || piWebNativeSession ? undefined : virtualMessageItems.length}
              >
                {openCodeNativeSession ? (
                  <OpenCodeSessionTimeline
                    sessionID={activeSessionPath!}
                    workspacePath={workspacePath!}
                    optimisticUserMessages={openCodeOptimisticUserMessages}
                    onNavigateToSession={(sessionID) => void handleOpenSession('opencode', sessionID)}
                    onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
                  />
                ) : piWebNativeSession ? (
                  <>
                    <div
                      className={`agent-pi-web-session-stack${piWebStreamingStatus ? ' has-streaming-status' : ''}`}
                    >
                      <PiWebSessionTimeline
                        snapshot={piWebNativeSession}
                        workspacePath={workspacePath!}
                        optimisticUserMessages={piWebOptimisticUserMessages}
                        onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
                      />
                      {piWebStreamingStatus ? (
                        <div className='agent-pi-web-session-status'>
                          <AgentSessionStatusBubble status={piWebStreamingStatus} />
                        </div>
                      ) : null}
                    </div>
                    {piWebFileChanges.length > 0 ? (
                      <div className='agent-message-stack agent-native-surface-addon'>
                        <AgentMessageFileCards
                          fileChanges={piWebFileChanges}
                          iconTheme={iconTheme}
                          onOpenFile={onOpenMessageFile}
                          workspacePath={workspacePath}
                        />
                      </div>
                    ) : null}
                  </>
                ) : shouldVirtualizeMessages ? (
                  <AgentVirtualMessageList
                    activeSessionPath={activeSessionPath}
                    iconTheme={iconTheme}
                    items={virtualMessageItems}
                    messagesScrollElement={messagesScrollElement}
                    onOpenMessageFile={onOpenMessageFile}
                    onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
                    workspacePath={workspacePath}
                  />
                ) : (
                  <>
                    {renderedMessages.map((message) => {
                      const fileChanges = roundFileChangesByMessageId.get(message.id) ?? []

                      return (
                        <div key={message.id} className='agent-message-stack'>
                          <AgentMessageBubble
                            iconTheme={iconTheme}
                            message={message}
                            onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
                            workspacePath={workspacePath}
                          />
                          {fileChanges.length > 0 ? (
                            <AgentMessageFileCards
                              fileChanges={fileChanges}
                              iconTheme={iconTheme}
                              onOpenFile={onOpenMessageFile}
                              workspacePath={workspacePath}
                            />
                          ) : null}
                        </div>
                      )
                    })}
                    {sessionStatus ? (
                      <AgentSessionStatusBubble status={sessionStatus} />
                    ) : null}
                  </>
                )}
              </div>
            </AppScrollArea>
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

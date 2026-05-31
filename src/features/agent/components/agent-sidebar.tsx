import {
  type CSSProperties,
  createContext,
  type Dispatch,
  FormEvent,
  KeyboardEvent,
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
import { Button, Chip, Disclosure, ScrollShadow } from '@heroui/react'
import { Icon } from '@iconify/react'
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
  FolderLine,
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
import { getAgentProviderOrder } from '@/features/agent/provider-auth'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
import { AgentComposerMentionInput } from '@/features/agent/components/agent-composer-mention-input'
import { isAgentKeyboardCompositionEvent } from '@/features/agent/lib/keyboard'
import { shouldRunAgentModelCascaderDelayedActivation } from '@/features/agent/lib/model-cascader-pointer-intent'
import type { ComposerMentionToken } from '@/features/agent/lib/composer-mentions'
import { resolveWorkspaceMessageLink } from '@/features/agent/lib/message-links'
import {
  resolveAgentWorkspaceSessionRestore,
  type AgentProjectSessionRequest,
} from '@/features/agent/lib/project-session-request'
import { serializeComposerText } from '@/features/agent/lib/composer-mentions'
import type { ActiveWorkspaceContext, ConversationRecord, ConversationState } from '@/features/conversations/types'
import type { ProjectRecord, ProjectState, WorkspaceIconTheme } from '@/features/workspace/types'
import {
  findLatestOpenableAgentFileChange,
  initialAgentFileAutoOpenState,
  resolveNextAgentFileAutoOpen,
  type AgentFileAutoOpenState,
} from '@/features/agent/auto-open-file'
import { buildRoundFileChangesByMessageId } from '@/features/agent/round-file-changes'
import {
  AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS,
  getAlternateRunningPromptBehavior,
  useSettingsStore,
  type AgentRunningPromptEnterBehavior,
} from '@/hooks/use-settings-store'
import type {
  AgentClientEvent,
  AgentMessageAttachment,
  AgentMessageFileChange,
  AgentPromptAttachment,
  AgentQueuedMessageKind,
  AgentQueuedMessageUpdate,
  AgentSessionListItem,
  AgentSessionAnnotations,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentSidebarMessageStatus,
  AgentThinkingLevel,
  AgentWorkspaceState,
} from '@/features/agent/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'

type AgentProjectSwitchMenuOptions = {
  startNewSession?: boolean
}

type AgentSidebarProps = {
  activeWorkspaceContext?: ActiveWorkspaceContext
  conversationState?: ConversationState
  externalSessionRequest?: AgentProjectSessionRequest | null
  onExternalSessionRequestHandled?: (requestId: number) => void
  iconTheme?: WorkspaceIconTheme | null
  onConversationDraftFailed?: (conversationId: string) => Promise<void> | void
  onConversationSessionStarted?: (
    conversationId: string,
    patch: { agentSessionPath: string | null; lastMessagePreview?: string | null; title?: string | null },
  ) => Promise<void> | void
  onCreateConversationWorkspace?: (request: { initialPrompt?: string | null }) => Promise<ConversationRecord>
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProviderSettings?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  onOpenProjectFolder?: (project: ProjectRecord) => Promise<void> | void
  onOpenProjectSession?: (project: ProjectRecord, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
  projectState?: ProjectState
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
  onConversationSessionStarted?: (
    conversationId: string,
    patch: { agentSessionPath: string | null; lastMessagePreview?: string | null; title?: string | null },
  ) => Promise<void> | void
  onCreateConversationWorkspace?: (request: { initialPrompt?: string | null }) => Promise<ConversationRecord>
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProviderSettings?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  onOpenProjectFolder?: (project: ProjectRecord) => Promise<void> | void
  onOpenProjectSession?: (project: ProjectRecord, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  projectState?: ProjectState
  workspaceState?: AgentWorkspaceState | null
  workspacePath: string | null
}

type AgentSessionTreeProps = {
  className?: string
  onRequestClose?: () => void
  id?: string
  isFloating?: boolean
}

type AgentProjectSessionBucket = {
  error: string | null
  hasLoaded: boolean
  isLoading: boolean
  sessions: AgentSessionListItem[]
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

type AgentAttachmentItemData = (AgentPromptAttachment | AgentMessageAttachment) & {
  id?: string
  status?: AgentMessageAttachment['status']
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

type AgentSessionMenuStyle = CSSProperties

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

type AgentSessionSelection = { kind: 'new' } | { kind: 'session', sessionPath: string }
type OptimisticComposerClearToken = { id: number; revision: number }

const MARKDOWN_PLUGINS = [remarkGfm]
const AGENT_THINKING_AUTO_EXPAND_DELAY_MS = 520
const AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS = 140
const AGENT_THINKING_MIN_EXPANDED_MS = 360
const AGENT_THINKING_SCROLL_STICKY_THRESHOLD_PX = 24
const MAX_VISIBLE_MESSAGE_FILE_CHIPS = 6
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
const AGENT_SESSION_MENU_MARGIN_PX = 8
const AGENT_SESSION_MENU_GAP_PX = 8
const AGENT_SESSION_MENU_WIDTH_PX = 320
const AGENT_SESSION_MENU_HEIGHT_PX = 320
const AGENT_SESSION_MENU_MIN_HEIGHT_PX = 180
const AGENT_SESSION_MENU_MAX_HEIGHT_PX = 416
const AGENT_TREE_CONTEXT_MENU_MARGIN_PX = 8
const AGENT_TREE_CONTEXT_MENU_GAP_PX = 2
const AGENT_TREE_SESSION_CONTEXT_MENU_WIDTH_PX = 168
const AGENT_TREE_SESSION_CONTEXT_MENU_HEIGHT_PX = 82
const AGENT_TREE_PROJECT_CONTEXT_MENU_WIDTH_PX = 238
const AGENT_TREE_PROJECT_CONTEXT_MENU_HEIGHT_PX = 80

const emptyAgentState: AgentWorkspaceState = {
  activeSession: null,
  runtime: {
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
  version: 1,
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
  handleDeleteSession: (sessionPath: string) => Promise<void>
  handleOpenSession: (sessionPath: string) => Promise<void>
  handleRenameSession: (rootPath: string, sessionPath: string, name: string) => Promise<void>
  handleSelectModel: (modelKey: string) => Promise<void>
  handleThinkingLevelSelection: (level: AgentThinkingLevel, modelKey?: string) => Promise<void>
  handlePickComposerAttachments: () => Promise<void>
  handleQueuedMessageUpdate: (update: AgentQueuedMessageUpdate) => Promise<void>
  handleStartNewSession: () => void
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  hasComposerPayload: boolean
  hasConfiguredProviders: boolean
  iconTheme?: WorkspaceIconTheme | null
  isLoading: boolean
  isSwitchingModel: boolean
  isSwitchingThinkingLevel: boolean
  liveTools: LiveToolState[]
  messagesScrollRef: React.RefObject<HTMLDivElement | null>
  modelFieldRef: React.RefObject<HTMLDivElement | null>
  modelInputValue: string
  onConversationDraftFailed?: (conversationId: string) => Promise<void> | void
  onConversationSessionStarted?: (
    conversationId: string,
    patch: { agentSessionPath: string | null; lastMessagePreview?: string | null; title?: string | null },
  ) => Promise<void> | void
  onCreateConversationWorkspace?: (request: { initialPrompt?: string | null }) => Promise<ConversationRecord>
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProviderSettings?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  onOpenProjectFolder?: (project: ProjectRecord) => Promise<void> | void
  onOpenProjectSession?: (project: ProjectRecord, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  overlayPanelRef: React.RefObject<HTMLDivElement | null>
  panelError: string | null
  loadProjectSessions: (project: ProjectRecord) => Promise<void>
  projectSessions: Record<string, AgentProjectSessionBucket>
  projectState: ProjectState
  renderedMessages: AgentSidebarMessage[]
  resolvedSelectedProviderValue: string
  roundFileChangesByMessageId: Map<string, AgentMessageFileChange[]>
  removeComposerAttachment: (attachmentId: string) => void
  sessionButtonRef: React.RefObject<HTMLButtonElement | null>
  sessionStatus: AgentSessionStatus | null
  setActiveComposerMenu: React.Dispatch<React.SetStateAction<AgentComposerMenu>>
  setActiveOverlayPanel: React.Dispatch<React.SetStateAction<'sessions' | null>>
  setComposerState: React.Dispatch<React.SetStateAction<ComposerState>>
  setPanelError: React.Dispatch<React.SetStateAction<string | null>>
  statusMessage: string | null
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

function areAgentSessionMenuStylesEqual(
  left: AgentSessionMenuStyle,
  right: AgentSessionMenuStyle,
) {
  return left.height === right.height
    && left.left === right.left
    && left.maxHeight === right.maxHeight
    && left.top === right.top
    && left.width === right.width
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

function resolveAgentSessionMenuStyle(anchorRect: DOMRect): AgentSessionMenuStyle {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = Math.min(AGENT_SESSION_MENU_MARGIN_PX, Math.max(8, viewportWidth / 32))
  const maxWidth = Math.max(240, viewportWidth - (margin * 2))
  const width = Math.min(AGENT_SESSION_MENU_WIDTH_PX, maxWidth)
  const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - width - margin))
  const maxViewportHeight = Math.max(AGENT_SESSION_MENU_MIN_HEIGHT_PX, viewportHeight - (margin * 2))
  const availableBelow = Math.max(0, viewportHeight - anchorRect.bottom - margin - AGENT_SESSION_MENU_GAP_PX)
  const availableAbove = Math.max(0, anchorRect.top - margin - AGENT_SESSION_MENU_GAP_PX)
  const targetHeight = Math.min(
    AGENT_SESSION_MENU_HEIGHT_PX,
    AGENT_SESSION_MENU_MAX_HEIGHT_PX,
    maxViewportHeight,
  )
  const opensBelow = availableBelow >= targetHeight || availableBelow >= availableAbove
  const availableHeight = opensBelow ? availableBelow : availableAbove
  const height = Math.min(
    targetHeight,
    Math.max(
      AGENT_SESSION_MENU_MIN_HEIGHT_PX,
      Math.min(availableHeight || maxViewportHeight, maxViewportHeight),
    ),
  )
  const top = opensBelow
    ? Math.min(anchorRect.bottom + AGENT_SESSION_MENU_GAP_PX, viewportHeight - height - margin)
    : Math.max(margin, anchorRect.top - AGENT_SESSION_MENU_GAP_PX - height)

  return {
    height: `${height}px`,
    left: `${left}px`,
    maxHeight: `${Math.min(AGENT_SESSION_MENU_MAX_HEIGHT_PX, maxViewportHeight)}px`,
    top: `${Math.max(margin, top)}px`,
    width: `${width}px`,
  }
}

function resolveAgentTreeContextMenuStyle(
  anchorRect: AgentMenuAnchorRect,
  width: number,
  estimatedHeight: number,
): CSSProperties {
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = AGENT_TREE_CONTEXT_MENU_MARGIN_PX
  const gap = AGENT_TREE_CONTEXT_MENU_GAP_PX
  const maxLeft = Math.max(margin, viewportWidth - width - margin)
  const isPointAnchor = anchorRect.width === 0 && anchorRect.height === 0
  const preferredLeft = isPointAnchor ? anchorRect.left : anchorRect.right - width
  const overflowFallbackLeft = isPointAnchor ? anchorRect.left - width - gap : maxLeft
  const unclampedLeft = preferredLeft + width > viewportWidth - margin
    ? overflowFallbackLeft
    : preferredLeft
  const left = Math.max(margin, Math.min(unclampedLeft, maxLeft))
  const preferredTop = isPointAnchor ? anchorRect.top : anchorRect.bottom + gap
  const fallbackTop = anchorRect.top - gap - estimatedHeight
  const opensBelow = preferredTop + estimatedHeight <= viewportHeight - margin
    || anchorRect.top < estimatedHeight + gap + margin
  const top = opensBelow
    ? Math.min(preferredTop, viewportHeight - estimatedHeight - margin)
    : Math.max(margin, fallbackTop)

  return {
    left: `${left}px`,
    position: 'fixed',
    top: `${top}px`,
    width: `${width}px`,
    zIndex: 1300,
  }
}

function createAgentPointAnchorRect(clientX: number, clientY: number): AgentMenuAnchorRect {
  return {
    bottom: clientY,
    height: 0,
    left: clientX,
    right: clientX,
    top: clientY,
    width: 0,
  }
}

function isAgentTreeContextMenuEventTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('[data-agent-tree-context-menu-root="true"]'))
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
      annotations,
    },
  }
}

function getMessageStatus(message: AgentSidebarMessage): AgentSidebarMessageStatus {
  return message.status ?? (message.isError ? 'error' : 'done')
}

function getToolStatusLabel(status: AgentSidebarMessageStatus) {
  switch (status) {
    case 'running':
      return 'Running'
    case 'error':
      return 'Failed'
    default:
      return 'Done'
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

function AgentMarkdown({
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
}

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
              <Disclosure.Trigger className='agent-message-toggle'>
                {getMessageDisclosureIcon(kind, title)}
                <span className='agent-message-toggle-title'>{displayTitle}</span>
                <span className='agent-message-toggle-trailing' title={status ? getToolStatusLabel(status) : undefined}>
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
            </Disclosure.Heading>
            {label ? (
              <div className='agent-message-disclosure-meta'>
                {label ? <span className='agent-message-label'>{label}</span> : null}
              </div>
            ) : null}
          </div>

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
        </>
      )}
    </Disclosure>
  )
}

function AgentMessageFileChips({
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

  const visibleChanges = fileChanges.slice(0, MAX_VISIBLE_MESSAGE_FILE_CHIPS)
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
          const isInteractive = change.kind !== 'deleted'
          const chipContent = (
            <Chip
              className={`agent-message-file-chip ${isInteractive ? 'is-interactive' : 'is-static'}`}
              color='default'
              size='sm'
              title={isInteractive ? relativePath : `${relativePath} (deleted)`}
              variant='soft'
            >
              <WorkspaceFileIcon fileName={label} iconTheme={iconTheme ?? null} />
              <Chip.Label className='agent-message-file-chip-label'>{label}</Chip.Label>
              <FileChangeStatusBadge className='agent-message-file-chip-status' kind={getAgentFileChangeVisualKind(change.kind)} />
            </Chip>
          )

          if (!isInteractive) {
            return (
              <div key={`${change.filePath}:${change.kind}`} className='agent-message-file-chip-wrapper'>
                {chipContent}
              </div>
            )
          }

          return (
            <div
              key={`${change.filePath}:${change.kind}`}
              aria-label={`Open ${relativePath}`}
              className='agent-message-file-chip-wrapper'
              role='button'
              tabIndex={0}
              onClick={() => {
                onOpenFile?.(change.filePath, change.kind)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') {
                  return
                }

                event.preventDefault()
                onOpenFile?.(change.filePath, change.kind)
              }}
            >
              {chipContent}
            </div>
          )
        })}
        {hiddenCount > 0 ? (
          <Chip className='agent-message-file-chip agent-message-file-chip-overflow' color='default' size='sm' variant='soft'>
            <Chip.Label className='agent-message-file-chip-label'>+{hiddenCount}</Chip.Label>
          </Chip>
        ) : null}
      </div>
    </div>
  )
}

function AgentAttachmentItem({
  attachment,
  iconTheme,
  iconSize = 18,
  onRemove,
}: {
  attachment: AgentAttachmentItemData
  iconTheme?: WorkspaceIconTheme | null
  iconSize?: number
  onRemove?: () => void
}) {
  const isImage = attachment.kind === 'image'
  const previewSrc = isImage ? attachment.data : undefined
  const statusLabel = getAttachmentStatusLabel(attachment.status)
  const sizeLabel = formatAttachmentSize(attachment.size)
  const meta = [
    isImage ? 'Image' : 'File',
    isImage ? null : sizeLabel,
    statusLabel,
  ].filter(Boolean).join(' · ')

  return (
    <div className={`agent-attachment-item${isImage ? ' is-image' : ''}${attachment.status === 'omitted' ? ' is-omitted' : ''}`} title={attachment.path ?? attachment.fileName}>
      <span className={`agent-attachment-preview${previewSrc ? ' has-image' : ''}`}>
        {previewSrc ? (
          <img alt='' draggable='false' src={previewSrc} />
        ) : isImage ? (
          <PicLine aria-hidden='true' size={iconSize} />
        ) : (
          <WorkspaceFileIcon fileName={attachment.fileName} iconTheme={iconTheme ?? null} />
        )}
      </span>
      {isImage ? null : (
        <span className='agent-attachment-text'>
          <span className='agent-attachment-name'>{attachment.fileName}</span>
          {meta ? <span className='agent-attachment-meta'>{meta}</span> : null}
        </span>
      )}
      {onRemove ? (
        <button
          type='button'
          className='agent-attachment-remove'
          aria-label={`移除 ${attachment.fileName}`}
          title='移除附件'
          onClick={onRemove}
        >
          <CloseLine aria-hidden='true' size={10} />
        </button>
      ) : null}
    </div>
  )
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
        <AgentAttachmentItem
          key={`${attachment.fileName}-${index}`}
          attachment={attachment}
          iconTheme={iconTheme}
        />
      ))}
    </div>
  )
}

function AgentMessageBubble({
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
        <span
          key={`${badge.kind}:${badge.label}`}
          className={`agent-session-status-badge agent-session-status-badge-${badge.kind}`}
          aria-label={badge.title}
          title={badge.title}
        >
          <UnicodeSpinner
            className='agent-session-status-badge-indicator'
            name={badge.indicator.name}
          />
          <span className='agent-session-status-badge-label'>{badge.label}</span>
        </span>
      ))}
    </article>
  )
}

function AgentQueuedComposerTray({
  messages,
  onUpdate,
}: {
  messages: AgentQueuedComposerMessage[]
  onUpdate: (update: AgentQueuedMessageUpdate) => Promise<void>
}) {
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [openMenuMessageId, setOpenMenuMessageId] = useState<string | null>(null)
  const [updatingMessageId, setUpdatingMessageId] = useState<string | null>(null)
  const editingInputRef = useRef<HTMLInputElement | null>(null)

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

  useEffect(() => {
    if (!openMenuMessageId) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target

      if (target instanceof Element && target.closest('[data-agent-queued-menu="true"]')) {
        return
      }

      setOpenMenuMessageId(null)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenuMessageId(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenuMessageId])

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
              <CornerUpLeftLine size={15} />
            </div>

            <div className='agent-queued-row-main'>
              <span className={`agent-queued-kind agent-queued-kind-${message.kind}`}>
                {isFollowUp ? '排队' : '引导'}
              </span>
              {isEditing ? (
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
                <span className='agent-queued-text' title={message.text}>
                  {message.text}
                </span>
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
                  <button
                    type='button'
                    className='agent-queued-action is-text'
                    disabled={isUpdating}
                    title={isFollowUp ? '改为引导当前运行' : '改为当前运行结束后执行'}
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
                  </button>
                  <button
                    type='button'
                    className='agent-queued-action'
                    disabled={isUpdating}
                    aria-label='删除待处理消息'
                    title='删除'
                    onClick={() => {
                      void runUpdate(message, {
                        action: 'delete',
                        expectedText: message.text,
                        index: message.index,
                        kind: message.kind,
                      })
                    }}
                  >
                    <Delete2Line size={15} />
                  </button>
                  <div className='agent-queued-menu-anchor' data-agent-queued-menu='true'>
                    <button
                      type='button'
                      className='agent-queued-action'
                      disabled={isUpdating}
                      aria-expanded={isMenuOpen}
                      aria-haspopup='menu'
                      aria-label='更多待处理消息操作'
                      title='更多'
                      onClick={() => {
                        setOpenMenuMessageId((currentValue) => currentValue === message.id ? null : message.id)
                      }}
                    >
                      <More1Line size={16} />
                    </button>
                    {isMenuOpen ? (
                      <div className='agent-queued-menu' role='menu'>
                        <button
                          type='button'
                          role='menuitem'
                          className='agent-queued-menu-item'
                          onClick={() => {
                            beginEdit(message)
                          }}
                        >
                          <EditLine size={16} />
                          <span>编辑消息</span>
                        </button>
                        <button
                          type='button'
                          role='menuitem'
                          className='agent-queued-menu-item'
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
                        </button>
                      </div>
                    ) : null}
                  </div>
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
  workspaceState,
  workspacePath,
}: AgentProviderProps) {
  const runningPromptEnterBehavior = useSettingsStore((state) => state.agent.runningPromptEnterBehavior)
  const workspaceTree = useWorkspaceStore((state) => state.tree)
  const defaultModelSelection = parseModelSelection(null)
  const [agentState, setAgentState] = useState<AgentWorkspaceState>(emptyAgentState)
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
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false)
  const [projectSessions, setProjectSessions] = useState<Record<string, AgentProjectSessionBucket>>({})
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const modelFieldRef = useRef<HTMLDivElement | null>(null)
  const overlayPanelRef = useRef<HTMLDivElement | null>(null)
  const sessionButtonRef = useRef<HTMLButtonElement | null>(null)
  const loadAgentStateRequestIdRef = useRef(0)
  const openSessionRequestIdRef = useRef(0)
  const previousSessionPathRef = useRef<string | null>(null)
  const locallyEmittedWorkspaceStatesRef = useRef<WeakSet<AgentWorkspaceState>>(new WeakSet())
  const pendingExternalWorkspaceStateRef = useRef<AgentWorkspaceState | null>(null)
  const handledExternalSessionRequestRef = useRef<number | null>(null)
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
    setProjectSessions((currentValue) => {
      const existingBucket = currentValue[project.id]
      if (existingBucket?.isLoading || existingBucket?.hasLoaded) {
        return currentValue
      }

      return {
        ...currentValue,
        [project.id]: {
          error: null,
          hasLoaded: false,
          isLoading: true,
          sessions: existingBucket?.sessions ?? [],
        },
      }
    })

    try {
      const sessions = await window.appApi.listAgentSessions(project.path)
      setProjectSessions((currentValue) => ({
        ...currentValue,
        [project.id]: {
          error: null,
          hasLoaded: true,
          isLoading: false,
          sessions,
        },
      }))
    } catch (error) {
      setProjectSessions((currentValue) => ({
        ...currentValue,
        [project.id]: {
          error: error instanceof Error ? error.message : 'Unable to load conversations.',
          hasLoaded: true,
          isLoading: false,
          sessions: currentValue[project.id]?.sessions ?? [],
        },
      }))
    }
  }, [])

  async function ensureSelectedAgentSessionActive(selection = activeSessionSelectionRef.current) {
    if (!workspacePath || selection.kind !== 'session') {
      return null
    }

    if (agentState.activeSession?.sessionPath === selection.sessionPath) {
      setViewedSessionSnapshot(null)
      return agentState
    }

    const requestId = openSessionRequestIdRef.current
    const nextState = await window.appApi.openAgentSession(workspacePath, selection.sessionPath)

    if (
      requestId !== openSessionRequestIdRef.current
      || activeSessionSelectionRef.current.kind !== 'session'
      || activeSessionSelectionRef.current.sessionPath !== selection.sessionPath
    ) {
      return null
    }

    setAgentState(nextState)
    setViewedSessionSnapshot(null)
    syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
    return nextState
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
    const activeProject = projectState.projects.find((project) => project.id === projectState.lastProjectId)
    const agentWorkspacePath = agentState.runtime.workspacePath

    if (
      !activeProject
      || !workspacePath
      || !agentWorkspacePath
      || normalizeAgentProjectPath(activeProject.path) !== normalizeAgentProjectPath(workspacePath)
      || normalizeAgentProjectPath(agentWorkspacePath) !== normalizeAgentProjectPath(workspacePath)
    ) {
      return
    }

    setProjectSessions((currentValue) => ({
      ...currentValue,
      [activeProject.id]: {
        error: null,
        hasLoaded: true,
        isLoading: false,
        sessions: agentState.sessions,
      },
    }))
  }, [agentState.runtime.workspacePath, agentState.sessions, projectState.lastProjectId, projectState.projects, workspacePath])

  useEffect(() => {
    const unsubscribe = window.appApi.onAgentEvent((event: AgentClientEvent) => {
      if (event.type === 'workspace_state') {
        const eventWorkspacePath = event.state.runtime.workspacePath
        const expectedWorkspacePath = workspacePathRef.current
        if (
          !expectedWorkspacePath
          || !eventWorkspacePath
          || normalizeAgentProjectPath(eventWorkspacePath) !== normalizeAgentProjectPath(expectedWorkspacePath)
        ) {
          return
        }

        setAgentState(event.state)
        const nextSessionPath = event.state.activeSession?.sessionPath ?? null
        const currentSelection = activeSessionSelectionRef.current
        const isViewingEventRuntimeSession = currentSelection.kind === 'session'
          && currentSelection.sessionPath === nextSessionPath

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

      if (event.type === 'session_annotations_updated') {
        setAgentState((currentState) => mergeSessionAnnotationsState(currentState, event.sessionId, event.annotations))
        return
      }

      if (
        event.type === 'assistant_message_started'
        && event.sessionId === agentState.activeSession?.sessionId
      ) {
        setDraftAssistant('')
        setDraftThinking('')
        setIsThinkingStreaming(false)
        return
      }

      if (
        event.type === 'assistant_thinking_delta'
        && event.sessionId === agentState.activeSession?.sessionId
      ) {
        setIsThinkingStreaming(true)
        setDraftThinking((currentValue) => currentValue + event.delta)
        return
      }

      if (
        event.type === 'assistant_thinking_finished'
        && event.sessionId === agentState.activeSession?.sessionId
      ) {
        setIsThinkingStreaming(false)
        return
      }

      if (
        event.type === 'assistant_message_delta'
        && event.sessionId === agentState.activeSession?.sessionId
      ) {
        setDraftAssistant((currentValue) => currentValue + event.delta)
        return
      }

      if (
        event.type === 'tool_execution_started'
        && event.sessionId === agentState.activeSession?.sessionId
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
        && event.sessionId === agentState.activeSession?.sessionId
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
        && event.sessionId === agentState.activeSession?.sessionId
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
        && activeSessionSelectionRef.current.sessionPath === agentState.activeSession?.sessionPath
        && (!event.sessionId || event.sessionId === agentState.activeSession?.sessionId)
      ) {
        setPanelError(event.message)
      }
    })

    return unsubscribe
  }, [agentState.activeSession?.sessionId, agentState.activeSession?.sessionPath, workspacePath])

  useEffect(() => {
    if (!workspacePath || !workspaceState || workspaceState.runtime.workspacePath !== workspacePath) {
      return
    }

    if (locallyEmittedWorkspaceStatesRef.current.has(workspaceState)) {
      return
    }

    setAgentState((currentState) => {
      if (currentState === workspaceState) {
        return currentState
      }

      pendingExternalWorkspaceStateRef.current = workspaceState
      return workspaceState
    })
    const defaultDraft = getRuntimeDefaultModelDraft(workspaceState.runtime)
    const nextDraft = normalizeAgentModelDraft(newSessionModelDraftRef.current.provider || newSessionModelDraftRef.current.modelId
      ? newSessionModelDraftRef.current
      : defaultDraft, workspaceState.runtime, defaultDraft)
    syncNewSessionModelDraft(nextDraft)
    const currentSelection = activeSessionSelectionRef.current
    if (currentSelection.kind === 'session' && currentSelection.sessionPath === workspaceState.activeSession?.sessionPath) {
      syncModelDraft(getRuntimeSelectedModelDraft(workspaceState.runtime))
    } else if (currentSelection.kind === 'new') {
      syncModelDraft(nextDraft)
    }
    setHasLoadedWorkspaceState(true)
  }, [workspacePath, workspaceState])

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

      void window.appApi.loadAgentDraftState()
        .then((nextState) => {
          if (loadAgentStateRequestIdRef.current !== requestId) {
            return
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
            setPanelError(error instanceof Error ? error.message : 'Unable to load provider settings.')
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
        const sessionRestore = resolveAgentWorkspaceSessionRestore(
          matchingExternalRequest,
          workspaceState.lastAgentSessionPath,
        )

        return window.appApi.loadAgentWorkspace(
          workspacePath,
          sessionRestore.preferredSessionPath,
          sessionRestore.options,
        )
      })
      .then((nextState) => {
        if (loadAgentStateRequestIdRef.current !== requestId) {
          return
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
            ? { kind: 'session' as const, sessionPath: restoredSessionPath }
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
          setPanelError(error instanceof Error ? error.message : 'Unable to load Pi Agent sessions.')
        }
      })
      .finally(() => {
        if (loadAgentStateRequestIdRef.current === requestId) {
          setIsLoading(false)
        }
      })
  }, [workspacePath])

  useEffect(() => {
    if (!workspacePath || isLoading || !hasLoadedWorkspaceState) {
      return
    }

    void window.appApi.updateWorkspaceState(workspacePath, {
      lastAgentSessionPath: restorableSessionPath ?? null,
    })
  }, [hasLoadedWorkspaceState, isLoading, restorableSessionPath, workspacePath])

  useEffect(() => {
    if (!workspacePath || activeWorkspaceContext.kind !== 'project') {
      setActiveOverlayPanel(null)
    }
  }, [activeWorkspaceContext.kind, workspacePath])

  useEffect(() => {
    if (!activeOverlayPanel) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (overlayPanelRef.current?.contains(target)) {
        return
      }

      if (sessionButtonRef.current?.contains(target)) {
        return
      }

      if (isAgentTreeContextMenuEventTarget(target)) {
        return
      }

      setActiveOverlayPanel(null)
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        setActiveOverlayPanel(null)
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [activeOverlayPanel])

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
  const activeSession = activeSessionPath
    ? agentState.sessions.find((session) => session.path === activeSessionPath) ?? null
    : null
  const isViewingActiveRuntime = Boolean(
    activeSessionPath
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

  const renderedMessages = useMemo(() => {
    const persistedMessages = visiblePersistedMessages
    const nextMessages = [...persistedMessages]
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
  }, [draftAssistant, draftThinking, isThinkingStreaming, isViewingActiveRuntime, liveTools, visiblePersistedMessages])

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

  async function handleOpenSession(sessionPath: string) {
    if (!workspacePath) {
      return
    }

    syncActiveSessionSelection({ kind: 'session', sessionPath })
    const requestId = openSessionRequestIdRef.current + 1
    openSessionRequestIdRef.current = requestId

    if (agentState.activeSession?.sessionPath === sessionPath) {
      setViewedSessionSnapshot(null)
      syncModelDraft(getRuntimeSelectedModelDraft(agentState.runtime))
      setPanelError(null)
      setActiveOverlayPanel(null)
      return
    }

    try {
      setPanelError(null)
      const nextSnapshot = await window.appApi.readAgentSession(workspacePath, sessionPath)
      if (
        requestId !== openSessionRequestIdRef.current
        || activeSessionSelectionRef.current.kind !== 'session'
        || activeSessionSelectionRef.current.sessionPath !== sessionPath
      ) {
        return
      }

      setViewedSessionSnapshot(nextSnapshot)
      setActiveOverlayPanel(null)
    } catch (error) {
      if (
        requestId !== openSessionRequestIdRef.current
        || activeSessionSelectionRef.current.kind !== 'session'
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

    void handleOpenSession(externalSessionRequest.sessionPath)
  }, [
    externalSessionRequest,
    hasLoadedWorkspaceState,
    isLoading,
    onExternalSessionRequestHandled,
    projectState.projects,
    workspacePath,
  ])

  async function handleDeleteSession(sessionPath: string) {
    if (!workspacePath) {
      return
    }

    try {
      setDeletingSessionPath(sessionPath)
      setPanelError(null)
      const nextState = await window.appApi.deleteAgentSession(workspacePath, sessionPath)
      setAgentState(nextState)
      const currentSelection = activeSessionSelectionRef.current
      if (currentSelection.kind === 'session' && currentSelection.sessionPath === sessionPath) {
        setViewedSessionSnapshot(null)
        const nextActiveSessionPath = nextState.activeSession?.sessionPath
        const nextSelection = nextActiveSessionPath
          && nextState.sessions.some((session) => session.path === nextActiveSessionPath)
          ? { kind: 'session' as const, sessionPath: nextActiveSessionPath }
          : { kind: 'new' as const }
        syncActiveSessionSelection(nextSelection)
        syncModelDraft(nextSelection.kind === 'session'
          ? getRuntimeSelectedModelDraft(nextState.runtime)
          : newSessionModelDraftRef.current)
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to delete that session.')
    } finally {
      setDeletingSessionPath(null)
    }
  }

  async function handleRenameSession(rootPath: string, sessionPath: string, name: string) {
    const nextName = name.trim()

    if (!nextName) {
      return
    }

    try {
      setPanelError(null)
      const nextState = await window.appApi.renameAgentSession(rootPath, sessionPath, nextName)
      const isCurrentWorkspace = Boolean(
        workspacePath
        && normalizeAgentProjectPath(rootPath) === normalizeAgentProjectPath(workspacePath),
      )

      if (isCurrentWorkspace) {
        setAgentState(nextState)
        setViewedSessionSnapshot((currentSnapshot) => (
          currentSnapshot?.sessionPath === sessionPath
            ? { ...currentSnapshot, name: nextName }
            : currentSnapshot
        ))
      }

      const matchingProject = projectState.projects.find((project) => (
        normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(rootPath)
      ))

      if (matchingProject) {
        setProjectSessions((currentValue) => {
          const currentBucket = currentValue[matchingProject.id]

          if (!currentBucket) {
            return currentValue
          }

          return {
            ...currentValue,
            [matchingProject.id]: {
              ...currentBucket,
              error: null,
              hasLoaded: true,
              isLoading: false,
              sessions: nextState.sessions,
            },
          }
        })
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to rename that session.')
      throw error
    }
  }

  async function handleSelectModel(modelKey: string) {
    if (!workspacePath && !canUseDraftRuntimeWithoutWorkspace) {
      return
    }

    try {
      setIsSwitchingModel(true)
      setPanelError(null)
      const isNewSelection = activeSessionSelection.kind === 'new'
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

      const activeState = await ensureSelectedAgentSessionActive()
      if (!activeState?.activeSession) {
        setPanelError('Open a session before switching the model.')
        setActiveComposerMenu(null)
        return
      }

      const nextState = await window.appApi.selectAgentModel(modelKey)
      if (
        activeSessionSelectionRef.current.kind !== 'session'
        || activeSessionSelectionRef.current.sessionPath !== nextState.activeSession?.sessionPath
      ) {
        return
      }

      setAgentState(nextState)
      syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
      setActiveComposerMenu(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to switch the model.')
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

    try {
      setIsSwitchingThinkingLevel(true)
      setPanelError(null)
      const isNewSelection = activeSessionSelection.kind === 'new'
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

      const activeState = await ensureSelectedAgentSessionActive()
      if (!activeState?.activeSession) {
        setPanelError('Open a session before changing the thinking level.')
        setActiveComposerMenu(null)
        return
      }

      const nextState = await window.appApi.selectAgentThinkingLevel(level, nextModelKey)
      if (
        activeSessionSelectionRef.current.kind !== 'session'
        || activeSessionSelectionRef.current.sessionPath !== nextState.activeSession?.sessionPath
      ) {
        return
      }

      setAgentState(nextState)
      syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
      setActiveComposerMenu(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to switch the thinking level.')
    } finally {
      setIsSwitchingThinkingLevel(false)
    }
  }

  async function submitComposerPrompt(streamingBehavior?: AgentRunningPromptEnterBehavior) {
    const submittedComposerState = composerStateRef.current
    const submittedComposerAttachments = composerAttachmentsRef.current
    const serializedPrompt = serializeComposerText(submittedComposerState.value, submittedComposerState.mentions)
    const trimmedPrompt = serializedPrompt.trim()

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

    let createdConversation: ConversationRecord | null = null
    let runtimeForSubmit = agentState.runtime
    const draftBeforeWorkspaceCreation = newSessionModelDraftRef.current
    const composerSnapshot = {
      attachments: submittedComposerAttachments,
      state: submittedComposerState,
    }
    const optimisticClearId = clearComposerOptimistically()
    let didSendPromptToAgent = false
    let fallbackErrorMessage = 'Unable to send your prompt.'

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
          createdConversation = await createConversationWorkspace({ initialPrompt: trimmedPrompt })
          targetWorkspacePath = createdConversation.workspacePath
          workspacePathRef.current = targetWorkspacePath

          if (!targetWorkspacePath) {
            throw new Error('Conversation workspace was not created.')
          }

          const nextState = await window.appApi.loadAgentWorkspace(targetWorkspacePath, null, { restoreSession: false })
          runtimeForSubmit = nextState.runtime
          setAgentState(nextState)
          setViewedSessionSnapshot(null)
          setHasLoadedWorkspaceState(true)
          const defaultDraft = getRuntimeDefaultModelDraft(nextState.runtime)
          const nextNewSessionDraft = normalizeAgentModelDraft(draftBeforeWorkspaceCreation, nextState.runtime, defaultDraft)
          syncNewSessionModelDraft(nextNewSessionDraft)
          syncModelDraft(nextNewSessionDraft)
        } finally {
          setIsLoading(false)
        }
      }

      if (!targetWorkspacePath) {
        throw new Error('Open a workspace before sending your prompt.')
      }

      let nextSessionPath = agentState.activeSession?.sessionPath ?? null

      if (activeSessionSelection.kind === 'new') {
        fallbackErrorMessage = 'Unable to create an agent session.'
        openSessionRequestIdRef.current += 1
        const nextDraft = normalizeAgentModelDraft(
          newSessionModelDraftRef.current,
          runtimeForSubmit,
          getRuntimeDefaultModelDraft(runtimeForSubmit),
        )
        syncNewSessionModelDraft(nextDraft)
        const draftModelKey = getAgentModelDraftKey(nextDraft)
        const nextState = await window.appApi.createAgentSession(targetWorkspacePath, {
          ...(draftModelKey && runtimeForSubmit.availableModels.includes(draftModelKey) ? { modelKey: draftModelKey } : {}),
          thinkingLevel: nextDraft.thinkingLevel,
        })
        setAgentState(nextState)
        setViewedSessionSnapshot(null)
        nextSessionPath = nextState.activeSession?.sessionPath ?? null
        syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
      } else {
        fallbackErrorMessage = 'Open a session before sending your prompt.'
        const activeState = await ensureSelectedAgentSessionActive()
        if (!activeState?.activeSession) {
          throw new Error('Open a session before sending your prompt.')
        }
        nextSessionPath = activeState.activeSession.sessionPath
      }

      fallbackErrorMessage = 'Unable to send your prompt.'
      const promptAttachments = submittedComposerAttachments.map(({ id: _id, ...attachment }) => attachment)
      await window.appApi.sendAgentPrompt(trimmedPrompt, streamingBehavior, promptAttachments)
      didSendPromptToAgent = true
      invalidateOptimisticComposerClear(optimisticClearId)
      if (nextSessionPath) {
        syncActiveSessionSelection({ kind: 'session', sessionPath: nextSessionPath })
      }
      const conversationId = createdConversation?.id
        ?? (activeWorkspaceContext.kind === 'conversation' ? activeWorkspaceContext.conversationId : null)
      if (conversationId) {
        const preview = formatConversationPreview(trimmedPrompt)
        try {
          await onConversationSessionStarted?.(conversationId, {
            agentSessionPath: nextSessionPath,
            lastMessagePreview: preview,
            ...(createdConversation ? { title: preview } : {}),
          })
        } catch (error) {
          setPanelError(error instanceof Error ? error.message : 'Unable to update the conversation index.')
        }
      }
      if (!streamingBehavior) {
        setDraftAssistant('')
        setLiveTools([])
      }
    } catch (error) {
      if (createdConversation && !didSendPromptToAgent) {
        void onConversationDraftFailed?.(createdConversation.id)
      }
      if (!didSendPromptToAgent) {
        restoreOptimisticallyClearedComposer(optimisticClearId, composerSnapshot)
      }
      setPanelError(error instanceof Error ? error.message : fallbackErrorMessage)
    } finally {
      isSubmittingComposerPromptRef.current = false
      setIsSubmittingComposerPrompt(false)
    }
  }

  async function handleQueuedMessageUpdate(update: AgentQueuedMessageUpdate) {
    try {
      setActiveComposerMenu(null)
      setPanelError(null)
      const nextState = await window.appApi.updateAgentQueuedMessage(update)
      setAgentState(nextState)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to update queued message.')
      throw error
    }
  }

  async function stopActivePrompt() {
    if (!workspacePath || !isViewingActiveRuntime || !agentState.runtime.isStreaming) {
      return
    }

    try {
      setActiveComposerMenu(null)
      setPanelError(null)
      const nextState = await window.appApi.abortAgentPrompt()
      setAgentState(nextState)
      setDraftAssistant('')
      setDraftThinking('')
      setIsThinkingStreaming(false)
      setLiveTools([])
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to stop the current run.')
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

      await submitComposerPrompt(runningPromptEnterBehavior)
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
        const streamingBehavior = getStreamingPromptBehaviorForShortcut(
          event,
          window.appApi.platform,
          runningPromptEnterBehavior,
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
    && !isSubmittingComposerPrompt
    && (
      (workspacePath && agentState.runtime.hasConfiguredModels)
      || (canUseComposerWithoutWorkspace && agentState.runtime.hasConfiguredModels)
    ),
  )
  const canStopActivePrompt = Boolean(
    workspacePath
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
  const streamingShortcutModifierLabel = window.appApi.platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter'
  const selectedModelInputs = composerModelKey && hasAvailableComposerModel
    ? agentState.runtime.availableModelInputs[composerModelKey] ?? ['text']
    : []
  const selectedModelSupportsImages = selectedModelInputs.includes('image')
  const hasImageComposerAttachments = composerAttachments.some((attachment) => attachment.kind === 'image')
  const attachmentCapabilityMessage = hasImageComposerAttachments && !selectedModelSupportsImages
    ? '当前模型不支持图片输入，图片不会作为视觉内容发送。'
    : null
  const statusMessage = !workspacePath
    ? (
        isConversationDraftContext
          ? null
          : activeWorkspaceContext.kind === 'conversation'
            ? '该对话的工作目录不可用。'
            : '打开工作区以开始。'
      )
    : !agentState.runtime.hasConfiguredModels
      ? (agentState.runtime.setupHint ?? 'Configure a model first.')
      : null
  const runningTools = liveTools.filter((tool) => tool.status === 'running')
  const sessionPhase = useMemo(() => deriveAgentSessionPhase({
    draftAssistant,
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
  const sessionStatusKey = sessionStatus
    ? `${sessionStatus.label}:${sessionStatus.badges?.map((badge) => `${badge.kind}:${badge.label}`).join('|') ?? ''}`
    : 'none'
  const fileChangesKey = [...roundFileChangesByMessageId.entries()]
    .flatMap(([messageId, changes]) => changes.map((change) => `${messageId}:${change.kind}:${change.filePath}`))
    .join('|')
  const renderedMessageCount = renderedMessages.length
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

  useLayoutEffect(() => {
    const scrollElement = messagesScrollRef.current
    if (!scrollElement) {
      return
    }

    const isSessionChanged = previousSessionPathRef.current !== activeSessionPath
    previousSessionPathRef.current = activeSessionPath

    const scrollToBottom = () => {
      scrollElement.scrollTop = scrollElement.scrollHeight
    }

    scrollToBottom()

    if (isSessionChanged) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      scrollToBottom()
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activeSessionPath, draftAssistant, draftThinking, fileChangesKey, liveTools, renderedMessageCount, sessionStatusKey])

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
    overlayPanelRef,
    panelError,
    projectSessions,
    projectState,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    removeComposerAttachment,
    sessionButtonRef,
    sessionStatus,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setPanelError,
    statusMessage,
    streamingShortcutModifierLabel,
    thinkingLevel,
    thinkingLevelLabel,
    workspacePath,
    workspaceTree,
  }), [
    activeWorkspaceContext,
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
    isLoading,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    liveTools,
    loadProjectSessions,
    modelInputValue,
    onConversationDraftFailed,
    onConversationSessionStarted,
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
    panelError,
    projectSessions,
    projectState,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    removeComposerAttachment,
    sessionStatus,
    statusMessage,
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

function AgentSessionTreeContextMenu({
  anchorRect,
  disabled,
  onDelete,
  onRename,
}: {
  anchorRect: AgentMenuAnchorRect
  disabled: boolean
  onDelete: () => void
  onRename: () => void
}) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className='agent-session-tree-menu agent-tree-context-menu'
      data-agent-tree-context-menu-root='true'
      style={resolveAgentTreeContextMenuStyle(
        anchorRect,
        AGENT_TREE_SESSION_CONTEXT_MENU_WIDTH_PX,
        AGENT_TREE_SESSION_CONTEXT_MENU_HEIGHT_PX,
      )}
    >
      <button
        type='button'
        className='agent-session-tree-menu-item'
        disabled={disabled}
        onClick={onRename}
      >
        <Edit2Line size={16} />
        <span>重命名</span>
      </button>
      <button
        type='button'
        className='agent-session-tree-menu-item is-danger'
        disabled={disabled}
        onClick={onDelete}
      >
        <Delete2Line size={16} />
        <span>删除</span>
      </button>
    </div>,
    document.body,
  )
}

function AgentSessionTreeRow({
  isActive,
  isDeleting,
  isRenaming,
  label,
  menuTitle = '对话菜单',
  nodeClassName,
  relativeTime,
  rowClassName,
  triggerClassName,
  onOpen,
  onOpenMenu,
  onCancelRename,
  onRename,
}: {
  isActive: boolean
  isDeleting: boolean
  isRenaming: boolean
  label: string
  menuTitle?: string
  nodeClassName?: string
  relativeTime?: string
  rowClassName?: string
  triggerClassName?: string
  onOpen: () => void
  onOpenMenu: (anchorRect: AgentMenuAnchorRect) => void
  onCancelRename: () => void
  onRename: (name: string) => Promise<void>
}) {
  const [draftName, setDraftName] = useState(label)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

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

  return (
    <li className={`panel-tree-node agent-project-session-node${nodeClassName ? ` ${nodeClassName}` : ''}`}>
      <div
        ref={rowRef}
        className={`workspace-tree-row agent-project-session-row${rowClassName ? ` ${rowClassName}` : ''}${isActive ? ' is-active' : ''}${isRenaming ? ' is-editing' : ''}`}
      >
        {isRenaming ? (
          <>
            <div
              className={`workspace-tree-trigger agent-project-session-trigger${triggerClassName ? ` ${triggerClassName}` : ''} agent-session-rename-trigger`}
              onClick={(event) => event.stopPropagation()}
            >
              <input
                ref={renameInputRef}
                aria-label='重命名对话'
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
            </div>
            <div className='git-change-tools agent-project-row-tools' onClick={(event) => event.stopPropagation()}>
              <div className='git-change-actions agent-session-rename-actions' style={{ opacity: 1, maxWidth: '4rem', transform: 'translateX(0)' }}>
                <button
                  type='button'
                  className='git-change-action git-change-icon-button agent-project-row-action'
                  aria-label='确认重命名'
                  disabled={isSubmitting}
                  onClick={() => void handleSubmitRename()}
                >
                  <CheckLine size={14} />
                </button>
                <button
                  type='button'
                  className='git-change-action git-change-icon-button agent-project-row-action'
                  aria-label='取消重命名'
                  disabled={isSubmitting}
                  onClick={onCancelRename}
                >
                  <CloseLine size={14} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <button
              type='button'
              className={`workspace-tree-trigger agent-project-session-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
              title={label}
              onClick={onOpen}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onOpenMenu(createAgentPointAnchorRect(event.clientX, event.clientY))
              }}
            >
              <span className='panel-tree-label agent-project-session-label'>{label}</span>
              {relativeTime ? <span className='agent-project-session-time'>{relativeTime}</span> : null}
            </button>

            <div className='git-change-tools agent-project-row-tools' onClick={(event) => event.stopPropagation()}>
              <div className='git-change-actions'>
                <button
                  type='button'
                  className='git-change-action git-change-icon-button agent-project-row-action'
                  aria-label={`打开 ${label} 菜单`}
                  title={menuTitle}
                  disabled={isDeleting}
                  onClick={(event) => {
                    onOpenMenu(event.currentTarget.getBoundingClientRect())
                  }}
                >
                  <More1Line size={16} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {error ? <p className='tree-item-error agent-session-rename-error'>{error}</p> : null}
    </li>
  )
}

function FlatAgentSessionTree({
  className,
  onRequestClose,
  id = 'agent-session-tree',
  isFloating,
}: AgentSessionTreeProps) {
  const {
    activeSessionSelection,
    activeSessionPath,
    agentState,
    deletingSessionPath,
    handleDeleteSession,
    handleOpenSession,
    handleRenameSession,
    handleStartNewSession,
    workspacePath,
  } = useAgentContext()
  const [sessionMenuState, setSessionMenuState] = useState<{ anchorRect: AgentMenuAnchorRect, session: AgentSessionListItem } | null>(null)
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionMenuState) {
      return
    }

    const closeMenu = () => {
      setSessionMenuState(null)
    }
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (isAgentTreeContextMenuEventTarget(event.target)) {
        return
      }

      closeMenu()
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [sessionMenuState])

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

      <AppScrollArea
        className='agent-session-tree-scroll'
        contentClassName='agent-session-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <ul id={id} className='panel-tree-list agent-project-list agent-flat-session-list' aria-label='Agent sessions'>
          {agentState.sessions.length === 0 ? (
            <li className='agent-project-session-status'>暂无对话</li>
          ) : agentState.sessions.map((session) => {
            const label = formatSessionLabel(session)
            const isActiveSession = activeSessionSelection.kind === 'session' && activeSessionPath === session.path

            return (
              <AgentSessionTreeRow
                key={session.path}
                isActive={isActiveSession}
                isDeleting={deletingSessionPath === session.path}
                isRenaming={renamingSessionPath === session.path}
                label={label}
                onCancelRename={() => setRenamingSessionPath(null)}
                onOpen={() => {
                  setRenamingSessionPath(null)
                  setSessionMenuState(null)
                  void handleOpenSession(session.path).then(() => {
                    onRequestClose?.()
                  })
                }}
                onOpenMenu={(anchorRect) => {
                  if (!workspacePath) {
                    return
                  }

                  setSessionMenuState({
                    anchorRect,
                    session,
                  })
                }}
                onRename={(name) => workspacePath
                  ? handleRenameSession(workspacePath, session.path, name)
                  : Promise.resolve()}
              />
            )
          })}
        </ul>
      </AppScrollArea>

      {sessionMenuState ? (
        <AgentSessionTreeContextMenu
          anchorRect={sessionMenuState.anchorRect}
          disabled={deletingSessionPath === sessionMenuState.session.path}
          onDelete={() => {
            const sessionPath = sessionMenuState.session.path
            setSessionMenuState(null)
            void handleDeleteSession(sessionPath)
          }}
          onRename={() => {
            const sessionPath = sessionMenuState.session.path
            setSessionMenuState(null)
            setRenamingSessionPath(sessionPath)
          }}
        />
      ) : null}
    </div>
  )
}

function AgentConversationRow({
  conversation,
  isDeleting,
  isRenaming,
  isActive,
  onOpen,
  onOpenMenu,
  onCancelRename,
  onRename,
}: {
  conversation: ConversationRecord
  isDeleting: boolean
  isRenaming: boolean
  isActive: boolean
  onOpen: () => void
  onOpenMenu: (anchorRect: AgentMenuAnchorRect) => void
  onCancelRename: () => void
  onRename: (name: string) => Promise<void>
}) {
  const relativeTime = formatAgentSessionRelativeTime(conversation.updatedAt)

  return (
    <AgentSessionTreeRow
      isActive={isActive}
      isDeleting={isDeleting}
      isRenaming={isRenaming}
      label={conversation.title}
      menuTitle='对话菜单'
      nodeClassName='agent-conversation-node'
      relativeTime={relativeTime}
      rowClassName='agent-conversation-row'
      triggerClassName='agent-conversation-trigger'
      onCancelRename={onCancelRename}
      onOpen={onOpen}
      onOpenMenu={onOpenMenu}
      onRename={onRename}
    />
  )
}

function AgentProjectTree({
  className,
  onRequestClose,
  isFloating,
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
    workspacePath,
    iconTheme,
  } = useAgentContext()
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set())
  const [isProjectSectionExpanded, setIsProjectSectionExpanded] = useState(true)
  const [isConversationSectionExpanded, setIsConversationSectionExpanded] = useState(true)
  const [projectMenuState, setProjectMenuState] = useState<{ anchorRect: AgentMenuAnchorRect, project: ProjectRecord } | null>(null)
  const [sessionMenuState, setSessionMenuState] = useState<{ anchorRect: AgentMenuAnchorRect, session: AgentSessionListItem } | null>(null)
  const [conversationMenuState, setConversationMenuState] = useState<{ anchorRect: AgentMenuAnchorRect, conversation: ConversationRecord } | null>(null)
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null)
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
  const activeSessionProjectId = useMemo(() => {
    if (activeSessionSelection.kind !== 'session' || !activeSessionPath) {
      return null
    }

    for (const [projectId, bucket] of Object.entries(projectSessions)) {
      if (bucket.sessions.some((session) => session.path === activeSessionPath)) {
        return projectId
      }
    }

    return null
  }, [activeSessionPath, activeSessionSelection.kind, projectSessions])
  const visibleConversations = useMemo(() => (
    conversationState.conversations
      .filter((conversation) => conversation.status === 'active')
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  ), [conversationState.conversations])
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

  function startPrimaryNewConversation() {
    setProjectMenuState(null)
    setSessionMenuState(null)
    setConversationMenuState(null)
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

  useEffect(() => {
    if (!projectMenuState && !sessionMenuState && !conversationMenuState) {
      return
    }

    const closeMenus = () => {
      setProjectMenuState(null)
      setSessionMenuState(null)
      setConversationMenuState(null)
    }
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (isAgentTreeContextMenuEventTarget(event.target)) {
        return
      }

      closeMenus()
    }
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenus()
      }
    }

    window.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('resize', closeMenus)
    window.addEventListener('scroll', closeMenus, true)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('resize', closeMenus)
      window.removeEventListener('scroll', closeMenus, true)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [conversationMenuState, projectMenuState, sessionMenuState])

  function toggleProjectSection() {
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    setProjectMenuState(null)
    setSessionMenuState(null)
    setConversationMenuState(null)
    setIsProjectSectionExpanded((currentValue) => !currentValue)
  }

  function toggleConversationSection() {
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    setProjectMenuState(null)
    setSessionMenuState(null)
    setConversationMenuState(null)
    setIsConversationSectionExpanded((currentValue) => !currentValue)
  }

  function toggleProject(project: ProjectRecord) {
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    setProjectMenuState(null)
    setSessionMenuState(null)
    setConversationMenuState(null)
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
        <button
          type='button'
          className='agent-session-new-button'
          aria-label='Start new conversation'
          aria-keyshortcuts='Control+Alt+N'
          title='新对话 Ctrl+Alt+N'
          onClick={() => {
            startPrimaryNewConversation()
          }}
        >
          <EditLine size={16} />
          <span>新对话</span>
        </button>
      ) : null}

      {!isFloating ? (
        <div className={`agent-project-tree-header${isProjectSectionExpanded ? '' : ' is-collapsed'}`}>
          <button
            type='button'
            className='agent-project-tree-header-toggle'
            aria-expanded={isProjectSectionExpanded}
            onClick={toggleProjectSection}
          >
            <span>项目</span>
            {isProjectSectionExpanded ? (
              <DownLine className='agent-project-tree-header-chevron' size={15} aria-hidden='true' />
            ) : (
              <RightLine className='agent-project-tree-header-chevron' size={15} aria-hidden='true' />
            )}
          </button>
          <button
            type='button'
            className='agent-project-tree-header-action'
            aria-label='添加项目'
            title='添加项目'
            onClick={(event) => {
              onOpenProjectAddMenu?.(event.currentTarget.getBoundingClientRect())
            }}
          >
            <AddLine size={15} />
          </button>
        </div>
      ) : null}

      <AppScrollArea
        className='agent-session-tree-scroll agent-project-tree-scroll'
        contentClassName='agent-session-tree-scroll-content agent-project-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <ul className='panel-tree-list agent-project-list' aria-label='项目与对话'>
          {isProjectSectionExpanded ? projectState.projects.map((project) => {
            const bucket = projectSessions[project.id]
            const isExpanded = expandedProjectIds.has(project.id)
            const sessions = bucket?.sessions ?? []
            const showChildren = isExpanded && (
              sessions.length > 0
              || Boolean(bucket?.isLoading)
              || Boolean(bucket?.error)
              || Boolean(bucket?.hasLoaded)
            )

            return (
              <li key={project.id} className='panel-tree-node agent-project-node'>
                <div className='workspace-tree-row agent-project-row'>
                  <button
                    type='button'
                    className='workspace-tree-trigger agent-project-row-trigger'
                    aria-expanded={isExpanded}
                    title={project.path}
                    onClick={() => toggleProject(project)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setConversationMenuState(null)
                      setSessionMenuState(null)
                      setProjectMenuState({
                        anchorRect: createAgentPointAnchorRect(event.clientX, event.clientY),
                        project,
                      })
                    }}
                  >
                    <WorkspaceFileIcon
                      iconTheme={iconTheme ?? null}
                      isClosed={!isExpanded}
                      isFolder
                      nodeLabel={project.name}
                    />
                    <span className='panel-tree-label agent-project-row-label'>{project.name}</span>
                  </button>

                  <div className='git-change-tools agent-project-row-tools' onClick={(event) => event.stopPropagation()}>
                    <div className='git-change-actions'>
                      <button
                        type='button'
                        className='git-change-action git-change-icon-button agent-project-row-action'
                        aria-label={`在 ${project.name} 中开始新对话`}
                        title='开始新对话'
                        onClick={() => {
                          setProjectMenuState(null)
                          setSessionMenuState(null)
                          setConversationMenuState(null)
                          setRenamingConversationId(null)
                          void onStartProjectSession?.(project)
                          onRequestClose?.()
                        }}
                      >
                        <EditLine size={16} />
                      </button>
                      <button
                        type='button'
                        className='git-change-action git-change-icon-button agent-project-row-action'
                        aria-label={`打开 ${project.name} 菜单`}
                        title='项目菜单'
                        onClick={(event) => {
                          setConversationMenuState(null)
                          setSessionMenuState(null)
                          setProjectMenuState({
                            anchorRect: event.currentTarget.getBoundingClientRect(),
                            project,
                          })
                        }}
                      >
                        <More1Line size={16} />
                      </button>
                    </div>
                  </div>
                </div>

                {showChildren ? (
                  <div className='panel-tree-children agent-project-session-children'>
                    <ul className='panel-tree-list agent-project-session-list'>
                      {bucket?.isLoading ? <li className='agent-project-session-status'>加载中</li> : null}
                      {bucket?.error ? <li className='agent-project-session-status is-error'>无法加载对话</li> : null}
                      {!bucket?.isLoading && !bucket?.error && bucket?.hasLoaded && sessions.length === 0 ? (
                        <li className='agent-project-session-status'>暂无对话</li>
                      ) : null}
                      {sessions.map((session) => {
                        const isActiveSession = activeSessionSelection.kind === 'session' && activeSessionPath === session.path
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
                            key={session.path}
                            isActive={isActiveSession}
                            isDeleting={deletingSessionPath === session.path}
                            isRenaming={renamingSessionPath === session.path}
                            label={label}
                            onCancelRename={() => setRenamingSessionPath(null)}
                            relativeTime={relativeTime}
                            onOpen={() => {
                              setRenamingSessionPath(null)
                              setRenamingConversationId(null)
                              setProjectMenuState(null)
                              setSessionMenuState(null)
                              setConversationMenuState(null)
                              const openSession = isCurrentActiveProject
                                ? handleOpenSession(session.path)
                                : onOpenProjectSession?.(project, session.path)
                              void Promise.resolve(openSession).then(() => {
                                onRequestClose?.()
                              })
                            }}
                            onOpenMenu={(anchorRect) => {
                              setProjectMenuState(null)
                              setConversationMenuState(null)
                              setSessionMenuState({
                                anchorRect,
                                session,
                              })
                            }}
                            onRename={(name) => handleRenameSession(project.path, session.path, name)}
                          />
                        )
                      })}
                    </ul>
                  </div>
                ) : null}
              </li>
            )
          }) : null}
          <li className={`agent-project-tree-section agent-conversation-section${isConversationSectionExpanded ? '' : ' is-collapsed'}`}>
            <div className={`agent-project-tree-header agent-conversation-tree-header${isConversationSectionExpanded ? '' : ' is-collapsed'}`}>
              <button
                type='button'
                className='agent-project-tree-header-toggle'
                aria-expanded={isConversationSectionExpanded}
                onClick={toggleConversationSection}
              >
                <span>对话</span>
                {isConversationSectionExpanded ? (
                  <DownLine className='agent-project-tree-header-chevron' size={15} aria-hidden='true' />
                ) : (
                  <RightLine className='agent-project-tree-header-chevron' size={15} aria-hidden='true' />
                )}
              </button>
              <button
                type='button'
                className='agent-project-tree-header-action'
                aria-label='新对话'
                aria-keyshortcuts='Control+Alt+N'
                title='新对话 Ctrl+Alt+N'
                onClick={() => {
                  setProjectMenuState(null)
                  setSessionMenuState(null)
                  setConversationMenuState(null)
                  setRenamingConversationId(null)
                  void onStartStandaloneConversation?.()
                  onRequestClose?.()
                }}
              >
                <EditLine size={15} />
              </button>
            </div>
            {isConversationSectionExpanded ? (
              <ul className='panel-tree-list agent-project-session-list agent-conversation-list'>
                {visibleConversations.length === 0 ? (
                  <li className='agent-project-session-status'>暂无对话</li>
                ) : visibleConversations.map((conversation) => (
                  <AgentConversationRow
                    key={conversation.id}
                    conversation={conversation}
                    isDeleting={deletingConversationId === conversation.id}
                    isRenaming={renamingConversationId === conversation.id}
                    isActive={activeWorkspaceContext.kind === 'conversation' && activeWorkspaceContext.conversationId === conversation.id}
                    onCancelRename={() => setRenamingConversationId(null)}
                    onOpen={() => {
                      setRenamingSessionPath(null)
                      setRenamingConversationId(null)
                      setProjectMenuState(null)
                      setSessionMenuState(null)
                      setConversationMenuState(null)
                      void Promise.resolve(onOpenConversation?.(conversation)).then(() => {
                        onRequestClose?.()
                      })
                    }}
                    onOpenMenu={(anchorRect) => {
                      setProjectMenuState(null)
                      setSessionMenuState(null)
                      setConversationMenuState({
                        anchorRect,
                        conversation,
                      })
                    }}
                    onRename={(title) => Promise.resolve(onRenameConversation?.(conversation, title))}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        </ul>
      </AppScrollArea>

      {sessionMenuState ? (
        <AgentSessionTreeContextMenu
          anchorRect={sessionMenuState.anchorRect}
          disabled={deletingSessionPath === sessionMenuState.session.path}
          onDelete={() => {
            const sessionPath = sessionMenuState.session.path
            setSessionMenuState(null)
            void handleDeleteSession(sessionPath)
          }}
          onRename={() => {
            const sessionPath = sessionMenuState.session.path
            setSessionMenuState(null)
            setRenamingSessionPath(sessionPath)
          }}
        />
      ) : null}

      {conversationMenuState ? (
        <AgentSessionTreeContextMenu
          anchorRect={conversationMenuState.anchorRect}
          disabled={deletingConversationId === conversationMenuState.conversation.id}
          onDelete={() => {
            const conversation = conversationMenuState.conversation
            setConversationMenuState(null)
            setDeletingConversationId(conversation.id)
            void Promise.resolve(onRemoveConversation?.(conversation)).finally(() => {
              setDeletingConversationId((currentId) => (
                currentId === conversation.id ? null : currentId
              ))
            })
          }}
          onRename={() => {
            const conversationId = conversationMenuState.conversation.id
            setConversationMenuState(null)
            setRenamingConversationId(conversationId)
          }}
        />
      ) : null}

      {projectMenuState ? createPortal(
        <div
          className='agent-project-menu agent-tree-context-menu'
          data-agent-tree-context-menu-root='true'
          role='menu'
          style={resolveAgentTreeContextMenuStyle(
            projectMenuState.anchorRect,
            AGENT_TREE_PROJECT_CONTEXT_MENU_WIDTH_PX,
            AGENT_TREE_PROJECT_CONTEXT_MENU_HEIGHT_PX,
          )}
        >
          <button
            type='button'
            role='menuitem'
            className='agent-project-menu-item'
            onClick={() => {
              const project = projectMenuState.project
              setProjectMenuState(null)
              void onOpenProjectFolder?.(project)
            }}
          >
            <ExternalLinkLine size={16} />
            <span>在“{getSystemFileManagerName(window.appApi.platform)}”中打开</span>
          </button>
          <button
            type='button'
            role='menuitem'
            className='agent-project-menu-item is-danger'
            onClick={() => {
              const project = projectMenuState.project
              setProjectMenuState(null)
              void onRemoveProject?.(project)
            }}
          >
            <Delete2Line size={16} />
            <span>移除</span>
          </button>
        </div>,
        document.body,
      ) : null}
    </div>
  )
}

function AgentSessionTree(props: AgentSessionTreeProps) {
  return props.isFloating ? <FlatAgentSessionTree {...props} /> : <AgentProjectTree {...props} />
}

function AgentBrandLogo() {
  return (
    <div className='agent-brand-logo' aria-hidden='true'>
      <img className='agent-empty-logo' src='./branding/logo.svg' alt='' />
    </div>
  )
}

function AgentNewSessionIllustration() {
  return <AgentBrandLogo />
}

function AgentProjectSwitchTrigger({
  activeProject,
  className,
  iconTheme,
  onOpenProjectSwitchMenu,
  placeholder,
}: {
  activeProject: ProjectRecord | null
  className?: string
  iconTheme?: WorkspaceIconTheme | null
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  placeholder?: string
}) {
  const label = activeProject?.name ?? placeholder ?? '未选择项目'
  const isEnabled = Boolean(onOpenProjectSwitchMenu && (activeProject || placeholder))

  return (
    <button
      type='button'
      className={[
        'agent-project-switch-trigger',
        className,
      ].filter(Boolean).join(' ')}
      disabled={!isEnabled}
      aria-label={activeProject ? `切换项目，当前项目：${activeProject.name}` : label}
      title={activeProject ? `当前项目：${activeProject.name}` : label}
      onClick={(event) => {
        onOpenProjectSwitchMenu?.(event.currentTarget.getBoundingClientRect(), { startNewSession: true })
      }}
    >
      <WorkspaceFileIcon
        iconTheme={iconTheme ?? null}
        isFolder
        isClosed
        nodeLabel={activeProject?.name}
      />
      <span className='agent-project-switch-trigger-label'>{label}</span>
      <DownLine aria-hidden='true' size={14} />
    </button>
  )
}

function AgentEmptyChat() {
  const { activeSessionSelection, activeWorkspaceContext, iconTheme, onOpenProjectSwitchMenu, projectState, workspacePath } = useAgentContext()
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    : null
  const isNewConversation = activeSessionSelection.kind === 'new'
  const isStandaloneConversation = activeWorkspaceContext.kind !== 'project'

  return (
    <div className='agent-empty-chat'>
      <AgentNewSessionIllustration />
      <h2>
        {isStandaloneConversation ? (
          '今天要处理些什么？'
        ) : isNewConversation && activeProject ? (
          <>
            <span>今天在</span>
            <AgentProjectSwitchTrigger
              activeProject={activeProject}
              iconTheme={iconTheme}
              onOpenProjectSwitchMenu={onOpenProjectSwitchMenu}
            />
            <span>里处理什么？</span>
          </>
        ) : (
          '新对话'
        )}
      </h2>
      {((!workspacePath && !isStandaloneConversation) || !isNewConversation) ? (
        <p className='agent-empty-subtitle'>
          {workspacePath ? '在下方消息框中输入您的请求以开始对话' : '打开一个文件夹即可开始协同开发'}
        </p>
      ) : null}
    </div>
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
    overlayPanelRef,
    panelError,
    projectState,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    removeComposerAttachment,
    sessionButtonRef,
    sessionStatus,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setPanelError,
    statusMessage,
    streamingShortcutModifierLabel,
    thinkingLevel,
    thinkingLevelLabel,
    workspacePath,
    workspaceTree,
  } = useAgentContext()
  const hasEmptyChat = Boolean(workspacePath && renderedMessages.length === 0)
  const isNewConversation = activeSessionSelection.kind === 'new'
  const canOpenSessionMenu = Boolean(workspacePath && activeWorkspaceContext.kind === 'project')
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    : null
  const isViewingActiveRuntime = Boolean(
    activeSessionPath
    && agentState.activeSession?.sessionPath === activeSessionPath,
  )
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelPickerProvider, setModelPickerProvider] = useState(resolvedSelectedProviderValue)
  const [modelPickerActiveModelKey, setModelPickerActiveModelKey] = useState<string | null>(null)
  const [modelPickerActiveThinkingLevel, setModelPickerActiveThinkingLevel] = useState<AgentThinkingLevel | null>(null)
  const [modelPickerKeyboardColumn, setModelPickerKeyboardColumn] = useState<AgentModelPickerKeyboardColumn>('model')
  const modelPickerSearchRef = useRef<HTMLInputElement | null>(null)
  const modelPickerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const modelPickerPointerTrailRef = useRef<AgentModelPickerPointerPoint[]>([])
  const modelPickerLatestPointerPointRef = useRef<AgentModelPickerPointerPoint | null>(null)
  const modelPickerPendingActivationRef = useRef<AgentModelPickerPendingActivation | null>(null)
  const modelPickerActivationVersionRef = useRef(0)
  const [modelCascaderStyle, setModelCascaderStyle] = useState<AgentModelCascaderStyle>({})
  const [sessionMenuStyle, setSessionMenuStyle] = useState<AgentSessionMenuStyle>({})
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

  const updateSessionMenuPosition = useCallback(() => {
    const triggerElement = sessionButtonRef.current
    if (!triggerElement) {
      return
    }

    const nextStyle = resolveAgentSessionMenuStyle(triggerElement.getBoundingClientRect())
    setSessionMenuStyle((currentStyle) => (
      areAgentSessionMenuStylesEqual(currentStyle, nextStyle) ? currentStyle : nextStyle
    ))
  }, [sessionButtonRef])

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

  function toggleSessionMenu() {
    if (!canOpenSessionMenu) {
      setActiveOverlayPanel(null)
      return
    }

    if (activeOverlayPanel === 'sessions') {
      setActiveOverlayPanel(null)
      return
    }

    updateSessionMenuPosition()
    setActiveOverlayPanel('sessions')
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

  useLayoutEffect(() => {
    if (activeOverlayPanel !== 'sessions') {
      return
    }

    updateSessionMenuPosition()

    const frameId = window.requestAnimationFrame(updateSessionMenuPosition)
    window.addEventListener('resize', updateSessionMenuPosition)
    window.addEventListener('scroll', updateSessionMenuPosition, true)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updateSessionMenuPosition)
      window.removeEventListener('scroll', updateSessionMenuPosition, true)
    }
  }, [activeOverlayPanel, updateSessionMenuPosition])

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
      ? `Enter ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[runningPromptEnterBehavior]}，${streamingShortcutModifierLabel} ${AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[getAlternateRunningPromptBehavior(runningPromptEnterBehavior)]}`
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
          <AgentAttachmentItem
            key={attachment.id}
            attachment={attachment}
            iconTheme={iconTheme}
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
      messages={queuedComposerMessages}
      onUpdate={handleQueuedMessageUpdate}
    />
  ) : null
  const composerHeaderContent = composerQueuedTray || composerHeader ? (
    <>
      {composerQueuedTray}
      {composerHeader}
    </>
  ) : null
  const projectSwitchBar = isNewConversation && activeWorkspaceContext.kind !== 'conversation' ? (
    <div className='agent-new-project-bar'>
      <AgentProjectSwitchTrigger
        activeProject={activeWorkspaceContext.kind === 'project' ? activeProject : null}
        iconTheme={iconTheme}
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
            <button
              ref={modelPickerTriggerRef}
              type='button'
              aria-expanded={activeComposerMenu === 'model-cascader'}
              aria-controls='agent-model-cascader'
              aria-haspopup='dialog'
              aria-label={modelPickerTriggerTitle}
              className='agent-model-cascader-trigger'
              disabled={
                (!workspacePath && !canUseDraftRuntimeWithoutWorkspace)
                || !agentState.runtime.hasConfiguredModels
                || isSwitchingModel
                || isSwitchingThinkingLevel
              }
              title={modelPickerTriggerTitle}
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
            </button>
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
          <button
            type='button'
            aria-label='附加文件'
            className='agent-composer-attach-button'
            disabled={(!workspacePath && !canUseComposerWithoutWorkspace) || isLoading}
            title='附加文件'
            onClick={() => {
              void handlePickComposerAttachments()
            }}
          >
            <AttachmentLine aria-hidden='true' size={16} />
          </button>

          <span title={composerActionTitle}>
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
                <StopFill size={15} />
              ) : (
                <ArrowUpLine size={16} />
              )}
            </Button>
          </span>
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
              <button
                type='button'
                className='agent-model-cascader-search-clear'
                aria-label='Clear model search'
                title='Clear search'
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
              </button>
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
      <div className={`agent-composer-shell${isNewConversation ? ' has-project-bar' : ''}`}>
        <AgentComposerMentionInput
          aria-label='Prompt Pi Agent'
          disabled={(!workspacePath && !canUseComposerWithoutWorkspace) || isLoading}
          iconTheme={iconTheme}
          mentions={composerState.mentions}
          onChange={setComposerState}
          onFilesPastedOrDropped={(files) => {
            void addComposerFiles(files)
          }}
          onSubmitShortcut={handleComposerKeyDown}
          placeholder={workspacePath ? '发送消息，输入 @ 来提及文件...' : '发送消息...'}
          value={composerState.value}
          workspaceNodes={workspaceTree}
          workspacePath={workspacePath}
          header={composerHeaderContent}
          footer={composerFooter}
        />
        {projectSwitchBar}
      </div>
    </form>
  )

  return (
    <div className={`agent-shell${isNewConversation ? ' is-new-conversation' : ''}`}>
      <div className='agent-threadbar'>
        <div className='agent-threadbar-leading'>
          <div className='agent-session-select'>
            {canOpenSessionMenu ? (
              <button
                ref={sessionButtonRef}
                type='button'
                aria-controls='agent-session-tree-floating-panel'
                aria-expanded={activeOverlayPanel === 'sessions'}
                aria-haspopup='dialog'
                className={`agent-session-trigger ${activeOverlayPanel === 'sessions' ? 'is-open' : ''}`}
                onClick={toggleSessionMenu}
              >
                <span className='agent-select-current'>
                  {isNewConversation ? '新对话' : formatSessionLabel(activeSession)}
                </span>
                <DownLine aria-hidden='true' className='agent-session-trigger-arrow' size={14} />
              </button>
            ) : (
              <span className='agent-session-static-label'>
                <span className='agent-select-current'>
                  {isNewConversation ? '新对话' : formatSessionLabel(activeSession)}
                </span>
              </span>
            )}
          </div>

          {!isNewConversation ? (
            <button
              type='button'
              disabled={!workspacePath}
              className='agent-toolbar-button'
              aria-label='Start new conversation'
              onClick={() => {
                if (activeWorkspaceContext.kind === 'project') {
                  handleStartNewSession()
                  return
                }

                void onStartStandaloneConversation?.()
              }}
            >
              <EditLine size={16} />
            </button>
          ) : null}
        </div>

        <div className='agent-threadbar-drag-spacer' aria-hidden='true' />
      </div>

      {canOpenSessionMenu && activeOverlayPanel === 'sessions' && typeof document !== 'undefined' ? createPortal(
        <div
          ref={overlayPanelRef}
          id='agent-session-tree-floating-panel'
          className='agent-floating-panel'
          role='dialog'
          aria-label='Select conversation'
          style={sessionMenuStyle}
        >
          <AgentSessionTree
            className='agent-session-tree-floating'
            id='agent-session-tree-floating'
            isFloating
            onRequestClose={() => {
              setActiveOverlayPanel(null)
            }}
          />
        </div>,
        document.body,
      ) : null}

      {isNewConversation ? (
        <>
          <div className='agent-new-conversation-stage'>
            {statusMessage ? (
              <div className='agent-status-inline'>
                <p>{statusMessage}</p>
              </div>
            ) : null}
            <div className='agent-new-conversation-content'>
              <AgentEmptyChat />
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

          <AppScrollArea
            className='agent-messages-scroll'
            contentClassName='agent-messages-scroll-content'
            viewportRef={messagesScrollRef}
          >
            <div className={`agent-messages${hasEmptyChat ? ' agent-messages-empty' : ''}`}>
              {hasEmptyChat ? (
                <AgentEmptyChat />
              ) : renderedMessages.map((message) => {
                const fileChanges = roundFileChangesByMessageId.get(message.id) ?? []

                return (
                  <div key={message.id} className='agent-message-stack'>
                    <AgentMessageBubble
                      iconTheme={iconTheme}
                      message={message}
                      onOpenWorkspaceFile={(filePath) => {
                        void onOpenMessageFile?.(filePath, 'updated')
                      }}
                      workspacePath={workspacePath}
                    />
                    {fileChanges.length > 0 ? (
                      <AgentMessageFileChips
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
            </div>
          </AppScrollArea>

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

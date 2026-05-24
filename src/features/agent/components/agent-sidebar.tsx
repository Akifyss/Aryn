import {
  type CSSProperties,
  createContext,
  FormEvent,
  KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { FileTreeRowDecorationRenderer } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { Button, Chip, Disclosure } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  AiLine,
  AddLine,
  ArrowUpLine,
  BrainLine,
  CodeLine,
  Delete2Line,
  EyeglassLine,
  Pencil2Line,
  RightLine,
  SearchLine,
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
import type { ComposerMentionToken } from '@/features/agent/lib/composer-mentions'
import { resolveWorkspaceMessageLink } from '@/features/agent/lib/message-links'
import { serializeComposerText } from '@/features/agent/lib/composer-mentions'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  findLatestOpenableAgentFileChange,
  initialAgentFileAutoOpenState,
  resolveNextAgentFileAutoOpen,
  type AgentFileAutoOpenState,
} from '@/features/agent/auto-open-file'
import { buildRoundFileChangesByMessageId } from '@/features/agent/round-file-changes'
import type {
  AgentClientEvent,
  AgentMessageFileChange,
  AgentSessionListItem,
  AgentSessionAnnotations,
  AgentSidebarMessage,
  AgentSidebarMessageStatus,
  AgentThinkingLevel,
  AgentWorkspaceState,
} from '@/features/agent/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'

type AgentSidebarProps = {
  iconTheme?: WorkspaceIconTheme | null
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenProviderSettings?: () => void
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
  workspacePath: string | null
}

type AgentSurfaceProps = {
  iconTheme?: WorkspaceIconTheme | null
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenProviderSettings?: () => void
  workspacePath: string | null
}

type AgentSessionTreeProps = {
  className?: string
  onRequestClose?: () => void
  id?: string
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

type AgentComposerMenu = 'model-cascader' | null

type AgentModelPickerOption = {
  key: string
  modelId: string
  provider: string
  thinkingLevels: AgentThinkingLevel[]
}
type AgentModelPickerKeyboardColumn = 'provider' | 'model' | 'thinking'

type AgentModelCascaderStyle = CSSProperties & {
  '--agent-model-cascader-grid-height'?: string
  '--agent-model-cascader-provider-width'?: string
  '--agent-model-cascader-thinking-width'?: string
}

type AgentModelCascaderLayoutMetrics = {
  panelWidth: number
  providerColumnWidth: number
  thinkingColumnWidth: number
}

type AgentModelPickerPointerPoint = {
  x: number
  y: number
}

type AgentModelPickerSafeTriangle = {
  modelKey: string
  origin: AgentModelPickerPointerPoint
}

type AgentSessionSelection = { kind: 'new' } | { kind: 'session', sessionPath: string }

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
const AGENT_MODEL_CASCADER_MIN_WIDTH_PX = 340
const AGENT_MODEL_CASCADER_PROVIDER_MIN_WIDTH_PX = 132
const AGENT_MODEL_CASCADER_PROVIDER_MAX_WIDTH_PX = 190
const AGENT_MODEL_CASCADER_MODEL_MIN_WIDTH_PX = 176
const AGENT_MODEL_CASCADER_MODEL_MAX_WIDTH_PX = 400
const AGENT_MODEL_CASCADER_THINKING_WIDTH_PX = 128

const emptyAgentState: AgentWorkspaceState = {
  activeSession: null,
  runtime: {
    auth: {},
    availableModels: [],
    availableThinkingLevels: ['off'],
    availableThinkingLevelsByModel: {},
    compactionReason: null,
    followUpMessageCount: 0,
    followUpMode: 'one-at-a-time',
    hasConfiguredModels: false,
    isCompacting: false,
    isStreaming: false,
    pendingMessageCount: 0,
    preferredModelByProvider: {},
    retryAttempt: 0,
    retryMaxAttempts: null,
    selectedModel: null,
    setupHint: null,
    supportsThinking: false,
    steeringMessageCount: 0,
    steeringMode: 'one-at-a-time',
    thinkingLevel: 'off',
    workspacePath: null,
  },
  sessions: [],
}

const emptyComposerState: ComposerState = {
  mentions: [],
  value: '',
}

const AGENT_SESSION_TREE_EMPTY_PATH = 'No sessions'

const AGENT_SESSION_TREE_CSS = `
  :host {
    --trees-fg-override: var(--muted);
    --trees-fg-muted-override: var(--muted);
    --trees-bg-override: transparent;
    --trees-bg-muted-override: var(--surface-tertiary);
    --trees-accent-override: var(--accent);
    --trees-border-color-override: var(--separator);
    --trees-selected-fg-override: var(--foreground);
    --trees-selected-bg-override: var(--surface-tertiary);
    --trees-selected-focused-border-color-override: transparent;
    --trees-focus-ring-color-override: var(--focus);
    --trees-font-family-override: inherit;
    --trees-font-size-override: 13px;
    --trees-font-weight-regular-override: 500;
    --trees-font-weight-semibold-override: 600;
    --trees-padding-inline-override: 0px;
    --trees-item-padding-x-override: 10px;
    --trees-item-margin-x-override: 0px;
    --trees-level-gap-override: 0px;
    --trees-icon-width-override: 14px;
    --trees-action-lane-width-override: 28px;
    --trees-context-menu-trigger-inline-offset: 12px;
    --trees-scrollbar-gutter-override: 0px;
    background: transparent;
  }

  [data-item-section='spacing'] {
    display: none;
  }

  [data-item-section='icon'] {
    display: none;
  }

  button[data-type='item'] {
    border-radius: 8px;
    color: var(--muted);
    transition: background-color 140ms ease, color 140ms ease;
  }

  button[data-type='item']:hover,
  button[data-type='item'][data-item-selected] {
    color: var(--foreground);
    background: var(--surface-tertiary);
  }

  /* @pierre/trees marks clicked rows as focused; keep pointer focus quiet while preserving keyboard focus. */
  button[data-type='item'][data-item-focused='true']::before {
    outline-color: transparent;
  }

  button[data-type='item']:focus-visible::before {
    outline-color: var(--trees-focus-ring-color);
  }

  /* Agent sessions are conversation titles, not paths: render them through the public decoration lane. */
  [data-item-section='content'] {
    display: none;
  }

  [data-item-section='decoration'] {
    flex: 1 1 auto;
    justify-content: flex-start;
    color: inherit;
    text-align: start;
  }

  [data-item-section='decoration'] > span {
    display: block;
    width: 100%;
    justify-content: flex-start;
    color: inherit;
    text-align: start;
  }

  button[data-type='item'] > [data-item-section='action'] {
    width: 0;
    overflow: hidden;
  }

  button[data-type='item'][data-item-context-hover='true'] > [data-item-section='action'] {
    width: var(--trees-action-lane-width);
  }

  /* "when-needed" includes focus in @pierre/trees; this surface wants hover/open only. */
  [data-type='context-menu-anchor'][data-visible='true'] {
    display: none;
  }

  [data-file-tree-virtualized-root='true']:has(button[data-type='item'][data-item-context-hover='true'])
    > [data-type='context-menu-anchor'][data-visible='true'],
  [data-type='context-menu-anchor'][data-visible='true']:has([data-type='context-menu-trigger'][aria-expanded='true']) {
    display: flex;
  }

  button[data-type='item'][data-item-path='${AGENT_SESSION_TREE_EMPTY_PATH}'] {
    opacity: 0.65;
    pointer-events: none;
  }

`

const renderAgentSessionTreeRowDecoration: FileTreeRowDecorationRenderer = ({ row }) => ({
  text: row.name,
  title: row.name,
})

type AgentContextValue = {
  activeComposerMenu: AgentComposerMenu
  activeOverlayPanel: 'sessions' | null
  activeSession: AgentWorkspaceState['sessions'][number] | null
  activeSessionSelection: AgentSessionSelection
  activeSessionPath: string | null
  agentState: AgentWorkspaceState
  canSend: boolean
  composerHeight: number
  composerResizeStateRef: React.MutableRefObject<{ pointerId: number, startHeight: number, startY: number } | null>
  composerState: ComposerState
  configuredProviders: string[]
  deletingSessionPath: string | null
  handleComposerKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  handleCreateSession: () => Promise<void>
  handleDeleteSession: (sessionPath: string) => Promise<void>
  handleOpenSession: (sessionPath: string) => Promise<void>
  handleSelectModel: (modelKey: string) => Promise<void>
  handleThinkingLevelSelection: (level: AgentThinkingLevel, modelKey?: string) => Promise<void>
  handleStartNewSession: () => void
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  hasConfiguredProviders: boolean
  iconTheme?: WorkspaceIconTheme | null
  isCreatingSession: boolean
  isLoading: boolean
  isResizingComposer: boolean
  isSwitchingModel: boolean
  isSwitchingThinkingLevel: boolean
  liveTools: LiveToolState[]
  messagesScrollRef: React.RefObject<HTMLDivElement | null>
  modelFieldRef: React.RefObject<HTMLDivElement | null>
  modelInputValue: string
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenProviderSettings?: () => void
  overlayPanelRef: React.RefObject<HTMLDivElement | null>
  panelError: string | null
  renderedMessages: AgentSidebarMessage[]
  resolvedSelectedProviderValue: string
  roundFileChangesByMessageId: Map<string, AgentMessageFileChange[]>
  sessionButtonRef: React.RefObject<HTMLButtonElement | null>
  sessionStatus: AgentSessionStatus | null
  setActiveComposerMenu: React.Dispatch<React.SetStateAction<AgentComposerMenu>>
  setActiveOverlayPanel: React.Dispatch<React.SetStateAction<'sessions' | null>>
  setComposerState: React.Dispatch<React.SetStateAction<ComposerState>>
  setIsResizingComposer: React.Dispatch<React.SetStateAction<boolean>>
  setPanelError: React.Dispatch<React.SetStateAction<string | null>>
  statusMessage: string | null
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

function formatSessionLabel(name: string | null) {
  return name ?? 'Untitled session'
}

function sanitizeFlatAgentSessionPath(value: string) {
  return value
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildFlatAgentSessionTreeEntries(sessions: AgentSessionListItem[]) {
  const seenLabels = new Map<string, number>()
  const usedTreePaths = new Set<string>()

  return sessions.map((session) => {
    const baseLabel = sanitizeFlatAgentSessionPath(session.name ?? session.preview) || 'Untitled session'
    const nextCount = (seenLabels.get(baseLabel) ?? 0) + 1
    seenLabels.set(baseLabel, nextCount)

    let treePath = nextCount === 1 ? baseLabel : `${baseLabel} ${nextCount}`
    let suffix = nextCount + 1

    while (usedTreePaths.has(treePath)) {
      treePath = `${baseLabel} ${suffix}`
      suffix += 1
    }

    usedTreePaths.add(treePath)

    return {
      session,
      treePath,
    }
  })
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

function getAgentModelKey(provider: string, modelId: string) {
  return `${provider}/${modelId}`
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

function getAgentModelCascaderTriangleSign(
  firstPoint: AgentModelPickerPointerPoint,
  secondPoint: AgentModelPickerPointerPoint,
  thirdPoint: AgentModelPickerPointerPoint,
) {
  return (firstPoint.x - thirdPoint.x) * (secondPoint.y - thirdPoint.y)
    - (secondPoint.x - thirdPoint.x) * (firstPoint.y - thirdPoint.y)
}

function isPointInsideAgentModelCascaderTriangle(
  point: AgentModelPickerPointerPoint,
  firstVertex: AgentModelPickerPointerPoint,
  secondVertex: AgentModelPickerPointerPoint,
  thirdVertex: AgentModelPickerPointerPoint,
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
  const left = Math.max(margin, Math.min(anchorRect.left, viewportWidth - width - margin))
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

function AgentMessageBubble({
  message,
  onOpenWorkspaceFile,
  workspacePath,
}: {
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
        {message.text.trim() ? (
          <AgentMarkdown onOpenWorkspaceFile={onOpenWorkspaceFile} text={message.text} workspacePath={workspacePath} />
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

type AgentSessionStatusBadge = {
  indicator: Extract<AgentSessionStatusIndicator, { kind: 'spinner' }>
  label: string
}

type AgentSessionStatus = {
  badge?: AgentSessionStatusBadge
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

function formatAgentSessionStatus(
  phase: AgentSessionPhase,
  pendingMessageCount: number,
): AgentSessionStatus | null {
  const queuedBadge = pendingMessageCount > 0 && phase.type !== 'error' && phase.type !== 'queued'
    ? {
        indicator: {
          kind: 'spinner' as const,
          name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
        },
        label: pendingMessageCount === 1 ? 'Queued 1' : `Queued ${pendingMessageCount}`,
      }
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
        badge: queuedBadge,
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
        badge: queuedBadge,
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
        badge: queuedBadge,
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
        badge: queuedBadge,
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
        badge: queuedBadge,
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
        badge: queuedBadge,
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
        indicator: {
          kind: 'spinner',
          name: AGENT_SESSION_STATUS_ANIMATIONS.queued,
        },
        label: pendingMessageCount === 1 ? 'Queued 1' : `Queued ${pendingMessageCount}`,
        tone: 'running',
      }
    case 'idle':
      return null
  }
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
      {status.badge ? (
        <span className='agent-session-status-badge'>
          <UnicodeSpinner
            className='agent-session-status-badge-indicator'
            name={status.badge.indicator.name}
          />
          <span className='agent-session-status-badge-label'>{status.badge.label}</span>
        </span>
      ) : null}
    </article>
  )
}

function AgentProvider({
  children,
  iconTheme,
  onOpenMessageFile,
  onOpenProviderSettings,
  onWorkspaceStateChange,
  workspacePath,
}: AgentProviderProps) {
  const workspaceTree = useWorkspaceStore((state) => state.tree)
  const defaultModelSelection = parseModelSelection(null)
  const [composerHeight, setComposerHeight] = useState(172)
  const [hasLoadedComposerHeight, setHasLoadedComposerHeight] = useState(false)
  const [agentState, setAgentState] = useState<AgentWorkspaceState>(emptyAgentState)
  const [composerState, setComposerState] = useState<ComposerState>(emptyComposerState)
  const [modelInputValue, setModelInputValue] = useState(defaultModelSelection.modelId)
  const [selectedProviderValue, setSelectedProviderValue] = useState(defaultModelSelection.provider)
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
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [deletingSessionPath, setDeletingSessionPath] = useState<string | null>(null)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [isSwitchingThinkingLevel, setIsSwitchingThinkingLevel] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false)
  const [isResizingComposer, setIsResizingComposer] = useState(false)
  const composerResizeStateRef = useRef<{ pointerId: number, startHeight: number, startY: number } | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const modelFieldRef = useRef<HTMLDivElement | null>(null)
  const overlayPanelRef = useRef<HTMLDivElement | null>(null)
  const sessionButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousSessionPathRef = useRef<string | null>(null)
  const fileAutoOpenStateRef = useRef<AgentFileAutoOpenState>(initialAgentFileAutoOpenState)
  const restorableSessionPath = agentState.activeSession?.sessionPath
    && agentState.sessions.some((session) => session.path === agentState.activeSession?.sessionPath)
    ? agentState.activeSession.sessionPath
    : null

  function syncModelSelection(selection: { modelId: string, provider: string }) {
    setSelectedProviderValue(selection.provider)
    setModelInputValue(selection.modelId)
    setModelDrafts((currentValue) => ({
      ...currentValue,
      [selection.provider]: selection.modelId,
    }))
  }

  function getRuntimePreferredModelId(provider: string) {
    const preferredModelKey = agentState.runtime.preferredModelByProvider[provider]
    const preferredSelection = parseModelSelection(preferredModelKey ?? null)

    return preferredSelection.provider === provider ? preferredSelection.modelId : null
  }

  useEffect(() => {
    let mounted = true

    void window.appApi.getUiState()
      .then((uiState) => {
        if (!mounted) {
          return
        }

        setComposerHeight(uiState.agentComposerHeight)
        setHasLoadedComposerHeight(true)
      })
      .catch(() => {
        if (mounted) {
          setHasLoadedComposerHeight(true)
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!hasLoadedComposerHeight) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void window.appApi.updateUiState({ agentComposerHeight: composerHeight })
    }, 120)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [composerHeight, hasLoadedComposerHeight])

  useEffect(() => {
    const unsubscribe = window.appApi.onAgentEvent((event: AgentClientEvent) => {
      if (event.type === 'workspace_state') {
        setAgentState(event.state)
        const nextModelSelection = parseModelSelection(event.state.runtime.selectedModel)
        syncModelSelection(nextModelSelection)
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
        && activeSessionSelection.kind === 'session'
        && (!event.sessionId || event.sessionId === agentState.activeSession?.sessionId)
      ) {
        setPanelError(event.message)
      }
    })

    return unsubscribe
  }, [activeSessionSelection.kind, agentState.activeSession?.sessionId])

  useEffect(() => {
    if (!workspacePath) {
      setAgentState(emptyAgentState)
      setComposerState(emptyComposerState)
      setSelectedProviderValue(defaultModelSelection.provider)
      setModelInputValue(defaultModelSelection.modelId)
      setModelDrafts({
        [defaultModelSelection.provider]: defaultModelSelection.modelId,
      })
      setDraftAssistant('')
      setDraftThinking('')
      setIsThinkingStreaming(false)
      setLiveTools([])
      setPanelError(null)
      setHasLoadedWorkspaceState(false)
      setActiveSessionSelection({ kind: 'new' })
      return
    }

    setIsLoading(true)
    setPanelError(null)
    setHasLoadedWorkspaceState(false)

    void window.appApi.getWorkspaceState(workspacePath)
      .then((workspaceState) => window.appApi.loadAgentWorkspace(workspacePath, workspaceState.lastAgentSessionPath))
      .then((nextState) => {
        setAgentState(nextState)
        const nextActiveSessionPath = nextState.activeSession?.sessionPath
        const hasRestoredSession = Boolean(
          nextActiveSessionPath
          && nextState.sessions.some((session) => session.path === nextActiveSessionPath),
        )
        const restoredSessionPath = hasRestoredSession ? nextActiveSessionPath : null
        setActiveSessionSelection(restoredSessionPath
          ? { kind: 'session', sessionPath: restoredSessionPath }
          : { kind: 'new' })
        const nextModelSelection = parseModelSelection(nextState.runtime.selectedModel)
        syncModelSelection(nextModelSelection)
        setHasLoadedWorkspaceState(true)
      })
      .catch((error) => {
        setPanelError(error instanceof Error ? error.message : 'Unable to load Pi Agent sessions.')
      })
      .finally(() => {
        setIsLoading(false)
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
    if (!workspacePath) {
      setActiveOverlayPanel(null)
    }
  }, [workspacePath])

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
  const visibleRuntime = useMemo(() => (
    isViewingActiveRuntime
      ? agentState.runtime
      : {
          ...agentState.runtime,
          compactionReason: null,
          isCompacting: false,
          isStreaming: false,
          pendingMessageCount: 0,
          retryAttempt: 0,
          retryMaxAttempts: null,
        }
  ), [agentState.runtime, isViewingActiveRuntime])
  const visiblePersistedMessages = isViewingActiveRuntime ? agentState.activeSession?.messages ?? [] : []

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
    setActiveSessionSelection({ kind: 'new' })
    setComposerState(emptyComposerState)
    setPanelError(null)
    setActiveOverlayPanel(null)
  }

  async function handleCreateSession() {
    if (!workspacePath) {
      return
    }

    setActiveSessionSelection({ kind: 'new' })

    try {
      setIsCreatingSession(true)
      setPanelError(null)
      const nextState = await window.appApi.createAgentSession(workspacePath)
      setAgentState(nextState)
      const nextModelSelection = parseModelSelection(nextState.runtime.selectedModel)
      syncModelSelection(nextModelSelection)
      setActiveOverlayPanel(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to create a session.')
    } finally {
      setIsCreatingSession(false)
    }
  }

  async function handleOpenSession(sessionPath: string) {
    if (!workspacePath) {
      return
    }

    setActiveSessionSelection({ kind: 'session', sessionPath })

    if (agentState.activeSession?.sessionPath === sessionPath) {
      setPanelError(null)
      setActiveOverlayPanel(null)
      return
    }

    try {
      setPanelError(null)
      const nextState = await window.appApi.openAgentSession(workspacePath, sessionPath)
      setAgentState(nextState)
      const nextModelSelection = parseModelSelection(nextState.runtime.selectedModel)
      syncModelSelection(nextModelSelection)
      setActiveOverlayPanel(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to open that session.')
    }
  }

  async function handleDeleteSession(sessionPath: string) {
    if (!workspacePath) {
      return
    }

    try {
      setDeletingSessionPath(sessionPath)
      setPanelError(null)
      const nextState = await window.appApi.deleteAgentSession(workspacePath, sessionPath)
      setAgentState(nextState)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to delete that session.')
    } finally {
      setDeletingSessionPath(null)
    }
  }

  async function handleSelectModel(modelKey: string) {
    if (!workspacePath) {
      return
    }

    try {
      setIsSwitchingModel(true)
      setPanelError(null)

      if (activeSessionSelection.kind === 'new' || !agentState.activeSession) {
        const nextState = await window.appApi.createAgentSession(workspacePath)
        setAgentState(nextState)
        if (nextState.activeSession?.sessionPath) {
          setActiveSessionSelection({ kind: 'session', sessionPath: nextState.activeSession.sessionPath })
        }
      }

      const nextState = await window.appApi.selectAgentModel(modelKey)
      setAgentState(nextState)
      const nextModelSelection = parseModelSelection(nextState.runtime.selectedModel)
      syncModelSelection(nextModelSelection)
      setActiveComposerMenu(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to switch the model.')
    } finally {
      setIsSwitchingModel(false)
    }
  }

  async function handleThinkingLevelSelection(level: AgentThinkingLevel, modelKey?: string) {
    if (!workspacePath) {
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

      if (activeSessionSelection.kind === 'new' || !agentState.activeSession) {
        const nextState = await window.appApi.createAgentSession(workspacePath)
        setAgentState(nextState)
        if (nextState.activeSession?.sessionPath) {
          setActiveSessionSelection({ kind: 'session', sessionPath: nextState.activeSession.sessionPath })
        }
      }

      const nextState = await window.appApi.selectAgentThinkingLevel(level, nextModelKey)
      setAgentState(nextState)
      const nextModelSelection = parseModelSelection(nextState.runtime.selectedModel)
      syncModelSelection(nextModelSelection)
      setActiveComposerMenu(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to switch the thinking level.')
    } finally {
      setIsSwitchingThinkingLevel(false)
    }
  }

  async function submitComposerPrompt(streamingBehavior?: 'steer' | 'followUp') {
    const serializedPrompt = serializeComposerText(composerState.value, composerState.mentions)
    const trimmedPrompt = serializedPrompt.trim()

    if (!workspacePath || !trimmedPrompt) {
      return
    }

    try {
      setActiveComposerMenu(null)
      setPanelError(null)

      if (activeSessionSelection.kind === 'new' || !agentState.activeSession) {
        const nextState = await window.appApi.createAgentSession(workspacePath)
        setAgentState(nextState)
        if (nextState.activeSession?.sessionPath) {
          setActiveSessionSelection({ kind: 'session', sessionPath: nextState.activeSession.sessionPath })
        }
      }

      await window.appApi.sendAgentPrompt(trimmedPrompt, streamingBehavior)
      setComposerState(emptyComposerState)
      setDraftAssistant('')
      setLiveTools([])
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to send your prompt.')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitComposerPrompt(isViewingActiveRuntime && agentState.runtime.isStreaming ? 'steer' : undefined)
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitComposerPrompt(event.altKey ? 'followUp' : isViewingActiveRuntime && agentState.runtime.isStreaming ? 'steer' : undefined)
    }
  }

  useEffect(() => {
    if (!isResizingComposer) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = composerResizeStateRef.current

      if (!resizeState || event.pointerId !== resizeState.pointerId) {
        return
      }

      const nextHeight = Math.min(
        360,
        Math.max(132, resizeState.startHeight + (resizeState.startY - event.clientY)),
      )

      setComposerHeight(nextHeight)
    }

    function handlePointerUp(event: PointerEvent) {
      if (composerResizeStateRef.current?.pointerId === event.pointerId) {
        setIsResizingComposer(false)
        composerResizeStateRef.current = null
        document.body.style.userSelect = ''
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
      document.body.style.userSelect = ''
    }
  }, [isResizingComposer])

  const configuredProviders = Array.from(new Set(
    agentState.runtime.availableModels
      .map((model) => model.split('/')[0])
      .filter(Boolean),
  )).sort((left, right) => {
    const orderDelta = getAgentProviderOrder(left) - getAgentProviderOrder(right)
    return orderDelta !== 0 ? orderDelta : left.localeCompare(right)
  })
  const hasConfiguredProviders = configuredProviders.length > 0
  const resolvedSelectedProviderValue = configuredProviders.includes(selectedProviderValue)
    ? selectedProviderValue
    : configuredProviders[0] ?? selectedProviderValue
  const providerModelIds = Array.from(new Set(
    agentState.runtime.availableModels
      .filter((model) => model.startsWith(`${resolvedSelectedProviderValue}/`))
      .map((model) => model.split('/').slice(1).join('/')),
  ))
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
  const thinkingLevel = clampAgentThinkingLevel(agentState.runtime.thinkingLevel, composerThinkingLevels)
  const thinkingLevelLabel = formatThinkingLevelLabel(thinkingLevel)
  const canSend = Boolean(
    workspacePath
    && serializeComposerText(composerState.value, composerState.mentions).trim()
    && agentState.runtime.hasConfiguredModels,
  )
  const statusMessage = !workspacePath
    ? 'Open a workspace to start.'
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
    () => sessionPhase ? formatAgentSessionStatus(sessionPhase, visibleRuntime.pendingMessageCount) : null,
    [sessionPhase, visibleRuntime.pendingMessageCount],
  )
  const roundFileChangesByMessageId = useMemo(() => {
    const hasInFlightRound = isViewingActiveRuntime && (liveTools.length > 0
      || Boolean(draftAssistant.trim() || draftThinking.trim())
      || agentState.runtime.isStreaming
      || agentState.runtime.pendingMessageCount > 0)
    return buildRoundFileChangesByMessageId({
      annotations: agentState.activeSession?.annotations ?? { fileChangesByEntryId: {} },
      hasInFlightRound,
      messages: visiblePersistedMessages,
    })
  }, [
    agentState.activeSession?.annotations,
    agentState.runtime.isStreaming,
    agentState.runtime.pendingMessageCount,
    draftAssistant,
    draftThinking,
    isViewingActiveRuntime,
    liveTools.length,
    visiblePersistedMessages,
  ])
  const sessionStatusKey = sessionStatus
    ? `${sessionStatus.label}:${sessionStatus.badge?.label ?? ''}`
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
    agentState,
    canSend,
    composerHeight,
    composerResizeStateRef,
    composerState,
    configuredProviders,
    deletingSessionPath,
    handleComposerKeyDown,
    handleCreateSession,
    handleDeleteSession,
    handleOpenSession,
    handleSelectModel,
    handleThinkingLevelSelection,
    handleStartNewSession,
    handleSubmit,
    hasConfiguredProviders,
    iconTheme,
    isCreatingSession,
    isLoading,
    isResizingComposer,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    liveTools,
    messagesScrollRef,
    modelFieldRef,
    modelInputValue,
    onOpenMessageFile,
    onOpenProviderSettings,
    overlayPanelRef,
    panelError,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionButtonRef,
    sessionStatus,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setIsResizingComposer,
    setPanelError,
    statusMessage,
    thinkingLevel,
    thinkingLevelLabel,
    workspacePath,
    workspaceTree,
  }), [
    activeComposerMenu,
    activeOverlayPanel,
    activeSession,
    activeSessionSelection,
    activeSessionPath,
    agentState,
    canSend,
    composerHeight,
    composerState,
    configuredProviders,
    deletingSessionPath,
    handleComposerKeyDown,
    handleCreateSession,
    handleDeleteSession,
    handleOpenSession,
    handleSelectModel,
    handleThinkingLevelSelection,
    handleStartNewSession,
    handleSubmit,
    hasConfiguredProviders,
    iconTheme,
    isCreatingSession,
    isLoading,
    isResizingComposer,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    liveTools,
    modelInputValue,
    onOpenMessageFile,
    onOpenProviderSettings,
    panelError,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionStatus,
    statusMessage,
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

function AgentSessionTree({
  className,
  onRequestClose,
  id = 'agent-session-tree',
}: AgentSessionTreeProps) {
  const {
    activeSessionSelection,
    activeSessionPath,
    agentState,
    deletingSessionPath,
    handleDeleteSession,
    handleOpenSession,
    handleStartNewSession,
    workspacePath,
  } = useAgentContext()
  const treeEntries = useMemo(() => buildFlatAgentSessionTreeEntries(agentState.sessions), [agentState.sessions])
  const sessionPathByTreePath = useMemo(() => {
    const nextMap = new Map<string, string>()
    treeEntries.forEach(({ session, treePath }) => {
      nextMap.set(treePath, session.path)
    })
    return nextMap
  }, [treeEntries])
  const treeSelectionStateRef = useRef({
    activeSessionPath,
    activeSessionSelection,
    handleOpenSession,
    isSyncingSelection: false,
    onRequestClose,
    sessionPathByTreePath,
  })
  const treePaths = useMemo(() => {
    if (sessionPathByTreePath.size === 0) {
      return [AGENT_SESSION_TREE_EMPTY_PATH]
    }

    return [...sessionPathByTreePath.keys()]
  }, [sessionPathByTreePath])
  const activeTreePath = useMemo(() => {
    if (!activeSessionPath) {
      return null
    }

    for (const [treePath, sessionPath] of sessionPathByTreePath.entries()) {
      if (sessionPath === activeSessionPath) {
        return treePath
      }
    }

    return null
  }, [activeSessionPath, sessionPathByTreePath])

  useEffect(() => {
    treeSelectionStateRef.current = {
      activeSessionPath,
      activeSessionSelection,
      handleOpenSession,
      isSyncingSelection: treeSelectionStateRef.current.isSyncingSelection,
      onRequestClose,
      sessionPathByTreePath,
    }
  }, [activeSessionSelection, activeSessionPath, handleOpenSession, onRequestClose, sessionPathByTreePath])

  const { model } = useFileTree({
    composition: {
      contextMenu: {
        buttonVisibility: 'when-needed',
        enabled: true,
        triggerMode: 'both',
      },
    },
    id,
    initialExpansion: 'open',
    initialSelectedPaths: activeTreePath ? [activeTreePath] : [],
    itemHeight: 32,
    onSelectionChange: (selectedPaths) => {
      const {
        activeSessionPath: latestActiveSessionPath,
        activeSessionSelection: latestActiveSessionSelection,
        handleOpenSession: latestHandleOpenSession,
        isSyncingSelection,
        onRequestClose: latestOnRequestClose,
        sessionPathByTreePath: latestSessionPathByTreePath,
      } = treeSelectionStateRef.current
      if (isSyncingSelection) {
        return
      }

      const selectedPath = selectedPaths.find((path) => (
        path !== AGENT_SESSION_TREE_EMPTY_PATH
        && (latestActiveSessionSelection.kind !== 'session'
          || latestSessionPathByTreePath.get(path) !== latestActiveSessionPath)
      )) ?? selectedPaths.find((path) => path !== AGENT_SESSION_TREE_EMPTY_PATH)
      if (!selectedPath || selectedPath === AGENT_SESSION_TREE_EMPTY_PATH) {
        return
      }

      const sessionPath = latestSessionPathByTreePath.get(selectedPath)
      if (!sessionPath || latestActiveSessionSelection.kind === 'session' && sessionPath === latestActiveSessionPath) {
        return
      }

      void latestHandleOpenSession(sessionPath).then(() => {
        latestOnRequestClose?.()
      })
    },
    paths: treePaths,
    renderRowDecoration: renderAgentSessionTreeRowDecoration,
    unsafeCSS: AGENT_SESSION_TREE_CSS,
  })

  useEffect(() => {
    model.resetPaths(treePaths)
  }, [model, treePaths])

  useEffect(() => {
    treeSelectionStateRef.current.isSyncingSelection = true
    model.getSelectedPaths().forEach((selectedPath) => {
      model.getItem(selectedPath)?.deselect()
    })

    if (activeSessionSelection.kind === 'new') {
      treeSelectionStateRef.current.isSyncingSelection = false
      return
    }

    if (!activeTreePath) {
      treeSelectionStateRef.current.isSyncingSelection = false
      return
    }

    model.getItem(activeTreePath)?.select()
    model.focusPath(activeTreePath)
    model.scrollToPath(activeTreePath, { offset: 'nearest' })
    treeSelectionStateRef.current.isSyncingSelection = false
  }, [activeSessionSelection.kind, activeTreePath, model])

  return (
    <div className={`agent-session-tree-shell${className ? ` ${className}` : ''}`}>
      <button
        type='button'
        disabled={!workspacePath}
        className={`agent-session-new-button${activeSessionSelection.kind === 'new' ? ' is-active' : ''}`}
        aria-label='Start new conversation'
        onClick={() => {
          handleStartNewSession()
          onRequestClose?.()
        }}
      >
        <AddLine size={18} />
        <span>新对话</span>
      </button>

      <AppScrollArea
        className='agent-session-tree-scroll'
        contentClassName='agent-session-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <FileTree
          className='agent-session-tree'
          model={model}
          aria-label='Agent sessions'
          renderContextMenu={(item, context) => {
            const sessionPath = sessionPathByTreePath.get(item.path)
            if (!sessionPath) {
              return null
            }

            const isDeleting = deletingSessionPath === sessionPath

            return (
              <div className='agent-session-tree-menu'>
                <button
                  type='button'
                  className='agent-session-tree-menu-item'
                  disabled={isDeleting}
                  onClick={() => {
                    context.close({ restoreFocus: false })
                    void handleDeleteSession(sessionPath)
                  }}
                >
                  <span>删除</span>
                </button>
              </div>
            )
          }}
        />
      </AppScrollArea>
    </div>
  )
}

function AgentNewSessionIllustration() {
  return (
    <div className='agent-empty-icon-container' aria-hidden='true'>
      <AiLine size={24} />
    </div>
  )
}

function AgentEmptyChat() {
  const { workspacePath } = useAgentContext()

  return (
    <div className='agent-empty-chat'>
      <AgentNewSessionIllustration />
      <h2>新对话</h2>
      <p className='agent-empty-subtitle'>
        {workspacePath
          ? '在下方消息框中输入您的请求以开始对话'
          : '打开一个文件夹即可开始协同开发'}
      </p>
    </div>
  )
}

function AgentChatSurface() {
  const {
    activeComposerMenu,
    activeOverlayPanel,
    activeSession,
    activeSessionSelection,
    activeSessionPath,
    agentState,
    canSend,
    composerHeight,
    composerResizeStateRef,
    composerState,
    configuredProviders,
    handleComposerKeyDown,
    handleCreateSession,
    handleDeleteSession,
    handleOpenSession,
    handleSelectModel,
    handleThinkingLevelSelection,
    handleStartNewSession,
    handleSubmit,
    hasConfiguredProviders,
    iconTheme,
    isCreatingSession,
    deletingSessionPath,
    isLoading,
    isResizingComposer,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    messagesScrollRef,
    modelFieldRef,
    modelInputValue,
    onOpenMessageFile,
    onOpenProviderSettings,
    overlayPanelRef,
    panelError,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionButtonRef,
    sessionStatus,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setIsResizingComposer,
    setPanelError,
    statusMessage,
    thinkingLevel,
    thinkingLevelLabel,
    workspacePath,
    workspaceTree,
  } = useAgentContext()
  const hasEmptyChat = Boolean(workspacePath && renderedMessages.length === 0)
  const isNewConversation = activeSessionSelection.kind === 'new'
    || (hasEmptyChat && !activeSession)
  const [modelPickerQuery, setModelPickerQuery] = useState('')
  const [modelPickerProvider, setModelPickerProvider] = useState(resolvedSelectedProviderValue)
  const [modelPickerActiveModelKey, setModelPickerActiveModelKey] = useState<string | null>(null)
  const [modelPickerActiveThinkingLevel, setModelPickerActiveThinkingLevel] = useState<AgentThinkingLevel | null>(null)
  const [modelPickerKeyboardColumn, setModelPickerKeyboardColumn] = useState<AgentModelPickerKeyboardColumn>('model')
  const modelPickerSearchRef = useRef<HTMLInputElement | null>(null)
  const modelPickerTriggerRef = useRef<HTMLButtonElement | null>(null)
  const modelPickerSafeTriangleRef = useRef<AgentModelPickerSafeTriangle | null>(null)
  const [modelCascaderStyle, setModelCascaderStyle] = useState<AgentModelCascaderStyle>({})
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
    agentState.runtime.thinkingLevel,
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
  }, [modelCascaderLayoutMetrics])

  function scrollModelCascaderActiveItemsOnNextFrame() {
    window.requestAnimationFrame(scrollAgentModelCascaderActiveItemsIntoView)
  }

  function setModelPickerSafeTriangleOrigin(modelKey: string, event: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>) {
    modelPickerSafeTriangleRef.current = {
      modelKey,
      origin: {
        x: event.clientX,
        y: event.clientY,
      },
    }
  }

  function setModelPickerTriggerSafeTriangleOrigin(modelKey: string, event: ReactMouseEvent<HTMLElement>) {
    const triggerRect = modelPickerTriggerRef.current?.getBoundingClientRect()

    modelPickerSafeTriangleRef.current = {
      modelKey,
      origin: {
        x: triggerRect ? Math.min(event.clientX, triggerRect.left + 8) : event.clientX,
        y: event.clientY,
      },
    }
  }

  function activateModelPickerModelPreview(
    modelKey: string,
    event?: ReactPointerEvent<HTMLElement> | ReactMouseEvent<HTMLElement>,
  ) {
    setModelPickerActiveModelKey(modelKey)
    setModelPickerActiveThinkingLevel(null)

    if (event) {
      setModelPickerSafeTriangleOrigin(modelKey, event)
    } else {
      modelPickerSafeTriangleRef.current = null
    }
  }

  // Preserve the active model while the pointer crosses sibling rows toward the Thinking submenu.
  function isPointerInsideModelPickerThinkingSafeTriangle(event: ReactPointerEvent<HTMLElement>) {
    const safeTriangle = modelPickerSafeTriangleRef.current
    if (!showModelPickerThinkingColumn || !safeTriangle) {
      return false
    }

    if (safeTriangle.modelKey !== activeModelOption?.key) {
      return false
    }

    const thinkingColumnElement = document
      .querySelector<HTMLElement>('[data-agent-model-cascader="true"] .agent-model-cascader-column-thinking')

    if (!thinkingColumnElement) {
      return false
    }

    const currentPoint = {
      x: event.clientX,
      y: event.clientY,
    }
    const thinkingColumnRect = thinkingColumnElement.getBoundingClientRect()

    if (safeTriangle.origin.x >= thinkingColumnRect.left || currentPoint.x <= safeTriangle.origin.x + 1) {
      return false
    }

    if (currentPoint.x >= thinkingColumnRect.left - 1) {
      return true
    }

    const verticalPadding = 18
    return isPointInsideAgentModelCascaderTriangle(
      currentPoint,
      safeTriangle.origin,
      {
        x: thinkingColumnRect.left,
        y: thinkingColumnRect.top - verticalPadding,
      },
      {
        x: thinkingColumnRect.left,
        y: thinkingColumnRect.bottom + verticalPadding,
      },
    )
  }

  function handleModelPickerModelPointerPreview(modelKey: string, event: ReactPointerEvent<HTMLElement>) {
    if (
      modelKey !== modelPickerSafeTriangleRef.current?.modelKey
      && isPointerInsideModelPickerThinkingSafeTriangle(event)
    ) {
      return
    }

    activateModelPickerModelPreview(modelKey, event)
  }

  function handleModelPickerProviderPointerFocus(provider: string, event: ReactPointerEvent<HTMLElement>) {
    if (isPointerInsideModelPickerThinkingSafeTriangle(event)) {
      return
    }

    setModelPickerKeyboardColumn('provider')
    handleModelPickerProviderFocus(provider)
  }

  function openModelCascader(event?: ReactMouseEvent<HTMLButtonElement>) {
    if (!hasConfiguredProviders || !workspacePath || isSwitchingModel || isSwitchingThinkingLevel) {
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
      setModelPickerTriggerSafeTriangleOrigin(initialModelKey, event)
    } else {
      modelPickerSafeTriangleRef.current = null
    }

    updateModelCascaderPosition()
    setActiveComposerMenu((currentValue) => currentValue === 'model-cascader' ? null : 'model-cascader')
  }

  function handleModelPickerProviderFocus(provider: string) {
    modelPickerSafeTriangleRef.current = null
    setModelPickerProvider(provider)
    setModelPickerActiveModelKey(
      modelPickerOptions.find((option) => option.provider === provider)?.key ?? null,
    )
    setModelPickerActiveThinkingLevel(null)
  }

  function handleModelPickerQueryChange(value: string) {
    modelPickerSafeTriangleRef.current = null
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

    if (modelPickerKeyboardColumn === 'thinking' && showModelPickerThinkingColumn) {
      void handleModelPickerThinkingSelect(activeModelPickerThinkingLevel)
      return
    }

    if (activeModelOption) {
      void handleModelPickerModelSelect(activeModelOption)
    }
  }

  function handleModelPickerSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
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
    setModelPickerActiveModelKey(option.key)
    setActiveComposerMenu(null)
    await handleSelectModel(option.key)
  }

  async function handleModelPickerThinkingSelect(level: AgentThinkingLevel) {
    if (!activeModelOption) {
      return
    }

    setActiveComposerMenu(null)
    await handleThinkingLevelSelection(level, activeModelOption.key)
  }

  useEffect(() => {
    if (activeComposerMenu !== 'model-cascader') {
      modelPickerSafeTriangleRef.current = null
    }
  }, [activeComposerMenu])

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
  }, [activeComposerMenu, updateModelCascaderPosition])

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

  const composerFooter = (
    <div ref={modelFieldRef} className='agent-composer-meta'>
      <div className='agent-composer-toolbar'>
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
                  !workspacePath
                  || !agentState.runtime.hasConfiguredModels
                  || isSwitchingModel
                  || isSwitchingThinkingLevel
                }
                title={modelPickerTriggerTitle}
                onClick={openModelCascader}
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
                isDisabled={!workspacePath}
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

          <Button
            isIconOnly
            isDisabled={!canSend}
            size='sm'
            type='submit'
            variant='ghost'
            className='agent-send-button'
          >
            <ArrowUpLine size={16} />
          </Button>
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
        >
          <label className='agent-model-cascader-search'>
            <SearchLine aria-hidden='true' size={14} />
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
          </label>

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
                <section className='agent-model-cascader-column'>
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

                <section className='agent-model-cascader-column'>
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

            {showModelPickerThinkingColumn ? (
              <section
                className='agent-model-cascader-column agent-model-cascader-column-thinking'
                onPointerEnter={() => {
                  modelPickerSafeTriangleRef.current = null
                }}
              >
                <div className='agent-model-cascader-column-title'>Thinking</div>
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
                          modelPickerSafeTriangleRef.current = null
                          setModelPickerActiveThinkingLevel(level)
                          setModelPickerKeyboardColumn('thinking')
                        }}
                        onClick={() => {
                          void handleModelPickerThinkingSelect(level)
                        }}
                      >
                        <BrainLine aria-hidden='true' size={14} />
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

  return (
    <div className='agent-shell'>
      <div className='agent-threadbar'>
        <div className='agent-threadbar-leading'>
          <div className='agent-session-select'>
            <button
              ref={sessionButtonRef}
              type='button'
              disabled={!workspacePath}
              className={`agent-session-trigger ${activeOverlayPanel === 'sessions' ? 'is-open' : ''}`}
              onClick={() => {
                setActiveOverlayPanel((currentValue) => currentValue === 'sessions' ? null : 'sessions')
              }}
            >
              <span className='agent-select-current'>
                {isNewConversation ? '新对话' : activeSession ? formatSessionLabel(activeSession.name) : 'Session'}
              </span>
            </button>
          </div>

          {!isNewConversation ? (
            <button
              type='button'
              disabled={!workspacePath || isCreatingSession}
              className='agent-toolbar-button'
              aria-label='Start new conversation'
              onClick={() => {
                handleStartNewSession()
              }}
            >
              <AddLine size={16} />
            </button>
          ) : null}
        </div>

        <div className='agent-threadbar-drag-spacer' aria-hidden='true' />
      </div>

      {activeOverlayPanel === 'sessions' ? (
        <div className='agent-overlay-layer'>
          <div ref={overlayPanelRef} className='agent-floating-panel'>
            <AgentSessionTree
              className='agent-session-tree-floating'
              id='agent-session-tree-floating'
              onRequestClose={() => {
                setActiveOverlayPanel(null)
              }}
            />
          </div>
        </div>
      ) : null}

      {statusMessage ? (
        <div className='agent-status-inline'>
          <p>{statusMessage}</p>
        </div>
      ) : null}

      <AppScrollArea
        className='agent-messages-scroll'
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

      <form
        className='agent-composer'
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className='agent-composer-shell' style={{ '--agent-composer-height': `${composerHeight}px` } as CSSProperties}>
          <div
            aria-hidden='true'
            className={`agent-composer-resize-handle${isResizingComposer ? ' is-active' : ''}${activeComposerMenu ? ' is-blocked' : ''}`}
            onPointerDown={(event) => {
              if (activeComposerMenu) {
                return
              }

              if (event.button !== 0) {
                return
              }

              event.preventDefault()
              composerResizeStateRef.current = {
                pointerId: event.pointerId,
                startHeight: composerHeight,
                startY: event.clientY,
              }
              setIsResizingComposer(true)
            }}
          />

          <AgentComposerMentionInput
            aria-label='Prompt Pi Agent'
            disabled={!workspacePath || isLoading}
            iconTheme={iconTheme}
            mentions={composerState.mentions}
            onChange={setComposerState}
            onSubmitShortcut={handleComposerKeyDown}
            placeholder={workspacePath ? 'Message' : 'Open a folder first.'}
            value={composerState.value}
            workspaceNodes={workspaceTree}
            workspacePath={workspacePath}
            footer={composerFooter}
          />
        </div>
      </form>
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
  AgentProvider,
  AgentSessionTree,
  AgentSidebar,
}

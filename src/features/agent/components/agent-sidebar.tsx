import {
  type CSSProperties,
  createContext,
  FormEvent,
  KeyboardEvent,
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
import type { FileTreeRowDecorationRenderer } from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import { Button, Chip, Disclosure, Input } from '@heroui/react'
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

type AgentComposerMenu = 'model' | 'provider' | 'thinking' | null

type AgentSessionSelection = { kind: 'new' } | { kind: 'session', sessionPath: string }

const MARKDOWN_PLUGINS = [remarkGfm]
const AGENT_COMPOSER_MENU_MAX_HEIGHT = 264
const AGENT_COMPOSER_MENU_ROW_HEIGHT = 30
const AGENT_COMPOSER_MENU_PADDING = 10
const AGENT_COMPOSER_MENU_BORDER_SIZE = 2
const AGENT_THINKING_AUTO_EXPAND_DELAY_MS = 520
const AGENT_THINKING_AUTO_COLLAPSE_DELAY_MS = 140
const AGENT_THINKING_MIN_EXPANDED_MS = 360
const AGENT_THINKING_SCROLL_STICKY_THRESHOLD_PX = 24
const MAX_VISIBLE_MESSAGE_FILE_CHIPS = 6

const emptyAgentState: AgentWorkspaceState = {
  activeSession: null,
  runtime: {
    auth: {},
    availableModels: [],
    availableThinkingLevels: ['off'],
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

function getAgentComposerMenuHeight(itemCount: number) {
  const contentHeight = itemCount * AGENT_COMPOSER_MENU_ROW_HEIGHT + AGENT_COMPOSER_MENU_PADDING

  return Math.min(AGENT_COMPOSER_MENU_MAX_HEIGHT, contentHeight + AGENT_COMPOSER_MENU_BORDER_SIZE)
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
  canChooseProvider: boolean
  canChooseThinkingLevel: boolean
  canSend: boolean
  composerHeight: number
  composerResizeStateRef: React.MutableRefObject<{ pointerId: number, startHeight: number, startY: number } | null>
  composerState: ComposerState
  configuredProviders: string[]
  deletingSessionPath: string | null
  handleComposerKeyDown: (event: KeyboardEvent<HTMLElement>) => void
  handleCreateSession: () => Promise<void>
  handleDeleteSession: (sessionPath: string) => Promise<void>
  handleModelInputCommit: () => Promise<void>
  handleOpenSession: (sessionPath: string) => Promise<void>
  handleProviderSelectionChange: (nextProvider: string) => Promise<void>
  handleSelectModel: (modelKey: string) => Promise<void>
  handleThinkingLevelSelection: (level: AgentThinkingLevel) => Promise<void>
  handleStartNewSession: () => void
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  hasConfiguredProviders: boolean
  iconTheme?: WorkspaceIconTheme | null
  isCreatingSession: boolean
  isLoading: boolean
  isModelInputFullySelected: boolean
  isResizingComposer: boolean
  isSwitchingModel: boolean
  isSwitchingThinkingLevel: boolean
  liveTools: LiveToolState[]
  messagesScrollRef: React.RefObject<HTMLDivElement | null>
  modelFieldRef: React.RefObject<HTMLDivElement | null>
  modelInputRef: React.RefObject<HTMLInputElement | null>
  modelInputValue: string
  modelMenuHeight: number
  modelPlaceholder: string
  modelSuggestions: string[]
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenProviderSettings?: () => void
  overlayPanelRef: React.RefObject<HTMLDivElement | null>
  panelError: string | null
  providerMenuHeight: number
  renderedMessages: AgentSidebarMessage[]
  resolvedSelectedProviderValue: string
  roundFileChangesByMessageId: Map<string, AgentMessageFileChange[]>
  sessionButtonRef: React.RefObject<HTMLButtonElement | null>
  sessionStatus: AgentSessionStatus | null
  setActiveComposerMenu: React.Dispatch<React.SetStateAction<AgentComposerMenu>>
  setActiveOverlayPanel: React.Dispatch<React.SetStateAction<'sessions' | null>>
  setComposerState: React.Dispatch<React.SetStateAction<ComposerState>>
  setIsModelInputFullySelected: React.Dispatch<React.SetStateAction<boolean>>
  setIsResizingComposer: React.Dispatch<React.SetStateAction<boolean>>
  setModelDrafts: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setModelInputValue: React.Dispatch<React.SetStateAction<string>>
  setPanelError: React.Dispatch<React.SetStateAction<string | null>>
  syncModelInputSelectionState: (input: HTMLInputElement) => void
  syncModelInputSelectionStateNextFrame: (input: HTMLInputElement) => void
  statusMessage: string | null
  thinkingLevelLabel: string
  thinkingMenuHeight: number
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

const THINKING_LEVEL_LABELS: Record<AgentThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
}

function formatThinkingLevelLabel(level: AgentThinkingLevel) {
  return THINKING_LEVEL_LABELS[level] ?? level
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
  const modelInputRef = useRef<HTMLInputElement | null>(null)
  const overlayPanelRef = useRef<HTMLDivElement | null>(null)
  const sessionButtonRef = useRef<HTMLButtonElement | null>(null)
  const previousSessionPathRef = useRef<string | null>(null)
  const fileAutoOpenStateRef = useRef<AgentFileAutoOpenState>(initialAgentFileAutoOpenState)
  const restorableSessionPath = agentState.activeSession?.sessionPath
    && agentState.sessions.some((session) => session.path === agentState.activeSession?.sessionPath)
    ? agentState.activeSession.sessionPath
    : null
  const [isModelInputFullySelected, setIsModelInputFullySelected] = useState(false)

  function syncModelInputSelectionState(input: HTMLInputElement) {
    const hasFullSelection = input.value.length > 0
      && input.selectionStart === 0
      && input.selectionEnd === input.value.length

    setIsModelInputFullySelected(hasFullSelection)
  }

  function syncModelInputSelectionStateNextFrame(input: HTMLInputElement) {
    requestAnimationFrame(() => {
      syncModelInputSelectionState(input)
    })
  }

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

      setActiveComposerMenu(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
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

  async function handleThinkingLevelSelection(level: AgentThinkingLevel) {
    if (!workspacePath) {
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

      const nextState = await window.appApi.selectAgentThinkingLevel(level)
      setAgentState(nextState)
      setActiveComposerMenu(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to switch the thinking level.')
    } finally {
      setIsSwitchingThinkingLevel(false)
    }
  }

  async function handleModelInputCommit() {
    const nextModel = modelInputValue.trim()
    const nextModelKey = `${resolvedSelectedProviderValue}/${nextModel}`

    if (!nextModel || nextModelKey === agentState.runtime.selectedModel) {
      return
    }

    await handleSelectModel(nextModelKey)
  }

  async function handleProviderSelectionChange(nextProvider: string) {
    if (panelError) {
      setPanelError(null)
    }
    setSelectedProviderValue(nextProvider)
    const nextProviderModels = Array.from(new Set(
      agentState.runtime.availableModels
        .filter((model) => model.startsWith(`${nextProvider}/`))
        .map((model) => model.split('/').slice(1).join('/')),
    ))
    setModelInputValue(modelDrafts[nextProvider] ?? getRuntimePreferredModelId(nextProvider) ?? nextProviderModels[0] ?? '')
    setActiveComposerMenu(null)
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
  const canChooseProvider = configuredProviders.length > 1
  const resolvedSelectedProviderValue = configuredProviders.includes(selectedProviderValue)
    ? selectedProviderValue
    : configuredProviders[0] ?? selectedProviderValue
  const providerModelIds = Array.from(new Set(
    agentState.runtime.availableModels
      .filter((model) => model.startsWith(`${resolvedSelectedProviderValue}/`))
      .map((model) => model.split('/').slice(1).join('/')),
  ))
  const modelSuggestions = isModelInputFullySelected
    ? providerModelIds
    : providerModelIds.filter((modelId) => {
      const query = modelInputValue.trim().toLowerCase()
      return !query || modelId.toLowerCase().includes(query)
    })
  const canChooseThinkingLevel = agentState.runtime.availableThinkingLevels.length > 1
    && agentState.runtime.hasConfiguredModels
  const thinkingLevelLabel = formatThinkingLevelLabel(agentState.runtime.thinkingLevel)
  const providerMenuHeight = getAgentComposerMenuHeight(configuredProviders.length)
  const modelMenuHeight = getAgentComposerMenuHeight(modelSuggestions.length)
  const thinkingMenuHeight = getAgentComposerMenuHeight(agentState.runtime.availableThinkingLevels.length)
  const modelPlaceholder = 'model'
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
    if (!canChooseProvider && activeComposerMenu === 'provider') {
      setActiveComposerMenu(null)
    }

    if (!canChooseThinkingLevel && activeComposerMenu === 'thinking') {
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
    canChooseProvider,
    canChooseThinkingLevel,
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
    canChooseProvider,
    canChooseThinkingLevel,
    canSend,
    composerHeight,
    composerResizeStateRef,
    composerState,
    configuredProviders,
    deletingSessionPath,
    handleComposerKeyDown,
    handleCreateSession,
    handleDeleteSession,
    handleModelInputCommit,
    handleOpenSession,
    handleProviderSelectionChange,
    handleSelectModel,
    handleThinkingLevelSelection,
    handleStartNewSession,
    handleSubmit,
    hasConfiguredProviders,
    iconTheme,
    isCreatingSession,
    isLoading,
    isModelInputFullySelected,
    isResizingComposer,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    liveTools,
    messagesScrollRef,
    modelFieldRef,
    modelInputRef,
    modelInputValue,
    modelMenuHeight,
    modelPlaceholder,
    modelSuggestions,
    onOpenMessageFile,
    onOpenProviderSettings,
    overlayPanelRef,
    panelError,
    providerMenuHeight,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionButtonRef,
    sessionStatus,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setIsModelInputFullySelected,
    setIsResizingComposer,
    setModelDrafts,
    setModelInputValue,
    setPanelError,
    syncModelInputSelectionState,
    syncModelInputSelectionStateNextFrame,
    statusMessage,
    thinkingLevelLabel,
    thinkingMenuHeight,
    workspacePath,
    workspaceTree,
  }), [
    activeComposerMenu,
    activeOverlayPanel,
    activeSession,
    activeSessionSelection,
    activeSessionPath,
    agentState,
    canChooseProvider,
    canChooseThinkingLevel,
    canSend,
    composerHeight,
    composerState,
    configuredProviders,
    deletingSessionPath,
    handleComposerKeyDown,
    handleCreateSession,
    handleDeleteSession,
    handleModelInputCommit,
    handleOpenSession,
    handleProviderSelectionChange,
    handleSelectModel,
    handleThinkingLevelSelection,
    handleStartNewSession,
    handleSubmit,
    hasConfiguredProviders,
    iconTheme,
    isCreatingSession,
    isLoading,
    isModelInputFullySelected,
    isResizingComposer,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    liveTools,
    modelInputValue,
    modelMenuHeight,
    modelPlaceholder,
    modelSuggestions,
    onOpenMessageFile,
    onOpenProviderSettings,
    panelError,
    providerMenuHeight,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionStatus,
    statusMessage,
    thinkingLevelLabel,
    thinkingMenuHeight,
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
    canChooseProvider,
    canChooseThinkingLevel,
    canSend,
    composerHeight,
    composerResizeStateRef,
    composerState,
    configuredProviders,
    handleComposerKeyDown,
    handleCreateSession,
    handleDeleteSession,
    handleModelInputCommit,
    handleOpenSession,
    handleProviderSelectionChange,
    handleSelectModel,
    handleThinkingLevelSelection,
    handleStartNewSession,
    handleSubmit,
    hasConfiguredProviders,
    iconTheme,
    isCreatingSession,
    deletingSessionPath,
    isLoading,
    isModelInputFullySelected,
    isResizingComposer,
    isSwitchingModel,
    isSwitchingThinkingLevel,
    messagesScrollRef,
    modelFieldRef,
    modelInputRef,
    modelInputValue,
    modelMenuHeight,
    modelPlaceholder,
    modelSuggestions,
    onOpenMessageFile,
    onOpenProviderSettings,
    overlayPanelRef,
    panelError,
    providerMenuHeight,
    renderedMessages,
    resolvedSelectedProviderValue,
    roundFileChangesByMessageId,
    sessionButtonRef,
    sessionStatus,
    setActiveComposerMenu,
    setActiveOverlayPanel,
    setComposerState,
    setIsModelInputFullySelected,
    setIsResizingComposer,
    setModelDrafts,
    setModelInputValue,
    setPanelError,
    syncModelInputSelectionState,
    syncModelInputSelectionStateNextFrame,
    statusMessage,
    thinkingLevelLabel,
    thinkingMenuHeight,
    workspacePath,
    workspaceTree,
  } = useAgentContext()
  const hasEmptyChat = Boolean(workspacePath && renderedMessages.length === 0)
  const isNewConversation = activeSessionSelection.kind === 'new'
    || (hasEmptyChat && !activeSession)
  const composerMenuRootStyle = {
    '--agent-composer-menu-height': `${
      activeComposerMenu === 'provider'
        ? providerMenuHeight
        : activeComposerMenu === 'thinking'
          ? thinkingMenuHeight
          : modelMenuHeight
    }px`,
  } as CSSProperties
  const composerFooter = (
    <div ref={modelFieldRef} className='agent-composer-meta'>
      <div className='agent-composer-toolbar'>
        <div className='agent-composer-actions'>
          <div className='agent-model-field'>
            {hasConfiguredProviders ? (
              <div className='agent-model-composite'>
                <button
                  type='button'
                  aria-expanded={canChooseProvider ? activeComposerMenu === 'provider' : undefined}
                  aria-haspopup={canChooseProvider ? 'listbox' : undefined}
                  aria-label='Provider'
                  className={`agent-provider-trigger${canChooseProvider ? '' : ' is-static'}`}
                  disabled={!workspacePath || isSwitchingModel}
                  onClick={() => {
                    if (!canChooseProvider) {
                      return
                    }
                    setActiveComposerMenu((currentValue) => currentValue === 'provider' ? null : 'provider')
                  }}
                >
                  <span className='agent-provider-trigger-label'>{resolvedSelectedProviderValue}</span>
                </button>

                <span className='agent-model-separator'>/</span>

                <Input
                  aria-label='Model'
                  className='agent-model-input'
                  disabled={!workspacePath || !agentState.runtime.hasConfiguredModels || isSwitchingModel}
                  ref={modelInputRef}
                  onBlur={() => {
                    setIsModelInputFullySelected(false)
                    setActiveComposerMenu((currentValue) => currentValue === 'model' ? null : currentValue)
                    void handleModelInputCommit()
                  }}
                  onChange={(event) => {
                    if (panelError) {
                      setPanelError(null)
                    }
                    setIsModelInputFullySelected(false)
                    setActiveComposerMenu('model')
                    setModelInputValue(event.target.value)
                    setModelDrafts((currentValue) => ({
                      ...currentValue,
                      [resolvedSelectedProviderValue]: event.target.value,
                    }))
                  }}
                  onFocus={(event) => {
                    setActiveComposerMenu('model')
                    const input = event.currentTarget
                    requestAnimationFrame(() => {
                      input.select()
                      syncModelInputSelectionState(input)
                    })
                  }}
                  onSelect={(event) => {
                    syncModelInputSelectionState(event.currentTarget)
                  }}
                  onPointerUp={(event) => {
                    syncModelInputSelectionStateNextFrame(event.currentTarget)
                  }}
                  onKeyUp={(event) => {
                    syncModelInputSelectionStateNextFrame(event.currentTarget)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      setActiveComposerMenu(null)
                      void handleModelInputCommit()
                    }

                    if (event.key === 'Escape') {
                      setActiveComposerMenu(null)
                    }
                  }}
                  placeholder={modelPlaceholder}
                  value={modelInputValue}
                  variant='secondary'
                />

                <button
                  type='button'
                  aria-expanded={canChooseThinkingLevel ? activeComposerMenu === 'thinking' : undefined}
                  aria-haspopup={canChooseThinkingLevel ? 'listbox' : undefined}
                  aria-label={`Thinking level: ${thinkingLevelLabel}`}
                  className={`agent-thinking-trigger${canChooseThinkingLevel ? '' : ' is-static'}`}
                  disabled={
                    !workspacePath
                    || !agentState.runtime.hasConfiguredModels
                    || isSwitchingModel
                    || isSwitchingThinkingLevel
                    || !canChooseThinkingLevel
                  }
                  title={`Thinking: ${thinkingLevelLabel}`}
                  onClick={() => {
                    if (!canChooseThinkingLevel) {
                      return
                    }
                    setActiveComposerMenu((currentValue) => currentValue === 'thinking' ? null : 'thinking')
                  }}
                >
                  <BrainLine size={14} />
                  <span className='agent-thinking-trigger-label'>{thinkingLevelLabel}</span>
                </button>
              </div>
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

      {activeComposerMenu === 'provider' && canChooseProvider ? (
        <AppScrollArea
          className='agent-composer-menu'
          contentClassName='agent-composer-menu-content'
          rootStyle={composerMenuRootStyle}
        >
          <div className='agent-composer-menu-list' role='listbox' aria-label='Available providers'>
            {configuredProviders.map((provider) => (
              <button
                key={provider}
                type='button'
                className={`agent-composer-option${provider === resolvedSelectedProviderValue ? ' is-active' : ''}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  void handleProviderSelectionChange(provider)
                }}
              >
                <span className='agent-composer-option-label'>{provider}</span>
              </button>
            ))}
          </div>
        </AppScrollArea>
      ) : null}

      {activeComposerMenu === 'model' && modelSuggestions.length > 0 ? (
        <AppScrollArea
          className='agent-composer-menu'
          contentClassName='agent-composer-menu-content'
          rootStyle={composerMenuRootStyle}
        >
          <div className='agent-composer-menu-list' role='listbox' aria-label='Available models'>
            {modelSuggestions.map((modelId) => (
              <button
                key={`${resolvedSelectedProviderValue}/${modelId}`}
                type='button'
                className={`agent-composer-option${modelId === modelInputValue ? ' is-active' : ''}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  if (panelError) {
                    setPanelError(null)
                  }
                  setModelInputValue(modelId)
                  setModelDrafts((currentValue) => ({
                    ...currentValue,
                    [resolvedSelectedProviderValue]: modelId,
                  }))
                  setActiveComposerMenu(null)
                  void handleSelectModel(`${resolvedSelectedProviderValue}/${modelId}`)
                }}
              >
                <span className='agent-composer-option-label'>{modelId}</span>
              </button>
            ))}
          </div>
        </AppScrollArea>
      ) : null}

      {activeComposerMenu === 'thinking' && canChooseThinkingLevel ? (
        <AppScrollArea
          className='agent-composer-menu'
          contentClassName='agent-composer-menu-content'
          rootStyle={composerMenuRootStyle}
        >
          <div className='agent-composer-menu-list' role='listbox' aria-label='Available thinking levels'>
            {agentState.runtime.availableThinkingLevels.map((level) => (
              <button
                key={level}
                type='button'
                className={`agent-composer-option${level === agentState.runtime.thinkingLevel ? ' is-active' : ''}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => {
                  void handleThinkingLevelSelection(level)
                }}
              >
                <BrainLine size={14} />
                <span className='agent-composer-option-label'>{formatThinkingLevelLabel(level)}</span>
              </button>
            ))}
          </div>
        </AppScrollArea>
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

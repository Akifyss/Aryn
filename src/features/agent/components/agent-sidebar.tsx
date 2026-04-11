import { type CSSProperties, FormEvent, KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, TextArea } from '@heroui/react'
import {
  AddLine,
  Delete2Line,
  SendPlaneLine,
} from '@mingcute/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import spinners, { type BrailleSpinnerName } from 'unicode-animations'
import { AppScrollArea } from '@/components/app-scroll-area'
import type {
  AgentClientEvent,
  AgentSidebarMessage,
  AgentSidebarMessageStatus,
  AgentWorkspaceState,
} from '@/features/agent/types'

type AgentSidebarProps = {
  onOpenProviderSettings?: () => void
  onWorkspaceStateChange?: (state: AgentWorkspaceState) => void
  workspacePath: string | null
}

type LiveToolState = {
  id: string
  name: string
  status: AgentSidebarMessageStatus
  summary: string
  isError?: boolean
}

type AuthProviderKey = 'google' | 'openai' | 'openrouter'

const KNOWN_AGENT_PROVIDERS = ['google', 'openai', 'openrouter'] as const
const MARKDOWN_PLUGINS = [remarkGfm]

const emptyAgentState: AgentWorkspaceState = {
  activeSession: null,
  runtime: {
    auth: {
      google: {
        envVarName: 'GEMINI_API_KEY',
        hasStoredCredential: false,
        source: 'none',
        usesEnvironmentCredential: false,
      },
      openai: {
        envVarName: 'OPENAI_API_KEY',
        hasStoredCredential: false,
        source: 'none',
        usesEnvironmentCredential: false,
      },
      openrouter: {
        envVarName: 'OPENROUTER_API_KEY',
        hasStoredCredential: false,
        source: 'none',
        usesEnvironmentCredential: false,
      },
    },
    availableModels: [],
    compactionReason: null,
    followUpMessageCount: 0,
    followUpMode: 'one-at-a-time',
    hasConfiguredModels: false,
    isCompacting: false,
    isStreaming: false,
    pendingMessageCount: 0,
    retryAttempt: 0,
    retryMaxAttempts: null,
    selectedModel: null,
    setupHint: null,
    steeringMessageCount: 0,
    steeringMode: 'one-at-a-time',
    workspacePath: null,
  },
  sessions: [],
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSessionLabel(name: string | null) {
  return name ?? 'Untitled session'
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
  const provider = KNOWN_AGENT_PROVIDERS.includes(providerCandidate as AuthProviderKey)
    ? providerCandidate as AuthProviderKey
    : ''

  return {
    modelId: modelIdParts.length > 0 ? modelIdParts.join('/') : formatModelLabel(modelKey),
    provider,
  }
}

function isProviderConfigured(state: AgentWorkspaceState['runtime']['auth'][AuthProviderKey]) {
  return state.source !== 'none'
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

function AgentMarkdown({ text }: { text: string }) {
  return (
    <div className='agent-markdown'>
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a href={href} rel='noreferrer' target='_blank'>
              {children}
            </a>
          ),
        }}
        remarkPlugins={MARKDOWN_PLUGINS}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function AgentDisclosure({
  children,
  defaultExpanded = false,
  expanded,
  label,
}: {
  children: ReactNode
  defaultExpanded?: boolean
  expanded?: boolean
  label: string
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const resolvedExpanded = expanded ?? isExpanded

  return (
    <div className='agent-disclosure'>
      <button
        aria-expanded={resolvedExpanded}
        className='agent-disclosure-toggle'
        type='button'
        onClick={() => {
          if (expanded !== undefined) {
            return
          }

          setIsExpanded((currentValue) => !currentValue)
        }}
      >
        <span className={`agent-message-toggle-caret ${resolvedExpanded ? 'is-open' : ''}`} aria-hidden='true' />
        <span className='agent-disclosure-label'>{label}</span>
      </button>
      {resolvedExpanded ? (
        <div className='agent-disclosure-body'>
          {children}
        </div>
      ) : null}
    </div>
  )
}

function AgentMessageBubble({ message }: { message: AgentSidebarMessage }) {
  const isToolMessage = message.kind === 'tool'
  const isCollapsibleSystemMessage = (message.kind === 'system' || message.kind === 'custom')
    && (message.title === 'Compaction summary' || message.title === 'Branch summary')
  const messageStatus = getMessageStatus(message)
  const [isExpanded, setIsExpanded] = useState(messageStatus === 'error' || messageStatus === 'running')

  useEffect(() => {
    if (!isToolMessage) {
      return
    }

    if (messageStatus === 'running' || messageStatus === 'error') {
      setIsExpanded(true)
      return
    }

    setIsExpanded(false)
  }, [isToolMessage, message.id, messageStatus])

  if (isToolMessage) {
    return (
      <article className={`agent-message agent-message-tool ${messageStatus === 'running' ? 'is-running' : ''} ${message.isError ? 'is-error' : ''}`}>
        <button
          aria-expanded={isExpanded}
          className='agent-message-toggle'
          type='button'
          onClick={() => {
            setIsExpanded((currentValue) => !currentValue)
          }}
        >
          <span className={`agent-message-toggle-caret ${isExpanded ? 'is-open' : ''}`} aria-hidden='true' />
          <span className='agent-message-role'>{message.title ?? 'Tool'}</span>
          {message.label ? <span className='agent-message-label'>{message.label}</span> : null}
          <span className={`agent-message-status agent-message-status-${messageStatus}`}>
            {getToolStatusLabel(messageStatus)}
          </span>
        </button>

        {isExpanded ? (
          <div className='agent-message-body'>
            <AgentMarkdown text={message.text} />
          </div>
        ) : null}
      </article>
    )
  }

  if (isCollapsibleSystemMessage) {
    return (
      <article className={`agent-message agent-message-system agent-message-system-collapsible ${message.isError ? 'is-error' : ''}`}>
        <div className='agent-message-meta'>
          <span className='agent-message-role'>{message.title ?? message.kind}</span>
        </div>
        <AgentDisclosure label='Details'>
          <AgentMarkdown text={message.text} />
        </AgentDisclosure>
      </article>
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
          <AgentDisclosure expanded={message.isThinkingStreaming} label='Thinking'>
            <AgentMarkdown text={message.thinkingText} />
          </AgentDisclosure>
        ) : null}
        {message.text.trim() ? <AgentMarkdown text={message.text} /> : null}
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

export function AgentSidebar({ onOpenProviderSettings, onWorkspaceStateChange, workspacePath }: AgentSidebarProps) {
  const defaultModelSelection = parseModelSelection(null)
  const [composerHeight, setComposerHeight] = useState(172)
  const [hasLoadedComposerHeight, setHasLoadedComposerHeight] = useState(false)
  const [agentState, setAgentState] = useState<AgentWorkspaceState>(emptyAgentState)
  const [composerValue, setComposerValue] = useState('')
  const [modelInputValue, setModelInputValue] = useState(defaultModelSelection.modelId)
  const [selectedProviderValue, setSelectedProviderValue] = useState(defaultModelSelection.provider)
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({
    [defaultModelSelection.provider]: defaultModelSelection.modelId,
  })
  const [activeComposerMenu, setActiveComposerMenu] = useState<'model' | 'provider' | null>(null)
  const [draftAssistant, setDraftAssistant] = useState('')
  const [draftThinking, setDraftThinking] = useState('')
  const [isThinkingStreaming, setIsThinkingStreaming] = useState(false)
  const [liveTools, setLiveTools] = useState<LiveToolState[]>([])
  const [activeOverlayPanel, setActiveOverlayPanel] = useState<'sessions' | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [deletingSessionPath, setDeletingSessionPath] = useState<string | null>(null)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
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
  const restorableSessionPath = agentState.activeSession?.sessionPath ?? null
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
        setLiveTools([])
        setActiveComposerMenu(null)
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

      if (event.type === 'error') {
        setPanelError(event.message)
      }
    })

    return unsubscribe
  }, [agentState.activeSession?.sessionId])

  useEffect(() => {
    if (!workspacePath) {
      setAgentState(emptyAgentState)
      setComposerValue('')
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
      return
    }

    setIsLoading(true)
    setPanelError(null)
    setHasLoadedWorkspaceState(false)

    void window.appApi.getWorkspaceState(workspacePath)
      .then((workspaceState) => window.appApi.loadAgentWorkspace(workspacePath, workspaceState.lastAgentSessionPath))
      .then((nextState) => {
        setAgentState(nextState)
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

  const renderedMessages = useMemo(() => {
    const persistedMessages = agentState.activeSession?.messages ?? []
    const toolMessages: AgentSidebarMessage[] = liveTools.map((tool) => ({
      id: `live-tool-${tool.id}`,
      isError: tool.isError,
      kind: 'tool',
      status: tool.status,
      text: tool.summary,
      timestamp: Date.now(),
      title: tool.name,
    }))

    const nextMessages = [...persistedMessages, ...toolMessages]

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
  }, [agentState.activeSession?.messages, draftAssistant, draftThinking, isThinkingStreaming, liveTools])

  async function handleCreateSession() {
    if (!workspacePath) {
      return
    }

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

      if (!agentState.activeSession) {
        const nextState = await window.appApi.createAgentSession(workspacePath)
        setAgentState(nextState)
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
    setModelInputValue(modelDrafts[nextProvider] ?? nextProviderModels[0] ?? '')
    setActiveComposerMenu(null)
  }

  async function submitComposerPrompt(streamingBehavior?: 'steer' | 'followUp') {
    const trimmedPrompt = composerValue.trim()

    if (!workspacePath || !trimmedPrompt) {
      return
    }

    try {
      setPanelError(null)

      if (!agentState.activeSession) {
        const nextState = await window.appApi.createAgentSession(workspacePath)
        setAgentState(nextState)
      }

      await window.appApi.sendAgentPrompt(trimmedPrompt, streamingBehavior)
      setComposerValue('')
      setDraftAssistant('')
      setLiveTools([])
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to send your prompt.')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await submitComposerPrompt(agentState.runtime.isStreaming ? 'steer' : undefined)
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitComposerPrompt(event.altKey ? 'followUp' : agentState.runtime.isStreaming ? 'steer' : undefined)
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

  const configuredProviders = KNOWN_AGENT_PROVIDERS.filter((provider) => isProviderConfigured(agentState.runtime.auth[provider]))
  const hasConfiguredProviders = configuredProviders.length > 0
  const canChooseProvider = configuredProviders.length > 1
  const resolvedSelectedProviderValue = configuredProviders.includes(selectedProviderValue as AuthProviderKey)
    ? selectedProviderValue
    : configuredProviders[0] ?? selectedProviderValue
  const activeSessionPath = agentState.activeSession?.sessionPath ?? null
  const activeSession = agentState.sessions.find((session) => session.path === activeSessionPath) ?? null
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
  const modelPlaceholder = 'model'
  const canSend = Boolean(workspacePath && composerValue.trim() && agentState.runtime.hasConfiguredModels)
  const statusMessage = !workspacePath
    ? 'Open a workspace to start.'
    : !agentState.runtime.hasConfiguredModels
      ? (agentState.runtime.setupHint ?? 'Configure a model first.')
      : null
  const runningTools = liveTools.filter((tool) => tool.status === 'running')
  const sessionPhase = useMemo(() => deriveAgentSessionPhase({
    draftAssistant,
    isStreaming: agentState.runtime.isStreaming,
    isThinkingStreaming,
    panelError,
    pendingMessageCount: agentState.runtime.pendingMessageCount,
    retryAttempt: agentState.runtime.retryAttempt,
    runningTools,
    runtime: agentState.runtime,
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
    panelError,
    runningTools,
    workspacePath,
  ])
  const sessionStatus = useMemo(
    () => sessionPhase ? formatAgentSessionStatus(sessionPhase, agentState.runtime.pendingMessageCount) : null,
    [agentState.runtime.pendingMessageCount, sessionPhase],
  )
  const sessionStatusKey = sessionStatus
    ? `${sessionStatus.label}:${sessionStatus.badge?.label ?? ''}`
    : 'none'
  const renderedMessageCount = renderedMessages.length

  useEffect(() => {
    if (!canChooseProvider && activeComposerMenu === 'provider') {
      setActiveComposerMenu(null)
    }

    if (!hasConfiguredProviders) {
      return
    }

    if (resolvedSelectedProviderValue === selectedProviderValue) {
      return
    }

    setSelectedProviderValue(resolvedSelectedProviderValue)
    setModelInputValue(modelDrafts[resolvedSelectedProviderValue] ?? providerModelIds[0] ?? '')
  }, [
    activeComposerMenu,
    canChooseProvider,
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
  }, [activeSessionPath, draftAssistant, draftThinking, liveTools, renderedMessageCount, sessionStatusKey])

  return (
    <div className='agent-shell'>
      <div className='agent-threadbar'>
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
              {activeSession ? formatSessionLabel(activeSession.name) : 'Session'}
            </span>
          </button>
        </div>

        <div className='agent-threadbar-drag-spacer' aria-hidden='true' />

        <div className='agent-threadbar-actions'>
          <button
            type='button'
            disabled={!workspacePath || isCreatingSession}
            className='agent-toolbar-button'
            aria-label='Create session'
            onClick={() => {
              void handleCreateSession()
            }}
          >
            <AddLine size={16} />
          </button>
        </div>
      </div>

      {activeOverlayPanel ? (
        <div className='agent-overlay-layer'>
          <div ref={overlayPanelRef} className='agent-floating-panel'>
            {activeOverlayPanel === 'sessions' ? (
              <AppScrollArea className='agent-overlay-scroll'>
                <div className='agent-session-list'>
                  <div className='agent-session-option'>
                    <button
                      type='button'
                      className='agent-session-select-button'
                      disabled={!workspacePath || isCreatingSession}
                      onClick={() => {
                        void handleCreateSession()
                      }}
                    >
                      <div className='agent-select-item'>
                        <span className='agent-select-item-title'>New Session</span>
                      </div>
                    </button>
                  </div>

                  {agentState.sessions.map((session) => {
                    const isActive = session.path === activeSessionPath
                    const isDeleting = deletingSessionPath === session.path

                    return (
                      <div key={session.path} className={`agent-session-option ${isActive ? 'is-active' : ''}`}>
                        <button
                          type='button'
                          className='agent-session-select-button'
                          disabled={isDeleting}
                          onClick={() => {
                            void handleOpenSession(session.path)
                          }}
                        >
                          <div className='agent-select-item'>
                            <span className='agent-select-item-title'>{session.name ?? 'Untitled session'}</span>
                            <span className='agent-select-item-meta'>{formatSessionTime(session.modifiedAt)}</span>
                          </div>
                        </button>

                        <Button
                          aria-label='Delete session'
                          isIconOnly
                          isDisabled={isDeleting}
                          size='sm'
                          variant='ghost'
                          className='agent-session-delete-button'
                          onPress={() => {
                            void handleDeleteSession(session.path)
                          }}
                        >
                          <Delete2Line size={14} />
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </AppScrollArea>
            ) : null}
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
        <div className='agent-messages'>
          {workspacePath && renderedMessages.length === 0 ? (
            <div className='agent-empty-chat'>
              <p>Start a session to inspect, edit, or create files in this workspace.</p>
            </div>
          ) : renderedMessages.map((message) => (
            <AgentMessageBubble key={message.id} message={message} />
          ))}
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
            className={`agent-composer-resize-handle${isResizingComposer ? ' is-active' : ''}`}
            onPointerDown={(event) => {
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

          <TextArea
            aria-label='Prompt Pi Agent'
            className='agent-composer-input'
            disabled={!workspacePath || isLoading}
            onChange={(event) => {
              setComposerValue(event.target.value)
            }}
            onKeyDown={handleComposerKeyDown}
            placeholder={workspacePath ? 'Message' : 'Open a folder first.'}
            rows={3}
            value={composerValue}
            variant='secondary'
          />

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
                  <SendPlaneLine size={16} />
                </Button>
              </div>
            </div>

            {activeComposerMenu === 'provider' && canChooseProvider ? (
              <AppScrollArea
                className='agent-composer-menu'
                contentClassName='agent-composer-menu-content'
              >
                <div role='listbox' aria-label='Available providers'>
                  {configuredProviders.map((provider) => (
                    <button
                      key={provider}
                      type='button'
                      className={`agent-composer-option ${provider === resolvedSelectedProviderValue ? 'is-active' : ''}`}
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
              >
                <div role='listbox' aria-label='Available models'>
                  {modelSuggestions.map((modelId) => (
                    <button
                      key={`${resolvedSelectedProviderValue}/${modelId}`}
                      type='button'
                      className='agent-composer-option'
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
          </div>
        </div>
      </form>
    </div>
  )
}

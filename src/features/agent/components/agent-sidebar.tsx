import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, ListBox, ScrollShadow, Select, TextArea } from '@heroui/react'
import {
  AddLine,
  SendPlaneLine,
  StopCircleLine,
} from '@mingcute/react'
import type {
  AgentClientEvent,
  AgentSidebarMessage,
  AgentWorkspaceState,
} from '@/features/agent/types'

type AgentSidebarProps = {
  workspacePath: string | null
}

type LiveToolState = {
  id: string
  name: string
  summary: string
  isError?: boolean
}

const OPENROUTER_PREFIX = 'openrouter/'
const DEFAULT_MODEL_VALUE = 'google/gemini-3.1-flash-lite-preview'

const emptyAgentState: AgentWorkspaceState = {
  activeSession: null,
  runtime: {
    availableModels: [],
    hasConfiguredModels: false,
    isStreaming: false,
    selectedModel: null,
    setupHint: null,
    workspacePath: null,
  },
  sessions: [],
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function formatSessionTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatSessionLabel(name: string | null, modifiedAt: string) {
  return `${name ?? 'Untitled session'} / ${formatSessionTime(modifiedAt)}`
}

function formatModelLabel(modelKey: string | null) {
  if (!modelKey) {
    return DEFAULT_MODEL_VALUE
  }

  return modelKey.startsWith(OPENROUTER_PREFIX)
    ? modelKey.slice(OPENROUTER_PREFIX.length)
    : modelKey
}

function AgentMessageBubble({ message }: { message: AgentSidebarMessage }) {
  const showMeta = message.kind === 'tool' || message.kind === 'system'

  return (
    <article className={`agent-message agent-message-${message.kind} ${message.isError ? 'is-error' : ''}`}>
      {showMeta ? (
        <div className='agent-message-meta'>
          <span className='agent-message-role'>{message.title ?? message.kind}</span>
          <span className='agent-message-time'>{formatTimestamp(message.timestamp)}</span>
        </div>
      ) : null}

      <div className='agent-message-body'>
        <p>{message.text}</p>
      </div>
    </article>
  )
}

export function AgentSidebar({ workspacePath }: AgentSidebarProps) {
  const [composerHeight, setComposerHeight] = useState(172)
  const [hasLoadedComposerHeight, setHasLoadedComposerHeight] = useState(false)
  const [agentState, setAgentState] = useState<AgentWorkspaceState>(emptyAgentState)
  const [composerValue, setComposerValue] = useState('')
  const [modelInputValue, setModelInputValue] = useState('')
  const [draftAssistant, setDraftAssistant] = useState('')
  const [liveTools, setLiveTools] = useState<LiveToolState[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false)
  const composerResizeStateRef = useRef<{ pointerId: number, startHeight: number, startY: number } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const restorableSessionPath = agentState.activeSession?.messages.length
    ? agentState.activeSession.sessionPath
    : null

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
        setModelInputValue(formatModelLabel(event.state.runtime.selectedModel))
        setDraftAssistant('')
        setLiveTools([])
        return
      }

      if (
        event.type === 'assistant_message_started'
        && event.sessionId === agentState.activeSession?.sessionId
      ) {
        setDraftAssistant('')
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
            summary: event.summary,
          },
        ])
        return
      }

      if (
        event.type === 'tool_execution_finished'
        && event.sessionId === agentState.activeSession?.sessionId
      ) {
        setLiveTools((currentTools) => currentTools.map((tool) => {
          if (tool.id !== event.toolCallId) {
            return tool
          }

          return {
            ...tool,
            isError: event.isError,
            summary: event.summary,
          }
        }))
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
      setModelInputValue(DEFAULT_MODEL_VALUE)
      setDraftAssistant('')
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
        setModelInputValue(formatModelLabel(nextState.runtime.selectedModel))
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [agentState.activeSession?.messages.length, draftAssistant, liveTools])

  const renderedMessages = useMemo(() => {
    const persistedMessages = agentState.activeSession?.messages ?? []
    const toolMessages: AgentSidebarMessage[] = liveTools.map((tool) => ({
      id: `live-tool-${tool.id}`,
      isError: tool.isError,
      kind: 'tool',
      text: tool.summary,
      timestamp: Date.now(),
      title: tool.name,
    }))

    const nextMessages = [...persistedMessages, ...toolMessages]

    if (draftAssistant.trim()) {
      nextMessages.push({
        id: 'draft-assistant',
        kind: 'assistant',
        text: draftAssistant,
        timestamp: Date.now(),
      })
    }

    return nextMessages
  }, [agentState.activeSession?.messages, draftAssistant, liveTools])

  async function handleCreateSession() {
    if (!workspacePath) {
      return
    }

    try {
      setIsCreatingSession(true)
      setPanelError(null)
      const nextState = await window.appApi.createAgentSession(workspacePath)
      setAgentState(nextState)
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
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to open that session.')
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
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to switch the model.')
    } finally {
      setIsSwitchingModel(false)
    }
  }

  async function handleModelInputCommit() {
    const nextModel = modelInputValue.trim()

    if (!nextModel || nextModel === formatModelLabel(agentState.runtime.selectedModel)) {
      return
    }

    await handleSelectModel(nextModel)
  }

  async function handleAbort() {
    try {
      setPanelError(null)
      const nextState = await window.appApi.abortAgentPrompt()
      setAgentState(nextState)
      setDraftAssistant('')
      setLiveTools([])
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to stop the current turn.')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!workspacePath || !composerValue.trim()) {
      return
    }

    try {
      setPanelError(null)

      if (!agentState.activeSession) {
        const nextState = await window.appApi.createAgentSession(workspacePath)
        setAgentState(nextState)
      }

      await window.appApi.sendAgentPrompt(composerValue)
      setComposerValue('')
      setDraftAssistant('')
      setLiveTools([])
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to send your prompt.')
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  useEffect(() => {
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
        document.body.style.userSelect = ''
        composerResizeStateRef.current = null
      }
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [])

  const activeSessionPath = agentState.activeSession?.sessionPath ?? null
  const activeSession = agentState.sessions.find((session) => session.path === activeSessionPath) ?? null
  const canSend = Boolean(workspacePath && composerValue.trim()) && !agentState.runtime.isStreaming
  const statusMessage = panelError
    ?? (!workspacePath
      ? 'Open a workspace to start.'
      : !agentState.runtime.hasConfiguredModels
        ? (agentState.runtime.setupHint ?? 'Configure a model first.')
        : null)

  return (
    <div className='agent-shell'>
      <div className='agent-threadbar'>
        <div className='agent-session-select'>
          <Select
            id='agent-session-select'
            isDisabled={!workspacePath || agentState.sessions.length === 0}
            onSelectionChange={(key) => {
              if (typeof key === 'string') {
                void handleOpenSession(key)
              }
            }}
            placeholder='Session'
            selectedKey={activeSessionPath ?? undefined}
            variant='secondary'
          >
            <Select.Trigger className='agent-select-trigger'>
              <Select.Value>
                <span className='agent-select-current'>
                  {activeSession ? formatSessionLabel(activeSession.name, activeSession.modifiedAt) : 'Session'}
                </span>
              </Select.Value>
            </Select.Trigger>
            <Select.Popover className='agent-select-popover'>
              <ListBox aria-label='Agent sessions'>
                {agentState.sessions.map((session) => (
                  <ListBox.Item id={session.path} key={session.path} textValue={formatSessionLabel(session.name, session.modifiedAt)}>
                    <div className='agent-select-item'>
                      <span className='agent-select-item-title'>{session.name ?? 'Untitled session'}</span>
                      <span className='agent-select-item-meta'>{formatSessionTime(session.modifiedAt)}</span>
                    </div>
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </div>

        <div className='agent-threadbar-actions'>
          <Button
            isIconOnly
            isDisabled={!workspacePath || isCreatingSession}
            size='sm'
            variant='ghost'
            className='agent-icon-button'
            onPress={() => {
              void handleCreateSession()
            }}
          >
            <AddLine size={16} />
          </Button>
        </div>
      </div>

      {statusMessage ? (
        <div className={`agent-status-inline ${panelError ? 'is-error' : ''}`}>
          <p>{statusMessage}</p>
        </div>
      ) : null}

      <ScrollShadow className='agent-messages-scroll' hideScrollBar>
        <div className='agent-messages'>
          {workspacePath && renderedMessages.length === 0 ? (
            <div className='agent-empty-chat'>
              <p>Start a session to inspect, edit, or create files in this workspace.</p>
            </div>
          ) : renderedMessages.map((message) => (
            <AgentMessageBubble key={message.id} message={message} />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </ScrollShadow>

      <form
        className='agent-composer'
        onSubmit={(event) => {
          void handleSubmit(event)
        }}
      >
        <div className='agent-composer-shell' style={{ '--agent-composer-height': `${composerHeight}px` } as React.CSSProperties}>
          <div
            aria-hidden='true'
            className='agent-composer-resize-handle'
            onPointerDown={(event) => {
              event.preventDefault()
              document.body.style.userSelect = 'none'
              event.currentTarget.setPointerCapture(event.pointerId)
              composerResizeStateRef.current = {
                pointerId: event.pointerId,
                startHeight: composerHeight,
                startY: event.clientY,
              }
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
            placeholder={workspacePath ? 'Message Codex. Use @ for context and / for commands.' : 'Open a folder first.'}
            rows={3}
            value={composerValue}
            variant='secondary'
          />

          <div className='agent-composer-toolbar'>
            <div className='agent-composer-actions'>
              <div className='agent-model-field'>
                <Input
                  aria-label='Model'
                  className='agent-model-input'
                  disabled={!workspacePath || !agentState.runtime.hasConfiguredModels || isSwitchingModel}
                  onBlur={() => {
                    void handleModelInputCommit()
                  }}
                  onChange={(event) => {
                    setModelInputValue(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void handleModelInputCommit()
                    }
                  }}
                  placeholder={DEFAULT_MODEL_VALUE}
                  value={modelInputValue}
                  variant='secondary'
                />
              </div>

              <Button
                isIconOnly
                isDisabled={!agentState.runtime.isStreaming}
                size='sm'
                variant='ghost'
                className='agent-icon-button'
                onPress={() => {
                  void handleAbort()
                }}
              >
                <StopCircleLine size={16} />
              </Button>

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
        </div>
      </form>
    </div>
  )
}

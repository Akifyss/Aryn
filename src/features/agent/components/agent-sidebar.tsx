import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, ScrollShadow, TextArea } from '@heroui/react'
import {
  AddLine,
  Delete2Line,
  SendPlaneLine,
  StopCircleLine,
} from '@mingcute/react'
import type {
  AgentClientEvent,
  AgentProviderAuthState,
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

type AgentOverlayPanel = 'auth' | 'sessions' | null
type AuthProviderKey = 'google' | 'openai' | 'openrouter'

const DEFAULT_MODEL_VALUE = 'google/gemini-3.1-flash-lite-preview'
const KNOWN_AGENT_PROVIDERS: AuthProviderKey[] = ['google', 'openai', 'openrouter']

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
    return DEFAULT_MODEL_VALUE.split('/').slice(1).join('/')
  }

  const parts = modelKey.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelKey
}

function parseModelSelection(modelKey: string | null): { modelId: string, provider: string } {
  if (!modelKey) {
    return {
      modelId: formatModelLabel(DEFAULT_MODEL_VALUE),
      provider: 'google',
    }
  }

  const [providerCandidate, ...modelIdParts] = modelKey.split('/')
  const provider = KNOWN_AGENT_PROVIDERS.includes(providerCandidate as AuthProviderKey)
    ? providerCandidate as AuthProviderKey
    : 'google'

  return {
    modelId: modelIdParts.length > 0 ? modelIdParts.join('/') : formatModelLabel(modelKey),
    provider,
  }
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
  const [selectedProviderValue, setSelectedProviderValue] = useState('google')
  const [draftAssistant, setDraftAssistant] = useState('')
  const [liveTools, setLiveTools] = useState<LiveToolState[]>([])
  const [authDrafts, setAuthDrafts] = useState<Record<AuthProviderKey, string>>({
    google: '',
    openai: '',
    openrouter: '',
  })
  const [activeOverlayPanel, setActiveOverlayPanel] = useState<AgentOverlayPanel>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [deletingSessionPath, setDeletingSessionPath] = useState<string | null>(null)
  const [isSwitchingModel, setIsSwitchingModel] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [hasLoadedWorkspaceState, setHasLoadedWorkspaceState] = useState(false)
  const authButtonRef = useRef<HTMLButtonElement | null>(null)
  const composerResizeStateRef = useRef<{ pointerId: number, startHeight: number, startY: number } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const overlayPanelRef = useRef<HTMLDivElement | null>(null)
  const sessionButtonRef = useRef<HTMLButtonElement | null>(null)
  const restorableSessionPath = agentState.activeSession?.sessionPath ?? null

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
        setModelInputValue(nextModelSelection.modelId)
        setSelectedProviderValue(nextModelSelection.provider)
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
        const nextModelSelection = parseModelSelection(nextState.runtime.selectedModel)
        setModelInputValue(nextModelSelection.modelId)
        setSelectedProviderValue(nextModelSelection.provider)
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
      setAuthDrafts({
        google: '',
        openai: '',
        openrouter: '',
      })
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

      if (sessionButtonRef.current?.contains(target) || authButtonRef.current?.contains(target)) {
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

  const authProviders: Array<{
    key: AuthProviderKey
    label: string
    placeholder: string
    state: AgentProviderAuthState
  }> = [
    {
      key: 'openrouter',
      label: 'OpenRouter',
      placeholder: 'sk-or-v1-...',
      state: agentState.runtime.auth.openrouter,
    },
    {
      key: 'openai',
      label: 'OpenAI',
      placeholder: 'sk-...',
      state: agentState.runtime.auth.openai,
    },
    {
      key: 'google',
      label: 'Google Gemini',
      placeholder: 'GEMINI_API_KEY / API key',
      state: agentState.runtime.auth.google,
    },
  ]

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
      setModelInputValue(nextModelSelection.modelId)
      setSelectedProviderValue(nextModelSelection.provider)
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
      setModelInputValue(nextModelSelection.modelId)
      setSelectedProviderValue(nextModelSelection.provider)
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
      setModelInputValue(nextModelSelection.modelId)
      setSelectedProviderValue(nextModelSelection.provider)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to switch the model.')
    } finally {
      setIsSwitchingModel(false)
    }
  }

  async function handleModelInputCommit() {
    const nextModel = modelInputValue.trim()
    const nextModelKey = `${selectedProviderValue}/${nextModel}`

    if (!nextModel || nextModelKey === agentState.runtime.selectedModel) {
      return
    }

    await handleSelectModel(nextModelKey)
  }

  async function handleProviderSelectionChange(nextProvider: string) {
    setSelectedProviderValue(nextProvider)

    const nextModel = modelInputValue.trim()
    if (!nextModel) {
      return
    }

    const nextModelKey = `${nextProvider}/${nextModel}`
    if (nextModelKey === agentState.runtime.selectedModel) {
      return
    }

    await handleSelectModel(nextModelKey)
  }

  async function handleSaveProviderAuth(provider: AuthProviderKey, apiKey: string | null) {
    if (!workspacePath) {
      return
    }

    try {
      setIsSavingAuth(true)
      setPanelError(null)
      const nextState = await window.appApi.updateAgentProviderAuth(workspacePath, provider, apiKey)
      setAgentState(nextState)
      setAuthDrafts((currentValue) => ({
        ...currentValue,
        [provider]: '',
      }))
      if (apiKey?.trim()) {
        setActiveOverlayPanel(null)
      }
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to update provider authentication.')
    } finally {
      setIsSavingAuth(false)
    }
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
  const availableProviders = Array.from(new Set([
    ...KNOWN_AGENT_PROVIDERS,
    ...agentState.runtime.availableModels.map((model) => model.split('/')[0]),
  ]))
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
              {activeSession ? formatSessionLabel(activeSession.name, activeSession.modifiedAt) : 'Session'}
            </span>
          </button>
        </div>

        <div className='agent-threadbar-actions'>
          <Button
            ref={authButtonRef}
            size='sm'
            variant='ghost'
            className='agent-setup-button'
            onPress={() => {
              setActiveOverlayPanel((currentValue) => currentValue === 'auth' ? null : 'auth')
            }}
          >
            Auth
          </Button>

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

      {activeOverlayPanel ? (
        <div className='agent-overlay-layer'>
          <div ref={overlayPanelRef} className='agent-floating-panel'>
            {activeOverlayPanel === 'sessions' ? (
              <>
                <ScrollShadow className='agent-overlay-scroll' hideScrollBar>
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
                </ScrollShadow>
              </>
            ) : (
              <div className='agent-auth-form'>
                {authProviders.map((provider) => {
                  const draftValue = authDrafts[provider.key]

                  return (
                    <section key={provider.key} className='agent-auth-provider'>
                      <div className='agent-auth-provider-copy'>
                        <span className='agent-auth-provider-label'>{provider.label}</span>
                        <span className='agent-auth-provider-meta'>
                          {provider.state.source === 'stored'
                            ? 'Using saved key'
                            : provider.state.source === 'env'
                              ? `Using ${provider.state.envVarName}`
                              : `No key saved. ${provider.state.envVarName} also works.`}
                        </span>
                      </div>

                      <Input
                        aria-label={`${provider.label} API key`}
                        className='agent-auth-input'
                        disabled={!workspacePath || isSavingAuth}
                        onChange={(event) => {
                          setAuthDrafts((currentValue) => ({
                            ...currentValue,
                            [provider.key]: event.target.value,
                          }))
                        }}
                        placeholder={provider.placeholder}
                        type='password'
                        value={draftValue}
                        variant='secondary'
                      />

                      <div className='agent-auth-actions'>
                        <Button
                          isDisabled={!workspacePath || isSavingAuth || !draftValue.trim()}
                          size='sm'
                          variant='ghost'
                          className='agent-auth-save'
                          onPress={() => {
                            void handleSaveProviderAuth(provider.key, draftValue)
                          }}
                        >
                          Save Key
                        </Button>

                        <Button
                          isDisabled={!workspacePath || isSavingAuth || !provider.state.hasStoredCredential}
                          size='sm'
                          variant='ghost'
                          className='agent-auth-clear'
                          onPress={() => {
                            void handleSaveProviderAuth(provider.key, null)
                          }}
                        >
                          Remove Saved
                        </Button>
                      </div>
                    </section>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}

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
            placeholder={workspacePath ? 'Message' : 'Open a folder first.'}
            rows={3}
            value={composerValue}
            variant='secondary'
          />

          <div className='agent-composer-toolbar'>
            <div className='agent-composer-actions'>
              <div className='agent-model-field'>
                <div className='agent-model-composite'>
                  <label className='agent-provider-select-wrap'>
                    <span className='sr-only'>Provider</span>
                    <select
                      aria-label='Provider'
                      className='agent-provider-select'
                      disabled={!workspacePath || isSwitchingModel}
                      onChange={(event) => {
                        void handleProviderSelectionChange(event.target.value)
                      }}
                      value={selectedProviderValue}
                    >
                      {availableProviders.map((provider) => (
                        <option key={provider} value={provider}>{provider}</option>
                      ))}
                    </select>
                  </label>

                  <span className='agent-model-separator'>/</span>

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
                    placeholder={formatModelLabel(DEFAULT_MODEL_VALUE)}
                    value={modelInputValue}
                    variant='secondary'
                  />
                </div>
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

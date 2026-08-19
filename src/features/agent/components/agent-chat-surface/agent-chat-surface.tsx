import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  DownLine,
  EditLine,
} from '@mingcute/react'
import { AppLoadingState } from '@/components/app-loading-state'
import { AppIconButton } from '@/components/app-icon-button'
import { AppMenu as Menu, shouldCloseClickOpenedMenu } from '@/components/app-menu'
import { AgentComposerSurface } from '@/features/agent/components/agent-composer-surface/agent-composer-surface'
import { BbSessionTimeline } from '@/features/agent/components/bb-session-timeline/bb-session-timeline'
import { preloadBbSessionSurface } from '@/features/agent/components/bb-session-timeline/bb-session-surface-loader'
import { AgentMessageViewport } from '@/features/agent/components/agent-message-viewport/agent-message-viewport'
import { AgentNewConversationPrompt } from '@/features/agent/components/agent-new-conversation-prompt/agent-new-conversation-prompt'
import {
  AgentSessionTreeView,
  type AgentSessionTreeProps,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import { useAgentContext } from '@/features/agent/components/agent-sidebar/agent-sidebar-context'
import {
  shouldShowAgentNewConversationPrompt,
  shouldShowAgentProjectSessionMenu,
  shouldShowAgentThreadbarSessionControl,
} from '@/features/agent/lib/agent-surface-state'
import { buildBbSessionRuntimeState } from '@/features/agent/lib/bb-session-runtime-state'
import { toBbCodexOptimisticMessages } from '@/features/agent/lib/optimistic-user-messages'
import { formatAgentSessionLabel } from '@/features/agent/lib/session-tree'
import './styles.css'

const AGENT_SESSION_MENU_POSITIONER_PROPS = {
  positionMethod: 'fixed',
  side: 'bottom',
  // This is a full session browser rather than a short action list.
  sideOffset: 8,
} as const

function isAgentTreeMenuEventTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('[data-agent-tree-menu-root="true"]'))
}

export function AgentSessionTree(props: AgentSessionTreeProps) {
  const controller = useAgentContext()
  return <AgentSessionTreeView {...props} controller={controller} />
}

export function AgentChatSurface() {
  const {
    activeOverlayPanel,
    activeSession,
    activeWorkspaceContext,
    agentState,
    codexNativeSession,
    codexOptimisticUserMessages,
    conversationState,
    draftAssistant,
    draftThinking,
    handleStartNewSession,
    iconTheme,
    isAgentLayout,
    isSessionLoading,
    showSessionLoadingIndicator,
    isViewingActiveRuntime,
    interactionTimelineRecords,
    isThinkingStreaming,
    liveTools,
    messagesScrollElement,
    messagesScrollViewportRef,
    onOpenMessageFile,
    onStartStandaloneConversation,
    openCodeNativeSession,
    openCodeOptimisticUserMessages,
    piWebFileChanges,
    piWebNativeSession,
    piWebOptimisticUserMessages,
    panelError,
    projectState,
    renderedMessages,
    roundFileChangesByMessageId,
    sessionStatus,
    setActiveOverlayPanel,
    statusMessage,
    stoppingPrompt,
    streamStartedAt,
    surfaceMode,
    theme,
    visibleSessionPath,
    visibleSessionSelection,
    workspacePath,
  } = useAgentContext()
  const isNewConversation = shouldShowAgentNewConversationPrompt(
    activeWorkspaceContext,
    visibleSessionSelection,
  )
  const showThreadbarSessionControl = shouldShowAgentThreadbarSessionControl(
    activeWorkspaceContext,
    visibleSessionSelection,
  )
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => (
        project.id === activeWorkspaceContext.projectId
      )) ?? null
    : null
  const showProjectSessionMenu = shouldShowAgentProjectSessionMenu(activeWorkspaceContext)
  const activeConversation = activeWorkspaceContext.kind === 'conversation'
    ? conversationState.conversations.find((conversation) => (
        conversation.id === activeWorkspaceContext.conversationId
      )) ?? null
    : null
  const activeConversationTitle = activeConversation?.title.trim() ?? ''
  const activeSessionSelectLabel = isNewConversation
    ? '新对话'
    : activeConversationTitle || formatAgentSessionLabel(activeSession)
  const handleOpenWorkspaceFileFromMessage = useCallback((filePath: string) => {
    void onOpenMessageFile?.(filePath, 'updated')
  }, [onOpenMessageFile])
  const nativeSession = codexNativeSession ?? openCodeNativeSession ?? piWebNativeSession
  const shouldPreloadUnifiedSurface = isSessionLoading || Boolean(nativeSession)
  const unifiedSessionId = codexNativeSession?.thread.id
    ?? piWebNativeSession?.sessionId
    ?? visibleSessionPath
    ?? activeSession?.path
    ?? 'agent-session'
  const unifiedOptimisticUserMessages = useMemo(() => {
    const messages = codexNativeSession
      ? toBbCodexOptimisticMessages(codexOptimisticUserMessages)
      : openCodeNativeSession
        ? openCodeOptimisticUserMessages
        : piWebOptimisticUserMessages
    return messages.map((message) => ({ ...message }))
  }, [
    codexNativeSession,
    codexOptimisticUserMessages,
    openCodeNativeSession,
    openCodeOptimisticUserMessages,
    piWebOptimisticUserMessages,
  ])
  const unifiedFileChanges = useMemo(() => (
    piWebNativeSession
      ? piWebFileChanges.map((change) => ({
          kind: change.kind,
          path: change.filePath,
        }))
      : []
  ), [piWebFileChanges, piWebNativeSession])
  const unifiedInteractionRecords = useMemo(() => (
    nativeSession
      ? interactionTimelineRecords.filter((record) => (
          record.request.agentId === nativeSession.agentId
          && record.request.sessionId === unifiedSessionId
        ))
      : []
  ), [interactionTimelineRecords, nativeSession, unifiedSessionId])
  const unifiedRuntimeState = useMemo(() => {
    return buildBbSessionRuntimeState({
      activeSessionPath: visibleSessionPath,
      agentId: nativeSession?.agentId ?? null,
      assistantText: draftAssistant,
      isThinkingStreaming,
      isViewingActiveRuntime,
      liveTools,
      panelError,
      runtime: agentState.runtime,
      startedAt: streamStartedAt,
      stoppingPrompt,
      thinkingText: draftThinking,
    })
  }, [
    agentState.runtime,
    draftAssistant,
    draftThinking,
    isThinkingStreaming,
    isViewingActiveRuntime,
    liveTools,
    nativeSession,
    panelError,
    stoppingPrompt,
    streamStartedAt,
    visibleSessionPath,
  ])
  const [localOverlayRoot, setLocalOverlayRoot] = useState<HTMLDivElement | null>(null)
  const handleLocalOverlayRootRef = useCallback((node: HTMLDivElement | null) => {
    setLocalOverlayRoot(node)
  }, [])
  const sessionMenuPortalTarget = typeof document === 'undefined'
    ? null
    : surfaceMode === 'drawer'
      ? localOverlayRoot
      : document.body

  useEffect(() => {
    if (!shouldPreloadUnifiedSurface) return
    void preloadBbSessionSurface().catch(() => undefined)
  }, [shouldPreloadUnifiedSurface])

  useEffect(() => {
    if (!showProjectSessionMenu && activeOverlayPanel === 'sessions') {
      setActiveOverlayPanel(null)
    }
  }, [activeOverlayPanel, showProjectSessionMenu, setActiveOverlayPanel])

  const threadbarNewButton = !isNewConversation ? (
    <AppIconButton
      type='button'
      disabled={!workspacePath}
      className='agent-threadbar-new-button'
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
      <EditLine />
    </AppIconButton>
  ) : null

  return (
    <div className={`agent-shell${isNewConversation ? ' is-new-conversation' : ''}`}>
      <div className='agent-threadbar'>
        <div className='agent-threadbar-leading'>
          {isAgentLayout ? threadbarNewButton : null}

          {showThreadbarSessionControl ? (
            <div className='agent-session-select'>
              {showProjectSessionMenu ? (
                <Menu.Root
                  modal={false}
                  open={activeOverlayPanel === 'sessions'}
                  onOpenChange={(open, details) => {
                    if (open) {
                      setActiveOverlayPanel('sessions')
                      return
                    }

                    if (
                      details.reason === 'outside-press'
                      && isAgentTreeMenuEventTarget(details.event.target)
                    ) {
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
                    size='md'
                    variant='ghost'
                  >
                    <span className='agent-select-current'>
                      {activeSessionSelectLabel}
                    </span>
                    <DownLine
                      aria-hidden='true'
                      className='agent-session-trigger-arrow'
                    />
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
                          size='lg'
                        >
                          <AgentSessionTree
                            className='agent-session-tree-floating'
                            id='agent-session-tree-floating'
                            isFloating
                            menuPortalTarget={
                              surfaceMode === 'drawer' ? localOverlayRoot : null
                            }
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
          ) : null}

          {isAgentLayout ? null : threadbarNewButton}
        </div>

        <div className='agent-threadbar-drag-spacer' aria-hidden='true' />
      </div>
      <div ref={handleLocalOverlayRootRef} className='agent-local-overlay-root' />

      {showSessionLoadingIndicator ? (
        <AppLoadingState
          className='agent-session-loading-state'
          label='正在加载会话'
        />
      ) : isNewConversation ? (
        <div className='agent-new-conversation-stage'>
          {statusMessage ? (
            <div className='agent-status-inline'>
              <p>{statusMessage}</p>
            </div>
          ) : null}
          <div className='agent-new-conversation-content'>
            <AgentNewConversationPrompt
              menuPortalTarget={
                surfaceMode === 'drawer' ? localOverlayRoot : undefined
              }
            />
          </div>
        </div>
      ) : (
        <>
          {statusMessage ? (
            <div className='agent-status-inline'>
              <p>{statusMessage}</p>
            </div>
          ) : null}

          {workspacePath && nativeSession ? (
            <BbSessionTimeline
              fileChanges={unifiedFileChanges}
              interactionRecords={unifiedInteractionRecords}
              snapshot={nativeSession}
              optimisticUserMessages={unifiedOptimisticUserMessages}
              runtimeState={unifiedRuntimeState}
              onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
              sessionId={unifiedSessionId}
              theme={theme}
              workspacePath={workspacePath}
            />
          ) : (
            <AgentMessageViewport
              activeSessionPath={visibleSessionPath}
              iconTheme={iconTheme}
              messages={renderedMessages}
              messagesScrollElement={messagesScrollElement}
              messagesScrollViewportRef={messagesScrollViewportRef}
              onOpenMessageFile={onOpenMessageFile}
              onOpenWorkspaceFile={handleOpenWorkspaceFileFromMessage}
              roundFileChangesByMessageId={roundFileChangesByMessageId}
              sessionStatus={sessionStatus}
              workspacePath={workspacePath}
            />
          )}
        </>
      )}
      <AgentComposerSurface
        activeProject={activeProject}
        isNewConversation={isNewConversation}
        localOverlayRoot={localOverlayRoot}
      />
    </div>
  )
}

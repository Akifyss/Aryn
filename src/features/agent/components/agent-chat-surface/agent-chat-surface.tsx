import {
  useCallback,
  useEffect,
  useState,
} from 'react'
import {
  DownLine,
  EditLine,
} from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import { AppMenu as Menu, shouldCloseClickOpenedMenu } from '@/components/app-menu'
import { AgentComposerSurface } from '@/features/agent/components/agent-composer-surface/agent-composer-surface'
import { AgentMessageViewport } from '@/features/agent/components/agent-message-viewport/agent-message-viewport'
import { AgentNewConversationPrompt } from '@/features/agent/components/agent-new-conversation-prompt/agent-new-conversation-prompt'
import {
  AgentSessionTreeView,
  type AgentSessionTreeProps,
} from '@/features/agent/components/agent-session-tree/agent-session-tree'
import { useAgentContext } from '@/features/agent/components/agent-sidebar/agent-sidebar-context'
import { CodexSessionTimeline } from '@/features/agent/components/codex-session-timeline/codex-session-timeline'
import { shouldShowAgentNewConversationPrompt } from '@/features/agent/lib/agent-surface-state'
import { formatAgentSessionLabel } from '@/features/agent/lib/session-tree'
import './styles.css'

const AGENT_SESSION_MENU_POSITIONER_PROPS = {
  className: 'agent-session-menu-positioner',
  collisionAvoidance: { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
  collisionPadding: 8,
  positionMethod: 'fixed',
  side: 'bottom',
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
    activeSessionPath,
    activeSessionSelection,
    activeWorkspaceContext,
    codexNativeSession,
    codexOptimisticUserMessages,
    conversationState,
    handleOpenSession,
    handleStartNewSession,
    iconTheme,
    isAgentLayout,
    messagesScrollElement,
    messagesScrollViewportRef,
    onOpenMessageFile,
    onStartStandaloneConversation,
    openCodeNativeSession,
    openCodeOptimisticUserMessages,
    piWebFileChanges,
    piWebNativeSession,
    piWebOptimisticUserMessages,
    piWebStreamingStatus,
    projectState,
    renderedMessages,
    roundFileChangesByMessageId,
    sessionStatus,
    setActiveOverlayPanel,
    statusMessage,
    surfaceMode,
    workspacePath,
  } = useAgentContext()
  const isNewConversation = shouldShowAgentNewConversationPrompt(
    activeWorkspaceContext,
    activeSessionSelection,
  )
  const canOpenSessionMenu = Boolean(
    workspacePath && activeWorkspaceContext.kind === 'project',
  )
  const activeProject = activeWorkspaceContext.kind === 'project'
    ? projectState.projects.find((project) => (
        project.id === activeWorkspaceContext.projectId
      )) ?? null
    : null
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
    if (!canOpenSessionMenu && activeOverlayPanel === 'sessions') {
      setActiveOverlayPanel(null)
    }
  }, [activeOverlayPanel, canOpenSessionMenu, setActiveOverlayPanel])

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
      <EditLine size={16} />
    </AppIconButton>
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
                    size={14}
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
                        layout='compound'
                        size='fit'
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
                menuPortalTarget={
                  surfaceMode === 'drawer' ? localOverlayRoot : undefined
                }
              />
            </div>
          </div>
          <AgentComposerSurface
            activeProject={activeProject}
            isNewConversation={isNewConversation}
            localOverlayRoot={localOverlayRoot}
          />
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

          <AgentComposerSurface
            activeProject={activeProject}
            isNewConversation={isNewConversation}
            localOverlayRoot={localOverlayRoot}
          />
        </>
      )}
    </div>
  )
}

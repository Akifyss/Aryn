import { useMemo } from 'react'
import type { OpenCodeOptimisticUserMessage } from '@aryn/opencode-session-surface'
import type {
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
} from '@aryn/pi-web-session-surface'
import { AppScrollArea } from '@/components/app-scroll-area'
import {
  AgentMessageBubble,
  AgentMessageFileCards,
} from '@/features/agent/components/agent-message/agent-message'
import {
  AgentSessionStatusBubble,
  type AgentSessionStatus,
} from '@/features/agent/components/agent-session-status/agent-session-status'
import {
  AgentVirtualMessageList,
  type AgentVirtualMessageListItem,
} from './agent-virtual-message-list'
import { OpenCodeSessionTimeline } from '@/features/agent/components/opencode-session-timeline'
import { PiWebSessionTimeline } from '@/features/agent/components/pi-web-session-timeline'
import type {
  AgentMessageFileChange,
  AgentSidebarMessage,
  OpenCodeNativeSessionSnapshot,
} from '@/features/agent/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import './styles.css'

const AGENT_MESSAGE_VIRTUALIZATION_MIN_ITEMS = 12

type AgentMessageViewportProps = {
  activeSessionPath: string | null
  iconTheme?: WorkspaceIconTheme | null
  messages: AgentSidebarMessage[]
  messagesScrollElement: HTMLDivElement | null
  messagesScrollViewportRef: (element: HTMLDivElement | null) => void
  onNavigateToOpenCodeSession: (sessionId: string) => void
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenWorkspaceFile?: (filePath: string) => void
  openCodeNativeSession: OpenCodeNativeSessionSnapshot | null
  openCodeOptimisticUserMessages: OpenCodeOptimisticUserMessage[]
  piWebFileChanges: AgentMessageFileChange[]
  piWebNativeSession: PiWebNativeSessionSnapshot | null
  piWebOptimisticUserMessages: PiWebOptimisticUserMessage[]
  piWebStreamingStatus: AgentSessionStatus | null
  roundFileChangesByMessageId: ReadonlyMap<string, AgentMessageFileChange[]>
  sessionStatus: AgentSessionStatus | null
  workspacePath: string | null
}

function AgentMessageViewportEntry({
  fileChanges,
  iconTheme,
  message,
  onOpenMessageFile,
  onOpenWorkspaceFile,
  workspacePath,
}: {
  fileChanges: AgentMessageFileChange[]
  iconTheme?: WorkspaceIconTheme | null
  message: AgentSidebarMessage
  onOpenMessageFile?: (filePath: string, changeKind: AgentMessageFileChange['kind']) => void
  onOpenWorkspaceFile?: (filePath: string) => void
  workspacePath: string | null
}) {
  return (
    <>
      <AgentMessageBubble
        iconTheme={iconTheme}
        message={message}
        onOpenWorkspaceFile={onOpenWorkspaceFile}
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
    </>
  )
}

export function AgentMessageViewport({
  activeSessionPath,
  iconTheme,
  messages,
  messagesScrollElement,
  messagesScrollViewportRef,
  onNavigateToOpenCodeSession,
  onOpenMessageFile,
  onOpenWorkspaceFile,
  openCodeNativeSession,
  openCodeOptimisticUserMessages,
  piWebFileChanges,
  piWebNativeSession,
  piWebOptimisticUserMessages,
  piWebStreamingStatus,
  roundFileChangesByMessageId,
  sessionStatus,
  workspacePath,
}: AgentMessageViewportProps) {
  const virtualMessageItems = useMemo<AgentVirtualMessageListItem[]>(() => {
    const messageItems = messages.map((message) => ({
      content: (
        <AgentMessageViewportEntry
          fileChanges={roundFileChangesByMessageId.get(message.id) ?? []}
          iconTheme={iconTheme}
          message={message}
          onOpenMessageFile={onOpenMessageFile}
          onOpenWorkspaceFile={onOpenWorkspaceFile}
          workspacePath={workspacePath}
        />
      ),
      key: `message:${message.id}`,
    }))

    if (!sessionStatus) {
      return messageItems
    }

    return [
      ...messageItems,
      {
        content: <AgentSessionStatusBubble status={sessionStatus} />,
        key: `status:${sessionStatus.label}:${sessionStatus.badges?.map((badge) => `${badge.kind}:${badge.label}`).join('|') ?? ''}`,
      },
    ]
  }, [
    iconTheme,
    messages,
    onOpenMessageFile,
    onOpenWorkspaceFile,
    roundFileChangesByMessageId,
    sessionStatus,
    workspacePath,
  ])
  const shouldVirtualizeMessages = virtualMessageItems.length >= AGENT_MESSAGE_VIRTUALIZATION_MIN_ITEMS

  return (
    <AppScrollArea
      className='agent-messages-scroll'
      contentClassName='agent-messages-scroll-content'
      viewportClassName='agent-messages-scroll-viewport'
      viewportRef={messagesScrollViewportRef}
    >
      <div
        className={`agent-messages${shouldVirtualizeMessages ? ' agent-messages-virtual' : ''}`}
        data-agent-virtual-enabled={openCodeNativeSession || piWebNativeSession
          ? undefined
          : (shouldVirtualizeMessages ? 'true' : 'false')}
        data-agent-virtual-total-items={openCodeNativeSession || piWebNativeSession
          ? undefined
          : virtualMessageItems.length}
      >
        {openCodeNativeSession ? (
          <OpenCodeSessionTimeline
            sessionID={activeSessionPath!}
            workspacePath={workspacePath!}
            optimisticUserMessages={openCodeOptimisticUserMessages}
            onNavigateToSession={onNavigateToOpenCodeSession}
            onOpenWorkspaceFile={onOpenWorkspaceFile}
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
                onOpenWorkspaceFile={onOpenWorkspaceFile}
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
            items={virtualMessageItems}
            messagesScrollElement={messagesScrollElement}
          />
        ) : (
          <>
            {messages.map((message) => {
              const fileChanges = roundFileChangesByMessageId.get(message.id) ?? []

              return (
                <div key={message.id} className='agent-message-stack'>
                  <AgentMessageViewportEntry
                    fileChanges={fileChanges}
                    iconTheme={iconTheme}
                    message={message}
                    onOpenMessageFile={onOpenMessageFile}
                    onOpenWorkspaceFile={onOpenWorkspaceFile}
                    workspacePath={workspacePath}
                  />
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
  )
}

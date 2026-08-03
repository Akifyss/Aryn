import { useMemo } from 'react'
import { findLatestOpenableAgentFileChange } from '@/features/agent/auto-open-file'
import {
  deriveAgentSessionPhase,
  formatAgentSessionStatus,
} from '@/features/agent/components/agent-session-status/agent-session-status'
import { mergeFileChangesByPath } from '@/features/agent/file-change-utils'
import { buildRoundFileChangesByMessageId } from '@/features/agent/round-file-changes'
import type { AgentLiveToolState } from '@/features/agent/runtime/use-agent-runtime-events'
import type {
  AgentRuntimeState,
  AgentSessionSnapshot,
  AgentSidebarMessage,
} from '@/features/agent/types'
import type { AgentMessageViewportContentRevisions } from './use-agent-message-viewport-scroll'

type BuildRenderedAgentMessagesOptions = {
  draftAssistant: string
  draftThinking: string
  isThinkingStreaming: boolean
  isViewingActiveRuntime: boolean
  liveTools: AgentLiveToolState[]
  optimisticUserMessages: AgentSidebarMessage[]
  persistedMessages: AgentSidebarMessage[]
}

export function buildRenderedAgentMessages({
  draftAssistant,
  draftThinking,
  isThinkingStreaming,
  isViewingActiveRuntime,
  liveTools,
  optimisticUserMessages,
  persistedMessages,
}: BuildRenderedAgentMessagesOptions) {
  const nextMessages = [...persistedMessages, ...optimisticUserMessages]
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
}

type UseAgentMessagePresentationOptions = {
  drafts: {
    assistant: string
    isThinkingStreaming: boolean
    thinking: string
  }
  panelError: string | null
  runtime: {
    active: AgentRuntimeState
    isViewingActive: boolean
    liveTools: AgentLiveToolState[]
    visible: AgentRuntimeState
  }
  session: {
    optimisticUserMessages: AgentSidebarMessage[]
    persistedMessages: AgentSidebarMessage[]
    snapshot: AgentSessionSnapshot | null
  }
  workspacePath: string | null
}

export function useAgentMessagePresentation({
  drafts,
  panelError,
  runtime,
  session,
  workspacePath,
}: UseAgentMessagePresentationOptions) {
  const renderedMessages = useMemo(() => buildRenderedAgentMessages({
    draftAssistant: drafts.assistant,
    draftThinking: drafts.thinking,
    isThinkingStreaming: drafts.isThinkingStreaming,
    isViewingActiveRuntime: runtime.isViewingActive,
    liveTools: runtime.liveTools,
    optimisticUserMessages: session.optimisticUserMessages,
    persistedMessages: session.persistedMessages,
  }), [
    drafts.assistant,
    drafts.isThinkingStreaming,
    drafts.thinking,
    runtime.isViewingActive,
    runtime.liveTools,
    session.optimisticUserMessages,
    session.persistedMessages,
  ])
  const runningTools = runtime.liveTools.filter((tool) => tool.status === 'running')
  const hasVisibleRunningContent = session.persistedMessages.some((message) => (
    message.status === 'running'
    && (
      message.kind === 'tool'
      || Boolean(message.text.trim())
      || Boolean(message.thinkingText?.trim())
    )
  ))
  const sessionPhase = useMemo(() => deriveAgentSessionPhase({
    draftAssistant: drafts.assistant,
    hasRunningTools: runtime.isViewingActive && runningTools.length > 0,
    hasVisibleRunningContent,
    isStreaming: runtime.visible.isStreaming,
    isThinkingStreaming: drafts.isThinkingStreaming,
    panelError,
    pendingMessageCount: runtime.visible.pendingMessageCount,
    retryAttempt: runtime.visible.retryAttempt,
    runtime: runtime.visible,
    workspacePath,
  }), [
    drafts.assistant,
    drafts.isThinkingStreaming,
    drafts.thinking,
    hasVisibleRunningContent,
    panelError,
    runningTools.length,
    runtime.active.compactionReason,
    runtime.active.hasConfiguredModels,
    runtime.active.isCompacting,
    runtime.active.isStreaming,
    runtime.active.pendingMessageCount,
    runtime.active.retryAttempt,
    runtime.isViewingActive,
    runtime.visible,
    workspacePath,
  ])
  const sessionStatus = useMemo(
    () => sessionPhase ? formatAgentSessionStatus(sessionPhase, {
      followUpMessageCount: runtime.visible.followUpMessageCount,
      pendingMessageCount: runtime.visible.pendingMessageCount,
      steeringMessageCount: runtime.visible.steeringMessageCount,
    }) : null,
    [
      runtime.visible.followUpMessageCount,
      runtime.visible.pendingMessageCount,
      runtime.visible.steeringMessageCount,
      sessionPhase,
    ],
  )
  const roundFileChangesByMessageId = useMemo(() => {
    const hasInFlightRound = runtime.isViewingActive && (
      runtime.liveTools.length > 0
      || Boolean(drafts.assistant.trim() || drafts.thinking.trim())
      || runtime.active.isStreaming
      || runtime.active.pendingMessageCount > 0
    )

    return buildRoundFileChangesByMessageId({
      annotations: session.snapshot?.annotations ?? { fileChangesByEntryId: {} },
      hasInFlightRound,
      messages: session.persistedMessages,
    })
  }, [
    drafts.assistant,
    drafts.thinking,
    runtime.active.isStreaming,
    runtime.active.pendingMessageCount,
    runtime.isViewingActive,
    runtime.liveTools.length,
    session.persistedMessages,
    session.snapshot?.annotations,
  ])
  const piWebFileChanges = useMemo(() => mergeFileChangesByPath(
    Object.values(session.snapshot?.annotations.fileChangesByEntryId ?? {}).flat(),
  ), [session.snapshot?.annotations.fileChangesByEntryId])
  const contentRevisions: AgentMessageViewportContentRevisions = {
    assistantDraft: drafts.assistant,
    fileChanges: [...roundFileChangesByMessageId.entries()]
      .flatMap(([messageId, changes]) => changes.map((change) => `${messageId}:${change.kind}:${change.filePath}`))
      .join('|'),
    liveTools: runtime.liveTools,
    renderedMessageCount: renderedMessages.length,
    sessionStatus: sessionStatus
      ? `${sessionStatus.label}:${sessionStatus.badges?.map((badge) => `${badge.kind}:${badge.label}`).join('|') ?? ''}`
      : 'none',
    thinkingDraft: drafts.thinking,
  }
  const latestAutoOpenFileChange = useMemo(() => (
    findLatestOpenableAgentFileChange(session.persistedMessages, roundFileChangesByMessageId)
  ), [roundFileChangesByMessageId, session.persistedMessages])

  return {
    contentRevisions,
    latestAutoOpenFileChange,
    piWebFileChanges,
    renderedMessages,
    roundFileChangesByMessageId,
    sessionStatus,
  }
}

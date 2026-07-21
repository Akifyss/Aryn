import {
  type Dispatch,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react'
import {
  hasAgentComposerPayload,
  type AgentComposerAttachment,
  type AgentComposerState,
} from './use-agent-composer-draft'
import type { AgentId } from '@/features/agent/agent-definition'
import type {
  AgentInteractionRequest,
  AgentQueuedMessageUpdate,
  AgentRunningPromptBehavior,
  AgentWorkspaceState,
} from '@/features/agent/types'
import {
  getAlternateRunningPromptBehavior,
  type AgentRunningPromptEnterBehavior,
} from '@/hooks/use-settings-store'

type UseAgentComposerActionsOptions = {
  agentState: AgentWorkspaceState
  closeComposerMenu: () => void
  composerAttachmentsRef: RefObject<AgentComposerAttachment[]>
  composerStateRef: RefObject<AgentComposerState>
  effectiveRunningPromptEnterBehavior: AgentRunningPromptEnterBehavior
  isAgentSessionOperationCurrent: (
    agentId: AgentId,
    sessionPath: string,
    workspacePath: string,
  ) => boolean
  isViewingActiveRuntime: boolean
  pendingInteractions: AgentInteractionRequest[]
  resetRunDrafts: () => void
  selectedAgentId: AgentId
  setAgentState: Dispatch<SetStateAction<AgentWorkspaceState>>
  setPanelError: Dispatch<SetStateAction<string | null>>
  setPendingInteractions: Dispatch<SetStateAction<AgentInteractionRequest[]>>
  submitComposerPrompt: (streamingBehavior?: AgentRunningPromptEnterBehavior) => Promise<void>
  workspacePath: string | null
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

export function resolveSupportedRunningPromptBehavior(
  supportedBehaviors: AgentRunningPromptBehavior[],
  requestedBehavior: AgentRunningPromptEnterBehavior,
): AgentRunningPromptEnterBehavior {
  return supportedBehaviors.includes(requestedBehavior)
    ? requestedBehavior
    : supportedBehaviors[0] ?? 'followUp'
}

export function useAgentComposerActions({
  agentState,
  closeComposerMenu,
  composerAttachmentsRef,
  composerStateRef,
  effectiveRunningPromptEnterBehavior,
  isAgentSessionOperationCurrent,
  isViewingActiveRuntime,
  pendingInteractions,
  resetRunDrafts,
  selectedAgentId,
  setAgentState,
  setPanelError,
  setPendingInteractions,
  submitComposerPrompt,
  workspacePath,
}: UseAgentComposerActionsOptions) {
  async function handleQueuedMessageUpdate(update: AgentQueuedMessageUpdate) {
    const sessionPath = agentState.activeSession?.sessionPath
    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    if (!sessionPath || !requestWorkspacePath) {
      setPanelError('Open a session before editing queued messages.')
      return
    }
    try {
      closeComposerMenu()
      setPanelError(null)
      const nextState = await window.appApi.updateAgentQueuedMessage({
        agentId: requestAgentId,
        sessionPath,
        workspacePath: requestWorkspacePath,
      }, update)
      if (
        !isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)
        || nextState.activeSession?.sessionPath !== sessionPath
      ) {
        return
      }
      setAgentState(nextState)
    } catch (error) {
      if (isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)) {
        setPanelError(error instanceof Error ? error.message : 'Unable to update queued message.')
      }
      throw error
    }
  }

  async function stopActivePrompt() {
    const sessionPath = agentState.activeSession?.sessionPath
    const requestAgentId = selectedAgentId
    const requestWorkspacePath = workspacePath
    if (!requestWorkspacePath || !sessionPath || !isViewingActiveRuntime || !agentState.runtime.isStreaming) {
      return
    }

    try {
      closeComposerMenu()
      setPanelError(null)
      const nextState = await window.appApi.abortAgentPrompt({
        agentId: requestAgentId,
        sessionPath,
        workspacePath: requestWorkspacePath,
      })
      if (
        !isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)
        || nextState.activeSession?.sessionPath !== sessionPath
      ) {
        return
      }
      setAgentState(nextState)
      resetRunDrafts()
    } catch (error) {
      if (isAgentSessionOperationCurrent(requestAgentId, sessionPath, requestWorkspacePath)) {
        setPanelError(error instanceof Error ? error.message : 'Unable to stop the current run.')
      }
    }
  }

  async function respondToInteraction(
    requestId: string,
    optionId: string,
    values?: string[],
    answers?: Record<string, string[]>,
  ) {
    try {
      setPanelError(null)
      const request = pendingInteractions.find((candidate) => (
        candidate.agentId === selectedAgentId
        && candidate.id === requestId
        && candidate.sessionId === agentState.activeSession?.sessionId
      ))
      if (!request) {
        throw new Error('这个请求已经失效，请等待 Agent 更新状态。')
      }
      const result = await window.appApi.respondAgentInteraction({
        agentId: request.agentId,
        answers,
        optionId,
        requestId,
        sessionId: request.sessionId,
        values,
      })
      if (!result.ok) {
        throw new Error('这个请求已经失效，请等待 Agent 更新状态。')
      }
      setPendingInteractions((currentRequests) => currentRequests.filter((candidate) => !(
        candidate.agentId === request.agentId
        && candidate.id === requestId
        && candidate.sessionId === request.sessionId
      )))
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to respond to Agent request.')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const hasPayload = hasAgentComposerPayload(composerStateRef.current, composerAttachmentsRef.current)

    if (isViewingActiveRuntime && agentState.runtime.isStreaming) {
      if (!hasPayload) {
        await stopActivePrompt()
        return
      }

      await submitComposerPrompt(effectiveRunningPromptEnterBehavior)
      return
    }

    await submitComposerPrompt()
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      if (!hasAgentComposerPayload(composerStateRef.current, composerAttachmentsRef.current)) {
        return
      }

      if (isViewingActiveRuntime && agentState.runtime.isStreaming) {
        const requestedStreamingBehavior = getStreamingPromptBehaviorForShortcut(
          event,
          window.appApi.platform,
          effectiveRunningPromptEnterBehavior,
        )
        const streamingBehavior = resolveSupportedRunningPromptBehavior(
          agentState.runtime.supportedRunningPromptBehaviors,
          requestedStreamingBehavior,
        )
        void submitComposerPrompt(streamingBehavior)
        return
      }

      void submitComposerPrompt()
    }
  }

  return {
    handleComposerKeyDown,
    handleQueuedMessageUpdate,
    handleSubmit,
    respondToInteraction,
  }
}

import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from 'react'
import {
  type AgentComposerAttachment,
  type AgentComposerClearToken,
  type AgentComposerSnapshot,
  type AgentComposerState,
} from './use-agent-composer-draft'
import { createOpenCodeMessageId, createOpenCodePartId } from '@/features/agent/lib/opencode-message-id'
import {
  getAgentModelDraftKey,
  getRuntimeDefaultModelDraft,
  getRuntimeSelectedModelDraft,
  normalizeAgentModelDraft,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import { serializeComposerText } from '@/features/agent/lib/composer-mentions'
import type { AgentSessionSelection } from '@/features/agent/lib/project-session-request'
import { normalizeAgentProjectPath } from '@/features/agent/lib/session-tree'
import type { AgentId } from '@/features/agent/agent-definition'
import type {
  AgentMessageAttachment,
  AgentSessionSnapshot,
  AgentSidebarMessage,
  AgentWorkspaceState,
} from '@/features/agent/types'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationSessionStartedPatch,
} from '@/features/conversations/types'
import type { AgentRunningPromptEnterBehavior } from '@/hooks/use-settings-store'

export type OptimisticAgentUserMessage = {
  agentId: AgentId
  message: AgentSidebarMessage
  nativePartIds?: string[]
  sessionPath: string
}

type AgentPromptSubmissionComposer = {
  clearAssistantDraft: () => void
  clearComposerOptimistically: () => AgentComposerClearToken
  clearLiveTools: () => void
  closeComposerMenu: () => void
  composerAttachmentsRef: RefObject<AgentComposerAttachment[]>
  composerStateRef: RefObject<AgentComposerState>
  invalidateOptimisticComposerClear: (clearToken: AgentComposerClearToken | null) => void
  restoreOptimisticallyClearedComposer: (
    clearToken: AgentComposerClearToken | null,
    snapshot: AgentComposerSnapshot,
  ) => void
}

type AgentPromptSubmissionConversation = {
  activeConversation: ConversationRecord | null
  activeWorkspaceContext: ActiveWorkspaceContext
  onConversationDraftFailed?: (conversationId: string) => Promise<void> | void
  onConversationSessionStarted?: (
    conversationId: string,
    patch: ConversationSessionStartedPatch,
  ) => Promise<void> | void
  onCreateConversationWorkspace?: (
    request: { agentId?: AgentId, initialPrompt?: string | null },
  ) => Promise<ConversationRecord>
}

type AgentPromptSubmissionNavigation = {
  activeRuntimeSessionRef: RefObject<AgentWorkspaceState['activeSession']>
  activeSessionSelectionRef: RefObject<AgentSessionSelection>
  ensureSelectedAgentSessionActive: (selection?: AgentSessionSelection) => Promise<AgentWorkspaceState | null>
  openSessionRequestIdRef: RefObject<number>
  selectedAgentId: AgentId
  selectedAgentIdRef: RefObject<AgentId>
  syncActiveSessionSelection: (selection: AgentSessionSelection) => void
  workspacePath: string | null
  workspacePathRef: RefObject<string | null>
}

type AgentPromptSubmissionState = {
  agentState: AgentWorkspaceState
  markWorkspaceStateLoaded: () => void
  newSessionModelDraftRef: RefObject<AgentModelDraft>
  setAgentState: Dispatch<SetStateAction<AgentWorkspaceState>>
  setLoading: Dispatch<SetStateAction<boolean>>
  setOptimisticUserMessages: Dispatch<SetStateAction<OptimisticAgentUserMessage[]>>
  setPanelError: Dispatch<SetStateAction<string | null>>
  setViewedSessionSnapshot: Dispatch<SetStateAction<AgentSessionSnapshot | null>>
  syncModelDraft: (draft: AgentModelDraft) => void
  syncNewSessionModelDraft: (draft: AgentModelDraft) => void
}

type UseAgentPromptSubmissionOptions = {
  composer: AgentPromptSubmissionComposer
  conversation: AgentPromptSubmissionConversation
  navigation: AgentPromptSubmissionNavigation
  state: AgentPromptSubmissionState
}

function formatConversationPreview(prompt: string) {
  const firstLine = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)

  return firstLine ? firstLine.replace(/\s+/g, ' ').slice(0, 48) : '新对话'
}

export function useAgentPromptSubmission({
  composer: {
    clearAssistantDraft,
    clearComposerOptimistically,
    clearLiveTools,
    closeComposerMenu,
    composerAttachmentsRef,
    composerStateRef,
    invalidateOptimisticComposerClear,
    restoreOptimisticallyClearedComposer,
  },
  conversation: {
    activeConversation,
    activeWorkspaceContext,
    onConversationDraftFailed,
    onConversationSessionStarted,
    onCreateConversationWorkspace,
  },
  navigation: {
    activeRuntimeSessionRef,
    activeSessionSelectionRef,
    ensureSelectedAgentSessionActive,
    openSessionRequestIdRef,
    selectedAgentId,
    selectedAgentIdRef,
    syncActiveSessionSelection,
    workspacePath,
    workspacePathRef,
  },
  state: {
    agentState,
    markWorkspaceStateLoaded,
    newSessionModelDraftRef,
    setAgentState,
    setLoading,
    setOptimisticUserMessages,
    setPanelError,
    setViewedSessionSnapshot,
    syncModelDraft,
    syncNewSessionModelDraft,
  },
}: UseAgentPromptSubmissionOptions) {
  const [isSubmittingComposerPrompt, setIsSubmittingComposerPrompt] = useState(false)
  const isSubmittingComposerPromptRef = useRef(false)

  async function submitComposerPrompt(streamingBehavior?: AgentRunningPromptEnterBehavior) {
    const submittedComposerState = composerStateRef.current
    const submittedComposerAttachments = composerAttachmentsRef.current
    const serializedPrompt = serializeComposerText(submittedComposerState.value, submittedComposerState.mentions)
    const trimmedPrompt = serializedPrompt.trim()

    if (
      agentState.activeSession?.native?.agentId === 'opencode'
      && agentState.activeSession.native.parentSessionId
    ) {
      setPanelError('OpenCode 子会话由父会话中的子 Agent 管理，请返回父会话继续输入。')
      return
    }

    if (!trimmedPrompt && submittedComposerAttachments.length === 0) {
      return
    }

    if (!agentState.runtime.hasConfiguredModels) {
      setPanelError(agentState.runtime.setupHint ?? 'Configure a model first.')
      return
    }

    let targetWorkspacePath = workspacePath
    const requiresConversationWorkspace = !targetWorkspacePath && activeWorkspaceContext.kind === 'conversationDraft'
    const createConversationWorkspace = onCreateConversationWorkspace

    if (requiresConversationWorkspace && !createConversationWorkspace) {
      setPanelError('Unable to create a conversation workspace.')
      return
    }

    if (!targetWorkspacePath && !requiresConversationWorkspace) {
      return
    }

    if (isSubmittingComposerPromptRef.current) {
      return
    }

    isSubmittingComposerPromptRef.current = true
    setIsSubmittingComposerPrompt(true)

    const requestAgentId = selectedAgentId
    const requestSelection = activeSessionSelectionRef.current
    let expectedNavigationRevision = openSessionRequestIdRef.current
    let createdConversation: ConversationRecord | null = null
    let runtimeForSubmit = agentState.runtime
    const draftBeforeWorkspaceCreation = newSessionModelDraftRef.current
    const composerSnapshot = {
      attachments: submittedComposerAttachments,
      state: submittedComposerState,
    }
    const optimisticClearId = clearComposerOptimistically()
    let didSendPromptToAgent = false
    let didPersistConversationBinding = false
    let optimisticUserMessageId: string | null = null
    let nextSessionPath: string | null = null
    let fallbackErrorMessage = 'Unable to send your prompt.'

    const isSubmissionContextCurrent = () => {
      const currentWorkspacePath = workspacePathRef.current
      const isCurrentWorkspace = targetWorkspacePath
        ? Boolean(
            currentWorkspacePath
            && normalizeAgentProjectPath(targetWorkspacePath) === normalizeAgentProjectPath(currentWorkspacePath),
          )
        : currentWorkspacePath === null
      if (
        expectedNavigationRevision !== openSessionRequestIdRef.current
        || selectedAgentIdRef.current !== requestAgentId
        || !isCurrentWorkspace
      ) {
        return false
      }

      return true
    }

    const isSubmissionViewCurrent = (sessionPath?: string | null) => {
      if (!isSubmissionContextCurrent()) {
        return false
      }

      const currentSelection = activeSessionSelectionRef.current
      if (sessionPath) {
        return currentSelection.kind === 'session'
          && currentSelection.agentId === requestAgentId
          && currentSelection.sessionPath === sessionPath
      }

      return requestSelection.kind === 'new'
        ? currentSelection.kind === 'new'
        : currentSelection.kind === 'session'
          && currentSelection.agentId === requestSelection.agentId
          && currentSelection.sessionPath === requestSelection.sessionPath
    }

    try {
      closeComposerMenu()
      setPanelError(null)

      if (requiresConversationWorkspace) {
        fallbackErrorMessage = 'Unable to create a conversation workspace.'
        setLoading(true)
        try {
          if (!createConversationWorkspace) {
            throw new Error('Unable to create a conversation workspace.')
          }
          createdConversation = await createConversationWorkspace({
            agentId: requestAgentId,
            initialPrompt: trimmedPrompt,
          })
          targetWorkspacePath = createdConversation.workspacePath
          workspacePathRef.current = targetWorkspacePath

          if (!targetWorkspacePath) {
            throw new Error('Conversation workspace was not created.')
          }

          const nextState = await window.appApi.loadAgentWorkspace({
            agentId: requestAgentId,
            workspacePath: targetWorkspacePath,
          }, null, { restoreSession: false })
          runtimeForSubmit = nextState.runtime
          const defaultDraft = getRuntimeDefaultModelDraft(nextState.runtime)
          const nextNewSessionDraft = normalizeAgentModelDraft(
            draftBeforeWorkspaceCreation,
            nextState.runtime,
            defaultDraft,
          )
          syncNewSessionModelDraft(nextNewSessionDraft)
          if (isSubmissionViewCurrent()) {
            setAgentState(nextState)
            setViewedSessionSnapshot(null)
            markWorkspaceStateLoaded()
            syncModelDraft(nextNewSessionDraft)
          }
        } finally {
          setLoading(false)
        }
      }

      if (!targetWorkspacePath) {
        throw new Error('Open a workspace before sending your prompt.')
      }

      nextSessionPath = requestSelection.kind === 'session' ? requestSelection.sessionPath : null

      if (requestSelection.kind === 'new') {
        fallbackErrorMessage = 'Unable to create an agent session.'
        openSessionRequestIdRef.current += 1
        expectedNavigationRevision = openSessionRequestIdRef.current
        const nextDraft = normalizeAgentModelDraft(
          newSessionModelDraftRef.current,
          runtimeForSubmit,
          getRuntimeDefaultModelDraft(runtimeForSubmit),
        )
        syncNewSessionModelDraft(nextDraft)
        const draftModelKey = getAgentModelDraftKey(nextDraft)
        const nextState = await window.appApi.createAgentSession({
          agentId: requestAgentId,
          workspacePath: targetWorkspacePath,
        }, {
          agentId: requestAgentId,
          ...(draftModelKey && runtimeForSubmit.availableModels.includes(draftModelKey) ? { modelKey: draftModelKey } : {}),
          thinkingLevel: nextDraft.thinkingLevel,
        })
        nextSessionPath = nextState.activeSession?.sessionPath ?? null
        if (isSubmissionContextCurrent()) {
          activeRuntimeSessionRef.current = nextState.activeSession
          setAgentState(nextState)
          setViewedSessionSnapshot(null)
          if (nextSessionPath) {
            syncActiveSessionSelection({ agentId: requestAgentId, kind: 'session', sessionPath: nextSessionPath })
          }
          syncModelDraft(getRuntimeSelectedModelDraft(nextState.runtime))
        }
      } else {
        fallbackErrorMessage = 'Open a session before sending your prompt.'
        const activeState = await ensureSelectedAgentSessionActive(requestSelection)
        if (!activeState?.activeSession) {
          throw new Error('Open a session before sending your prompt.')
        }
        nextSessionPath = activeState.activeSession.sessionPath
      }

      fallbackErrorMessage = 'Unable to send your prompt.'
      if (!nextSessionPath) {
        throw new Error('Agent session did not return a native session identifier.')
      }
      const promptSessionPath = nextSessionPath
      const conversationId = createdConversation?.id
        ?? (activeWorkspaceContext.kind === 'conversation' ? activeWorkspaceContext.conversationId : null)
      const persistedSessionPath = createdConversation?.agentSessionPath ?? activeConversation?.agentSessionPath ?? null
      if (conversationId && persistedSessionPath !== promptSessionPath) {
        if (!onConversationSessionStarted) {
          throw new Error('Unable to persist the conversation Agent session binding.')
        }
        fallbackErrorMessage = 'Unable to update the conversation index.'
        const preview = formatConversationPreview(trimmedPrompt)
        await onConversationSessionStarted(conversationId, {
          agentSessionPath: promptSessionPath,
          lastMessagePreview: createdConversation ? preview : activeConversation?.lastMessagePreview ?? null,
          ...(createdConversation ? { title: preview, titleSource: 'prompt' } : {}),
        })
        didPersistConversationBinding = true
      }

      fallbackErrorMessage = 'Unable to send your prompt.'
      const promptAttachments = submittedComposerAttachments.map(({ id: _id, ...attachment }) => attachment)
      const isOpenCodePrompt = requestAgentId === 'opencode'
      const supportsClientMessageId = isOpenCodePrompt || requestAgentId === 'codex'
      const nextOptimisticUserMessageId = isOpenCodePrompt
        ? createOpenCodeMessageId()
        : `optimistic-user-${crypto.randomUUID()}`
      const nativePartIds = isOpenCodePrompt
        ? Array.from({ length: submittedComposerAttachments.length + 1 }, createOpenCodePartId)
        : undefined
      optimisticUserMessageId = nextOptimisticUserMessageId
      const optimisticAttachments: AgentMessageAttachment[] = submittedComposerAttachments.map(({ id: _id, ...attachment }) => ({
        ...attachment,
        status: attachment.kind === 'image' ? 'sent' : 'referenced',
      }))
      setOptimisticUserMessages((current) => [...current, {
        agentId: requestAgentId,
        message: {
          ...(optimisticAttachments.length > 0 ? { attachments: optimisticAttachments } : {}),
          id: nextOptimisticUserMessageId,
          kind: 'user',
          text: trimmedPrompt,
          timestamp: Date.now(),
        },
        ...(nativePartIds ? { nativePartIds } : {}),
        sessionPath: promptSessionPath,
      }])
      await window.appApi.sendAgentPrompt({
        agentId: requestAgentId,
        sessionPath: promptSessionPath,
        workspacePath: targetWorkspacePath,
      }, trimmedPrompt, streamingBehavior, promptAttachments, supportsClientMessageId ? {
        clientMessageId: nextOptimisticUserMessageId,
        ...(nativePartIds ? { clientPartIds: nativePartIds } : {}),
      } : undefined)
      didSendPromptToAgent = true
      try {
        window.localStorage.setItem('aryn:last-new-conversation-agent', requestAgentId)
      } catch {
        // Persisting this preference is best effort. Conversation records remain authoritative.
      }
      invalidateOptimisticComposerClear(optimisticClearId)
      if (isSubmissionViewCurrent(promptSessionPath)) {
        syncActiveSessionSelection({ agentId: requestAgentId, kind: 'session', sessionPath: promptSessionPath })
      }
      if (conversationId && !createdConversation) {
        const preview = formatConversationPreview(trimmedPrompt)
        try {
          await onConversationSessionStarted?.(conversationId, {
            agentSessionPath: promptSessionPath,
            lastMessagePreview: preview,
          })
        } catch (error) {
          if (isSubmissionViewCurrent(promptSessionPath)) {
            setPanelError(error instanceof Error ? error.message : 'Unable to update the conversation index.')
          }
        }
      }
      if (!streamingBehavior && isSubmissionViewCurrent(promptSessionPath)) {
        clearAssistantDraft()
        clearLiveTools()
      }
    } catch (error) {
      if (createdConversation && !didSendPromptToAgent && !didPersistConversationBinding) {
        void onConversationDraftFailed?.(createdConversation.id)
      }
      if (!didSendPromptToAgent) {
        if (optimisticUserMessageId) {
          setOptimisticUserMessages((current) => (
            current.filter((entry) => entry.message.id !== optimisticUserMessageId)
          ))
        }
        if (isSubmissionViewCurrent(nextSessionPath)) {
          restoreOptimisticallyClearedComposer(optimisticClearId, composerSnapshot)
        }
      }
      if (isSubmissionViewCurrent(nextSessionPath)) {
        setPanelError(error instanceof Error ? error.message : fallbackErrorMessage)
      }
    } finally {
      isSubmittingComposerPromptRef.current = false
      setIsSubmittingComposerPrompt(false)
    }
  }

  return {
    isSubmittingComposerPrompt,
    submitComposerPrompt,
  }
}

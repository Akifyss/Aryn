import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useState } from 'react'
import { toast } from '@heroui/react'
import {
  conversationDraftContext,
  createEmptyConversationState,
  getConversationById,
  getConversationForContext,
  isConversationWorkspaceCurrent,
  resolveSuggestedConversationTitle,
  shouldDisconnectConversationWorkspace,
} from '@/features/conversations/lib/conversation-state'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationSessionStartedPatch,
  ConversationState,
  CreateConversationWorkspaceRequest,
} from '@/features/conversations/types'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'

type ConfirmationOptions = {
  cancelLabel?: string
  confirmLabel?: string
  isDanger?: boolean
  message: string
  title: string
}

type ConversationTitleSuggestion = {
  agentSessionPath: string
  title: string
}

type DisconnectWorkspaceOptions = {
  unavailableMessage?: string | null
}

type RestoreInitialConversationOptions = {
  isCancelled?: () => boolean
}

type UseConversationControllerOptions = {
  activeWorkspaceContext: ActiveWorkspaceContext
  clearPendingAgentProjectSessionRequest: () => void
  confirmDiscardDirtyTabs: (reason: 'close' | 'switch-workspace') => Promise<boolean>
  connectWorkspace: (workspacePath: string) => Promise<void>
  currentPathRef: { current: string | null }
  disconnectWorkspaceSurface: (options?: DisconnectWorkspaceOptions) => Promise<void>
  flushDiffAutosave: () => Promise<boolean>
  flushWorkspaceAutosave: (filePath?: string) => Promise<boolean>
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>
  restoreWorkspaceTabs: (workspacePath: string, fallbackFilePath?: string | null) => Promise<void>
  setActiveWorkspaceContext: Dispatch<SetStateAction<ActiveWorkspaceContext>>
  setStatusMessage: (message: string) => void
}

export function useConversationController({
  activeWorkspaceContext,
  clearPendingAgentProjectSessionRequest,
  confirmDiscardDirtyTabs,
  connectWorkspace,
  currentPathRef,
  disconnectWorkspaceSurface,
  flushDiffAutosave,
  flushWorkspaceAutosave,
  requestConfirmation,
  restoreWorkspaceTabs,
  setActiveWorkspaceContext,
  setStatusMessage,
}: UseConversationControllerOptions) {
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const [conversationState, setConversationState] = useState<ConversationState>(
    createEmptyConversationState,
  )

  const hydrateConversationState = useCallback((nextConversationState: ConversationState) => {
    setConversationState(nextConversationState)
  }, [])

  async function refreshConversationState() {
    const nextConversationState = await window.appApi.getConversationState()
    setConversationState(nextConversationState)
    return nextConversationState
  }

  async function enterConversationDraft(options: { skipDirtyConfirm?: boolean } = {}) {
    if (!options.skipDirtyConfirm && currentPath && !(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return false
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()
    const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
    setActiveWorkspaceContext(nextContext)
    await disconnectWorkspaceSurface()
    setStatusMessage('新对话')
    return true
  }

  async function startStandaloneConversation() {
    await enterConversationDraft()
  }

  async function createConversationWorkspace(request: CreateConversationWorkspaceRequest) {
    let record: ConversationRecord | null = null

    try {
      record = await window.appApi.createConversationWorkspace(request)

      if (!record.workspacePath) {
        throw new Error('Conversation workspace was not created.')
      }

      await refreshConversationState()
      setActiveWorkspaceContext({ kind: 'conversation', conversationId: record.id })
      await connectWorkspace(record.workspacePath)
      return record
    } catch (error) {
      if (record) {
        setConversationState(await window.appApi.removeDraftConversation(record.id))
        const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
        setActiveWorkspaceContext(nextContext)
      }

      throw error
    }
  }

  async function conversationSessionStarted(
    conversationId: string,
    patch: ConversationSessionStartedPatch,
  ) {
    const updatedConversation = await window.appApi.updateConversation(conversationId, {
      agentSessionPath: patch.agentSessionPath,
      lastMessagePreview: patch.lastMessagePreview ?? null,
      status: 'active',
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.titleSource !== undefined ? { titleSource: patch.titleSource } : {}),
    })
    await refreshConversationState()

    if (updatedConversation.workspacePath && updatedConversation.agentSessionPath) {
      await window.appApi.updateWorkspaceState(updatedConversation.workspacePath, {
        lastAgentSessionPath: updatedConversation.agentSessionPath,
      })
    }
  }

  async function conversationTitleSuggested(
    conversationId: string,
    suggestion: ConversationTitleSuggestion,
  ) {
    if (!suggestion.title.trim()) {
      return
    }

    try {
      const currentConversationState = await window.appApi.getConversationState()
      const conversation = getConversationById(currentConversationState, conversationId)
      const nextTitle = resolveSuggestedConversationTitle(conversation, suggestion)

      if (!nextTitle) {
        setConversationState(currentConversationState)
        return
      }

      const updatedConversation = await window.appApi.updateConversation(conversationId, {
        title: nextTitle,
        titleSource: 'agent',
      })
      await refreshConversationState()

      if (
        activeWorkspaceContext.kind === 'conversation'
        && activeWorkspaceContext.conversationId === conversationId
      ) {
        setStatusMessage(updatedConversation.title)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update the conversation title.'
      setStatusMessage(message)
      throw error
    }
  }

  async function conversationDraftFailed(conversationId: string) {
    const activeContext = await window.appApi.getActiveWorkspaceContext()
    const currentConversationState = await window.appApi.getConversationState()
    const failedConversation = getConversationById(currentConversationState, conversationId)
    setConversationState(await window.appApi.removeDraftConversation(conversationId))

    if (activeContext.kind === 'conversation' && activeContext.conversationId === conversationId) {
      const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
      setActiveWorkspaceContext(nextContext)

      if (shouldDisconnectConversationWorkspace(
        currentPathRef.current,
        failedConversation?.workspacePath ?? null,
      )) {
        await disconnectWorkspaceSurface()
      }
    }
  }

  async function openConversation(conversation: ConversationRecord) {
    const targetWorkspacePath = conversation.workspacePath
    const isCurrentWorkspace = isConversationWorkspaceCurrent(currentPath, targetWorkspacePath)

    if (currentPath && !isCurrentWorkspace) {
      if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
        return
      }
    }

    try {
      await window.appApi.setActiveWorkspaceContext({
        kind: 'conversation',
        conversationId: conversation.id,
      })
      setActiveWorkspaceContext({ kind: 'conversation', conversationId: conversation.id })

      const workspaceExists = targetWorkspacePath
        ? (await window.appApi.workspacePathExists(targetWorkspacePath)).exists
        : false

      if (!targetWorkspacePath || !workspaceExists) {
        await disconnectWorkspaceSurface({ unavailableMessage: '这个对话的工作目录已被移动或删除。' })
        setStatusMessage(`${conversation.title}：工作目录不可用`)
        toast.warning('对话工作目录不可用', { description: '这个对话的工作目录已被移动或删除。' })
        return
      }

      if (conversation.agentSessionPath) {
        await window.appApi.updateWorkspaceState(targetWorkspacePath, {
          lastAgentSessionPath: conversation.agentSessionPath,
        })
      }
      const sessionExists = conversation.agentSessionPath
        ? (await window.appApi.agentSessionExists({
            agentId: conversation.agentId,
            workspacePath: targetWorkspacePath,
          }, conversation.agentSessionPath)).exists
        : false
      await connectWorkspace(targetWorkspacePath)
      await restoreWorkspaceTabs(targetWorkspacePath)
      clearPendingAgentProjectSessionRequest()
      setStatusMessage(conversation.title)

      if (!sessionExists) {
        toast.warning('无法恢复对话内容', {
          description: '对应的 Agent session 文件不存在或不可读。工作目录仍可继续浏览。',
        })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open conversation.'
      toast.danger('打开对话失败', { description: message })
      setStatusMessage(message)
    }
  }

  async function renameConversation(conversation: ConversationRecord, title: string) {
    const nextTitle = title.trim()

    if (!nextTitle || nextTitle === conversation.title.trim()) {
      return
    }

    try {
      const updatedConversation = await window.appApi.updateConversation(conversation.id, {
        title: nextTitle,
        titleSource: 'user',
      })
      await refreshConversationState()

      if (
        activeWorkspaceContext.kind === 'conversation'
        && activeWorkspaceContext.conversationId === conversation.id
      ) {
        setStatusMessage(updatedConversation.title)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to rename conversation.'
      toast.danger('重命名对话失败', { description: message })
      setStatusMessage(message)
      throw error
    }
  }

  async function removeConversation(conversation: ConversationRecord) {
    const confirmed = await requestConfirmation({
      title: '删除对话',
      message: `要删除“${conversation.title}”吗？\n\n这会从对话列表移除该记录，不会删除工作目录中的文件。`,
      confirmLabel: '删除',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    const wasActive = activeWorkspaceContext.kind === 'conversation'
      && activeWorkspaceContext.conversationId === conversation.id

    try {
      if (wasActive) {
        await flushWorkspaceAutosave()
        await flushDiffAutosave()
      }

      const nextConversationState = await window.appApi.removeConversation(conversation.id)
      setConversationState(nextConversationState)

      if (wasActive) {
        setActiveWorkspaceContext(conversationDraftContext)

        if (shouldDisconnectConversationWorkspace(
          currentPathRef.current,
          conversation.workspacePath,
        )) {
          await disconnectWorkspaceSurface()
        }

        setStatusMessage('新对话')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete conversation.'
      toast.danger('删除对话失败', { description: message })
      setStatusMessage(message)
    }
  }

  async function restoreInitialConversationContext(
    activeContext: ActiveWorkspaceContext,
    initialConversationState: ConversationState,
    options: RestoreInitialConversationOptions = {},
  ) {
    if (activeContext.kind !== 'conversation') {
      return false
    }

    const isCancelled = options.isCancelled ?? (() => false)
    const activeConversation = getConversationForContext(initialConversationState, activeContext)

    if (!activeConversation) {
      const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
      setActiveWorkspaceContext(nextContext)
      await disconnectWorkspaceSurface()
      setStatusMessage('新对话')
      return true
    }

    if (!activeConversation.workspacePath) {
      await disconnectWorkspaceSurface({ unavailableMessage: '这个对话没有可恢复的工作目录。' })
      setStatusMessage('对话工作目录不可用')
      return true
    }

    try {
      const workspaceExists = (await window.appApi.workspacePathExists(
        activeConversation.workspacePath,
      )).exists

      if (!workspaceExists) {
        await disconnectWorkspaceSurface({ unavailableMessage: '这个对话的工作目录已被移动或删除。' })
        setStatusMessage(`${activeConversation.title}：工作目录不可用`)
        toast.warning('对话工作目录不可用', {
          description: '上次打开的普通对话目录已被移动或删除。',
        })
        return true
      }

      if (activeConversation.agentSessionPath) {
        await window.appApi.updateWorkspaceState(activeConversation.workspacePath, {
          lastAgentSessionPath: activeConversation.agentSessionPath,
        })
      }
      const sessionExists = activeConversation.agentSessionPath
        ? (await window.appApi.agentSessionExists({
            agentId: activeConversation.agentId,
            workspacePath: activeConversation.workspacePath,
          }, activeConversation.agentSessionPath)).exists
        : false
      await connectWorkspace(activeConversation.workspacePath)

      if (!isCancelled()) {
        await restoreWorkspaceTabs(activeConversation.workspacePath)
      }

      if (!isCancelled()) {
        setStatusMessage(activeConversation.title)

        if (!sessionExists) {
          toast.warning('无法恢复对话内容', {
            description: '对应的 Agent session 文件不存在或不可读。工作目录仍可继续浏览。',
          })
        }
      }
    } catch (error) {
      if (!isCancelled()) {
        const message = error instanceof Error ? error.message : 'Unable to restore conversation.'
        setStatusMessage(message)
      }
    }

    return true
  }

  return {
    conversationDraftFailed,
    conversationSessionStarted,
    conversationState,
    conversationTitleSuggested,
    createConversationWorkspace,
    enterConversationDraft,
    hydrateConversationState,
    openConversation,
    removeConversation,
    renameConversation,
    restoreInitialConversationContext,
    startStandaloneConversation,
  }
}

import type { Dispatch, SetStateAction } from 'react'
import { useCallback, useRef, useState } from 'react'
import { toast } from '@heroui/react'
import {
  conversationDraftContext,
  createEmptyConversationState,
  getConversationById,
  getConversationForContext,
  isConversationWorkspaceCurrent,
  resolveSuggestedConversationTitle,
  shouldDisconnectConversationWorkspace,
  upsertConversationRecord,
} from '@/features/conversations/lib/conversation-state'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationSessionStartedPatch,
  ConversationState,
  CreateConversationWorkspaceRequest,
} from '@/features/conversations/types'
import {
  type WorkspaceNavigationCoordinator,
  type WorkspaceNavigationIntent,
} from '@/features/workspace/lib/workspace-navigation-coordinator'
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
  intent?: WorkspaceNavigationIntent
  unavailableMessage?: string | null
}

type RestoreInitialConversationOptions = {
  intent?: WorkspaceNavigationIntent
  isCancelled?: () => boolean
}

type UseConversationControllerOptions = {
  activeWorkspaceContext: ActiveWorkspaceContext
  clearPendingAgentProjectSessionRequest: () => void
  confirmDiscardDirtyTabs: (reason: 'close' | 'switch-workspace') => Promise<boolean>
  connectWorkspace: (
    workspacePath: string,
    options?: { intent?: WorkspaceNavigationIntent },
  ) => Promise<boolean>
  currentPathRef: { current: string | null }
  disconnectWorkspaceSurface: (options?: DisconnectWorkspaceOptions) => Promise<boolean>
  flushDiffAutosave: () => Promise<boolean>
  flushWorkspaceAutosave: (filePath?: string) => Promise<boolean>
  navigationCoordinator: WorkspaceNavigationCoordinator
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>
  restoreWorkspaceTabs: (
    workspacePath: string,
    fallbackFilePath?: string | null,
    options?: { shouldApply?: () => boolean },
  ) => Promise<void>
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
  navigationCoordinator,
  requestConfirmation,
  restoreWorkspaceTabs,
  setActiveWorkspaceContext,
  setStatusMessage,
}: UseConversationControllerOptions) {
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const [conversationState, setConversationState] = useState<ConversationState>(
    createEmptyConversationState,
  )
  const activeWorkspaceContextRef = useRef(activeWorkspaceContext)
  activeWorkspaceContextRef.current = activeWorkspaceContext

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

    const intent = navigationCoordinator.begin('conversation:draft')
    const isCurrent = navigationCoordinator.guard(intent)
    const previousWorkspaceContext = activeWorkspaceContextRef.current
    let didPersistDraft = false

    if (!isCurrent()) {
      return false
    }

    clearPendingAgentProjectSessionRequest()
    setActiveWorkspaceContext(conversationDraftContext)
    setStatusMessage('新对话')

    try {
      const result = await navigationCoordinator.run(intent, async (stillCurrent) => {
        await flushWorkspaceAutosave()

        if (!stillCurrent()) {
          return false
        }

        await flushDiffAutosave()

        if (!stillCurrent()) {
          return false
        }

        await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
        didPersistDraft = true

        if (!stillCurrent()) {
          return false
        }

        return disconnectWorkspaceSurface({ intent })
      })
      return result.status === 'completed' && result.value
    } catch (error) {
      if (!isCurrent()) {
        return false
      }

      if (!didPersistDraft) {
        setActiveWorkspaceContext(previousWorkspaceContext)
      }
      throw error
    }
  }

  async function startStandaloneConversation() {
    await enterConversationDraft()
  }

  async function createConversationWorkspace(request: CreateConversationWorkspaceRequest) {
    const intent = navigationCoordinator.begin('conversation:create')
    let record: ConversationRecord | null = null

    try {
      const result = await navigationCoordinator.runDurable(intent, async (stillCurrent) => {
        const createdRecord = await window.appApi.createConversationWorkspace(request)
        record = createdRecord
        setConversationState((currentConversationState) => (
          upsertConversationRecord(currentConversationState, createdRecord)
        ))

        if (!createdRecord.workspacePath) {
          throw new Error('Conversation workspace was not created.')
        }

        if (!stillCurrent()) {
          return createdRecord
        }

        const nextConversationState = await window.appApi.getConversationState()

        if (!stillCurrent()) {
          return createdRecord
        }

        setConversationState(nextConversationState)
        setActiveWorkspaceContext({ kind: 'conversation', conversationId: createdRecord.id })
        await connectWorkspace(createdRecord.workspacePath, { intent })
        return createdRecord
      })

      if (result.value) {
        return result.value
      }

      throw new Error('Conversation creation was superseded by newer navigation.')
    } catch (error) {
      const failedRecord = record as ConversationRecord | null

      if (failedRecord) {
        const nextConversationState = await window.appApi.removeDraftConversation(failedRecord.id)
        setConversationState(nextConversationState)

        if (navigationCoordinator.isCurrent(intent)) {
          setActiveWorkspaceContext(conversationDraftContext)
        }
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
        activeWorkspaceContextRef.current.kind === 'conversation'
        && activeWorkspaceContextRef.current.conversationId === conversationId
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
    const currentWorkspaceContext = activeWorkspaceContextRef.current
    const wasActive = currentWorkspaceContext.kind === 'conversation'
      && currentWorkspaceContext.conversationId === conversationId

    if (!wasActive) {
      setConversationState(await window.appApi.removeDraftConversation(conversationId))
      return
    }

    const intent = navigationCoordinator.begin(`conversation-failed:${conversationId}`)
    clearPendingAgentProjectSessionRequest()
    setActiveWorkspaceContext(conversationDraftContext)
    const currentConversationState = await window.appApi.getConversationState()
    const failedConversation = getConversationById(currentConversationState, conversationId)
    const nextConversationState = await window.appApi.removeDraftConversation(conversationId)
    setConversationState(nextConversationState)

    if (navigationCoordinator.isCurrent(intent)) {
      await navigationCoordinator.run(intent, async () => {
        if (shouldDisconnectConversationWorkspace(
          currentPathRef.current,
          failedConversation?.workspacePath ?? null,
        )) {
          await disconnectWorkspaceSurface({ intent })
        }
      })
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

    const intent = navigationCoordinator.begin(`conversation:${conversation.id}`)
    const isCurrent = navigationCoordinator.guard(intent)
    const previousWorkspaceContext = activeWorkspaceContextRef.current
    let didPersistConversation = false

    if (!isCurrent()) {
      return
    }

    clearPendingAgentProjectSessionRequest()
    setActiveWorkspaceContext({ kind: 'conversation', conversationId: conversation.id })

    try {
      await navigationCoordinator.run(intent, async (stillCurrent) => {
        await window.appApi.setActiveWorkspaceContext({
          kind: 'conversation',
          conversationId: conversation.id,
        })
        didPersistConversation = true

        if (!stillCurrent()) {
          return
        }

        const workspaceExists = targetWorkspacePath
          ? (await window.appApi.workspacePathExists(targetWorkspacePath)).exists
          : false

        if (!stillCurrent()) {
          return
        }

        if (!targetWorkspacePath || !workspaceExists) {
          await disconnectWorkspaceSurface({
            intent,
            unavailableMessage: '这个对话的工作目录已被移动或删除。',
          })

          if (stillCurrent()) {
            setStatusMessage(`${conversation.title}：工作目录不可用`)
            toast.warning('对话工作目录不可用', { description: '这个对话的工作目录已被移动或删除。' })
          }
          return
        }

        const persistSessionSelection = conversation.agentSessionPath
          ? window.appApi.updateWorkspaceState(targetWorkspacePath, {
              lastAgentSessionPath: conversation.agentSessionPath,
            })
          : Promise.resolve()
        const sessionExistsRequest = conversation.agentSessionPath
          ? window.appApi.agentSessionExists({
              agentId: conversation.agentId,
              workspacePath: targetWorkspacePath,
            }, conversation.agentSessionPath)
          : Promise.resolve({ exists: false })
        const [didConnect, , sessionExistsResult] = await Promise.all([
          connectWorkspace(targetWorkspacePath, { intent }),
          persistSessionSelection,
          sessionExistsRequest,
        ])

        if (!didConnect || !stillCurrent()) {
          return
        }

        await restoreWorkspaceTabs(targetWorkspacePath, undefined, {
          shouldApply: stillCurrent,
        })

        if (!stillCurrent()) {
          return
        }

        setStatusMessage(conversation.title)

        if (!sessionExistsResult.exists) {
          toast.warning('无法恢复对话内容', {
            description: '对应的 Agent session 文件不存在或不可读。工作目录仍可继续浏览。',
          })
        }
      })
    } catch (error) {
      if (!isCurrent()) {
        return
      }

      if (!didPersistConversation) {
        setActiveWorkspaceContext(previousWorkspaceContext)
      }

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
        activeWorkspaceContextRef.current.kind === 'conversation'
        && activeWorkspaceContextRef.current.conversationId === conversation.id
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

    const currentWorkspaceContext = activeWorkspaceContextRef.current
    const wasActive = currentWorkspaceContext.kind === 'conversation'
      && currentWorkspaceContext.conversationId === conversation.id
    const intent = wasActive
      ? navigationCoordinator.begin(`conversation-remove:${conversation.id}`)
      : null

    try {
      if (wasActive) {
        await flushWorkspaceAutosave()
        await flushDiffAutosave()
      }

      const nextConversationState = await window.appApi.removeConversation(conversation.id)
      setConversationState(nextConversationState)

      if (intent && navigationCoordinator.isCurrent(intent)) {
        clearPendingAgentProjectSessionRequest()
        setActiveWorkspaceContext(conversationDraftContext)
        setStatusMessage('新对话')
        await navigationCoordinator.run(intent, async () => {
          if (shouldDisconnectConversationWorkspace(
            currentPathRef.current,
            conversation.workspacePath,
          )) {
            await disconnectWorkspaceSurface({ intent })
          }
        })
      }
    } catch (error) {
      if (intent && !navigationCoordinator.isCurrent(intent)) {
        return
      }

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
      if (isCancelled()) {
        return true
      }

      const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)

      if (isCancelled()) {
        return true
      }

      setActiveWorkspaceContext(nextContext)
      await disconnectWorkspaceSurface({ intent: options.intent })

      if (isCancelled()) {
        return true
      }

      setStatusMessage('新对话')
      return true
    }

    if (!activeConversation.workspacePath) {
      await disconnectWorkspaceSurface({
        intent: options.intent,
        unavailableMessage: '这个对话没有可恢复的工作目录。',
      })

      if (!isCancelled()) {
        setStatusMessage('对话工作目录不可用')
      }
      return true
    }

    try {
      const workspaceExists = (await window.appApi.workspacePathExists(
        activeConversation.workspacePath,
      )).exists

      if (isCancelled()) {
        return true
      }

      if (!workspaceExists) {
        await disconnectWorkspaceSurface({
          intent: options.intent,
          unavailableMessage: '这个对话的工作目录已被移动或删除。',
        })

        if (!isCancelled()) {
          setStatusMessage(`${activeConversation.title}：工作目录不可用`)
          toast.warning('对话工作目录不可用', {
            description: '上次打开的普通对话目录已被移动或删除。',
          })
        }
        return true
      }

      const persistSessionSelection = activeConversation.agentSessionPath
        ? window.appApi.updateWorkspaceState(activeConversation.workspacePath, {
            lastAgentSessionPath: activeConversation.agentSessionPath,
          })
        : Promise.resolve()
      const sessionExistsRequest = activeConversation.agentSessionPath
        ? window.appApi.agentSessionExists({
            agentId: activeConversation.agentId,
            workspacePath: activeConversation.workspacePath,
          }, activeConversation.agentSessionPath)
        : Promise.resolve({ exists: false })
      const [, , sessionExistsResult] = await Promise.all([
        connectWorkspace(activeConversation.workspacePath, { intent: options.intent }),
        persistSessionSelection,
        sessionExistsRequest,
      ])

      if (!isCancelled()) {
        await restoreWorkspaceTabs(activeConversation.workspacePath, undefined, {
          shouldApply: () => !isCancelled(),
        })
      }

      if (!isCancelled()) {
        const sessionExists = sessionExistsResult.exists
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

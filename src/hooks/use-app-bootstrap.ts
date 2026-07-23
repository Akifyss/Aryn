import { useEffect, useRef } from 'react'
import type {
  ActiveWorkspaceContext,
  ConversationState,
} from '@/features/conversations/types'
import { conversationDraftContext } from '@/features/conversations/lib/conversation-state'
import type { ProjectState } from '@/features/workspace/types'

type AppBootstrapApi = Pick<
  Window['appApi'],
  'getActiveWorkspaceContext' | 'getConversationState' | 'getProjectState'
>

type AppBootstrapOptions = {
  connectWorkspace: (workspacePath: string) => Promise<void>
  hydrateConversationState: (conversationState: ConversationState) => void
  hydrateProjectState: (projectState: ProjectState) => void
  hydrateWorkspaceIconThemes: (isCancelled: () => boolean) => Promise<void>
  restoreInitialConversationContext: (
    activeContext: ActiveWorkspaceContext,
    conversationState: ConversationState,
    options: { isCancelled: () => boolean },
  ) => Promise<boolean>
  restoreWorkspaceTabs: (
    workspacePath: string,
    fallbackFilePath?: string | null,
  ) => Promise<void>
  setActiveWorkspaceContext: (context: ActiveWorkspaceContext) => void
  setStatusMessage: (message: string) => void
}

export async function restoreAppBootstrapState(
  api: AppBootstrapApi,
  options: AppBootstrapOptions,
  isCancelled: () => boolean,
) {
  await options.hydrateWorkspaceIconThemes(isCancelled)

  const [
    projectState,
    conversationState,
    activeContext,
  ] = await Promise.all([
    api.getProjectState(),
    api.getConversationState(),
    api.getActiveWorkspaceContext(),
  ])

  if (isCancelled()) {
    return
  }

  options.hydrateProjectState(projectState)
  options.hydrateConversationState(conversationState)
  options.setActiveWorkspaceContext(activeContext)

  const activeProject = activeContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeContext.projectId) ?? null
    : projectState.projects.find((project) => project.id === projectState.lastProjectId) ?? null

  if (await options.restoreInitialConversationContext(
    activeContext,
    conversationState,
    { isCancelled },
  )) {
    return
  }

  if (activeContext.kind === 'conversationDraft') {
    options.setStatusMessage('新对话')
    return
  }

  if (!activeProject) {
    options.setActiveWorkspaceContext(conversationDraftContext)
    options.setStatusMessage('新对话')
    return
  }

  try {
    await options.connectWorkspace(activeProject.path)

    if (!isCancelled()) {
      await options.restoreWorkspaceTabs(activeProject.path, activeProject.lastFilePath)
    }

    if (!isCancelled()) {
      options.setStatusMessage('已恢复上次项目')
    }
  } catch {
    if (!isCancelled()) {
      options.setStatusMessage('创建或打开项目以开始。')
    }
  }
}

export function useAppBootstrap(options: AppBootstrapOptions) {
  const initialOptionsRef = useRef(options)

  useEffect(() => {
    let cancelled = false

    void restoreAppBootstrapState(
      window.appApi,
      initialOptionsRef.current,
      () => cancelled,
    ).catch((error: unknown) => {
      if (cancelled) {
        return
      }

      console.error('[app] Failed to restore persisted state.', error)
      initialOptionsRef.current.setStatusMessage(
        error instanceof Error ? error.message : 'Unable to restore application state.',
      )
    })

    return () => {
      cancelled = true
    }
  }, [])
}

import { useEffect, useRef } from 'react'
import type {
  ActiveWorkspaceContext,
  ConversationState,
} from '@/features/conversations/types'
import { conversationDraftContext } from '@/features/conversations/lib/conversation-state'
import {
  type WorkspaceNavigationCoordinator,
  type WorkspaceNavigationIntent,
} from '@/features/workspace/lib/workspace-navigation-coordinator'
import type { ProjectState } from '@/features/workspace/types'

type AppBootstrapApi = Pick<
  Window['appApi'],
  'getActiveWorkspaceContext' | 'getConversationState' | 'getProjectState'
>

type AppBootstrapOptions = {
  connectWorkspace: (
    workspacePath: string,
    options?: { intent?: WorkspaceNavigationIntent },
  ) => Promise<boolean>
  hydrateConversationState: (conversationState: ConversationState) => void
  hydrateProjectState: (projectState: ProjectState) => void
  hydrateWorkspaceIconThemes: (isCancelled: () => boolean) => Promise<void>
  navigationCoordinator: WorkspaceNavigationCoordinator
  restoreInitialConversationContext: (
    activeContext: ActiveWorkspaceContext,
    conversationState: ConversationState,
    options: {
      intent?: WorkspaceNavigationIntent
      isCancelled: () => boolean
    },
  ) => Promise<boolean>
  restoreWorkspaceTabs: (
    workspacePath: string,
    fallbackFilePath?: string | null,
    options?: { shouldApply?: () => boolean },
  ) => Promise<void>
  setActiveWorkspaceContext: (context: ActiveWorkspaceContext) => void
  setStatusMessage: (message: string) => void
}

export async function restoreAppBootstrapState(
  api: AppBootstrapApi,
  options: AppBootstrapOptions,
  isCancelled: () => boolean,
) {
  const intent = options.navigationCoordinator.begin('bootstrap')
  const isNavigationCurrent = () => (
    !isCancelled() && options.navigationCoordinator.isCurrent(intent)
  )
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

  if (!options.navigationCoordinator.isCurrent(intent)) {
    // A user action owns the visible target now. Re-read only the global list
    // data after queued navigation mutations settle; never resume the stale
    // workspace restoration itself.
    await options.navigationCoordinator.runDurable(intent, async () => {
      const [latestProjectState, latestConversationState] = await Promise.all([
        api.getProjectState(),
        api.getConversationState(),
      ])

      if (!isCancelled()) {
        options.hydrateProjectState(latestProjectState)
        options.hydrateConversationState(latestConversationState)
      }
    })
    return
  }

  options.hydrateProjectState(projectState)
  options.hydrateConversationState(conversationState)
  options.setActiveWorkspaceContext(activeContext)

  const activeProject = activeContext.kind === 'project'
    ? projectState.projects.find((project) => project.id === activeContext.projectId) ?? null
    : projectState.projects.find((project) => project.id === projectState.lastProjectId) ?? null

  await options.navigationCoordinator.run(intent, async (stillCurrent) => {
    const shouldApply = () => stillCurrent() && isNavigationCurrent()

    if (await options.restoreInitialConversationContext(
      activeContext,
      conversationState,
      { intent, isCancelled: () => !shouldApply() },
    )) {
      return
    }

    if (!shouldApply()) {
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
      const didConnect = await options.connectWorkspace(activeProject.path, { intent })

      if (didConnect && shouldApply()) {
        await options.restoreWorkspaceTabs(
          activeProject.path,
          activeProject.lastFilePath,
          { shouldApply },
        )
      }

      if (shouldApply()) {
        options.setStatusMessage('已恢复上次项目')
      }
    } catch {
      if (shouldApply()) {
        options.setStatusMessage('创建或打开项目以开始。')
      }
    }
  })
}

export function useAppBootstrap(options: AppBootstrapOptions) {
  const initialOptionsRef = useRef(options)

  useEffect(() => {
    let cancelled = false

    void initialOptionsRef.current.hydrateWorkspaceIconThemes(
      () => cancelled,
    ).catch((error: unknown) => {
      if (!cancelled) {
        console.error('[app] Failed to load workspace icon themes.', error)
      }
    })

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

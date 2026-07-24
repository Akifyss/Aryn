import { useCallback, useEffect, useRef } from 'react'
import {
  createWorkspaceRefreshCoordinator,
  type WorkspaceRefreshRequest,
  type WorkspaceRefreshScheduleMode,
} from '@/features/workspace/lib/workspace-refresh-coordinator'

const WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS = 140

export type WorkspaceGitRefresh = (
  workspacePath: string,
  options?: { silent?: boolean },
) => Promise<unknown>

type WorkspaceRefreshControllerOptions = {
  isActiveWorkspacePath: (rootPath: string) => boolean
  refreshGitState: WorkspaceGitRefresh
  reloadActiveWorkspaceTree: (rootPath: string) => Promise<void>
}

export function useWorkspaceRefreshController({
  isActiveWorkspacePath,
  refreshGitState,
  reloadActiveWorkspaceTree,
}: WorkspaceRefreshControllerOptions) {
  const performWorkspaceRefreshRef = useRef<
    (request: Required<WorkspaceRefreshRequest>) => Promise<void>
  >(async () => {})
  const coordinatorRef = useRef<
    ReturnType<typeof createWorkspaceRefreshCoordinator> | null
  >(null)

  const performWorkspaceRefresh = useCallback(async (
    rootPath: string,
    options: Omit<WorkspaceRefreshRequest, 'rootPath'> = {},
  ) => {
    if (!isActiveWorkspacePath(rootPath)) {
      return
    }

    if (options.refreshTree) {
      await reloadActiveWorkspaceTree(rootPath)
    }

    if (options.refreshGit) {
      await refreshGitState(rootPath, {
        silent: options.gitSilent ?? true,
      })
    }
  }, [isActiveWorkspacePath, refreshGitState, reloadActiveWorkspaceTree])

  performWorkspaceRefreshRef.current = (request) => (
    performWorkspaceRefresh(request.rootPath, request)
  )

  if (!coordinatorRef.current) {
    coordinatorRef.current = createWorkspaceRefreshCoordinator({
      debounceMs: WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS,
      onFlush: (request) => performWorkspaceRefreshRef.current(request),
    })
  }

  const requestWorkspaceRefresh = useCallback((
    request: WorkspaceRefreshRequest,
    mode: WorkspaceRefreshScheduleMode = 'immediate',
  ) => {
    return coordinatorRef.current?.request(request, mode) ?? Promise.resolve()
  }, [])

  const refreshWorkspaceAfterDocumentSave = useCallback((rootPath: string) => (
    performWorkspaceRefreshRef.current({
      gitSilent: true,
      refreshGit: true,
      refreshTree: true,
      rootPath,
    })
  ), [])

  useEffect(() => {
    return () => {
      coordinatorRef.current?.dispose()
    }
  }, [])

  return {
    performWorkspaceRefresh,
    refreshWorkspaceAfterDocumentSave,
    requestWorkspaceRefresh,
  }
}

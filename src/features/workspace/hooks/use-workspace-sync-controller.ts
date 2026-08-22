import { useCallback, useRef } from 'react'
import { getWorkspaceFileTabIdsForPath } from '@/features/workspace/lib/workspace-file-operation-state'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import { createDiffTab } from '@/features/workspace/lib/workspace-tabs'
import {
  useWorkspaceStore,
  type WorkspaceDiffTab,
} from '@/features/workspace/store/use-workspace-store'

type LoadWorkspaceTreeOptions = {
  onlyIfCurrent?: boolean
  shouldApply?: () => boolean
}

export function useWorkspaceSyncController(currentPath: string | null) {
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const openDiffTab = useWorkspaceStore((state) => state.openDiffTab)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const syncFileTabsWithDisk = useWorkspaceStore((state) => state.syncFileTabsWithDisk)
  const currentPathRef = useRef<string | null>(currentPath)
  const diffSyncRequestIdRef = useRef(0)
  currentPathRef.current = currentPath

  const isActiveWorkspacePath = useCallback((rootPath: string) => {
    const activePath = currentPathRef.current
    return Boolean(
      activePath
      && normalizeFilePath(activePath) === normalizeFilePath(rootPath),
    )
  }, [])

  const loadTree = useCallback(async (
    rootPath: string,
    options: LoadWorkspaceTreeOptions = {},
  ) => {
    const nextTree = await window.appApi.loadWorkspaceTree(rootPath)

    if (
      (options.onlyIfCurrent && !isActiveWorkspacePath(rootPath))
      || (options.shouldApply && !options.shouldApply())
    ) {
      return false
    }

    setTree(nextTree)
    return true
  }, [isActiveWorkspacePath, setTree])

  const reloadActiveWorkspaceTree = useCallback(async (rootPath: string) => {
    await loadTree(rootPath, { onlyIfCurrent: true })
  }, [loadTree])

  const syncOpenDiffTabs = useCallback(async (workspacePath: string) => {
    if (!isActiveWorkspacePath(workspacePath)) {
      return
    }

    const requestId = diffSyncRequestIdRef.current + 1
    diffSyncRequestIdRef.current = requestId
    const diffTabs = useWorkspaceStore.getState().openTabs.filter(
      (tab): tab is WorkspaceDiffTab => tab.kind === 'diff',
    )

    await Promise.all(diffTabs.map(async (tab) => {
      if (tab.diff.source.kind === 'commit') {
        return
      }

      try {
        const nextDiff = await window.appApi.getGitFileDiff(
          workspacePath,
          tab.diff.change.path,
          tab.diff.change.scope,
        )

        if (
          diffSyncRequestIdRef.current !== requestId
          || !isActiveWorkspacePath(workspacePath)
        ) {
          return
        }

        const currentTab = useWorkspaceStore.getState().openTabs.find(
          (candidate) => candidate.id === tab.id,
        )
        if (currentTab?.kind !== 'diff') {
          return
        }

        openDiffTab(createDiffTab(nextDiff), false)
      } catch {
        if (
          diffSyncRequestIdRef.current !== requestId
          || !isActiveWorkspacePath(workspacePath)
        ) {
          return
        }

        const currentTab = useWorkspaceStore.getState().openTabs.find(
          (candidate) => candidate.id === tab.id,
        )
        if (currentTab?.kind === 'diff' && !currentTab.isDirty) {
          closeTab(currentTab.id)
        }
      }
    }))
  }, [closeTab, isActiveWorkspacePath, openDiffTab])

  const reconcileWorkspaceFileAfterGitDiscard = useCallback(async (
    workspacePath: string,
    filePath: string,
  ) => {
    if (!isActiveWorkspacePath(workspacePath)) {
      return
    }

    try {
      const nextContent = await window.appApi.readWorkspaceFile(filePath)

      if (!isActiveWorkspacePath(workspacePath)) {
        return
      }

      syncFileTabsWithDisk(filePath, nextContent)
    } catch {
      if (!isActiveWorkspacePath(workspacePath)) {
        return
      }

      for (const tabId of getWorkspaceFileTabIdsForPath(
        useWorkspaceStore.getState().openTabs,
        filePath,
      )) {
        closeTab(tabId)
      }
    }
  }, [closeTab, isActiveWorkspacePath, syncFileTabsWithDisk])

  return {
    currentPathRef,
    isActiveWorkspacePath,
    loadTree,
    reconcileWorkspaceFileAfterGitDiscard,
    reloadActiveWorkspaceTree,
    syncOpenDiffTabs,
  }
}

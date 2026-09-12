import { useCallback, useRef } from 'react'
import { getWorkspaceFileTabIdsForPath } from '@/features/workspace/lib/workspace-file-operation-state'
import { hasPathPrefix, normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import { createDiffTab } from '@/features/workspace/lib/workspace-tabs'
import {
  useWorkspaceStore,
  type WorkspaceDiffTab,
} from '@/features/workspace/store/use-workspace-store'
import type { WorkspaceNode } from '@/features/workspace/types'

type LoadWorkspaceTreeOptions = {
  onlyIfCurrent?: boolean
  scope?: 'recursive' | 'root'
  shouldApply?: () => boolean
}

type AppliedWorkspaceTree = {
  rootPath: string
  scope: 'recursive' | 'root'
}

export function useWorkspaceSyncController(
  currentPath: string | null,
  isAgentLayout = true,
) {
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const openDiffTab = useWorkspaceStore((state) => state.openDiffTab)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const syncFileTabsWithDisk = useWorkspaceStore((state) => state.syncFileTabsWithDisk)
  const currentPathRef = useRef<string | null>(currentPath)
  const appliedWorkspaceTreeRef = useRef<AppliedWorkspaceTree | null>(null)
  const isAgentLayoutRef = useRef(isAgentLayout)
  const recursiveTreeLoadsRef = useRef(new Map<string, Promise<WorkspaceNode[]>>())
  const diffSyncRequestIdRef = useRef(0)
  currentPathRef.current = currentPath
  isAgentLayoutRef.current = isAgentLayout

  const isActiveWorkspacePath = useCallback((rootPath: string) => {
    const activePath = currentPathRef.current
    return Boolean(
      activePath
      && normalizeFilePath(activePath) === normalizeFilePath(rootPath),
    )
  }, [])

  const loadRecursiveWorkspaceTree = useCallback((rootPath: string) => {
    const identity = normalizeFilePath(rootPath)
    const pendingLoad = recursiveTreeLoadsRef.current.get(identity)
    if (pendingLoad) return pendingLoad

    const nextLoad = window.appApi.loadWorkspaceTree(rootPath)
    recursiveTreeLoadsRef.current.set(identity, nextLoad)
    void nextLoad.then(
      () => {
        if (recursiveTreeLoadsRef.current.get(identity) === nextLoad) {
          recursiveTreeLoadsRef.current.delete(identity)
        }
      },
      () => {
        if (recursiveTreeLoadsRef.current.get(identity) === nextLoad) {
          recursiveTreeLoadsRef.current.delete(identity)
        }
      },
    )
    return nextLoad
  }, [])

  const loadTree = useCallback(async (
    rootPath: string,
    options: LoadWorkspaceTreeOptions = {},
  ) => {
    let scope = options.scope ?? 'recursive'
    let nextTree = scope === 'root'
      ? await window.appApi.loadWorkspaceDirectory(rootPath)
      : await loadRecursiveWorkspaceTree(rootPath)

    const shouldPublish = () => !(
      (options.onlyIfCurrent && !isActiveWorkspacePath(rootPath))
      || (options.shouldApply && !options.shouldApply())
    )
    if (!shouldPublish()) {
      return false
    }

    // A root-only request may have started on the agent surface and settle
    // after the editor becomes active. Upgrade that same request instead of
    // briefly publishing a shallow tree or letting it overwrite a full tree.
    if (scope === 'root' && !isAgentLayoutRef.current) {
      nextTree = await loadRecursiveWorkspaceTree(rootPath)
      scope = 'recursive'
      if (!shouldPublish()) return false
    }

    setTree(nextTree)
    appliedWorkspaceTreeRef.current = { rootPath, scope }
    return true
  }, [isActiveWorkspacePath, loadRecursiveWorkspaceTree, setTree])

  const ensureFullyLoadedWorkspaceTree = useCallback(async (rootPath: string) => {
    const appliedTree = appliedWorkspaceTreeRef.current
    if (
      appliedTree?.scope === 'recursive'
      && normalizeFilePath(appliedTree.rootPath) === normalizeFilePath(rootPath)
    ) {
      return
    }

    await loadTree(rootPath, { onlyIfCurrent: true, scope: 'recursive' })
  }, [loadTree])

  const reloadActiveWorkspaceTree = useCallback(async (
    rootPath: string,
    options: Pick<LoadWorkspaceTreeOptions, 'scope'> = {},
  ) => {
    await loadTree(rootPath, { onlyIfCurrent: true, scope: options.scope })
  }, [loadTree])

  const syncOpenDiffTabs = useCallback(async (workspacePath: string) => {
    if (!isActiveWorkspacePath(workspacePath)) {
      return
    }

    const requestId = diffSyncRequestIdRef.current + 1
    diffSyncRequestIdRef.current = requestId
    const diffTabs = useWorkspaceStore.getState().openTabs.filter(
      (tab): tab is WorkspaceDiffTab => tab.kind === 'diff'
        && hasPathPrefix(workspacePath, tab.diff.repositoryRootPath),
    )

    await Promise.all(diffTabs.map(async (tab) => {
      if (tab.diff.source.kind === 'commit') {
        return
      }

      try {
        const nextDiff = await window.appApi.getGitFileDiff(
          tab.diff.repositoryRootPath,
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
    ensureFullyLoadedWorkspaceTree,
    isActiveWorkspacePath,
    loadTree,
    reconcileWorkspaceFileAfterGitDiscard,
    reloadActiveWorkspaceTree,
    syncOpenDiffTabs,
  }
}

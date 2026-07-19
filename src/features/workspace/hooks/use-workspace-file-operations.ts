import { useCallback, useMemo, useState } from 'react'
import type { WorkspaceNode } from '@/features/workspace/types'
import type { DirtyWorkspaceTab } from '@/features/workspace/lib/workspace-document-state'
import type { WorkspaceRefreshRequest } from '@/features/workspace/lib/workspace-refresh-coordinator'
import {
  collectWorkspaceDirectoryPaths,
  getWorkspaceMovedTabMutations,
  getWorkspaceTabIdsForNodePath,
  rebaseExpandedWorkspacePaths,
  resolveWorkspaceMoveRelativePath,
  resolveWorkspaceRenameTarget,
} from '@/features/workspace/lib/workspace-file-operation-state'
import {
  getNextUntitledDirectoryName,
  getNextUntitledFileName,
} from '@/features/workspace/lib/workspace-paths'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'

type ConfirmationOptions = {
  cancelLabel?: string
  confirmLabel?: string
  isDanger?: boolean
  message: string
  title: string
}

type UseWorkspaceFileOperationsOptions = {
  currentPath: string | null
  ensureWorkspaceTabsSavedBeforeNodeMutation: (options: {
    actionLabel: string
    nodePath: string
  }) => Promise<boolean>
  flushWorkspaceTabsForNode: (nodePath: string) => Promise<DirtyWorkspaceTab[]>
  openFile: (filePath: string) => Promise<void>
  performWorkspaceRefresh: (
    rootPath: string,
    options?: Omit<WorkspaceRefreshRequest, 'rootPath'>,
  ) => Promise<void>
  requestConfirmation: (options: ConfirmationOptions) => Promise<boolean>
  setStatusMessage: (message: string) => void
  syncPersistedActiveFile: (workspacePath: string) => Promise<void>
  tree: WorkspaceNode[]
}

export function useWorkspaceFileOperations({
  currentPath,
  ensureWorkspaceTabsSavedBeforeNodeMutation,
  flushWorkspaceTabsForNode,
  openFile,
  performWorkspaceRefresh,
  requestConfirmation,
  setStatusMessage,
  syncPersistedActiveFile,
  tree,
}: UseWorkspaceFileOperationsOptions) {
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const renameTab = useWorkspaceStore((state) => state.renameTab)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const rootDirectoryNames = useMemo(
    () => tree.filter((node) => node.kind === 'directory').map((node) => node.name),
    [tree],
  )
  const rootFileNames = useMemo(
    () => tree.filter((node) => node.kind === 'file').map((node) => node.name),
    [tree],
  )

  const resetExpandedPaths = useCallback(() => {
    setExpandedPaths(new Set())
  }, [])

  const createFile = useCallback(async () => {
    if (!currentPath) {
      return
    }

    const nextRelativePath = getNextUntitledFileName(rootFileNames)

    try {
      setIsCreatingFile(true)
      const { filePath } = await window.appApi.createWorkspaceFile(currentPath, nextRelativePath)
      await performWorkspaceRefresh(currentPath, {
        refreshGit: true,
        refreshTree: true,
      })
      await openFile(filePath)
      setStatusMessage(`${nextRelativePath} created`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create file.'
      setStatusMessage(message)
    } finally {
      setIsCreatingFile(false)
    }
  }, [
    currentPath,
    openFile,
    performWorkspaceRefresh,
    rootFileNames,
    setStatusMessage,
  ])

  const createDirectory = useCallback(async () => {
    if (!currentPath) {
      return
    }

    const nextRelativePath = getNextUntitledDirectoryName(rootDirectoryNames)

    try {
      setIsCreatingDirectory(true)
      await window.appApi.createWorkspaceDirectory(currentPath, nextRelativePath)
      await performWorkspaceRefresh(currentPath, { refreshTree: true })
      setStatusMessage(`${nextRelativePath} created`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create directory.'
      setStatusMessage(message)
    } finally {
      setIsCreatingDirectory(false)
    }
  }, [
    currentPath,
    performWorkspaceRefresh,
    rootDirectoryNames,
    setStatusMessage,
  ])

  const toggleTreeExpansion = useCallback(() => {
    if (expandedPaths.size > 0) {
      setExpandedPaths(new Set())
      setStatusMessage('All folders collapsed')
      return
    }

    setExpandedPaths(collectWorkspaceDirectoryPaths(tree))
    setStatusMessage('All folders expanded')
  }, [expandedPaths.size, setStatusMessage, tree])

  const applyMovedNodeState = useCallback((currentNodePath: string, nextNodePath: string) => {
    const mutations = getWorkspaceMovedTabMutations(
      useWorkspaceStore.getState().openTabs,
      currentNodePath,
      nextNodePath,
    )

    for (const mutation of mutations) {
      if (mutation.kind === 'rename-file') {
        renameTab(mutation.currentPath, mutation.nextPath)
      } else {
        closeTab(mutation.tabId)
      }
    }

    setExpandedPaths((currentExpandedPaths) => (
      rebaseExpandedWorkspacePaths(currentExpandedPaths, currentNodePath, nextNodePath)
    ))
  }, [closeTab, renameTab])

  const moveWorkspaceNode = useCallback(async (
    node: WorkspaceNode,
    nextRelativePath: string,
    successMessage: string,
  ) => {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    if (!(await ensureWorkspaceTabsSavedBeforeNodeMutation({
      actionLabel: `moving ${node.kind === 'directory' ? 'this folder' : 'this file'}`,
      nodePath: node.path,
    }))) {
      return
    }

    const { filePath: nextFilePath } = await window.appApi.moveWorkspaceEntry(
      currentPath,
      node.path,
      nextRelativePath,
    )
    await performWorkspaceRefresh(currentPath, {
      refreshGit: true,
      refreshTree: true,
    })
    applyMovedNodeState(node.path, nextFilePath)
    await syncPersistedActiveFile(currentPath)
    setStatusMessage(successMessage)
  }, [
    applyMovedNodeState,
    currentPath,
    ensureWorkspaceTabsSavedBeforeNodeMutation,
    performWorkspaceRefresh,
    setStatusMessage,
    syncPersistedActiveFile,
  ])

  const renameNode = useCallback(async (node: WorkspaceNode, nextName: string) => {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    const target = resolveWorkspaceRenameTarget(currentPath, node, nextName)
    await moveWorkspaceNode(node, target.relativePath, `${target.baseName} renamed`)
  }, [currentPath, moveWorkspaceNode])

  const moveNode = useCallback(async (node: WorkspaceNode, targetDirectoryPath: string) => {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    await moveWorkspaceNode(
      node,
      resolveWorkspaceMoveRelativePath(currentPath, node, targetDirectoryPath),
      `${node.name} moved`,
    )
  }, [currentPath, moveWorkspaceNode])

  const deleteNode = useCallback(async (node: WorkspaceNode) => {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    const hasDirtyTabs = (await flushWorkspaceTabsForNode(node.path)).length > 0

    if (hasDirtyTabs) {
      const targetLabel = node.kind === 'directory'
        ? `"${node.name}" contains unsaved editor tabs.\n\nDelete the folder and discard those changes?`
        : `"${node.name}" has unsaved changes in an editor tab.\n\nDelete the file and discard those changes?`
      const confirmed = await requestConfirmation({
        title: node.kind === 'directory' ? 'Delete Folder' : 'Delete File',
        message: targetLabel,
        confirmLabel: 'Delete',
        isDanger: true,
      })

      if (!confirmed) {
        return
      }
    }

    await window.appApi.deleteWorkspaceFile(currentPath, node.path)
    await performWorkspaceRefresh(currentPath, {
      refreshGit: true,
      refreshTree: true,
    })

    for (const tabId of getWorkspaceTabIdsForNodePath(
      useWorkspaceStore.getState().openTabs,
      node.path,
    )) {
      closeTab(tabId)
    }

    await syncPersistedActiveFile(currentPath)
    setStatusMessage(`${node.name} deleted`)
  }, [
    closeTab,
    currentPath,
    flushWorkspaceTabsForNode,
    performWorkspaceRefresh,
    requestConfirmation,
    setStatusMessage,
    syncPersistedActiveFile,
  ])

  return {
    createDirectory,
    createFile,
    deleteNode,
    expandedPaths,
    isCreatingDirectory,
    isCreatingFile,
    moveNode,
    renameNode,
    resetExpandedPaths,
    setExpandedPaths,
    toggleTreeExpansion,
  }
}

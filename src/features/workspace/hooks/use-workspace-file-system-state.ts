import { useCallback, useMemo, useState } from 'react'
import {
  mergeWorkspaceFileSystemState,
  readStoredFileSystemState,
  writeStoredFileSystemState,
} from '@/features/workspace/lib/workspace-tab-persistence'
import type {
  WorkspaceFileSystemNavigationState,
  WorkspaceFileSystemState,
  WorkspaceFileSystemView,
} from '@/features/workspace/types'

export function useWorkspaceFileSystemState(currentPath: string | null) {
  const [stateVersion, setStateVersion] = useState(0)
  const workspaceFileSystemState = useMemo(
    () => readStoredFileSystemState(currentPath),
    [currentPath, stateVersion],
  )
  const updateWorkspaceFileSystemState = useCallback(
    (patch: Partial<WorkspaceFileSystemState>) => {
      if (!currentPath) {
        return
      }

      const previousState = readStoredFileSystemState(currentPath)
      const nextState = mergeWorkspaceFileSystemState(previousState, patch)
      writeStoredFileSystemState(currentPath, nextState)
      setStateVersion((version) => version + 1)
    },
    [currentPath],
  )
  const handleWorkspaceFileSystemViewChange = useCallback(
    (view: WorkspaceFileSystemView) => {
      updateWorkspaceFileSystemState({ view })
    },
    [updateWorkspaceFileSystemState],
  )
  const handleWorkspaceFileSystemNavigationChange = useCallback(
    (navigation: WorkspaceFileSystemNavigationState) => {
      updateWorkspaceFileSystemState({ navigation })
    },
    [updateWorkspaceFileSystemState],
  )
  const handleWorkspaceFileSystemSelectionChange = useCallback(
    (selectedPath: string | null) => {
      updateWorkspaceFileSystemState({ selectedPath })
    },
    [updateWorkspaceFileSystemState],
  )

  return {
    handleWorkspaceFileSystemNavigationChange,
    handleWorkspaceFileSystemSelectionChange,
    handleWorkspaceFileSystemViewChange,
    workspaceFileSystemState,
  }
}

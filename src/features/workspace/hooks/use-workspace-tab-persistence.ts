import { useEffect } from 'react'
import {
  createStoredWorkspaceTabState,
  writeStoredTabState,
} from '@/features/workspace/lib/workspace-tab-persistence'
import {
  useWorkspaceStore,
  type WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'

export function useWorkspaceTabPersistence(
  currentPath: string | null,
  observedActiveTabId: string | null,
  openTabs: WorkspaceTab[],
) {
  useEffect(() => {
    if (!currentPath) {
      return
    }

    const latestActiveTabId = useWorkspaceStore.getState().activeTabId
    writeStoredTabState(currentPath, createStoredWorkspaceTabState(latestActiveTabId, openTabs))
  }, [observedActiveTabId, currentPath, openTabs])
}

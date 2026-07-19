import { useEffect, useMemo } from 'react'
import {
  deriveWorkspaceTabViewState,
  type WorkspaceTabViewStateOptions,
} from '@/features/workspace/lib/workspace-tabs'
import { recordOpenFileProfile } from '@/lib/open-file-profile'

export function useWorkspaceTabViewState(options: WorkspaceTabViewStateOptions) {
  const state = useMemo(
    () => deriveWorkspaceTabViewState(options),
    [
      options.activeAgentLayoutFixedTab,
      options.activeTabId,
      options.isAgentLayout,
      options.isAgentLayoutFixedTabActive,
      options.openTabs,
    ],
  )

  useEffect(() => {
    const { activeFileTab } = state

    if (!activeFileTab) {
      return
    }

    recordOpenFileProfile('app:active-file-tab:committed', {
      chars: activeFileTab.content.length,
      editorKind: activeFileTab.editorKind,
      filePath: activeFileTab.filePath,
      tabId: activeFileTab.id,
      viewMode: activeFileTab.viewMode,
    })
  }, [state.activeFileTab?.id])

  return state
}

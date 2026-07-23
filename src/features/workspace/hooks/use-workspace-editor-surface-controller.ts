import { useCallback, useEffect, useState } from 'react'
import {
  FIXED_FILE_TAB_ID,
  FIXED_GIT_TAB_ID,
  type AgentLayoutFixedTab,
  type WorkspaceTabViewStateOptions,
} from '@/features/workspace/lib/workspace-tabs'
import { useWorkspaceTabViewState } from './use-workspace-tab-view-state'

type UseWorkspaceEditorSurfaceControllerOptions = Pick<
  WorkspaceTabViewStateOptions,
  'activeTabId' | 'isAgentLayout' | 'openTabs'
> & {
  currentPath: string | null
}

type WorkspaceDirectorySidebarStateOptions = {
  currentPath: string | null
  hasActiveDocument: boolean
  isAgentLayout: boolean
  isDirectorySidebarOpen: boolean
  shouldRenderWorkspaceEditor: boolean
}

export function deriveWorkspaceDirectorySidebarState({
  currentPath,
  hasActiveDocument,
  isAgentLayout,
  isDirectorySidebarOpen,
  shouldRenderWorkspaceEditor,
}: WorkspaceDirectorySidebarStateOptions) {
  const isDirectorySidebarAvailable = Boolean(
    currentPath
    && isAgentLayout
    && shouldRenderWorkspaceEditor
    && hasActiveDocument,
  )
  const isDirectorySidebarVisible = (
    isDirectorySidebarAvailable
    && isDirectorySidebarOpen
  )

  return {
    isDirectorySidebarAvailable,
    isDirectorySidebarVisible,
    isDirectoryToggleSlotVisible: (
      isDirectorySidebarAvailable
      && !isDirectorySidebarVisible
    ),
  }
}

export function shouldResetAgentLayoutFixedTabState(
  displayActiveTabId: string | null,
  isAgentLayout: boolean,
) {
  return (
    !isAgentLayout
    && (
      displayActiveTabId === FIXED_FILE_TAB_ID
      || displayActiveTabId === FIXED_GIT_TAB_ID
    )
  )
}

export function useWorkspaceEditorSurfaceController({
  activeTabId,
  currentPath,
  isAgentLayout,
  openTabs,
}: UseWorkspaceEditorSurfaceControllerOptions) {
  const [activeAgentLayoutFixedTab, setActiveAgentLayoutFixedTab] =
    useState<AgentLayoutFixedTab>('file')
  const [isAgentLayoutFixedTabActive, setIsAgentLayoutFixedTabActive] =
    useState(false)
  const [isDirectorySidebarOpen, setIsDirectorySidebarOpen] = useState(true)
  const tabViewState = useWorkspaceTabViewState({
    activeAgentLayoutFixedTab,
    activeTabId,
    isAgentLayout,
    isAgentLayoutFixedTabActive,
    openTabs,
  })

  useEffect(() => {
    if (!shouldResetAgentLayoutFixedTabState(
      tabViewState.displayActiveTabId,
      isAgentLayout,
    )) {
      return
    }

    setIsAgentLayoutFixedTabActive(false)
    setActiveAgentLayoutFixedTab('file')
  }, [isAgentLayout, tabViewState.displayActiveTabId])

  const toggleDirectorySidebar = useCallback(() => {
    setIsDirectorySidebarOpen((currentValue) => !currentValue)
  }, [])
  const directorySidebarState = deriveWorkspaceDirectorySidebarState({
    currentPath,
    hasActiveDocument: Boolean(
      tabViewState.activeFileTab || tabViewState.activeDiffTab,
    ),
    isAgentLayout,
    isDirectorySidebarOpen,
    shouldRenderWorkspaceEditor: tabViewState.shouldRenderWorkspaceEditor,
  })

  return {
    ...tabViewState,
    ...directorySidebarState,
    setActiveAgentLayoutFixedTab,
    setIsAgentLayoutFixedTabActive,
    toggleDirectorySidebar,
  }
}

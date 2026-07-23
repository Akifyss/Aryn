import type { ComponentProps } from 'react'
import { FileTabs } from '@/features/workspace/components/file-tabs/file-tabs'
import { WorkspaceEditorContent } from '@/features/workspace/components/workspace-editor-content/workspace-editor-content'
import {
  WorkspaceEditorDirectorySidebar,
  WorkspaceEditorDirectoryToggle,
  WorkspaceEditorDirectoryToggleSlot,
  WorkspaceEditorDirectoryToggleSpacer,
  WorkspaceEditorEmptyState,
  WorkspaceEditorSurface,
} from '@/features/workspace/components/workspace-editor-surface/workspace-editor-surface'
import { WorkspaceFileSystemPanel } from '@/features/workspace/components/workspace-file-system-panel/workspace-file-system-panel'
import type { WorkspaceFixedPanelTab } from '@/features/workspace/store/use-workspace-store'
import {
  WorkspaceGitPane,
  WorkspaceNavigationPanels,
  type WorkspaceNavigationPanelConfiguration,
} from './workspace-navigation-panels'

type WorkspaceEditorWorkbenchProps = {
  activeFixedPanelTab: WorkspaceFixedPanelTab | null
  editorContent: Omit<
    ComponentProps<typeof WorkspaceEditorContent>,
    'leadingToolbarAction'
  >
  emptyState: ComponentProps<typeof WorkspaceEditorEmptyState>
  fileSystemPanel: ComponentProps<typeof WorkspaceFileSystemPanel>
  fileTabs: ComponentProps<typeof FileTabs>
  isDirectorySidebarAvailable: boolean
  isDirectorySidebarVisible: boolean
  isDirectoryToggleSlotVisible: boolean
  navigation: WorkspaceNavigationPanelConfiguration
  onToggleDirectorySidebar: () => void
}

export function WorkspaceEditorWorkbench({
  activeFixedPanelTab,
  editorContent,
  emptyState,
  fileSystemPanel,
  fileTabs,
  isDirectorySidebarAvailable,
  isDirectorySidebarVisible,
  isDirectoryToggleSlotVisible,
  navigation,
  onToggleDirectorySidebar,
}: WorkspaceEditorWorkbenchProps) {
  const directorySidebarToggle = isDirectorySidebarAvailable ? (
    <WorkspaceEditorDirectoryToggle
      isVisible={isDirectorySidebarVisible}
      onToggle={onToggleDirectorySidebar}
    />
  ) : null
  const leadingToolbarAction = isDirectoryToggleSlotVisible
    ? <WorkspaceEditorDirectoryToggleSpacer />
    : null
  const hasActiveDocument = Boolean(
    editorContent.activeFileTab || editorContent.activeDiffTab,
  )

  return (
    <WorkspaceEditorSurface
      tabs={<FileTabs {...fileTabs} />}
    >
      {activeFixedPanelTab?.fixedTabKind === 'file-panel' ? (
        <WorkspaceFileSystemPanel {...fileSystemPanel} />
      ) : null}
      {activeFixedPanelTab?.fixedTabKind === 'git-panel' ? (
        <WorkspaceGitPane configuration={navigation} />
      ) : null}
      {isDirectorySidebarVisible ? (
        <WorkspaceEditorDirectorySidebar>
          <WorkspaceNavigationPanels
            configuration={navigation}
            fileClickMode='replace-active-tab'
            surfaceMode='docked'
            tabListAction={directorySidebarToggle}
          />
        </WorkspaceEditorDirectorySidebar>
      ) : null}
      {isDirectoryToggleSlotVisible ? (
        <WorkspaceEditorDirectoryToggleSlot>
          {directorySidebarToggle}
        </WorkspaceEditorDirectoryToggleSlot>
      ) : null}
      {!activeFixedPanelTab && !hasActiveDocument ? (
        <WorkspaceEditorEmptyState {...emptyState} />
      ) : null}

      <WorkspaceEditorContent
        {...editorContent}
        leadingToolbarAction={leadingToolbarAction}
      />
    </WorkspaceEditorSurface>
  )
}

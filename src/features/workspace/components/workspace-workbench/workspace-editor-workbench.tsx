import { useId, type ComponentProps, type ReactNode } from 'react'
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
  directorySidebarContent?: ReactNode
  directorySidebarSide?: 'left' | 'right'
  directorySidebarId?: string
  auxiliaryContent?: ReactNode
  fixedPanelContent?: ReactNode
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

const directoryToggleSpacer = <WorkspaceEditorDirectoryToggleSpacer />

export function WorkspaceEditorWorkbench({
  directorySidebarContent,
  directorySidebarSide = 'left',
  directorySidebarId,
  auxiliaryContent,
  fixedPanelContent,
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
  const contentPanelId = useId()
  const directorySidebarToggle = isDirectorySidebarAvailable ? (
    <WorkspaceEditorDirectoryToggle
      isVisible={isDirectorySidebarVisible}
      onToggle={onToggleDirectorySidebar}
    />
  ) : null
  const leadingToolbarAction = isDirectoryToggleSlotVisible
    ? directoryToggleSpacer
    : null
  const hasActiveDocument = Boolean(
    editorContent.activeFileTab || editorContent.activeDiffTab,
  )
  const directorySidebar = isDirectorySidebarVisible ? (
    <WorkspaceEditorDirectorySidebar side={directorySidebarSide} id={directorySidebarId}>
      {directorySidebarContent ?? <WorkspaceNavigationPanels
        configuration={navigation}
        fileClickMode='replace-active-tab'
        surfaceMode='docked'
        tabListAction={directorySidebarToggle}
      />}
    </WorkspaceEditorDirectorySidebar>
  ) : null

  return (
    <WorkspaceEditorSurface
      contentPanelId={contentPanelId}
      tabs={<FileTabs {...fileTabs} contentPanelId={contentPanelId} />}
    >
      {directorySidebarSide === 'left' ? directorySidebar : null}
      {fixedPanelContent}
      {fixedPanelContent === undefined && activeFixedPanelTab?.fixedTabKind === 'file-panel' ? (
        <WorkspaceFileSystemPanel {...fileSystemPanel} />
      ) : null}
      {fixedPanelContent === undefined && activeFixedPanelTab?.fixedTabKind === 'git-panel' ? (
        <WorkspaceGitPane configuration={navigation} />
      ) : null}
      {isDirectoryToggleSlotVisible ? (
        <WorkspaceEditorDirectoryToggleSlot>
          {directorySidebarToggle}
        </WorkspaceEditorDirectoryToggleSlot>
      ) : null}
      {!activeFixedPanelTab && !hasActiveDocument && !auxiliaryContent ? (
        <WorkspaceEditorEmptyState {...emptyState} />
      ) : null}

      {auxiliaryContent}

      <WorkspaceEditorContent
        {...editorContent}
        leadingToolbarAction={leadingToolbarAction}
      />
      {directorySidebarSide === 'right' ? directorySidebar : null}
    </WorkspaceEditorSurface>
  )
}

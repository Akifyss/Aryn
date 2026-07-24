import type { ComponentProps, ReactNode } from 'react'
import { GitPanel } from '@/features/git/components/git-panel/git-panel'
import {
  WorkspaceSidebarTabs,
  type WorkspaceSidebarTab,
} from '@/features/workspace/components/workspace-sidebar-tabs/workspace-sidebar-tabs'
import type { WorkspaceSidebarSurfaceMode } from '@/features/workspace/components/workspace-sidebar/workspace-sidebar'
import { WorkspaceTreePanel } from '@/features/workspace/components/workspace-tree-panel/workspace-tree-panel'
import type { WorkspaceTreeActivationEvent } from '@/features/workspace/components/workspace-tree/workspace-tree'
import { resolveWorkspaceTreeActiveFilePath } from '@/features/workspace/lib/workspace-tree-active-file'
import './workspace-navigation-panels.css'

type GitPanelConfiguration = Omit<
  ComponentProps<typeof GitPanel>,
  'menuPortalTarget'
>

type WorkspaceTreePanelConfiguration = Omit<
  ComponentProps<typeof WorkspaceTreePanel>,
  | 'activeFilePath'
  | 'directoryHeaderAction'
  | 'menuPortalTarget'
  | 'onSelectFile'
  | 'showDirectoryHeader'
  | 'title'
>

export type WorkspaceTreeFileClickMode = 'open-tab' | 'replace-active-tab'

type WorkspaceTreeActivationModifiers = Pick<
  WorkspaceTreeActivationEvent,
  'button' | 'ctrlKey' | 'metaKey'
>

export function shouldReplaceActiveTreeFile(
  fileClickMode: WorkspaceTreeFileClickMode,
  event: WorkspaceTreeActivationModifiers,
) {
  return (
    fileClickMode === 'replace-active-tab'
    && event.button === 0
    && !event.ctrlKey
    && !event.metaKey
  )
}

export type WorkspaceNavigationPanelConfiguration = {
  activeTab: WorkspaceSidebarTab
  activeTreePath: string | null
  gitPanel: GitPanelConfiguration
  treePanel: WorkspaceTreePanelConfiguration
  workspaceLabel: string
  onActiveTabChange: (tab: WorkspaceSidebarTab) => void
  onOpenFile: (filePath: string) => void
  onReplaceActiveFile: (filePath: string) => void
}

type WorkspaceTreePaneProps = {
  configuration: WorkspaceNavigationPanelConfiguration
  fileClickMode?: WorkspaceTreeFileClickMode
  menuPortalTarget?: HTMLElement | null
}

function WorkspaceTreePane({
  configuration,
  fileClickMode = 'open-tab',
  menuPortalTarget = null,
}: WorkspaceTreePaneProps) {
  const {
    activeTreePath,
    treePanel,
    onOpenFile,
    onReplaceActiveFile,
  } = configuration
  const activeFilePath = resolveWorkspaceTreeActiveFilePath(
    activeTreePath,
    'track-active-file',
  )
  const handleSelectFile = (
    filePath: string,
    event: WorkspaceTreeActivationEvent,
  ) => {
    if (shouldReplaceActiveTreeFile(fileClickMode, event)) {
      onReplaceActiveFile(filePath)
      return
    }

    onOpenFile(filePath)
  }

  return (
    <WorkspaceTreePanel
      {...treePanel}
      activeFilePath={activeFilePath}
      menuPortalTarget={menuPortalTarget}
      title='文件树'
      onSelectFile={handleSelectFile}
    />
  )
}

type WorkspaceGitPaneProps = {
  configuration: WorkspaceNavigationPanelConfiguration
  menuPortalTarget?: HTMLElement | null
}

export function WorkspaceGitPane({
  configuration,
  menuPortalTarget = null,
}: WorkspaceGitPaneProps) {
  return (
    <div className='sidebar-stack-pane sidebar-git-pane' id='git-panel'>
      <GitPanel
        {...configuration.gitPanel}
        menuPortalTarget={menuPortalTarget}
      />
    </div>
  )
}

type WorkspaceNavigationPanelsProps = {
  configuration: WorkspaceNavigationPanelConfiguration
  fileClickMode?: WorkspaceTreeFileClickMode
  menuPortalTarget?: HTMLElement | null
  surfaceMode: WorkspaceSidebarSurfaceMode
  tabListAction?: ReactNode
}

export function WorkspaceNavigationPanels({
  configuration,
  fileClickMode = 'open-tab',
  menuPortalTarget = null,
  surfaceMode,
  tabListAction,
}: WorkspaceNavigationPanelsProps) {
  const panelMenuPortalTarget = surfaceMode === 'drawer'
    ? menuPortalTarget
    : null

  return (
    <WorkspaceSidebarTabs
      activeTab={configuration.activeTab}
      filePanel={(
        <WorkspaceTreePane
          configuration={configuration}
          fileClickMode={fileClickMode}
          menuPortalTarget={panelMenuPortalTarget}
        />
      )}
      gitPanel={(
        <WorkspaceGitPane
          configuration={configuration}
          menuPortalTarget={panelMenuPortalTarget}
        />
      )}
      tabListAction={tabListAction}
      onActiveTabChange={configuration.onActiveTabChange}
    />
  )
}

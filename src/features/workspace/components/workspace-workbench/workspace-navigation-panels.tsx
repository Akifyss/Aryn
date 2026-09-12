import type { ComponentProps } from 'react'
import { GitPanel } from '@/features/git/components/git-panel/git-panel'
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
  activeTreePath: string | null
  gitPanel: GitPanelConfiguration
  treePanel: WorkspaceTreePanelConfiguration
  workspaceLabel: string
  onOpenFile: (filePath: string) => void
  onReplaceActiveFile: (filePath: string) => void
}

type WorkspaceTreePaneProps = {
  configuration: WorkspaceNavigationPanelConfiguration
  fileClickMode?: WorkspaceTreeFileClickMode
  menuPortalTarget?: HTMLElement | null
}

export function WorkspaceTreePane({
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
    <div className='sidebar-stack-pane sidebar-git-pane'>
      <GitPanel
        {...configuration.gitPanel}
        menuPortalTarget={menuPortalTarget}
      />
    </div>
  )
}

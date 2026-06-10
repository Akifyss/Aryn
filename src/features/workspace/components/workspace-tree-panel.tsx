import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from 'react'
import { Icon } from '@iconify/react'
import { FolderForbidLine } from '@mingcute/react'
import { TreeItem, TreeItemActionButton, TreeScrollArea } from '@/components/tree'
import { WorkspaceTree } from '@/features/workspace/components/workspace-tree'
import type { GitChangeItem, GitRepositoryState } from '@/features/git/types'
import type { WorkspaceIconTheme, WorkspaceNode } from '@/features/workspace/types'

type WorkspaceTreePanelProps = {
  activeFilePath: string | null
  directoryHeaderAction?: ReactNode
  expandedPaths: Set<string>
  gitRepositoryState?: GitRepositoryState | null
  iconTheme: WorkspaceIconTheme | null
  isCreatingDirectory: boolean
  isCreatingFile: boolean
  menuPortalTarget?: HTMLElement | null
  nodes: WorkspaceNode[]
  setExpandedPaths: Dispatch<SetStateAction<Set<string>>>
  showDirectoryHeader?: boolean
  title: string
  workspacePath: string | null
  workspaceUnavailableMessage?: string | null
  onCreateDirectory: () => void
  onCreateFile: () => void
  onDeleteNode: (node: WorkspaceNode) => Promise<void>
  onMoveNode: (node: WorkspaceNode, targetDirectoryPath: string) => Promise<void>
  onOpenDiff?: (change: GitChangeItem) => void
  onOpenInCodeEditor: (path: string) => void
  onRenameNode: (node: WorkspaceNode, nextName: string) => Promise<void>
  onSelectFile: (path: string, event: MouseEvent<HTMLElement>) => void
  onToggleFileTreeExpansion: () => void
}

export function WorkspaceTreePanel({
  activeFilePath,
  directoryHeaderAction,
  expandedPaths,
  gitRepositoryState,
  iconTheme,
  isCreatingDirectory,
  isCreatingFile,
  menuPortalTarget,
  nodes,
  setExpandedPaths,
  showDirectoryHeader = false,
  title,
  workspacePath,
  workspaceUnavailableMessage,
  onCreateDirectory,
  onCreateFile,
  onDeleteNode,
  onMoveNode,
  onOpenDiff,
  onOpenInCodeEditor,
  onRenameNode,
  onSelectFile,
  onToggleFileTreeExpansion,
}: WorkspaceTreePanelProps) {
  return (
    <div className={`sidebar-stack-pane workspace-tree-pane${showDirectoryHeader ? ' has-directory-header' : ''}`}>
      {showDirectoryHeader ? (
        <div className='workspace-tree-panel-directory-header'>
          <span className='workspace-tree-panel-directory-title'>目录</span>
          {directoryHeaderAction ? (
            <div className='workspace-tree-panel-directory-action'>
              {directoryHeaderAction}
            </div>
          ) : null}
        </div>
      ) : null}

      <TreeItem
        variant='header'
        itemClassName='file-panel-header'
        label={title}
        actions={(
          <>
            <TreeItemActionButton
              onClick={onCreateFile}
              disabled={!workspacePath || isCreatingFile}
              aria-label='Create File'
              title='新建文件'
            >
              <Icon icon='lucide:file-plus' width={16} height={16} />
            </TreeItemActionButton>
            <TreeItemActionButton
              onClick={onCreateDirectory}
              disabled={!workspacePath || isCreatingDirectory}
              aria-label='Create Folder'
              title='新建文件夹'
            >
              <Icon icon='lucide:folder-plus' width={16} height={16} />
            </TreeItemActionButton>
            <TreeItemActionButton
              onClick={onToggleFileTreeExpansion}
              disabled={!workspacePath || nodes.length === 0}
              aria-label='Toggle Expansion'
              title={expandedPaths.size > 0 ? '全部折叠' : '全部展开'}
            >
              <Icon
                icon={expandedPaths.size > 0 ? 'lucide:fold-vertical' : 'lucide:unfold-vertical'}
                width={16}
                height={16}
              />
            </TreeItemActionButton>
          </>
        )}
      />

      <TreeScrollArea
        className='workspace-tree-scroll'
        contentClassName='workspace-tree-scroll-content'
      >
        {workspaceUnavailableMessage ? (
          <div className='workspace-tree-empty-state'>
            <div className='workspace-tree-empty-icon'>
              <FolderForbidLine size={26} />
            </div>
            <p>{workspaceUnavailableMessage}</p>
          </div>
        ) : (
          <WorkspaceTree
            activeFilePath={activeFilePath}
            iconTheme={iconTheme}
            nodes={nodes}
            expandedPaths={expandedPaths}
            setExpandedPaths={setExpandedPaths}
            workspacePath={workspacePath}
            gitRepositoryState={gitRepositoryState}
            menuPortalTarget={menuPortalTarget}
            onDeleteNode={onDeleteNode}
            onMoveNode={onMoveNode}
            onOpenDiff={onOpenDiff}
            onOpenInCodeEditor={onOpenInCodeEditor}
            onRenameNode={onRenameNode}
            onSelectFile={onSelectFile}
          />
        )}
      </TreeScrollArea>
    </div>
  )
}

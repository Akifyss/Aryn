import type { Dispatch, MouseEvent, ReactNode, SetStateAction } from 'react'
import { Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { FolderForbidLine } from '@mingcute/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import { TreeHeader } from '@/components/tree-header'
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
  onSelectFile: (path: string, event: MouseEvent<HTMLDivElement>) => void
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
    <div className={`sidebar-stack-pane sidebar-tree-pane${showDirectoryHeader ? ' has-directory-header' : ''}`}>
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

      <TreeHeader
        className='file-panel-header'
        title={title}
        actions={(
          <>
            <Tooltip closeDelay={0}>
              <Tooltip.Trigger>
                <button
                  type='button'
                  className='file-panel-action'
                  onClick={onCreateFile}
                  disabled={!workspacePath || isCreatingFile}
                  aria-label='Create File'
                >
                  <Icon icon='lucide:file-plus' width={16} height={16} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>Create File</Tooltip.Content>
            </Tooltip>
            <Tooltip closeDelay={0}>
              <Tooltip.Trigger>
                <button
                  type='button'
                  className='file-panel-action'
                  onClick={onCreateDirectory}
                  disabled={!workspacePath || isCreatingDirectory}
                  aria-label='Create Folder'
                >
                  <Icon icon='lucide:folder-plus' width={16} height={16} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>Create Folder</Tooltip.Content>
            </Tooltip>
            <Tooltip closeDelay={0}>
              <Tooltip.Trigger>
                <button
                  type='button'
                  className='file-panel-action'
                  onClick={onToggleFileTreeExpansion}
                  disabled={!workspacePath || nodes.length === 0}
                  aria-label='Toggle Expansion'
                >
                  <Icon
                    icon={expandedPaths.size > 0 ? 'lucide:fold-vertical' : 'lucide:unfold-vertical'}
                    width={16}
                    height={16}
                  />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>{expandedPaths.size > 0 ? 'Collapse All' : 'Expand All'}</Tooltip.Content>
            </Tooltip>
          </>
        )}
      />

      <AppScrollArea
        className='tree-scroll'
        contentClassName='tree-scroll-content'
      >
        {workspaceUnavailableMessage ? (
          <div className='tree-empty-state'>
            <div className='tree-empty-icon'>
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
      </AppScrollArea>
    </div>
  )
}

import { type Dispatch, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type SetStateAction, useEffect, useRef, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { AlertDialog, Button, useOverlayState } from '@heroui/react'
import {
  CheckLine,
  CloseLine,
  CodeLine,
  Delete2Line,
  Edit2Line,
  ExternalLinkLine,
  FolderLine,
  GitBranchLine,
  More1Line,
} from '@mingcute/react'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
import {
  TreeItemActionButton,
  TreeItemChildren,
  TreeItem,
  TreeList,
  TreeItemMain,
} from '@/components/tree'
import { pickDominantGitDisplayChange } from '@/features/git/lib/display-change'
import {
  getSupportedWorkspaceEditorKind,
  supportsAlternateCodeEditorView,
} from '@/features/workspace/lib/file-types'
import {
  areSameWorkspacePaths,
  canMoveNodeToDirectory,
  normalizeWorkspacePath,
  resolveDropTargetDirectoryPath,
} from '@/features/workspace/lib/workspace-tree-dnd'
import { recordOpenFileProfile } from '@/lib/open-file-profile'
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'
import type { WorkspaceIconTheme, WorkspaceNode } from '@/features/workspace/types'
import type { GitChangeItem, GitDisplayChange, GitRepositoryState } from '@/features/git/types'
import { WorkspaceTreeEmptyState } from './workspace-tree-empty-state'
import './styles.css'

export type WorkspaceTreeActivationEvent = Pick<MouseEvent<HTMLElement>, 'button' | 'ctrlKey' | 'metaKey'>

type WorkspaceTreeProps = {
  activeFilePath: string | null
  iconTheme: WorkspaceIconTheme | null
  nodes: WorkspaceNode[]
  expandedPaths: Set<string>
  setExpandedPaths: Dispatch<SetStateAction<Set<string>>>
  workspacePath: string | null
  onSelectFile: (path: string, event: WorkspaceTreeActivationEvent) => void
  onOpenInCodeEditor: (path: string) => void
  onOpenDiff?: (change: GitChangeItem) => void
  onRenameNode: (node: WorkspaceNode, nextName: string) => Promise<void>
  onDeleteNode: (node: WorkspaceNode) => Promise<void>
  onMoveNode: (node: WorkspaceNode, targetDirectoryPath: string) => Promise<void>
  gitRepositoryState?: GitRepositoryState | null
  menuPortalTarget?: HTMLElement | null
}

function findGitChangeByFilePath(repositoryState: GitRepositoryState | null | undefined, node: WorkspaceNode): GitDisplayChange | null {
  if (!repositoryState?.isRepository) return null

  const targetPath = normalizeWorkspacePath(node.path)

  if (node.kind === 'file') {
    return repositoryState.unstagedChanges.find(c => normalizeWorkspacePath(c.path) === targetPath)
      ?? repositoryState.stagedChanges.find(c => normalizeWorkspacePath(c.path) === targetPath)
      ?? null
  }

  const prefix = targetPath.endsWith('/') ? targetPath : `${targetPath}/`
  const unstaged = repositoryState.unstagedChanges.filter(c => normalizeWorkspacePath(c.path).startsWith(prefix))
  const staged = repositoryState.stagedChanges.filter(c => normalizeWorkspacePath(c.path).startsWith(prefix))
  const allChanges = [...unstaged, ...staged]

  if (allChanges.length === 0) {
    return null
  }

  const dominantChange = pickDominantGitDisplayChange(allChanges)

  if (!dominantChange) {
    return null
  }

  return { ...dominantChange, path: node.path } as GitDisplayChange
}

function getGitChangeTooltip(kind: GitDisplayChange['kind']) {
  switch (kind) {
    case 'added':
      return '新增'
    case 'copied':
      return '复制'
    case 'conflicted':
      return '冲突'
    case 'deleted':
      return '删除'
    case 'modified':
      return '修改'
    case 'renamed':
      return '重命名'
    case 'type-changed':
      return '类型变更'
    case 'untracked':
      return '未跟踪'
  }
}

function findGitDiffChangeByFilePath(repositoryState: GitRepositoryState | null | undefined, node: WorkspaceNode): GitChangeItem | null {
  if (!repositoryState?.isRepository || node.kind !== 'file') {
    return null
  }

  const targetPath = normalizeWorkspacePath(node.path)

  return repositoryState.unstagedChanges.find(c => normalizeWorkspacePath(c.path) === targetPath)
    ?? repositoryState.stagedChanges.find(c => normalizeWorkspacePath(c.path) === targetPath)
    ?? null
}

function getSystemFileManagerName(platform: string) {
  if (platform === 'darwin') return '访达'
  if (platform === 'win32') return '资源管理器'
  return '文件管理器'
}

function stopFileActionMenuPropagation(event: MouseEvent<HTMLElement>) {
  event.stopPropagation()
}

function runFileActionMenuAction(event: MouseEvent<HTMLElement>, action: () => void) {
  stopFileActionMenuPropagation(event)
  action()
}

function FileRowActionMenu({
  canOpenInCodeEditor,
  onOpenInCodeEditor,
  onRename,
  onDelete,
  onShowInFolder,
  isSubmitting,
  gitDiffChange,
  menuPortalTarget,
  onOpenDiff,
  onMenuOpenChange,
}: {
  canOpenInCodeEditor: boolean
  onOpenInCodeEditor: () => void
  onRename: () => void
  onDelete: () => void
  onShowInFolder: () => void
  isSubmitting: boolean
  gitDiffChange: GitChangeItem | null
  menuPortalTarget?: HTMLElement | null
  onOpenDiff?: (change: GitChangeItem) => void
  onMenuOpenChange?: (open: boolean) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const systemManagerName = getSystemFileManagerName(window.appApi.platform)

  const updateOpen = (open: boolean) => {
    setIsOpen(open)
    onMenuOpenChange?.(open)
  }

  return (
        <Menu.Root
          modal={false}
          open={isOpen}
          onOpenChange={(open, details) => {
            if (open) {
              updateOpen(true)
              return
            }

            if (shouldCloseClickOpenedMenu(details)) {
              updateOpen(false)
            } else {
              details.cancel?.()
            }
          }}
        >
          <Menu.Trigger
            aria-label='File actions'
            disabled={isSubmitting}
            render={<TreeItemActionButton />}
            title='更多'
          >
            <More1Line size={16} />
          </Menu.Trigger>
          <Menu.Portal
            className='workspace-tree-menu-portal'
            container={menuPortalTarget ?? undefined}
          >
            <Menu.Positioner
              align='end'
              className='workspace-tree-menu-positioner'
              collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
              collisionPadding={8}
              positionMethod='fixed'
              side='bottom'
              sideOffset={2}
            >
              <Menu.Popup
                aria-label='File actions'
                className='workspace-tree-menu'
                finalFocus={false}
                onAuxClick={stopFileActionMenuPropagation}
                onClick={stopFileActionMenuPropagation}
              >
                {canOpenInCodeEditor ? (
                  <Menu.Item
                    nativeButton
                    render={<button type='button' />}
                    className={({ highlighted }) => `workspace-tree-menu-item${highlighted ? ' is-highlighted' : ''}`}
                    data-menu-action='open-code'
                    label='在代码编辑器打开'
                    onClick={(event) => runFileActionMenuAction(event, onOpenInCodeEditor)}
                  >
                    <CodeLine size={16} className='workspace-tree-menu-icon' />
                    <span>在代码编辑器打开</span>
                  </Menu.Item>
                ) : null}
                {gitDiffChange && onOpenDiff ? (
                  <Menu.Item
                    nativeButton
                    render={<button type='button' />}
                    className={({ highlighted }) => `workspace-tree-menu-item${highlighted ? ' is-highlighted' : ''}`}
                    data-menu-action='open-diff'
                    label='查看差异'
                    onClick={(event) => runFileActionMenuAction(event, () => onOpenDiff(gitDiffChange))}
                  >
                    <GitBranchLine size={16} className='workspace-tree-menu-icon' />
                    <span>查看差异</span>
                  </Menu.Item>
                ) : null}
                <Menu.Item
                  nativeButton
                  render={<button type='button' />}
                  className={({ highlighted }) => `workspace-tree-menu-item${highlighted ? ' is-highlighted' : ''}`}
                  data-menu-action='show-in-folder'
                  label={`在“${systemManagerName}”中打开`}
                  onClick={(event) => runFileActionMenuAction(event, onShowInFolder)}
                >
                  <ExternalLinkLine size={16} className='workspace-tree-menu-icon' />
                  <span>{`在“${systemManagerName}”中打开`}</span>
                </Menu.Item>
                <Menu.Item
                  nativeButton
                  render={<button type='button' />}
                  className={({ highlighted }) => `workspace-tree-menu-item${highlighted ? ' is-highlighted' : ''}`}
                  data-menu-action='rename'
                  label='重命名'
                  onClick={(event) => runFileActionMenuAction(event, onRename)}
                >
                  <Edit2Line size={16} className='workspace-tree-menu-icon' />
                  <span>重命名</span>
                </Menu.Item>
                <Menu.Item
                  nativeButton
                  render={<button type='button' />}
                  className={({ highlighted }) => `workspace-tree-menu-item is-danger${highlighted ? ' is-highlighted' : ''}`}
                  data-menu-action='delete'
                  label='删除'
                  onClick={(event) => runFileActionMenuAction(event, onDelete)}
                >
                  <Delete2Line size={16} className='workspace-tree-menu-icon' />
                  <span>删除</span>
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
  )
}

function FileTreeItem({
  activeFilePath,
  draggedNode,
  dropTargetDirectoryPath,
  expandedPaths,
  iconTheme,
  node,
  workspacePath,
  onDeleteNode,
  onDragEndNode,
  onDragLeaveNode,
  onDragOverNode,
  onDragStartNode,
  onDropOnNode,
  onOpenInCodeEditor,
  onOpenDiff,
  onRenameNode,
  onSelectFile,
  onToggleDirectory,
  gitRepositoryState,
  menuPortalTarget,
}: {
  activeFilePath: string | null
  draggedNode: WorkspaceNode | null
  dropTargetDirectoryPath: string | null
  expandedPaths: Set<string>
  iconTheme: WorkspaceIconTheme | null
  node: WorkspaceNode
  workspacePath: string | null
  onDeleteNode: (node: WorkspaceNode) => Promise<void>
  onDragEndNode: () => void
  onDragLeaveNode: (node: WorkspaceNode, event: DragEvent<HTMLElement>) => void
  onDragOverNode: (node: WorkspaceNode, event: DragEvent<HTMLElement>) => void
  onDragStartNode: (node: WorkspaceNode, event: DragEvent<HTMLElement>) => void
  onDropOnNode: (node: WorkspaceNode, event: DragEvent<HTMLElement>) => Promise<void>
  onOpenInCodeEditor: (path: string) => void
  onOpenDiff?: (change: GitChangeItem) => void
  onRenameNode: (node: WorkspaceNode, nextName: string) => Promise<void>
  onSelectFile: (path: string, event: WorkspaceTreeActivationEvent) => void
  onToggleDirectory: (path: string) => void
  gitRepositoryState?: GitRepositoryState | null
  menuPortalTarget?: HTMLElement | null
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isRowMenuOpen, setIsRowMenuOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const isFolder = node.kind === 'directory'
  const editorKind = node.kind === 'file' ? getSupportedWorkspaceEditorKind(node.path) : null
  const canOpenInCodeEditor = node.kind === 'file' && editorKind !== null && supportsAlternateCodeEditorView(node.path, editorKind)
  const isExpanded = expandedPaths.has(node.path)
  const isActive = activeFilePath === node.path
  const gitChange = findGitChangeByFilePath(gitRepositoryState, node)
  const gitDiffChange = findGitDiffChangeByFilePath(gitRepositoryState, node)
  const resolvedDropTargetDirectoryPath = resolveDropTargetDirectoryPath(node, workspacePath)
  const isDragSource = draggedNode?.path === node.path
  const isDropTarget = Boolean(
    isFolder
    && resolvedDropTargetDirectoryPath
    && dropTargetDirectoryPath
    && areSameWorkspacePaths(dropTargetDirectoryPath, resolvedDropTargetDirectoryPath),
  )

  useEffect(() => {
    setDraftName(node.name)
  }, [node.name])

  useEffect(() => {
    if (isEditing) {
      setIsRowMenuOpen(false)
    }
  }, [isEditing])

  useEffect(() => {
    if (!isEditing) return

    const frameId = window.requestAnimationFrame(() => {
      const input = renameInputRef.current
      if (!input) return

      input.focus()
      input.setSelectionRange(0, input.value.length)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isEditing])

  const handleSubmitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!draftName.trim() || draftName === node.name) {
      setIsEditing(false)
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await onRenameNode(node, draftName)
      setIsEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteModal = useOverlayState()

  const handleActivateNode = (event: WorkspaceTreeActivationEvent) => {
    recordOpenFileProfile('workspace-tree:row-click', {
      button: event.button,
      kind: node.kind,
      path: node.path,
    })

    if (isFolder) {
      if (event.button === 0) {
        onToggleDirectory(node.path)
      }
      return
    }

    onSelectFile(node.path, event)
  }

  const handleSelectNode = (event: MouseEvent<HTMLElement>) => {
    handleActivateNode(event)
  }

  const handleKeyDownNode = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    handleActivateNode({
      button: 0,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
    })
  }

  const handleDelete = async (onClose: () => void) => {
    try {
      setIsSubmitting(true)
      setError(null)
      await onDeleteNode(node)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteDialog = (
    <AlertDialog.Backdrop
      isOpen={deleteModal.isOpen}
      onOpenChange={(open) => (open ? deleteModal.open() : deleteModal.close())}
      variant='opaque'
    >
      <AlertDialog.Container size='sm'>
        <AlertDialog.Dialog>
          {({ close }) => (
            <>
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status='danger' />
                <AlertDialog.Heading>确认删除</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p className='text-[var(--foreground-primary)]'>
                  您确定要删除 <span style={{ fontWeight: 600 }}>{node.name}</span> 吗？
                  此操作将无法撤销。
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  className='confirm-dialog-cancel-button'
                  variant='tertiary'
                  onPress={close}
                  isDisabled={isSubmitting}
                >
                  取消
                </Button>
                <Button
                  variant='danger'
                  onPress={() => handleDelete(close)}
                  isDisabled={isSubmitting}
                >
                  删除
                </Button>
              </AlertDialog.Footer>
            </>
          )}
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )

  const fileTreeItemAfter = (
    <>
      {deleteDialog}

      {error && <p className='tree-error'>{error}</p>}

      {isFolder && isExpanded && node.children && (
        <TreeItemChildren>
          <TreeList>
            {node.children.map(child => (
              <FileTreeItem
                key={child.path}
                activeFilePath={activeFilePath}
                draggedNode={draggedNode}
                dropTargetDirectoryPath={dropTargetDirectoryPath}
                expandedPaths={expandedPaths}
                iconTheme={iconTheme}
                node={child}
                workspacePath={workspacePath}
                onDeleteNode={onDeleteNode}
                onDragEndNode={onDragEndNode}
                onDragLeaveNode={onDragLeaveNode}
                onDragOverNode={onDragOverNode}
                onDragStartNode={onDragStartNode}
                onDropOnNode={onDropOnNode}
                onOpenInCodeEditor={onOpenInCodeEditor}
                onOpenDiff={onOpenDiff}
                onRenameNode={onRenameNode}
                onSelectFile={onSelectFile}
                onToggleDirectory={onToggleDirectory}
                gitRepositoryState={gitRepositoryState}
                menuPortalTarget={menuPortalTarget}
              />
            ))}
          </TreeList>
        </TreeItemChildren>
      )}
    </>
  )

  const changeTitle = gitChange ? getGitChangeTooltip(gitChange.kind) : undefined
  const nodeIcon = (
    <WorkspaceFileIcon
      fileName={node.kind === 'file' ? node.name : undefined}
      iconTheme={iconTheme}
      isClosed={node.kind === 'directory' ? !isExpanded : undefined}
      isFolder={node.kind === 'directory'}
      nodeLabel={node.kind === 'directory' ? node.name : undefined}
    />
  )
  const rowMain = isEditing ? (
    <TreeItemMain onClick={event => event.stopPropagation()}>
      {nodeIcon}
      <input
        ref={renameInputRef}
        className='raw-rename-input'
        value={draftName}
        onFocus={event => event.target.select()}
        onChange={event => setDraftName(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void handleSubmitRename()
          }
          if (event.key === 'Escape') {
            setDraftName(node.name)
            setIsEditing(false)
          }
        }}
        onBlur={(event) => {
          if (isSubmitting) return

          const nextFocusedElement = event.relatedTarget
          if (nextFocusedElement instanceof Node && rowRef.current?.contains(nextFocusedElement)) {
            return
          }

          setIsEditing(false)
        }}
      />
    </TreeItemMain>
  ) : undefined
  const rowActions = isEditing ? (
    <>
      <TreeItemActionButton
        aria-label='Confirm rename'
        title='确认重命名'
        disabled={isSubmitting}
        onClick={() => void handleSubmitRename()}
      >
        <CheckLine size={16} />
      </TreeItemActionButton>
      <TreeItemActionButton
        aria-label='Cancel rename'
        title='取消重命名'
        onClick={() => {
          setDraftName(node.name)
          setIsEditing(false)
        }}
      >
        <CloseLine size={16} />
      </TreeItemActionButton>
    </>
  ) : (
    <FileRowActionMenu
      canOpenInCodeEditor={canOpenInCodeEditor}
      isSubmitting={isSubmitting}
      gitDiffChange={gitDiffChange}
      menuPortalTarget={menuPortalTarget}
      onMenuOpenChange={setIsRowMenuOpen}
      onOpenInCodeEditor={() => onOpenInCodeEditor(node.path)}
      onOpenDiff={onOpenDiff}
      onShowInFolder={() => {
        window.appApi.showItemInFolder(node.path).catch((error) => {
          console.error('Failed to show item in folder:', error)
        })
      }}
      onRename={() => {
        setDraftName(node.name)
        setIsEditing(true)
      }}
      onDelete={deleteModal.open}
    />
  )

  return (
    <TreeItem
      ref={rowRef}
      isActive={isActive}
      isDragSource={isDragSource}
      isDropTarget={isDropTarget}
      isEditing={isEditing}
      isMenuOpen={isRowMenuOpen}
      after={fileTreeItemAfter}
      onDragLeave={(event) => onDragLeaveNode(node, event)}
      onDragOver={(event) => onDragOverNode(node, event)}
      onDrop={(event) => void onDropOnNode(node, event)}
      main={rowMain}
      icon={!isEditing ? nodeIcon : undefined}
      label={!isEditing ? node.name : undefined}
      labelProps={!isEditing ? { style: { fontWeight: isFolder ? 600 : 500 } } : undefined}
      renderMain={!isEditing ? (content, mainProps) => (
        <TreeItemMain
          {...mainProps}
          aria-expanded={isFolder ? isExpanded : undefined}
          draggable={!isSubmitting}
          role='button'
          tabIndex={0}
          title={node.path}
          onAuxClick={(event) => {
            if (event.button === 1) {
              handleSelectNode(event)
            }
          }}
          onClick={handleSelectNode}
          onDragEnd={onDragEndNode}
          onDragStart={(event) => onDragStartNode(node, event)}
          onKeyDown={handleKeyDownNode}
        >
          {content}
        </TreeItemMain>
      ) : undefined}
      actions={rowActions}
      actionsAlwaysVisible={isEditing || isRowMenuOpen}
      info={!isEditing && gitChange ? (
        <FileChangeStatusBadge
          kind={gitChange.kind}
          title={changeTitle}
        />
      ) : undefined}
      infoVariant='status'
    />
  )
}

export function WorkspaceTree({
  activeFilePath,
  iconTheme,
  nodes,
  expandedPaths,
  setExpandedPaths,
  workspacePath,
  onSelectFile,
  onOpenInCodeEditor,
  onOpenDiff,
  onRenameNode,
  onDeleteNode,
  onMoveNode,
  gitRepositoryState,
  menuPortalTarget,
}: WorkspaceTreeProps) {
  const [draggedNode, setDraggedNode] = useState<WorkspaceNode | null>(null)
  const [dropTargetDirectoryPath, setDropTargetDirectoryPath] = useState<string | null>(null)
  const [isMovingNode, setIsMovingNode] = useState(false)
  const expandTimerRef = useRef<number | null>(null)
  const expandTimerPathRef = useRef<string | null>(null)
  const isRootDropTarget = Boolean(
    workspacePath
    && dropTargetDirectoryPath
    && areSameWorkspacePaths(dropTargetDirectoryPath, workspacePath),
  )

  const clearExpandTimer = () => {
    if (expandTimerRef.current !== null) {
      window.clearTimeout(expandTimerRef.current)
      expandTimerRef.current = null
    }

    expandTimerPathRef.current = null
  }

  useEffect(() => clearExpandTimer, [])

  useEffect(() => {
    const className = 'workspace-tree-dragging'
    document.body.classList.toggle(className, draggedNode !== null)

    return () => {
      document.body.classList.remove(className)
    }
  }, [draggedNode])

  const handleToggle = (path: string) => {
    setExpandedPaths((currentExpandedPaths) => {
      const nextExpandedPaths = new Set(currentExpandedPaths)
      if (nextExpandedPaths.has(path)) nextExpandedPaths.delete(path)
      else nextExpandedPaths.add(path)
      return nextExpandedPaths
    })
  }

  const handleDragStartNode = (node: WorkspaceNode, event: DragEvent<HTMLElement>) => {
    if (isMovingNode) {
      event.preventDefault()
      return
    }

    event.stopPropagation()
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', node.path)
    setDraggedNode(node)
    setDropTargetDirectoryPath(null)
  }

  const handleDragEndNode = () => {
    setDraggedNode(null)
    setDropTargetDirectoryPath(null)
    clearExpandTimer()
  }

  const handleDragOverNode = (node: WorkspaceNode, event: DragEvent<HTMLElement>) => {
    if (!draggedNode) {
      return
    }

    event.stopPropagation()
    clearExpandTimer()

    const targetDirectoryPath = resolveDropTargetDirectoryPath(node, workspacePath)
    if (!targetDirectoryPath || isMovingNode) {
      setDropTargetDirectoryPath(null)
      event.dataTransfer.dropEffect = 'none'
      return
    }

    const canMoveToTargetDirectory = canMoveNodeToDirectory(draggedNode, targetDirectoryPath)
    if (!canMoveToTargetDirectory) {
      setDropTargetDirectoryPath(null)
      event.dataTransfer.dropEffect = 'none'
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (!areSameWorkspacePaths(dropTargetDirectoryPath, targetDirectoryPath)) {
      setDropTargetDirectoryPath(targetDirectoryPath)
    }

    if (node.kind !== 'directory' || expandedPaths.has(node.path) || expandTimerPathRef.current === node.path) {
      return
    }

    expandTimerPathRef.current = node.path
    expandTimerRef.current = window.setTimeout(() => {
      setExpandedPaths((currentExpandedPaths) => {
        const nextExpandedPaths = new Set(currentExpandedPaths)
        nextExpandedPaths.add(node.path)
        return nextExpandedPaths
      })
      clearExpandTimer()
    }, 550)
  }

  const handleDragLeaveNode = (node: WorkspaceNode, event: DragEvent<HTMLElement>) => {
    if (!draggedNode) {
      return
    }

    event.stopPropagation()

    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return
    }

    const targetDirectoryPath = resolveDropTargetDirectoryPath(node, workspacePath)
    if (!targetDirectoryPath) {
      return
    }

    setDropTargetDirectoryPath((currentValue) => (
      areSameWorkspacePaths(currentValue, targetDirectoryPath) ? null : currentValue
    ))

    if (expandTimerPathRef.current === node.path) {
      clearExpandTimer()
    }
  }

  const handleDropOnNode = async (node: WorkspaceNode, event: DragEvent<HTMLElement>) => {
    if (!draggedNode) {
      return
    }

    event.stopPropagation()

    const targetDirectoryPath = resolveDropTargetDirectoryPath(node, workspacePath)
    if (!targetDirectoryPath || isMovingNode || !canMoveNodeToDirectory(draggedNode, targetDirectoryPath)) {
      return
    }

    event.preventDefault()

    const sourceNode = draggedNode
    setIsMovingNode(true)
    setDraggedNode(null)
    setDropTargetDirectoryPath(null)
    clearExpandTimer()

    try {
      await onMoveNode(sourceNode, targetDirectoryPath)
    } finally {
      setIsMovingNode(false)
    }
  }

  const handleRootDragOver = (event: DragEvent<HTMLUListElement>) => {
    if (!workspacePath || isMovingNode || !canMoveNodeToDirectory(draggedNode, workspacePath)) {
      if (draggedNode) {
        event.dataTransfer.dropEffect = 'none'
      }
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    if (!areSameWorkspacePaths(dropTargetDirectoryPath, workspacePath)) {
      clearExpandTimer()
      setDropTargetDirectoryPath(workspacePath)
    }
  }

  const handleRootDragLeave = (event: DragEvent<HTMLUListElement>) => {
    if (!workspacePath || !draggedNode) {
      return
    }

    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return
    }

    setDropTargetDirectoryPath((currentValue) => (
      areSameWorkspacePaths(currentValue, workspacePath) ? null : currentValue
    ))
  }

  const handleRootDrop = async (event: DragEvent<HTMLUListElement>) => {
    if (!workspacePath || isMovingNode || !draggedNode || !canMoveNodeToDirectory(draggedNode, workspacePath)) {
      return
    }

    event.preventDefault()

    const sourceNode = draggedNode
    setIsMovingNode(true)
    setDraggedNode(null)
    setDropTargetDirectoryPath(null)
    clearExpandTimer()

    try {
      await onMoveNode(sourceNode, workspacePath)
    } finally {
      setIsMovingNode(false)
    }
  }

  if (nodes.length === 0) {
    return (
      <WorkspaceTreeEmptyState
        icon={<FolderLine size={26} />}
        message={workspacePath ? '这个工作目录还没有文件。' : '选择工作目录以浏览和编辑文件。'}
      />
    )
  }

  return (
    <TreeList
      className={`workspace-tree-root${draggedNode ? ' is-dragging' : ''}${isRootDropTarget ? ' is-root-drop-target' : ''}`}
      onDragLeave={handleRootDragLeave}
      onDragOver={handleRootDragOver}
      onDrop={(event) => void handleRootDrop(event)}
    >
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          activeFilePath={activeFilePath}
          draggedNode={draggedNode}
          dropTargetDirectoryPath={dropTargetDirectoryPath}
          expandedPaths={expandedPaths}
          iconTheme={iconTheme}
          node={node}
          workspacePath={workspacePath}
          onDeleteNode={onDeleteNode}
          onDragEndNode={handleDragEndNode}
          onDragLeaveNode={handleDragLeaveNode}
          onDragOverNode={handleDragOverNode}
          onDragStartNode={handleDragStartNode}
          onDropOnNode={handleDropOnNode}
          onOpenDiff={onOpenDiff}
          onOpenInCodeEditor={onOpenInCodeEditor}
          onRenameNode={onRenameNode}
          onSelectFile={onSelectFile}
          onToggleDirectory={handleToggle}
          gitRepositoryState={gitRepositoryState}
          menuPortalTarget={menuPortalTarget}
        />
      ))}
    </TreeList>
  )
}

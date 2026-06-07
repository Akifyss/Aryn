import { type Dispatch, type DragEvent, type FormEvent, type MouseEvent, type SetStateAction, useEffect, useRef, useState } from 'react'
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
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
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

type WorkspaceTreeProps = {
  activeFilePath: string | null
  iconTheme: WorkspaceIconTheme | null
  nodes: WorkspaceNode[]
  expandedPaths: Set<string>
  setExpandedPaths: Dispatch<SetStateAction<Set<string>>>
  workspacePath: string | null
  onSelectFile: (path: string, event: MouseEvent<HTMLDivElement>) => void
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

function FileRowActions({
  canOpenInCodeEditor,
  onOpenInCodeEditor,
  onRename,
  onDelete,
  onShowInFolder,
  isSubmitting,
  gitChange,
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
  gitChange: GitDisplayChange | null
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
    <div
      className='git-change-tools'
      onAuxClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {gitChange && (
        <span
          className={`git-status-dot git-status-dot-${gitChange.kind}`}
          aria-hidden='true'
          title={gitChange.kind.charAt(0).toUpperCase() + gitChange.kind.slice(1)}
        />
      )}
      <div
        className='git-change-actions'
        style={isOpen ? { opacity: 1, maxWidth: '2rem', transform: 'translateX(0)' } : undefined}
      >
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
            className='git-change-action git-change-icon-button'
            disabled={isSubmitting}
            render={<button type='button' />}
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
              >
                {canOpenInCodeEditor ? (
                  <Menu.Item
                    nativeButton
                    render={<button type='button' />}
                    className={({ highlighted }) => `workspace-tree-menu-item${highlighted ? ' is-highlighted' : ''}`}
                    data-menu-action='open-code'
                    label='在代码编辑器打开'
                    onClick={onOpenInCodeEditor}
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
                    onClick={() => onOpenDiff(gitDiffChange)}
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
                  onClick={onShowInFolder}
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
                  onClick={onRename}
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
                  onClick={onDelete}
                >
                  <Delete2Line size={16} className='workspace-tree-menu-icon' />
                  <span>删除</span>
                </Menu.Item>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>
    </div>
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
  onDragLeaveNode: (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => void
  onDragOverNode: (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => void
  onDragStartNode: (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => void
  onDropOnNode: (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => Promise<void>
  onOpenInCodeEditor: (path: string) => void
  onOpenDiff?: (change: GitChangeItem) => void
  onRenameNode: (node: WorkspaceNode, nextName: string) => Promise<void>
  onSelectFile: (path: string, event: MouseEvent<HTMLDivElement>) => void
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

  const handleSelectNode = (event: MouseEvent<HTMLDivElement>) => {
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

  return (
    <li className='panel-tree-node'>
      <div
        ref={rowRef}
        className={`workspace-tree-row${isEditing ? ' is-editing' : ''}${isActive ? ' is-active' : ''}${isRowMenuOpen ? ' is-menu-open' : ''}${isDragSource ? ' is-drag-source' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
        onAuxClick={(event) => {
          if (event.button === 1) {
            handleSelectNode(event)
          }
        }}
        onClick={handleSelectNode}
        onDragLeave={(event) => onDragLeaveNode(node, event)}
        onDragOver={(event) => onDragOverNode(node, event)}
        onDrop={(event) => void onDropOnNode(node, event)}
      >
        {isEditing ? (
          <>
            <div className='workspace-tree-trigger' onClick={event => event.stopPropagation()}>
              <WorkspaceFileIcon
                fileName={node.kind === 'file' ? node.name : undefined}
                iconTheme={iconTheme}
                isClosed={node.kind === 'directory' ? !isExpanded : undefined}
                isFolder={node.kind === 'directory'}
                nodeLabel={node.kind === 'directory' ? node.name : undefined}
              />
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
            </div>
            <div
              className='git-change-tools'
              onAuxClick={event => event.stopPropagation()}
              onClick={event => event.stopPropagation()}
            >
              <div className='git-change-actions' style={{ opacity: 1, maxWidth: '4rem', transform: 'translateX(0)' }}>
                <button
                  type='button'
                  className='git-change-action git-change-icon-button'
                  disabled={isSubmitting}
                  onClick={() => void handleSubmitRename()}
                >
                  <CheckLine size={14} />
                </button>
                <button
                  type='button'
                  className='git-change-action git-change-icon-button'
                  onClick={() => {
                    setDraftName(node.name)
                    setIsEditing(false)
                  }}
                >
                  <CloseLine size={14} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div
            className='workspace-tree-trigger'
            draggable={!isSubmitting}
            title={node.path}
            onDragEnd={onDragEndNode}
            onDragStart={(event) => onDragStartNode(node, event)}
          >
            <WorkspaceFileIcon
              fileName={node.kind === 'file' ? node.name : undefined}
              iconTheme={iconTheme}
              isClosed={node.kind === 'directory' ? !isExpanded : undefined}
              isFolder={node.kind === 'directory'}
              nodeLabel={node.kind === 'directory' ? node.name : undefined}
            />
            <span className='panel-tree-label' style={{ fontWeight: isFolder ? 600 : 500 }}>
              {node.name}
            </span>
          </div>
        )}

        {!isEditing && (
          <FileRowActions
            canOpenInCodeEditor={canOpenInCodeEditor}
            isSubmitting={isSubmitting}
            gitChange={gitChange}
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
        )}
      </div>

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
                  <p className='text-[var(--foreground)]'>
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

      {error && <p className='tree-item-error'>{error}</p>}

      {isFolder && isExpanded && node.children && (
        <div className='panel-tree-children'>
          <ul className='panel-tree-list'>
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
          </ul>
        </div>
      )}
    </li>
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

  const handleDragStartNode = (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => {
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

  const handleDragOverNode = (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => {
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

  const handleDragLeaveNode = (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => {
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

  const handleDropOnNode = async (node: WorkspaceNode, event: DragEvent<HTMLDivElement>) => {
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
      <div className='tree-empty-state'>
        <div className='tree-empty-icon'>
          <FolderLine size={26} />
        </div>
        <p>{workspacePath ? '这个工作目录还没有文件。' : '选择工作目录以浏览和编辑文件。'}</p>
      </div>
    )
  }

  return (
    <ul
      className={`panel-tree-list workspace-tree-root${draggedNode ? ' is-dragging' : ''}${isRootDropTarget ? ' is-root-drop-target' : ''}`}
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
    </ul>
  )
}

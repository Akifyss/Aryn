import { type Dispatch, type DragEvent, type FormEvent, type SetStateAction, useEffect, useRef, useState } from 'react'
import { AlertDialog, Button, Dropdown, Label, useOverlayState } from '@heroui/react'
import {
  CheckLine,
  CloseLine,
  CodeLine,
  Delete2Line,
  Edit2Line,
  FileLine,
  FolderLine,
  FolderOpenLine,
  More1Line,
} from '@mingcute/react'
import { pickDominantGitDisplayChange } from '@/features/git/lib/display-change'
import { resolveWorkspaceDirectoryIconUrl, resolveWorkspaceFileIconUrl } from '@/features/workspace/lib/icon-theme'
import { getSupportedWorkspaceEditorKind, supportsCodeEditorToggle } from '@/features/workspace/lib/file-types'
import {
  areSameWorkspacePaths,
  canMoveNodeToDirectory,
  normalizeWorkspacePath,
  resolveDropTargetDirectoryPath,
} from '@/features/workspace/lib/workspace-tree-dnd'
import type { WorkspaceIconTheme, WorkspaceNode } from '@/features/workspace/types'
import type { GitDisplayChange, GitRepositoryState } from '@/features/git/types'

type WorkspaceTreeProps = {
  activeFilePath: string | null
  iconTheme: WorkspaceIconTheme | null
  nodes: WorkspaceNode[]
  expandedPaths: Set<string>
  setExpandedPaths: Dispatch<SetStateAction<Set<string>>>
  workspacePath: string | null
  onSelectFile: (path: string) => void
  onOpenInCodeEditor: (path: string) => void
  onRenameNode: (node: WorkspaceNode, nextName: string) => Promise<void>
  onDeleteNode: (node: WorkspaceNode) => Promise<void>
  onMoveNode: (node: WorkspaceNode, targetDirectoryPath: string) => Promise<void>
  gitRepositoryState?: GitRepositoryState | null
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

function FileRowIcon({
  node,
  isExpanded,
  iconTheme,
}: {
  node: WorkspaceNode
  isExpanded?: boolean
  iconTheme: WorkspaceIconTheme | null
}) {
  const isFolder = node.kind === 'directory'
  const iconUrl = isFolder
    ? resolveWorkspaceDirectoryIconUrl(iconTheme, node.name, isExpanded ?? false)
    : resolveWorkspaceFileIconUrl(iconTheme, node.name)

  return (
    <span className='git-row-icon' aria-hidden='true'>
      {iconUrl ? (
        <img alt='' className='tree-theme-icon' draggable='false' src={iconUrl} />
      ) : isFolder ? (
        isExpanded ? <FolderOpenLine size={16} /> : <FolderLine size={16} />
      ) : (
        <FileLine size={16} className='tree-file-icon' />
      )}
    </span>
  )
}

function FileRowActions({
  canOpenInCodeEditor,
  onOpenInCodeEditor,
  onRename,
  onDelete,
  isSubmitting,
  gitChange,
}: {
  canOpenInCodeEditor: boolean
  onOpenInCodeEditor: () => void
  onRename: () => void
  onDelete: () => void
  isSubmitting: boolean
  gitChange: GitDisplayChange | null
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className='git-change-tools'>
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
        <Dropdown onOpenChange={setIsOpen}>
          <Dropdown.Trigger>
            <button
              type='button'
              className='git-change-action git-change-icon-button'
              disabled={isSubmitting}
              onClick={(event) => {
                event.stopPropagation()
              }}
            >
              <More1Line size={16} />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Popover placement='bottom end'>
            <Dropdown.Menu
              aria-label='File actions'
              onAction={(key) => {
                if (key === 'open-code') onOpenInCodeEditor()
                if (key === 'rename') onRename()
                if (key === 'delete') onDelete()
              }}
            >
              {canOpenInCodeEditor ? (
                <Dropdown.Item id='open-code' textValue='Open in code editor'>
                  <div className='flex items-center gap-2'>
                    <CodeLine size={16} className='text-(--muted)' />
                    <Label>在代码编辑器打开</Label>
                  </div>
                </Dropdown.Item>
              ) : null}
              <Dropdown.Item id='rename' textValue='Rename'>
                <div className='flex items-center gap-2'>
                  <Edit2Line size={16} className='text-(--muted)' />
                  <Label>Rename</Label>
                </div>
              </Dropdown.Item>
              <Dropdown.Item
                id='delete'
                textValue='Delete'
                variant='danger'
              >
                <div className='flex items-center gap-2'>
                  <Delete2Line size={16} style={{ color: 'var(--danger)' }} />
                  <Label>Delete</Label>
                </div>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
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
  onRenameNode,
  onSelectFile,
  onToggleDirectory,
  gitRepositoryState,
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
  onRenameNode: (node: WorkspaceNode, nextName: string) => Promise<void>
  onSelectFile: (path: string) => void
  onToggleDirectory: (path: string) => void
  gitRepositoryState?: GitRepositoryState | null
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)

  const isFolder = node.kind === 'directory'
  const editorKind = node.kind === 'file' ? getSupportedWorkspaceEditorKind(node.path) : null
  const canOpenInCodeEditor = node.kind === 'file' && editorKind !== null && supportsCodeEditorToggle(node.path, editorKind)
  const isExpanded = expandedPaths.has(node.path)
  const isActive = activeFilePath === node.path
  const gitChange = findGitChangeByFilePath(gitRepositoryState, node)
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
        className={`workspace-tree-row${isEditing ? ' is-editing' : ''}${isActive ? ' is-active' : ''}${isDragSource ? ' is-drag-source' : ''}${isDropTarget ? ' is-drop-target' : ''}`}
        onClick={() => (isFolder ? onToggleDirectory(node.path) : onSelectFile(node.path))}
        onDragLeave={(event) => onDragLeaveNode(node, event)}
        onDragOver={(event) => onDragOverNode(node, event)}
        onDrop={(event) => void onDropOnNode(node, event)}
      >
        {isEditing ? (
          <>
            <div className='workspace-tree-trigger' onClick={event => event.stopPropagation()}>
              <FileRowIcon node={node} isExpanded={isExpanded} iconTheme={iconTheme} />
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
            <div className='git-change-tools' onClick={event => event.stopPropagation()}>
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
            <FileRowIcon node={node} isExpanded={isExpanded} iconTheme={iconTheme} />
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
            onOpenInCodeEditor={() => onOpenInCodeEditor(node.path)}
            onRename={() => {
              setDraftName(node.name)
              setIsEditing(true)
            }}
            onDelete={deleteModal.open}
          />
        )}
      </div>

      <AlertDialog>
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
                    <AlertDialog.Heading>Confirm Deletion</AlertDialog.Heading>
                  </AlertDialog.Header>
                  <AlertDialog.Body>
                    <p className='text-[var(--foreground)]'>
                      Are you sure you want to delete <span style={{ fontWeight: 600 }}>{node.name}</span>?
                      This action cannot be undone.
                    </p>
                  </AlertDialog.Body>
                  <AlertDialog.Footer>
                    <Button variant='tertiary' onPress={close} isDisabled={isSubmitting}>
                      Cancel
                    </Button>
                    <Button
                      variant='danger'
                      onPress={() => handleDelete(close)}
                      isDisabled={isSubmitting}
                    >
                      Delete
                    </Button>
                  </AlertDialog.Footer>
                </>
              )}
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

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
                onRenameNode={onRenameNode}
                onSelectFile={onSelectFile}
                onToggleDirectory={onToggleDirectory}
                gitRepositoryState={gitRepositoryState}
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
  onRenameNode,
  onDeleteNode,
  onMoveNode,
  gitRepositoryState,
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
        <p>Connect a workspace folder to browse and edit your notes.</p>
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
          onOpenInCodeEditor={onOpenInCodeEditor}
          onRenameNode={onRenameNode}
          onSelectFile={onSelectFile}
          onToggleDirectory={handleToggle}
          gitRepositoryState={gitRepositoryState}
        />
      ))}
    </ul>
  )
}

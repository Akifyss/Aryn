import { FormEvent, useEffect, useState } from 'react'
import { Button, Dropdown, Input, Label, Modal, Tooltip, useOverlayState } from '@heroui/react'
import {
  CheckLine,
  CloseLine,
  Delete2Line,
  Edit2Line,
  FileLine,
  FolderLine,
  FolderOpenLine,
  More1Line,
} from '@mingcute/react'
import { resolveWorkspaceDirectoryIconUrl, resolveWorkspaceFileIconUrl } from '@/features/workspace/lib/icon-theme'
import type { WorkspaceIconTheme, WorkspaceNode } from '@/features/workspace/types'
import type { GitRepositoryState, GitDisplayChange } from '@/features/git/types'

type WorkspaceTreeProps = {
  activeFilePath: string | null
  iconTheme: WorkspaceIconTheme | null
  nodes: WorkspaceNode[]
  expandedPaths: Set<string>
  setExpandedPaths: (paths: Set<string>) => void
  onSelectFile: (path: string) => void
  onRenameFile: (path: string, nextName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
  gitRepositoryState?: GitRepositoryState | null
}

function normalizePath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').toLowerCase();
}

function findGitChangeByFilePath(repositoryState: GitRepositoryState | null | undefined, node: WorkspaceNode): GitDisplayChange | null {
  if (!repositoryState?.isRepository) return null
  
  const targetPath = normalizePath(node.path)
  
  if (node.kind === 'file') {
    return repositoryState.unstagedChanges.find(c => normalizePath(c.path) === targetPath)
      ?? repositoryState.stagedChanges.find(c => normalizePath(c.path) === targetPath)
      ?? null
  } else {
    // Folder status logic: propagate deep child changes up
    const prefix = targetPath.endsWith('/') ? targetPath : targetPath + '/'
    const unstaged = repositoryState.unstagedChanges.filter(c => normalizePath(c.path).startsWith(prefix))
    const staged = repositoryState.stagedChanges.filter(c => normalizePath(c.path).startsWith(prefix))
    const allChanges = [...unstaged, ...staged]
    
    if (allChanges.length === 0) return null
    
    // Priority: If any child is modified, directory is modified (Amber)
    const isModified = allChanges.some(c => 
      c.kind === 'modified' || c.kind === 'renamed' || c.kind === 'copied' || c.kind === 'type-changed'
    )
    
    if (isModified) {
      return { kind: 'modified', path: node.path } as any
    }
    
    // Else if any child is added, directory is added (Emerald)
    return { kind: 'added', path: node.path } as any
  }
  return null
}

/**
 * Shared Icon Component for unified sizing and theme resolution
 */
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

/**
 * Shared Actions Component for Rename/Delete
 */
function FileRowActions({
  onRename,
  onDelete,
  isSubmitting,
  gitChange,
}: {
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
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              <More1Line size={16} />
            </button>
          </Dropdown.Trigger>
          <Dropdown.Popover placement='bottom end'>
            <Dropdown.Menu 
              aria-label='File actions'
              onAction={(key) => {
                if (key === 'rename') onRename()
                if (key === 'delete') onDelete()
              }}
            >
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

/**
 * Recursive Tree Node Component
 */
function FileTreeItem({
  activeFilePath,
  expandedPaths,
  iconTheme,
  node,
  onToggleDirectory,
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  gitRepositoryState,
}: {
  activeFilePath: string | null
  expandedPaths: Set<string>
  iconTheme: WorkspaceIconTheme | null
  node: WorkspaceNode
  onToggleDirectory: (path: string) => void
  onSelectFile: (path: string) => void
  onRenameFile: (path: string, nextName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
  gitRepositoryState?: GitRepositoryState | null
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)

  const isFolder = node.kind === 'directory'
  const isExpanded = expandedPaths.has(node.path)
  const isActive = activeFilePath === node.path
  const gitChange = findGitChangeByFilePath(gitRepositoryState, node)

  const handleSubmitRename = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!draftName.trim() || draftName === node.name) {
      setIsEditing(false)
      return
    }
    try {
      setIsSubmitting(true)
      await onRenameFile(node.path, draftName)
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
      await onDeleteFile(node.path)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <li className='git-tree-node'>
      <div 
        className={`workspace-tree-row ${isActive ? 'is-active' : ''}`}
        onClick={() => isFolder ? onToggleDirectory(node.path) : onSelectFile(node.path)}
      >
        {isEditing ? (
          <form className='workspace-tree-trigger' onSubmit={handleSubmitRename} onClick={e => e.stopPropagation()}>
            <FileRowIcon node={node} isExpanded={isExpanded} iconTheme={iconTheme} />
            <input
              autoFocus
              className='raw-rename-input'
              value={draftName}
              onFocus={e => e.target.select()}
              onChange={e => setDraftName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setDraftName(node.name)
                  setIsEditing(false)
                }
              }}
              onBlur={() => !isSubmitting && setIsEditing(false)}
            />
            <div className='git-change-actions' style={{ opacity: 1, maxWidth: '4rem' }}>
              <button type='submit' className='git-change-action git-change-icon-button' disabled={isSubmitting}>
                <CheckLine size={14} />
              </button>
              <button type='button' className='git-change-action git-change-icon-button' onClick={() => setIsEditing(false)}>
                <CloseLine size={14} />
              </button>
            </div>
          </form>
        ) : (
          <div className='workspace-tree-trigger' title={node.path}>
            <FileRowIcon node={node} isExpanded={isExpanded} iconTheme={iconTheme} />
            <span className='git-change-path' style={{ 
              fontWeight: isFolder ? 600 : 500
            }}>
              {node.name}
            </span>
          </div>
        )}

        {!isEditing && (
          <FileRowActions 
            isSubmitting={isSubmitting}
            gitChange={gitChange}
            onRename={() => {
              setDraftName(node.name)
              setIsEditing(true)
            }}
            onDelete={deleteModal.open}
          />
        )}
      </div>

      <Modal>
        <Modal.Backdrop 
          isOpen={deleteModal.isOpen} 
          onOpenChange={(open) => open ? deleteModal.open() : deleteModal.close()}
          variant='opaque'
        >
          <Modal.Container size='sm'>
            <Modal.Dialog>
              {({ close }) => (
                <>
                  <Modal.Header>
                    <Modal.Heading>Confirm Deletion</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <p>
                      Are you sure you want to delete <span style={{ fontWeight: 600 }}>{node.name}</span>? 
                      This action cannot be undone.
                    </p>
                  </Modal.Body>
                  <Modal.Footer>
                    <Button variant='ghost' onPress={close} isDisabled={isSubmitting}>
                      Cancel
                    </Button>
                    <Button 
                      variant='danger' 
                      onPress={() => handleDelete(close)}
                    >
                      Delete
                    </Button>
                  </Modal.Footer>
                </>
              )}
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {error && <p className='tree-item-error'>{error}</p>}

      {isFolder && isExpanded && node.children && (
        <div className='workspace-tree-children'>
          <ul className='git-tree-list'>
            {node.children.map(child => (
              <FileTreeItem
                key={child.path}
                node={child}
                activeFilePath={activeFilePath}
                expandedPaths={expandedPaths}
                iconTheme={iconTheme}
                onToggleDirectory={onToggleDirectory}
                onSelectFile={onSelectFile}
                onRenameFile={onRenameFile}
                onDeleteFile={onDeleteFile}
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
  onSelectFile,
  onRenameFile,
  onDeleteFile,
  gitRepositoryState,
}: WorkspaceTreeProps) {
  const handleToggle = (path: string) => {
    const next = new Set(expandedPaths)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setExpandedPaths(next)
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
    <ul className='git-tree-list' style={{ paddingTop: 6, paddingBottom: 6 }}>
      {nodes.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          activeFilePath={activeFilePath}
          expandedPaths={expandedPaths}
          iconTheme={iconTheme}
          onToggleDirectory={handleToggle}
          onSelectFile={onSelectFile}
          onRenameFile={onRenameFile}
          onDeleteFile={onDeleteFile}
          gitRepositoryState={gitRepositoryState}
        />
      ))}
    </ul>
  )
}

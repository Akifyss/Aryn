import { FormEvent, useState } from 'react'
import { Input, Tooltip } from '@heroui/react'
import {
  CheckLine,
  CloseLine,
  Delete2Line,
  Edit2Line,
  FileLine,
  FolderLine,
  FolderOpenLine,
} from '@mingcute/react'
import { resolveWorkspaceDirectoryIconUrl, resolveWorkspaceFileIconUrl } from '@/features/workspace/lib/icon-theme'
import type { WorkspaceIconTheme, WorkspaceNode } from '@/features/workspace/types'

type WorkspaceTreeProps = {
  activeFilePath: string | null
  iconTheme: WorkspaceIconTheme | null
  nodes: WorkspaceNode[]
  onSelectFile: (path: string) => void
  onRenameFile: (path: string, nextName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
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
}: {
  onRename: () => void
  onDelete: () => void
  isSubmitting: boolean
}) {
  return (
    <div className='git-change-tools'>
      <div className='git-change-actions'>
        <Tooltip>
          <Tooltip.Trigger>
            <button
              type='button'
              className='git-change-action git-change-icon-button'
              onClick={(e) => {
                e.stopPropagation()
                onRename()
              }}
            >
              <Edit2Line size={15} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>Rename</Tooltip.Content>
        </Tooltip>
        <Tooltip>
          <Tooltip.Trigger>
            <button
              type='button'
              className='git-change-action git-change-icon-button'
              disabled={isSubmitting}
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
            >
              <Delete2Line size={15} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>Delete</Tooltip.Content>
        </Tooltip>
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
}: {
  activeFilePath: string | null
  expandedPaths: Set<string>
  iconTheme: WorkspaceIconTheme | null
  node: WorkspaceNode
  onToggleDirectory: (path: string) => void
  onSelectFile: (path: string) => void
  onRenameFile: (path: string, nextName: string) => Promise<void>
  onDeleteFile: (path: string) => Promise<void>
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draftName, setDraftName] = useState(node.name)
  const [error, setError] = useState<string | null>(null)

  const isFolder = node.kind === 'directory'
  const isExpanded = expandedPaths.has(node.path)
  const isActive = activeFilePath === node.path

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

  const handleDelete = async () => {
    try {
      setIsSubmitting(true)
      await onDeleteFile(node.path)
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
            <span className='git-change-path' style={{ fontWeight: isFolder ? 600 : 500 }}>
              {node.name}
            </span>
          </div>
        )}

        {!isEditing && (
          <FileRowActions 
            isSubmitting={isSubmitting}
            onRename={() => {
              setDraftName(node.name)
              setIsEditing(true)
            }}
            onDelete={handleDelete}
          />
        )}
      </div>

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
  onSelectFile,
  onRenameFile,
  onDeleteFile,
}: WorkspaceTreeProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const handleToggle = (path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
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
        />
      ))}
    </ul>
  )
}

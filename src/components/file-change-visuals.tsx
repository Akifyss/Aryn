import {
  FileLine,
  FolderLine,
} from '@mingcute/react'
import {
  resolveWorkspaceDirectoryIconUrl,
  resolveWorkspaceFileIconUrl,
} from '@/features/workspace/lib/icon-theme'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  TreeItemIcon,
  TreeItemStatusDot,
  type TreeItemStatusTone,
} from './tree'

export type FileChangeVisualKind =
  | 'added'
  | 'copied'
  | 'conflicted'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'type-changed'
  | 'untracked'

function getFileChangeStatusTone(kind: FileChangeVisualKind): TreeItemStatusTone {
  if (kind === 'added' || kind === 'untracked') return 'success'
  if (kind === 'deleted' || kind === 'conflicted') return 'danger'
  return 'warning'
}

export function FileChangeStatusBadge({
  className = '',
  kind,
  title,
}: {
  className?: string
  kind: FileChangeVisualKind
  title?: string
}) {
  return (
    <TreeItemStatusDot
      className={className}
      tone={getFileChangeStatusTone(kind)}
      aria-label={title}
      title={title}
    />
  )
}

export function WorkspaceFileIcon({
  fileName,
  iconTheme,
  isClosed,
  isFolder,
  nodeLabel,
}: {
  fileName?: string
  iconTheme: WorkspaceIconTheme | null
  isClosed?: boolean
  isFolder?: boolean
  nodeLabel?: string
}) {
  const iconUrl = isFolder
    ? resolveWorkspaceDirectoryIconUrl(iconTheme, nodeLabel ?? '', !isClosed)
    : resolveWorkspaceFileIconUrl(iconTheme, fileName ?? '')

  return (
    <TreeItemIcon>
      {iconUrl ? (
        <img alt='' className='tree-item-icon-image' draggable='false' src={iconUrl} />
      ) : isFolder ? (
        <FolderLine size={16} />
      ) : (
        <FileLine size={16} className='tree-item-icon-fallback' />
      )}
    </TreeItemIcon>
  )
}

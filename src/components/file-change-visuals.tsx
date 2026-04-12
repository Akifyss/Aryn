import { Icon } from '@iconify/react'
import {
  FileLine,
  FolderLine,
} from '@mingcute/react'
import {
  resolveWorkspaceDirectoryIconUrl,
  resolveWorkspaceFileIconUrl,
} from '@/features/workspace/lib/icon-theme'
import type { WorkspaceIconTheme } from '@/features/workspace/types'

export type FileChangeVisualKind =
  | 'added'
  | 'copied'
  | 'conflicted'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'type-changed'
  | 'untracked'

export function getFileChangeKindIcon(kind: FileChangeVisualKind) {
  const iconSize = 12

  switch (kind) {
    case 'added':
    case 'untracked':
      return <Icon icon='mingcute:add-line' width={iconSize} height={iconSize} />
    case 'copied':
    case 'renamed':
    case 'modified':
    case 'type-changed':
      return <Icon icon='radix-icons:dot-filled' width={iconSize} height={iconSize} />
    case 'deleted':
      return <Icon icon='ic:round-minus' width={iconSize} height={iconSize} />
    case 'conflicted':
      return <Icon icon='mingcute:alert-line' width={iconSize} height={iconSize} />
  }
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
    <span
      className={`git-change-badge git-change-badge-${kind}${className ? ` ${className}` : ''}`}
      aria-hidden='true'
      title={title}
    >
      {getFileChangeKindIcon(kind)}
    </span>
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
    <span className='git-row-icon' aria-hidden='true'>
      {iconUrl ? (
        <img alt='' className='tree-theme-icon' draggable='false' src={iconUrl} />
      ) : isFolder ? (
        <FolderLine size={16} />
      ) : (
        <FileLine size={16} className='tree-file-icon' />
      )}
    </span>
  )
}

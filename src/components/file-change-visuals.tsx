import {
  resolveWorkspaceDirectoryIconUrl,
  resolveWorkspaceFileIconUrl,
} from '@/features/workspace/lib/icon-theme'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  DefaultWorkspaceDirectoryIcon,
  DefaultWorkspaceFileTypeIcon,
  DefaultWorkspaceFolderGlyph,
} from './workspace-file-icons'
import {
  AppItemIcon,
  AppItemStatusDot,
  type AppItemStatusTone,
} from './app-item'

export type FileChangeVisualKind =
  | 'added'
  | 'copied'
  | 'conflicted'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'type-changed'
  | 'untracked'

function getFileChangeStatusTone(kind: FileChangeVisualKind): AppItemStatusTone {
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
    <AppItemStatusDot
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
    <AppItemIcon>
      {iconUrl ? (
        <img alt='' className='app-item-icon-image' draggable='false' src={iconUrl} />
      ) : isFolder && iconTheme === null ? (
        <DefaultWorkspaceDirectoryIcon
          className='app-item-icon-image app-item-icon-fallback'
          isExpanded={!isClosed}
        />
      ) : isFolder ? (
        <DefaultWorkspaceFolderGlyph className='app-item-icon-image' />
      ) : (
        <DefaultWorkspaceFileTypeIcon
          className='app-item-icon-image app-item-icon-fallback'
          fileName={fileName ?? ''}
        />
      )}
    </AppItemIcon>
  )
}

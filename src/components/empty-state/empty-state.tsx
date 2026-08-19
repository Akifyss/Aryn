import type { HTMLAttributes, ReactNode } from 'react'
import binaryFileIcon from '@iconify-icons/streamline-flex-color/file-code-1-flat'
import historyIcon from '@iconify-icons/streamline-flex-color/search-history-browser-flat'
import renderErrorIcon from '@iconify-icons/streamline-flex-color/monitor-error-flat'
import blockIcon from '@iconify-icons/streamline-plump-color/block-1-flat'
import unreadableIcon from '@iconify-icons/streamline-plump-color/broken-link-2-flat'
import cleanIcon from '@iconify-icons/streamline-plump-color/check-thick-flat'
import repositoryIcon from '@iconify-icons/streamline-plump-color/end-point-branches-flat'
import fileSuccessIcon from '@iconify-icons/streamline-plump-color/file-check-alternate-flat'
import folderIcon from '@iconify-icons/streamline-plump-color/file-folder-flat'
import imageIcon from '@iconify-icons/streamline-plump-color/gallery-2-flat'
import multipleFilesIcon from '@iconify-icons/streamline-plump-color/multiple-file-1-flat'
import newFolderIcon from '@iconify-icons/streamline-plump-color/new-folder-flat'
import imageUnavailableIcon from '@iconify-icons/streamline-plump-color/no-photo-taking-zone-flat'
import warningIcon from '@iconify-icons/streamline-plump-color/warning-diamond-flat'
import { Icon as OfflineIcon, type IconifyIcon } from '@iconify/react/offline'

export const EMPTY_STATE_ICONS = {
  binaryFile: binaryFileIcon,
  clean: cleanIcon,
  fileSuccess: fileSuccessIcon,
  folder: folderIcon,
  history: historyIcon,
  image: imageIcon,
  imageUnavailable: imageUnavailableIcon,
  multipleFiles: multipleFilesIcon,
  newFolder: newFolderIcon,
  renderError: renderErrorIcon,
  repository: repositoryIcon,
  unavailable: blockIcon,
  unreadable: unreadableIcon,
  warning: warningIcon,
} as const

export type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> & {
  title: ReactNode
  actions?: ReactNode
  description?: ReactNode
  fill?: boolean
  icon?: IconifyIcon
  iconClassName?: string
}

function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export function EmptyState({
  title,
  actions,
  className,
  description,
  fill = false,
  icon = EMPTY_STATE_ICONS.folder,
  iconClassName,
  ...props
}: EmptyStateProps) {
  return (
    <div
      className={joinClasses('app-empty-state', fill && 'is-fill', className)}
      {...props}
    >
      <div className='app-empty-state-content'>
        {icon ? (
          <OfflineIcon
            icon={icon}
            className={joinClasses('app-empty-state-icon', iconClassName)}
            aria-hidden='true'
          />
        ) : null}
        <div className='app-empty-state-copy'>
          <p className='app-empty-state-title'>{title}</p>
          {description ? (
            <p className='app-empty-state-description'>{description}</p>
          ) : null}
        </div>
        {actions ? <div className='app-empty-state-actions'>{actions}</div> : null}
      </div>
    </div>
  )
}

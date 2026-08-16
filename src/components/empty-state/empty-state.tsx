import type { HTMLAttributes, ReactNode } from 'react'
import { Icon } from '@iconify/react'

export const EMPTY_STATE_ICONS = {
  binaryFile: 'streamline-flex-color:file-code-1-flat',
  clean: 'streamline-plump-color:check-thick-flat',
  fileSuccess: 'streamline-plump-color:file-check-alternate-flat',
  folder: 'streamline-plump-color:file-folder-flat',
  history: 'streamline-flex-color:search-history-browser-flat',
  image: 'streamline-plump-color:gallery-2-flat',
  imageUnavailable: 'streamline-plump-color:no-photo-taking-zone-flat',
  multipleFiles: 'streamline-plump-color:multiple-file-1-flat',
  newFolder: 'streamline-plump-color:new-folder-flat',
  renderError: 'streamline-flex-color:monitor-error-flat',
  repository: 'streamline-plump-color:end-point-branches-flat',
  unavailable: 'streamline-plump-color:block-1-flat',
  unreadable: 'streamline-plump-color:broken-link-2-flat',
  warning: 'streamline-plump-color:warning-diamond-flat',
} as const

export type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'title'> & {
  title: ReactNode
  actions?: ReactNode
  description?: ReactNode
  fill?: boolean
  icon?: string
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
          <Icon
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

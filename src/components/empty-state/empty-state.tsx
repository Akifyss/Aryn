import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import './styles.css'

export type EmptyStateProps = {
  title: ReactNode
  actions?: ReactNode
  className?: string
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
  icon = 'streamline-plump-color:file-folder-flat',
  iconClassName,
}: EmptyStateProps) {
  return (
    <div className={joinClasses('app-empty-state', fill && 'is-fill', className)}>
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

import { type ReactNode } from 'react'
import {
  DownLine,
  RightLine,
} from '@mingcute/react'

type TreeHeaderProps = {
  actions?: ReactNode
  className?: string
  count?: ReactNode
  isExpanded?: boolean
  title: ReactNode
  toggleAriaLabel?: string
  onToggle?: () => void
}

export function TreeHeader({
  actions,
  className = '',
  count,
  isExpanded,
  title,
  toggleAriaLabel,
  onToggle,
}: TreeHeaderProps) {
  const isToggleable = typeof isExpanded === 'boolean' && Boolean(onToggle)
  const rootClassName = [
    'tree-header',
    isToggleable && !isExpanded ? 'is-collapsed' : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  const titleAreaClassNames = [
    isToggleable ? 'tree-header-toggle' : 'tree-header-title-area',
  ].filter(Boolean).join(' ')
  const renderedCount = count === undefined ? null : <span className='tree-header-count'>{count}</span>
  const renderedActions = actions
    ? (
      <div
        className='tree-header-actions'
      >
        {actions}
      </div>
    )
    : null
  const renderedChevron = isToggleable
    ? isExpanded
      ? (
        <DownLine className='tree-header-chevron tree-header-chevron-box' size={16} aria-hidden='true' />
      )
      : (
        <RightLine className='tree-header-chevron tree-header-chevron-box' size={16} aria-hidden='true' />
      )
    : null

  return (
    <div className={rootClassName}>
      {isToggleable ? (
        <button
          type='button'
          className={titleAreaClassNames}
          aria-expanded={isExpanded}
          aria-label={toggleAriaLabel}
          onClick={onToggle}
        >
          <span className='tree-header-title'>{title}</span>
          {renderedCount}
          {renderedChevron}
        </button>
      ) : (
        <div className={titleAreaClassNames}>
          <span className='tree-header-title'>{title}</span>
          {renderedCount}
        </div>
      )}
      {renderedActions}
    </div>
  )
}

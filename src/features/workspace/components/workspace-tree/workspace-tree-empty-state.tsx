import type { ReactNode } from 'react'
import './styles.css'

type WorkspaceTreeEmptyStateProps = {
  icon: ReactNode
  message: ReactNode
}

export function WorkspaceTreeEmptyState({
  icon,
  message,
}: WorkspaceTreeEmptyStateProps) {
  return (
    <div className='workspace-tree-empty-state'>
      <div className='workspace-tree-empty-icon' aria-hidden='true'>
        {icon}
      </div>
      <p>{message}</p>
    </div>
  )
}

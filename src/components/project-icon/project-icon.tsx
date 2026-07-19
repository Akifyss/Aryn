import { FolderLine } from '@mingcute/react'

export function ProjectIcon({ className }: { className?: string }) {
  return (
    <FolderLine
      aria-hidden='true'
      className={className ? `project-icon ${className}` : 'project-icon'}
      size={16}
    />
  )
}

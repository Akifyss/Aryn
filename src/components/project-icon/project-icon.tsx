import { FolderLine } from '@mingcute/react'
import type { AppIconSize } from '@/components/icon-size'

export function ProjectIcon({
  className,
  size = 'md',
}: {
  className?: string
  size?: AppIconSize
}) {
  return (
    <FolderLine
      aria-hidden='true'
      className={className ? `project-icon ${className}` : 'project-icon'}
      data-size={size}
    />
  )
}

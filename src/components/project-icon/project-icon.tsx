import { FolderLine, FolderOpenLine } from '@mingcute/react'
import type { AppIconSize } from '@/components/icon-size'

export function ProjectIcon({
  className,
  isOpen = false,
  size = 'md',
}: {
  className?: string
  isOpen?: boolean
  size?: AppIconSize
}) {
  const Icon = isOpen ? FolderOpenLine : FolderLine

  return (
    <Icon
      aria-hidden='true'
      className={[
        'project-icon',
        isOpen && 'is-open',
        className,
      ].filter(Boolean).join(' ')}
      data-size={size}
    />
  )
}

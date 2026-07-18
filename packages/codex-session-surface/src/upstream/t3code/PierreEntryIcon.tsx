import { FileIcon, FolderIcon } from 'lucide-react'
import { memo } from 'react'
import { cn } from '~/lib/utils'

export const PierreEntryIcon = memo(function PierreEntryIcon(props: {
  pathValue: string
  kind: 'file' | 'directory'
  theme: 'light' | 'dark'
  className?: string
}) {
  const Icon = props.kind === 'directory' ? FolderIcon : FileIcon
  return <Icon aria-hidden='true' className={cn('size-4 shrink-0', props.className)} />
})

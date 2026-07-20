import { type KeyboardEvent, type ReactNode } from 'react'
import { CloseLine, PicLine } from '@mingcute/react'

import { AppTooltipButton } from '@/components/app-tooltip'
import { WorkspaceFileIcon } from '@/components/file-change-visuals'
import type {
  AgentMessageAttachment,
  AgentPromptAttachment,
} from '@/features/agent/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'

import './styles.css'

type AgentFileCardAttachment = AgentPromptAttachment & {
  status?: AgentMessageAttachment['status']
}

type AgentFileCardProps = {
  ariaLabel?: string
  className?: string
  fileName: string
  iconSize?: number
  iconTheme?: WorkspaceIconTheme | null
  imageSrc?: string
  isImage?: boolean
  isMuted?: boolean
  meta?: string
  onActivate?: () => void
  onRemove?: () => void
  trailing?: ReactNode
}

function formatAttachmentSize(size: number | undefined) {
  if (size === undefined) {
    return ''
  }

  if (size < 1024) {
    return `${size} B`
  }

  const units = ['KB', 'MB', 'GB']
  let amount = size / 1024
  let unitIndex = 0

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }

  return `${amount >= 10 ? amount.toFixed(1) : amount.toFixed(2)} ${units[unitIndex]}`
}

function getAttachmentStatusLabel(status: AgentMessageAttachment['status']) {
  switch (status) {
    case 'sent':
      return 'sent'
    case 'omitted':
      return 'text only'
    case 'referenced':
      return 'referenced'
    default:
      return null
  }
}

export function AgentFileCard({
  ariaLabel,
  className,
  fileName,
  iconSize = 18,
  iconTheme,
  imageSrc,
  isImage = false,
  isMuted = false,
  meta,
  onActivate,
  onRemove,
  trailing,
}: AgentFileCardProps) {
  const isInteractive = Boolean(onActivate)
  const fileCardClassName = [
    'agent-file-card',
    className,
    isImage ? 'is-image' : '',
    isMuted ? 'is-muted' : '',
    isInteractive ? 'is-interactive' : '',
  ].filter(Boolean).join(' ')

  function handleActivate() {
    onActivate?.()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return
    }

    event.preventDefault()
    onActivate?.()
  }

  const card = (
    <div
      aria-label={isInteractive ? ariaLabel : undefined}
      className={fileCardClassName}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onClick={isInteractive ? handleActivate : undefined}
      onKeyDown={isInteractive ? handleKeyDown : undefined}
    >
      <span className={`agent-file-card-preview${imageSrc ? ' has-image' : ''}`}>
        {imageSrc ? (
          <img alt='' draggable='false' src={imageSrc} />
        ) : isImage ? (
          <PicLine aria-hidden='true' size={iconSize} />
        ) : (
          <WorkspaceFileIcon fileName={fileName} iconTheme={iconTheme ?? null} />
        )}
      </span>
      {isImage ? null : (
        <span className='agent-file-card-text'>
          <span className='agent-file-card-name'>{fileName}</span>
          {meta ? <span className='agent-file-card-meta'>{meta}</span> : null}
        </span>
      )}
      {trailing ? <span className='agent-file-card-trailing'>{trailing}</span> : null}
      {onRemove ? (
        <AppTooltipButton
          type='button'
          className='agent-file-card-remove'
          aria-label={`移除 ${fileName}`}
          tooltip='移除附件'
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
        >
          <CloseLine aria-hidden='true' size={10} />
        </AppTooltipButton>
      ) : null}
    </div>
  )

  return card
}

export function AgentAttachmentFileCard({
  attachment,
  iconTheme,
  iconSize = 18,
  onRemove,
}: {
  attachment: AgentFileCardAttachment
  iconTheme?: WorkspaceIconTheme | null
  iconSize?: number
  onRemove?: () => void
}) {
  const isImage = attachment.kind === 'image'
  const previewSrc = isImage ? attachment.data : undefined
  const statusLabel = getAttachmentStatusLabel(attachment.status)
  const sizeLabel = formatAttachmentSize(attachment.size)
  const meta = [
    isImage ? 'Image' : 'File',
    isImage ? null : sizeLabel,
    statusLabel,
  ].filter(Boolean).join(' · ')

  return (
    <AgentFileCard
      fileName={attachment.fileName}
      iconSize={iconSize}
      iconTheme={iconTheme}
      imageSrc={previewSrc}
      isImage={isImage}
      isMuted={attachment.status === 'omitted'}
      meta={meta}
      onRemove={onRemove}
    />
  )
}

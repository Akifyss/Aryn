import { Spinner } from '@heroui/react'
import { WarningLine } from '@mingcute/react'
import { AppItem, AppItemIcon } from '@/components/app-item'

type AgentSessionTreeStatus = 'empty' | 'error' | 'loading'

export function resolveAgentSessionTreeStatus({
  errorCount,
  hasCompleteSnapshot,
  isPending,
  sessionCount,
}: {
  errorCount: number
  hasCompleteSnapshot: boolean
  isPending: boolean
  sessionCount: number
}): AgentSessionTreeStatus | null {
  if (isPending && !hasCompleteSnapshot) return 'loading'
  if (!isPending && errorCount > 0) return 'error'
  if (hasCompleteSnapshot && sessionCount === 0) return 'empty'
  return null
}

export function AgentSessionTreeStatusItem({
  label,
  status,
}: {
  label: string
  status: AgentSessionTreeStatus
}) {
  const iconContent = status === 'loading'
    ? (
        <Spinner
          color='current'
          size='sm'
        />
      )
    : status === 'error'
      ? <WarningLine aria-hidden='true' />
      : undefined
  const icon = iconContent ? (
    <AppItemIcon aria-hidden='true'>
      {iconContent}
    </AppItemIcon>
  ) : undefined

  return (
    <AppItem
      aria-atomic='true'
      aria-live='polite'
      itemClassName={`agent-session-tree-status-item is-${status}`}
      icon={icon}
      label={label}
      labelClassName='agent-session-tree-status-label'
      mainKind='static'
      role='status'
    />
  )
}

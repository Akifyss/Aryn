import { Spinner } from '@heroui/react'
import { WarningLine } from '@mingcute/react'

export function AgentSessionTreeLoadIndicator({
  className,
  errorCount,
  isDecorative = false,
  isLoading,
}: {
  className?: string
  errorCount: number
  isDecorative?: boolean
  isLoading: boolean
}) {
  const label = isDecorative
    ? null
    : isLoading
      ? '正在加载会话…'
      : errorCount > 0
        ? `${errorCount} 个 Agent 的会话加载失败；收起并重新展开项目可重试`
        : null

  return (
    <span
      className={[
        'agent-session-tree-load-indicator',
        isLoading && 'is-loading',
        errorCount > 0 && !isLoading && 'has-error',
        className,
      ].filter(Boolean).join(' ')}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
      aria-label={label ?? undefined}
      title={label ?? undefined}
    >
      {isLoading ? (
        <Spinner
          aria-hidden='true'
          className='agent-session-tree-load-spinner size-[var(--icon-size-md)]'
          size='sm'
        />
      ) : errorCount > 0 ? (
        <WarningLine aria-hidden='true' />
      ) : null}
    </span>
  )
}

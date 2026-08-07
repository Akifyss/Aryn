export type AgentSessionTreeStatus = 'empty' | 'error' | 'loading'

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

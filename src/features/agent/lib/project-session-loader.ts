import type { AgentId } from '@/features/agent/agent-definition'
import type {
  AgentProjectSessionBucket,
  AgentSessionSourceState,
} from '@/features/agent/lib/session-tree'
import type { AgentSessionListItem } from '@/features/agent/types'

export type AgentProjectSessionLoadOutcome = {
  agentId: AgentId
  error: string | null
  sessions: AgentSessionListItem[] | null
}

type ListAgentSessions = (scope: {
  agentId: AgentId
  workspacePath: string
}) => Promise<AgentSessionListItem[]>

function formatSessionLoadError(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to load conversations.'
}

export function markAgentProjectSessionSourcesLoading(
  bucket: AgentProjectSessionBucket | undefined,
  agentIds: readonly AgentId[],
): AgentProjectSessionBucket {
  if (agentIds.length === 0) return bucket ?? {}

  const nextBucket = { ...bucket }
  for (const agentId of agentIds) {
    nextBucket[agentId] = {
      error: null,
      // `hasLoaded` means that this source has settled at least once. Keep it
      // during a retry so the tree can replace its error row with a same-height
      // loading row instead of collapsing the subtree again.
      hasLoaded: bucket?.[agentId]?.hasLoaded ?? false,
      isLoading: true,
      sessions: bucket?.[agentId]?.sessions ?? [],
    }
  }
  return nextBucket
}

export function getAgentProjectSessionSourceIdsToLoad(
  bucket: AgentProjectSessionBucket | undefined,
  agentIds: readonly AgentId[],
) {
  return agentIds.filter((agentId) => {
    const source = bucket?.[agentId]
    return !source?.isLoading && (!source?.hasLoaded || source.error !== null)
  })
}

export async function loadAgentProjectSessionSources(
  agentIds: readonly AgentId[],
  workspacePath: string,
  listAgentSessions: ListAgentSessions,
): Promise<AgentProjectSessionLoadOutcome[]> {
  const settlements = await Promise.allSettled(agentIds.map((agentId) => (
    Promise.resolve().then(() => listAgentSessions({ agentId, workspacePath }))
  )))

  return settlements.map((settlement, index) => {
    const agentId = agentIds[index]
    if (!agentId) {
      throw new Error('Agent session load result is missing its Agent id.')
    }

    return settlement.status === 'fulfilled'
      ? { agentId, error: null, sessions: settlement.value }
      : { agentId, error: formatSessionLoadError(settlement.reason), sessions: null }
  })
}

export function commitAgentProjectSessionLoad(
  bucket: AgentProjectSessionBucket | undefined,
  outcomes: readonly AgentProjectSessionLoadOutcome[],
): AgentProjectSessionBucket {
  let nextBucket = bucket ?? {}
  let hasChanges = false

  for (const outcome of outcomes) {
    const currentSource = bucket?.[outcome.agentId]

    // A runtime event or a local mutation may have replaced this source while
    // the aggregate request was in flight. Only a source still owned by this
    // loading transaction is safe to replace with its result.
    if (!currentSource?.isLoading) continue

    if (!hasChanges) {
      nextBucket = { ...nextBucket }
      hasChanges = true
    }

    const nextSource: AgentSessionSourceState = {
      error: outcome.error,
      hasLoaded: true,
      isLoading: false,
      sessions: outcome.sessions ?? currentSource.sessions,
    }
    nextBucket[outcome.agentId] = nextSource
  }

  return nextBucket
}

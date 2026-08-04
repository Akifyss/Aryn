import type { AgentId } from '@/features/agent/agent-definition'
import {
  areAgentProjectSessionSourcesLoaded,
  type AgentProjectSessionBucket,
  type AgentSessionSourceState,
} from '@/features/agent/lib/session-tree'
import type { AgentSessionListItem } from '@/features/agent/types'

/*
 * Keep load orchestration separate from the project-level snapshot boundary:
 * source freshness may reset, while a previously complete snapshot remains
 * safe to render during a background refresh.
 */
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
  if (agentIds.length === 0) {
    return bucket ?? { hasCompleteSnapshot: false, sources: {} }
  }

  const currentSources = bucket?.sources ?? {}
  const nextSources = { ...currentSources }
  for (const agentId of agentIds) {
    nextSources[agentId] = {
      error: null,
      // `hasLoaded` tracks this cache generation. Preserve it during a retry;
      // invalidation may reset it without clearing `hasCompleteSnapshot`.
      hasLoaded: currentSources[agentId]?.hasLoaded ?? false,
      isLoading: true,
      sessions: currentSources[agentId]?.sessions ?? [],
    }
  }
  return {
    hasCompleteSnapshot: bucket?.hasCompleteSnapshot ?? false,
    sources: nextSources,
  }
}

export function getAgentProjectSessionSourceIdsToLoad(
  bucket: AgentProjectSessionBucket | undefined,
  agentIds: readonly AgentId[],
) {
  return agentIds.filter((agentId) => {
    const source = bucket?.sources[agentId]
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
  snapshotAgentIds: readonly AgentId[],
): AgentProjectSessionBucket {
  let nextSources = bucket?.sources ?? {}
  let hasChanges = false

  for (const outcome of outcomes) {
    const currentSource = bucket?.sources[outcome.agentId]

    // A runtime event or a local mutation may have replaced this source while
    // the aggregate request was in flight. Only a source still owned by this
    // loading transaction is safe to replace with its result.
    if (!currentSource?.isLoading) continue

    if (!hasChanges) {
      nextSources = { ...nextSources }
      hasChanges = true
    }

    const nextSource: AgentSessionSourceState = {
      error: outcome.error,
      hasLoaded: true,
      isLoading: false,
      sessions: outcome.sessions ?? currentSource.sessions,
    }
    nextSources[outcome.agentId] = nextSource
  }

  const hasCompleteSnapshot = (bucket?.hasCompleteSnapshot ?? false)
    || areAgentProjectSessionSourcesLoaded(nextSources, snapshotAgentIds)

  if (!hasChanges && hasCompleteSnapshot === bucket?.hasCompleteSnapshot) {
    return bucket ?? { hasCompleteSnapshot: false, sources: {} }
  }

  return { hasCompleteSnapshot, sources: nextSources }
}

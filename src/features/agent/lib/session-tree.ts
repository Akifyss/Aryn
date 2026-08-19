import { AGENT_DEFINITIONS, type AgentId } from '@/features/agent/agent-definition'
import type { AgentSessionListItem } from '@/features/agent/types'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'

export type AgentSessionSourceState = {
  error: string | null
  /** Whether this Agent source has settled in the current cache generation. */
  hasLoaded: boolean
  isLoading: boolean
  sessions: AgentSessionListItem[]
}

export type AgentProjectSessionSources = Partial<Record<AgentId, AgentSessionSourceState>>

export type AgentProjectSessionBucket = {
  /**
   * Once established, the tree may keep rendering this complete project-level
   * snapshot while individual Agent sources refresh in the background.
   */
  hasCompleteSnapshot: boolean
  sources: AgentProjectSessionSources
}

export type AgentSessionTreeItem = AgentSessionListItem & {
  agentId: AgentId
}

/**
 * Session history is an aggregate of every supported Agent, not a projection
 * of the currently runnable Agent catalog. CLI discovery can fail transiently
 * (or the CLI can be removed after sessions were created), but that must not
 * make another Agent's history disappear from the project tree.
 */
export const SESSION_TREE_AGENT_IDS: readonly AgentId[] = Object.freeze(
  AGENT_DEFINITIONS.map((definition) => definition.id),
)

const AGENT_ORDER = new Map(AGENT_DEFINITIONS.map((definition, index) => [definition.id, index]))

function getSortableTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function sanitizeFlatAgentSessionPath(value: string) {
  return value
    .replace(/[\\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function formatAgentSessionLabel(session: AgentSessionListItem | null) {
  return session
    ? sanitizeFlatAgentSessionPath(session.name ?? session.preview) || 'Untitled session'
    : 'Session'
}

export function formatAgentSessionRelativeTime(timestamp: string) {
  const value = Date.parse(timestamp)

  if (!Number.isFinite(value)) {
    return ''
  }

  const elapsedMs = Math.max(0, Date.now() - value)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (elapsedMs < minute) {
    return '刚刚'
  }

  if (elapsedMs < hour) {
    return `${Math.max(1, Math.floor(elapsedMs / minute))} 分`
  }

  if (elapsedMs < day) {
    return `${Math.floor(elapsedMs / hour)} 小时`
  }

  return `${Math.floor(elapsedMs / day)} 天`
}

export function normalizeAgentProjectPath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function resolveAgentSessionTreeProject(
  projects: readonly ProjectRecord[],
  activeWorkspaceContext: ActiveWorkspaceContext,
  workspacePath: string | null,
) {
  if (activeWorkspaceContext.kind === 'project') {
    return projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
  }

  if (!workspacePath) return null
  const normalizedWorkspacePath = normalizeAgentProjectPath(workspacePath)
  return projects.find((project) => (
    normalizeAgentProjectPath(project.path) === normalizedWorkspacePath
  )) ?? null
}

export function getAgentSessionActivityKey(agentId: AgentId, sessionKey: string) {
  return `${agentId}\n${sessionKey}`
}

export function getAgentSessionTreeKey(agentId: AgentId, sessionPath: string) {
  return `${agentId}\n${sessionPath}`
}

export function findAgentProjectSessionProjectId(
  buckets: Readonly<Record<string, AgentProjectSessionBucket>>,
  agentId: AgentId,
  sessionPath: string,
) {
  for (const [projectId, bucket] of Object.entries(buckets)) {
    if (bucket.sources[agentId]?.sessions.some((session) => session.path === sessionPath)) {
      return projectId
    }
  }

  return null
}

export function flattenAgentProjectSessions(bucket: AgentProjectSessionBucket | undefined) {
  if (!bucket) return []

  return Object.entries(bucket.sources)
    .flatMap(([agentId, source]) => (
      source?.sessions.map((session): AgentSessionTreeItem => ({
        ...session,
        agentId: agentId as AgentId,
      })) ?? []
    ))
    .sort((left, right) => {
      const modifiedDifference = getSortableTimestamp(right.modifiedAt) - getSortableTimestamp(left.modifiedAt)
      if (modifiedDifference !== 0) return modifiedDifference
      const agentDifference = (AGENT_ORDER.get(left.agentId) ?? 0) - (AGENT_ORDER.get(right.agentId) ?? 0)
      return agentDifference !== 0 ? agentDifference : left.path.localeCompare(right.path)
    })
}

export function selectVisibleAgentProjectSessions(bucket: AgentProjectSessionBucket | undefined) {
  return bucket?.hasCompleteSnapshot ? flattenAgentProjectSessions(bucket) : []
}

export function summarizeAgentProjectSessionBucket(
  bucket: AgentProjectSessionBucket | undefined,
  agentIds: readonly AgentId[],
) {
  const sources = agentIds.map((agentId) => bucket?.sources[agentId]).filter(Boolean)
  return {
    errors: sources.flatMap((source) => source?.error ? [source.error] : []),
    hasCompleteSnapshot: bucket?.hasCompleteSnapshot ?? false,
    hasLoaded: areAgentProjectSessionSourcesLoaded(bucket?.sources, agentIds),
    isLoading: agentIds.some((agentId) => bucket?.sources[agentId]?.isLoading),
  }
}

export function areAgentProjectSessionSourcesLoaded(
  sources: AgentProjectSessionSources | undefined,
  agentIds: readonly AgentId[],
) {
  return agentIds.length > 0 && agentIds.every((agentId) => sources?.[agentId]?.hasLoaded)
}

export function storeAgentProjectSessionSource(
  bucket: AgentProjectSessionBucket | undefined,
  agentId: AgentId,
  sessions: AgentSessionListItem[],
  snapshotAgentIds: readonly AgentId[],
): AgentProjectSessionBucket {
  const sources: AgentProjectSessionSources = {
    ...bucket?.sources,
    [agentId]: {
      error: null,
      hasLoaded: true,
      isLoading: false,
      sessions,
    },
  }

  return {
    hasCompleteSnapshot: (bucket?.hasCompleteSnapshot ?? false)
      || areAgentProjectSessionSourcesLoaded(sources, snapshotAgentIds),
    sources,
  }
}

export function invalidateAgentProjectSessionBuckets(
  buckets: Record<string, AgentProjectSessionBucket>,
) {
  return Object.fromEntries(Object.entries(buckets).map(([projectId, bucket]) => [
    projectId,
    {
      hasCompleteSnapshot: bucket.hasCompleteSnapshot,
      sources: Object.fromEntries(Object.entries(bucket.sources).map(([agentId, source]) => [
        agentId,
        source
          ? {
              error: null,
              hasLoaded: false,
              isLoading: false,
              sessions: source.sessions,
            }
          : source,
      ])) as AgentProjectSessionSources,
    },
  ])) as Record<string, AgentProjectSessionBucket>
}

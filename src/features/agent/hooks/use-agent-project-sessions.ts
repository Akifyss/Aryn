import { useCallback, useRef, useState } from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import {
  commitAgentProjectSessionLoad,
  getAgentProjectSessionSourceIdsToLoad,
  loadAgentProjectSessionSources,
  markAgentProjectSessionSourcesLoading,
} from '@/features/agent/lib/project-session-loader'
import {
  invalidateAgentProjectSessionBuckets,
  normalizeAgentProjectPath,
  storeAgentProjectSessionSource,
  type AgentProjectSessionBucket,
} from '@/features/agent/lib/session-tree'
import type { AgentSessionListItem } from '@/features/agent/types'
import type { ProjectRecord, ProjectState } from '@/features/workspace/types'

type UseAgentProjectSessionsOptions = {
  projectState: ProjectState
  sessionTreeAgentIds: readonly AgentId[]
}

type UseAgentProjectSessionsResult = {
  invalidateProjectSessions: () => void
  loadProjectSessions: (project: ProjectRecord) => Promise<void>
  projectSessions: Record<string, AgentProjectSessionBucket>
  storeProjectAgentSessions: (
    workspacePath: string,
    agentId: AgentId,
    sessions: AgentSessionListItem[],
  ) => void
}

export function useAgentProjectSessions({
  projectState,
  sessionTreeAgentIds,
}: UseAgentProjectSessionsOptions): UseAgentProjectSessionsResult {
  const [projectSessions, setProjectSessions] = useState<Record<string, AgentProjectSessionBucket>>({})
  // Recreate the loader after invalidation so expanded tree nodes request fresh sessions.
  const [cacheInvalidationRevision, setCacheInvalidationRevision] = useState(0)
  const projectSessionRequestsRef = useRef<Set<string>>(new Set())
  const projectSessionRequestGenerationRef = useRef(0)
  const projectSessionsRef = useRef(projectSessions)
  const projectStateRef = useRef(projectState)

  projectStateRef.current = projectState

  // Keep one synchronous snapshot for request ownership checks and event-driven
  // writes. Every project-session state change goes through this function, so
  // batched runtime events cannot calculate from an older React render.
  const updateProjectSessions = useCallback((
    update: (
      currentValue: Record<string, AgentProjectSessionBucket>,
    ) => Record<string, AgentProjectSessionBucket>,
  ) => {
    const currentValue = projectSessionsRef.current
    const nextValue = update(currentValue)
    if (nextValue === currentValue) return

    projectSessionsRef.current = nextValue
    setProjectSessions(nextValue)
  }, [])

  const invalidateProjectSessions = useCallback(() => {
    projectSessionRequestGenerationRef.current += 1
    projectSessionRequestsRef.current.clear()
    updateProjectSessions(invalidateAgentProjectSessionBuckets)
    setCacheInvalidationRevision((revision) => revision + 1)
  }, [updateProjectSessions])

  const storeProjectAgentSessions = useCallback((
    targetWorkspacePath: string,
    agentId: AgentId,
    sessions: AgentSessionListItem[],
  ) => {
    const matchingProjectIds = projectStateRef.current.projects
      .filter((project) => normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(targetWorkspacePath))
      .map((project) => project.id)
    if (matchingProjectIds.length === 0) return

    updateProjectSessions((currentValue) => {
      const nextValue = { ...currentValue }
      for (const projectId of matchingProjectIds) {
        nextValue[projectId] = storeAgentProjectSessionSource(
          nextValue[projectId],
          agentId,
          sessions,
          sessionTreeAgentIds,
        )
      }
      return nextValue
    })
  }, [sessionTreeAgentIds, updateProjectSessions])

  const loadProjectSessions = useCallback(async (project: ProjectRecord) => {
    const requestGeneration = projectSessionRequestGenerationRef.current
    const requestAgentIds = getAgentProjectSessionSourceIdsToLoad(
      projectSessionsRef.current[project.id],
      sessionTreeAgentIds,
    ).filter((requestAgentId) => {
      const requestKey = `${requestGeneration}\n${requestAgentId}\n${project.id}`
      return !projectSessionRequestsRef.current.has(requestKey)
    })

    if (requestAgentIds.length === 0) return

    const requestKeys = requestAgentIds.map((requestAgentId) => {
      const requestKey = `${requestGeneration}\n${requestAgentId}\n${project.id}`
      projectSessionRequestsRef.current.add(requestKey)
      return requestKey
    })

    updateProjectSessions((currentValue) => ({
      ...currentValue,
      [project.id]: markAgentProjectSessionSourcesLoading(
        currentValue[project.id],
        requestAgentIds,
      ),
    }))

    try {
      const outcomes = await loadAgentProjectSessionSources(
        requestAgentIds,
        project.path,
        (scope) => window.appApi.listAgentSessions(scope),
      )
      if (projectSessionRequestGenerationRef.current !== requestGeneration) return

      updateProjectSessions((currentValue) => {
        const currentBucket = currentValue[project.id]
        const nextBucket = commitAgentProjectSessionLoad(
          currentBucket,
          outcomes,
          sessionTreeAgentIds,
        )
        if (nextBucket === currentBucket) return currentValue

        return {
          ...currentValue,
          [project.id]: nextBucket,
        }
      })
    } finally {
      for (const requestKey of requestKeys) {
        projectSessionRequestsRef.current.delete(requestKey)
      }
    }
  }, [cacheInvalidationRevision, sessionTreeAgentIds, updateProjectSessions])

  return {
    invalidateProjectSessions,
    loadProjectSessions,
    projectSessions,
    storeProjectAgentSessions,
  }
}

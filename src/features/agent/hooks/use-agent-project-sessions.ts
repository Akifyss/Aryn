import { useCallback, useRef, useState } from 'react'
import type { AgentId } from '@/features/agent/agent-definition'
import {
  invalidateAgentProjectSessionBuckets,
  normalizeAgentProjectPath,
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

  projectSessionsRef.current = projectSessions
  projectStateRef.current = projectState

  const invalidateProjectSessions = useCallback(() => {
    projectSessionRequestGenerationRef.current += 1
    projectSessionRequestsRef.current.clear()
    setProjectSessions(invalidateAgentProjectSessionBuckets)
    setCacheInvalidationRevision((revision) => revision + 1)
  }, [])

  const storeProjectAgentSessions = useCallback((
    targetWorkspacePath: string,
    agentId: AgentId,
    sessions: AgentSessionListItem[],
  ) => {
    const matchingProjectIds = projectStateRef.current.projects
      .filter((project) => normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(targetWorkspacePath))
      .map((project) => project.id)
    if (matchingProjectIds.length === 0) return

    setProjectSessions((currentValue) => {
      const nextValue = { ...currentValue }
      for (const projectId of matchingProjectIds) {
        nextValue[projectId] = {
          ...nextValue[projectId],
          [agentId]: {
            error: null,
            hasLoaded: true,
            isLoading: false,
            sessions,
          },
        }
      }
      return nextValue
    })
  }, [])

  const loadProjectSessions = useCallback(async (project: ProjectRecord) => {
    const requestGeneration = projectSessionRequestGenerationRef.current
    await Promise.all(sessionTreeAgentIds.map(async (requestAgentId) => {
      const requestKey = `${requestGeneration}\n${requestAgentId}\n${project.id}`
      if (projectSessionRequestsRef.current.has(requestKey)) return
      const existingSource = projectSessionsRef.current[project.id]?.[requestAgentId]
      if (existingSource?.isLoading || existingSource?.hasLoaded) return

      projectSessionRequestsRef.current.add(requestKey)
      setProjectSessions((currentValue) => ({
        ...currentValue,
        [project.id]: {
          ...currentValue[project.id],
          [requestAgentId]: {
            error: null,
            hasLoaded: false,
            isLoading: true,
            sessions: currentValue[project.id]?.[requestAgentId]?.sessions ?? [],
          },
        },
      }))

      try {
        const sessions = await window.appApi.listAgentSessions({
          agentId: requestAgentId,
          workspacePath: project.path,
        })
        if (projectSessionRequestGenerationRef.current !== requestGeneration) return
        setProjectSessions((currentValue) => ({
          ...currentValue,
          [project.id]: {
            ...currentValue[project.id],
            [requestAgentId]: {
              error: null,
              hasLoaded: true,
              isLoading: false,
              sessions,
            },
          },
        }))
      } catch (error) {
        if (projectSessionRequestGenerationRef.current !== requestGeneration) return
        setProjectSessions((currentValue) => ({
          ...currentValue,
          [project.id]: {
            ...currentValue[project.id],
            [requestAgentId]: {
              error: error instanceof Error ? error.message : 'Unable to load conversations.',
              hasLoaded: true,
              isLoading: false,
              sessions: currentValue[project.id]?.[requestAgentId]?.sessions ?? [],
            },
          },
        }))
      } finally {
        projectSessionRequestsRef.current.delete(requestKey)
      }
    }))
  }, [cacheInvalidationRevision, sessionTreeAgentIds])

  return {
    invalidateProjectSessions,
    loadProjectSessions,
    projectSessions,
    storeProjectAgentSessions,
  }
}

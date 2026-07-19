import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import type { ProjectRecord, ProjectState } from '@/features/workspace/types'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'

export function createEmptyProjectState(): ProjectState {
  return {
    lastProjectId: null,
    projects: [],
  }
}

export function getLastActiveProject(projectState: ProjectState): ProjectRecord | null {
  return projectState.projects.find((project) => project.id === projectState.lastProjectId) ?? null
}

export function getProjectByWorkspacePath(
  projectState: ProjectState,
  workspacePath: string | null,
): ProjectRecord | null {
  if (!workspacePath) {
    return null
  }

  const normalizedWorkspacePath = normalizeFilePath(workspacePath)
  return projectState.projects.find(
    (project) => normalizeFilePath(project.path) === normalizedWorkspacePath,
  ) ?? null
}

export function resolveActiveProject(
  projectState: ProjectState,
  activeWorkspaceContext: ActiveWorkspaceContext,
  currentWorkspacePath: string | null,
): ProjectRecord | null {
  if (activeWorkspaceContext.kind === 'project') {
    return projectState.projects.find(
      (project) => project.id === activeWorkspaceContext.projectId,
    ) ?? null
  }

  return getProjectByWorkspacePath(projectState, currentWorkspacePath)
}

import type { AgentId } from '@/features/agent/agent-definition'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'

export type AgentProjectSessionRequest = {
  kind: 'new'
  projectId: string
  requestId: number
} | {
  agentId: AgentId
  kind: 'session'
  projectId: string
  requestId: number
  sessionPath: string
}

export type AgentWorkspaceSessionRestore = {
  options?: { restoreSession: false }
  preferredSessionPath: string | null
}

export type AgentWorkspaceRestoreState = {
  lastAgentSessionPath: string | null
  prefersNewAgentSession?: boolean
}

export type AgentWorkspaceRuntimeIdentity = {
  agentId: AgentId
  workspacePath: string | null
}

export type AgentSessionSelection = { kind: 'new' } | {
  agentId: AgentId
  kind: 'session'
  sessionPath: string
}

export type AgentSessionOperationIdentity = {
  agentId: AgentId
  sessionPath: string
  workspacePath: string
}

export function resolvePendingAgentNewSessionProject(
  request: AgentProjectSessionRequest | null | undefined,
  activeWorkspaceContext: ActiveWorkspaceContext,
  projects: ProjectRecord[],
) {
  if (
    request?.kind !== 'new'
    || activeWorkspaceContext.kind !== 'project'
    || request.projectId !== activeWorkspaceContext.projectId
  ) {
    return null
  }

  return projects.find((project) => project.id === request.projectId) ?? null
}

export function isAgentNewConversationPresentation(
  selection: AgentSessionSelection,
  presentationWorkspacePath: string | null | undefined,
  activeWorkspaceContext: ActiveWorkspaceContext,
  projects: ProjectRecord[],
) {
  if (selection.kind !== 'new') {
    return false
  }

  if (activeWorkspaceContext.kind === 'conversationDraft') {
    return presentationWorkspacePath === null
  }

  if (
    activeWorkspaceContext.kind !== 'project'
    || typeof presentationWorkspacePath !== 'string'
  ) {
    return false
  }

  const activeProject = projects.find((project) => project.id === activeWorkspaceContext.projectId)
  return Boolean(
    activeProject
    && normalizeAgentWorkspacePath(activeProject.path) === normalizeAgentWorkspacePath(presentationWorkspacePath),
  )
}

function normalizeAgentWorkspacePath(value: string) {
  return value.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function shouldApplyAgentWorkspaceState(
  selection: AgentSessionSelection,
  eventAgentId: AgentId,
  eventSessionPath: string | null,
) {
  return selection.kind === 'new'
    ? eventSessionPath === null
    : selection.agentId === eventAgentId && selection.sessionPath === eventSessionPath
}

export function shouldPersistAgentWorkspaceSelection(
  runtime: AgentWorkspaceRuntimeIdentity,
  selectedAgentId: AgentId,
  workspacePath: string,
) {
  if (!runtime.workspacePath) return false
  return runtime.agentId === selectedAgentId
    && normalizeAgentWorkspacePath(runtime.workspacePath) === normalizeAgentWorkspacePath(workspacePath)
}

/**
 * Async session commands may resolve after the user switches Agent, session,
 * or workspace. Only the request that still owns the visible native session
 * may replace its runtime state.
 */
export function shouldApplyAgentSessionOperationResult(
  selection: AgentSessionSelection,
  currentWorkspacePath: string | null,
  operation: AgentSessionOperationIdentity,
) {
  return Boolean(
    currentWorkspacePath
    && selection.kind === 'session'
    && selection.agentId === operation.agentId
    && selection.sessionPath === operation.sessionPath
    && normalizeAgentWorkspacePath(currentWorkspacePath) === normalizeAgentWorkspacePath(operation.workspacePath),
  )
}

export function resolveAgentWorkspaceSessionRestore(
  request: AgentProjectSessionRequest | null | undefined,
  workspaceState: AgentWorkspaceRestoreState,
): AgentWorkspaceSessionRestore {
  if (request?.kind === 'new') {
    return {
      options: { restoreSession: false },
      preferredSessionPath: null,
    }
  }

  if (request?.kind === 'session') {
    return {
      preferredSessionPath: request.sessionPath,
    }
  }

  if (workspaceState.prefersNewAgentSession) {
    return {
      options: { restoreSession: false },
      preferredSessionPath: null,
    }
  }

  return {
    preferredSessionPath: workspaceState.lastAgentSessionPath,
  }
}

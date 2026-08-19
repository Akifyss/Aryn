import {
  resolveAgentSessionControlTarget,
  type AgentProjectSessionRequest,
  type AgentSessionSelection,
} from '@/features/agent/lib/project-session-request'
import {
  findAgentProjectSession,
  formatAgentSessionLabel,
  normalizeAgentProjectPath,
  type AgentProjectSessionBucket,
} from '@/features/agent/lib/session-tree'
import type {
  AgentRuntimeState,
  AgentSessionListItem,
} from '@/features/agent/types'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'

export function shouldShowAgentNewConversationPrompt(
  activeWorkspaceContext: ActiveWorkspaceContext,
  selection: AgentSessionSelection,
) {
  return selection.kind === 'new' && activeWorkspaceContext.kind !== 'conversation'
}

export function shouldShowAgentThreadbarSessionControl(
  activeWorkspaceContext: ActiveWorkspaceContext,
  selection: AgentSessionSelection,
) {
  return activeWorkspaceContext.kind !== 'conversationDraft'
    || !shouldShowAgentNewConversationPrompt(activeWorkspaceContext, selection)
}

export function shouldShowAgentProjectSessionMenu(
  activeWorkspaceContext: ActiveWorkspaceContext,
) {
  return activeWorkspaceContext.kind === 'project'
}

export function resolveAgentSessionControlPresentation({
  activeProject,
  activeSelection,
  activeWorkspaceContext,
  projectSessions,
  request,
  runtime,
  sessions,
}: {
  activeProject: ProjectRecord | null
  activeSelection: AgentSessionSelection
  activeWorkspaceContext: ActiveWorkspaceContext
  projectSessions: Readonly<Record<string, AgentProjectSessionBucket>>
  request: AgentProjectSessionRequest | null | undefined
  runtime: Pick<AgentRuntimeState, 'agentId' | 'workspacePath'>
  sessions: readonly AgentSessionListItem[]
}) {
  const target = resolveAgentSessionControlTarget(
    request,
    activeWorkspaceContext,
    activeSelection,
  )
  if (
    activeWorkspaceContext.kind !== 'project'
    || target.selection.kind === 'new'
    || target.label
  ) {
    return target
  }

  const targetSelection = target.selection
  const projectSession = activeProject
    ? findAgentProjectSession(
        projectSessions[activeProject.id],
        targetSelection.agentId,
        targetSelection.sessionPath,
      )
    : null
  const runtimeOwnsTargetProject = Boolean(
    activeProject
    && runtime.agentId === targetSelection.agentId
    && runtime.workspacePath
    && normalizeAgentProjectPath(runtime.workspacePath)
      === normalizeAgentProjectPath(activeProject.path),
  )
  const runtimeSession = runtimeOwnsTargetProject
    ? sessions.find((session) => session.path === targetSelection.sessionPath) ?? null
    : null
  const targetSession = projectSession ?? runtimeSession

  return {
    ...target,
    label: targetSession ? formatAgentSessionLabel(targetSession) : '未命名会话',
  }
}

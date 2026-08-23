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
import type {
  ActiveWorkspaceContext,
  ConversationStatus,
} from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'

// Navigation can advance the visible target before the workspace runtime catches
// up. Runtime-dependent actions are safe only when both identities agree.
export function isAgentVisibleWorkspaceOperational({
  isWorkspaceContextPreparing,
  operationalWorkspacePath,
  visibleWorkspacePath,
}: {
  isWorkspaceContextPreparing: boolean
  operationalWorkspacePath: string | null
  visibleWorkspacePath: string | null
}) {
  return Boolean(
    !isWorkspaceContextPreparing
    && operationalWorkspacePath
    && visibleWorkspacePath
    && normalizeAgentProjectPath(operationalWorkspacePath)
      === normalizeAgentProjectPath(visibleWorkspacePath),
  )
}

export function resolveAgentComposerWorkspacePresentation({
  isWorkspaceContextPreparing,
  operationalWorkspacePath,
  visibleWorkspacePath,
}: {
  isWorkspaceContextPreparing: boolean
  operationalWorkspacePath: string | null
  visibleWorkspacePath: string | null
}) {
  const canUseOperationalWorkspace = isAgentVisibleWorkspaceOperational({
    isWorkspaceContextPreparing,
    operationalWorkspacePath,
    visibleWorkspacePath,
  })

  return {
    canUseOperationalWorkspace,
    mentionWorkspacePath: canUseOperationalWorkspace ? operationalWorkspacePath : null,
    placeholder: visibleWorkspacePath
      ? '发送消息，输入 @ 来提及文件…'
      : '发送消息…',
  }
}

export function shouldShowAgentNewConversationPrompt(
  activeWorkspaceContext: ActiveWorkspaceContext,
  selection: AgentSessionSelection,
) {
  return selection.kind === 'new' && activeWorkspaceContext.kind !== 'conversation'
}

export function shouldRetainNewConversationSurfaceDuringSubmission({
  activeWorkspaceContext,
  conversationStatus,
  hasVisibleNativeSession,
  isSubmitting,
}: {
  activeWorkspaceContext: ActiveWorkspaceContext
  conversationStatus: ConversationStatus | null
  hasVisibleNativeSession: boolean
  isSubmitting: boolean
}) {
  if (!isSubmitting) return false
  if (activeWorkspaceContext.kind === 'conversationDraft') return true
  if (activeWorkspaceContext.kind !== 'conversation') return false

  return conversationStatus !== 'active' || !hasVisibleNativeSession
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

export function shouldShowAgentSessionLoadingIndicator({
  hasVisibleSessionContent,
  isImmediateNewConversationSurface,
  isSessionContentLoading,
  showDelayedLoadingIndicator,
}: {
  hasVisibleSessionContent: boolean
  isImmediateNewConversationSurface: boolean
  isSessionContentLoading: boolean
  showDelayedLoadingIndicator: boolean
}) {
  return !isImmediateNewConversationSurface
    && isSessionContentLoading
    && (!hasVisibleSessionContent || showDelayedLoadingIndicator)
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

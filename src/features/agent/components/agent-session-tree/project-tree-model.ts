import type { AgentId } from '@/features/agent/agent-definition'
import {
  getAgentSessionTreeKey,
  selectVisibleAgentProjectSessions,
  summarizeAgentProjectSessionBucket,
  type AgentProjectSessionBucket,
  type AgentSessionTreeItem,
} from '@/features/agent/lib/session-tree'
import type { ConversationRecord } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'
import {
  resolveAgentSessionTreeStatus,
  type AgentSessionTreeStatus,
} from './status-model'
import type { VirtualizedTreeRowAriaMetadata } from './virtualized-tree-list'

type AgentProjectTreeRowContent =
  | {
      key: 'section:projects'
      kind: 'project-section-header'
    }
  | {
      key: 'status:projects-empty'
      kind: 'project-empty'
    }
  | {
      isExpanded: boolean
      isSessionLoadActive: boolean
      key: string
      kind: 'project'
      project: ProjectRecord
    }
  | {
      key: string
      kind: 'project-session-status'
      project: ProjectRecord
      status: AgentSessionTreeStatus
    }
  | {
      key: string
      kind: 'project-session'
      project: ProjectRecord
      session: AgentSessionTreeItem
    }
  | {
      key: 'section:conversations'
      kind: 'conversation-section-header'
    }
  | {
      key: 'status:conversations-empty'
      kind: 'conversation-empty'
    }
  | {
      conversation: ConversationRecord
      key: string
      kind: 'conversation'
    }

export type AgentProjectTreeRow = AgentProjectTreeRowContent & {
  aria: VirtualizedTreeRowAriaMetadata
}

type CreateAgentProjectTreeRowsOptions = {
  conversations: readonly ConversationRecord[]
  expandedProjectIds: ReadonlySet<string>
  isConversationSectionExpanded: boolean
  isFloating: boolean
  isProjectSectionExpanded: boolean
  projectSessions: Readonly<Record<string, AgentProjectSessionBucket>>
  projects: readonly ProjectRecord[]
  sessionTreeAgentIds: readonly AgentId[]
}

export function getAgentProjectRowKey(projectId: string) {
  return `project:${projectId}`
}

export function getAgentProjectSessionRowKey(
  projectId: string,
  agentId: AgentId,
  sessionPath: string,
) {
  return `${getAgentProjectRowKey(projectId)}:session:${getAgentSessionTreeKey(agentId, sessionPath)}`
}

export function getAgentConversationRowKey(conversationId: string) {
  return `conversation:${conversationId}`
}

/**
 * A matching filesystem path is not enough to make a project switch settled.
 * The path is committed before Agent session restoration finishes, so another
 * click in that window must replace the pending project navigation request
 * instead of bypassing it through the in-place session path.
 */
export function canOpenAgentProjectSessionInPlace(
  isCurrentProjectWorkspace: boolean,
  isWorkspaceContextPreparing: boolean,
) {
  return isCurrentProjectWorkspace && !isWorkspaceContextPreparing
}

function getSortableConversationTimestamp(conversation: ConversationRecord) {
  const timestamp = Date.parse(conversation.updatedAt)
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function createAgentProjectTreeRows({
  conversations,
  expandedProjectIds,
  isConversationSectionExpanded,
  isFloating,
  isProjectSectionExpanded,
  projectSessions,
  projects,
  sessionTreeAgentIds,
}: CreateAgentProjectTreeRowsOptions): AgentProjectTreeRow[] {
  const rows: AgentProjectTreeRow[] = []
  const projectLevel = isFloating ? 1 : 2
  const projectSessionLevel = isFloating ? 2 : 3
  const topLevelSize = isFloating
    ? (isProjectSectionExpanded ? Math.max(projects.length, 1) : 0) + 1
    : 2

  if (!isFloating) {
    rows.push({
      aria: { level: 1, positionInSet: 1, setSize: 2 },
      key: 'section:projects',
      kind: 'project-section-header',
    })
  }

  if (isProjectSectionExpanded) {
    if (projects.length === 0) {
      rows.push({
        aria: {
          level: projectLevel,
          positionInSet: 1,
          setSize: isFloating ? topLevelSize : 1,
        },
        key: 'status:projects-empty',
        kind: 'project-empty',
      })
    }

    for (const [projectIndex, project] of projects.entries()) {
      const bucket = projectSessions[project.id]
      const isExpanded = expandedProjectIds.has(project.id)
      const loadSummary = summarizeAgentProjectSessionBucket(bucket, sessionTreeAgentIds)
      const isSessionListPending = !loadSummary.hasLoaded || loadSummary.isLoading

      rows.push({
        aria: {
          level: projectLevel,
          positionInSet: projectIndex + 1,
          setSize: isFloating ? topLevelSize : projects.length,
        },
        isExpanded,
        isSessionLoadActive: loadSummary.isLoading || (isExpanded && !loadSummary.hasLoaded),
        key: getAgentProjectRowKey(project.id),
        kind: 'project',
        project,
      })

      if (!isExpanded) continue

      const sessions = selectVisibleAgentProjectSessions(bucket)
      const status = resolveAgentSessionTreeStatus({
        errorCount: loadSummary.errors.length,
        hasCompleteSnapshot: loadSummary.hasCompleteSnapshot,
        isPending: isSessionListPending,
        sessionCount: sessions.length,
      })
      const childCount = sessions.length + (status ? 1 : 0)

      if (status) {
        rows.push({
          aria: { level: projectSessionLevel, positionInSet: 1, setSize: childCount },
          key: `${getAgentProjectRowKey(project.id)}:status:${status}`,
          kind: 'project-session-status',
          project,
          status,
        })
      }

      for (const [sessionIndex, session] of sessions.entries()) {
        rows.push({
          aria: {
            level: projectSessionLevel,
            positionInSet: sessionIndex + (status ? 2 : 1),
            setSize: childCount,
          },
          key: getAgentProjectSessionRowKey(project.id, session.agentId, session.path),
          kind: 'project-session',
          project,
          session,
        })
      }
    }
  }

  rows.push({
    aria: {
      level: 1,
      positionInSet: isFloating ? topLevelSize : 2,
      setSize: topLevelSize,
    },
    key: 'section:conversations',
    kind: 'conversation-section-header',
  })

  if (isConversationSectionExpanded) {
    const visibleConversations = Array.from(conversations)
      .filter((conversation) => conversation.status === 'active')
      .sort((left, right) => (
        getSortableConversationTimestamp(right) - getSortableConversationTimestamp(left)
      ))

    if (visibleConversations.length === 0) {
      rows.push({
        aria: { level: 2, positionInSet: 1, setSize: 1 },
        key: 'status:conversations-empty',
        kind: 'conversation-empty',
      })
    } else {
      for (const [conversationIndex, conversation] of visibleConversations.entries()) {
        rows.push({
          aria: {
            level: 2,
            positionInSet: conversationIndex + 1,
            setSize: visibleConversations.length,
          },
          conversation,
          key: getAgentConversationRowKey(conversation.id),
          kind: 'conversation',
        })
      }
    }
  }

  return rows
}

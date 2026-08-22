import { describe, expect, it } from 'vitest'
import {
  canOpenAgentProjectSessionInPlace,
  createAgentProjectTreeRows,
  getAgentConversationRowKey,
  getAgentProjectRowKey,
  getAgentProjectSessionRowKey,
} from '@/features/agent/components/agent-session-tree/project-tree-model'
import type {
  AgentProjectSessionBucket,
  AgentSessionSourceState,
} from '@/features/agent/lib/session-tree'
import type { ConversationRecord } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'

const project: ProjectRecord = {
  addedAt: '2026-08-01T00:00:00.000Z',
  id: 'project-1',
  lastFilePath: null,
  lastOpenedAt: '2026-08-01T00:00:00.000Z',
  name: 'Aryn',
  path: 'C:\\workspace\\Aryn',
}

const loadedBucket: AgentProjectSessionBucket = {
  hasCompleteSnapshot: true,
  sources: {
    codex: {
      error: null,
      hasLoaded: true,
      isLoading: false,
      sessions: [{
        createdAt: '2026-08-01T00:00:00.000Z',
        id: 'session-1',
        messageCount: 3,
        modifiedAt: '2026-08-01T01:00:00.000Z',
        name: 'Virtualize tree',
        path: 'session-1',
        preview: 'Virtualize tree',
      }],
    },
  },
}

function conversation(
  id: string,
  updatedAt: string,
  status: ConversationRecord['status'] = 'active',
): ConversationRecord {
  return {
    agentId: 'codex',
    agentSessionPath: null,
    createdAt: updatedAt,
    id,
    lastMessagePreview: null,
    status,
    title: id,
    titleSource: 'user',
    updatedAt,
    workspacePath: null,
  }
}

describe('Agent project tree row model', () => {
  it('routes session clicks through project navigation until the runtime context is ready', () => {
    expect(canOpenAgentProjectSessionInPlace(true, false)).toBe(true)
    expect(canOpenAgentProjectSessionInPlace(true, true)).toBe(false)
    expect(canOpenAgentProjectSessionInPlace(false, false)).toBe(false)
  })

  it('flattens expanded project sessions and active conversations into stable rows', () => {
    const conversations = [
      conversation('older', '2026-08-01T01:00:00.000Z'),
      conversation('removed', '2026-08-01T03:00:00.000Z', 'removed'),
      conversation('newer', '2026-08-01T02:00:00.000Z'),
    ]
    const rows = createAgentProjectTreeRows({
      conversations,
      expandedProjectIds: new Set([project.id]),
      isConversationSectionExpanded: true,
      isFloating: false,
      isProjectSectionExpanded: true,
      projectSessions: { [project.id]: loadedBucket },
      projects: [project],
      sessionTreeAgentIds: ['codex'],
    })

    expect(rows.map((row) => row.kind)).toEqual([
      'project-section-header',
      'project',
      'project-session',
      'conversation-section-header',
      'conversation',
      'conversation',
    ])
    expect(rows.map((row) => row.key)).toEqual([
      'section:projects',
      getAgentProjectRowKey(project.id),
      getAgentProjectSessionRowKey(project.id, 'codex', 'session-1'),
      'section:conversations',
      getAgentConversationRowKey('newer'),
      getAgentConversationRowKey('older'),
    ])
    expect(rows.map((row) => row.aria)).toEqual([
      { level: 1, positionInSet: 1, setSize: 2 },
      { level: 2, positionInSet: 1, setSize: 1 },
      { level: 3, positionInSet: 1, setSize: 1 },
      { level: 1, positionInSet: 2, setSize: 2 },
      { level: 2, positionInSet: 1, setSize: 2 },
      { level: 2, positionInSet: 2, setSize: 2 },
    ])
    expect(conversations.map((item) => item.id)).toEqual(['older', 'removed', 'newer'])
  })

  it('keeps collapsed descendants out of the virtual row set and exposes empty states', () => {
    const collapsedRows = createAgentProjectTreeRows({
      conversations: [],
      expandedProjectIds: new Set([project.id]),
      isConversationSectionExpanded: false,
      isFloating: false,
      isProjectSectionExpanded: false,
      projectSessions: { [project.id]: loadedBucket },
      projects: [project],
      sessionTreeAgentIds: ['codex'],
    })

    expect(collapsedRows.map((row) => row.kind)).toEqual([
      'project-section-header',
      'conversation-section-header',
    ])

    const emptyRows = createAgentProjectTreeRows({
      conversations: [],
      expandedProjectIds: new Set(),
      isConversationSectionExpanded: true,
      isFloating: false,
      isProjectSectionExpanded: true,
      projectSessions: {},
      projects: [],
      sessionTreeAgentIds: ['codex'],
    })

    expect(emptyRows.map((row) => row.kind)).toEqual([
      'project-section-header',
      'project-empty',
      'conversation-section-header',
      'conversation-empty',
    ])
  })

  it('does not materialize or sort cached sessions for collapsed projects', () => {
    let sessionReads = 0
    const sourceState = {
      error: null,
      hasLoaded: true,
      isLoading: false,
    } as AgentSessionSourceState
    Object.defineProperty(sourceState, 'sessions', {
      enumerable: true,
      get() {
        sessionReads += 1
        return loadedBucket.sources.codex?.sessions ?? []
      },
    })

    createAgentProjectTreeRows({
      conversations: [],
      expandedProjectIds: new Set(),
      isConversationSectionExpanded: false,
      isFloating: false,
      isProjectSectionExpanded: true,
      projectSessions: {
        [project.id]: {
          hasCompleteSnapshot: true,
          sources: { codex: sourceState },
        },
      },
      projects: [project],
      sessionTreeAgentIds: ['codex'],
    })

    expect(sessionReads).toBe(0)
  })

  it('creates one model row per visible item with unique keys at large scale', () => {
    const conversations = Array.from({ length: 10_000 }, (_, index) => (
      conversation(`conversation-${index}`, new Date(index * 1_000).toISOString())
    ))
    const rows = createAgentProjectTreeRows({
      conversations,
      expandedProjectIds: new Set(),
      isConversationSectionExpanded: true,
      isFloating: false,
      isProjectSectionExpanded: true,
      projectSessions: {},
      projects: [],
      sessionTreeAgentIds: ['codex'],
    })

    expect(rows).toHaveLength(10_003)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})

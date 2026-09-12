import React, { createContext, useContext } from 'react'
import { AgentSessionTreeView } from '@/features/agent/components/agent-session-tree/agent-session-tree'

// Only replace agent I/O. The Duo list, tree, rows, actions and menus are real.
const Context = createContext(null)
const noop = () => {}
const sessions = ['测试对话', '第二个对话'].map((name, index) => ({
  id: String(index), name, path: `/qa/session-${index}.jsonl`, preview: name,
  messageCount: 2, createdAt: '2026-09-12T00:00:00Z', modifiedAt: '2026-09-12T00:00:00Z',
}))

export function AgentProvider(props) {
  const project = props.projectState.projects[0]
  const controller = {
    ...props,
    activeSessionPath: null, activeSessionSelection: { kind: 'new' },
    agentState: { sessions: [] }, conversationState: { version: 3, conversations: [] },
    deletingSessionPath: null, isWorkspaceContextPreparing: false,
    handleDeleteSession: async () => {}, handleOpenSession: async () => {},
    handlePrefetchSession: noop, handleRenameSession: async () => {},
    loadProjectSessions: noop, selectedAgentId: 'builtin-pi',
    sessionTreeAgentIds: ['builtin-pi'], sessionActivityById: {},
    projectSessions: { [project.id]: { hasCompleteSnapshot: true, sources: {
      'builtin-pi': { error: null, hasLoaded: true, isLoading: false, sessions },
    } } },
  }
  return <Context.Provider value={controller}>{props.children}</Context.Provider>
}

export function AgentSessionTree(props) {
  return <AgentSessionTreeView {...props} controller={useContext(Context)} />
}

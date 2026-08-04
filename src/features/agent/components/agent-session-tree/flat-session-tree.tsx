import { useEffect, useState } from 'react'
import { EditLine } from '@mingcute/react'
import {
  TreeList,
  TreeScrollArea,
} from '@/components/tree'
import {
  formatAgentSessionLabel,
  getAgentSessionActivityKey,
  getAgentSessionTreeKey,
  normalizeAgentProjectPath,
  selectVisibleAgentProjectSessions,
  summarizeAgentProjectSessionBucket,
  type AgentSessionTreeItem,
} from '@/features/agent/lib/session-tree'
import { AgentSessionTreeRow } from './session-row'
import {
  AgentSessionTreeStatusItem,
  resolveAgentSessionTreeStatus,
} from './status-item'
import type { AgentSessionTreeViewProps } from './types'

export function FlatAgentSessionTree({
  className,
  controller,
  onRequestClose,
  id = 'agent-session-tree',
  isFloating,
  menuPortalTarget,
}: AgentSessionTreeViewProps) {
  const {
    activeSessionPath,
    activeSessionSelection,
    agentState,
    deletingSessionPath,
    handleDeleteSession,
    handleOpenSession,
    handleRenameSession,
    handleStartNewSession,
    loadProjectSessions,
    projectSessions,
    projectState,
    selectedAgentId,
    sessionActivityById,
    sessionTreeAgentIds,
    workspacePath,
  } = controller
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null)
  const currentProject = workspacePath
    ? projectState.projects.find((project) => (
        normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(workspacePath)
      )) ?? null
    : null
  const currentProjectBucket = currentProject ? projectSessions[currentProject.id] : undefined
  const loadSummary = summarizeAgentProjectSessionBucket(currentProjectBucket, sessionTreeAgentIds)
  const hasCompleteSessionSnapshot = currentProject ? loadSummary.hasCompleteSnapshot : true
  const sessions = currentProject
    ? selectVisibleAgentProjectSessions(currentProjectBucket)
    : agentState.sessions.map((session): AgentSessionTreeItem => ({ ...session, agentId: selectedAgentId }))
  const isSessionListPending = Boolean(currentProject && (!loadSummary.hasLoaded || loadSummary.isLoading))
  const sessionTreeStatus = resolveAgentSessionTreeStatus({
    errorCount: loadSummary.errors.length,
    hasCompleteSnapshot: hasCompleteSessionSnapshot,
    isPending: isSessionListPending,
    sessionCount: sessions.length,
  })

  useEffect(() => {
    if (currentProject) void loadProjectSessions(currentProject)
  }, [currentProject, loadProjectSessions])

  return (
    <div className={`agent-session-tree-shell${className ? ` ${className}` : ''}`}>
      {!isFloating ? (
        <button
          type='button'
          disabled={!workspacePath}
          className='agent-session-new-button'
          aria-label='Start new conversation'
          onClick={() => {
            handleStartNewSession()
            onRequestClose?.()
          }}
        >
          <EditLine />
          <span>新对话</span>
        </button>
      ) : null}

      <TreeScrollArea
        className='agent-session-tree-scroll'
        contentClassName='agent-session-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <TreeList
          id={id}
          className='agent-project-list agent-flat-session-list'
          aria-busy={isSessionListPending || undefined}
          aria-label='Agent sessions'
        >
          {sessionTreeStatus === 'loading' ? (
            <AgentSessionTreeStatusItem
              label='正在加载会话…'
              status='loading'
            />
          ) : null}
          {sessionTreeStatus === 'error' ? (
            <AgentSessionTreeStatusItem label='部分 Agent 会话加载失败，重新打开可重试' status='error' />
          ) : null}
          {sessionTreeStatus === 'empty' ? (
            <AgentSessionTreeStatusItem label='暂无对话' status='empty' />
          ) : sessions.map((session) => {
            const label = formatAgentSessionLabel(session)
            const sessionKey = getAgentSessionTreeKey(session.agentId, session.path)
            const isActiveSession = activeSessionSelection.kind === 'session'
              && activeSessionSelection.agentId === session.agentId
              && activeSessionPath === session.path

            return (
              <AgentSessionTreeRow
                activity={sessionActivityById[getAgentSessionActivityKey(session.agentId, session.path)]}
                agentId={session.agentId}
                key={sessionKey}
                isActive={isActiveSession}
                isDeleting={deletingSessionPath === sessionKey}
                isRenaming={renamingSessionPath === sessionKey}
                label={label}
                menuPortalTarget={menuPortalTarget}
                onCancelRename={() => setRenamingSessionPath(null)}
                onDelete={() => {
                  if (workspacePath) void handleDeleteSession(workspacePath, session.agentId, session.path)
                }}
                onOpen={() => {
                  setRenamingSessionPath(null)
                  void handleOpenSession(session.agentId, session.path).then(() => {
                    onRequestClose?.()
                  })
                }}
                onRename={(name) => workspacePath
                  ? handleRenameSession(workspacePath, session.agentId, session.path, name)
                  : Promise.resolve()}
                onRequestRename={() => setRenamingSessionPath(sessionKey)}
              />
            )
          })}
        </TreeList>
      </TreeScrollArea>
    </div>
  )
}

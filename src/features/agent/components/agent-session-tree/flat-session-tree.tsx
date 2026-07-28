import { useEffect, useState } from 'react'
import { EditLine } from '@mingcute/react'
import {
  TreeList,
  TreeScrollArea,
  TreeStatusItem,
} from '@/components/tree'
import {
  flattenAgentProjectSessions,
  formatAgentSessionLabel,
  getAgentSessionActivityKey,
  getAgentSessionTreeKey,
  normalizeAgentProjectPath,
  summarizeAgentProjectSessionBucket,
  type AgentSessionTreeItem,
} from '@/features/agent/lib/session-tree'
import { AgentSessionTreeRow } from './session-row'
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
  const sessions = currentProject
    ? flattenAgentProjectSessions(currentProjectBucket)
    : agentState.sessions.map((session): AgentSessionTreeItem => ({ ...session, agentId: selectedAgentId }))
  const loadSummary = summarizeAgentProjectSessionBucket(currentProjectBucket, sessionTreeAgentIds)
  const isSessionListLoading = Boolean(currentProject && (!loadSummary.hasLoaded || loadSummary.isLoading))

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
          <EditLine size={16} />
          <span>新对话</span>
        </button>
      ) : null}

      <TreeScrollArea
        className='agent-session-tree-scroll'
        contentClassName='agent-session-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <TreeList id={id} className='agent-project-list agent-flat-session-list' aria-label='Agent sessions'>
          {isSessionListLoading ? <TreeStatusItem>加载中</TreeStatusItem> : null}
          {loadSummary.errors.length > 0 ? <TreeStatusItem tone='danger'>部分 Agent 无法加载</TreeStatusItem> : null}
          {!isSessionListLoading && sessions.length === 0 ? (
            <TreeStatusItem>暂无对话</TreeStatusItem>
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

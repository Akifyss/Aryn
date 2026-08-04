import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AddLine,
  EditLine,
  More1Line,
} from '@mingcute/react'
import {
  AppItem,
  AppItemActionButton,
  AppItemMainButton,
  type AppItemMainRenderer,
} from '@/components/app-item'
import { AppMenu as Menu } from '@/components/app-menu'
import { AppTooltipButton } from '@/components/app-tooltip'
import { ProjectIcon } from '@/components/project-icon'
import {
  TreeChildren,
  TreeList,
  TreeScrollArea,
  TreeSection,
  TreeStatusItem,
} from '@/components/tree'
import {
  flattenAgentProjectSessions,
  formatAgentSessionLabel,
  formatAgentSessionRelativeTime,
  getAgentSessionActivityKey,
  getAgentSessionTreeKey,
  normalizeAgentProjectPath,
  summarizeAgentProjectSessionBucket,
} from '@/features/agent/lib/session-tree'
import type { ConversationRecord } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'
import { AgentSessionTreeLoadIndicator } from './load-indicator'
import {
  AgentProjectContextMenuPopup,
  AgentProjectMenuPopup,
} from './menus'
import { AgentSessionTreeRow } from './session-row'
import type { AgentSessionTreeViewProps } from './types'

function AgentConversationRow({
  activity,
  conversation,
  isDeleting,
  isRenaming,
  isActive,
  menuPortalTarget,
  onOpen,
  onCancelRename,
  onDelete,
  onRename,
  onRequestRename,
}: {
  activity?: 'running' | 'waiting'
  conversation: ConversationRecord
  isDeleting: boolean
  isRenaming: boolean
  isActive: boolean
  menuPortalTarget?: HTMLElement | null
  onOpen: () => void
  onCancelRename: () => void
  onDelete: () => void
  onRename: (name: string) => Promise<void>
  onRequestRename: () => void
}) {
  const relativeTime = formatAgentSessionRelativeTime(conversation.updatedAt)

  return (
    <AgentSessionTreeRow
      activity={activity}
      agentId={conversation.agentId}
      isActive={isActive}
      isDeleting={isDeleting}
      isRenaming={isRenaming}
      label={conversation.title}
      menuPortalTarget={menuPortalTarget}
      menuTitle='更多'
      itemClassName='agent-conversation-node'
      relativeTime={relativeTime}
      rowClassName='agent-conversation-row'
      onCancelRename={onCancelRename}
      onDelete={onDelete}
      onOpen={onOpen}
      onRename={onRename}
      onRequestRename={onRequestRename}
    />
  )
}

export function AgentProjectTree({
  className,
  controller,
  onRequestClose,
  onOpenProjectAddMenu: onOpenProjectAddMenuOverride,
  isFloating,
  isProjectAddMenuOpen: isProjectAddMenuOpenOverride,
  menuPortalTarget,
}: AgentSessionTreeViewProps) {
  const {
    activeWorkspaceContext,
    activeSessionPath,
    activeSessionSelection,
    conversationState,
    deletingSessionPath,
    handleDeleteSession,
    handleOpenSession,
    handleRenameSession,
    loadProjectSessions,
    onOpenProjectAddMenu,
    onOpenConversation,
    onRenameConversation,
    onRemoveConversation,
    onOpenProjectFolder,
    onOpenProjectSession,
    onRemoveProject,
    onStartStandaloneConversation,
    onStartProjectSession,
    projectSessions,
    projectState,
    sessionActivityById,
    sessionTreeAgentIds,
    isProjectAddMenuOpen: contextIsProjectAddMenuOpen,
    workspacePath,
  } = controller
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(() => new Set())
  const [isProjectSectionExpanded, setIsProjectSectionExpanded] = useState(true)
  const [isConversationSectionExpanded, setIsConversationSectionExpanded] = useState(true)
  const [openProjectMenuId, setOpenProjectMenuId] = useState<string | null>(null)
  const [renamingSessionPath, setRenamingSessionPath] = useState<string | null>(null)
  const [renamingConversationId, setRenamingConversationId] = useState<string | null>(null)
  const [deletingConversationId, setDeletingConversationId] = useState<string | null>(null)
  const projectRecordsRef = useRef(projectState.projects)
  projectRecordsRef.current = projectState.projects
  const isProjectAddMenuOpen = isProjectAddMenuOpenOverride ?? contextIsProjectAddMenuOpen
  const activeSessionProjectId = useMemo(() => {
    if (activeSessionSelection.kind !== 'session' || !activeSessionPath) {
      return null
    }

    for (const [projectId, bucket] of Object.entries(projectSessions)) {
      if (flattenAgentProjectSessions(bucket).some((session) => (
        session.agentId === activeSessionSelection.agentId
        && session.path === activeSessionPath
      ))) {
        return projectId
      }
    }

    return null
  }, [activeSessionPath, activeSessionSelection, projectSessions])
  const visibleConversations = useMemo(() => (
    conversationState.conversations
      .filter((conversation) => conversation.status === 'active')
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  ), [conversationState.conversations])

  useEffect(() => {
    for (const projectId of expandedProjectIds) {
      const project = projectRecordsRef.current.find((candidate) => candidate.id === projectId)
      if (project) void loadProjectSessions(project)
    }
  }, [expandedProjectIds, loadProjectSessions])
  const activeProject = useMemo(() => {
    if (activeWorkspaceContext.kind === 'project') {
      return projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
    }

    return workspacePath
      ? projectState.projects.find((project) => (
          normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(workspacePath)
        )) ?? null
      : null
  }, [activeWorkspaceContext, projectState.projects, workspacePath])

  function handleProjectMenuOpenChange(projectId: string, open: boolean) {
    setOpenProjectMenuId((currentProjectId) => {
      if (open) {
        return projectId
      }

      return currentProjectId === projectId ? null : currentProjectId
    })
  }

  function startPrimaryNewConversation() {
    setOpenProjectMenuId(null)
    setRenamingConversationId(null)

    if (activeProject && onStartProjectSession) {
      void onStartProjectSession(activeProject)
    } else {
      void onStartStandaloneConversation?.()
    }

    onRequestClose?.()
  }

  useEffect(() => {
    if (!activeSessionProjectId) {
      return
    }

    setIsProjectSectionExpanded(true)
    setExpandedProjectIds((currentExpandedProjectIds) => {
      if (currentExpandedProjectIds.has(activeSessionProjectId)) {
        return currentExpandedProjectIds
      }

      const nextExpandedProjectIds = new Set(currentExpandedProjectIds)
      nextExpandedProjectIds.add(activeSessionProjectId)
      return nextExpandedProjectIds
    })
  }, [activeSessionProjectId])

  useEffect(() => {
    if (activeWorkspaceContext.kind === 'conversation') {
      setIsConversationSectionExpanded(true)
    }
  }, [activeWorkspaceContext])

  function toggleProjectSection() {
    setOpenProjectMenuId(null)
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    setIsProjectSectionExpanded((currentValue) => !currentValue)
  }

  function toggleConversationSection() {
    setOpenProjectMenuId(null)
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    setIsConversationSectionExpanded((currentValue) => !currentValue)
  }

  function toggleProject(projectId: string) {
    setOpenProjectMenuId(null)
    setRenamingSessionPath(null)
    setRenamingConversationId(null)

    setExpandedProjectIds((currentExpandedProjectIds) => {
      const nextExpandedProjectIds = new Set(currentExpandedProjectIds)
      if (nextExpandedProjectIds.has(projectId)) {
        nextExpandedProjectIds.delete(projectId)
      } else {
        nextExpandedProjectIds.add(projectId)
      }

      return nextExpandedProjectIds
    })
  }

  return (
    <div className={`agent-session-tree-shell agent-project-tree-shell${className ? ` ${className}` : ''}`}>
      {!isFloating ? (
        <AppTooltipButton
          type='button'
          className='agent-session-new-button'
          aria-label='Start new conversation'
          aria-keyshortcuts='Control+Alt+N'
          onClick={() => {
            startPrimaryNewConversation()
          }}
        >
          <EditLine />
          <span>新对话</span>
        </AppTooltipButton>
      ) : null}

      <TreeScrollArea
        className='agent-session-tree-scroll'
        contentClassName='agent-session-tree-scroll-content'
        viewportClassName='agent-session-tree-scroll-viewport'
      >
        <TreeList className='agent-session-section-stack' aria-label='项目与对话'>
          <TreeSection className={`agent-project-tree-section agent-project-section${isProjectSectionExpanded ? '' : ' is-collapsed'}${isFloating ? ' is-floating' : ''}`}>
            {!isFloating ? (
              <AppItem
                variant='header'
                itemClassName='agent-project-tree-header'
                label='项目'
                isExpanded={isProjectSectionExpanded}
                isMenuOpen={isProjectAddMenuOpen}
                actions={(
                  <AppItemActionButton
                    isActive={isProjectAddMenuOpen}
                    aria-label='添加项目'
                    title='添加项目'
                    onClick={(event) => {
                      const openProjectAddMenu = onOpenProjectAddMenuOverride ?? onOpenProjectAddMenu
                      openProjectAddMenu?.(event.currentTarget.getBoundingClientRect())
                    }}
                  >
                    <AddLine />
                  </AppItemActionButton>
                )}
                onToggle={toggleProjectSection}
              />
            ) : null}
            {isProjectSectionExpanded ? (
              <TreeList className='agent-project-list'>
                {projectState.projects.length === 0 ? (
                  <TreeStatusItem>暂无项目</TreeStatusItem>
                ) : projectState.projects.map((project) => {
                  const bucket = projectSessions[project.id]
                  const isExpanded = expandedProjectIds.has(project.id)
                  const sessions = flattenAgentProjectSessions(bucket)
                  const loadSummary = summarizeAgentProjectSessionBucket(bucket, sessionTreeAgentIds)
                  const showChildren = isExpanded && (
                    sessions.length > 0
                    || loadSummary.hasLoaded
                  )

                  const projectIcon = <ProjectIcon />
                  const renderProjectMain: AppItemMainRenderer = (content, mainProps) => {
                    const { className, hasDescription } = mainProps

                    return (
                      <Menu.Context.Root onOpenChange={(open) => handleProjectMenuOpenChange(project.id, open)}>
                        <Menu.Context.Trigger
                          aria-expanded={isExpanded}
                          aria-busy={loadSummary.isLoading || undefined}
                          render={<AppItemMainButton className={className} hasDescription={hasDescription} role='button' />}
                          title={project.path}
                          onClick={() => toggleProject(project.id)}
                        >
                          {content}
                        </Menu.Context.Trigger>
                        <AgentProjectContextMenuPopup
                          menuPortalTarget={menuPortalTarget}
                          onOpenFolder={() => {
                            void onOpenProjectFolder?.(project)
                          }}
                          onRemoveProject={() => {
                            void onRemoveProject?.(project)
                          }}
                        />
                      </Menu.Context.Root>
                    )
                  }
                  const projectRowActions = (
                    <>
                      <AppItemActionButton
                        aria-label={`Start new conversation in ${project.name}`}
                        title='新建对话'
                        onClick={() => {
                          setRenamingConversationId(null)
                          void onStartProjectSession?.(project)
                          onRequestClose?.()
                        }}
                      >
                        <EditLine />
                      </AppItemActionButton>
                      <Menu.Root modal={false} onOpenChange={(open) => handleProjectMenuOpenChange(project.id, open)}>
                        <Menu.Trigger
                          aria-label={`Open ${project.name} menu`}
                          render={<AppItemActionButton />}
                          title='更多'
                        >
                          <More1Line />
                        </Menu.Trigger>
                        <AgentProjectMenuPopup
                          menuPortalTarget={menuPortalTarget}
                          onOpenFolder={() => {
                            void onOpenProjectFolder?.(project)
                          }}
                          onRemoveProject={() => {
                            void onRemoveProject?.(project)
                          }}
                        />
                      </Menu.Root>
                    </>
                  )

                  return (
                    <AppItem
                      key={project.id}
                      itemClassName='agent-project-node'
                      rowClassName='agent-project-row'
                      isMenuOpen={openProjectMenuId === project.id}
                      after={showChildren ? (
                        <TreeChildren className='agent-project-session-children'>
                          <TreeList
                            className='agent-project-session-list'
                            aria-busy={loadSummary.isLoading || undefined}
                          >
                            {loadSummary.isLoading && loadSummary.hasLoaded && sessions.length === 0 ? (
                              <TreeStatusItem>正在重新加载会话…</TreeStatusItem>
                            ) : !loadSummary.isLoading && loadSummary.hasLoaded && sessions.length === 0 ? (
                              <TreeStatusItem tone={loadSummary.errors.length > 0 ? 'danger' : 'default'}>
                                {loadSummary.errors.length > 0 ? '会话加载失败，重新展开可重试' : '暂无对话'}
                              </TreeStatusItem>
                            ) : null}
                            {sessions.map((session) => {
                              const sessionKey = getAgentSessionTreeKey(session.agentId, session.path)
                              const isActiveSession = activeSessionSelection.kind === 'session'
                                && activeSessionSelection.agentId === session.agentId
                                && activeSessionPath === session.path
                              const isCurrentActiveProject = Boolean(
                                activeWorkspaceContext.kind === 'project'
                                && activeWorkspaceContext.projectId === project.id
                                && workspacePath
                                && normalizeAgentProjectPath(workspacePath) === normalizeAgentProjectPath(project.path),
                              )
                              const label = formatAgentSessionLabel(session)
                              const relativeTime = formatAgentSessionRelativeTime(session.modifiedAt)

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
                                  relativeTime={relativeTime}
                                  onDelete={() => {
                                    void handleDeleteSession(project.path, session.agentId, session.path)
                                  }}
                                  onOpen={() => {
                                    setRenamingSessionPath(null)
                                    setRenamingConversationId(null)
                                    const openSession = isCurrentActiveProject
                                      ? handleOpenSession(session.agentId, session.path)
                                      : onOpenProjectSession?.(project, session.agentId, session.path)
                                    void Promise.resolve(openSession).then(() => {
                                      onRequestClose?.()
                                    })
                                  }}
                                  onRename={(name) => handleRenameSession(project.path, session.agentId, session.path, name)}
                                  onRequestRename={() => setRenamingSessionPath(sessionKey)}
                                />
                              )
                            })}
                          </TreeList>
                        </TreeChildren>
                      ) : null}
                      icon={projectIcon}
                      label={project.name}
                      labelClassName='agent-project-row-label'
                      labelSuffix={(
                        <AgentSessionTreeLoadIndicator
                          errorCount={loadSummary.errors.length}
                          isLoading={loadSummary.isLoading}
                        />
                      )}
                      renderMain={renderProjectMain}
                      actions={projectRowActions}
                    />
                  )
                })}
              </TreeList>
            ) : null}
          </TreeSection>
          <TreeSection className={`agent-project-tree-section agent-conversation-section${isConversationSectionExpanded ? '' : ' is-collapsed'}`}>
            <AppItem
              variant='header'
              itemClassName='agent-project-tree-header agent-conversation-tree-header'
              label='对话'
              isExpanded={isConversationSectionExpanded}
              actions={(
                <AppItemActionButton
                  aria-label='新对话'
                  aria-keyshortcuts='Control+Alt+N'
                  title='新对话 Ctrl+Alt+N'
                  onClick={() => {
                    setRenamingConversationId(null)
                    void onStartStandaloneConversation?.()
                    onRequestClose?.()
                  }}
                >
                  <EditLine />
                </AppItemActionButton>
              )}
              onToggle={toggleConversationSection}
            />
            {isConversationSectionExpanded ? (
              <TreeList className='agent-project-session-list agent-conversation-list'>
                {visibleConversations.length === 0 ? (
                  <TreeStatusItem>暂无对话</TreeStatusItem>
                ) : visibleConversations.map((conversation) => (
                  <AgentConversationRow
                    activity={conversation.agentSessionPath
                      ? sessionActivityById[getAgentSessionActivityKey(conversation.agentId, conversation.agentSessionPath)]
                      : undefined}
                    key={conversation.id}
                    conversation={conversation}
                    isDeleting={deletingConversationId === conversation.id}
                    isRenaming={renamingConversationId === conversation.id}
                    isActive={activeWorkspaceContext.kind === 'conversation' && activeWorkspaceContext.conversationId === conversation.id}
                    menuPortalTarget={menuPortalTarget}
                    onCancelRename={() => setRenamingConversationId(null)}
                    onDelete={() => {
                      setDeletingConversationId(conversation.id)
                      void Promise.resolve(onRemoveConversation?.(conversation)).finally(() => {
                        setDeletingConversationId((currentId) => (
                          currentId === conversation.id ? null : currentId
                        ))
                      })
                    }}
                    onOpen={() => {
                      setRenamingSessionPath(null)
                      setRenamingConversationId(null)
                      void Promise.resolve(onOpenConversation?.(conversation)).then(() => {
                        onRequestClose?.()
                      })
                    }}
                    onRename={(title) => Promise.resolve(onRenameConversation?.(conversation, title))}
                    onRequestRename={() => setRenamingConversationId(conversation.id)}
                  />
                ))}
              </TreeList>
            ) : null}
          </TreeSection>
        </TreeList>
      </TreeScrollArea>
    </div>
  )
}

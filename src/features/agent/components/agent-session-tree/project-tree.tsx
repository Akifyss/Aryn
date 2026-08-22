import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
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
  findAgentProjectSessionProjectId,
  formatAgentSessionLabel,
  formatAgentSessionRelativeTime,
  getAgentSessionActivityKey,
  getAgentSessionTreeKey,
  normalizeAgentProjectPath,
  resolveAgentSessionTreeProject,
} from '@/features/agent/lib/session-tree'
import type { ConversationRecord } from '@/features/conversations/types'
import {
  AgentProjectContextMenuPopup,
  AgentProjectMenuPopup,
} from './menus'
import {
  canOpenAgentProjectSessionInPlace,
  createAgentProjectTreeRows,
  getAgentConversationRowKey,
  getAgentProjectRowKey,
  type AgentProjectTreeRow,
} from './project-tree-model'
import { AgentSessionTreeRow } from './session-row'
import { AgentSessionTreeStatusItem } from './status-item'
import type { AgentSessionTreeViewProps } from './types'
import {
  DEFAULT_AGENT_TREE_ROW_SIZE,
  VirtualizedAgentTreeList,
} from './virtualized-tree-list'

const AGENT_TREE_SECTION_START_SIZE = 40

function estimateAgentProjectTreeRowSize(row: AgentProjectTreeRow) {
  if (row.kind === 'conversation-section-header') return AGENT_TREE_SECTION_START_SIZE
  return DEFAULT_AGENT_TREE_ROW_SIZE
}

function getAgentProjectTreeRowClassName(row: AgentProjectTreeRow) {
  return [
    `is-${row.kind}`,
    (row.kind === 'project-session' || row.kind === 'project-session-status') && 'is-project-child',
    row.kind === 'conversation-section-header' && 'is-section-start',
  ].filter(Boolean).join(' ')
}

function getAgentProjectTreeRowAriaMetadata(row: AgentProjectTreeRow) {
  return row.aria
}

function isAgentProjectTreeRowFocusable(row: AgentProjectTreeRow) {
  return row.kind === 'project-section-header'
    || row.kind === 'project'
    || row.kind === 'project-session'
    || row.kind === 'conversation-section-header'
    || row.kind === 'conversation'
}

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
  onMenuOpenChange,
  onPrefetch,
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
  onMenuOpenChange: (open: boolean) => void
  onPrefetch?: () => void
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
      itemAs='div'
      label={conversation.title}
      menuPortalTarget={menuPortalTarget}
      menuTitle='更多'
      itemClassName='agent-conversation-node'
      relativeTime={relativeTime}
      rowClassName='agent-conversation-row'
      onCancelRename={onCancelRename}
      onDelete={onDelete}
      onMenuOpenChange={onMenuOpenChange}
      onOpen={onOpen}
      onPrefetch={onPrefetch}
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
  isFloating = false,
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
    handlePrefetchSession,
    handleRenameSession,
    isWorkspaceContextPreparing,
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
  const [menuPinnedRowKeys, setMenuPinnedRowKeys] = useState<Set<string>>(() => new Set())
  const isProjectAddMenuOpen = isProjectAddMenuOpenOverride ?? contextIsProjectAddMenuOpen
  const projectById = useMemo(() => new Map(
    projectState.projects.map((project) => [project.id, project]),
  ), [projectState.projects])
  const activeSessionProjectId = useMemo(() => {
    if (activeSessionSelection.kind !== 'session' || !activeSessionPath) return null

    return findAgentProjectSessionProjectId(
      projectSessions,
      activeSessionSelection.agentId,
      activeSessionPath,
    )
  }, [activeSessionPath, activeSessionSelection, projectSessions])
  const activeProject = useMemo(() => resolveAgentSessionTreeProject(
    projectState.projects,
    activeWorkspaceContext,
    workspacePath,
  ), [activeWorkspaceContext, projectState.projects, workspacePath])
  const treeRows = useMemo(() => createAgentProjectTreeRows({
    conversations: conversationState.conversations,
    expandedProjectIds,
    isConversationSectionExpanded,
    isFloating,
    isProjectSectionExpanded,
    projectSessions,
    projects: projectState.projects,
    sessionTreeAgentIds,
  }), [
    conversationState.conversations,
    expandedProjectIds,
    isConversationSectionExpanded,
    isFloating,
    isProjectSectionExpanded,
    projectSessions,
    projectState.projects,
    sessionTreeAgentIds,
  ])
  const activeRowKey = useMemo(() => {
    if (activeSessionSelection.kind === 'session' && activeSessionPath) {
      return treeRows.find((row) => (
        row.kind === 'project-session'
        && row.session.agentId === activeSessionSelection.agentId
        && row.session.path === activeSessionPath
      ))?.key ?? null
    }

    return activeWorkspaceContext.kind === 'conversation'
      ? getAgentConversationRowKey(activeWorkspaceContext.conversationId)
      : null
  }, [activeSessionPath, activeSessionSelection, activeWorkspaceContext, treeRows])
  const pinnedRowKeys = useMemo(() => {
    const nextPinnedRowKeys = new Set(menuPinnedRowKeys)

    if (isProjectAddMenuOpen) {
      nextPinnedRowKeys.add('section:projects')
    }

    if (openProjectMenuId) {
      nextPinnedRowKeys.add(getAgentProjectRowKey(openProjectMenuId))
    }

    for (const row of treeRows) {
      if (row.kind === 'project-session') {
        const sessionKey = getAgentSessionTreeKey(row.session.agentId, row.session.path)
        if (sessionKey === renamingSessionPath || sessionKey === deletingSessionPath) {
          nextPinnedRowKeys.add(row.key)
        }
      } else if (
        row.kind === 'conversation'
        && (row.conversation.id === renamingConversationId || row.conversation.id === deletingConversationId)
      ) {
        nextPinnedRowKeys.add(row.key)
      }
    }

    return nextPinnedRowKeys
  }, [
    deletingConversationId,
    deletingSessionPath,
    menuPinnedRowKeys,
    isProjectAddMenuOpen,
    openProjectMenuId,
    renamingConversationId,
    renamingSessionPath,
    treeRows,
  ])

  useEffect(() => {
    for (const projectId of expandedProjectIds) {
      const project = projectById.get(projectId)
      if (project) void loadProjectSessions(project)
    }
  }, [expandedProjectIds, loadProjectSessions, projectById])

  useEffect(() => {
    if (!activeSessionProjectId) return

    setIsProjectSectionExpanded(true)
    setExpandedProjectIds((currentExpandedProjectIds) => {
      if (currentExpandedProjectIds.has(activeSessionProjectId)) return currentExpandedProjectIds

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

  const handleRowMenuOpenChange = useCallback((rowKey: string, open: boolean) => {
    setMenuPinnedRowKeys((currentPinnedRowKeys) => {
      if (currentPinnedRowKeys.has(rowKey) === open) return currentPinnedRowKeys

      const nextPinnedRowKeys = new Set(currentPinnedRowKeys)
      if (open) {
        nextPinnedRowKeys.add(rowKey)
      } else {
        nextPinnedRowKeys.delete(rowKey)
      }
      return nextPinnedRowKeys
    })
  }, [])

  function handleProjectMenuOpenChange(projectId: string, open: boolean) {
    setOpenProjectMenuId((currentProjectId) => {
      if (open) return projectId
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

  function renderTreeRow(row: AgentProjectTreeRow) {
    if (row.kind === 'project-section-header') {
      return (
        <AppItem
          itemAs='div'
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
      )
    }

    if (row.kind === 'project-empty') {
      return <div className='tree-status-item'>暂无项目</div>
    }

    if (row.kind === 'project') {
      const { project } = row
      const renderProjectMain: AppItemMainRenderer = (content, mainProps) => {
        const { className: mainClassName, hasDescription } = mainProps

        return (
          <Menu.Context.Root onOpenChange={(open) => handleProjectMenuOpenChange(project.id, open)}>
            <Menu.Context.Trigger
              aria-expanded={row.isExpanded}
              aria-busy={row.isSessionLoadActive || undefined}
              render={<AppItemMainButton className={mainClassName} hasDescription={hasDescription} role='button' />}
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

      return (
        <AppItem
          itemAs='div'
          itemClassName='agent-project-node'
          rowClassName='agent-project-row'
          isMenuOpen={openProjectMenuId === project.id}
          icon={<ProjectIcon isOpen={row.isExpanded} />}
          label={project.name}
          labelClassName='agent-project-row-label'
          renderMain={renderProjectMain}
          actions={(
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
          )}
        />
      )
    }

    if (row.kind === 'project-session-status') {
      const label = row.status === 'loading'
        ? '正在加载会话…'
        : row.status === 'error'
          ? '部分 Agent 会话加载失败，重新展开可重试'
          : '暂无对话'

      return <AgentSessionTreeStatusItem itemAs='div' label={label} status={row.status} />
    }

    if (row.kind === 'project-session') {
      const { project, session } = row
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

      return (
        <AgentSessionTreeRow
          activity={sessionActivityById[getAgentSessionActivityKey(session.agentId, session.path)]}
          agentId={session.agentId}
          isActive={isActiveSession}
          isDeleting={deletingSessionPath === sessionKey}
          isRenaming={renamingSessionPath === sessionKey}
          itemAs='div'
          label={formatAgentSessionLabel(session)}
          menuPortalTarget={menuPortalTarget}
          onCancelRename={() => setRenamingSessionPath(null)}
          relativeTime={formatAgentSessionRelativeTime(session.modifiedAt)}
          onDelete={() => {
            void handleDeleteSession(project.path, session.agentId, session.path)
          }}
          onMenuOpenChange={(open) => handleRowMenuOpenChange(row.key, open)}
          onOpen={() => {
            setRenamingSessionPath(null)
            setRenamingConversationId(null)
            const openSession = canOpenAgentProjectSessionInPlace(
              isCurrentActiveProject,
              isWorkspaceContextPreparing,
            )
              ? handleOpenSession(session.agentId, session.path)
              : onOpenProjectSession?.(
                  project,
                  session.agentId,
                  session.path,
                  formatAgentSessionLabel(session),
                )
            void Promise.resolve(openSession).then(() => {
              onRequestClose?.()
            })
          }}
          onPrefetch={() => {
            handlePrefetchSession(project.path, session.agentId, session.path)
          }}
          onRename={(name) => handleRenameSession(project.path, session.agentId, session.path, name)}
          onRequestRename={() => setRenamingSessionPath(sessionKey)}
        />
      )
    }

    if (row.kind === 'conversation-section-header') {
      return (
        <AppItem
          itemAs='div'
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
      )
    }

    if (row.kind === 'conversation-empty') {
      return <AgentSessionTreeStatusItem itemAs='div' label='暂无对话' status='empty' />
    }

    const { conversation } = row
    const conversationWorkspacePath = conversation.workspacePath
    const conversationSessionPath = conversation.agentSessionPath
    const isActiveConversation = activeWorkspaceContext.kind === 'conversation'
      && activeWorkspaceContext.conversationId === conversation.id
    const isCurrentActiveConversationWorkspace = Boolean(
      isActiveConversation
      && workspacePath
      && conversationWorkspacePath
      && normalizeAgentProjectPath(workspacePath) === normalizeAgentProjectPath(conversationWorkspacePath),
    )
    return (
      <AgentConversationRow
        activity={conversation.agentSessionPath
          ? sessionActivityById[getAgentSessionActivityKey(conversation.agentId, conversation.agentSessionPath)]
          : undefined}
        conversation={conversation}
        isDeleting={deletingConversationId === conversation.id}
        isRenaming={renamingConversationId === conversation.id}
        isActive={isActiveConversation}
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
        onMenuOpenChange={(open) => handleRowMenuOpenChange(row.key, open)}
        onOpen={() => {
          setRenamingSessionPath(null)
          setRenamingConversationId(null)
          const openConversation = isCurrentActiveConversationWorkspace && conversationSessionPath
            ? handleOpenSession(conversation.agentId, conversationSessionPath)
            : onOpenConversation?.(conversation)
          void Promise.resolve(openConversation).then(() => {
            onRequestClose?.()
          })
        }}
        onPrefetch={conversationWorkspacePath && conversationSessionPath
          ? () => {
              handlePrefetchSession(
                conversationWorkspacePath,
                conversation.agentId,
                conversationSessionPath,
              )
            }
          : undefined}
        onRename={(title) => Promise.resolve(onRenameConversation?.(conversation, title))}
        onRequestRename={() => setRenamingConversationId(conversation.id)}
      />
    )
  }

  return (
    <div className={`agent-session-tree-shell agent-project-tree-shell${className ? ` ${className}` : ''}`}>
      {!isFloating ? (
        <AppTooltipButton
          type='button'
          className='agent-session-new-button'
          aria-label='Start new conversation'
          aria-keyshortcuts='Control+Alt+N'
          onClick={startPrimaryNewConversation}
        >
          <EditLine />
          <span>新对话</span>
        </AppTooltipButton>
      ) : null}

      <VirtualizedAgentTreeList
        activeRowKey={activeRowKey}
        ariaLabel='项目与对话'
        contentClassName='agent-session-tree-scroll-content'
        estimateRowSize={estimateAgentProjectTreeRowSize}
        getRowAriaMetadata={getAgentProjectTreeRowAriaMetadata}
        getRowClassName={getAgentProjectTreeRowClassName}
        isFloating={isFloating}
        isRowFocusable={isAgentProjectTreeRowFocusable}
        pinnedRowKeys={pinnedRowKeys}
        renderRow={renderTreeRow}
        rows={treeRows}
        scrollClassName='agent-session-tree-scroll'
        viewportClassName='agent-session-tree-scroll-viewport'
      />
    </div>
  )
}

import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ContextMenu } from '@base-ui/react/context-menu'
import { Menu } from '@base-ui/react/menu'
import { Spinner } from '@heroui/react'
import {
  AddLine,
  CheckLine,
  CloseLine,
  Delete2Line,
  DownLine,
  Edit2Line,
  EditLine,
  ExternalLinkLine,
  More1Line,
} from '@mingcute/react'
import { AppTooltipButton } from '@/components/app-tooltip'
import { ProjectIcon } from '@/components/project-icon'
import {
  TreeItemActionButton,
  TreeItemChildren,
  TreeItem,
  TreeItemIcon,
  TreeList,
  TreeSection,
  TreeStatusItem,
  TreeScrollArea,
  TreeItemMain,
  TreeItemMainButton,
  type TreeItemMainRenderer,
} from '@/components/tree'
import { getAgentDefinition, type AgentId } from '@/features/agent/agent-definition'
import { AgentBrandIcon } from '@/features/agent/components/agent-brand-icon/agent-brand-icon'
import type { AgentSessionSelection } from '@/features/agent/lib/project-session-request'
import {
  flattenAgentProjectSessions,
  formatAgentSessionLabel,
  formatAgentSessionRelativeTime,
  getAgentSessionActivityKey,
  getAgentSessionTreeKey,
  normalizeAgentProjectPath,
  summarizeAgentProjectSessionBucket,
  type AgentProjectSessionBucket,
  type AgentSessionTreeItem,
} from '@/features/agent/lib/session-tree'
import { getSystemFileManagerName } from '@/features/agent/lib/system-file-manager'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationState,
} from '@/features/conversations/types'
import type { ProjectRecord, ProjectState } from '@/features/workspace/types'
import './styles.css'

export type AgentMenuAnchorRect = Pick<
  DOMRect,
  'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'
>

export type AgentProjectSwitchMenuOptions = {
  startNewSession?: boolean
}

export type AgentSessionTreeProps = {
  className?: string
  onRequestClose?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  id?: string
  isFloating?: boolean
  isProjectAddMenuOpen?: boolean
  menuPortalTarget?: HTMLElement | null
}

export type AgentSessionTreeController = {
  activeWorkspaceContext: ActiveWorkspaceContext
  activeSessionPath: string | null
  activeSessionSelection: AgentSessionSelection
  agentState: AgentWorkspaceState
  conversationState: ConversationState
  deletingSessionPath: string | null
  handleDeleteSession: (rootPath: string, agentId: AgentId, sessionPath: string) => Promise<void>
  handleOpenSession: (agentId: AgentId, sessionPath: string) => Promise<void>
  handleRenameSession: (rootPath: string, agentId: AgentId, sessionPath: string, name: string) => Promise<void>
  handleStartNewSession: () => void
  isProjectAddMenuOpen: boolean
  loadProjectSessions: (project: ProjectRecord) => Promise<void>
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProjectFolder?: (project: ProjectRecord) => Promise<void> | void
  onOpenProjectSession?: (project: ProjectRecord, agentId: AgentId, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  projectSessions: Record<string, AgentProjectSessionBucket>
  projectState: ProjectState
  selectedAgentId: AgentId
  sessionActivityById: Record<string, 'running' | 'waiting'>
  sessionTreeAgentIds: readonly AgentId[]
  workspacePath: string | null
}

type AgentSessionTreeViewProps = AgentSessionTreeProps & {
  controller: AgentSessionTreeController
}

const AGENT_TREE_MENU_POSITIONER_PROPS = {
  className: 'agent-tree-menu-positioner',
  collisionAvoidance: { side: 'flip', align: 'shift', fallbackAxisSide: 'none' },
  collisionPadding: 8,
  positionMethod: 'fixed',
  side: 'bottom',
  sideOffset: 2,
} as const
type AgentTreeMenuItemComponent = typeof Menu.Item

function AgentTreeActionMenuItems({
  disabled,
  ItemComponent = Menu.Item,
  onDelete,
  onRename,
}: {
  disabled: boolean
  ItemComponent?: AgentTreeMenuItemComponent
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-session-tree-menu-item${highlighted ? ' is-highlighted' : ''}`
        )}
        disabled={disabled}
        label='重命名'
        render={<button type='button' />}
        onClick={onRename}
      >
        <Edit2Line size={16} />
        <span>重命名</span>
      </ItemComponent>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-session-tree-menu-item is-danger${highlighted ? ' is-highlighted' : ''}`
        )}
        disabled={disabled}
        label='删除'
        render={<button type='button' />}
        onClick={onDelete}
      >
        <Delete2Line size={16} />
        <span>删除</span>
      </ItemComponent>
    </>
  )
}

function AgentTreeMenuPopup({
  disabled,
  menuPortalTarget,
  onDelete,
  onRename,
}: {
  disabled: boolean
  menuPortalTarget?: HTMLElement | null
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <Menu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Positioner
        align='end'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Popup
          className='agent-session-tree-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentTreeActionMenuItems disabled={disabled} onDelete={onDelete} onRename={onRename} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function AgentTreeContextMenuPopup({
  disabled,
  menuPortalTarget,
  onDelete,
  onRename,
}: {
  disabled: boolean
  menuPortalTarget?: HTMLElement | null
  onDelete: () => void
  onRename: () => void
}) {
  return (
    <ContextMenu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <ContextMenu.Positioner
        align='start'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <ContextMenu.Popup
          className='agent-session-tree-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentTreeActionMenuItems
            disabled={disabled}
            ItemComponent={ContextMenu.Item}
            onDelete={onDelete}
            onRename={onRename}
          />
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  )
}

function AgentProjectMenuItems({
  ItemComponent = Menu.Item,
  onOpenFolder,
  onRemoveProject,
}: {
  ItemComponent?: AgentTreeMenuItemComponent
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  const systemFileManagerName = getSystemFileManagerName(window.appApi.platform)

  return (
    <>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-project-menu-item${highlighted ? ' is-highlighted' : ''}`
        )}
        label={`在${systemFileManagerName}中打开`}
        render={<button type='button' />}
        onClick={onOpenFolder}
      >
        <ExternalLinkLine size={16} />
        <span>在“{systemFileManagerName}”中打开</span>
      </ItemComponent>
      <ItemComponent
        nativeButton
        className={({ highlighted }) => (
          `agent-project-menu-item is-danger${highlighted ? ' is-highlighted' : ''}`
        )}
        label='移除'
        render={<button type='button' />}
        onClick={onRemoveProject}
      >
        <Delete2Line size={16} />
        <span>移除</span>
      </ItemComponent>
    </>
  )
}

function AgentProjectMenuPopup({
  menuPortalTarget,
  onOpenFolder,
  onRemoveProject,
}: {
  menuPortalTarget?: HTMLElement | null
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  return (
    <Menu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <Menu.Positioner
        align='end'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <Menu.Popup
          className='agent-project-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentProjectMenuItems onOpenFolder={onOpenFolder} onRemoveProject={onRemoveProject} />
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  )
}

function AgentProjectContextMenuPopup({
  menuPortalTarget,
  onOpenFolder,
  onRemoveProject,
}: {
  menuPortalTarget?: HTMLElement | null
  onOpenFolder: () => void
  onRemoveProject: () => void
}) {
  return (
    <ContextMenu.Portal
      className='agent-tree-menu-portal'
      container={menuPortalTarget ?? undefined}
    >
      <ContextMenu.Positioner
        align='start'
        {...AGENT_TREE_MENU_POSITIONER_PROPS}
      >
        <ContextMenu.Popup
          className='agent-project-menu agent-tree-context-menu'
          data-agent-tree-menu-root='true'
        >
          <AgentProjectMenuItems
            ItemComponent={ContextMenu.Item}
            onOpenFolder={onOpenFolder}
            onRemoveProject={onRemoveProject}
          />
        </ContextMenu.Popup>
      </ContextMenu.Positioner>
    </ContextMenu.Portal>
  )
}

function AgentSessionTreeRow({
  activity,
  agentId,
  isActive,
  isDeleting,
  isRenaming,
  label,
  menuPortalTarget,
  menuTitle = '更多',
  itemClassName,
  relativeTime,
  rowClassName,
  onOpen,
  onCancelRename,
  onDelete,
  onRename,
  onRequestRename,
}: {
  activity?: 'running' | 'waiting'
  agentId?: AgentId
  isActive: boolean
  isDeleting: boolean
  isRenaming: boolean
  label: string
  menuPortalTarget?: HTMLElement | null
  menuTitle?: string
  itemClassName?: string
  relativeTime?: string
  rowClassName?: string
  onOpen: () => void
  onCancelRename: () => void
  onDelete: () => void
  onRename: (name: string) => Promise<void>
  onRequestRename: () => void
}) {
  const [draftName, setDraftName] = useState(label)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false)
  const rowRef = useRef<HTMLDivElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const isMenuOpen = isActionMenuOpen || isContextMenuOpen
  const accessibleLabel = agentId ? `${label}，${getAgentDefinition(agentId).label}` : label
  const activityLabel = activity === 'waiting' ? '等待操作' : '运行中'
  const sessionInfo = !isRenaming
    ? activity === 'running'
      ? <Spinner
        aria-hidden='true'
        className='size-4 agent-session-running-spinner'
        color='current'
        size='sm'
      />
      : relativeTime
    : undefined

  useEffect(() => {
    if (!isRenaming) {
      setDraftName(label)
      setError(null)
      return
    }

    setDraftName(label)
  }, [isRenaming, label])

  useEffect(() => {
    if (!isRenaming) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      const input = renameInputRef.current
      if (!input) return

      input.focus()
      input.setSelectionRange(0, input.value.length)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [isRenaming])

  const handleSubmitRename = async (event?: FormEvent) => {
    event?.preventDefault()
    const nextName = draftName.trim()

    if (!nextName || nextName === label.trim()) {
      onCancelRename()
      return
    }

    try {
      setIsSubmitting(true)
      setError(null)
      await onRename(nextName)
      onCancelRename()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const rowMain = isRenaming ? (
    <TreeItemMain
      className='agent-session-rename-trigger'
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={renameInputRef}
        aria-label='Rename conversation'
        className='raw-rename-input'
        value={draftName}
        onFocus={(event) => event.target.select()}
        onChange={(event) => setDraftName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void handleSubmitRename()
          }
          if (event.key === 'Escape') {
            onCancelRename()
          }
        }}
        onBlur={(event) => {
          if (isSubmitting) return

          const nextFocusedElement = event.relatedTarget
          if (nextFocusedElement instanceof Node && rowRef.current?.contains(nextFocusedElement)) {
            return
          }

          onCancelRename()
        }}
      />
    </TreeItemMain>
  ) : undefined
  const renderSessionMain: TreeItemMainRenderer | undefined = isRenaming
    ? undefined
    : (content, mainProps) => {
      const { className, hasDescription } = mainProps

      return (
        <ContextMenu.Root onOpenChange={setIsContextMenuOpen}>
          <ContextMenu.Trigger
            aria-label={accessibleLabel}
            render={<TreeItemMainButton className={className} hasDescription={hasDescription} role='button' />}
            title={accessibleLabel}
            onClick={onOpen}
          >
            {content}
          </ContextMenu.Trigger>
          <AgentTreeContextMenuPopup
            disabled={isDeleting}
            menuPortalTarget={menuPortalTarget}
            onDelete={onDelete}
            onRename={onRequestRename}
          />
        </ContextMenu.Root>
      )
    }
  const rowActions = isRenaming ? (
    <>
      <TreeItemActionButton
        aria-label='Confirm rename'
        title='确认重命名'
        disabled={isSubmitting}
        onClick={() => void handleSubmitRename()}
      >
        <CheckLine size={16} />
      </TreeItemActionButton>
      <TreeItemActionButton
        aria-label='Cancel rename'
        title='取消重命名'
        disabled={isSubmitting}
        onClick={onCancelRename}
      >
        <CloseLine size={16} />
      </TreeItemActionButton>
    </>
  ) : (
    <Menu.Root modal={false} onOpenChange={setIsActionMenuOpen}>
      <Menu.Trigger
        aria-label={`Open ${accessibleLabel} menu`}
        disabled={isDeleting}
        render={<TreeItemActionButton />}
        title={menuTitle}
      >
        <More1Line size={16} />
      </Menu.Trigger>
      <AgentTreeMenuPopup
        disabled={isDeleting}
        menuPortalTarget={menuPortalTarget}
        onDelete={onDelete}
        onRename={onRequestRename}
      />
    </Menu.Root>
  )

  return (
    <TreeItem
      itemClassName={`agent-project-session-node${itemClassName ? ` ${itemClassName}` : ''}`}
      ref={rowRef}
      rowClassName={`agent-project-session-row${rowClassName ? ` ${rowClassName}` : ''}`}
      isActive={isActive}
      isEditing={isRenaming}
      isMenuOpen={isMenuOpen}
      after={error ? <p className='tree-error agent-session-rename-error'>{error}</p> : null}
      icon={agentId ? (
        <TreeItemIcon>
          <AgentBrandIcon agentId={agentId} className='agent-brand-icon' size={16} tone='muted' />
        </TreeItemIcon>
      ) : undefined}
      main={rowMain}
      label={!isRenaming ? label : undefined}
      labelClassName={!isRenaming ? 'agent-project-session-label' : undefined}
      labelSuffix={!isRenaming && activity === 'waiting' ? (
        <span
          aria-label={activityLabel}
          className={`agent-session-activity is-${activity}`}
          role='status'
          title={activityLabel}
        />
      ) : undefined}
      renderMain={renderSessionMain}
      actions={rowActions}
      actionsAlwaysVisible={isRenaming}
      actionsClassName={isRenaming ? 'agent-session-rename-actions' : undefined}
      info={sessionInfo}
      infoProps={activity === 'running' ? {
        'aria-label': activityLabel,
        role: 'status',
        title: activityLabel,
      } : undefined}
      infoVariant={activity === 'running' ? 'status' : 'text'}
    />
  )

}

function FlatAgentSessionTree({
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

function AgentProjectTree({
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

  function toggleProject(project: ProjectRecord) {
    setOpenProjectMenuId(null)
    setRenamingSessionPath(null)
    setRenamingConversationId(null)
    const shouldLoadSessions = !expandedProjectIds.has(project.id)

    setExpandedProjectIds((currentExpandedProjectIds) => {
      const nextExpandedProjectIds = new Set(currentExpandedProjectIds)
      if (nextExpandedProjectIds.has(project.id)) {
        nextExpandedProjectIds.delete(project.id)
      } else {
        nextExpandedProjectIds.add(project.id)
      }

      return nextExpandedProjectIds
    })

    if (shouldLoadSessions) {
      void loadProjectSessions(project)
    }
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
          <EditLine size={16} />
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
              <TreeItem
                variant='header'
                itemClassName='agent-project-tree-header'
                label='项目'
                isExpanded={isProjectSectionExpanded}
                isMenuOpen={isProjectAddMenuOpen}
                actions={(
                  <TreeItemActionButton
                    className={isProjectAddMenuOpen ? 'is-menu-open' : undefined}
                    aria-label='添加项目'
                    title='添加项目'
                    onClick={(event) => {
                      const openProjectAddMenu = onOpenProjectAddMenuOverride ?? onOpenProjectAddMenu
                      openProjectAddMenu?.(event.currentTarget.getBoundingClientRect())
                    }}
                  >
                    <AddLine size={16} />
                  </TreeItemActionButton>
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
              || loadSummary.isLoading
              || loadSummary.errors.length > 0
              || loadSummary.hasLoaded
            )

            const projectIcon = <ProjectIcon />
            const renderProjectMain: TreeItemMainRenderer = (content, mainProps) => {
              const { className, hasDescription } = mainProps

              return (
                <ContextMenu.Root onOpenChange={(open) => handleProjectMenuOpenChange(project.id, open)}>
                  <ContextMenu.Trigger
                    aria-expanded={isExpanded}
                    render={<TreeItemMainButton className={className} hasDescription={hasDescription} role='button' />}
                    title={project.path}
                    onClick={() => toggleProject(project)}
                  >
                    {content}
                  </ContextMenu.Trigger>
                  <AgentProjectContextMenuPopup
                    menuPortalTarget={menuPortalTarget}
                    onOpenFolder={() => {
                      void onOpenProjectFolder?.(project)
                    }}
                    onRemoveProject={() => {
                      void onRemoveProject?.(project)
                    }}
                  />
                </ContextMenu.Root>
              )
            }
            const projectRowActions = (
              <>
                <TreeItemActionButton
                  aria-label={`Start new conversation in ${project.name}`}
                  title='新建对话'
                  onClick={() => {
                    setRenamingConversationId(null)
                    void onStartProjectSession?.(project)
                    onRequestClose?.()
                  }}
                >
                  <EditLine size={16} />
                </TreeItemActionButton>
                <Menu.Root modal={false} onOpenChange={(open) => handleProjectMenuOpenChange(project.id, open)}>
                  <Menu.Trigger
                    aria-label={`Open ${project.name} menu`}
                    render={<TreeItemActionButton />}
                    title='更多'
                  >
                    <More1Line size={16} />
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
              <TreeItem
                key={project.id}
                itemClassName='agent-project-node'
                rowClassName='agent-project-row'
                isMenuOpen={openProjectMenuId === project.id}
                after={showChildren ? (
                  <TreeItemChildren className='agent-project-session-children'>
                    <TreeList className='agent-project-session-list'>
                      {loadSummary.isLoading ? <TreeStatusItem>加载中</TreeStatusItem> : null}
                      {loadSummary.errors.length > 0 ? <TreeStatusItem tone='danger'>部分 Agent 无法加载</TreeStatusItem> : null}
                      {!loadSummary.isLoading && loadSummary.errors.length === 0 && loadSummary.hasLoaded && sessions.length === 0 ? (
                        <TreeStatusItem>暂无对话</TreeStatusItem>
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
                  </TreeItemChildren>
                ) : null}
                icon={projectIcon}
                label={project.name}
                labelClassName='agent-project-row-label'
                renderMain={renderProjectMain}
                actions={projectRowActions}
              />
            )
          })}
              </TreeList>
            ) : null}
          </TreeSection>
          <TreeSection className={`agent-project-tree-section agent-conversation-section${isConversationSectionExpanded ? '' : ' is-collapsed'}`}>
            <TreeItem
              variant='header'
              itemClassName='agent-project-tree-header agent-conversation-tree-header'
              label='对话'
              isExpanded={isConversationSectionExpanded}
              actions={(
                <TreeItemActionButton
                  aria-label='新对话'
                  aria-keyshortcuts='Control+Alt+N'
                  title='新对话 Ctrl+Alt+N'
                  onClick={() => {
                    setRenamingConversationId(null)
                    void onStartStandaloneConversation?.()
                    onRequestClose?.()
                  }}
                >
                  <EditLine size={16} />
                </TreeItemActionButton>
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

export function AgentSessionTreeView(props: AgentSessionTreeViewProps) {
  return props.isFloating ? <FlatAgentSessionTree {...props} /> : <AgentProjectTree {...props} />
}

export function AgentProjectSwitchTrigger({
  activeProject,
  className,
  onOpenProjectSwitchMenu,
  placeholder,
}: {
  activeProject: ProjectRecord | null
  className?: string
  onOpenProjectSwitchMenu?: (anchorRect?: AgentMenuAnchorRect, options?: AgentProjectSwitchMenuOptions) => void
  placeholder?: string
}) {
  const label = activeProject?.name ?? placeholder ?? '未选择项目'
  const isEnabled = Boolean(onOpenProjectSwitchMenu && (activeProject || placeholder))

  return (
    <AppTooltipButton
      type='button'
      className={[
        'agent-project-switch-trigger',
        className,
      ].filter(Boolean).join(' ')}
      disabled={!isEnabled}
      aria-label={activeProject ? `切换项目，当前项目：${activeProject.name}` : label}
      onClick={(event) => {
        onOpenProjectSwitchMenu?.(event.currentTarget.getBoundingClientRect(), { startNewSession: true })
      }}
    >
      <ProjectIcon />
      <span className='agent-project-switch-trigger-label'>{label}</span>
      <DownLine className='agent-project-switch-chevron' aria-hidden='true' size={14} />
    </AppTooltipButton>
  )
}

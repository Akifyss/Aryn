import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { EditLine } from '@mingcute/react'
import type { AgentId } from '@/features/agent/agent-definition'
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
import type { AgentSessionTreeStatus } from './status-model'
import type { AgentSessionTreeViewProps } from './types'
import {
  DEFAULT_AGENT_TREE_ROW_SIZE,
  VirtualizedAgentTreeList,
} from './virtualized-tree-list'

type FlatAgentSessionTreeRow =
  | {
      key: string
      kind: 'session'
      session: AgentSessionTreeItem
    }
  | {
      key: string
      kind: 'status'
      label: string
      status: AgentSessionTreeStatus
    }

function getFlatAgentSessionRowKey(agentId: AgentId, sessionPath: string) {
  return `session:${getAgentSessionTreeKey(agentId, sessionPath)}`
}

function getFlatAgentSessionStatusLabel(status: AgentSessionTreeStatus) {
  if (status === 'loading') return '正在加载会话…'
  if (status === 'error') return '部分 Agent 会话加载失败，重新打开可重试'
  return '暂无对话'
}

function estimateFlatAgentSessionTreeRowSize() {
  return DEFAULT_AGENT_TREE_ROW_SIZE
}

function isFlatAgentSessionTreeRowFocusable(row: FlatAgentSessionTreeRow) {
  return row.kind === 'session'
}

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
  const [menuPinnedRowKeys, setMenuPinnedRowKeys] = useState<Set<string>>(() => new Set())
  const currentProject = useMemo(() => workspacePath
    ? projectState.projects.find((project) => (
        normalizeAgentProjectPath(project.path) === normalizeAgentProjectPath(workspacePath)
      )) ?? null
    : null, [projectState.projects, workspacePath])
  const currentProjectBucket = currentProject ? projectSessions[currentProject.id] : undefined
  const loadSummary = summarizeAgentProjectSessionBucket(currentProjectBucket, sessionTreeAgentIds)
  const hasCompleteSessionSnapshot = currentProject ? loadSummary.hasCompleteSnapshot : true
  const sessions = useMemo(() => currentProject
    ? selectVisibleAgentProjectSessions(currentProjectBucket)
    : agentState.sessions.map((session): AgentSessionTreeItem => ({
        ...session,
        agentId: selectedAgentId,
      })), [agentState.sessions, currentProject, currentProjectBucket, selectedAgentId])
  const isSessionListPending = Boolean(currentProject && (!loadSummary.hasLoaded || loadSummary.isLoading))
  const sessionTreeStatus = resolveAgentSessionTreeStatus({
    errorCount: loadSummary.errors.length,
    hasCompleteSnapshot: hasCompleteSessionSnapshot,
    isPending: isSessionListPending,
    sessionCount: sessions.length,
  })
  const rows = useMemo<FlatAgentSessionTreeRow[]>(() => {
    const nextRows: FlatAgentSessionTreeRow[] = []

    if (sessionTreeStatus) {
      nextRows.push({
        key: `status:${sessionTreeStatus}`,
        kind: 'status',
        label: getFlatAgentSessionStatusLabel(sessionTreeStatus),
        status: sessionTreeStatus,
      })
    }

    if (sessionTreeStatus !== 'empty') {
      for (const session of sessions) {
        nextRows.push({
          key: getFlatAgentSessionRowKey(session.agentId, session.path),
          kind: 'session',
          session,
        })
      }
    }

    return nextRows
  }, [sessionTreeStatus, sessions])
  const activeRowKey = activeSessionSelection.kind === 'session' && activeSessionPath
    ? getFlatAgentSessionRowKey(activeSessionSelection.agentId, activeSessionPath)
    : null
  const pinnedRowKeys = useMemo(() => {
    const nextPinnedRowKeys = new Set(menuPinnedRowKeys)
    if (renamingSessionPath) nextPinnedRowKeys.add(`session:${renamingSessionPath}`)
    if (deletingSessionPath) nextPinnedRowKeys.add(`session:${deletingSessionPath}`)
    return nextPinnedRowKeys
  }, [deletingSessionPath, menuPinnedRowKeys, renamingSessionPath])

  useEffect(() => {
    if (currentProject) void loadProjectSessions(currentProject)
  }, [currentProject, loadProjectSessions])

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

  function renderRow(row: FlatAgentSessionTreeRow) {
    if (row.kind === 'status') {
      return (
        <AgentSessionTreeStatusItem
          itemAs='div'
          label={row.label}
          status={row.status}
        />
      )
    }

    const { session } = row
    const sessionKey = getAgentSessionTreeKey(session.agentId, session.path)
    const isActiveSession = activeSessionSelection.kind === 'session'
      && activeSessionSelection.agentId === session.agentId
      && activeSessionPath === session.path

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
        onDelete={() => {
          if (workspacePath) void handleDeleteSession(workspacePath, session.agentId, session.path)
        }}
        onMenuOpenChange={(open) => handleRowMenuOpenChange(row.key, open)}
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
  }

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

      <VirtualizedAgentTreeList
        activeRowKey={activeRowKey}
        ariaBusy={isSessionListPending}
        ariaLabel='Agent sessions'
        contentClassName='agent-session-tree-scroll-content'
        estimateRowSize={estimateFlatAgentSessionTreeRowSize}
        isRowFocusable={isFlatAgentSessionTreeRowFocusable}
        listClassName='agent-project-list agent-flat-session-list'
        listId={id}
        pinnedRowKeys={pinnedRowKeys}
        renderRow={renderRow}
        rows={rows}
        scrollClassName='agent-session-tree-scroll'
        viewportClassName='agent-session-tree-scroll-viewport'
      />
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@heroui/react'
import { readStoredGitPanelLayout } from '@/features/persistence/renderer-state'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import type {
  GitChangeItem,
  GitCommitItem,
  GitDiffBlockAction,
  GitDiffSelection,
  GitPanelLayout,
  GitRepositoryState,
} from '@/features/git/types'

type GitConfirmationOptions = {
  cancelLabel?: string
  confirmLabel?: string
  isDanger?: boolean
  message: string
  title: string
}

type EnsureWorkspaceTabsSavedOptions = {
  actionLabel: string
  filePaths?: string[]
}

type UseGitWorkspaceControllerOptions = {
  ensureWorkspaceTabsSaved: (options: EnsureWorkspaceTabsSavedOptions) => Promise<boolean>
  loadWorkspaceTree: (workspacePath: string) => Promise<void>
  reconcileDiscardedFile: (workspacePath: string, filePath: string) => Promise<void>
  requestConfirmation: (options: GitConfirmationOptions) => Promise<boolean>
  setStatusMessage: (message: string) => void
  syncOpenDiffTabs: (workspacePath: string) => Promise<void>
  workspacePath: string | null
}

type RefreshGitStateOptions = {
  silent?: boolean
}

type GitActionContext = {
  isCurrent: () => boolean
  publishRepositoryState: (nextState: GitRepositoryState) => boolean
}

const DEFAULT_GIT_PANEL_LAYOUT: GitPanelLayout = 'list'

export function useGitWorkspaceController({
  ensureWorkspaceTabsSaved,
  loadWorkspaceTree,
  reconcileDiscardedFile,
  requestConfirmation,
  setStatusMessage,
  syncOpenDiffTabs,
  workspacePath,
}: UseGitWorkspaceControllerOptions) {
  const [repositoryState, setRepositoryState] = useState<GitRepositoryState | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [commitMessage, setCommitMessage] = useState('')
  const [panelLayout, setPanelLayout] = useState<GitPanelLayout>(
    () => readStoredGitPanelLayout(DEFAULT_GIT_PANEL_LAYOUT),
  )
  const [historyRefreshVersion, setHistoryRefreshVersion] = useState(0)
  const repositoryStateRef = useRef<GitRepositoryState | null>(repositoryState)
  const repositoryWorkspacePathRef = useRef<string | null>(null)
  const activeWorkspacePathRef = useRef<string | null>(workspacePath)
  const actionRequestSequenceRef = useRef(0)
  const activeActionRequestIdRef = useRef<number | null>(null)
  const latestRefreshRequestIdRef = useRef(0)
  const latestVisibleRefreshRequestIdRef = useRef<number | null>(null)

  activeWorkspacePathRef.current = workspacePath

  function isCurrentWorkspace(targetWorkspacePath: string) {
    return Boolean(
      activeWorkspacePathRef.current
      && normalizeFilePath(activeWorkspacePathRef.current) === normalizeFilePath(targetWorkspacePath),
    )
  }

  function publishRepositoryState(
    targetWorkspacePath: string,
    nextState: GitRepositoryState,
  ) {
    if (!isCurrentWorkspace(targetWorkspacePath)) {
      return false
    }

    repositoryStateRef.current = nextState
    repositoryWorkspacePathRef.current = targetWorkspacePath
    setRepositoryState(nextState)
    return true
  }

  function getRepositoryStateForWorkspace(targetWorkspacePath: string) {
    return repositoryWorkspacePathRef.current
      && normalizeFilePath(repositoryWorkspacePathRef.current) === normalizeFilePath(targetWorkspacePath)
      ? repositoryStateRef.current
      : null
  }

  function invalidateActiveAction() {
    actionRequestSequenceRef.current += 1
    activeActionRequestIdRef.current = null
  }

  useEffect(() => () => {
    invalidateActiveAction()
    latestRefreshRequestIdRef.current += 1
    latestVisibleRefreshRequestIdRef.current = null
    activeWorkspacePathRef.current = null
  }, [])

  const refreshGitState = useCallback(async (
    targetWorkspacePath: string | null,
    options: RefreshGitStateOptions = {},
  ) => {
    if (!targetWorkspacePath) {
      latestRefreshRequestIdRef.current += 1
      latestVisibleRefreshRequestIdRef.current = null
      activeWorkspacePathRef.current = null
      repositoryStateRef.current = null
      repositoryWorkspacePathRef.current = null
      setIsLoading(false)
      setRepositoryState(null)
      return null
    }

    if (!isCurrentWorkspace(targetWorkspacePath)) {
      return null
    }

    const requestId = latestRefreshRequestIdRef.current + 1
    latestRefreshRequestIdRef.current = requestId

    if (!options.silent) {
      latestVisibleRefreshRequestIdRef.current = requestId
      setIsLoading(true)
    }

    try {
      const nextState = await window.appApi.getGitRepositoryState(targetWorkspacePath)

      // Saves and external file events can overlap. Only the newest refresh may
      // publish repository state or reconcile open working-tree diff tabs.
      const canPublish = (
        latestRefreshRequestIdRef.current === requestId
        && isCurrentWorkspace(targetWorkspacePath)
      )

      if (canPublish) {
        publishRepositoryState(targetWorkspacePath, nextState)
        await syncOpenDiffTabs(targetWorkspacePath)
      }

      return latestRefreshRequestIdRef.current === requestId
        && isCurrentWorkspace(targetWorkspacePath)
        ? nextState
        : getRepositoryStateForWorkspace(targetWorkspacePath)
    } catch {
      if (latestRefreshRequestIdRef.current !== requestId) {
        return isCurrentWorkspace(targetWorkspacePath)
          ? getRepositoryStateForWorkspace(targetWorkspacePath)
          : null
      }

      return null
    } finally {
      if (!options.silent && latestVisibleRefreshRequestIdRef.current === requestId) {
        setIsLoading(false)
        latestVisibleRefreshRequestIdRef.current = null
      }
    }
  }, [syncOpenDiffTabs])

  const resetGitWorkspaceState = useCallback(() => {
    invalidateActiveAction()
    latestRefreshRequestIdRef.current += 1
    latestVisibleRefreshRequestIdRef.current = null
    activeWorkspacePathRef.current = null
    repositoryStateRef.current = null
    repositoryWorkspacePathRef.current = null
    setIsLoading(false)
    setBusyLabel(null)
    setCommitMessage('')
    setRepositoryState(null)
  }, [])

  const prepareGitWorkspace = useCallback((nextWorkspacePath: string) => {
    invalidateActiveAction()
    latestRefreshRequestIdRef.current += 1
    latestVisibleRefreshRequestIdRef.current = null
    activeWorkspacePathRef.current = nextWorkspacePath
    repositoryStateRef.current = null
    repositoryWorkspacePathRef.current = null
    setIsLoading(true)
    setBusyLabel(null)
    setCommitMessage('')
    setRepositoryState(null)
  }, [])

  async function runGitAction(
    targetWorkspacePath: string,
    label: string,
    action: (context: GitActionContext) => Promise<void>,
  ) {
    if (
      activeActionRequestIdRef.current !== null
      || !isCurrentWorkspace(targetWorkspacePath)
    ) {
      return
    }

    const requestId = actionRequestSequenceRef.current + 1
    actionRequestSequenceRef.current = requestId
    activeActionRequestIdRef.current = requestId
    const isCurrentAction = () => (
      activeActionRequestIdRef.current === requestId
      && isCurrentWorkspace(targetWorkspacePath)
    )
    const context: GitActionContext = {
      isCurrent: isCurrentAction,
      publishRepositoryState: (nextState) => (
        isCurrentAction() && publishRepositoryState(targetWorkspacePath, nextState)
      ),
    }
    setBusyLabel(label)

    try {
      await action(context)
    } catch (error) {
      if (!isCurrentAction()) {
        return
      }

      const message = error instanceof Error ? error.message : 'Git action failed.'
      toast.danger('Git action failed', {
        description: message,
      })
    } finally {
      if (activeActionRequestIdRef.current === requestId) {
        activeActionRequestIdRef.current = null
        setBusyLabel(null)
      }
    }
  }

  async function initializeRepository() {
    if (!workspacePath) {
      return
    }

    await runGitAction(workspacePath, '正在初始化仓库...', async ({ publishRepositoryState }) => {
      const nextState = await window.appApi.initializeGitRepository(workspacePath)
      if (!publishRepositoryState(nextState)) return
      setStatusMessage('Git 仓库已初始化')
    })
  }

  async function stagePaths(filePaths: string[]) {
    if (!workspacePath || filePaths.length === 0) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({
      actionLabel: '暂存更改',
      filePaths,
    }))) {
      return
    }

    await runGitAction(workspacePath, '正在暂存更改...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.stageGitPaths(workspacePath, filePaths)
      if (!publishRepositoryState(nextState)) return
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage('Git 更改已暂存')
    })
  }

  async function unstagePaths(filePaths: string[]) {
    if (!workspacePath || filePaths.length === 0) {
      return
    }

    await runGitAction(workspacePath, '正在取消暂存...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.unstageGitPaths(workspacePath, filePaths)
      if (!publishRepositoryState(nextState)) return
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage('Git 更改已取消暂存')
    })
  }

  async function discardChange(change: GitChangeItem) {
    if (!workspacePath) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({
      actionLabel: '放弃 Git 更改',
      filePaths: [change.path],
    }))) {
      return
    }

    const confirmed = await requestConfirmation({
      title: '放弃更改',
      message: `要放弃 "${change.relativePath}" 当前的${change.scope === 'staged' ? '已暂存' : '未暂存'}更改吗？`,
      confirmLabel: '放弃',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction(workspacePath, '正在放弃更改...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.discardGitChange(workspacePath, change)
      if (!publishRepositoryState(nextState)) return
      await loadWorkspaceTree(workspacePath)
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage(`${change.relativePath} 已还原`)
    })
  }

  async function discardChanges(changes: GitChangeItem[]) {
    if (!workspacePath || changes.length === 0) {
      return
    }

    if (changes.length === 1) {
      await discardChange(changes[0])
      return
    }

    if (!(await ensureWorkspaceTabsSaved({
      actionLabel: '放弃 Git 更改',
      filePaths: changes.map((change) => change.path),
    }))) {
      return
    }

    const confirmed = await requestConfirmation({
      title: '放弃更改',
      message: `要放弃 ${changes.length} 个工作区更改吗？`,
      confirmLabel: '全部放弃',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction(workspacePath, '正在放弃更改...', async ({ isCurrent }) => {
      await Promise.all(changes.map(async (change) => {
        await window.appApi.discardGitChange(workspacePath, change)
      }))
      if (!isCurrent()) return
      await loadWorkspaceTree(workspacePath)
      if (!isCurrent()) return
      await refreshGitState(workspacePath, { silent: true })
      if (!isCurrent()) return
      setStatusMessage(`${changes.length} 个更改已放弃`)
    })
  }

  async function commit() {
    if (!workspacePath) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({ actionLabel: '创建提交' }))) {
      return
    }

    await runGitAction(workspacePath, '正在创建提交...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.commitGitChanges(workspacePath, commitMessage)
      if (!publishRepositoryState(nextState)) return
      setHistoryRefreshVersion((version) => version + 1)
      setCommitMessage('')
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage('提交已创建')
    })
  }

  async function commitAndSync() {
    if (!workspacePath) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({ actionLabel: '提交并同步' }))) {
      return
    }

    await runGitAction(workspacePath, '正在提交并同步...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.commitAndSyncGitChanges(workspacePath, commitMessage)
      if (!publishRepositoryState(nextState)) return
      setHistoryRefreshVersion((version) => version + 1)
      setCommitMessage('')
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage('提交并同步已完成')
    })
  }

  async function revertCommit(commitToRevert: GitCommitItem) {
    if (!workspacePath) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({ actionLabel: '还原 Git 提交' }))) {
      return
    }

    const confirmed = await requestConfirmation({
      title: '还原提交',
      message: `要还原提交“${commitToRevert.subject}”（${commitToRevert.shortHash}）吗？\n\n这会创建一个新提交来撤销它引入的更改，不会改写现有历史。`,
      confirmLabel: '还原提交',
    })

    if (!confirmed) {
      return
    }

    await runGitAction(workspacePath, '正在还原提交...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.revertGitCommit(workspacePath, commitToRevert.hash)
      if (!publishRepositoryState(nextState)) return
      setHistoryRefreshVersion((version) => version + 1)
      await loadWorkspaceTree(workspacePath)
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage(`提交 ${commitToRevert.shortHash} 已还原`)
    })
  }

  async function push() {
    if (!workspacePath) {
      return
    }

    await runGitAction(workspacePath, '正在推送更改...', async ({ publishRepositoryState }) => {
      const nextState = await window.appApi.pushGitChanges(workspacePath)
      if (!publishRepositoryState(nextState)) return
      setStatusMessage('Git 更改已推送')
    })
  }

  async function pull() {
    if (!workspacePath) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({ actionLabel: '拉取 Git 更改' }))) {
      return
    }

    await runGitAction(workspacePath, '正在拉取更改...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.pullGitChanges(workspacePath)
      if (!publishRepositoryState(nextState)) return
      setHistoryRefreshVersion((version) => version + 1)
      await loadWorkspaceTree(workspacePath)
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage('Git 更改已拉取')
    })
  }

  async function discardAll() {
    if (!workspacePath || !repositoryState?.unstagedChanges.length) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({
      actionLabel: '放弃所有 Git 更改',
      filePaths: repositoryState.unstagedChanges.map((change) => change.path),
    }))) {
      return
    }

    const confirmed = await requestConfirmation({
      title: '放弃所有更改',
      message: '要放弃所有工作区更改吗？\n\n这会还原已跟踪文件，并删除未跟踪文件。',
      confirmLabel: '全部放弃',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction(workspacePath, '正在放弃所有工作区更改...', async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.discardAllGitChanges(workspacePath)
      if (!publishRepositoryState(nextState)) return
      await loadWorkspaceTree(workspacePath)
      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage('工作区更改已放弃')
    })
  }

  async function applyDiffSelection(
    change: GitChangeItem,
    selection: GitDiffSelection,
    action: GitDiffBlockAction,
  ) {
    if (!workspacePath) {
      return
    }

    if (!(await ensureWorkspaceTabsSaved({
      actionLabel: action === 'stage'
        ? '暂存这个差异块'
        : action === 'unstage'
          ? '取消暂存这个差异块'
          : '放弃这个差异块',
      filePaths: [change.path],
    }))) {
      return
    }

    const statusMessage = action === 'stage'
      ? 'Git 差异块已暂存'
      : action === 'unstage'
        ? 'Git 差异块已取消暂存'
        : 'Git 差异块已还原'
    const actionBusyLabel = action === 'stage'
      ? '正在暂存差异块...'
      : action === 'unstage'
        ? '正在取消暂存差异块...'
        : '正在还原差异块...'

    await runGitAction(workspacePath, actionBusyLabel, async ({ isCurrent, publishRepositoryState }) => {
      const nextState = await window.appApi.applyGitDiffSelection(
        workspacePath,
        change.path,
        change.scope,
        selection,
        action,
      )
      if (!publishRepositoryState(nextState)) return

      if (action === 'discard') {
        await loadWorkspaceTree(workspacePath)
        if (!isCurrent()) return
        await reconcileDiscardedFile(workspacePath, change.path)
      }

      await syncOpenDiffTabs(workspacePath)
      if (!isCurrent()) return
      setStatusMessage(statusMessage)
    })
  }

  async function refreshPanel() {
    if (!workspacePath) {
      return
    }

    await refreshGitState(workspacePath, { silent: false })
    if (!isCurrentWorkspace(workspacePath)) return
    setHistoryRefreshVersion((version) => version + 1)
  }

  return {
    applyDiffSelection,
    busyLabel,
    commit,
    commitAndSync,
    commitMessage,
    discardAll,
    discardChange,
    discardChanges,
    historyRefreshVersion,
    initializeRepository,
    isLoading,
    panelLayout,
    prepareGitWorkspace,
    pull,
    push,
    refreshGitState,
    refreshPanel,
    repositoryState,
    resetGitWorkspaceState,
    revertCommit,
    setCommitMessage,
    setPanelLayout,
    stagePaths,
    unstagePaths,
  }
}

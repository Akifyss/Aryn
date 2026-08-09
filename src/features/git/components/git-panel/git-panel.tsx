import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollArea } from '@base-ui/react/scroll-area'
import {
  AddLine,
  ArrowDownLine,
  ArrowUpLine,
  CheckLine,
  FolderLine,
  Refresh2Line,
  Back2Line,
  ListCheckLine,
} from '@mingcute/react'
import { Icon } from '@iconify/react'
import { AppButton } from '@/components/app-button'
import { EmptyState } from '@/components/empty-state'
import {
  AppItem,
  AppItemActionButton,
} from '@/components/app-item'
import { AppSplitButton } from '@/components/app-split-button'
import { TreeScrollArea } from '@/components/tree'
import type {
  GitChangeItem,
  GitCommitDetails,
  GitCommitFileChange,
  GitCommitHistoryResult,
  GitCommitItem,
  GitPanelLayout,
  GitRepositoryState,
} from '@/features/git/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  getCleanStateSubtext,
  getRepositoryHeading,
  getSelectedCommitHash,
  type GitHistorySelection,
} from './git-panel-model'
import { GitChangeSection } from './git-change-section/git-change-section'
import { GitCommitActionMenu } from './git-commit-action-menu/git-commit-action-menu'
import {
  GitCommitDetail,
  GitHistoryPane,
  GitHistorySection,
} from './git-history/git-history'
import './styles.css'

type GitPanelProps = {
  busyLabel: string | null
  commitMessage: string
  historyRefreshVersion: number
  isLoading: boolean
  layout: GitPanelLayout
  onCommit: () => void
  onCommitAndSync: () => void
  onCommitMessageChange: (value: string) => void
  onDiscardAll: () => void
  onDiscardMany: (changes: GitChangeItem[]) => void
  onInitialize: () => void
  onLayoutChange: (layout: GitPanelLayout) => void
  onOpenCommitFileDiff: (commitHash: string, change: GitCommitFileChange) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onPull: () => void
  onPush: () => void
  onRefresh: () => void
  onRevertCommit: (commit: GitCommitItem) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  repositoryState: GitRepositoryState | null
  workspacePath: string | null
  iconTheme: WorkspaceIconTheme | null
  menuPortalTarget?: HTMLElement | null
}

const GIT_HISTORY_COMPACT_WIDTH_PX = 520

function getRepositorySyncSummary(repositoryState: GitRepositoryState) {
  const contentParts: ReactNode[] = []
  const labelParts: string[] = []

  if (repositoryState.ahead > 0) {
    contentParts.push(
      <ArrowUpLine key='ahead-icon' aria-hidden='true' />,
      <span key='ahead-count'>{repositoryState.ahead}</span>,
    )
    labelParts.push(`本地领先远端 ${repositoryState.ahead} 个提交`)
  }

  if (repositoryState.behind > 0) {
    contentParts.push(
      <ArrowDownLine key='behind-icon' aria-hidden='true' />,
      <span key='behind-count'>{repositoryState.behind}</span>,
    )
    labelParts.push(`本地落后远端 ${repositoryState.behind} 个提交`)
  }

  return contentParts.length > 0
    ? {
        content: contentParts,
        label: labelParts.join('，'),
      }
    : null
}

export function GitPanel({
  busyLabel,
  commitMessage,
  historyRefreshVersion,
  isLoading,
  layout,
  onCommit,
  onCommitAndSync,
  onCommitMessageChange,
  onDiscardAll,
  onDiscardMany,
  onInitialize,
  onLayoutChange,
  onOpenCommitFileDiff,
  onOpenDiff,
  onOpenFile,
  onOpenMeoDiff,
  onPull,
  onPush,
  onRefresh,
  onRevertCommit,
  onStage,
  onUnstage,
  repositoryState,
  workspacePath,
  iconTheme,
  menuPortalTarget,
}: GitPanelProps) {
  const [historySelection, setHistorySelection] = useState<GitHistorySelection>({ kind: 'working-tree' })
  const [commitHistory, setCommitHistory] = useState<GitCommitHistoryResult | null>(null)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true)
  const [expandedCommitHashes, setExpandedCommitHashes] = useState<Record<string, boolean>>({})
  const [commitDetailsByHash, setCommitDetailsByHash] = useState<Record<string, GitCommitDetails>>({})
  const [loadingCommitHashes, setLoadingCommitHashes] = useState<Record<string, boolean>>({})
  const [commitDetailsErrorsByHash, setCommitDetailsErrorsByHash] = useState<Record<string, string>>({})
  const [historyShellElement, setHistoryShellElement] = useState<HTMLDivElement | null>(null)
  const [isHistoryCompact, setIsHistoryCompact] = useState(false)
  const latestHistoryRequestIdRef = useRef(0)
  const commitDetailsWorkspaceRef = useRef<string | null>(workspacePath)
  const stagedPaths = useMemo(
    () => repositoryState?.stagedChanges.map((change) => change.path) ?? [],
    [repositoryState?.stagedChanges],
  )
  const unstagedPaths = useMemo(
    () => repositoryState?.unstagedChanges.map((change) => change.path) ?? [],
    [repositoryState?.unstagedChanges],
  )
  const canSubmitCommit = repositoryState
    ? repositoryState.hasChanges && commitMessage.trim().length > 0
    : false
  const selectedCommitHash = getSelectedCommitHash(historySelection)
  const selectedCommitDetails = selectedCommitHash ? commitDetailsByHash[selectedCommitHash] ?? null : null
  const selectedCommitSummary = selectedCommitHash
    ? selectedCommitDetails ?? commitHistory?.commits.find((commit) => commit.hash === selectedCommitHash) ?? null
    : null
  const selectedCommitError = selectedCommitHash
    ? commitDetailsErrorsByHash[selectedCommitHash] ?? null
    : null
  const isSelectedCommitLoading = selectedCommitHash
    ? Boolean(loadingCommitHashes[selectedCommitHash])
    : false
  const workingTreeChangeCount = repositoryState
    ? repositoryState.stagedChanges.length + repositoryState.unstagedChanges.length
    : 0

  useEffect(() => {
    commitDetailsWorkspaceRef.current = workspacePath
  }, [workspacePath])

  useEffect(() => {
    if (!historyShellElement) {
      setIsHistoryCompact(false)
      return
    }

    const updateCompactState = () => {
      const nextIsCompact = historyShellElement.getBoundingClientRect().width < GIT_HISTORY_COMPACT_WIDTH_PX
      setIsHistoryCompact((currentValue) => (
        currentValue === nextIsCompact ? currentValue : nextIsCompact
      ))
    }

    updateCompactState()

    if (typeof ResizeObserver === 'undefined') {
      return undefined
    }

    const observer = new ResizeObserver(updateCompactState)
    observer.observe(historyShellElement)

    return () => {
      observer.disconnect()
    }
  }, [historyShellElement])

  useEffect(() => {
    const requestId = latestHistoryRequestIdRef.current + 1
    latestHistoryRequestIdRef.current = requestId
    setCommitDetailsByHash({})
    setCommitDetailsErrorsByHash({})
    setLoadingCommitHashes({})
    setExpandedCommitHashes({})

    if (!workspacePath || isLoading || !repositoryState?.isRepository || !repositoryState.hasCommits) {
      setCommitHistory(null)
      setHistoryError(null)
      setIsHistoryLoading(false)
      setHistorySelection({ kind: 'working-tree' })
      return
    }

    setIsHistoryLoading(true)
    setHistoryError(null)

    window.appApi.getGitCommitHistory(workspacePath).then((nextHistory) => {
      if (latestHistoryRequestIdRef.current !== requestId) {
        return
      }

      setCommitHistory(nextHistory)
      setHistorySelection((currentSelection) => {
        if (currentSelection.kind !== 'commit') {
          return currentSelection
        }

        return nextHistory.commits.some((commit) => commit.hash === currentSelection.commitHash)
          ? currentSelection
          : { kind: 'working-tree' }
      })
    }).catch((error) => {
      if (latestHistoryRequestIdRef.current !== requestId) {
        return
      }

      setCommitHistory(null)
      setHistoryError(error instanceof Error ? error.message : 'Unable to load Git history.')
    }).finally(() => {
      if (latestHistoryRequestIdRef.current === requestId) {
        setIsHistoryLoading(false)
      }
    })
  }, [
    isLoading,
    historyRefreshVersion,
    repositoryState?.ahead,
    repositoryState?.behind,
    repositoryState?.branch,
    repositoryState?.hasCommits,
    repositoryState?.isRepository,
    repositoryState?.repositoryRootPath,
    repositoryState?.unpushedCommits,
    workspacePath,
  ])

  function loadCommitDetails(commitHash: string) {
    if (!workspacePath || commitDetailsByHash[commitHash] || loadingCommitHashes[commitHash]) {
      return
    }

    const requestWorkspacePath = workspacePath

    setLoadingCommitHashes((currentLoading) => ({
      ...currentLoading,
      [commitHash]: true,
    }))
    setCommitDetailsErrorsByHash((currentErrors) => {
      if (!currentErrors[commitHash]) {
        return currentErrors
      }

      const nextErrors = { ...currentErrors }
      delete nextErrors[commitHash]
      return nextErrors
    })

    window.appApi.getGitCommitDetails(requestWorkspacePath, commitHash).then((details) => {
      if (commitDetailsWorkspaceRef.current !== requestWorkspacePath) {
        return
      }

      setCommitDetailsByHash((currentDetails) => ({
        ...currentDetails,
        [commitHash]: details,
        [details.hash]: details,
      }))
    }).catch((error) => {
      if (commitDetailsWorkspaceRef.current !== requestWorkspacePath) {
        return
      }

      setCommitDetailsErrorsByHash((currentErrors) => ({
        ...currentErrors,
        [commitHash]: error instanceof Error ? error.message : 'Unable to load commit details.',
      }))
    }).finally(() => {
      if (commitDetailsWorkspaceRef.current !== requestWorkspacePath) {
        return
      }

      setLoadingCommitHashes((currentLoading) => {
        if (!currentLoading[commitHash]) {
          return currentLoading
        }

        const nextLoading = { ...currentLoading }
        delete nextLoading[commitHash]
        return nextLoading
      })
    })
  }

  function toggleHistoryCommit(commitHash: string) {
    const shouldExpand = !expandedCommitHashes[commitHash]

    setExpandedCommitHashes((currentExpanded) => {
      if (shouldExpand) {
        return {
          ...currentExpanded,
          [commitHash]: true,
        }
      }

      const nextExpanded = { ...currentExpanded }
      delete nextExpanded[commitHash]
      return nextExpanded
    })

    if (shouldExpand) {
      loadCommitDetails(commitHash)
    }
  }

  if (!workspacePath) {
    return (
      <div className='git-panel-empty-state'>
        <p>选择一个工作区以查看 Git 状态。</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='git-panel-empty-state'>
        <p>正在加载 Git 状态...</p>
      </div>
    )
  }

  if (!repositoryState?.isRepository) {
    return (
      <EmptyState
        className='git-panel-init-state'
        icon='streamline-flex-color:search-history-browser-flat'
        title='这个工作区还不是 Git 仓库。'
        actions={(
          <AppButton variant='primary' onClick={onInitialize}>
            初始化 Git
          </AppButton>
        )}
      />
    )
  }

  const currentRepositoryState = repositoryState

  const syncDisabledReason = !currentRepositoryState.hasRemote
    ? '配置远程仓库后才能同步'
    : Boolean(busyLabel)
      ? busyLabel
      : null
  const unpushedCommitCount = currentRepositoryState.unpushedCommits
  const hasUnpushedCommits = unpushedCommitCount > 0
  const pushBadgeLabel = unpushedCommitCount > 99 ? '99+' : String(unpushedCommitCount)
  const pushAccessibleLabel = hasUnpushedCommits
    ? `推送 ${unpushedCommitCount} 个待推送提交`
    : '推送'
  const hasVisibleChanges = currentRepositoryState.hasChanges
  const shouldShowCommitWorkflow = currentRepositoryState.hasChanges
  const cleanStateSubtext = getCleanStateSubtext(currentRepositoryState)
  const syncSummary = getRepositorySyncSummary(currentRepositoryState)
  const historyCommits = commitHistory?.commits ?? []
  const repositoryHeading = getRepositoryHeading(currentRepositoryState)
  const repositoryMeta = currentRepositoryState.hasChanges
    ? `${repositoryHeading} / ${workingTreeChangeCount} 个更改`
    : repositoryHeading
  const revertDisabledReason = currentRepositoryState.hasChanges
    ? '请先提交或放弃当前工作树更改'
    : null

  const selectWorkingTree = () => {
    setHistorySelection({ kind: 'working-tree' })
  }

  const selectCommit = (commitHash: string) => {
    setHistorySelection({ kind: 'commit', commitHash })
    loadCommitDetails(commitHash)
  }

  const renderLayoutToggleAction = () => (
    <AppItemActionButton
      aria-label={layout === 'tree' ? '切换到列表视图' : '切换到树状视图'}
      title={layout === 'tree' ? '列表视图' : '树状视图'}
      disabled={Boolean(busyLabel)}
      onClick={() => {
        onLayoutChange(layout === 'tree' ? 'list' : 'tree')
      }}
    >
      {layout === 'tree'
        ? <ListCheckLine aria-hidden='true' />
        : <FolderLine aria-hidden='true' />}
    </AppItemActionButton>
  )

  const historySection = (
    <GitHistorySection
      busyLabel={busyLabel}
      commits={historyCommits}
      detailsByHash={commitDetailsByHash}
      detailsErrorsByHash={commitDetailsErrorsByHash}
      error={historyError}
      expandedCommitHashes={expandedCommitHashes}
      iconTheme={iconTheme}
      isExpanded={isHistoryExpanded}
      isLoading={isHistoryLoading}
      loadingCommitHashes={loadingCommitHashes}
      revertDisabledReason={revertDisabledReason}
      onExpandedChange={setIsHistoryExpanded}
      onOpenCommitFileDiff={onOpenCommitFileDiff}
      onRevertCommit={onRevertCommit}
      onToggleCommit={toggleHistoryCommit}
    />
  )

  const workingTreeContent = (
    <div className='git-panel'>
      {hasVisibleChanges ? (
        <header className='git-panel-header'>
          <AppItem
            variant='header'
            label='工作树'
            info={syncSummary?.content}
            infoVariant='summary'
            infoProps={syncSummary ? {
              'aria-label': syncSummary.label,
              role: 'img',
              title: syncSummary.label,
            } : undefined}
            actions={(
              <>
                <AppItemActionButton
                  className={hasUnpushedCommits ? 'git-push-action-with-badge' : undefined}
                  aria-label={pushAccessibleLabel}
                  title={syncDisabledReason ?? pushAccessibleLabel}
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPush}
                >
                  <ArrowUpLine aria-hidden='true' />
                  {hasUnpushedCommits ? <span className='git-push-action-badge'>{pushBadgeLabel}</span> : null}
                </AppItemActionButton>
                <AppItemActionButton
                  aria-label='拉取'
                  title={syncDisabledReason ?? '拉取'}
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPull}
                >
                  <ArrowDownLine aria-hidden='true' />
                </AppItemActionButton>
                {renderLayoutToggleAction()}
                <AppItemActionButton
                  aria-label='刷新 Git 状态'
                  title='刷新'
                  disabled={Boolean(busyLabel)}
                  onClick={onRefresh}
                >
                  <Refresh2Line aria-hidden='true' />
                </AppItemActionButton>
              </>
            )}
          />

          {shouldShowCommitWorkflow ? (
            <div className='git-panel-commit-row'>
              <div className='git-panel-commit-field'>
                <ScrollArea.Root className='app-scroll-area git-commit-input-scroll' overflowEdgeThreshold={4}>
                  <ScrollArea.Viewport
                    render={(
                      <textarea
                        value={commitMessage}
                        aria-label='提交信息'
                        className='git-commit-textarea'
                        disabled={Boolean(busyLabel)}
                        placeholder='提交信息'
                        rows={1}
                        onChange={(event) => {
                          onCommitMessageChange(event.target.value)
                        }}
                      />
                    )}
                  />
                  <ScrollArea.Scrollbar
                    className='app-scroll-area-scrollbar git-commit-input-scrollbar'
                    orientation='vertical'
                  >
                    <ScrollArea.Thumb className='app-scroll-area-thumb' />
                  </ScrollArea.Scrollbar>
                </ScrollArea.Root>
                <AppSplitButton.Root
                  className='git-commit-actions'
                  size='sm'
                  variant='outline'
                  aria-label='提交操作'
                >
                  <AppSplitButton.Action
                    type='button'
                    aria-label='提交'
                    disabled={!canSubmitCommit || Boolean(busyLabel)}
                    onClick={onCommit}
                  >
                    <CheckLine aria-hidden='true' />
                    <span>提交</span>
                  </AppSplitButton.Action>
                  <GitCommitActionMenu
                    canSubmitCommit={canSubmitCommit}
                    isBusy={Boolean(busyLabel)}
                    menuPortalTarget={menuPortalTarget}
                    syncDisabledReason={syncDisabledReason}
                    onCommit={onCommit}
                    onCommitAndSync={onCommitAndSync}
                  />
                </AppSplitButton.Root>
              </div>
            </div>
          ) : null}
        </header>
      ) : null}

      {busyLabel ? <p className='git-panel-status'>{busyLabel}</p> : null}

      <TreeScrollArea
        className='git-panel-sections'
        contentClassName='git-panel-sections-content'
      >
        {!currentRepositoryState.hasChanges ? (
          <div className='git-panel-empty-state git-panel-clean-state'>
            <div className='git-empty-illustration'>
              <CheckLine aria-hidden='true' />
            </div>
            <p>工作区干净</p>
            <span className='git-empty-subtext'>{cleanStateSubtext}</span>
            <div className='git-clean-actions'>
              {hasUnpushedCommits ? (
                <AppButton
                  type='button'
                  variant='outline'
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPush}
                >
                  <ArrowUpLine aria-hidden='true' />
                  <span>推送</span>
                </AppButton>
              ) : null}
              {currentRepositoryState.behind > 0 ? (
                <AppButton
                  type='button'
                  variant='outline'
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPull}
                >
                  <ArrowDownLine aria-hidden='true' />
                  <span>拉取</span>
                </AppButton>
              ) : null}
              <AppButton
                type='button'
                variant='outline'
                disabled={Boolean(busyLabel)}
                onClick={onRefresh}
              >
                <Refresh2Line aria-hidden='true' />
                <span>刷新</span>
              </AppButton>
            </div>
          </div>
        ) : (
          <>
            <GitChangeSection
              title='已暂存更改'
              changes={currentRepositoryState.stagedChanges}
              kind='staged'
              layout={layout}
              iconTheme={iconTheme}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenMeoDiff={onOpenMeoDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              action={
                <AppItemActionButton
                  aria-label='全部取消暂存'
                  title='全部取消暂存'
                  disabled={Boolean(busyLabel)}
                  onClick={() => onUnstage(stagedPaths)}
                >
                  <Icon icon='mdi:minus' aria-hidden='true' />
                </AppItemActionButton>
              }
            />

            <GitChangeSection
              title='更改'
              changes={currentRepositoryState.unstagedChanges}
              kind='unstaged'
              layout={layout}
              iconTheme={iconTheme}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenMeoDiff={onOpenMeoDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              action={
                <>
                  <AppItemActionButton
                    aria-label='全部放弃'
                    title='全部放弃'
                    disabled={Boolean(busyLabel)}
                    onClick={onDiscardAll}
                  >
                    <Back2Line aria-hidden='true' />
                  </AppItemActionButton>
                  <AppItemActionButton
                    aria-label='全部暂存'
                    title='全部暂存'
                    disabled={Boolean(busyLabel)}
                    onClick={() => onStage(unstagedPaths)}
                  >
                    <AddLine aria-hidden='true' />
                  </AppItemActionButton>
                </>
              }
            />
          </>
        )}
        {isHistoryCompact ? historySection : null}
      </TreeScrollArea>
    </div>
  )

  return (
    <div
      ref={setHistoryShellElement}
      className={`git-panel-history-shell${isHistoryCompact ? ' is-compact' : ''}`}
    >
      {isHistoryCompact ? null : (
        <GitHistoryPane
          busyLabel={busyLabel}
          commits={historyCommits}
          error={historyError}
          historySelection={historySelection}
          isLoading={isHistoryLoading}
          repositoryMeta={repositoryMeta}
          revertDisabledReason={revertDisabledReason}
          onRevertCommit={onRevertCommit}
          onSelectCommit={selectCommit}
          onSelectWorkingTree={selectWorkingTree}
        />
      )}
      <section
        className='git-panel-detail-pane'
        aria-label={isHistoryCompact || historySelection.kind === 'working-tree' ? '工作树变更' : '提交变更文件'}
      >
        {isHistoryCompact || historySelection.kind === 'working-tree'
          ? workingTreeContent
          : (
            <GitCommitDetail
              busyLabel={busyLabel}
              details={selectedCommitDetails}
              error={selectedCommitError}
              iconTheme={iconTheme}
              isLoading={isSelectedCommitLoading}
              layout={layout}
              layoutAction={renderLayoutToggleAction()}
              revertDisabledReason={revertDisabledReason}
              selectedCommitHash={selectedCommitHash}
              summary={selectedCommitSummary}
              onOpenCommitFileDiff={onOpenCommitFileDiff}
              onRevertCommit={onRevertCommit}
            />
          )}
      </section>
    </div>
  )
}

import type { ReactNode } from 'react'
import { Icon } from '@iconify/react'
import { Back2Line, GitCommitFill, GitCommitLine } from '@mingcute/react'
import {
  AppItem,
  AppItemActionButton,
  AppItemIcon,
} from '@/components/app-item'
import {
  TreeChildren,
  TreeList,
  TreeScrollArea,
  TreeStatusItem,
} from '@/components/tree'
import type {
  GitChangeItem,
  GitCommitDetails,
  GitCommitFileChange,
  GitCommitItem,
  GitPanelLayout,
} from '@/features/git/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  formatCommitRelativeTime,
  getCommitChangeCountLabel,
  getCommitMeta,
  type GitHistorySelection,
} from '../git-panel-model'
import {
  GitChangeRows,
  GitChangeSection,
} from '../git-change-section/git-change-section'
import './styles.css'

type GitHistoryLoadState = {
  commits: GitCommitItem[]
  error: string | null
  isLoading: boolean
}

type GitRevertActionProps = {
  busyLabel: string | null
  onRevertCommit: (commit: GitCommitItem) => void
  revertDisabledReason: string | null
}

function GitHistoryStatus({
  commits,
  error,
  isLoading,
}: GitHistoryLoadState) {
  return (
    <>
      {isLoading && commits.length === 0 ? (
        <TreeStatusItem>正在加载提交历史...</TreeStatusItem>
      ) : null}
      {error ? (
        <TreeStatusItem tone='danger'>{error}</TreeStatusItem>
      ) : null}
      {!isLoading && !error && commits.length === 0 ? (
        <TreeStatusItem>暂无历史提交</TreeStatusItem>
      ) : null}
    </>
  )
}

function GitRevertCommitAction({
  busyLabel,
  commit,
  onRevertCommit,
  revertDisabledReason,
}: GitRevertActionProps & {
  commit: GitCommitItem
}) {
  return (
    <AppItemActionButton
      aria-label={`还原提交 ${commit.shortHash}`}
      title={revertDisabledReason ?? busyLabel ?? '还原提交'}
      disabled={Boolean(busyLabel) || Boolean(revertDisabledReason)}
      onClick={(event) => {
        event.stopPropagation()
        onRevertCommit(commit)
      }}
    >
      <Back2Line size={16} aria-hidden='true' />
    </AppItemActionButton>
  )
}

export function GitHistoryPane({
  commits,
  error,
  isLoading,
  historySelection,
  repositoryMeta,
  busyLabel,
  revertDisabledReason,
  onRevertCommit,
  onSelectCommit,
  onSelectWorkingTree,
}: GitHistoryLoadState & GitRevertActionProps & {
  historySelection: GitHistorySelection
  repositoryMeta: string
  onSelectCommit: (commitHash: string) => void
  onSelectWorkingTree: () => void
}) {
  const selectedCommitHash = historySelection.kind === 'commit'
    ? historySelection.commitHash
    : null

  return (
    <aside className='git-history-pane' aria-label='Git 历史'>
      <TreeScrollArea
        className='git-history-scroll'
        contentClassName='git-history-scroll-content'
      >
        <TreeList className='git-history-list'>
          <AppItem
            icon={(
              <AppItemIcon>
                <Icon
                  icon={historySelection.kind === 'working-tree' ? 'octicon:dot-fill-16' : 'octicon:dot-16'}
                  width={16}
                  height={16}
                  aria-hidden='true'
                />
              </AppItemIcon>
            )}
            isActive={historySelection.kind === 'working-tree'}
            label='工作树'
            description={repositoryMeta}
            mainButtonProps={{
              title: '工作树',
              onClick: onSelectWorkingTree,
            }}
          />

          <GitHistoryStatus
            commits={commits}
            error={error}
            isLoading={isLoading}
          />

          {commits.map((commit) => {
            const isCommitSelected = selectedCommitHash === commit.hash
            const commitMeta = getCommitMeta(commit)

            return (
              <AppItem
                key={commit.hash}
                icon={(
                  <AppItemIcon>
                    {isCommitSelected
                      ? <GitCommitFill size={16} aria-hidden='true' />
                      : <GitCommitLine size={16} aria-hidden='true' />}
                  </AppItemIcon>
                )}
                isActive={isCommitSelected}
                label={commit.subject}
                description={commitMeta}
                actions={(
                  <GitRevertCommitAction
                    busyLabel={busyLabel}
                    commit={commit}
                    onRevertCommit={onRevertCommit}
                    revertDisabledReason={revertDisabledReason}
                  />
                )}
                mainButtonProps={{
                  title: `${commit.subject}\n${commitMeta}\n${commit.hash}`,
                  onClick: () => onSelectCommit(commit.hash),
                }}
              />
            )
          })}
        </TreeList>
      </TreeScrollArea>
    </aside>
  )
}

const ignoreChanges = (_changes: GitChangeItem[]) => {}
const ignoreChange = (_change: GitChangeItem) => {}
const ignoreFilePath = (_filePath: string) => {}
const ignoreFilePaths = (_filePaths: string[]) => {}

function GitHistoryCommitChildren({
  commit,
  detailsByHash,
  detailsErrorsByHash,
  iconTheme,
  loadingCommitHashes,
  onOpenCommitFileDiff,
}: {
  commit: GitCommitItem
  detailsByHash: Record<string, GitCommitDetails>
  detailsErrorsByHash: Record<string, string>
  iconTheme: WorkspaceIconTheme | null
  loadingCommitHashes: Record<string, boolean>
  onOpenCommitFileDiff: (commitHash: string, change: GitCommitFileChange) => void
}) {
  const details = detailsByHash[commit.hash]
  const isCommitLoading = Boolean(loadingCommitHashes[commit.hash])
  const commitError = detailsErrorsByHash[commit.hash]

  if (isCommitLoading && !details) {
    return <TreeStatusItem>正在加载提交文件...</TreeStatusItem>
  }

  if (commitError && !details) {
    return <TreeStatusItem tone='danger'>{commitError}</TreeStatusItem>
  }

  if (!details) {
    return <TreeStatusItem>展开后加载文件变更。</TreeStatusItem>
  }

  if (details.changes.length === 0) {
    return <TreeStatusItem>这个提交没有文件变更。</TreeStatusItem>
  }

  return (
    <GitChangeRows
      changes={details.changes}
      kind='commit'
      layout='list'
      iconTheme={iconTheme}
      onDiscardMany={ignoreChanges}
      onOpenCommitFileDiff={(change) => onOpenCommitFileDiff(details.hash, change)}
      onOpenDiff={ignoreChange}
      onOpenMeoDiff={ignoreChange}
      onOpenFile={ignoreFilePath}
      onStage={ignoreFilePaths}
      onUnstage={ignoreFilePaths}
    />
  )
}

export function GitHistorySection({
  commits,
  error,
  isLoading,
  busyLabel,
  detailsByHash,
  detailsErrorsByHash,
  expandedCommitHashes,
  iconTheme,
  isExpanded,
  loadingCommitHashes,
  revertDisabledReason,
  onExpandedChange,
  onOpenCommitFileDiff,
  onRevertCommit,
  onToggleCommit,
}: GitHistoryLoadState & GitRevertActionProps & {
  detailsByHash: Record<string, GitCommitDetails>
  detailsErrorsByHash: Record<string, string>
  expandedCommitHashes: Record<string, boolean>
  iconTheme: WorkspaceIconTheme | null
  isExpanded: boolean
  loadingCommitHashes: Record<string, boolean>
  onExpandedChange: (isExpanded: boolean) => void
  onOpenCommitFileDiff: (commitHash: string, change: GitCommitFileChange) => void
  onToggleCommit: (commitHash: string) => void
}) {
  return (
    <div className='git-panel-section git-history-section'>
      <AppItem
        variant='header'
        itemClassName='git-panel-section-header'
        label='历史'
        isExpanded={isExpanded}
        info={commits.length}
        onToggle={() => onExpandedChange(!isExpanded)}
      />

      {isExpanded ? (
        <div className='git-history-tree-shell'>
          <TreeList className='git-history-tree-list'>
            <GitHistoryStatus
              commits={commits}
              error={error}
              isLoading={isLoading}
            />

            {commits.map((commit) => {
              const isCommitExpanded = Boolean(expandedCommitHashes[commit.hash])
              const commitMeta = getCommitMeta(commit)

              return (
                <AppItem
                  key={commit.hash}
                  after={isCommitExpanded ? (
                    <TreeChildren className='git-history-commit-children'>
                      <TreeList className='git-history-file-list'>
                        <GitHistoryCommitChildren
                          commit={commit}
                          detailsByHash={detailsByHash}
                          detailsErrorsByHash={detailsErrorsByHash}
                          iconTheme={iconTheme}
                          loadingCommitHashes={loadingCommitHashes}
                          onOpenCommitFileDiff={onOpenCommitFileDiff}
                        />
                      </TreeList>
                    </TreeChildren>
                  ) : null}
                  icon={(
                    <AppItemIcon>
                      {isCommitExpanded
                        ? <GitCommitFill size={16} aria-hidden='true' />
                        : <GitCommitLine size={16} aria-hidden='true' />}
                    </AppItemIcon>
                  )}
                  label={commit.subject}
                  description={commitMeta}
                  actions={(
                    <GitRevertCommitAction
                      busyLabel={busyLabel}
                      commit={commit}
                      onRevertCommit={onRevertCommit}
                      revertDisabledReason={revertDisabledReason}
                    />
                  )}
                  mainButtonProps={{
                    'aria-expanded': isCommitExpanded,
                    title: `${commit.subject}\n${commitMeta}\n${commit.hash}`,
                    onClick: () => onToggleCommit(commit.hash),
                  }}
                />
              )
            })}
          </TreeList>
        </div>
      ) : null}
    </div>
  )
}

function GitCommitDetailHeader({
  changeCount,
  commit,
  layoutAction,
  ...revertActionProps
}: GitRevertActionProps & {
  changeCount?: number
  commit: GitCommitItem
  layoutAction: ReactNode
}) {
  return (
    <header className='git-commit-detail-header'>
      <div className='git-commit-detail-title-area'>
        <h3 className='git-commit-detail-title'>{commit.subject}</h3>
        <p className='git-commit-detail-meta'>
          <span>{commit.authorName}</span>
          <span>{formatCommitRelativeTime(commit.authorTimeUnix)}</span>
          <span>{commit.shortHash}</span>
        </p>
      </div>
      <div className='git-commit-detail-actions'>
        {typeof changeCount === 'number' ? (
          <span className='git-commit-detail-count'>
            {getCommitChangeCountLabel(changeCount)}
          </span>
        ) : null}
        <GitRevertCommitAction
          {...revertActionProps}
          commit={commit}
        />
        {layoutAction}
      </div>
    </header>
  )
}

export function GitCommitDetail({
  busyLabel,
  details,
  error,
  iconTheme,
  isLoading,
  layout,
  layoutAction,
  onOpenCommitFileDiff,
  onRevertCommit,
  revertDisabledReason,
  selectedCommitHash,
  summary,
}: GitRevertActionProps & {
  details: GitCommitDetails | null
  error: string | null
  iconTheme: WorkspaceIconTheme | null
  isLoading: boolean
  layout: GitPanelLayout
  layoutAction: ReactNode
  onOpenCommitFileDiff: (commitHash: string, change: GitCommitFileChange) => void
  selectedCommitHash: string | null
  summary: GitCommitItem | null
}) {
  if (!selectedCommitHash) {
    return null
  }

  const renderHeader = (commit: GitCommitItem, changeCount?: number) => (
    <GitCommitDetailHeader
      busyLabel={busyLabel}
      changeCount={changeCount}
      commit={commit}
      layoutAction={layoutAction}
      onRevertCommit={onRevertCommit}
      revertDisabledReason={revertDisabledReason}
    />
  )

  if (isLoading && !details) {
    return (
      <div className='git-commit-detail'>
        {summary ? renderHeader(summary) : null}
        <div className='git-commit-detail-state'>
          <p>正在加载提交文件...</p>
          {summary ? <span>{summary.subject}</span> : null}
        </div>
      </div>
    )
  }

  if (error && !details) {
    return (
      <div className='git-commit-detail'>
        {summary ? renderHeader(summary) : null}
        <div className='git-commit-detail-state git-panel-error'>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  if (!details) {
    return (
      <div className='git-commit-detail'>
        {summary ? renderHeader(summary) : null}
        <div className='git-commit-detail-state'>
          <p>选择一个提交查看文件变更。</p>
        </div>
      </div>
    )
  }

  return (
    <div className='git-commit-detail'>
      {renderHeader(details, details.changes.length)}
      <TreeScrollArea
        className='git-panel-sections git-commit-detail-sections'
        contentClassName='git-panel-sections-content'
      >
        {details.changes.length === 0 ? (
          <div className='git-panel-empty-state git-commit-detail-state'>
            <p>这个提交没有文件变更。</p>
          </div>
        ) : (
          <GitChangeSection
            title='变更文件'
            changes={details.changes}
            kind='commit'
            layout={layout}
            iconTheme={iconTheme}
            onDiscardMany={ignoreChanges}
            onOpenCommitFileDiff={(change) => onOpenCommitFileDiff(details.hash, change)}
            onOpenDiff={ignoreChange}
            onOpenMeoDiff={ignoreChange}
            onOpenFile={ignoreFilePath}
            onStage={ignoreFilePaths}
            onUnstage={ignoreFilePaths}
          />
        )}
      </TreeScrollArea>
    </div>
  )
}

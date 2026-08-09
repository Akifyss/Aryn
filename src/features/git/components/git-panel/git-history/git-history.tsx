import {
  type ReactNode,
  type RefObject,
  useMemo,
  useRef,
} from 'react'
import { Icon } from '@iconify/react'
import { Back2Line, GitCommitFill, GitCommitLine } from '@mingcute/react'
import {
  AppItem,
  AppItemActionButton,
  AppItemIcon,
} from '@/components/app-item'
import {
  DEFAULT_TREE_ROW_SIZE,
  DESCRIBED_TREE_ROW_SIZE,
  TreeScrollArea,
  VirtualizedTreeList,
  type VirtualizedTreeRowAriaMetadata,
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
  GitChangeRow,
  GitChangeSection,
} from '../git-change-section/git-change-section'
import {
  createGitHistoryPaneRows,
  createGitHistorySectionRows,
  type GitHistoryCommitRow,
  type GitHistoryRow,
  type GitHistoryStatusRow,
} from './git-history-model'
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
      <Back2Line aria-hidden='true' />
    </AppItemActionButton>
  )
}

function getHistoryRowAriaMetadata(row: GitHistoryRow): VirtualizedTreeRowAriaMetadata {
  return row.aria
}

function getHistoryRowDepth(row: GitHistoryRow) {
  return row.depth
}

function isHistoryRowFocusable(row: GitHistoryRow) {
  return row.kind !== 'status'
}

function estimateHistoryRowSize(row: GitHistoryRow) {
  return row.kind === 'status' ? DEFAULT_TREE_ROW_SIZE : DESCRIBED_TREE_ROW_SIZE
}

function GitHistoryStatusRowView({ row }: { row: GitHistoryStatusRow }) {
  return (
    <div className={`tree-status-item tree-status-item-${row.tone}`}>
      {row.message}
    </div>
  )
}

function GitHistoryCommitRowView({
  busyLabel,
  commitRow,
  isSelected,
  onActivate,
  onRevertCommit,
  revertDisabledReason,
}: GitRevertActionProps & {
  commitRow: GitHistoryCommitRow
  isSelected?: boolean
  onActivate: () => void
}) {
  const commitMeta = getCommitMeta(commitRow.commit)
  const useFilledIcon = commitRow.isExpanded || isSelected

  return (
    <AppItem
      itemAs='div'
      icon={(
        <AppItemIcon>
          {useFilledIcon
            ? <GitCommitFill aria-hidden='true' />
            : <GitCommitLine aria-hidden='true' />}
        </AppItemIcon>
      )}
      isActive={isSelected}
      label={commitRow.commit.subject}
      description={commitMeta}
      actions={(
        <GitRevertCommitAction
          busyLabel={busyLabel}
          commit={commitRow.commit}
          onRevertCommit={onRevertCommit}
          revertDisabledReason={revertDisabledReason}
        />
      )}
      mainButtonProps={{
        'aria-expanded': commitRow.canExpand ? commitRow.isExpanded : undefined,
        title: `${commitRow.commit.subject}\n${commitMeta}\n${commitRow.commit.hash}`,
        onClick: onActivate,
      }}
    />
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
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const rows = useMemo(
    () => createGitHistoryPaneRows({ commits, error, isLoading }),
    [commits, error, isLoading],
  )
  const selectedCommitHash = historySelection.kind === 'commit'
    ? historySelection.commitHash
    : null
  const activeRowKey = selectedCommitHash
    ? `commit:${selectedCommitHash}`
    : 'working-tree'

  return (
    <aside className='git-history-pane' aria-label='Git 历史'>
      <TreeScrollArea
        className='git-history-scroll'
        contentClassName='git-history-scroll-content'
        viewportRef={viewportRef}
      >
        <VirtualizedTreeList
          activeRowKey={activeRowKey}
          ariaBusy={isLoading}
          ariaLabel='Git 历史'
          estimateRowSize={estimateHistoryRowSize}
          getRowAriaMetadata={getHistoryRowAriaMetadata}
          getRowDepth={getHistoryRowDepth}
          isRowFocusable={isHistoryRowFocusable}
          itemClassName='git-history-virtual-item'
          listClassName='git-history-list'
          renderRow={(row) => {
            if (row.kind === 'status') return <GitHistoryStatusRowView row={row} />
            if (row.kind === 'working-tree') {
              return (
                <AppItem
                  itemAs='div'
                  icon={(
                    <AppItemIcon>
                      <Icon
                        icon={historySelection.kind === 'working-tree' ? 'octicon:dot-fill-16' : 'octicon:dot-16'}
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
              )
            }
            if (row.kind !== 'commit') return null

            return (
              <GitHistoryCommitRowView
                busyLabel={busyLabel}
                commitRow={row}
                isSelected={selectedCommitHash === row.commit.hash}
                onActivate={() => onSelectCommit(row.commit.hash)}
                onRevertCommit={onRevertCommit}
                revertDisabledReason={revertDisabledReason}
              />
            )
          }}
          rows={rows}
          scrollElementRef={viewportRef}
        />
      </TreeScrollArea>
    </aside>
  )
}

const ignoreChanges = (_changes: GitChangeItem[]) => {}
const ignoreChange = (_change: GitChangeItem) => {}
const ignoreFilePath = (_filePath: string) => {}
const ignoreFilePaths = (_filePaths: string[]) => {}

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
  scrollElementRef,
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
  scrollElementRef: RefObject<HTMLDivElement | null>
  onExpandedChange: (isExpanded: boolean) => void
  onOpenCommitFileDiff: (commitHash: string, change: GitCommitFileChange) => void
  onToggleCommit: (commitHash: string) => void
}) {
  const rows = useMemo(() => createGitHistorySectionRows({
    commits,
    detailsByHash,
    detailsErrorsByHash,
    error,
    expandedCommitHashes,
    isLoading,
    loadingCommitHashes,
  }), [
    commits,
    detailsByHash,
    detailsErrorsByHash,
    error,
    expandedCommitHashes,
    isLoading,
    loadingCommitHashes,
  ])

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
          <VirtualizedTreeList
            ariaBusy={isLoading}
            ariaLabel='提交历史'
            estimateRowSize={estimateHistoryRowSize}
            getRowAriaMetadata={getHistoryRowAriaMetadata}
            getRowDepth={getHistoryRowDepth}
            indentSize={24}
            isRowFocusable={isHistoryRowFocusable}
            itemClassName='git-history-virtual-item'
            listClassName='git-history-tree-list'
            renderRow={(row) => {
              if (row.kind === 'status') return <GitHistoryStatusRowView row={row} />
              if (row.kind === 'commit-change') {
                return (
                  <GitChangeRow
                    change={row.change}
                    iconTheme={iconTheme}
                    kind='commit'
                    layout='list'
                    onDiscardMany={ignoreChanges}
                    onOpenCommitFileDiff={(change) => onOpenCommitFileDiff(row.commitHash, change)}
                    onOpenDiff={ignoreChange}
                    onOpenFile={ignoreFilePath}
                    onOpenMeoDiff={ignoreChange}
                    onStage={ignoreFilePaths}
                    onUnstage={ignoreFilePaths}
                  />
                )
              }
              if (row.kind !== 'commit') return null

              return (
                <GitHistoryCommitRowView
                  busyLabel={busyLabel}
                  commitRow={row}
                  onActivate={() => onToggleCommit(row.commit.hash)}
                  onRevertCommit={onRevertCommit}
                  revertDisabledReason={revertDisabledReason}
                />
              )
            }}
            rows={rows}
            scrollElementRef={scrollElementRef}
          />
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
  const viewportRef = useRef<HTMLDivElement | null>(null)

  if (!selectedCommitHash) return null

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
        viewportRef={viewportRef}
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
            scrollElementRef={viewportRef}
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

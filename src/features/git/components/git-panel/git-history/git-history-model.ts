import type { VirtualizedTreeRowAriaMetadata } from '@/components/tree'
import type {
  GitCommitDetails,
  GitCommitFileChange,
  GitCommitItem,
} from '@/features/git/types'

type GitHistoryRowBase = {
  aria: VirtualizedTreeRowAriaMetadata
  depth: number
  key: string
}

export type GitHistoryWorkingTreeRow = GitHistoryRowBase & {
  kind: 'working-tree'
}

export type GitHistoryCommitRow = GitHistoryRowBase & {
  canExpand: boolean
  commit: GitCommitItem
  isExpanded: boolean
  kind: 'commit'
}

export type GitHistoryCommitChangeRow = GitHistoryRowBase & {
  change: GitCommitFileChange
  commitHash: string
  kind: 'commit-change'
}

export type GitHistoryStatusRow = GitHistoryRowBase & {
  kind: 'status'
  message: string
  tone: 'danger' | 'default'
}

export type GitHistoryRow =
  | GitHistoryWorkingTreeRow
  | GitHistoryCommitRow
  | GitHistoryCommitChangeRow
  | GitHistoryStatusRow

type GitHistoryLoadState = {
  commits: readonly GitCommitItem[]
  error: string | null
  isLoading: boolean
}

type UnpositionedStatus = Omit<GitHistoryStatusRow, 'aria' | 'depth'>
type UnpositionedHistoryRow = GitHistoryRow extends infer Row
  ? Row extends GitHistoryRow
    ? Omit<Row, 'aria' | 'depth'>
    : never
  : never

function createHistoryStatusRows({
  commits,
  error,
  isLoading,
}: GitHistoryLoadState): UnpositionedStatus[] {
  const rows: UnpositionedStatus[] = []

  if (isLoading && commits.length === 0) {
    rows.push({
      key: 'status:history-loading',
      kind: 'status',
      message: '正在加载提交历史...',
      tone: 'default',
    })
  }
  if (error) {
    rows.push({
      key: 'status:history-error',
      kind: 'status',
      message: error,
      tone: 'danger',
    })
  }
  if (!isLoading && !error && commits.length === 0) {
    rows.push({
      key: 'status:history-empty',
      kind: 'status',
      message: '暂无历史提交',
      tone: 'default',
    })
  }

  return rows
}

function positionTopLevelRows(
  rows: UnpositionedHistoryRow[],
): GitHistoryRow[] {
  const setSize = rows.length
  return rows.map((row, index) => ({
    ...row,
    aria: {
      level: 1,
      positionInSet: index + 1,
      setSize,
    },
    depth: 0,
  })) as GitHistoryRow[]
}

export function createGitHistoryPaneRows(
  state: GitHistoryLoadState,
): GitHistoryRow[] {
  const rows: UnpositionedHistoryRow[] = [
    {
      key: 'working-tree',
      kind: 'working-tree',
    },
    ...createHistoryStatusRows(state),
    ...state.commits.map((commit) => ({
      canExpand: false,
      commit,
      isExpanded: false,
      key: `commit:${commit.hash}`,
      kind: 'commit' as const,
    })),
  ]

  return positionTopLevelRows(rows)
}

function createExpandedCommitRows({
  commit,
  detailsByHash,
  detailsErrorsByHash,
  loadingCommitHashes,
}: {
  commit: GitCommitItem
  detailsByHash: Readonly<Record<string, GitCommitDetails>>
  detailsErrorsByHash: Readonly<Record<string, string>>
  loadingCommitHashes: Readonly<Record<string, boolean>>
}): GitHistoryRow[] {
  const details = detailsByHash[commit.hash]
  const isLoading = Boolean(loadingCommitHashes[commit.hash])
  const error = detailsErrorsByHash[commit.hash]
  let message: string | null = null
  let tone: GitHistoryStatusRow['tone'] = 'default'

  if (isLoading && !details) message = '正在加载提交文件...'
  else if (error && !details) {
    message = error
    tone = 'danger'
  } else if (!details) message = '展开后加载文件变更。'
  else if (details.changes.length === 0) message = '这个提交没有文件变更。'

  if (message) {
    return [{
      aria: {
        level: 2,
        positionInSet: 1,
        setSize: 1,
      },
      depth: 1,
      key: `commit:${commit.hash}:status`,
      kind: 'status',
      message,
      tone,
    }]
  }

  const changes = details?.changes ?? []
  return changes.map((change, index) => ({
    aria: {
      level: 2,
      positionInSet: index + 1,
      setSize: changes.length,
    },
    change,
    commitHash: commit.hash,
    depth: 1,
    key: `commit:${commit.hash}:change:${change.kind}:${change.path}`,
    kind: 'commit-change',
  }))
}

export function createGitHistorySectionRows(
  state: GitHistoryLoadState & {
    detailsByHash: Readonly<Record<string, GitCommitDetails>>
    detailsErrorsByHash: Readonly<Record<string, string>>
    expandedCommitHashes: Readonly<Record<string, boolean>>
    loadingCommitHashes: Readonly<Record<string, boolean>>
  },
): GitHistoryRow[] {
  const topRows = positionTopLevelRows([
    ...createHistoryStatusRows(state),
    ...state.commits.map((commit) => ({
      canExpand: true,
      commit,
      isExpanded: Boolean(state.expandedCommitHashes[commit.hash]),
      key: `commit:${commit.hash}`,
      kind: 'commit' as const,
    })),
  ])
  const rows: GitHistoryRow[] = []

  for (const row of topRows) {
    rows.push(row)
    if (row.kind !== 'commit' || !row.isExpanded) continue

    rows.push(...createExpandedCommitRows({
      commit: row.commit,
      detailsByHash: state.detailsByHash,
      detailsErrorsByHash: state.detailsErrorsByHash,
      loadingCommitHashes: state.loadingCommitHashes,
    }))
  }

  return rows
}

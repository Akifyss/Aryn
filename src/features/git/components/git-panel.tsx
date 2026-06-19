import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { Menu } from '@base-ui/react/menu'
import { ScrollArea } from '@base-ui/react/scroll-area'
import {
  AddLine,
  ArrowDownLine,
  ArrowUpCircleLine,
  ArrowUpLine,
  CheckLine,
  DownLine,
  FolderLine,
  GitCommitFill,
  GitCommitLine,
  MarkdownLine,
  Refresh2Line,
  Back2Line,
  ListCheckLine,
} from '@mingcute/react'
import { Icon } from '@iconify/react'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
import {
  TreeItemActionButton,
  TreeItemChildren,
  TreeItem,
  TreeItemIcon,
  TreeList,
  TreeScrollArea,
  TreeStatusItem,
} from '@/components/tree'
import { AppTooltipButton } from '@/components/app-tooltip'
import type {
  GitChangeItem,
  GitCommitDetails,
  GitCommitFileChange,
  GitCommitHistoryResult,
  GitCommitItem,
  GitPanelLayout,
  GitRecentPullItem,
  GitRepositoryState,
} from '@/features/git/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  getSupportedWorkspaceEditorKind,
  supportsMeoEditor,
} from '@/features/workspace/lib/file-types'
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'

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

type GitPanelSectionKind = 'staged' | 'unstaged' | 'pulled' | 'commit'

type GitDisplayChange = GitChangeItem | GitRecentPullItem | GitCommitFileChange

type GitHistorySelection =
  | {
    kind: 'working-tree'
  }
  | {
    commitHash: string
    kind: 'commit'
  }

type GitTreeNode = {
  children: GitTreeNode[]
  id: string
  items: GitDisplayChange[]
  label: string
  path: string
}

type GitTreeNodeDraft = GitTreeNode & {
  childrenMap: Map<string, GitTreeNodeDraft>
}

const GIT_HISTORY_COMPACT_WIDTH_PX = 520

type GitChangeRowsProps = {
  changes: GitDisplayChange[]
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenCommitFileDiff?: (change: GitCommitFileChange) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  iconTheme: WorkspaceIconTheme | null
  kind: GitPanelSectionKind
  layout: GitPanelLayout
}

function isScopedGitChange(change: GitDisplayChange): change is GitChangeItem {
  return 'scope' in change
}

function supportsMeoDiff(change: GitDisplayChange) {
  if (!isScopedGitChange(change)) {
    return false
  }

  const editorKind = getSupportedWorkspaceEditorKind(change.path)
  return editorKind ? supportsMeoEditor(change.path, editorKind) : false
}

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function getDirectoryLabel(relativePath: string) {
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  return segments.join(' / ')
}

function getCommitChangeCountLabel(count: number) {
  return `${count} 个变更文件`
}

function formatCommitRelativeTime(authorTimeUnix: number) {
  if (!authorTimeUnix) {
    return '未知时间'
  }

  const diffSeconds = authorTimeUnix - Date.now() / 1000
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(diffSeconds) >= secondsPerUnit) {
      return formatter.format(Math.round(diffSeconds / secondsPerUnit), unit)
    }
  }

  return '刚刚'
}

function getCommitMeta(commit: GitCommitItem) {
  return `${commit.authorName} · ${formatCommitRelativeTime(commit.authorTimeUnix)} · ${commit.shortHash}`
}

function getSelectedCommitHash(selection: GitHistorySelection) {
  return selection.kind === 'commit' ? selection.commitHash : null
}

function getRepositoryHeading(repositoryState: GitRepositoryState) {
  const branchLabel = repositoryState.branch ?? '当前分支'

  if (!repositoryState.hasCommits) {
    return `${branchLabel} 尚无提交`
  }

  return repositoryState.branch ?? '分离 HEAD'
}

function getRepositorySyncSummary(repositoryState: GitRepositoryState) {
  const contentParts: ReactNode[] = []
  const labelParts: string[] = []

  if (repositoryState.ahead > 0) {
    contentParts.push(
      <ArrowUpLine key='ahead-icon' size={12} aria-hidden='true' />,
      <span key='ahead-count'>{repositoryState.ahead}</span>,
    )
    labelParts.push(`本地领先远端 ${repositoryState.ahead} 个提交`)
  }

  if (repositoryState.behind > 0) {
    contentParts.push(
      <ArrowDownLine key='behind-icon' size={12} aria-hidden='true' />,
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

function getCleanStateSubtext(repositoryState: GitRepositoryState) {
  const syncParts: string[] = []

  if (repositoryState.unpushedCommits > 0) {
    syncParts.push(
      `${repositoryState.unpushedCommits} 个提交待推送`,
    )
  }

  if (repositoryState.behind > 0) {
    syncParts.push(
      `${repositoryState.behind} 个远程提交待拉取`,
    )
  }

  return syncParts.length > 0 ? syncParts.join(' / ') : '所有更改已提交'
}

function getGitChangeKindLabel(kind: GitDisplayChange['kind']) {
  switch (kind) {
    case 'added':
      return '新增'
    case 'copied':
      return '复制'
    case 'conflicted':
      return '冲突'
    case 'deleted':
      return '删除'
    case 'modified':
      return '修改'
    case 'renamed':
      return '重命名'
    case 'type-changed':
      return '类型变更'
    case 'untracked':
      return '未跟踪'
  }
}

function buildGitTree(changes: GitDisplayChange[]) {
  const root = new Map<string, GitTreeNodeDraft>()

  for (const change of changes) {
    const segments = change.relativePath.split('/').filter(Boolean)

    if (segments.length <= 1) {
      continue
    }

    let currentLevel = root
    let currentPath = ''

    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const existingNode = currentLevel.get(segment)

      if (existingNode) {
        existingNode.items.push(change)
        currentLevel = existingNode.childrenMap
        continue
      }

      const nextNode: GitTreeNodeDraft = {
        children: [],
        childrenMap: new Map(),
        id: currentPath,
        items: [change],
        label: segment,
        path: currentPath,
      }
      currentLevel.set(segment, nextNode)
      currentLevel = nextNode.childrenMap
    }
  }

function materialize(nodes: Iterable<GitTreeNodeDraft>): GitTreeNode[] {
    return [...nodes]
      .map((node) => {
        return {
          children: materialize(node.childrenMap.values()),
          id: node.id,
          items: node.items,
          label: node.label,
          path: node.path,
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path))
  }

  return materialize(root.values())
}

function GitRowActions({
  kind,
  onUnstage,
  onStage,
  onDiscard,
  onOpenFile,
  onOpenMeoDiff,
  isFolder,
  change,
}: {
  kind: GitPanelSectionKind
  onUnstage?: () => void
  onStage?: () => void
  onDiscard?: () => void
  onOpenFile?: () => void
  onOpenMeoDiff?: () => void
  isFolder?: boolean
  change?: GitDisplayChange
}) {
  const scopedChange = change && isScopedGitChange(change) ? change : null
  const hasMeoDiff = change ? supportsMeoDiff(change) : false
  const canOpenFile = Boolean(scopedChange && scopedChange.kind !== 'deleted' && onOpenFile)
  const showOpenFile = !isFolder && canOpenFile
  const showMeoDiff = !isFolder && Boolean(scopedChange && hasMeoDiff)
  const showUnstage = kind === 'staged'
  const showStageControls = kind === 'unstaged'

  if (!showOpenFile && !showMeoDiff && !showUnstage && !showStageControls) {
    return null
  }

  return (
    <>
        {showOpenFile && (
          <TreeItemActionButton
            aria-label='打开文件'
            title='打开文件'
            onClick={(e) => {
              e.stopPropagation()
              onOpenFile?.()
            }}
          >
            <Icon icon='material-symbols:file-export-outline-rounded' width={16} height={16} />
          </TreeItemActionButton>
        )}
        {showMeoDiff && (
          <TreeItemActionButton
            aria-label='打开 MEO 分屏差异'
            title='打开 MEO 分屏差异'
            onClick={(e) => {
              e.stopPropagation()
              onOpenMeoDiff?.()
            }}
          >
            <MarkdownLine size={16} />
          </TreeItemActionButton>
        )}

        {showUnstage && (
          <TreeItemActionButton
            aria-label='取消暂存'
            title='取消暂存'
            onClick={(e) => {
              e.stopPropagation()
              onUnstage?.()
            }}
          >
            <Icon icon='mdi:minus' width={16} height={16} />
          </TreeItemActionButton>
        )}

        {showStageControls && (
          <>
            <TreeItemActionButton
              aria-label='放弃更改'
              title='放弃更改'
              onClick={(e) => {
                e.stopPropagation()
                onDiscard?.()
              }}
            >
              <Back2Line size={16} />
            </TreeItemActionButton>
            <TreeItemActionButton
              aria-label='暂存'
              title='暂存'
              onClick={(e) => {
                e.stopPropagation()
                onStage?.()
              }}
            >
              <AddLine size={16} />
            </TreeItemActionButton>
          </>
        )}
    </>
  )
}

function GitTreeFolder({
  kind,
  node,
  onDiscardMany,
  onOpenDiff,
  onOpenCommitFileDiff,
  onOpenMeoDiff,
  onOpenFile,
  onStage,
  onUnstage,
  iconTheme,
  closedMap,
  toggleNode,
  layout,
}: {
  kind: GitPanelSectionKind
  node: GitTreeNode
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenCommitFileDiff?: (change: GitCommitFileChange) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  iconTheme: WorkspaceIconTheme | null
  closedMap: Record<string, boolean>
  toggleNode: (id: string) => void
  layout: GitPanelLayout
}) {
  const isClosed = closedMap[node.id] ?? false
  const activeItems = node.items.filter(isScopedGitChange)
  const paths = activeItems.map((i) => i.path)

  // Only show files directly under this node
  const localItems = node.items.filter((item) => {
    const parentPath = item.relativePath.substring(0, item.relativePath.lastIndexOf('/'))
    return parentPath === node.path
  })

  return (
    <TreeItem
      after={!isClosed ? (
        <TreeItemChildren>
          <TreeList>
            {node.children.map((child) => (
              <GitTreeFolder
                key={child.id}
                kind={kind}
                node={child}
                onDiscardMany={onDiscardMany}
                onOpenDiff={onOpenDiff}
                onOpenCommitFileDiff={onOpenCommitFileDiff}
                onOpenMeoDiff={onOpenMeoDiff}
                onOpenFile={onOpenFile}
                onStage={onStage}
                onUnstage={onUnstage}
                iconTheme={iconTheme}
                closedMap={closedMap}
                toggleNode={toggleNode}
                layout={layout}
              />
            ))}
            <GitChangeRows
              changes={localItems}
              kind={kind}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenCommitFileDiff={onOpenCommitFileDiff}
              onOpenMeoDiff={onOpenMeoDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              iconTheme={iconTheme}
              layout={layout}
            />
          </TreeList>
        </TreeItemChildren>
      ) : null}
      icon={<WorkspaceFileIcon isFolder nodeLabel={node.label} isClosed={isClosed} iconTheme={iconTheme} />}
      label={node.label}
      mainButtonProps={{
        'aria-expanded': !isClosed,
        onClick: () => toggleNode(node.id),
      }}
      actions={() => (
        <GitRowActions
          kind={kind}
          isFolder
          onStage={() => onStage(paths)}
          onUnstage={() => onUnstage(paths)}
          onDiscard={() => onDiscardMany(activeItems)}
        />
      )}
      info={node.items.length}
      infoVariant='count'
    />
  )
}

function GitChangeRows({
  changes,
  onDiscardMany,
  onOpenDiff,
  onOpenCommitFileDiff,
  onOpenMeoDiff,
  onOpenFile,
  onStage,
  onUnstage,
  iconTheme,
  kind,
  layout,
}: GitChangeRowsProps) {
  return (
    <>
      {changes.map((change) => {
        const fileName = getBaseName(change.relativePath)
        const dirLabel = getDirectoryLabel(change.relativePath)
        const isChange = isScopedGitChange(change)
        const pathMeta = layout === 'list' ? dirLabel : ''
        const changeKindLabel = getGitChangeKindLabel(change.kind)
        return (
          <TreeItem
            key={change.path}
            icon={<WorkspaceFileIcon fileName={fileName} iconTheme={iconTheme} />}
            label={fileName}
            description={pathMeta || undefined}
            mainButtonProps={{
              title: change.relativePath,
              onClick: () => {
                if (isChange) onOpenDiff(change)
                else if (kind === 'commit') onOpenCommitFileDiff?.(change)
                else onOpenFile(change.path)
              },
            }}
            actions={() => (
              <GitRowActions
                kind={kind}
                change={change}
                onStage={() => onStage([change.path])}
                onUnstage={() => onUnstage([change.path])}
                onDiscard={() => onDiscardMany([change as GitChangeItem])}
                onOpenFile={() => onOpenFile(change.path)}
                onOpenMeoDiff={() => isChange && onOpenMeoDiff(change)}
              />
            )}
            info={(
              <FileChangeStatusBadge
                kind={change.kind}
                title={changeKindLabel}
              />
            )}
            infoVariant='status'
          />
        )
      })}
    </>
  )
}

function GitChangeList(props: GitChangeRowsProps) {
  if (props.changes.length === 0) {
    return null
  }

  return (
    <TreeList className='git-change-list git-change-list-flat'>
      <GitChangeRows {...props} />
    </TreeList>
  )
}

function GitSection({
  title,
  changes,
  kind,
  layout,
  action,
  onStage,
  onUnstage,
  onDiscardMany,
  onOpenDiff,
  onOpenCommitFileDiff,
  onOpenMeoDiff,
  onOpenFile,
  iconTheme,
}: {
  title: string
  changes: GitDisplayChange[]
  kind: GitPanelSectionKind
  layout: GitPanelLayout
  action?: ReactNode
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenCommitFileDiff?: (change: GitCommitFileChange) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  iconTheme: WorkspaceIconTheme | null
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [closedMap, setClosedMap] = useState<Record<string, boolean>>({})
  
  const treeNodes = useMemo(() => buildGitTree(changes), [changes])
  const rootFiles = useMemo(() => 
    changes.filter(c => !c.relativePath.includes('/')),
    [changes]
  )

  const toggleNode = (id: string) => {
    setClosedMap((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (changes.length === 0) {
    return null
  }

  return (
    <div className='git-panel-section'>
      <TreeItem
        variant='header'
        itemClassName='git-panel-section-header'
        label={title}
        isExpanded={isExpanded}
        info={changes.length}
        actions={action}
        onToggle={() => setIsExpanded((v) => !v)}
      />

      {isExpanded && changes.length > 0 && (
        <div className={layout === 'tree' ? 'git-panel-tree-shell' : ''}>
          {layout === 'tree' && treeNodes.length > 0 ? (
            <TreeList className='git-change-list'>
              {treeNodes.map((node) => (
                <GitTreeFolder
                  key={node.id}
                  kind={kind}
                  node={node}
                  closedMap={closedMap}
                  toggleNode={toggleNode}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
                  onOpenCommitFileDiff={onOpenCommitFileDiff}
                  onOpenMeoDiff={onOpenMeoDiff}
                  onOpenFile={onOpenFile}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  iconTheme={iconTheme}
                  layout={layout}
                />
              ))}
              {rootFiles.length > 0 && (
                <GitChangeRows
                  changes={rootFiles}
                  kind={kind}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
                  onOpenCommitFileDiff={onOpenCommitFileDiff}
                  onOpenMeoDiff={onOpenMeoDiff}
                  onOpenFile={onOpenFile}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  iconTheme={iconTheme}
                  layout={layout}
                />
              )}
            </TreeList>
          ) : (
            <GitChangeList
              changes={changes}
              kind={kind}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenCommitFileDiff={onOpenCommitFileDiff}
              onOpenMeoDiff={onOpenMeoDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              iconTheme={iconTheme}
              layout={layout}
            />
          )}
        </div>
      )}
    </div>
  )
}

function runCommitMenuAction(event: MouseEvent<HTMLElement>, action: () => void) {
  event.stopPropagation()
  action()
}

function GitCommitActionMenu({
  canSubmitCommit,
  isBusy,
  menuPortalTarget,
  syncDisabledReason,
  onCommit,
  onCommitAndSync,
}: {
  canSubmitCommit: boolean
  isBusy: boolean
  menuPortalTarget?: HTMLElement | null
  syncDisabledReason: string | null
  onCommit: () => void
  onCommitAndSync: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const commitDisabled = !canSubmitCommit || isBusy
  const commitAndSyncDisabled = !canSubmitCommit || Boolean(syncDisabledReason)
  const menuDisabled = commitDisabled
  const isMenuOpen = isOpen && !menuDisabled

  useEffect(() => {
    if (menuDisabled) {
      setIsOpen(false)
    }
  }, [menuDisabled])

  return (
    <Menu.Root
      modal={false}
      open={isMenuOpen}
      onOpenChange={(open, details) => {
        if (open) {
          if (menuDisabled) {
            return
          }

          setIsOpen(true)
          return
        }

        if (shouldCloseClickOpenedMenu(details)) {
          setIsOpen(false)
        } else {
          details.cancel?.()
        }
      }}
    >
      <Menu.Trigger
        aria-label='打开提交菜单'
        className={`git-commit-menu-trigger${isMenuOpen ? ' is-open' : ''}`}
        disabled={menuDisabled}
        render={<AppTooltipButton tooltip='提交选项' />}
      >
        <DownLine size={12} />
      </Menu.Trigger>
      <Menu.Portal
        className='git-commit-menu-portal'
        container={menuPortalTarget ?? undefined}
      >
        <Menu.Positioner
          align='end'
          className='git-commit-menu-positioner'
          collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
          collisionPadding={8}
          positionMethod='fixed'
          side='bottom'
          sideOffset={4}
        >
          <Menu.Popup
            aria-label='提交选项'
            className='git-commit-menu'
            finalFocus={false}
          >
            <Menu.Item
              nativeButton
              render={<button type='button' />}
              className={({ highlighted }) => `git-commit-menu-item${highlighted ? ' is-highlighted' : ''}`}
              disabled={commitDisabled}
              label='提交'
              onClick={(event) => runCommitMenuAction(event, onCommit)}
            >
              <CheckLine size={16} className='git-commit-menu-icon' />
              <span>提交</span>
            </Menu.Item>
            <Menu.Item
              nativeButton
              render={<button type='button' />}
              className={({ highlighted }) => `git-commit-menu-item${highlighted ? ' is-highlighted' : ''}`}
              disabled={commitAndSyncDisabled}
              label='提交并同步'
              onClick={(event) => runCommitMenuAction(event, onCommitAndSync)}
            >
              <ArrowUpCircleLine size={16} className='git-commit-menu-icon' />
              <span>提交并同步</span>
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
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
      <div className='git-panel-empty-state git-panel-init-state'>
        <p>这个工作区还不是 Git 仓库。</p>
        <Button variant='primary' onPress={onInitialize}>
          初始化 Git
        </Button>
      </div>
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
    <TreeItemActionButton
      aria-label={layout === 'tree' ? '切换到列表视图' : '切换到树状视图'}
      title={layout === 'tree' ? '列表视图' : '树状视图'}
      disabled={Boolean(busyLabel)}
      onClick={() => {
        onLayoutChange(layout === 'tree' ? 'list' : 'tree')
      }}
    >
      {layout === 'tree' ? <ListCheckLine size={16} /> : <FolderLine size={16} />}
    </TreeItemActionButton>
  )

  const noopChangeAction = () => {}
  const noopPathAction = () => {}

  const renderHistoryCommitActions = (commit: GitCommitItem) => (
    <TreeItemActionButton
      aria-label={`还原提交 ${commit.shortHash}`}
      title={revertDisabledReason ?? busyLabel ?? '还原提交'}
      disabled={Boolean(busyLabel) || Boolean(revertDisabledReason)}
      onClick={(event) => {
        event.stopPropagation()
        onRevertCommit(commit)
      }}
    >
      <Back2Line size={16} />
    </TreeItemActionButton>
  )

  function renderHistoryList() {
    return (
      <TreeList className='git-history-list'>
        <TreeItem
          icon={(
            <TreeItemIcon>
              <Icon
                icon={historySelection.kind === 'working-tree' ? 'octicon:dot-fill-16' : 'octicon:dot-16'}
                width={16}
                height={16}
                aria-hidden='true'
              />
            </TreeItemIcon>
          )}
          isActive={historySelection.kind === 'working-tree'}
          label='工作树'
          description={repositoryMeta}
          mainButtonProps={{
            title: '工作树',
            onClick: selectWorkingTree,
          }}
        />

        {isHistoryLoading && historyCommits.length === 0 ? (
          <TreeStatusItem>正在加载提交历史...</TreeStatusItem>
        ) : null}

        {historyError ? (
          <TreeStatusItem tone='danger'>{historyError}</TreeStatusItem>
        ) : null}

        {!isHistoryLoading && !historyError && historyCommits.length === 0 ? (
          <TreeStatusItem>暂无历史提交</TreeStatusItem>
        ) : null}

        {historyCommits.map((commit) => {
          const isCommitSelected = selectedCommitHash === commit.hash

          return (
            <TreeItem
              key={commit.hash}
              icon={(
                <TreeItemIcon>
                  {isCommitSelected
                    ? <GitCommitFill size={16} aria-hidden='true' />
                    : <GitCommitLine size={16} aria-hidden='true' />}
                </TreeItemIcon>
              )}
              isActive={isCommitSelected}
              label={commit.subject}
              description={getCommitMeta(commit)}
              actions={renderHistoryCommitActions(commit)}
              mainButtonProps={{
                title: `${commit.subject}\n${getCommitMeta(commit)}\n${commit.hash}`,
                onClick: () => selectCommit(commit.hash),
              }}
            />
          )
        })}
      </TreeList>
    )
  }

  function renderHistoryCommitChildren(commit: GitCommitItem) {
    const details = commitDetailsByHash[commit.hash]
    const isCommitLoading = Boolean(loadingCommitHashes[commit.hash])
    const commitError = commitDetailsErrorsByHash[commit.hash]

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
        onDiscardMany={noopChangeAction}
        onOpenCommitFileDiff={(change) => onOpenCommitFileDiff(details.hash, change)}
        onOpenDiff={noopChangeAction}
        onOpenMeoDiff={noopChangeAction}
        onOpenFile={noopPathAction}
        onStage={noopPathAction}
        onUnstage={noopPathAction}
      />
    )
  }

  function renderHistorySection() {
    return (
      <div className='git-panel-section git-history-section'>
        <TreeItem
          variant='header'
          itemClassName='git-panel-section-header'
          label='历史'
          isExpanded={isHistoryExpanded}
          info={historyCommits.length}
          onToggle={() => setIsHistoryExpanded((value) => !value)}
        />

        {isHistoryExpanded ? (
          <div className='git-history-tree-shell'>
            <TreeList className='git-history-tree-list'>
              {isHistoryLoading && historyCommits.length === 0 ? (
                <TreeStatusItem>正在加载提交历史...</TreeStatusItem>
              ) : null}

              {historyError ? (
                <TreeStatusItem tone='danger'>{historyError}</TreeStatusItem>
              ) : null}

              {!isHistoryLoading && !historyError && historyCommits.length === 0 ? (
                <TreeStatusItem>暂无历史提交</TreeStatusItem>
              ) : null}

              {historyCommits.map((commit) => {
                const isCommitExpanded = Boolean(expandedCommitHashes[commit.hash])
                const commitMeta = getCommitMeta(commit)

                return (
                  <TreeItem
                    key={commit.hash}
                    after={isCommitExpanded ? (
                      <TreeItemChildren className='git-history-commit-children'>
                        <TreeList className='git-history-file-list'>
                          {renderHistoryCommitChildren(commit)}
                        </TreeList>
                      </TreeItemChildren>
                    ) : null}
                    icon={(
                      <TreeItemIcon>
                        {isCommitExpanded
                          ? <GitCommitFill size={16} aria-hidden='true' />
                          : <GitCommitLine size={16} aria-hidden='true' />}
                      </TreeItemIcon>
                    )}
                    label={commit.subject}
                    description={commitMeta}
                    actions={renderHistoryCommitActions(commit)}
                    mainButtonProps={{
                      'aria-expanded': isCommitExpanded,
                      title: `${commit.subject}\n${commitMeta}\n${commit.hash}`,
                      onClick: () => toggleHistoryCommit(commit.hash),
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

  function renderHistoryPane() {
    return (
      <aside className='git-history-pane' aria-label='Git 历史'>
        <TreeScrollArea
          className='git-history-scroll'
          contentClassName='git-history-scroll-content'
        >
          {renderHistoryList()}
        </TreeScrollArea>
      </aside>
    )
  }

  function renderCommitDetailsPane() {
    if (!selectedCommitHash) {
      return null
    }

    const selectedCommitError = commitDetailsErrorsByHash[selectedCommitHash] ?? null
    const isSelectedCommitLoading = Boolean(loadingCommitHashes[selectedCommitHash])

    const renderCommitDetailHeader = (commit: GitCommitItem, changeCount?: number) => (
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
          {renderHistoryCommitActions(commit)}
          {renderLayoutToggleAction()}
        </div>
      </header>
    )

    if (isSelectedCommitLoading && !selectedCommitDetails) {
      return (
        <div className='git-commit-detail'>
          {selectedCommitSummary ? renderCommitDetailHeader(selectedCommitSummary) : null}
          <div className='git-commit-detail-state'>
            <p>正在加载提交文件...</p>
            {selectedCommitSummary ? <span>{selectedCommitSummary.subject}</span> : null}
          </div>
        </div>
      )
    }

    if (selectedCommitError && !selectedCommitDetails) {
      return (
        <div className='git-commit-detail'>
          {selectedCommitSummary ? renderCommitDetailHeader(selectedCommitSummary) : null}
          <div className='git-commit-detail-state git-panel-error'>
            <p>{selectedCommitError}</p>
          </div>
        </div>
      )
    }

    if (!selectedCommitDetails) {
      return (
        <div className='git-commit-detail'>
          {selectedCommitSummary ? renderCommitDetailHeader(selectedCommitSummary) : null}
          <div className='git-commit-detail-state'>
            <p>选择一个提交查看文件变更。</p>
          </div>
        </div>
      )
    }

    return (
      <div className='git-commit-detail'>
        {renderCommitDetailHeader(selectedCommitDetails, selectedCommitDetails.changes.length)}
        <TreeScrollArea
          className='git-panel-sections git-commit-detail-sections'
          contentClassName='git-panel-sections-content'
        >
          {selectedCommitDetails.changes.length === 0 ? (
            <div className='git-panel-empty-state git-commit-detail-state'>
              <p>这个提交没有文件变更。</p>
            </div>
          ) : (
            <GitSection
              title='变更文件'
              changes={selectedCommitDetails.changes}
              kind='commit'
              layout={layout}
              iconTheme={iconTheme}
              onDiscardMany={noopChangeAction}
              onOpenCommitFileDiff={(change) => onOpenCommitFileDiff(selectedCommitDetails.hash, change)}
              onOpenDiff={noopChangeAction}
              onOpenMeoDiff={noopChangeAction}
              onOpenFile={noopPathAction}
              onStage={noopPathAction}
              onUnstage={noopPathAction}
            />
          )}
        </TreeScrollArea>
      </div>
    )
  }

  function renderWorkingTreeContent({ includeHistorySection }: { includeHistorySection: boolean }) {
    return (
    <div className='git-panel'>
      {hasVisibleChanges ? (
        <header className='git-panel-header'>
          <TreeItem
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
                <TreeItemActionButton
                  className={hasUnpushedCommits ? 'git-push-action-with-badge' : undefined}
                  aria-label={pushAccessibleLabel}
                  title={syncDisabledReason ?? pushAccessibleLabel}
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPush}
                >
                  <ArrowUpLine size={16} />
                  {hasUnpushedCommits ? <span className='git-push-action-badge'>{pushBadgeLabel}</span> : null}
                </TreeItemActionButton>
                <TreeItemActionButton
                  aria-label='拉取'
                  title={syncDisabledReason ?? '拉取'}
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPull}
                >
                  <ArrowDownLine size={16} />
                </TreeItemActionButton>
                {renderLayoutToggleAction()}
                <TreeItemActionButton
                  aria-label='刷新 Git 状态'
                  title='刷新'
                  disabled={Boolean(busyLabel)}
                  onClick={onRefresh}
                >
                  <Refresh2Line size={16} />
                </TreeItemActionButton>
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
                <div className='git-commit-actions' role='group' aria-label='提交操作'>
                  <AppTooltipButton
                    type='button'
                    className='git-commit-submit-button'
                    aria-label='提交'
                    disabled={!canSubmitCommit || Boolean(busyLabel)}
                    onClick={onCommit}
                  >
                    <CheckLine size={16} />
                    <span>提交</span>
                  </AppTooltipButton>
                  <GitCommitActionMenu
                    canSubmitCommit={canSubmitCommit}
                    isBusy={Boolean(busyLabel)}
                    menuPortalTarget={menuPortalTarget}
                    syncDisabledReason={syncDisabledReason}
                    onCommit={onCommit}
                    onCommitAndSync={onCommitAndSync}
                  />
                </div>
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
              <CheckLine size={28} />
            </div>
            <p>工作区干净</p>
            <span className='git-empty-subtext'>{cleanStateSubtext}</span>
            <div className='git-clean-actions'>
              {hasUnpushedCommits ? (
                <AppTooltipButton
                  type='button'
                  className='git-clean-action'
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPush}
                >
                  <ArrowUpLine size={16} />
                  <span>推送</span>
                </AppTooltipButton>
              ) : null}
              {currentRepositoryState.behind > 0 ? (
                <AppTooltipButton
                  type='button'
                  className='git-clean-action'
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPull}
                >
                  <ArrowDownLine size={16} />
                  <span>拉取</span>
                </AppTooltipButton>
              ) : null}
              <AppTooltipButton
                type='button'
                className='git-clean-action'
                disabled={Boolean(busyLabel)}
                onClick={onRefresh}
              >
                <Refresh2Line size={16} />
                <span>刷新</span>
              </AppTooltipButton>
            </div>
          </div>
        ) : (
          <>
            <GitSection
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
                <TreeItemActionButton
                  aria-label='全部取消暂存'
                  title='全部取消暂存'
                  disabled={Boolean(busyLabel)}
                  onClick={() => onUnstage(stagedPaths)}
                >
                  <Icon icon='mdi:minus' width={16} height={16} />
                </TreeItemActionButton>
              }
            />

            <GitSection
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
                  <TreeItemActionButton
                    aria-label='全部放弃'
                    title='全部放弃'
                    disabled={Boolean(busyLabel)}
                    onClick={onDiscardAll}
                  >
                    <Back2Line size={16} />
                  </TreeItemActionButton>
                  <TreeItemActionButton
                    aria-label='全部暂存'
                    title='全部暂存'
                    disabled={Boolean(busyLabel)}
                    onClick={() => onStage(unstagedPaths)}
                  >
                    <AddLine size={16} />
                  </TreeItemActionButton>
                </>
              }
            />

          </>
        )}
        {includeHistorySection ? renderHistorySection() : null}
      </TreeScrollArea>
    </div>
  )
  }

  const workingTreeContent = renderWorkingTreeContent({ includeHistorySection: isHistoryCompact })

  return (
    <div
      ref={setHistoryShellElement}
      className={`git-panel-history-shell${isHistoryCompact ? ' is-compact' : ''}`}
    >
      {isHistoryCompact ? null : renderHistoryPane()}
      <section
        className='git-panel-detail-pane'
        aria-label={isHistoryCompact || historySelection.kind === 'working-tree' ? '工作树变更' : '提交变更文件'}
      >
        {isHistoryCompact || historySelection.kind === 'working-tree'
          ? workingTreeContent
          : renderCommitDetailsPane()}
      </section>
    </div>
  )
}

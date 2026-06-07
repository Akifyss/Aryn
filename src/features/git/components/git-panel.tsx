import { type ReactNode, useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import {
  AddLine,
  ArrowDownLine,
  ArrowUpLine,
  ArrowUpCircleLine,
  CheckLine,
  CloseCircleLine,
  DownloadLine,
  FolderLine,
  GitBranchLine,
  MarkdownLine,
  Refresh2Line,
  Refresh3Line,
  Back2Line,
  ListCheckLine,
  UploadLine,
} from '@mingcute/react'
import { Icon } from '@iconify/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
import { TreeHeader } from '@/components/tree-header'
import type {
  GitChangeItem,
  GitPanelLayout,
  GitRecentPullItem,
  GitRepositoryState,
} from '@/features/git/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import {
  getSupportedWorkspaceEditorKind,
  supportsMeoEditor,
} from '@/features/workspace/lib/file-types'

type GitPanelProps = {
  busyLabel: string | null
  commitMessage: string
  isLoading: boolean
  layout: GitPanelLayout
  onCommit: () => void
  onCommitAndSync: () => void
  onCommitMessageChange: (value: string) => void
  onDiscardAll: () => void
  onDiscardMany: (changes: GitChangeItem[]) => void
  onInitialize: () => void
  onLayoutChange: (layout: GitPanelLayout) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onPull: () => void
  onPush: () => void
  onRefresh: () => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  repositoryState: GitRepositoryState | null
  workspacePath: string | null
  iconTheme: WorkspaceIconTheme | null
}

type GitPanelSectionKind = 'staged' | 'unstaged' | 'pulled'

type GitDisplayChange = GitChangeItem | GitRecentPullItem

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

function getRepositoryHeading(repositoryState: GitRepositoryState) {
  const branchLabel = repositoryState.branch ?? '当前分支'

  if (!repositoryState.hasCommits) {
    return `${branchLabel} 尚无提交`
  }

  return repositoryState.branch ?? '分离 HEAD'
}

function getRepositoryMeta(repositoryState: GitRepositoryState, workspacePath: string) {
  const parts = [
    repositoryState.repositoryRootPath === workspacePath ? '工作区根 Git 仓库' : '嵌套 Git 仓库',
  ]

  if (repositoryState.ahead > 0) {
    parts.push(`领先 ${repositoryState.ahead}`)
  }

  if (repositoryState.behind > 0) {
    parts.push(`落后 ${repositoryState.behind}`)
  }

  if (repositoryState.unpushedCommits > 0) {
    parts.push(`${repositoryState.unpushedCommits} 个待推送`)
  }

  if (repositoryState.hasChanges) {
    parts.push(`${repositoryState.stagedChanges.length + repositoryState.unstagedChanges.length} 个更改`)
  }

  return parts.join(' / ')
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
  changesCount,
}: {
  kind: GitPanelSectionKind
  onUnstage?: () => void
  onStage?: () => void
  onDiscard?: () => void
  onOpenFile?: () => void
  onOpenMeoDiff?: () => void
  isFolder?: boolean
  change?: GitDisplayChange
  changesCount?: number
}) {
  const scopedChange = change && isScopedGitChange(change) ? change : null
  const hasMeoDiff = change ? supportsMeoDiff(change) : false
  const canOpenFile = Boolean(scopedChange && scopedChange.kind !== 'deleted' && onOpenFile)

  return (
    <div className='git-change-tools'>
      <div className='git-change-actions'>
        {!isFolder && canOpenFile && (
          <button
            type='button'
            className='git-change-action git-change-icon-button'
            aria-label='打开文件'
            title='打开文件'
            onClick={(e) => {
              e.stopPropagation()
              onOpenFile?.()
            }}
          >
            <Icon icon='material-symbols:file-export-outline-rounded' width={16} height={16} />
          </button>
        )}
        {!isFolder && scopedChange && hasMeoDiff && (
          <button
            type='button'
            className='git-change-action git-change-icon-button'
            aria-label='打开 MEO 分屏差异'
            title='打开 MEO 分屏差异'
            onClick={(e) => {
              e.stopPropagation()
              onOpenMeoDiff?.()
            }}
          >
            <MarkdownLine size={16} />
          </button>
        )}

        {kind === 'staged' && (
          <button
            type='button'
            className='git-change-action git-change-icon-button'
            aria-label='取消暂存'
            title='取消暂存'
            onClick={(e) => {
              e.stopPropagation()
              onUnstage?.()
            }}
          >
            <Icon icon='mdi:minus' width={16} height={16} />
          </button>
        )}

        {kind === 'unstaged' && (
          <>
            <button
              type='button'
              className='git-change-action git-change-icon-button'
              aria-label='放弃更改'
              title='放弃更改'
              onClick={(e) => {
                e.stopPropagation()
                onDiscard?.()
              }}
            >
              <Back2Line size={16} />
            </button>
            <button
              type='button'
              className='git-change-action git-change-icon-button'
              aria-label='暂存'
              title='暂存'
              onClick={(e) => {
                e.stopPropagation()
                onStage?.()
              }}
            >
              <AddLine size={16} />
            </button>
          </>
        )}
      </div>

      {scopedChange && (
        <FileChangeStatusBadge
          kind={scopedChange.kind}
          title={getGitChangeKindLabel(scopedChange.kind)}
        />
      )}
      {isFolder && <span className='git-panel-section-count'>{changesCount ?? 0}</span>}
    </div>
  )
}

function GitTreeFolder({
  kind,
  node,
  onDiscardMany,
  onOpenDiff,
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
    <li className='panel-tree-node'>
      <div className='git-tree-folder-row' onClick={() => toggleNode(node.id)}>
        <button type='button' className='git-tree-folder-toggle'>
          <span className='git-panel-section-title'>
            <WorkspaceFileIcon isFolder nodeLabel={node.label} isClosed={isClosed} iconTheme={iconTheme} />
            <span className='panel-tree-label'>{node.label}</span>
          </span>
        </button>

        <GitRowActions
          kind={kind}
          isFolder
          changesCount={node.items.length}
          onStage={() => onStage(paths)}
          onUnstage={() => onUnstage(paths)}
          onDiscard={() => onDiscardMany(activeItems)}
        />
      </div>

      {!isClosed && (
        <div className='panel-tree-children'>
          {node.children.length > 0 && (
            <ul className='panel-tree-list'>
              {node.children.map((child) => (
                <GitTreeFolder
                  key={child.id}
                  kind={kind}
                  node={child}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
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
            </ul>
          )}
          <GitChangeList
            changes={localItems}
            kind={kind}
            onDiscardMany={onDiscardMany}
            onOpenDiff={onOpenDiff}
            onOpenMeoDiff={onOpenMeoDiff}
            onOpenFile={onOpenFile}
            onStage={onStage}
            onUnstage={onUnstage}
            iconTheme={iconTheme}
            layout={layout}
          />
        </div>
      )}
    </li>
  )
}

function GitChangeList({
  changes,
  onDiscardMany,
  onOpenDiff,
  onOpenMeoDiff,
  onOpenFile,
  onStage,
  onUnstage,
  iconTheme,
  kind,
  layout,
}: {
  changes: GitDisplayChange[]
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenMeoDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  iconTheme: WorkspaceIconTheme | null
  kind: GitPanelSectionKind
  layout: GitPanelLayout
}) {
  if (changes.length === 0) {
    return null
  }

  return (
    <ul className='git-change-list'>
      {changes.map((change) => {
        const fileName = getBaseName(change.relativePath)
        const dirLabel = getDirectoryLabel(change.relativePath)
        const isChange = isScopedGitChange(change)

        return (
          <li key={change.path} className='git-change-item'>
            <button
              type='button'
              className='git-change-trigger'
              title={change.relativePath}
              onClick={() => {
                if (isChange) onOpenDiff(change)
                else onOpenFile(change.path)
              }}
            >
              <span className='git-change-copy'>
                <span className='git-change-header'>
                  <WorkspaceFileIcon fileName={fileName} iconTheme={iconTheme} />
                  <span className='panel-tree-label'>{fileName}</span>
                </span>
                {layout === 'list' && dirLabel && (
                  <span className='git-change-meta'>{dirLabel}</span>
                )}
              </span>
            </button>

            <GitRowActions
              kind={kind}
              change={change}
              onStage={() => onStage([change.path])}
              onUnstage={() => onUnstage([change.path])}
              onDiscard={() => onDiscardMany([change as GitChangeItem])}
              onOpenFile={() => onOpenFile(change.path)}
              onOpenMeoDiff={() => isChange && onOpenMeoDiff(change)}
            />
          </li>
        )
      })}
    </ul>
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
      <TreeHeader
        className='git-panel-section-header'
        title={title}
        isExpanded={isExpanded}
        count={changes.length}
        actions={action}
        onToggle={() => setIsExpanded((v) => !v)}
      />

      {isExpanded && changes.length > 0 && (
        <div className={layout === 'tree' ? 'git-panel-tree-shell' : ''}>
          {layout === 'tree' && treeNodes.length > 0 ? (
            <ul className='panel-tree-list'>
              {treeNodes.map((node) => (
                <GitTreeFolder
                  key={node.id}
                  kind={kind}
                  node={node}
                  closedMap={closedMap}
                  toggleNode={toggleNode}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
                  onOpenMeoDiff={onOpenMeoDiff}
                  onOpenFile={onOpenFile}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  iconTheme={iconTheme}
                  layout={layout}
                />
              ))}
              {rootFiles.length > 0 && (
                <GitChangeList
                  changes={rootFiles}
                  kind={kind}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
                  onOpenMeoDiff={onOpenMeoDiff}
                  onOpenFile={onOpenFile}
                  onStage={onStage}
                  onUnstage={onUnstage}
                  iconTheme={iconTheme}
                  layout={layout}
                />
              )}
            </ul>
          ) : (
            <GitChangeList
              changes={changes}
              kind={kind}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
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

export function GitPanel({
  busyLabel,
  commitMessage,
  isLoading,
  layout,
  onCommit,
  onCommitAndSync,
  onCommitMessageChange,
  onDiscardAll,
  onDiscardMany,
  onInitialize,
  onLayoutChange,
  onOpenDiff,
  onOpenFile,
  onOpenMeoDiff,
  onPull,
  onPush,
  onRefresh,
  onStage,
  onUnstage,
  repositoryState,
  workspacePath,
  iconTheme,
}: GitPanelProps) {
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

  const syncDisabledReason = !repositoryState.hasRemote
    ? '配置远程仓库后才能同步'
    : Boolean(busyLabel)
      ? busyLabel
      : null
  const unpushedCommitCount = repositoryState.unpushedCommits
  const hasUnpushedCommits = unpushedCommitCount > 0
  const pushBadgeLabel = unpushedCommitCount > 99 ? '99+' : String(unpushedCommitCount)
  const pushAccessibleLabel = hasUnpushedCommits
    ? `推送 ${unpushedCommitCount} 个待推送提交`
    : '推送'
  const hasVisibleChanges = repositoryState.hasChanges
  const shouldShowCommitWorkflow = repositoryState.hasChanges
  const cleanStateSubtext = getCleanStateSubtext(repositoryState)

  return (
    <div className='git-panel'>
      {hasVisibleChanges ? (
        <header className='git-panel-header'>
          <div className='git-panel-toolbar'>
            {shouldShowCommitWorkflow ? (
              <>
                <button
                  type='button'
                  className='git-toolbar-action git-toolbar-icon-button'
                  aria-label='提交并同步'
                  title={syncDisabledReason ?? '提交并同步'}
                  disabled={!canSubmitCommit || Boolean(syncDisabledReason)}
                  onClick={onCommitAndSync}
                >
                  <ArrowUpCircleLine size={16} />
                </button>
                <button
                  type='button'
                  className='git-toolbar-action git-toolbar-icon-button'
                  aria-label='提交'
                  title='提交'
                  disabled={!canSubmitCommit || Boolean(busyLabel)}
                  onClick={onCommit}
                >
                  <CheckLine size={16} />
                </button>
                <button
                  type='button'
                  className='git-toolbar-action git-toolbar-icon-button'
                  aria-label='全部暂存'
                  title='全部暂存'
                  disabled={unstagedPaths.length === 0 || Boolean(busyLabel)}
                  onClick={() => {
                    onStage(unstagedPaths)
                  }}
                >
                  <AddLine size={16} />
                </button>
                <button
                  type='button'
                  className='git-toolbar-action git-toolbar-icon-button'
                  aria-label='全部取消暂存'
                  title='全部取消暂存'
                  disabled={stagedPaths.length === 0 || Boolean(busyLabel)}
                  onClick={() => {
                    onUnstage(stagedPaths)
                  }}
                >
                  <Icon icon='mdi:minus' width={16} height={16} />
                </button>
              </>
            ) : null}
            <button
              type='button'
              className={`git-toolbar-action git-toolbar-icon-button${hasUnpushedCommits ? ' git-toolbar-action-with-badge' : ''}`}
              aria-label={pushAccessibleLabel}
              title={syncDisabledReason ?? pushAccessibleLabel}
              disabled={Boolean(syncDisabledReason)}
              onClick={onPush}
            >
              <UploadLine size={16} />
              {hasUnpushedCommits ? <span className='git-toolbar-action-badge'>{pushBadgeLabel}</span> : null}
            </button>
            <button
              type='button'
              className='git-toolbar-action git-toolbar-icon-button'
              aria-label='拉取'
              title={syncDisabledReason ?? '拉取'}
              disabled={Boolean(syncDisabledReason)}
              onClick={onPull}
            >
              <DownloadLine size={16} />
            </button>
            <button
              type='button'
              className='git-toolbar-action git-toolbar-icon-button'
              aria-label={layout === 'tree' ? '切换到列表视图' : '切换到树状视图'}
              title={layout === 'tree' ? '列表视图' : '树状视图'}
              disabled={Boolean(busyLabel)}
              onClick={() => {
                onLayoutChange(layout === 'tree' ? 'list' : 'tree')
              }}
            >
              {layout === 'tree' ? <ListCheckLine size={16} /> : <FolderLine size={16} />}
            </button>
            <button
              type='button'
              className='git-toolbar-action git-toolbar-icon-button'
              aria-label='刷新 Git 状态'
              title='刷新'
              disabled={Boolean(busyLabel)}
              onClick={onRefresh}
            >
              <Refresh2Line size={16} />
            </button>
          </div>

          {shouldShowCommitWorkflow ? (
            <div className='git-panel-commit-row'>
              <div className='git-panel-commit-field'>
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
                {commitMessage ? (
                  <button
                    type='button'
                    className='git-panel-commit-clear'
                    aria-label='清空提交信息'
                    title='清空'
                    onClick={() => {
                      onCommitMessageChange('')
                    }}
                  >
                    <CloseCircleLine size={16} />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </header>
      ) : null}

      {busyLabel ? <p className='git-panel-status'>{busyLabel}</p> : null}

      <AppScrollArea
        className='git-panel-sections'
        contentClassName='git-panel-sections-content'
      >
        {!repositoryState.hasChanges ? (
          <div className='git-panel-empty-state git-panel-clean-state'>
            <div className='git-empty-illustration'>
              <CheckLine size={28} />
            </div>
            <p>工作区干净</p>
            <span className='git-empty-subtext'>{cleanStateSubtext}</span>
            <div className='git-clean-actions'>
              {hasUnpushedCommits ? (
                <button
                  type='button'
                  className='git-clean-action'
                  title={syncDisabledReason ?? pushAccessibleLabel}
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPush}
                >
                  <UploadLine size={15} />
                  <span>推送</span>
                </button>
              ) : null}
              {repositoryState.behind > 0 ? (
                <button
                  type='button'
                  className='git-clean-action'
                  title={syncDisabledReason ?? '拉取'}
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPull}
                >
                  <DownloadLine size={15} />
                  <span>拉取</span>
                </button>
              ) : null}
              <button
                type='button'
                className='git-clean-action'
                title='刷新'
                disabled={Boolean(busyLabel)}
                onClick={onRefresh}
              >
                <Refresh2Line size={15} />
                <span>刷新</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <GitSection
              title='已暂存更改'
              changes={repositoryState.stagedChanges}
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
                <button
                  type='button'
                  className='tree-header-action'
                  aria-label='全部取消暂存'
                  title='全部取消暂存'
                  onClick={() => onUnstage(stagedPaths)}
                >
                  <Icon icon='mdi:minus' width={16} height={16} />
                </button>
              }
            />

            <GitSection
              title='更改'
              changes={repositoryState.unstagedChanges}
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
                  <button
                    type='button'
                    className='tree-header-action'
                    aria-label='全部放弃'
                    title='全部放弃'
                    onClick={onDiscardAll}
                  >
                    <Back2Line size={16} />
                  </button>
                  <button
                    type='button'
                    className='tree-header-action'
                    aria-label='全部暂存'
                    title='全部暂存'
                    onClick={() => onStage(unstagedPaths)}
                  >
                    <AddLine size={16} />
                  </button>
                </>
              }
            />

          </>
        )}
      </AppScrollArea>
    </div>
  )
}

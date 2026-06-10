import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
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
  TreeList,
  TreeScrollArea,
} from '@/components/tree'
import { AppTooltipButton } from '@/components/app-tooltip'
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
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'

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
  menuPortalTarget?: HTMLElement | null
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

type GitChangeRowsProps = {
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
        const changeKindLabel = isChange ? getGitChangeKindLabel(change.kind) : undefined
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
            info={isChange ? (
              <FileChangeStatusBadge
                kind={change.kind}
                title={changeKindLabel}
              />
            ) : undefined}
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
  menuPortalTarget,
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
  const syncSummary = getRepositorySyncSummary(repositoryState)

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
        {!repositoryState.hasChanges ? (
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
              {repositoryState.behind > 0 ? (
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
      </TreeScrollArea>
    </div>
  )
}

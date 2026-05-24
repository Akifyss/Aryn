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
  ExternalLinkLine,
  FolderLine,
  GitBranchLine,
  MarkdownLine,
  Refresh2Line,
  Refresh3Line,
  Back2Line,
  ListCheckLine,
  DownLine,
  RightLine,
  UploadLine,
} from '@mingcute/react'
import { Icon } from '@iconify/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import {
  FileChangeStatusBadge,
  WorkspaceFileIcon,
} from '@/components/file-change-visuals'
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
  const branchLabel = repositoryState.branch ?? 'current branch'

  if (!repositoryState.hasCommits) {
    return `No commits yet on ${branchLabel}`
  }

  return repositoryState.branch ?? 'Detached HEAD'
}

function getRepositoryMeta(repositoryState: GitRepositoryState, workspacePath: string) {
  const parts = [
    repositoryState.repositoryRootPath === workspacePath ? 'Workspace root repository' : 'Nested repository',
  ]

  if (repositoryState.ahead > 0) {
    parts.push(`ahead ${repositoryState.ahead}`)
  }

  if (repositoryState.behind > 0) {
    parts.push(`behind ${repositoryState.behind}`)
  }

  if (repositoryState.unpushedCommits > 0) {
    parts.push(`${repositoryState.unpushedCommits} unpushed`)
  }

  if (repositoryState.hasChanges) {
    parts.push(`${repositoryState.stagedChanges.length + repositoryState.unstagedChanges.length} changes`)
  }

  return parts.join(' / ')
}

function getCleanStateSubtext(repositoryState: GitRepositoryState) {
  const syncParts: string[] = []

  if (repositoryState.unpushedCommits > 0) {
    syncParts.push(
      `${repositoryState.unpushedCommits} commit${repositoryState.unpushedCommits === 1 ? '' : 's'} ready to push`,
    )
  }

  if (repositoryState.behind > 0) {
    syncParts.push(
      `${repositoryState.behind} remote commit${repositoryState.behind === 1 ? '' : 's'} ready to pull`,
    )
  }

  return syncParts.length > 0 ? syncParts.join(' / ') : 'All changes are committed'
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
  onOpenDiff,
  onOpenMeoDiff,
  isFolder,
  change,
  changesCount,
}: {
  kind: GitPanelSectionKind
  onUnstage?: () => void
  onStage?: () => void
  onDiscard?: () => void
  onOpenDiff?: () => void
  onOpenMeoDiff?: () => void
  isFolder?: boolean
  change?: GitDisplayChange
  changesCount?: number
}) {
  const isChange = change && isScopedGitChange(change)
  const hasMeoDiff = change ? supportsMeoDiff(change) : false

  return (
    <div className='git-change-tools'>
      <div className='git-change-actions'>
        {!isFolder && isChange && (
          <button
            type='button'
            className='git-change-action git-change-icon-button'
            aria-label='Open diff'
            title={isChange ? 'Open diff' : 'Open file'}
            onClick={(e) => {
              e.stopPropagation()
              onOpenDiff?.()
            }}
          >
            <ExternalLinkLine size={16} />
          </button>
        )}
        {!isFolder && isChange && hasMeoDiff && (
          <button
            type='button'
            className='git-change-action git-change-icon-button'
            aria-label='Open MEO split diff'
            title='Open MEO split diff'
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
            aria-label='Unstage'
            title='Unstage'
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
              aria-label='Discard'
              title='Discard'
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
              aria-label='Stage'
              title='Stage'
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

      {isChange && (
        <FileChangeStatusBadge
          kind={change.kind}
          title={change.kind.charAt(0).toUpperCase() + change.kind.slice(1)}
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
              onOpenDiff={() => isChange && onOpenDiff(change)}
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

  return (
    <div className='git-panel-section'>
      <div
        className='git-panel-section-header'
        role='button'
        tabIndex={0}
        onClick={() => setIsExpanded((v) => !v)}
      >
        <div className='git-panel-section-title-area'>
          {isExpanded ? (
            <DownLine className='git-panel-section-caret' size={14} />
          ) : (
            <RightLine className='git-panel-section-caret' size={14} />
          )}
          <span className='git-panel-section-title'>{title}</span>
        </div>
        <div className='git-panel-section-tools' onClick={(e) => e.stopPropagation()}>
          {action}
          <span className='git-panel-section-count'>{changes.length}</span>
        </div>
      </div>

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
        <p>Select a workspace to inspect Git status.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className='git-panel-empty-state'>
        <p>Loading Git status...</p>
      </div>
    )
  }

  if (!repositoryState?.isRepository) {
    return (
      <div className='git-panel-empty-state git-panel-init-state'>
        <p>This workspace is not a Git repository yet.</p>
        <Button variant='primary' onPress={onInitialize}>
          Initialize Git
        </Button>
      </div>
    )
  }

  const syncDisabledReason = !repositoryState.hasRemote
    ? 'Configure a remote repository to sync'
    : Boolean(busyLabel)
      ? busyLabel
      : null
  const unpushedCommitCount = repositoryState.unpushedCommits
  const hasUnpushedCommits = unpushedCommitCount > 0
  const pushBadgeLabel = unpushedCommitCount > 99 ? '99+' : String(unpushedCommitCount)
  const pushAccessibleLabel = hasUnpushedCommits
    ? `Push ${unpushedCommitCount} unpushed commit${unpushedCommitCount === 1 ? '' : 's'}`
    : 'Push'
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
                  aria-label='Commit and sync'
                  title={syncDisabledReason ?? 'Commit and sync'}
                  disabled={!canSubmitCommit || Boolean(syncDisabledReason)}
                  onClick={onCommitAndSync}
                >
                  <ArrowUpCircleLine size={16} />
                </button>
                <button
                  type='button'
                  className='git-toolbar-action git-toolbar-icon-button'
                  aria-label='Commit'
                  title='Commit'
                  disabled={!canSubmitCommit || Boolean(busyLabel)}
                  onClick={onCommit}
                >
                  <CheckLine size={16} />
                </button>
                <button
                  type='button'
                  className='git-toolbar-action git-toolbar-icon-button'
                  aria-label='Stage all'
                  title='Stage all'
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
                  aria-label='Unstage all'
                  title='Unstage all'
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
              aria-label='Pull'
              title={syncDisabledReason ?? 'Pull'}
              disabled={Boolean(syncDisabledReason)}
              onClick={onPull}
            >
              <DownloadLine size={16} />
            </button>
            <button
              type='button'
              className='git-toolbar-action git-toolbar-icon-button'
              aria-label={layout === 'tree' ? 'Switch to list layout' : 'Switch to tree layout'}
              title={layout === 'tree' ? 'List layout' : 'Tree layout'}
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
              aria-label='Refresh Git status'
              title='Refresh'
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
                  aria-label='Commit message'
                  className='git-commit-textarea'
                  disabled={Boolean(busyLabel)}
                  placeholder='Commit Message'
                  rows={1}
                  onChange={(event) => {
                    onCommitMessageChange(event.target.value)
                  }}
                />
                {commitMessage ? (
                  <button
                    type='button'
                    className='git-panel-commit-clear'
                    aria-label='Clear commit message'
                    title='Clear'
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
            <p>Working tree clean</p>
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
                  <span>Push</span>
                </button>
              ) : null}
              {repositoryState.behind > 0 ? (
                <button
                  type='button'
                  className='git-clean-action'
                  title={syncDisabledReason ?? 'Pull'}
                  disabled={Boolean(syncDisabledReason)}
                  onClick={onPull}
                >
                  <DownloadLine size={15} />
                  <span>Pull</span>
                </button>
              ) : null}
              <button
                type='button'
                className='git-clean-action'
                title='Refresh'
                disabled={Boolean(busyLabel)}
                onClick={onRefresh}
              >
                <Refresh2Line size={15} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <GitSection
              title='Staged Changes'
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
                  className='git-change-action git-change-icon-button'
                  aria-label='Unstage all'
                  onClick={() => onUnstage(stagedPaths)}
                >
                  <Icon icon='mdi:minus' width={14} height={14} />
                </button>
              }
            />

            <GitSection
              title='Changes'
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
                    className='git-change-action git-change-icon-button'
                    title='Discard all'
                    onClick={onDiscardAll}
                  >
                    <Back2Line size={14} />
                  </button>
                  <button
                    type='button'
                    className='git-change-action git-change-icon-button'
                    title='Stage all'
                    onClick={() => onStage(unstagedPaths)}
                  >
                    <AddLine size={14} />
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

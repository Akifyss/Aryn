import { type ReactNode, useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import {
  AddCircleLine,
  ArrowDownLine,
  ArrowRightLine,
  ArrowUpCircleLine,
  ArrowUpLine,
  CheckLine,
  CloseCircleLine,
  DownloadLine,
  ExternalLinkLine,
  FolderLine,
  GitBranchLine,
  ListCheckLine,
  MinusCircleLine,
  Refresh2Line,
  UploadLine,
} from '@mingcute/react'
import type {
  GitChangeItem,
  GitPanelLayout,
  GitRecentPullItem,
  GitRepositoryState,
} from '@/features/git/types'

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
  onPull: () => void
  onPush: () => void
  onRefresh: () => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  repositoryState: GitRepositoryState | null
  workspacePath: string | null
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

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function getDirectoryLabel(relativePath: string) {
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  return segments.join(' / ')
}

function getChangeKindLabel(kind: GitDisplayChange['kind']) {
  switch (kind) {
    case 'added':
      return 'A'
    case 'copied':
      return 'C'
    case 'deleted':
      return 'D'
    case 'modified':
      return 'M'
    case 'renamed':
      return 'R'
    case 'type-changed':
      return 'T'
    case 'untracked':
      return 'U'
    case 'conflicted':
      return '!'
    default:
      return '?'
  }
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

function GitFolderTree({
  kind,
  nodes,
  onDiscardMany,
  onOpenDiff,
  onOpenFile,
  onStage,
  onUnstage,
}: {
  kind: GitPanelSectionKind
  nodes: GitTreeNode[]
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
}) {
  const [closedMap, setClosedMap] = useState<Record<string, boolean>>({})

  function toggleNode(nodeId: string) {
    setClosedMap((currentValue) => ({
      ...currentValue,
      [nodeId]: !currentValue[nodeId],
    }))
  }

  return (
    <ul className='git-tree-list'>
      {nodes.map((node) => {
        const isClosed = closedMap[node.id] ?? false
        const scopedItems = node.items.filter(isScopedGitChange)
        const stageablePaths = scopedItems
          .filter((change) => change.scope === 'unstaged')
          .map((change) => change.path)
        const unstageablePaths = scopedItems
          .filter((change) => change.scope === 'staged')
          .map((change) => change.path)

        return (
          <li key={node.id} className='git-tree-node'>
            <div className='git-tree-folder-row'>
              <button
                type='button'
                className='git-tree-folder-toggle'
                onClick={() => {
                  toggleNode(node.id)
                }}
              >
                <span className='git-panel-section-title'>
                  <ArrowRightLine
                    className={`git-panel-section-caret${isClosed ? '' : ' is-expanded'}`}
                    size={14}
                  />
                  <span>{node.label}</span>
                </span>
              </button>

              <div className='git-change-actions'>
                {kind === 'staged' ? (
                  <button
                    type='button'
                    className='git-change-action git-change-icon-button'
                    aria-label={`Unstage ${node.path}`}
                    title='Unstage'
                    onClick={() => {
                      onUnstage(unstageablePaths)
                    }}
                  >
                    <ArrowDownLine size={16} />
                  </button>
                ) : null}

                {kind === 'unstaged' ? (
                  <>
                    <button
                      type='button'
                      className='git-change-action git-change-icon-button'
                      aria-label={`Discard ${node.path}`}
                      title='Discard'
                      onClick={() => {
                        onDiscardMany(scopedItems.filter((change) => change.scope === 'unstaged'))
                      }}
                    >
                      <Refresh2Line size={16} />
                    </button>
                    <button
                      type='button'
                      className='git-change-action git-change-icon-button'
                      aria-label={`Stage ${node.path}`}
                      title='Stage'
                      onClick={() => {
                        onStage(stageablePaths)
                      }}
                    >
                      <ArrowUpLine size={16} />
                    </button>
                  </>
                ) : null}

                <span className='git-panel-section-count'>{node.items.length}</span>
              </div>
            </div>

            {!isClosed ? (
              <div className='git-tree-node-children'>
                {node.children.length > 0 ? (
                  <GitFolderTree
                    kind={kind}
                    nodes={node.children}
                    onDiscardMany={onDiscardMany}
                    onOpenDiff={onOpenDiff}
                    onOpenFile={onOpenFile}
                    onStage={onStage}
                    onUnstage={onUnstage}
                  />
                ) : null}
                <GitChangeList
                  changes={node.items.filter((change) => !change.relativePath.slice(node.path.length + 1).includes('/'))}
                  kind={kind}
                  onDiscardMany={onDiscardMany}
                  onOpenDiff={onOpenDiff}
                  onOpenFile={onOpenFile}
                  onStage={onStage}
                  onUnstage={onUnstage}
                />
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function GitChangeList({
  changes,
  kind,
  onDiscardMany,
  onOpenDiff,
  onOpenFile,
  onStage,
  onUnstage,
}: {
  changes: GitDisplayChange[]
  kind: GitPanelSectionKind
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
}) {
  if (changes.length === 0) {
    return null
  }

  return (
    <ul className='git-change-list'>
      {changes.map((change) => {
        const fileName = getBaseName(change.relativePath)
        const directoryLabel = getDirectoryLabel(change.relativePath)
        const metaLabel = change.originalPath
          ? `from ${getBaseName(change.originalPath)}`
          : directoryLabel

        return (
          <li className='git-change-item' key={`${kind}:${change.relativePath}`}>
            <button
              type='button'
              className='git-change-trigger'
              title={change.relativePath}
              onClick={() => {
                if (isScopedGitChange(change)) {
                  onOpenDiff(change)
                  return
                }

                onOpenFile(change.path)
              }}
            >
              <span className='git-change-copy'>
                <span className='git-change-path'>{fileName}</span>
                {metaLabel ? <span className='git-change-meta'>{metaLabel}</span> : null}
              </span>
            </button>

            <div className='git-change-actions'>
              {isScopedGitChange(change) ? (
                <button
                  type='button'
                  className='git-change-action git-change-icon-button'
                  aria-label={`Open diff for ${change.relativePath}`}
                  title='Open diff'
                  onClick={() => {
                    onOpenDiff(change)
                  }}
                >
                  <ExternalLinkLine size={16} />
                </button>
              ) : (
                <button
                  type='button'
                  className='git-change-action git-change-icon-button'
                  aria-label={`Open ${change.relativePath}`}
                  title='Open file'
                  onClick={() => {
                    onOpenFile(change.path)
                  }}
                >
                  <ExternalLinkLine size={16} />
                </button>
              )}

              {isScopedGitChange(change) && change.scope === 'unstaged' ? (
                <>
                  <button
                    type='button'
                    className='git-change-action git-change-icon-button'
                    aria-label={`Stage ${change.relativePath}`}
                    title='Stage'
                    onClick={() => {
                      onStage([change.path])
                    }}
                  >
                    <ArrowUpLine size={16} />
                  </button>
                  <button
                    type='button'
                    className='git-change-action git-change-icon-button is-danger'
                    aria-label={`Discard ${change.relativePath}`}
                    title='Discard'
                    onClick={() => {
                      onDiscardMany([change])
                    }}
                  >
                    <MinusCircleLine size={16} />
                  </button>
                </>
              ) : null}

              {isScopedGitChange(change) && change.scope === 'staged' ? (
                <button
                  type='button'
                  className='git-change-action git-change-icon-button'
                  aria-label={`Unstage ${change.relativePath}`}
                  title='Unstage'
                  onClick={() => {
                    onUnstage([change.path])
                  }}
                >
                  <ArrowDownLine size={16} />
                </button>
              ) : null}

              <span className={`git-change-badge git-change-badge-${change.kind}`}>
                {getChangeKindLabel(change.kind)}
              </span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function GitSection({
  action,
  changes,
  emptyLabel,
  kind,
  layout,
  onDiscardMany,
  onOpenDiff,
  onOpenFile,
  onStage,
  onUnstage,
  title,
}: {
  action?: ReactNode
  changes: GitDisplayChange[]
  emptyLabel: string
  kind: GitPanelSectionKind
  layout: GitPanelLayout
  onDiscardMany: (changes: GitChangeItem[]) => void
  onOpenDiff: (change: GitChangeItem) => void
  onOpenFile: (filePath: string) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  title: string
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const treeNodes = useMemo(() => buildGitTree(changes), [changes])
  const flatChanges = useMemo(
    () => changes.filter((change) => !change.relativePath.includes('/')),
    [changes],
  )

  return (
    <section className='git-panel-section'>
      <div className='git-panel-section-header'>
        <button
          type='button'
          className='git-panel-section-toggle'
          aria-expanded={isExpanded}
          onClick={() => {
            setIsExpanded((currentValue) => !currentValue)
          }}
        >
          <span className='git-panel-section-title'>
            <ArrowRightLine
              className={`git-panel-section-caret${isExpanded ? ' is-expanded' : ''}`}
              size={14}
            />
            <span>{title}</span>
          </span>
        </button>
        <div className='git-panel-section-tools'>
          {action}
          <span className='git-panel-section-count'>{changes.length}</span>
        </div>
      </div>

      {isExpanded ? (
        changes.length > 0 ? (
          layout === 'tree' && treeNodes.length > 0 ? (
            <div className='git-panel-tree-shell'>
              <GitFolderTree
                kind={kind}
                nodes={treeNodes}
                onDiscardMany={onDiscardMany}
                onOpenDiff={onOpenDiff}
                onOpenFile={onOpenFile}
                onStage={onStage}
                onUnstage={onUnstage}
              />
              <GitChangeList
                changes={flatChanges}
                kind={kind}
                onDiscardMany={onDiscardMany}
                onOpenDiff={onOpenDiff}
                onOpenFile={onOpenFile}
                onStage={onStage}
                onUnstage={onUnstage}
              />
            </div>
          ) : (
            <GitChangeList
              changes={changes}
              kind={kind}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
            />
          )
        ) : (
          <p className='git-panel-empty-copy'>{emptyLabel}</p>
        )
      ) : null}
    </section>
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
  onPull,
  onPush,
  onRefresh,
  onStage,
  onUnstage,
  repositoryState,
  workspacePath,
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
    ? repositoryState.hasChanges
      ? commitMessage.trim().length > 0
      : true
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

  return (
    <div className='git-panel'>
      <header className='git-panel-header'>
        <div className='git-panel-toolbar'>
          <button
            type='button'
            className='git-toolbar-action git-toolbar-icon-button'
            aria-label='Commit and sync'
            title='Commit and sync'
            disabled={!canSubmitCommit || Boolean(busyLabel)}
            onClick={onCommitAndSync}
          >
            <ArrowUpCircleLine size={17} />
          </button>
          <button
            type='button'
            className='git-toolbar-action git-toolbar-icon-button'
            aria-label='Commit'
            title='Commit'
            disabled={!repositoryState.hasChanges || commitMessage.trim().length === 0 || Boolean(busyLabel)}
            onClick={onCommit}
          >
            <CheckLine size={17} />
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
            <AddCircleLine size={17} />
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
            <MinusCircleLine size={17} />
          </button>
          <button
            type='button'
            className={`git-toolbar-action git-toolbar-icon-button${repositoryState.unpushedCommits > 0 ? ' is-accent' : ''}`}
            aria-label='Push'
            title='Push'
            disabled={Boolean(busyLabel)}
            onClick={onPush}
          >
            <UploadLine size={17} />
          </button>
          <button
            type='button'
            className='git-toolbar-action git-toolbar-icon-button'
            aria-label='Pull'
            title='Pull'
            disabled={Boolean(busyLabel)}
            onClick={onPull}
          >
            <DownloadLine size={17} />
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
            {layout === 'tree' ? <ListCheckLine size={17} /> : <FolderLine size={17} />}
          </button>
          <button
            type='button'
            className='git-toolbar-action git-toolbar-icon-button'
            aria-label='Refresh Git status'
            title='Refresh'
            disabled={Boolean(busyLabel)}
            onClick={onRefresh}
          >
            <Refresh2Line size={17} />
          </button>
        </div>

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
      </header>

      <div className='git-panel-summary'>
        <span className='git-panel-summary-label'>
          <GitBranchLine size={14} />
          Git
        </span>
        <div className='git-panel-summary-copy'>
          <strong className='git-panel-summary-primary'>{getRepositoryHeading(repositoryState)}</strong>
          <span className='git-panel-summary-secondary'>{getRepositoryMeta(repositoryState, workspacePath)}</span>
        </div>
      </div>

      {busyLabel ? <p className='git-panel-status'>{busyLabel}</p> : null}

      <div className='git-panel-sections'>
        {!repositoryState.hasChanges && repositoryState.recentlyPulledChanges.length === 0 ? (
          <div className='git-panel-empty-state git-panel-clean-state'>
            <GitBranchLine size={18} />
            <p>Working tree clean.</p>
          </div>
        ) : (
          <>
            <GitSection
              action={repositoryState.stagedChanges.length > 0 ? (
                <button
                  type='button'
                  className='git-change-action git-change-icon-button'
                  aria-label='Unstage all staged changes'
                  title='Unstage all'
                  onClick={() => {
                    onUnstage(stagedPaths)
                  }}
                >
                  <ArrowDownLine size={14} />
                </button>
              ) : null}
              changes={repositoryState.stagedChanges}
              emptyLabel='No staged changes.'
              kind='staged'
              layout={layout}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              title='Staged Changes'
            />

            <GitSection
              action={repositoryState.unstagedChanges.length > 0 ? (
                <>
                  <button
                    type='button'
                    className='git-change-action git-change-icon-button'
                    aria-label='Discard all working tree changes'
                    title='Discard all'
                    onClick={onDiscardAll}
                  >
                    <Refresh2Line size={14} />
                  </button>
                  <button
                    type='button'
                    className='git-change-action git-change-icon-button'
                    aria-label='Stage all working tree changes'
                    title='Stage all'
                    onClick={() => {
                      onStage(unstagedPaths)
                    }}
                  >
                    <ArrowUpLine size={14} />
                  </button>
                </>
              ) : null}
              changes={repositoryState.unstagedChanges}
              emptyLabel='No working tree changes.'
              kind='unstaged'
              layout={layout}
              onDiscardMany={onDiscardMany}
              onOpenDiff={onOpenDiff}
              onOpenFile={onOpenFile}
              onStage={onStage}
              onUnstage={onUnstage}
              title='Changes'
            />

            {repositoryState.recentlyPulledChanges.length > 0 ? (
              <GitSection
                changes={repositoryState.recentlyPulledChanges}
                emptyLabel='No recently pulled files.'
                kind='pulled'
                layout={layout}
                onDiscardMany={onDiscardMany}
                onOpenDiff={onOpenDiff}
                onOpenFile={onOpenFile}
                onStage={onStage}
                onUnstage={onUnstage}
                title='Recently Pulled Files'
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}

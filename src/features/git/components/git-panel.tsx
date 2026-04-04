import { type ReactNode, useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import {
  ArrowDownLine,
  ArrowRightLine,
  ArrowUpLine,
  CheckLine,
  ExternalLinkLine,
  GitBranchLine,
  MinusCircleLine,
  Refresh2Line,
} from '@mingcute/react'
import type { GitChangeItem, GitRepositoryState } from '@/features/git/types'

type GitPanelProps = {
  busyLabel: string | null
  commitMessage: string
  errorMessage: string | null
  isLoading: boolean
  onCommit: () => void
  onCommitMessageChange: (value: string) => void
  onDiscard: (change: GitChangeItem) => void
  onInitialize: () => void
  onOpenDiff: (change: GitChangeItem) => void
  onRefresh: () => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  repositoryState: GitRepositoryState | null
  workspacePath: string | null
}

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function getDirectoryLabel(relativePath: string) {
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  return segments.join(' / ')
}

function getChangeKindLabel(kind: GitChangeItem['kind']) {
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
    default:
      return '!'
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

  if (repositoryState.hasChanges) {
    parts.push(`${repositoryState.stagedChanges.length + repositoryState.unstagedChanges.length} changes`)
  }

  return parts.join(' / ')
}

function GitSection({
  action,
  changes,
  emptyLabel,
  onDiscard,
  onOpenDiff,
  onStage,
  onUnstage,
  scope,
  title,
}: {
  action?: ReactNode
  changes: GitChangeItem[]
  emptyLabel: string
  onDiscard: (change: GitChangeItem) => void
  onOpenDiff: (change: GitChangeItem) => void
  onStage: (filePaths: string[]) => void
  onUnstage: (filePaths: string[]) => void
  scope: GitChangeItem['scope']
  title: string
}) {
  const [isExpanded, setIsExpanded] = useState(true)

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
          <ul className='git-change-list'>
            {changes.map((change) => {
              const fileName = getBaseName(change.relativePath)
              const directoryLabel = getDirectoryLabel(change.relativePath)
              const metaLabel = change.originalPath
                ? `from ${getBaseName(change.originalPath)}`
                : directoryLabel

              return (
                <li className='git-change-item' key={`${scope}:${change.relativePath}`}>
                  <button
                    type='button'
                    className='git-change-trigger'
                    title={change.relativePath}
                    onClick={() => {
                      onOpenDiff(change)
                    }}
                  >
                    <span className='git-change-copy'>
                      <span className='git-change-path'>{fileName}</span>
                      {metaLabel ? <span className='git-change-meta'>{metaLabel}</span> : null}
                    </span>
                  </button>

                  <div className='git-change-actions'>
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

                    {scope === 'unstaged' ? (
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
                            onDiscard(change)
                          }}
                        >
                          <MinusCircleLine size={16} />
                        </button>
                      </>
                    ) : (
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
                    )}

                    <span className={`git-change-badge git-change-badge-${change.kind}`}>
                      {getChangeKindLabel(change.kind)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
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
  errorMessage,
  isLoading,
  onCommit,
  onCommitMessageChange,
  onDiscard,
  onInitialize,
  onOpenDiff,
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
        {errorMessage ? <p className='git-panel-error'>{errorMessage}</p> : null}
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
            aria-label='Stage all changes'
            title='Stage all'
            disabled={unstagedPaths.length === 0 || Boolean(busyLabel)}
            onClick={() => {
              onStage(unstagedPaths)
            }}
          >
            <ArrowUpLine size={16} />
          </button>
          <button
            type='button'
            className='git-toolbar-action git-toolbar-icon-button'
            aria-label='Unstage all changes'
            title='Unstage all'
            disabled={stagedPaths.length === 0 || Boolean(busyLabel)}
            onClick={() => {
              onUnstage(stagedPaths)
            }}
          >
            <ArrowDownLine size={16} />
          </button>
          <button
            type='button'
            className='git-toolbar-action git-toolbar-icon-button'
            aria-label='Refresh Git status'
            title='Refresh'
            onClick={onRefresh}
          >
            <Refresh2Line size={16} />
          </button>
        </div>

        <div className='git-panel-commit-row'>
          <textarea
            value={commitMessage}
            aria-label='Commit message'
            className='git-commit-textarea'
            disabled={Boolean(busyLabel)}
            placeholder='Commit message'
            rows={1}
            onChange={(event) => {
              onCommitMessageChange(event.target.value)
            }}
          />

          <div className='git-panel-commit-actions'>
            <Button
              isDisabled={(stagedPaths.length === 0 && unstagedPaths.length === 0) || commitMessage.trim().length === 0 || Boolean(busyLabel)}
              onPress={onCommit}
              variant='primary'
            >
              <CheckLine size={16} />
              Commit
            </Button>
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
      {errorMessage ? <p className='git-panel-error'>{errorMessage}</p> : null}

      <div className='git-panel-sections'>
        {!repositoryState.hasChanges ? (
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
              onDiscard={onDiscard}
              onOpenDiff={onOpenDiff}
              onStage={onStage}
              onUnstage={onUnstage}
              scope='staged'
              title='Staged Changes'
            />
            <GitSection
              action={repositoryState.unstagedChanges.length > 0 ? (
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
              ) : null}
              changes={repositoryState.unstagedChanges}
              emptyLabel='No working tree changes.'
              onDiscard={onDiscard}
              onOpenDiff={onOpenDiff}
              onStage={onStage}
              onUnstage={onUnstage}
              scope='unstaged'
              title='Changes'
            />
          </>
        )}
      </div>
    </div>
  )
}

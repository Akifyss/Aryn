import type { SupportedWorkspaceEditorKind } from '@/features/workspace/lib/file-types'

export type GitChangeScope = 'staged' | 'unstaged'
export type GitDiffBlockAction = 'discard' | 'stage' | 'unstage'

export type GitPanelLayout = 'list' | 'tree'

export type GitChangeKind =
  | 'added'
  | 'copied'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'type-changed'
  | 'untracked'
  | 'conflicted'

export type GitChangeItem = {
  kind: GitChangeKind
  originalPath: string | null
  path: string
  relativePath: string
  scope: GitChangeScope
  statusCode: string
}

export type GitRecentPullItem = {
  kind: Exclude<GitChangeKind, 'conflicted' | 'untracked'>
  originalPath: string | null
  path: string
  relativePath: string
  statusCode: string
}

export type GitDisplayChange = GitChangeItem | GitRecentPullItem

export type GitRepositoryState = {
  ahead: number
  behind: number
  branch: string | null
  hasCommits: boolean
  hasChanges: boolean
  hasRemote: boolean
  isRepository: boolean
  recentlyPulledChanges: GitRecentPullItem[]
  remoteCount: number
  repositoryRootPath: string | null
  stagedChanges: GitChangeItem[]
  unpushedCommits: number
  unstagedChanges: GitChangeItem[]
  workspacePath: string
}

export type GitBlameResult =
  | {
    kind: 'commit'
    author: string
    authorMail?: string
    authorTimeUnix: number
    commit: string
    gitPathAtCommit?: string
    originalLineNumber?: number
    shortCommit: string
    summary: string
  }
  | {
    kind: 'uncommitted'
  }
  | {
    kind: 'unavailable'
    reason: 'not-repo' | 'untracked' | 'git-unavailable' | 'error'
  }

export type GitBaselinePayload = {
  available: boolean
  tracked: boolean
  repoRoot: string | null
  gitPath: string | null
  headOid: string | null
  baseText: string | null
  indexText?: string | null
  reason?: 'not-repo' | 'untracked' | 'git-unavailable' | 'error'
}

export type GitFileDiffResult = {
  change: GitChangeItem
  editorKind: SupportedWorkspaceEditorKind
  modifiedContent: string
  modifiedExists: boolean
  modifiedLabel: string
  originalContent: string
  originalExists: boolean
  originalLabel: string
  repositoryRootPath: string
  selections: GitDiffSelection[]
}

export type GitDiffSelection = {
  originalLineCount: number
  originalStartLine: number
  modifiedLineCount: number
  modifiedStartLine: number
}

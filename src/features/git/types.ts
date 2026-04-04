import type { SupportedWorkspaceEditorKind } from '@/features/workspace/lib/file-types'

export type GitChangeScope = 'staged' | 'unstaged'

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

export type GitRepositoryState = {
  ahead: number
  behind: number
  branch: string | null
  hasCommits: boolean
  hasChanges: boolean
  isRepository: boolean
  repositoryRootPath: string | null
  stagedChanges: GitChangeItem[]
  unstagedChanges: GitChangeItem[]
  workspacePath: string
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
}

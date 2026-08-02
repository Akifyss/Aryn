export * from '../upstream/bb/packages/server-contract/src/thread-timeline'

export type GitDiffFileChangeKind =
  | 'added'
  | 'copied'
  | 'deleted'
  | 'modified'
  | 'renamed'
  | 'type_changed'

export type ThreadContextWindowUsage = {
  estimated: boolean
  modelContextWindow: number
  usedTokens: number
}

export type TimelinePaginationCursor = {
  beforeSeq?: number
}

export type ThreadTimelineResponse = {
  activeThinking: import('@bb/domain').ActiveThinking | null
  rows: import('../upstream/bb/packages/server-contract/src/thread-timeline').TimelineRow[]
}

import type { GitChangeKind, GitChangeScope } from '@/features/git/types'

type GitDisplayChangeSummary = {
  kind: GitChangeKind
  scope?: GitChangeScope
}

function getGitChangePriority(change: GitDisplayChangeSummary) {
  if (change.kind === 'conflicted') {
    return 0
  }

  if (change.kind === 'untracked') {
    return 1
  }

  if (change.kind === 'deleted') {
    return change.scope === 'unstaged' ? 2 : 4
  }

  if (
    change.kind === 'modified'
    || change.kind === 'renamed'
    || change.kind === 'copied'
    || change.kind === 'type-changed'
  ) {
    return change.scope === 'unstaged' ? 3 : 5
  }

  return 6
}

export function pickDominantGitDisplayChange<
  T extends GitDisplayChangeSummary
>(changes: T[]): T | null {
  let dominantChange: T | null = null

  for (const change of changes) {
    if (!dominantChange || getGitChangePriority(change) < getGitChangePriority(dominantChange)) {
      dominantChange = change
    }
  }

  return dominantChange
}

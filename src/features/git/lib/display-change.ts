import type { GitChangeKind, GitDisplayChange } from '@/features/git/types'

const GIT_CHANGE_PRIORITY: Record<GitChangeKind, number> = {
  conflicted: 0,
  deleted: 1,
  modified: 2,
  renamed: 2,
  copied: 2,
  'type-changed': 2,
  added: 3,
  untracked: 3,
}

export function pickDominantGitDisplayChange<T extends Pick<GitDisplayChange, 'kind'>>(changes: T[]): T | null {
  let dominantChange: T | null = null

  for (const change of changes) {
    if (!dominantChange || GIT_CHANGE_PRIORITY[change.kind] < GIT_CHANGE_PRIORITY[dominantChange.kind]) {
      dominantChange = change
    }
  }

  return dominantChange
}

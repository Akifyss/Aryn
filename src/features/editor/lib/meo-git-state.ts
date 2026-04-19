import type { GitBaselinePayload, GitRepositoryState } from '@/features/git/types'

export function getGitStateRefreshKey(repositoryState: GitRepositoryState | null | undefined) {
  if (!repositoryState) {
    return 'no-state'
  }

  return JSON.stringify({
    ahead: repositoryState.ahead,
    behind: repositoryState.behind,
    branch: repositoryState.branch,
    hasChanges: repositoryState.hasChanges,
    hasCommits: repositoryState.hasCommits,
    isRepository: repositoryState.isRepository,
    repositoryRootPath: repositoryState.repositoryRootPath,
    stagedChanges: repositoryState.stagedChanges.map((change) => ({
      kind: change.kind,
      path: change.path,
      scope: change.scope,
      statusCode: change.statusCode,
    })),
    unstagedChanges: repositoryState.unstagedChanges.map((change) => ({
      kind: change.kind,
      path: change.path,
      scope: change.scope,
      statusCode: change.statusCode,
    })),
  })
}

export function getUnavailableGitBaseline(reason: GitBaselinePayload['reason']): GitBaselinePayload {
  return {
    available: false,
    baseText: null,
    gitPath: null,
    headOid: null,
    reason,
    repoRoot: null,
    tracked: false,
  }
}

import type {
  GitChangeItem,
  GitChangeScope,
  GitRepositoryState,
} from '@/features/git/types'
import { normalizeFilePath } from '@/features/workspace/lib/workspace-paths'

export function findGitChangeByFilePath(
  repositoryState: GitRepositoryState | null,
  filePath: string,
  preferredScopes: GitChangeScope[] = ['unstaged', 'staged'],
): GitChangeItem | null {
  if (!repositoryState?.isRepository) {
    return null
  }

  const targetPath = normalizeFilePath(filePath)
  const changesByScope: Record<GitChangeScope, GitChangeItem[]> = {
    staged: repositoryState.stagedChanges,
    unstaged: repositoryState.unstagedChanges,
  }

  for (const scope of preferredScopes) {
    const matchingChange = changesByScope[scope].find(
      (change) => normalizeFilePath(change.path) === targetPath,
    )

    if (matchingChange) {
      return matchingChange
    }
  }

  return null
}

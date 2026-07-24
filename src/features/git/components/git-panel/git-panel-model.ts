import type {
  GitChangeItem,
  GitCommitItem,
  GitDisplayChange,
  GitRepositoryState,
} from '@/features/git/types'
import {
  getSupportedWorkspaceEditorKind,
  supportsMeoEditor,
} from '@/features/workspace/lib/file-types'

export type GitHistorySelection =
  | {
    kind: 'working-tree'
  }
  | {
    commitHash: string
    kind: 'commit'
  }

export type GitTreeNode = {
  children: GitTreeNode[]
  id: string
  items: GitDisplayChange[]
  label: string
  path: string
}

type GitTreeNodeDraft = Omit<GitTreeNode, 'children'> & {
  childrenMap: Map<string, GitTreeNodeDraft>
}

export function isScopedGitChange(
  change: GitDisplayChange,
): change is GitChangeItem {
  return 'scope' in change
}

export function supportsMeoDiff(change: GitDisplayChange) {
  if (!isScopedGitChange(change)) {
    return false
  }

  const editorKind = getSupportedWorkspaceEditorKind(change.path)
  return editorKind ? supportsMeoEditor(change.path, editorKind) : false
}

export function getDirectoryLabel(relativePath: string) {
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  return segments.join(' / ')
}

export function getCommitChangeCountLabel(count: number) {
  return `${count} 个变更文件`
}

export function formatCommitRelativeTime(authorTimeUnix: number) {
  if (!authorTimeUnix) {
    return '未知时间'
  }

  const diffSeconds = authorTimeUnix - Date.now() / 1000
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
  ]
  const formatter = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' })

  for (const [unit, secondsPerUnit] of units) {
    if (Math.abs(diffSeconds) >= secondsPerUnit) {
      return formatter.format(Math.round(diffSeconds / secondsPerUnit), unit)
    }
  }

  return '刚刚'
}

export function getCommitMeta(commit: GitCommitItem) {
  return `${commit.authorName} · ${formatCommitRelativeTime(commit.authorTimeUnix)} · ${commit.shortHash}`
}

export function getSelectedCommitHash(selection: GitHistorySelection) {
  return selection.kind === 'commit' ? selection.commitHash : null
}

export function getRepositoryHeading(repositoryState: GitRepositoryState) {
  const branchLabel = repositoryState.branch ?? '当前分支'

  if (!repositoryState.hasCommits) {
    return `${branchLabel} 尚无提交`
  }

  return repositoryState.branch ?? '分离 HEAD'
}

export function getCleanStateSubtext(repositoryState: GitRepositoryState) {
  const syncParts: string[] = []

  if (repositoryState.unpushedCommits > 0) {
    syncParts.push(`${repositoryState.unpushedCommits} 个提交待推送`)
  }

  if (repositoryState.behind > 0) {
    syncParts.push(`${repositoryState.behind} 个远程提交待拉取`)
  }

  return syncParts.length > 0 ? syncParts.join(' / ') : '所有更改已提交'
}

export function getGitChangeKindLabel(kind: GitDisplayChange['kind']) {
  switch (kind) {
    case 'added':
      return '新增'
    case 'copied':
      return '复制'
    case 'conflicted':
      return '冲突'
    case 'deleted':
      return '删除'
    case 'modified':
      return '修改'
    case 'renamed':
      return '重命名'
    case 'type-changed':
      return '类型变更'
    case 'untracked':
      return '未跟踪'
  }
}

export function buildGitTree(changes: GitDisplayChange[]) {
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
      .map((node) => ({
        children: materialize(node.childrenMap.values()),
        id: node.id,
        items: node.items,
        label: node.label,
        path: node.path,
      }))
      .sort((left, right) => left.path.localeCompare(right.path))
  }

  return materialize(root.values())
}

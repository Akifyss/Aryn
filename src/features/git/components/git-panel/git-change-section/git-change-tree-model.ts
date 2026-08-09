import type { VirtualizedTreeRowAriaMetadata } from '@/components/tree'
import type { GitDisplayChange, GitPanelLayout } from '@/features/git/types'
import { buildGitTree, type GitTreeNode } from '../git-panel-model'

type GitChangeTreeRowBase = {
  aria: VirtualizedTreeRowAriaMetadata
  depth: number
  key: string
}

export type GitChangeTreeFolderRow = GitChangeTreeRowBase & {
  kind: 'folder'
  node: GitTreeNode
}

export type GitChangeTreeFileRow = GitChangeTreeRowBase & {
  change: GitDisplayChange
  kind: 'change'
}

export type GitChangeTreeRow = GitChangeTreeFolderRow | GitChangeTreeFileRow

function getGitChangeRowKey(change: GitDisplayChange) {
  const scope = 'scope' in change ? change.scope : 'commit'
  return `change:${scope}:${change.kind}:${change.path}`
}

function getLocalChanges(node: GitTreeNode) {
  return node.items.filter((item) => {
    const separatorIndex = item.relativePath.lastIndexOf('/')
    const parentPath = separatorIndex < 0 ? '' : item.relativePath.substring(0, separatorIndex)
    return parentPath === node.path
  })
}

function createFlatRows(changes: readonly GitDisplayChange[]): GitChangeTreeRow[] {
  const setSize = changes.length
  return changes.map((change, index) => ({
    aria: {
      level: 1,
      positionInSet: index + 1,
      setSize,
    },
    change,
    depth: 0,
    key: getGitChangeRowKey(change),
    kind: 'change',
  }))
}

type PendingTreeItem =
  | {
    depth: number
    kind: 'folder'
    node: GitTreeNode
    positionInSet: number
    setSize: number
  }
  | {
    change: GitDisplayChange
    depth: number
    kind: 'change'
    positionInSet: number
    setSize: number
  }

export function createGitChangeTreeRows(
  changes: readonly GitDisplayChange[],
  layout: GitPanelLayout,
  closedMap: Readonly<Record<string, boolean>>,
  preparedTreeNodes?: readonly GitTreeNode[],
): GitChangeTreeRow[] {
  if (layout === 'list') return createFlatRows(changes)

  const treeNodes = preparedTreeNodes ?? buildGitTree([...changes])
  const rootChanges = changes.filter((change) => !change.relativePath.includes('/'))
  const rootSetSize = treeNodes.length + rootChanges.length
  const pending: PendingTreeItem[] = []

  for (let index = rootChanges.length - 1; index >= 0; index -= 1) {
    pending.push({
      change: rootChanges[index],
      depth: 0,
      kind: 'change',
      positionInSet: treeNodes.length + index + 1,
      setSize: rootSetSize,
    })
  }
  for (let index = treeNodes.length - 1; index >= 0; index -= 1) {
    pending.push({
      depth: 0,
      kind: 'folder',
      node: treeNodes[index],
      positionInSet: index + 1,
      setSize: rootSetSize,
    })
  }

  const rows: GitChangeTreeRow[] = []
  while (pending.length > 0) {
    const item = pending.pop()
    if (!item) break

    const aria = {
      level: item.depth + 1,
      positionInSet: item.positionInSet,
      setSize: item.setSize,
    }
    if (item.kind === 'change') {
      rows.push({
        aria,
        change: item.change,
        depth: item.depth,
        key: getGitChangeRowKey(item.change),
        kind: 'change',
      })
      continue
    }

    rows.push({
      aria,
      depth: item.depth,
      key: `folder:${item.node.id}`,
      kind: 'folder',
      node: item.node,
    })
    if (closedMap[item.node.id]) continue

    const localChanges = getLocalChanges(item.node)
    const childSetSize = item.node.children.length + localChanges.length
    const childDepth = item.depth + 1
    for (let index = localChanges.length - 1; index >= 0; index -= 1) {
      pending.push({
        change: localChanges[index],
        depth: childDepth,
        kind: 'change',
        positionInSet: item.node.children.length + index + 1,
        setSize: childSetSize,
      })
    }
    for (let index = item.node.children.length - 1; index >= 0; index -= 1) {
      pending.push({
        depth: childDepth,
        kind: 'folder',
        node: item.node.children[index],
        positionInSet: index + 1,
        setSize: childSetSize,
      })
    }
  }

  return rows
}

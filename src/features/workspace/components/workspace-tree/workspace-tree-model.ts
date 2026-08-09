import type { VirtualizedTreeRowAriaMetadata } from '@/components/tree'
import type { WorkspaceNode } from '@/features/workspace/types'

export type WorkspaceTreeRow = {
  aria: VirtualizedTreeRowAriaMetadata
  depth: number
  key: string
  node: WorkspaceNode
}

type PendingWorkspaceTreeRow = {
  depth: number
  node: WorkspaceNode
  positionInSet: number
  setSize: number
}

export function getWorkspaceTreeRowKey(path: string) {
  return `workspace:${path}`
}

export function createVisibleWorkspaceTreeRows(
  nodes: readonly WorkspaceNode[],
  expandedPaths: ReadonlySet<string>,
): WorkspaceTreeRow[] {
  const rows: WorkspaceTreeRow[] = []
  const pendingRows: PendingWorkspaceTreeRow[] = []

  for (let nodeIndex = nodes.length - 1; nodeIndex >= 0; nodeIndex -= 1) {
    const node = nodes[nodeIndex]
    if (!node) continue

    pendingRows.push({
      depth: 0,
      node,
      positionInSet: nodeIndex + 1,
      setSize: nodes.length,
    })
  }

  while (pendingRows.length > 0) {
    const pendingRow = pendingRows.pop()
    if (!pendingRow) continue

    const { depth, node, positionInSet, setSize } = pendingRow
    rows.push({
      aria: {
        level: depth + 1,
        positionInSet,
        setSize,
      },
      depth,
      key: getWorkspaceTreeRowKey(node.path),
      node,
    })

    if (
      node.kind !== 'directory'
      || !expandedPaths.has(node.path)
      || !node.children?.length
    ) {
      continue
    }

    for (let childIndex = node.children.length - 1; childIndex >= 0; childIndex -= 1) {
      const child = node.children[childIndex]
      if (!child) continue

      pendingRows.push({
        depth: depth + 1,
        node: child,
        positionInSet: childIndex + 1,
        setSize: node.children.length,
      })
    }
  }

  return rows
}

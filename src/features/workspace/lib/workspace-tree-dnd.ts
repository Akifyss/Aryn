import type { WorkspaceNode } from '@/features/workspace/types'

export function normalizeWorkspacePath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function areSameWorkspacePaths(leftPath: string | null | undefined, rightPath: string | null | undefined) {
  if (!leftPath || !rightPath) {
    return false
  }

  return normalizeWorkspacePath(leftPath) === normalizeWorkspacePath(rightPath)
}

export function getParentDirectoryPath(filePath: string) {
  const trimmedPath = filePath.replace(/[\\/]+$/, '')
  const lastSeparatorIndex = Math.max(trimmedPath.lastIndexOf('/'), trimmedPath.lastIndexOf('\\'))

  if (lastSeparatorIndex <= 0) {
    return null
  }

  return trimmedPath.slice(0, lastSeparatorIndex)
}

export function isSamePathOrDescendant(targetPath: string, parentPath: string) {
  const normalizedTargetPath = normalizeWorkspacePath(targetPath)
  const normalizedParentPath = normalizeWorkspacePath(parentPath)

  return normalizedTargetPath === normalizedParentPath || normalizedTargetPath.startsWith(`${normalizedParentPath}/`)
}

export function canMoveNodeToDirectory(node: WorkspaceNode | null, targetDirectoryPath: string) {
  if (!node) {
    return false
  }

  if (node.kind === 'directory' && isSamePathOrDescendant(targetDirectoryPath, node.path)) {
    return false
  }

  return !areSameWorkspacePaths(getParentDirectoryPath(node.path) ?? '', targetDirectoryPath)
}

export function resolveDropTargetDirectoryPath(node: WorkspaceNode, workspacePath: string | null) {
  if (node.kind === 'directory') {
    return node.path
  }

  return getParentDirectoryPath(node.path) ?? workspacePath
}

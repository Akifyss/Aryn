import type { WorkspaceNode } from '@/features/workspace/types'
import type { WorkspaceTab } from '@/features/workspace/store/use-workspace-store'
import {
  getBaseName,
  getDirectoryRelativePath,
  getRelativePath,
  hasPathPrefix,
  rebasePathPrefix,
} from '@/features/workspace/lib/workspace-paths'

export type WorkspaceMovedTabMutation =
  | {
    currentPath: string
    kind: 'rename-file'
    nextPath: string
  }
  | {
    kind: 'close-tab'
    tabId: string
  }

export function collectWorkspaceDirectoryPaths(nodes: WorkspaceNode[]) {
  const directoryPaths = new Set<string>()
  const pendingNodes = [...nodes]

  while (pendingNodes.length > 0) {
    const node = pendingNodes.pop()!

    if (node.kind !== 'directory') {
      continue
    }

    directoryPaths.add(node.path)

    if (node.children?.length) {
      pendingNodes.push(...node.children)
    }
  }

  return directoryPaths
}

export function getWorkspaceFileTabIdsForPath(openTabs: WorkspaceTab[], filePath: string) {
  return openTabs
    .filter((tab) => tab.kind === 'file' && tab.filePath === filePath)
    .map((tab) => tab.id)
}

export function getWorkspaceMovedTabMutations(
  openTabs: WorkspaceTab[],
  currentNodePath: string,
  nextNodePath: string,
) {
  const renamedFilePaths = new Set<string>()
  const mutations: WorkspaceMovedTabMutation[] = []

  for (const tab of openTabs) {
    if (tab.kind === 'file' && hasPathPrefix(tab.filePath, currentNodePath)) {
      if (!renamedFilePaths.has(tab.filePath)) {
        renamedFilePaths.add(tab.filePath)
        mutations.push({
          currentPath: tab.filePath,
          kind: 'rename-file',
          nextPath: rebasePathPrefix(tab.filePath, currentNodePath, nextNodePath),
        })
      }

      continue
    }

    if (tab.kind === 'diff' && hasPathPrefix(tab.diff.change.path, currentNodePath)) {
      mutations.push({ kind: 'close-tab', tabId: tab.id })
    }
  }

  return mutations
}

export function getWorkspaceTabIdsForNodePath(openTabs: WorkspaceTab[], nodePath: string) {
  return openTabs
    .filter((tab) => hasPathPrefix(
      tab.kind === 'diff' ? tab.diff.change.path : tab.filePath,
      nodePath,
    ))
    .map((tab) => tab.id)
}

export function rebaseExpandedWorkspacePaths(
  expandedPaths: Set<string>,
  currentNodePath: string,
  nextNodePath: string,
) {
  const nextExpandedPaths = new Set<string>()

  expandedPaths.forEach((expandedPath) => {
    nextExpandedPaths.add(hasPathPrefix(expandedPath, currentNodePath)
      ? rebasePathPrefix(expandedPath, currentNodePath, nextNodePath)
      : expandedPath)
  })

  return nextExpandedPaths
}

export function resolveWorkspaceMoveRelativePath(
  workspacePath: string,
  node: WorkspaceNode,
  targetDirectoryPath: string,
) {
  const targetRelativePath = getRelativePath(workspacePath, targetDirectoryPath)
  return targetRelativePath ? `${targetRelativePath}/${node.name}` : node.name
}

export function resolveWorkspaceRenameTarget(
  workspacePath: string,
  node: WorkspaceNode,
  nextName: string,
) {
  const trimmedName = nextName.trim()

  if (!trimmedName) {
    throw new Error(`${node.kind === 'directory' ? 'Folder' : 'File'} name is required.`)
  }

  const currentBaseName = getBaseName(node.path)
  const currentExtensionMatch = currentBaseName.match(/(\.[^./\\]+)$/)
  const baseName = node.kind === 'file' && currentExtensionMatch && !/\.[^./\\]+$/.test(trimmedName)
    ? `${trimmedName}${currentExtensionMatch[1]}`
    : trimmedName
  const parentDirectory = getDirectoryRelativePath(workspacePath, node.path)

  return {
    baseName,
    relativePath: parentDirectory ? `${parentDirectory}/${baseName}` : baseName,
  }
}

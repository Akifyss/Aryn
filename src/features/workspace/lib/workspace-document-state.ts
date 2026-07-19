import type {
  WorkspaceDiffTab,
  WorkspaceFileTab,
  WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'
import { normalizeFilePath, hasPathPrefix } from '@/features/workspace/lib/workspace-paths'
import {
  getWorkspaceTabSourcePath,
  isWorkspaceAutosaveTab,
} from '@/features/workspace/lib/workspace-tabs'

export type DirtyWorkspaceTab = WorkspaceDiffTab | WorkspaceFileTab

export function getDirtyWorkspaceTabs(openTabs: WorkspaceTab[]): DirtyWorkspaceTab[] {
  return openTabs.filter((tab): tab is DirtyWorkspaceTab => (
    tab.kind === 'diff'
      ? tab.diff.source.kind === 'working-tree' && tab.isDirty
      : isWorkspaceAutosaveTab(tab) && tab.isDirty
  ))
}

export function getDirtyWorkspaceTabsForPaths(
  openTabs: WorkspaceTab[],
  filePaths?: string[],
) {
  const normalizedTargets = filePaths?.map((filePath) => normalizeFilePath(filePath))

  return getDirtyWorkspaceTabs(openTabs).filter((tab) => {
    if (!normalizedTargets?.length) {
      return true
    }

    return normalizedTargets.includes(normalizeFilePath(getWorkspaceTabSourcePath(tab)))
  })
}

export function getDirtyWorkspaceTabsForNodePath(openTabs: WorkspaceTab[], nodePath: string) {
  return getDirtyWorkspaceTabs(openTabs).filter(
    (tab) => hasPathPrefix(getWorkspaceTabSourcePath(tab), nodePath),
  )
}

export function hasDirtyWorkspaceFileTab(openTabs: WorkspaceTab[], filePath: string) {
  const normalizedPath = normalizeFilePath(filePath)

  return openTabs.some((tab) => (
    isWorkspaceAutosaveTab(tab)
    && tab.isDirty
    && normalizeFilePath(tab.filePath) === normalizedPath
  ))
}

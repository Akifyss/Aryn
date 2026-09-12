import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import type { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import type { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import { useWorkbenchStore, type WorkbenchPaneId } from './workbench-state'

const revisions: Record<WorkbenchPaneId, number> = { left: 0, right: 0 }

export function cancelWorkbenchDocumentNavigation(pane: WorkbenchPaneId) {
  revisions[pane] += 1
}

// Navigation targets are captured before I/O. A slower request cannot replace
// a newer selection, switch workspaces, or steal focus from the other pane.
export function captureWorkbenchDocumentTarget(pane = useWorkbenchStore.getState().focusedPane) {
  const workspacePath = useWorkspaceStore.getState().currentPath
  const scopeRevision = useWorkbenchStore.getState().scopeRevision
  const navigationRevision = useWorkbenchStore.getState().panes[pane].navigationRevision
  const revision = ++revisions[pane]
  const isCurrent = () => revisions[pane] === revision && useWorkspaceStore.getState().currentPath === workspacePath
    && useWorkbenchStore.getState().scopeRevision === scopeRevision && !useWorkbenchStore.getState().restoring
    && useWorkbenchStore.getState().panes[pane].navigationRevision === navigationRevision
  const opened = (id: string) => {
    if (!isCurrent()) return
    useWorkbenchStore.getState().open(pane, { kind: 'document', id }, false)
    const state = useWorkbenchStore.getState()
    const focusedTab = state.panes[state.focusedPane].activeTabId
    useWorkspaceStore.getState().activateTab(focusedTab)
  }
  return Object.assign(opened, { isCurrent })
}

export type WorkbenchDocumentNavigation = Pick<ReturnType<typeof useWorkspaceDocumentNavigation>,
  'openFile' | 'openGitDiff' | 'openGitCommitFileDiff'>

// Pane callbacks carry their origin even when a file browser, portal or Git
// refresh invokes them after keyboard focus has moved elsewhere.
export function createWorkbenchDocumentNavigation(
  pane: WorkbenchPaneId,
  navigation: WorkbenchDocumentNavigation,
  workspacePath: string | null,
  refreshGitState: ReturnType<typeof useGitWorkspaceController>['refreshGitState'],
) {
  return {
    openFile: (...[path, root = workspacePath, mode]: Parameters<WorkbenchDocumentNavigation['openFile']>) => (
      navigation.openFile(path, root, mode, captureWorkbenchDocumentTarget(pane))
    ),
    openGitDiff: (...[change, options]: Parameters<WorkbenchDocumentNavigation['openGitDiff']>) => (
      navigation.openGitDiff(change, options, captureWorkbenchDocumentTarget(pane))
    ),
    openGitCommitFileDiff: (...[hash, change]: Parameters<WorkbenchDocumentNavigation['openGitCommitFileDiff']>) => (
      navigation.openGitCommitFileDiff(hash, change, captureWorkbenchDocumentTarget(pane))
    ),
    openFileDiff: async (path: string, options?: Parameters<WorkbenchDocumentNavigation['openGitDiff']>[1]) => {
      const target = captureWorkbenchDocumentTarget(pane)
      if (!workspacePath) return
      const repository = await refreshGitState(workspacePath, { silent: true })
      if (!target.isCurrent()) return
      const change = findGitChangeByFilePath(repository, path,
        options?.source === 'revision' ? ['staged', 'unstaged'] : ['unstaged', 'staged'])
      if (change) await navigation.openGitDiff(change, options, target)
    },
  }
}

import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import type { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import type { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import { useDuoStore, type DuoPaneId } from './duo-state'

const revisions: Record<DuoPaneId, number> = { left: 0, right: 0 }

export function cancelDuoDocumentNavigation(pane: DuoPaneId) {
  revisions[pane] += 1
}

// Navigation targets are captured before I/O. A slower request cannot replace
// a newer selection, switch workspaces, or steal focus from the other pane.
export function captureDuoDocumentTarget(pane = useDuoStore.getState().focusedPane) {
  const workspacePath = useWorkspaceStore.getState().currentPath
  const scopeRevision = useDuoStore.getState().scopeRevision
  const navigationRevision = useDuoStore.getState().panes[pane].navigationRevision
  const revision = ++revisions[pane]
  const isCurrent = () => revisions[pane] === revision && useWorkspaceStore.getState().currentPath === workspacePath
    && useDuoStore.getState().scopeRevision === scopeRevision && !useDuoStore.getState().restoring
    && useDuoStore.getState().panes[pane].navigationRevision === navigationRevision
  const opened = (id: string) => {
    if (!isCurrent()) return
    useDuoStore.getState().open(pane, { kind: 'document', id }, false)
    const state = useDuoStore.getState()
    const focusedTab = state.panes[state.focusedPane].activeTabId
    useWorkspaceStore.getState().activateTab(focusedTab)
  }
  return Object.assign(opened, { isCurrent })
}

export type DuoDocumentNavigation = Pick<ReturnType<typeof useWorkspaceDocumentNavigation>,
  'openFile' | 'openGitDiff' | 'openGitCommitFileDiff'>

// Pane callbacks carry their origin even when a file browser, portal or Git
// refresh invokes them after keyboard focus has moved elsewhere.
export function createDuoDocumentNavigation(
  pane: DuoPaneId,
  navigation: DuoDocumentNavigation,
  workspacePath: string | null,
  refreshGitState: ReturnType<typeof useGitWorkspaceController>['refreshGitState'],
) {
  return {
    openFile: (...[path, root = workspacePath, mode]: Parameters<DuoDocumentNavigation['openFile']>) => (
      navigation.openFile(path, root, mode, captureDuoDocumentTarget(pane))
    ),
    openGitDiff: (...[change, options]: Parameters<DuoDocumentNavigation['openGitDiff']>) => (
      navigation.openGitDiff(change, options, captureDuoDocumentTarget(pane))
    ),
    openGitCommitFileDiff: (...[hash, change]: Parameters<DuoDocumentNavigation['openGitCommitFileDiff']>) => (
      navigation.openGitCommitFileDiff(hash, change, captureDuoDocumentTarget(pane))
    ),
    openFileDiff: async (path: string, options?: Parameters<DuoDocumentNavigation['openGitDiff']>[1]) => {
      const target = captureDuoDocumentTarget(pane)
      if (!workspacePath) return
      const repository = await refreshGitState(workspacePath, { silent: true })
      if (!target.isCurrent()) return
      const change = findGitChangeByFilePath(repository, path,
        options?.source === 'revision' ? ['staged', 'unstaged'] : ['unstaged', 'staged'])
      if (change) await navigation.openGitDiff(change, options, target)
    },
  }
}

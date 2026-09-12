import type { WorkbenchPaneConfiguration } from './workbench-pane'
import type { WorkbenchPaneId } from './workbench-state'
import { createWorkbenchDocumentNavigation } from './workbench-document-navigation'

// Both the directory sidebar and the movable Git tab use the current owner
// for file/diff actions, including actions that explicitly target its peer.
export function createWorkbenchPanelNavigation(pane: WorkbenchPaneId, configuration: WorkbenchPaneConfiguration) {
  const root = configuration.editor.editorContent.workspacePath
  const otherPane: WorkbenchPaneId = pane === 'left' ? 'right' : 'left'
  const navigation = createWorkbenchDocumentNavigation(pane, configuration.documentNavigation, root, configuration.refreshGitState)
  const peer = createWorkbenchDocumentNavigation(otherPane, configuration.documentNavigation, root, configuration.refreshGitState)
  return {
    ...configuration.editor.navigation,
    gitPanel: {
      ...configuration.editor.navigation.gitPanel,
      onOpenFile: navigation.openFile,
      onOpenDiff: navigation.openGitDiff,
      onOpenMeoDiff: (change: Parameters<typeof navigation.openGitDiff>[0]) => navigation.openGitDiff(change, { mode: 'split', view: 'meo' }),
      onOpenCommitFileDiff: navigation.openGitCommitFileDiff,
      otherPaneAction: { direction: otherPane, onOpenDiff: peer.openGitDiff, onOpenCommitFileDiff: peer.openGitCommitFileDiff },
    },
  }
}

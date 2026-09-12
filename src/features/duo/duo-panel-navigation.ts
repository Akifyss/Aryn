import type { DuoPaneConfiguration } from './duo-pane'
import type { DuoPaneId } from './duo-state'
import { createDuoDocumentNavigation } from './duo-document-navigation'

// Both the directory sidebar and the movable Git tab use the current owner
// for file/diff actions, including actions that explicitly target its peer.
export function createDuoPanelNavigation(pane: DuoPaneId, configuration: DuoPaneConfiguration) {
  const root = configuration.editor.editorContent.workspacePath
  const otherPane: DuoPaneId = pane === 'left' ? 'right' : 'left'
  const navigation = createDuoDocumentNavigation(pane, configuration.documentNavigation, root, configuration.refreshGitState)
  const peer = createDuoDocumentNavigation(otherPane, configuration.documentNavigation, root, configuration.refreshGitState)
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

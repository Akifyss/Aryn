import type { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import type { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import type { useWorkspaceFileOperations } from '@/features/workspace/hooks/use-workspace-file-operations'
import type { WorkspaceNode } from '@/features/workspace/types'
import type { WorkspaceNavigationPanelConfiguration } from './workspace-navigation-panels'

type GitWorkspaceView = Pick<
  ReturnType<typeof useGitWorkspaceController>,
  | 'busyLabel'
  | 'commit'
  | 'commitAndSync'
  | 'commitMessage'
  | 'discardAll'
  | 'discardChanges'
  | 'historyRefreshVersion'
  | 'initializeRepository'
  | 'isLoading'
  | 'panelLayout'
  | 'pull'
  | 'push'
  | 'refreshPanel'
  | 'repositoryState'
  | 'revertCommit'
  | 'setCommitMessage'
  | 'setPanelLayout'
  | 'stagePaths'
  | 'unstagePaths'
>

type WorkspaceDocumentNavigationView = Pick<
  ReturnType<typeof useWorkspaceDocumentNavigation>,
  | 'openFile'
  | 'openGitCommitFileDiff'
  | 'openGitDiff'
  | 'replaceActiveFileWithPath'
>

type WorkspaceFileOperationsView = Pick<
  ReturnType<typeof useWorkspaceFileOperations>,
  | 'createDirectory'
  | 'createFile'
  | 'deleteNode'
  | 'expandedPaths'
  | 'isCreatingDirectory'
  | 'isCreatingFile'
  | 'moveNode'
  | 'renameNode'
  | 'setExpandedPaths'
  | 'toggleTreeExpansion'
>

type CreateWorkspaceNavigationConfigurationOptions = {
  activeTab: WorkspaceNavigationPanelConfiguration['activeTab']
  activeTreePath: string | null
  currentPath: string | null
  fileOperations: WorkspaceFileOperationsView
  git: GitWorkspaceView
  iconTheme: WorkspaceNavigationPanelConfiguration['gitPanel']['iconTheme']
  navigation: WorkspaceDocumentNavigationView
  setActiveTab: WorkspaceNavigationPanelConfiguration['onActiveTabChange']
  tree: WorkspaceNode[]
  workspaceLabel: string
  workspaceUnavailableMessage: string | null
}

export function createWorkspaceNavigationConfiguration({
  activeTab,
  activeTreePath,
  currentPath,
  fileOperations,
  git,
  iconTheme,
  navigation,
  setActiveTab,
  tree,
  workspaceLabel,
  workspaceUnavailableMessage,
}: CreateWorkspaceNavigationConfigurationOptions): WorkspaceNavigationPanelConfiguration {
  return {
    activeTab,
    activeTreePath,
    gitPanel: {
      busyLabel: git.busyLabel,
      commitMessage: git.commitMessage,
      historyRefreshVersion: git.historyRefreshVersion,
      iconTheme,
      isLoading: git.isLoading,
      layout: git.panelLayout,
      repositoryState: git.repositoryState,
      workspacePath: currentPath,
      onCommit: git.commit,
      onCommitAndSync: git.commitAndSync,
      onCommitMessageChange: git.setCommitMessage,
      onDiscardAll: git.discardAll,
      onDiscardMany: git.discardChanges,
      onInitialize: git.initializeRepository,
      onLayoutChange: git.setPanelLayout,
      onOpenCommitFileDiff: (commitHash, change) => {
        void navigation.openGitCommitFileDiff(commitHash, change)
      },
      onOpenDiff: (change) => {
        void navigation.openGitDiff(change)
      },
      onOpenFile: (filePath) => {
        void navigation.openFile(filePath)
      },
      onOpenMeoDiff: (change) => {
        void navigation.openGitDiff(change, { mode: 'split', view: 'meo' })
      },
      onPull: git.pull,
      onPush: git.push,
      onRefresh: git.refreshPanel,
      onRevertCommit: git.revertCommit,
      onStage: git.stagePaths,
      onUnstage: git.unstagePaths,
    },
    treePanel: {
      expandedPaths: fileOperations.expandedPaths,
      gitRepositoryState: git.repositoryState,
      iconTheme,
      isCreatingDirectory: fileOperations.isCreatingDirectory,
      isCreatingFile: fileOperations.isCreatingFile,
      nodes: tree,
      setExpandedPaths: fileOperations.setExpandedPaths,
      workspacePath: currentPath,
      workspaceUnavailableMessage,
      onCreateDirectory: () => void fileOperations.createDirectory(),
      onCreateFile: () => void fileOperations.createFile(),
      onDeleteNode: (node) => fileOperations.deleteNode(node),
      onMoveNode: (node, targetDirectoryPath) => (
        fileOperations.moveNode(node, targetDirectoryPath)
      ),
      onOpenDiff: (change) => {
        void navigation.openGitDiff(change)
      },
      onOpenInCodeEditor: (filePath) => {
        void navigation.openFile(filePath, currentPath, 'code')
      },
      onRenameNode: (node, nextName) => fileOperations.renameNode(node, nextName),
      onToggleFileTreeExpansion: fileOperations.toggleTreeExpansion,
    },
    workspaceLabel,
    onActiveTabChange: setActiveTab,
    onOpenFile: (filePath) => {
      void navigation.openFile(filePath)
    },
    onReplaceActiveFile: (filePath) => {
      void navigation.replaceActiveFileWithPath(filePath)
    },
  }
}

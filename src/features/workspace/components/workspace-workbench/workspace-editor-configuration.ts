import type { ComponentProps } from 'react'
import type { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import type { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import type { useWorkspaceDocumentPersistence } from '@/features/workspace/hooks/use-workspace-document-persistence'
import type { useWorkspaceTabViewState } from '@/features/workspace/hooks/use-workspace-tab-view-state'
import type { useWorkspaceFileSystemState } from '@/features/workspace/hooks/use-workspace-file-system-state'
import type { WorkspaceNode } from '@/features/workspace/types'
import type { WorkspaceFileSystemPanel } from '@/features/workspace/components/workspace-file-system-panel/workspace-file-system-panel'
import type { WorkspaceEditorWorkbench } from './workspace-editor-workbench'
import type { WorkspaceNavigationPanelConfiguration } from './workspace-navigation-panels'

export type WorkspaceEditorConfiguration = Pick<ComponentProps<typeof WorkspaceEditorWorkbench>, 'editorContent' | 'fileTabs'> & {
  fileSystemPanel: ComponentProps<typeof WorkspaceFileSystemPanel>
  navigation: WorkspaceNavigationPanelConfiguration
}

type WorkspaceEditorSurfaceView = Pick<
  ReturnType<typeof useWorkspaceTabViewState>,
  | 'activeDiffDraftContent'
  | 'activeDiffHasDirtyRelatedFileTab'
  | 'activeDiffTab'
  | 'activeFileTab'
  | 'displayActiveTabId'
  | 'displayTabs'
>

type GitWorkspaceEditorView = Pick<
  ReturnType<typeof useGitWorkspaceController>,
  | 'applyDiffSelection'
  | 'discardChange'
  | 'refreshGitState'
  | 'repositoryState'
  | 'stagePaths'
  | 'unstagePaths'
>

type WorkspaceDocumentNavigationView = Pick<
  ReturnType<typeof useWorkspaceDocumentNavigation>,
  'activateFileTab' | 'openFile' | 'openGitDiff'
>

type WorkspaceDocumentPersistenceView = Pick<
  ReturnType<typeof useWorkspaceDocumentPersistence>,
  'closeEditorTab' | 'saveDiffFile' | 'saveWorkspaceFile'
>

type WorkspaceFileSystemView = ReturnType<typeof useWorkspaceFileSystemState>

type CreateWorkspaceEditorConfigurationOptions = {
  currentPath: string | null
  editorHostRef: WorkspaceEditorConfiguration['editorContent']['meoEditorHostRef']
  editorSurface: WorkspaceEditorSurfaceView
  fileSystem: WorkspaceFileSystemView
  git: GitWorkspaceEditorView
  iconTheme: WorkspaceEditorConfiguration['fileTabs']['iconTheme']
  meoSettings: WorkspaceEditorConfiguration['editorContent']['meoSettings']
  moveTab: WorkspaceEditorConfiguration['fileTabs']['onMoveTab']
  navigation: WorkspaceDocumentNavigationView
  navigationConfiguration: WorkspaceNavigationPanelConfiguration
  onActiveEditorCompositionChange: WorkspaceEditorConfiguration['editorContent']['fileActions']['compositionChange']
  onOpenMeoEditorGitDiff: WorkspaceEditorConfiguration['editorContent']['fileActions']['openGitDiff']
  persistence: WorkspaceDocumentPersistenceView
  theme: WorkspaceEditorConfiguration['editorContent']['theme']
  tree: WorkspaceNode[]
  workspaceLabel: string
  workspaceUnavailableMessage: string | null
}

export function createWorkspaceEditorConfiguration({
  currentPath,
  editorHostRef,
  editorSurface,
  fileSystem,
  git,
  iconTheme,
  meoSettings,
  moveTab,
  navigation,
  navigationConfiguration,
  onActiveEditorCompositionChange,
  onOpenMeoEditorGitDiff,
  persistence,
  theme,
  tree,
  workspaceLabel,
  workspaceUnavailableMessage,
}: CreateWorkspaceEditorConfigurationOptions): WorkspaceEditorConfiguration {
  return {
    editorContent: {
      activeDiffTab: editorSurface.activeDiffTab,
      activeFileTab: editorSurface.activeFileTab,
      diffActions: {
        discardChange: (change) => {
          void git.discardChange(change)
        },
        saveEditedFile: persistence.saveDiffFile,
        stagePaths: (filePaths) => {
          void git.stagePaths(filePaths)
        },
        unstagePaths: (filePaths) => {
          void git.unstagePaths(filePaths)
        },
      },
      diffDraftContent: editorSurface.activeDiffDraftContent,
      diffHasDirtyRelatedFileTab: editorSurface.activeDiffHasDirtyRelatedFileTab,
      fileActions: {
        applyGitDiffSelection: git.applyDiffSelection,
        compositionChange: onActiveEditorCompositionChange,
        openFile: (targetFilePath) => {
          void navigation.openFile(targetFilePath, currentPath, 'meo')
        },
        openGitDiff: onOpenMeoEditorGitDiff,
        saveFile: (filePath, content) => {
          void persistence.saveWorkspaceFile({ content, filePath })
        },
      },
      gitRepositoryState: git.repositoryState,
      iconTheme,
      isVisible: Boolean(editorSurface.activeFileTab || editorSurface.activeDiffTab),
      meoEditorHostRef: editorHostRef,
      meoSettings,
      theme,
      workspacePath: currentPath,
    },
    fileSystemPanel: {
      fileSystemState: fileSystem.workspaceFileSystemState,
      gitRepositoryState: git.repositoryState,
      iconTheme,
      meoSettings,
      nodes: tree,
      theme,
      title: workspaceLabel,
      workspacePath: currentPath,
      workspaceUnavailableMessage,
      onFileSystemNavigationChange: fileSystem.handleWorkspaceFileSystemNavigationChange,
      onFileSystemSelectionChange: fileSystem.handleWorkspaceFileSystemSelectionChange,
      onFileSystemViewChange: fileSystem.handleWorkspaceFileSystemViewChange,
      onOpenFile: (filePath) => {
        void navigation.openFile(filePath)
      },
    },
    fileTabs: {
      activeTabId: editorSurface.displayActiveTabId,
      iconTheme,
      tabs: editorSurface.displayTabs,
      workspacePath: currentPath,
      getHasDiff: (filePath) => Boolean(
        findGitChangeByFilePath(git.repositoryState, filePath),
      ),
      onActivate: navigation.activateFileTab,
      onClose: (tabId) => {
        void persistence.closeEditorTab(tabId)
      },
      onMoveTab: moveTab,
      onOpenDiff: async (filePath) => {
        const latestGitState = await git.refreshGitState(currentPath, { silent: true })
        const nextChange = findGitChangeByFilePath(latestGitState, filePath)
        if (nextChange) {
          void navigation.openGitDiff(nextChange)
        }
      },
    },
    navigation: navigationConfiguration,
  }
}

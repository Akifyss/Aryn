import type { ComponentProps } from 'react'
import type { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import type { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import type { useWorkspaceDocumentPersistence } from '@/features/workspace/hooks/use-workspace-document-persistence'
import type { useWorkspaceEditorSurfaceController } from '@/features/workspace/hooks/use-workspace-editor-surface-controller'
import type { useWorkspaceFileSystemState } from '@/features/workspace/hooks/use-workspace-file-system-state'
import type { WorkspaceNode } from '@/features/workspace/types'
import type { WorkspaceEditorWorkbench } from './workspace-editor-workbench'
import type { WorkspaceNavigationPanelConfiguration } from './workspace-navigation-panels'

type WorkspaceEditorWorkbenchConfiguration = ComponentProps<
  typeof WorkspaceEditorWorkbench
>

type WorkspaceEditorSurfaceView = Pick<
  ReturnType<typeof useWorkspaceEditorSurfaceController>,
  | 'activeDiffDraftContent'
  | 'activeDiffHasDirtyRelatedFileTab'
  | 'activeDiffTab'
  | 'activeFileTab'
  | 'activeFixedPanelTab'
  | 'displayActiveTabId'
  | 'displayTabs'
  | 'isDirectorySidebarAvailable'
  | 'isDirectorySidebarVisible'
  | 'isDirectoryToggleSlotVisible'
  | 'shouldRenderWorkspaceEditor'
  | 'toggleDirectorySidebar'
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
  editorHostRef: WorkspaceEditorWorkbenchConfiguration['editorContent']['meoEditorHostRef']
  editorSurface: WorkspaceEditorSurfaceView
  fileSystem: WorkspaceFileSystemView
  git: GitWorkspaceEditorView
  iconTheme: WorkspaceEditorWorkbenchConfiguration['fileTabs']['iconTheme']
  isPickingWorkspace: boolean
  meoSettings: WorkspaceEditorWorkbenchConfiguration['editorContent']['meoSettings']
  moveTab: WorkspaceEditorWorkbenchConfiguration['fileTabs']['onMoveTab']
  navigation: WorkspaceDocumentNavigationView
  navigationConfiguration: WorkspaceNavigationPanelConfiguration
  onActiveEditorCompositionChange: WorkspaceEditorWorkbenchConfiguration['editorContent']['fileActions']['compositionChange']
  onOpenMeoEditorGitDiff: WorkspaceEditorWorkbenchConfiguration['editorContent']['fileActions']['openGitDiff']
  onOpenWorkspaceSwitch: WorkspaceEditorWorkbenchConfiguration['emptyState']['onOpenWorkspaceSwitch']
  persistence: WorkspaceDocumentPersistenceView
  theme: WorkspaceEditorWorkbenchConfiguration['editorContent']['theme']
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
  isPickingWorkspace,
  meoSettings,
  moveTab,
  navigation,
  navigationConfiguration,
  onActiveEditorCompositionChange,
  onOpenMeoEditorGitDiff,
  onOpenWorkspaceSwitch,
  persistence,
  theme,
  tree,
  workspaceLabel,
  workspaceUnavailableMessage,
}: CreateWorkspaceEditorConfigurationOptions): WorkspaceEditorWorkbenchConfiguration {
  return {
    activeFixedPanelTab: editorSurface.activeFixedPanelTab,
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
      isVisible: editorSurface.shouldRenderWorkspaceEditor,
      meoEditorHostRef: editorHostRef,
      meoSettings,
      theme,
      workspacePath: currentPath,
    },
    emptyState: {
      hasWorkspace: Boolean(currentPath),
      isPickingWorkspace,
      onOpenWorkspaceSwitch,
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
    isDirectorySidebarAvailable: editorSurface.isDirectorySidebarAvailable,
    isDirectorySidebarVisible: editorSurface.isDirectorySidebarVisible,
    isDirectoryToggleSlotVisible: editorSurface.isDirectoryToggleSlotVisible,
    navigation: navigationConfiguration,
    onToggleDirectorySidebar: editorSurface.toggleDirectorySidebar,
  }
}

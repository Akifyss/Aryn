import { useCallback, useEffect, useRef, useState } from 'react'
import { Toast } from '@heroui/react'
import {
  FolderLine,
  GitBranchLine,
} from '@mingcute/react'
import {
  AppConfirmDialog,
  useAppConfirmation,
} from '@/components/app-confirm-dialog/app-confirm-dialog'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import { useConversationController } from '@/features/conversations/hooks/use-conversation-controller'
import { conversationDraftContext } from '@/features/conversations/lib/conversation-state'
import { AppTooltipButton } from '@/components/app-tooltip'
import {
  AgentChatSurface,
  AgentProvider,
} from '@/features/agent/components/agent-sidebar/agent-sidebar'
import { DEFAULT_AGENT_ID } from '@/features/agent/agent-definition'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host/meo-editor-host'
import type { MeoOpenGitDiffHandler } from '@/features/editor/lib/meo-native-editor-types'
import { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import { SettingsDialog } from '@/features/settings/components/settings-dialog/settings-dialog'
import {
  WorkspaceEditorWorkbench,
} from '@/features/workspace/components/workspace-workbench/workspace-editor-workbench'
import {
  WorkspaceNavigationSurface,
} from '@/features/workspace/components/workspace-workbench/workspace-navigation-surface'
import type {
  WorkspaceNavigationPanelConfiguration,
} from '@/features/workspace/components/workspace-workbench/workspace-navigation-panels'
import type { WorkspaceSidebarSurfaceMode as PanelSurfaceMode } from '@/features/workspace/components/workspace-sidebar/workspace-sidebar'
import { NewProjectDialog } from '@/features/workspace/components/new-project-dialog/new-project-dialog'
import { ProjectBootstrap } from '@/features/workspace/components/project-bootstrap/project-bootstrap'
import {
  type ProjectMenuSurface,
} from '@/features/workspace/components/project-menu/project-menu'
import {
  ProjectMenuLayer,
  type ProjectMenuLayerConfiguration,
} from '@/features/workspace/components/project-menu/project-menu-layer'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import { getBaseName } from '@/features/workspace/lib/workspace-paths'
import {
  FIXED_FILE_TAB_ID,
  FIXED_GIT_TAB_ID,
  type AgentLayoutFixedTab,
} from '@/features/workspace/lib/workspace-tabs'
import { useWorkspaceChangeSubscription } from '@/features/workspace/hooks/use-workspace-change-subscription'
import { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import { useWorkspaceDocumentPersistence } from '@/features/workspace/hooks/use-workspace-document-persistence'
import { useWorkspaceEditorSurfaceController } from '@/features/workspace/hooks/use-workspace-editor-surface-controller'
import { useWorkspaceFileOperations } from '@/features/workspace/hooks/use-workspace-file-operations'
import { useWorkspaceFileSystemState } from '@/features/workspace/hooks/use-workspace-file-system-state'
import { useWorkspaceProjectController } from '@/features/workspace/hooks/use-workspace-project-controller'
import { useWorkspaceSyncController } from '@/features/workspace/hooks/use-workspace-sync-controller'
import { useWorkspaceTabPersistence } from '@/features/workspace/hooks/use-workspace-tab-persistence'
import {
  createWorkspaceRefreshCoordinator,
  type WorkspaceRefreshRequest,
  type WorkspaceRefreshScheduleMode,
} from '@/features/workspace/lib/workspace-refresh-coordinator'
import { CommandPalette } from '@/features/command-palette/components/command-palette/command-palette'
import { useSettingsStore, type AppLayoutPreference } from '@/hooks/use-settings-store'
import { useAppBootstrap } from '@/hooks/use-app-bootstrap'
import { useAppKeyboardShortcuts } from '@/hooks/use-app-keyboard-shortcuts'
import { useAppOverlayController } from '@/hooks/use-app-overlay-controller'
import { useAppWindowClose } from '@/hooks/use-app-window-close'
import { useDevToolsFocusSettlement } from '@/hooks/use-devtools-focus-settlement'
import { AppShell } from '@/features/layout/components/app-shell/app-shell'
import {
  AppChromeSearchButton,
  AppChromeSidebarToggleButton,
  AppLayoutModeSwitch,
} from '@/features/layout/components/app-chrome-controls/app-chrome-controls'
import { useShellLayoutController } from '@/features/layout/hooks/use-shell-layout-controller'
import { useAppAppearanceController } from '@/features/appearance/hooks/use-app-appearance-controller'
import './App.css'

const WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS = 140

function App() {
  const platform = window.appApi.platform
  const { layoutPreference, meo, theme, setLayoutPreference } = useSettingsStore()
  const [, setStatusMessage] = useState('Open a folder to start.')
  const {
    hydrateWorkspaceIconThemes,
    iconTheme,
    iconThemeOptions,
    iconThemes,
    isApplyingIconTheme,
    resolvedTheme,
    selectWorkspaceIconTheme,
  } = useAppAppearanceController({
    onStatusMessage: setStatusMessage,
    platform,
    theme,
  })

  const [activeWorkspaceContext, setActiveWorkspaceContext] = useState<ActiveWorkspaceContext>(conversationDraftContext)

  const {
    cancelConfirmation,
    confirmConfirmation,
    confirmation,
    requestConfirmation,
  } = useAppConfirmation()

  const [agentWorkspaceState, setAgentWorkspaceState] = useState<AgentWorkspaceState | null>(null)
  const meoEditorHostRef = useRef<MeoEditorHostHandle | null>(null)
  const activeTabId = useWorkspaceStore((state) => state.activeTabId)
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const moveTab = useWorkspaceStore((state) => state.moveTab)
  const openTabs = useWorkspaceStore((state) => state.openTabs)
  const tree = useWorkspaceStore((state) => state.tree)
  const {
    handleWorkspaceFileSystemNavigationChange,
    handleWorkspaceFileSystemSelectionChange,
    handleWorkspaceFileSystemViewChange,
    workspaceFileSystemState,
  } = useWorkspaceFileSystemState(currentPath)
  const appLayoutPreference: AppLayoutPreference = layoutPreference
  const isAgentLayout = appLayoutPreference === 'agent'
  const shouldExposeAgentWorkspaceTools = !isAgentLayout || Boolean(currentPath)
  const {
    activeDiffDraftContent,
    activeDiffHasDirtyRelatedFileTab,
    activeDiffTab,
    activeFileTab,
    activeFixedPanelTab,
    activeWorkspaceAutosaveTab,
    currentEditorKind,
    currentFileContent,
    currentFilePath,
    currentFileViewMode,
    displayActiveTabId,
    displayTabs,
    isDirectorySidebarAvailable,
    isDirectorySidebarVisible,
    isDirectoryToggleSlotVisible,
    setActiveAgentLayoutFixedTab,
    setIsAgentLayoutFixedTabActive,
    shouldRenderWorkspaceEditor,
    toggleDirectorySidebar,
  } = useWorkspaceEditorSurfaceController({
    activeTabId,
    currentPath,
    isAgentLayout,
    openTabs,
  })
  const isActiveMeoEditorMountedRef = useRef(false)
  isActiveMeoEditorMountedRef.current = currentEditorKind === 'prose' && currentFileViewMode === 'meo'
  const [isActiveEditorComposing, setIsActiveEditorComposing] = useState(false)
  const performWorkspaceRefreshRef = useRef<(request: Required<WorkspaceRefreshRequest>) => Promise<void>>(async () => {})
  const workspaceRefreshCoordinatorRef = useRef<ReturnType<typeof createWorkspaceRefreshCoordinator> | null>(null)
  const {
    currentPathRef,
    isActiveWorkspacePath,
    loadTree,
    reconcileWorkspaceFileAfterGitDiscard,
    reloadActiveWorkspaceTree,
    syncOpenDiffTabs,
  } = useWorkspaceSyncController(currentPath)
  useDevToolsFocusSettlement()

  if (!workspaceRefreshCoordinatorRef.current) {
    workspaceRefreshCoordinatorRef.current = createWorkspaceRefreshCoordinator({
      debounceMs: WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS,
      onFlush: (request) => performWorkspaceRefreshRef.current(request),
    })
  }
  const requestWorkspaceRefresh = useCallback((
    request: WorkspaceRefreshRequest,
    mode: WorkspaceRefreshScheduleMode = 'immediate',
  ) => {
    return workspaceRefreshCoordinatorRef.current?.request(request, mode) ?? Promise.resolve()
  }, [])
  const refreshWorkspaceAfterDocumentSave = useCallback((rootPath: string) => (
    performWorkspaceRefreshRef.current({
      gitSilent: true,
      refreshGit: true,
      refreshTree: true,
      rootPath,
    })
  ), [])
  const captureActiveMeoViewPosition = useCallback(() => {
    if (!isActiveMeoEditorMountedRef.current) {
      return
    }

    meoEditorHostRef.current?.captureViewPosition()
  }, [])
  const workspaceLabel = currentPath
    ? getBaseName(currentPath)
    : '选择工作目录'
  const activeTreePath = activeFileTab?.filePath ?? activeDiffTab?.diff.change.path ?? null

  const {
    closeEditorTab,
    confirmDiscardDirtyTabs,
    consumeInternalWorkspaceSave,
    ensureWorkspaceTabsSavedBeforeGitAction,
    ensureWorkspaceTabsSavedBeforeNodeMutation,
    flushDiffAutosave,
    flushWorkspaceTabsForNode,
    flushWorkspaceAutosave,
    saveActiveTab: handleSaveActiveTab,
    saveDiffFile: handleSaveDiffFile,
    saveWorkspaceFile: handleSave,
    syncPersistedActiveFile,
  } = useWorkspaceDocumentPersistence({
    activeDiffHasDirtyRelatedFileTab,
    activeDiffTab,
    activeWorkspaceAutosaveTab,
    captureActiveMeoViewPosition,
    currentFileContent,
    currentFilePath,
    currentPath,
    displayActiveTabId,
    isActiveEditorComposing,
    refreshWorkspaceAfterSave: refreshWorkspaceAfterDocumentSave,
    requestConfirmation,
    setStatusMessage,
  })

  const {
    applyDiffSelection: handleApplyGitDiffSelection,
    busyLabel: gitBusyLabel,
    commit: handleCommitGitChanges,
    commitAndSync: handleCommitAndSyncGitChanges,
    commitMessage: gitCommitMessage,
    discardAll: handleDiscardAllGitChanges,
    discardChange: handleDiscardGitChange,
    discardChanges: handleDiscardGitChanges,
    historyRefreshVersion: gitHistoryRefreshVersion,
    initializeRepository: handleInitializeGit,
    isLoading: isGitLoading,
    panelLayout: gitPanelLayout,
    prepareGitWorkspace,
    pull: handlePullGitChanges,
    push: handlePushGitChanges,
    refreshGitState,
    refreshPanel: refreshGitPanel,
    repositoryState: gitRepositoryState,
    resetGitWorkspaceState,
    revertCommit: handleRevertGitCommit,
    setCommitMessage: setGitCommitMessage,
    setPanelLayout: setGitPanelLayout,
    stagePaths: handleStageGitPaths,
    unstagePaths: handleUnstageGitPaths,
  } = useGitWorkspaceController({
    ensureWorkspaceTabsSaved: ensureWorkspaceTabsSavedBeforeGitAction,
    loadWorkspaceTree: reloadActiveWorkspaceTree,
    reconcileDiscardedFile: reconcileWorkspaceFileAfterGitDiscard,
    requestConfirmation,
    setStatusMessage,
    syncOpenDiffTabs,
    workspacePath: currentPath,
  })

  const shellLayout = useShellLayoutController({
    gitPanelLayout,
    isAgentLayout,
    platform,
    shouldExposeRightSidebar: shouldExposeAgentWorkspaceTools,
  })
  const {
    activeLeftSidebarTab,
    closeDrawers,
    closeLeftDrawer,
    closeRightDrawer,
    expandAgentEditorSurface,
    expandCollapsedAssistantSurface,
    handleLeftDrawerOpenChange,
    handleRightDrawerOpenChange,
    isLeftDrawerOpen,
    isLeftSidebarDrawer,
    isLeftSidebarVisible,
    isRightDrawerOpen,
    isRightSidebarDrawer,
    leftDrawerOverlayRoot,
    leftDrawerSurfaceRef,
    revealEditorAssistantSurface,
    rightDrawerOverlayRoot,
    setActiveLeftSidebarTab,
    setLeftDrawerOverlayRoot,
    shellChromeVars,
    shellPlatform,
    toggleWorkspaceSidebar,
  } = shellLayout

  const performWorkspaceRefresh = useCallback(async (
    rootPath: string,
    options: Omit<WorkspaceRefreshRequest, 'rootPath'> = {},
  ) => {
    if (!isActiveWorkspacePath(rootPath)) {
      return
    }

    if (options.refreshTree) {
      await reloadActiveWorkspaceTree(rootPath)
    }

    if (options.refreshGit) {
      await refreshGitState(rootPath, { silent: options.gitSilent ?? true })
    }
  }, [isActiveWorkspacePath, refreshGitState, reloadActiveWorkspaceTree])

  performWorkspaceRefreshRef.current = async (request) => {
    await performWorkspaceRefresh(request.rootPath, request)
  }

  const {
    activateFileTab,
    cycleTabs,
    openAgentMessageFile,
    openFile,
    openGitCommitFileDiff,
    openGitDiff,
    replaceActiveFileWithPath,
    restoreWorkspaceTabs,
  } = useWorkspaceDocumentNavigation({
    captureActiveMeoViewPosition,
    currentPath,
    displayActiveTabId,
    displayTabs,
    expandAgentEditorSurface,
    flushWorkspaceAutosave,
    isActiveEditorComposing,
    isLeftSidebarDrawer,
    isRightSidebarDrawer,
    setActiveAgentLayoutFixedTab,
    setIsAgentLayoutFixedTabActive,
    closeLeftDrawer,
    closeRightDrawer,
    setStatusMessage,
  })
  const handleOpenMeoEditorGitDiff = useCallback<MeoOpenGitDiffHandler>((targetFilePath, gitAction) => {
    if (!currentPath) {
      return
    }

    void (async () => {
      const latestGitState = await refreshGitState(currentPath, { silent: true })
      const nextChange = findGitChangeByFilePath(
        latestGitState,
        targetFilePath,
        gitAction?.source === 'revision' ? ['staged', 'unstaged'] : ['unstaged', 'staged'],
      )

      if (nextChange) {
        await openGitDiff(nextChange, { ...gitAction, view: 'meo' })
      }
    })()
  }, [currentPath, openGitDiff, refreshGitState])

  const {
    createDirectory: handleCreateDirectory,
    createFile: handleCreateFile,
    deleteNode: handleDeleteNode,
    expandedPaths,
    isCreatingDirectory,
    isCreatingFile,
    moveNode: handleMoveNode,
    renameNode: handleRenameNode,
    resetExpandedPaths,
    setExpandedPaths,
    toggleTreeExpansion: handleToggleFileTreeExpansion,
  } = useWorkspaceFileOperations({
    currentPath,
    ensureWorkspaceTabsSavedBeforeNodeMutation,
    flushWorkspaceTabsForNode,
    openFile,
    performWorkspaceRefresh,
    requestConfirmation,
    setStatusMessage,
    syncPersistedActiveFile,
    tree,
  })

  const {
    activeProject,
    addExistingProject: handleAddExistingProject,
    clearPendingAgentProjectSessionRequest,
    closeProjectMenu,
    completeAgentProjectSessionRequest,
    connectWorkspace,
    createEmptyProject: handleCreateEmptyProject,
    disconnectWorkspaceSurface,
    enterProjectlessConversation,
    handleNewProjectDialogOpenChange,
    hydrateProjectState,
    isNewProjectDialogOpen,
    isPickingWorkspace,
    isProjectActionBusy,
    needsProjectBootstrap,
    openNewProjectDialog,
    openProjectMenu,
    openProjectSession: handleOpenProjectSession,
    pendingAgentProjectSessionRequest,
    projectMenuAnchorRect,
    projectMenuMode,
    projectMenuSurface,
    projectState,
    queueCurrentProjectSession,
    removeProject: handleRemoveProject,
    selectProject: handleSelectProject,
    showProjectInFolder: handleShowProjectInFolder,
    startProjectSession: handleStartProjectSession,
    workspaceUnavailableMessage,
  } = useWorkspaceProjectController({
    activeWorkspaceContext,
    confirmDiscardDirtyTabs,
    currentPathRef,
    flushDiffAutosave,
    flushWorkspaceAutosave,
    isAgentLayout,
    loadTree,
    prepareGitWorkspace,
    refreshGitState,
    requestConfirmation,
    resetExpandedPaths,
    resetGitWorkspaceState,
    restoreWorkspaceTabs,
    setActiveWorkspaceContext,
    setAgentWorkspaceState,
    setIsAgentLayoutFixedTabActive,
    setStatusMessage,
  })
  const {
    conversationDraftFailed: handleConversationDraftFailed,
    conversationSessionStarted: handleConversationSessionStarted,
    conversationState,
    conversationTitleSuggested: handleConversationTitleSuggested,
    createConversationWorkspace: handleCreateConversationWorkspace,
    enterConversationDraft,
    hydrateConversationState,
    openConversation: handleOpenConversation,
    removeConversation: handleRemoveConversation,
    renameConversation: handleRenameConversation,
    restoreInitialConversationContext,
    startStandaloneConversation: handleStartStandaloneConversation,
  } = useConversationController({
    activeWorkspaceContext,
    clearPendingAgentProjectSessionRequest,
    confirmDiscardDirtyTabs,
    connectWorkspace,
    currentPathRef,
    disconnectWorkspaceSurface,
    flushDiffAutosave,
    flushWorkspaceAutosave,
    requestConfirmation,
    restoreWorkspaceTabs,
    setActiveWorkspaceContext,
    setStatusMessage,
  })
  const editorWorkspaceSwitchLabel = activeWorkspaceContext.kind === 'project' && activeProject
    ? activeProject.name
    : workspaceLabel
  const isProjectMenuOpen = Boolean(projectMenuMode)
  const isProjectAddMenuOpenForSurface = (surface: ProjectMenuSurface) => (
    isProjectMenuOpen
    && projectMenuMode === 'agent-add'
    && projectMenuSurface === surface
  )
  const isGlobalProjectMenuOpen = isProjectMenuOpen && projectMenuSurface === 'global'
  const {
    closeCommandPalette,
    isAppModalLayerOpen,
    isCommandPaletteOpen,
    isSettingsOpen,
    isShortcutBlockingLayerOpen,
    openCommandPaletteFromChrome,
    openSettings,
    setIsSettingsOpen,
    setSettingsSection,
    settingsSection,
    toggleCommandPalette,
  } = useAppOverlayController({
    closeDrawers,
    hasConfirmation: Boolean(confirmation),
    isGlobalProjectMenuOpen,
    isNewProjectDialogOpen,
    isProjectMenuOpen,
  })

  async function handleStartContextualConversation() {
    if (activeProject) {
      await handleStartProjectSession(activeProject)
      return
    }

    await handleStartStandaloneConversation()
  }

  async function handleUseNoProject() {
    await enterProjectlessConversation(enterConversationDraft)
  }

  const projectMenuLayerConfiguration: ProjectMenuLayerConfiguration = {
    activeProjectId: activeWorkspaceContext.kind === 'project'
      ? activeWorkspaceContext.projectId
      : null,
    activeSurface: projectMenuSurface,
    anchorRect: projectMenuAnchorRect,
    canUseNoProject: isAgentLayout && activeWorkspaceContext.kind === 'project',
    isBusy: isProjectActionBusy,
    leftDrawerPortal: leftDrawerOverlayRoot,
    mode: projectMenuMode,
    projects: projectState.projects,
    rightDrawerPortal: rightDrawerOverlayRoot,
    onAddExistingProject: handleAddExistingProject,
    onClose: closeProjectMenu,
    onCreateProject: openNewProjectDialog,
    onSelectProject: handleSelectProject,
    onUseNoProject: handleUseNoProject,
  }
  const workspaceNavigationConfiguration: WorkspaceNavigationPanelConfiguration = {
    activeTab: activeLeftSidebarTab,
    activeTreePath,
    gitPanel: {
      busyLabel: gitBusyLabel,
      commitMessage: gitCommitMessage,
      historyRefreshVersion: gitHistoryRefreshVersion,
      iconTheme,
      isLoading: isGitLoading,
      layout: gitPanelLayout,
      repositoryState: gitRepositoryState,
      workspacePath: currentPath,
      onCommit: handleCommitGitChanges,
      onCommitAndSync: handleCommitAndSyncGitChanges,
      onCommitMessageChange: setGitCommitMessage,
      onDiscardAll: handleDiscardAllGitChanges,
      onDiscardMany: handleDiscardGitChanges,
      onInitialize: handleInitializeGit,
      onLayoutChange: setGitPanelLayout,
      onOpenCommitFileDiff: (commitHash, change) => {
        void openGitCommitFileDiff(commitHash, change)
      },
      onOpenDiff: (change) => {
        void openGitDiff(change)
      },
      onOpenFile: (filePath) => {
        void openFile(filePath)
      },
      onOpenMeoDiff: (change) => {
        void openGitDiff(change, { mode: 'split', view: 'meo' })
      },
      onPull: handlePullGitChanges,
      onPush: handlePushGitChanges,
      onRefresh: refreshGitPanel,
      onRevertCommit: handleRevertGitCommit,
      onStage: handleStageGitPaths,
      onUnstage: handleUnstageGitPaths,
    },
    treePanel: {
      expandedPaths,
      gitRepositoryState,
      iconTheme,
      isCreatingDirectory,
      isCreatingFile,
      nodes: tree,
      setExpandedPaths,
      workspacePath: currentPath,
      workspaceUnavailableMessage,
      onCreateDirectory: () => void handleCreateDirectory(),
      onCreateFile: () => void handleCreateFile(),
      onDeleteNode: (node) => handleDeleteNode(node),
      onMoveNode: (node, targetDirectoryPath) => handleMoveNode(node, targetDirectoryPath),
      onOpenDiff: (change) => {
        void openGitDiff(change)
      },
      onOpenInCodeEditor: (filePath) => {
        void openFile(filePath, currentPath, 'code')
      },
      onRenameNode: (node, nextName) => handleRenameNode(node, nextName),
      onToggleFileTreeExpansion: handleToggleFileTreeExpansion,
    },
    workspaceLabel: editorWorkspaceSwitchLabel,
    onActiveTabChange: setActiveLeftSidebarTab,
    onOpenFile: (filePath) => {
      void openFile(filePath)
    },
    onReplaceActiveFile: (filePath) => {
      void replaceActiveFileWithPath(filePath)
    },
  }

  useAppBootstrap({
    connectWorkspace,
    hydrateConversationState,
    hydrateProjectState,
    hydrateWorkspaceIconThemes,
    restoreInitialConversationContext,
    restoreWorkspaceTabs,
    setActiveWorkspaceContext,
    setStatusMessage,
  })

  useEffect(() => {
    return () => {
      workspaceRefreshCoordinatorRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    setIsActiveEditorComposing(false)
  }, [currentEditorKind, currentFilePath, currentFileViewMode])

  useWorkspaceChangeSubscription({
    consumeInternalWorkspaceSave,
    currentPath,
    requestWorkspaceRefresh,
    setStatusMessage,
  })

  const handleRequestWindowClose = useAppWindowClose({
    confirmDiscardDirtyTabs,
  })

  useEffect(() => {
    return () => {
      void window.appApi.stopWorkspaceWatch()
    }
  }, [])

  useAppKeyboardShortcuts({
    activeTabId: displayActiveTabId,
    closeActiveTab: closeEditorTab,
    cycleTabs,
    isShortcutBlockingLayerOpen,
    onSaveActiveTab: handleSaveActiveTab,
    onStartContextualConversation: handleStartContextualConversation,
    onToggleCommandPalette: toggleCommandPalette,
    platform,
  })

  useWorkspaceTabPersistence(currentPath, activeTabId, openTabs)

  useEffect(() => {
    if (!projectMenuMode) {
      return
    }

    if (
      (projectMenuSurface === 'left-drawer' && !isLeftDrawerOpen)
      || (projectMenuSurface === 'right-drawer' && !isRightDrawerOpen)
    ) {
      closeProjectMenu()
    }
  }, [isLeftDrawerOpen, isRightDrawerOpen, projectMenuMode, projectMenuSurface])

  const handleOpenSession = useCallback((sessionPath: string) => {
    if (queueCurrentProjectSession(
      sessionPath,
      agentWorkspaceState?.runtime.agentId ?? DEFAULT_AGENT_ID,
    )) {
      revealEditorAssistantSurface()
    }
  }, [agentWorkspaceState?.runtime.agentId, queueCurrentProjectSession, revealEditorAssistantSurface])
  function handleCollapsedAgentFixedTabClick(tab: AgentLayoutFixedTab) {
    expandCollapsedAssistantSurface()

    if (tab === 'git') {
      activateFileTab(FIXED_GIT_TAB_ID)
      return
    }

    activateFileTab(FIXED_FILE_TAB_ID)
  }

  const isEditorLayoutSwitchDisabled = activeWorkspaceContext.kind === 'conversationDraft' && isAgentLayout

  function renderWorkspaceSidebar(surfaceMode: PanelSurfaceMode) {
    return (
      <WorkspaceNavigationSurface
        configuration={workspaceNavigationConfiguration}
        isAgentLayout={isAgentLayout}
        isDrawerOpen={isLeftDrawerOpen}
        isPickingWorkspace={isPickingWorkspace}
        isProjectAddMenuOpen={isProjectAddMenuOpenForSurface(
          surfaceMode === 'drawer' ? 'left-drawer' : 'global',
        )}
        isSidebarDrawer={isLeftSidebarDrawer}
        isSidebarVisible={isLeftSidebarVisible}
        overlayRoot={leftDrawerOverlayRoot}
        overlayRootRef={setLeftDrawerOverlayRoot}
        projectMenu={projectMenuLayerConfiguration}
        shellChromeStyle={shellChromeVars}
        shellPlatform={shellPlatform}
        surfaceMode={surfaceMode}
        surfaceRef={leftDrawerSurfaceRef}
        onOpenCommandPalette={openCommandPaletteFromChrome}
        onOpenProjectMenu={(mode, surface, anchorRect) => {
          openProjectMenu(mode, anchorRect, { surface })
        }}
        onOpenSettings={openSettings}
        onRequestDrawerClose={() => handleLeftDrawerOpenChange(false)}
        onToggleSidebar={toggleWorkspaceSidebar}
      />
    )
  }

  function renderEditorWorkbench() {
    return (
      <WorkspaceEditorWorkbench
        activeFixedPanelTab={activeFixedPanelTab}
        editorContent={{
          activeDiffTab,
          activeFileTab,
          diffActions: {
            discardChange: (change) => {
              void handleDiscardGitChange(change)
            },
            saveEditedFile: handleSaveDiffFile,
            stagePaths: (filePaths) => {
              void handleStageGitPaths(filePaths)
            },
            unstagePaths: (filePaths) => {
              void handleUnstageGitPaths(filePaths)
            },
          },
          diffDraftContent: activeDiffDraftContent,
          diffHasDirtyRelatedFileTab: activeDiffHasDirtyRelatedFileTab,
          fileActions: {
            applyGitDiffSelection: handleApplyGitDiffSelection,
            compositionChange: setIsActiveEditorComposing,
            openFile: (targetFilePath) => {
              void openFile(targetFilePath, currentPath, 'meo')
            },
            openGitDiff: handleOpenMeoEditorGitDiff,
            saveFile: (filePath, content) => {
              void handleSave({ content, filePath })
            },
          },
          gitRepositoryState,
          iconTheme,
          isVisible: shouldRenderWorkspaceEditor,
          meoEditorHostRef,
          meoSettings: meo,
          theme,
          workspacePath: currentPath,
        }}
        emptyState={{
          hasWorkspace: Boolean(currentPath),
          isPickingWorkspace,
          onOpenWorkspaceSwitch: (anchorRect) => {
            openProjectMenu('editor-switch', anchorRect)
          },
        }}
        fileSystemPanel={{
          fileSystemState: workspaceFileSystemState,
          gitRepositoryState,
          iconTheme,
          meoSettings: meo,
          nodes: tree,
          theme,
          title: workspaceLabel,
          workspacePath: currentPath,
          workspaceUnavailableMessage,
          onFileSystemNavigationChange: handleWorkspaceFileSystemNavigationChange,
          onFileSystemSelectionChange: handleWorkspaceFileSystemSelectionChange,
          onFileSystemViewChange: handleWorkspaceFileSystemViewChange,
          onOpenFile: (filePath) => {
            void openFile(filePath)
          },
        }}
        fileTabs={{
          activeTabId: displayActiveTabId,
          iconTheme,
          tabs: displayTabs,
          workspacePath: currentPath,
          getHasDiff: (filePath) => Boolean(findGitChangeByFilePath(gitRepositoryState, filePath)),
          onActivate: activateFileTab,
          onClose: (tabId) => {
            void closeEditorTab(tabId)
          },
          onMoveTab: (movingId, targetId, position) => {
            moveTab(movingId, targetId, position)
          },
          onOpenDiff: async (filePath) => {
            const latestGitState = await refreshGitState(currentPath, { silent: true })
            const nextChange = findGitChangeByFilePath(latestGitState, filePath)
            if (nextChange) {
              void openGitDiff(nextChange)
            }
          },
        }}
        isDirectorySidebarAvailable={isDirectorySidebarAvailable}
        isDirectorySidebarVisible={isDirectorySidebarVisible}
        isDirectoryToggleSlotVisible={isDirectoryToggleSlotVisible}
        navigation={workspaceNavigationConfiguration}
        onToggleDirectorySidebar={toggleDirectorySidebar}
      />
    )
  }

  function renderCenterPanel() {
    if (needsProjectBootstrap) {
      return (
        <ProjectBootstrap
          isBusy={isProjectActionBusy}
          onAddExistingProject={handleAddExistingProject}
          onCreateProject={openNewProjectDialog}
        />
      )
    }

    return isAgentLayout ? <AgentChatSurface /> : renderEditorWorkbench()
  }

  function renderRightPanel(surfaceMode: PanelSurfaceMode) {
    if (surfaceMode === 'docked' && needsProjectBootstrap) {
      return null
    }

    return isAgentLayout ? renderEditorWorkbench() : <AgentChatSurface />
  }

  const appShell = (
    <AppShell
      appLayout={appLayoutPreference}
      isDarkTheme={resolvedTheme === 'dark'}
      isModalLayerOpen={isAppModalLayerOpen}
      layout={shellLayout}
      layoutModeSwitch={(
        <AppLayoutModeSwitch
          isEditorDisabled={isEditorLayoutSwitchDisabled}
          value={appLayoutPreference}
          onValueChange={setLayoutPreference}
        />
      )}
      leftChromeSearchAction={<AppChromeSearchButton onClick={openCommandPaletteFromChrome} />}
      leftChromeSidebarAction={(
        <AppChromeSidebarToggleButton
          isDrawer={isLeftSidebarDrawer}
          isDrawerOpen={isLeftDrawerOpen}
          isSidebarVisible={isLeftSidebarVisible}
          onClick={toggleWorkspaceSidebar}
        />
      )}
      onRequestWindowClose={() => {
        void handleRequestWindowClose()
      }}
      renderCenterPanel={renderCenterPanel}
      renderLeftSidebar={renderWorkspaceSidebar}
      renderRightDrawerOverlay={(frameRect) => (
        <ProjectMenuLayer
          configuration={projectMenuLayerConfiguration}
          frameRect={frameRect}
          surface='right-drawer'
        />
      )}
      renderRightPanel={renderRightPanel}
      rightCollapsedActions={(
        <>
          <AppTooltipButton
            type='button'
            className='agent-collapsed-tab-button'
            aria-label='Expand right sidebar and open Git'
            tooltip='更改'
            preventFocusOnPress
            onClick={() => {
              handleCollapsedAgentFixedTabClick('git')
            }}
          >
            <GitBranchLine size={16} />
          </AppTooltipButton>
          <AppTooltipButton
            type='button'
            className='agent-collapsed-tab-button'
            aria-label='Expand right sidebar and open files'
            tooltip='文件'
            preventFocusOnPress
            onClick={() => {
              handleCollapsedAgentFixedTabClick('file')
            }}
          >
            <FolderLine size={16} />
          </AppTooltipButton>
        </>
      )}
      shouldExposeRightPanelTools={shouldExposeAgentWorkspaceTools}
    >
      <Toast.Provider placement='bottom end' />

      <ProjectMenuLayer
        configuration={projectMenuLayerConfiguration}
        surface='global'
      />
      <NewProjectDialog
        isBusy={isProjectActionBusy}
        isOpen={isNewProjectDialogOpen}
        theme={resolvedTheme}
        onCreate={handleCreateEmptyProject}
        onOpenChange={handleNewProjectDialogOpenChange}
      />

      <SettingsDialog
        activeSection={settingsSection}
        agentState={agentWorkspaceState}
        iconThemes={iconThemes}
        iconThemeOptions={iconThemeOptions}
        isIconThemeBusy={isApplyingIconTheme}
        isOpen={isSettingsOpen}
        resolvedTheme={resolvedTheme}
        workspacePath={currentPath}
        onAgentStateChange={setAgentWorkspaceState}
        onOpenChange={setIsSettingsOpen}
        onSectionChange={setSettingsSection}
        onSelectIconTheme={selectWorkspaceIconTheme}
        onStatusMessage={setStatusMessage}
      />

      <AppConfirmDialog
        confirmation={confirmation}
        onCancel={cancelConfirmation}
        onConfirm={confirmConfirmation}
      />

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={closeCommandPalette}
        files={tree}
        sessions={agentWorkspaceState?.sessions ?? []}
        iconTheme={iconTheme}
        onOpenFile={openFile}
        onOpenSession={handleOpenSession}
        theme={theme}
      />
    </AppShell>
  )

  const agentSurfaceMode = !isAgentLayout && isRightSidebarDrawer ? 'drawer' : 'docked'
  const agentProjectMenuSurface: ProjectMenuSurface = agentSurfaceMode === 'drawer' ? 'right-drawer' : 'global'

  return (
    <AgentProvider
      activeWorkspaceContext={activeWorkspaceContext}
      conversationState={conversationState}
      externalSessionRequest={pendingAgentProjectSessionRequest}
      onExternalSessionRequestHandled={completeAgentProjectSessionRequest}
      iconTheme={iconTheme}
      onConversationDraftFailed={handleConversationDraftFailed}
      onConversationSessionStarted={handleConversationSessionStarted}
      onConversationTitleSuggested={handleConversationTitleSuggested}
      onCreateConversationWorkspace={handleCreateConversationWorkspace}
      onOpenMessageFile={openAgentMessageFile}
      onOpenConversation={handleOpenConversation}
      onRenameConversation={handleRenameConversation}
      onRemoveConversation={handleRemoveConversation}
      onOpenProviderSettings={() => {
        if (agentSurfaceMode === 'drawer') {
          handleRightDrawerOpenChange(false)
        }

        openSettings('providers')
      }}
      workspacePath={currentPath}
      workspaceState={agentWorkspaceState}
      onWorkspaceStateChange={setAgentWorkspaceState}
      isAgentLayout={isAgentLayout}
      surfaceMode={agentSurfaceMode}
      onOpenProjectAddMenu={(anchorRect) => openProjectMenu('agent-add', anchorRect, {
        surface: agentProjectMenuSurface,
      })}
      onOpenProjectSwitchMenu={(anchorRect, options) => openProjectMenu(
        options?.startNewSession ? 'agent-new-switch' : 'editor-switch',
        anchorRect,
        { surface: agentProjectMenuSurface },
      )}
      onOpenProjectFolder={handleShowProjectInFolder}
      onOpenProjectSession={handleOpenProjectSession}
      onRemoveProject={handleRemoveProject}
      onStartStandaloneConversation={handleStartStandaloneConversation}
      onStartProjectSession={handleStartProjectSession}
      projectState={projectState}
      isProjectAddMenuOpen={isProjectAddMenuOpenForSurface(agentProjectMenuSurface)}
    >
      {appShell}
    </AgentProvider>
  )
}

export default App

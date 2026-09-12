import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppConfirmation } from '@/components/app-confirm-dialog/app-confirm-dialog'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import { useConversationController } from '@/features/conversations/hooks/use-conversation-controller'
import { conversationDraftContext } from '@/features/conversations/lib/conversation-state'
import { DEFAULT_AGENT_ID } from '@/features/agent/agent-definition'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host/meo-editor-host'
import type { MeoOpenGitDiffHandler } from '@/features/editor/lib/meo-native-editor-types'
import { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import type { ProjectMenuLayerConfiguration } from '@/features/workspace/components/project-menu/project-menu-layer'
import { createWorkspaceEditorConfiguration } from '@/features/workspace/components/workspace-workbench/workspace-editor-configuration'
import { createWorkspaceNavigationConfiguration } from '@/features/workspace/components/workspace-workbench/workspace-navigation-configuration'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import { getBaseName, normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import { WorkspaceNavigationCoordinator } from '@/features/workspace/lib/workspace-navigation-coordinator'
import { useWorkspaceChangeSubscription } from '@/features/workspace/hooks/use-workspace-change-subscription'
import { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import { useWorkspaceDocumentPersistence } from '@/features/workspace/hooks/use-workspace-document-persistence'
import { useWorkspaceEditorSurfaceController } from '@/features/workspace/hooks/use-workspace-editor-surface-controller'
import { useWorkspaceFileOperations } from '@/features/workspace/hooks/use-workspace-file-operations'
import { useWorkspaceFileSystemState } from '@/features/workspace/hooks/use-workspace-file-system-state'
import { useWorkspaceProjectController } from '@/features/workspace/hooks/use-workspace-project-controller'
import {
  useWorkspaceRefreshController,
  type WorkspaceGitRefresh,
} from '@/features/workspace/hooks/use-workspace-refresh-controller'
import { useWorkspaceSyncController } from '@/features/workspace/hooks/use-workspace-sync-controller'
import { useSettingsStore } from '@/hooks/use-settings-store'
import { useAppBootstrap } from '@/hooks/use-app-bootstrap'
import { useAppKeyboardShortcuts } from '@/hooks/use-app-keyboard-shortcuts'
import { useAppOverlayController } from '@/hooks/use-app-overlay-controller'
import { useAppWindowClose } from '@/hooks/use-app-window-close'
import { useDevToolsFocusSettlement } from '@/hooks/use-devtools-focus-settlement'
import { AppOverlayLayer } from '@/features/layout/components/app-overlay-layer/app-overlay-layer'
import { useShellLayoutController } from '@/features/layout/hooks/use-shell-layout-controller'
import { useAppAppearanceController } from '@/features/appearance/hooks/use-app-appearance-controller'
import { openDuoProjectSession, useDuoStore } from '@/features/duo/duo-state'
import { useDuoWorkspaceSync } from '@/features/duo/use-duo-workspace-sync'
import { flushDuoPersistence } from '@/features/duo/duo-persistence'
import { DuoWorkspaceShell, startDuoConversation, type DuoWorkspaceHandle } from '@/features/duo/duo-workspace-shell'
import { captureDuoDocumentTarget } from '@/features/duo/duo-document-navigation'

function App() {
  const platform = window.appApi.platform
  const { meo, theme } = useSettingsStore()
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
  const workspaceNavigationCoordinatorRef = useRef<WorkspaceNavigationCoordinator | null>(null)
  workspaceNavigationCoordinatorRef.current ??= new WorkspaceNavigationCoordinator()
  const workspaceNavigationCoordinator = workspaceNavigationCoordinatorRef.current

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
  const workspaceFileSystem = useWorkspaceFileSystemState(currentPath)
  // Shared document controllers use the full workspace surface in the Duo shell.
  const isAgentLayout = false
  const duoRef = useRef<DuoWorkspaceHandle>(null)
  const duoInitialized = useDuoStore((state) => state.initialized)
  const captureDocumentTarget = useCallback(() => captureDuoDocumentTarget(), [])
  const workspaceEditorSurface = useWorkspaceEditorSurfaceController({
    activeTabId,
    currentPath,
    isAgentLayout,
    openTabs,
  })
  const {
    activeDiffHasDirtyRelatedFileTab,
    activeDiffTab,
    activeFileTab,
    activeWorkspaceAutosaveTab,
    currentEditorKind,
    currentFileContent,
    currentFilePath,
    currentFileViewMode,
    displayActiveTabId,
    displayTabs,
    setActiveAgentLayoutFixedTab,
    setIsAgentLayoutFixedTabActive,
  } = workspaceEditorSurface
  const isActiveMeoEditorMountedRef = useRef(false)
  isActiveMeoEditorMountedRef.current = currentEditorKind === 'prose' && currentFileViewMode === 'meo'
  const [isActiveEditorComposing, setIsActiveEditorComposing] = useState(false)
  const {
    currentPathRef,
    ensureFullyLoadedWorkspaceTree,
    isActiveWorkspacePath,
    loadTree,
    reconcileWorkspaceFileAfterGitDiscard,
    reloadActiveWorkspaceTree,
    syncOpenDiffTabs,
  } = useWorkspaceSyncController(currentPath, isAgentLayout)
  useDevToolsFocusSettlement()

  useEffect(() => {
    if (isAgentLayout || !currentPath) return
    void ensureFullyLoadedWorkspaceTree(currentPath)
  }, [currentPath, ensureFullyLoadedWorkspaceTree, isAgentLayout])
  const reloadVisibleWorkspaceTree = useCallback((rootPath: string) => (
    reloadActiveWorkspaceTree(rootPath, {
      scope: isAgentLayout ? 'root' : 'recursive',
    })
  ), [isAgentLayout, reloadActiveWorkspaceTree])

  // Persistence needs a refresh callback before the Git controller is created.
  // This stable delegate is connected to the current Git controller below.
  const refreshGitStateRef = useRef<WorkspaceGitRefresh>(async () => null)
  const refreshGitWorkspace = useCallback<WorkspaceGitRefresh>((
    workspacePath,
    options,
  ) => refreshGitStateRef.current(workspacePath, options), [])
  const {
    performWorkspaceRefresh,
    refreshWorkspaceAfterDocumentSave,
    requestWorkspaceRefresh,
  } = useWorkspaceRefreshController({
    isActiveWorkspacePath,
    refreshGitState: refreshGitWorkspace,
    reloadActiveWorkspaceTree: reloadVisibleWorkspaceTree,
  })
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

  const workspaceDocumentPersistence = useWorkspaceDocumentPersistence({
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
    closeEditorTab,
    confirmDiscardDirtyTabs,
    consumeInternalWorkspaceSave,
    ensureWorkspaceTabsSavedBeforeGitAction,
    ensureWorkspaceTabsSavedBeforeNodeMutation,
    flushDiffAutosave,
    flushWorkspaceTabsForNode,
    flushWorkspaceAutosave,
    saveActiveTab: handleSaveActiveTab,
    syncPersistedActiveFile,
  } = workspaceDocumentPersistence

  const gitWorkspace = useGitWorkspaceController({
    ensureWorkspaceTabsSaved: ensureWorkspaceTabsSavedBeforeGitAction,
    loadWorkspaceTree: reloadVisibleWorkspaceTree,
    reconcileDiscardedFile: reconcileWorkspaceFileAfterGitDiscard,
    requestConfirmation,
    setStatusMessage,
    syncOpenDiffTabs,
    workspacePath: currentPath,
  })
  const {
    panelLayout: gitPanelLayout,
    prepareGitWorkspace,
    refreshGitState,
    resetGitWorkspaceState,
  } = gitWorkspace
  refreshGitStateRef.current = refreshGitState

  const shellLayout = useShellLayoutController({
    gitPanelLayout,
    isAgentLayout,
    platform,
    shouldExposeRightSidebar: true,
  })
  const {
    activeLeftSidebarTab,
    closeDrawers,
    closeLeftDrawer,
    closeRightDrawer,
    expandAgentEditorSurface,
    isLeftDrawerOpen,
    isLeftSidebarDrawer,
    isRightDrawerOpen,
    isRightSidebarDrawer,
    leftDrawerOverlayRoot,
    rightDrawerOverlayRoot,
    setActiveLeftSidebarTab,
  } = shellLayout

  const workspaceDocumentNavigation = useWorkspaceDocumentNavigation({
    captureDocumentTarget,
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

  const {
    openFile,
    openGitDiff,
    restoreWorkspaceTabs,
  } = workspaceDocumentNavigation
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

  const workspaceFileOperations = useWorkspaceFileOperations({
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
    resetExpandedPaths,
  } = workspaceFileOperations

  const {
    activeProject,
    addExistingProject: handleAddExistingProject,
    clearPendingAgentProjectSessionRequest,
    closeProjectMenu,
    connectWorkspace,
    createEmptyProject: handleCreateEmptyProject,
    disconnectWorkspaceSurface,
    handleNewProjectDialogOpenChange,
    hydrateProjectState,
    isNewProjectDialogOpen,
    isPickingWorkspace,
    isProjectActionBusy,
    openNewProjectDialog,
    openProjectMenu,
    projectMenuAnchorRect,
    projectMenuMode,
    projectMenuSurface,
    projectState,
    selectProject: handleSelectProject,
    workspaceUnavailableMessage,
  } = useWorkspaceProjectController({
    preserveProjectTabs: true,
    activeWorkspaceContext,
    confirmDiscardDirtyTabs,
    currentPathRef,
    flushDiffAutosave,
    flushWorkspaceAutosave,
    isAgentLayout,
    loadTree,
    navigationCoordinator: workspaceNavigationCoordinator,
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
    conversationState,
    hydrateConversationState,
    restoreInitialConversationContext,
  } = useConversationController({
    activeWorkspaceContext,
    clearPendingAgentProjectSessionRequest,
    confirmDiscardDirtyTabs,
    connectWorkspace,
    currentPathRef,
    disconnectWorkspaceSurface,
    flushDiffAutosave,
    flushWorkspaceAutosave,
    navigationCoordinator: workspaceNavigationCoordinator,
    requestConfirmation,
    restoreWorkspaceTabs,
    setActiveWorkspaceContext,
    setStatusMessage,
  })
  const editorWorkspaceSwitchLabel = activeProject?.name ?? '选择项目'
  function handleOpenProjectSwitchMenu(anchorRect?: Parameters<typeof openProjectMenu>[1]) {
    openProjectMenu('editor-switch', anchorRect)
  }
  const isProjectMenuOpen = Boolean(projectMenuMode)
  const isGlobalProjectMenuOpen = isProjectMenuOpen && projectMenuSurface === 'global'
  const {
    closeCommandPalette,
    isAppModalLayerOpen,
    isCommandPaletteOpen,
    isSettingsOpen,
    isShortcutBlockingLayerOpen,
    openCommandPaletteFromChrome,
    openSettings,
    openSettingsSection,
    selectSettingsSection,
    setIsSettingsOpen,
    settingsSection,
    toggleCommandPalette,
  } = useAppOverlayController({
    closeDrawers,
    hasConfirmation: Boolean(confirmation),
    isGlobalProjectMenuOpen,
    isNewProjectDialogOpen,
    isProjectMenuOpen,
  })

  const projectMenuLayerConfiguration: ProjectMenuLayerConfiguration = {
    activeProjectId: activeProject?.id ?? null,
    activeSurface: projectMenuSurface,
    anchorRect: projectMenuAnchorRect,
    canUseNoProject: false,
    isBusy: isProjectActionBusy,
    leftDrawerPortal: leftDrawerOverlayRoot,
    mode: projectMenuMode,
    projects: projectState.projects,
    rightDrawerPortal: rightDrawerOverlayRoot,
    onAddExistingProject: handleAddExistingProject,
    onClose: closeProjectMenu,
    onCreateProject: openNewProjectDialog,
    onSelectProject: handleSelectProject,
    onUseNoProject: closeProjectMenu,
  }
  const workspaceNavigationConfiguration = createWorkspaceNavigationConfiguration({
    activeTab: activeLeftSidebarTab,
    activeTreePath,
    currentPath,
    fileOperations: workspaceFileOperations,
    git: gitWorkspace,
    iconTheme,
    navigation: workspaceDocumentNavigation,
    setActiveTab: setActiveLeftSidebarTab,
    tree,
    workspaceLabel: editorWorkspaceSwitchLabel,
    workspaceUnavailableMessage,
  })
  const workspaceEditorConfiguration = createWorkspaceEditorConfiguration({
    currentPath,
    editorHostRef: meoEditorHostRef,
    editorSurface: workspaceEditorSurface,
    fileSystem: workspaceFileSystem,
    git: gitWorkspace,
    iconTheme,
    isPickingWorkspace,
    meoSettings: meo,
    moveTab,
    navigation: workspaceDocumentNavigation,
    navigationConfiguration: workspaceNavigationConfiguration,
    onActiveEditorCompositionChange: setIsActiveEditorComposing,
    onOpenMeoEditorGitDiff: handleOpenMeoEditorGitDiff,
    onOpenWorkspaceSwitch: handleOpenProjectSwitchMenu,
    persistence: workspaceDocumentPersistence,
    theme,
    tree,
    workspaceLabel,
    workspaceUnavailableMessage,
  })

  const bootstrapReady = useAppBootstrap({
    projectWorkspace: true,
    connectWorkspace,
    hydrateConversationState,
    hydrateProjectState,
    hydrateWorkspaceIconThemes,
    navigationCoordinator: workspaceNavigationCoordinator,
    restoreInitialConversationContext,
    restoreWorkspaceTabs,
    setActiveWorkspaceContext,
    setStatusMessage,
  })

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
    beforeClose: flushDuoPersistence,
  })

  useEffect(() => {
    return () => {
      void window.appApi.stopWorkspaceWatch()
    }
  }, [])

  useAppKeyboardShortcuts({
    activeTabId: 'duo-active-tab',
    closeActiveTab: () => duoRef.current?.closeActiveTab(),
    cycleTabs: (direction) => duoRef.current?.cycleTabs(direction),
    isShortcutBlockingLayerOpen,
    onSaveActiveTab: () => {
      const duo = useDuoStore.getState()
      const pane = duo.panes[duo.focusedPane]
      if (pane.tabs.some((tab) => tab.kind === 'document' && tab.id === pane.activeTabId)) return handleSaveActiveTab()
    },
    onStartContextualConversation: () => startDuoConversation(activeProject, () => openProjectMenu('editor-switch')),
    onToggleCommandPalette: toggleCommandPalette,
    platform,
  })

  useDuoWorkspaceSync({ isActive: true, initialized: duoInitialized, bootstrapReady,
    conversationState, projectState, selectedProject: activeProject, workspaceUnavailableMessage })

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

  // A project switch keeps the previous surface mounted until the next layout
  // is ready. Its last runtime must not populate the new project's menus.
  const currentAgentWorkspaceState = activeProject && agentWorkspaceState?.runtime.workspacePath
    && normalizeFilePath(agentWorkspaceState.runtime.workspacePath) === normalizeFilePath(activeProject.path)
    ? agentWorkspaceState : null
  const handleOpenSession = useCallback((sessionPath: string, sessionLabel: string) => {
    if (!activeProject) return
    openDuoProjectSession(useDuoStore.getState().focusedPane, activeProject, {
      sessionPath,
      agentId: currentAgentWorkspaceState?.runtime.agentId ?? DEFAULT_AGENT_ID,
      sessionLabel,
    })
  }, [activeProject, currentAgentWorkspaceState?.runtime.agentId])

  const overlayLayer = (
    <AppOverlayLayer
        commandPalette={{
          files: tree,
          iconTheme,
          isOpen: isCommandPaletteOpen,
          sessions: currentAgentWorkspaceState?.sessions ?? [],
          theme,
          onClose: closeCommandPalette,
          onOpenFile: openFile,
          onOpenSession: handleOpenSession,
        }}
        confirmationDialog={{
          confirmation,
          onCancel: cancelConfirmation,
          onConfirm: confirmConfirmation,
        }}
        newProjectDialog={{
          isBusy: isProjectActionBusy,
          isOpen: isNewProjectDialogOpen,
          theme: resolvedTheme,
          onCreate: handleCreateEmptyProject,
          onOpenChange: handleNewProjectDialogOpenChange,
        }}
        projectMenu={projectMenuLayerConfiguration}
        settingsDialog={{
          activeSection: settingsSection,
          agentState: currentAgentWorkspaceState,
          iconThemeOptions,
          iconThemes,
          isIconThemeBusy: isApplyingIconTheme,
          isOpen: isSettingsOpen,
          resolvedTheme,
          workspacePath: currentPath,
          onAgentStateChange: setAgentWorkspaceState,
          onOpenChange: setIsSettingsOpen,
          onSectionChange: selectSettingsSection,
          onSelectIconTheme: selectWorkspaceIconTheme,
          onStatusMessage: setStatusMessage,
        }}
      />
  )

  return (
    <>
        <DuoWorkspaceShell
          ref={duoRef}
          configuration={{
            editor: workspaceEditorConfiguration,
            conversations: {
              projectState,
              selectedProject: activeProject,
              onChooseProject: handleOpenProjectSwitchMenu,
              onOpenProjectSwitchMenu: isPickingWorkspace ? undefined : handleOpenProjectSwitchMenu,
              iconTheme,
              theme: resolvedTheme,
              onOpenProviderSettings: () => openSettingsSection('providers'),
              onWorkspaceStateChange: setAgentWorkspaceState,
            },
            onCloseDocument: closeEditorTab,
            documentNavigation: workspaceDocumentNavigation,
            refreshGitState,
            confirmCloseConversation: () => requestConfirmation({
              title: '关闭对话标签页？',
              message: '输入框中还有未发送的内容。关闭此标签页会丢弃这些内容，已发送的对话记录会保留。',
              confirmLabel: '丢弃并关闭',
              isDanger: true,
            }),
          }}
          chromeVars={shellLayout.shellChromeVars}
          platform={shellLayout.shellPlatform}
          isFullScreen={shellLayout.isWindowFullScreen}
          isModalOpen={isAppModalLayerOpen}
          isActive
          workspaceLabel={editorWorkspaceSwitchLabel}
          isPickingWorkspace={isPickingWorkspace}
          isWorkspaceMenuOpen={isGlobalProjectMenuOpen && projectMenuMode === 'editor-switch'}
          onRequestClose={() => { void handleRequestWindowClose() }}
          onSearch={openCommandPaletteFromChrome}
          onSettings={openSettings}
          onWorkspace={handleOpenProjectSwitchMenu}
        />
    {overlayLayer}
    </>
  )
}

export default App

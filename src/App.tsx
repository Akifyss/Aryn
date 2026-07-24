import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppConfirmation } from '@/components/app-confirm-dialog/app-confirm-dialog'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import { useConversationController } from '@/features/conversations/hooks/use-conversation-controller'
import { conversationDraftContext } from '@/features/conversations/lib/conversation-state'
import { AgentProvider } from '@/features/agent/components/agent-sidebar/agent-sidebar'
import { DEFAULT_AGENT_ID } from '@/features/agent/agent-definition'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host/meo-editor-host'
import type { MeoOpenGitDiffHandler } from '@/features/editor/lib/meo-native-editor-types'
import { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import type { ProjectMenuSurface } from '@/features/workspace/components/project-menu/project-menu'
import type { ProjectMenuLayerConfiguration } from '@/features/workspace/components/project-menu/project-menu-layer'
import { createWorkspaceEditorConfiguration } from '@/features/workspace/components/workspace-workbench/workspace-editor-configuration'
import { createWorkspaceNavigationConfiguration } from '@/features/workspace/components/workspace-workbench/workspace-navigation-configuration'
import { useWorkspaceStore } from '@/features/workspace/store/use-workspace-store'
import { getBaseName } from '@/features/workspace/lib/workspace-paths'
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
import { useWorkspaceTabPersistence } from '@/features/workspace/hooks/use-workspace-tab-persistence'
import { useSettingsStore, type AppLayoutPreference } from '@/hooks/use-settings-store'
import { useAppBootstrap } from '@/hooks/use-app-bootstrap'
import { useAppKeyboardShortcuts } from '@/hooks/use-app-keyboard-shortcuts'
import { useAppOverlayController } from '@/hooks/use-app-overlay-controller'
import { useAppWindowClose } from '@/hooks/use-app-window-close'
import { useDevToolsFocusSettlement } from '@/hooks/use-devtools-focus-settlement'
import { AppOverlayLayer } from '@/features/layout/components/app-overlay-layer/app-overlay-layer'
import { AppWorkspaceShell } from '@/features/layout/components/app-workspace-shell/app-workspace-shell'
import { useShellLayoutController } from '@/features/layout/hooks/use-shell-layout-controller'
import { useAppAppearanceController } from '@/features/appearance/hooks/use-app-appearance-controller'
import './App.css'

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
  const workspaceFileSystem = useWorkspaceFileSystemState(currentPath)
  const appLayoutPreference: AppLayoutPreference = layoutPreference
  const isAgentLayout = appLayoutPreference === 'agent'
  const shouldExposeAgentWorkspaceTools = !isAgentLayout || Boolean(currentPath)
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
    isActiveWorkspacePath,
    loadTree,
    reconcileWorkspaceFileAfterGitDiscard,
    reloadActiveWorkspaceTree,
    syncOpenDiffTabs,
  } = useWorkspaceSyncController(currentPath)
  useDevToolsFocusSettlement()

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
    reloadActiveWorkspaceTree,
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
    loadWorkspaceTree: reloadActiveWorkspaceTree,
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
    shouldExposeRightSidebar: shouldExposeAgentWorkspaceTools,
  })
  const {
    activeLeftSidebarTab,
    closeDrawers,
    closeLeftDrawer,
    closeRightDrawer,
    expandAgentEditorSurface,
    handleRightDrawerOpenChange,
    isLeftDrawerOpen,
    isLeftSidebarDrawer,
    isRightDrawerOpen,
    isRightSidebarDrawer,
    leftDrawerOverlayRoot,
    revealEditorAssistantSurface,
    rightDrawerOverlayRoot,
    setActiveLeftSidebarTab,
  } = shellLayout

  const workspaceDocumentNavigation = useWorkspaceDocumentNavigation({
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
    activateFileTab,
    cycleTabs,
    openAgentMessageFile,
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
    onOpenWorkspaceSwitch: (anchorRect) => {
      openProjectMenu('editor-switch', anchorRect)
    },
    persistence: workspaceDocumentPersistence,
    theme,
    tree,
    workspaceLabel,
    workspaceUnavailableMessage,
  })

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
  const isEditorLayoutSwitchDisabled = activeWorkspaceContext.kind === 'conversationDraft' && isAgentLayout

  const appShell = (
    <AppWorkspaceShell
      appLayout={appLayoutPreference}
      isDarkTheme={resolvedTheme === 'dark'}
      isEditorLayoutSwitchDisabled={isEditorLayoutSwitchDisabled}
      isModalLayerOpen={isAppModalLayerOpen}
      layout={shellLayout}
      panels={{
        editor: workspaceEditorConfiguration,
        isAgentLayout,
        navigation: {
          configuration: workspaceNavigationConfiguration,
          isPickingWorkspace,
          isProjectAddMenuOpenForSurface,
          onOpenCommandPalette: openCommandPaletteFromChrome,
          onOpenProjectMenu: (mode, surface, anchorRect) => {
            openProjectMenu(mode, anchorRect, { surface })
          },
          onOpenSettings: openSettings,
        },
        projectBootstrap: {
          isVisible: needsProjectBootstrap,
          props: {
            isBusy: isProjectActionBusy,
            onAddExistingProject: handleAddExistingProject,
            onCreateProject: openNewProjectDialog,
          },
        },
      }}
      projectMenu={projectMenuLayerConfiguration}
      shouldExposeRightPanelTools={shouldExposeAgentWorkspaceTools}
      onActivateFileTab={activateFileTab}
      onLayoutChange={setLayoutPreference}
      onRequestWindowClose={() => {
        void handleRequestWindowClose()
      }}
    >
      <AppOverlayLayer
        commandPalette={{
          files: tree,
          iconTheme,
          isOpen: isCommandPaletteOpen,
          sessions: agentWorkspaceState?.sessions ?? [],
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
          agentState: agentWorkspaceState,
          iconThemeOptions,
          iconThemes,
          isIconThemeBusy: isApplyingIconTheme,
          isOpen: isSettingsOpen,
          resolvedTheme,
          workspacePath: currentPath,
          onAgentStateChange: setAgentWorkspaceState,
          onOpenChange: setIsSettingsOpen,
          onSectionChange: setSettingsSection,
          onSelectIconTheme: selectWorkspaceIconTheme,
          onStatusMessage: setStatusMessage,
        }}
      />
    </AppWorkspaceShell>
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

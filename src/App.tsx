import type { ReactNode } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Toast, toast, AlertDialog } from '@heroui/react'
import {
  FolderLine,
  GitBranchLine,
} from '@mingcute/react'
import type { ActiveWorkspaceContext } from '@/features/conversations/types'
import { useConversationController } from '@/features/conversations/hooks/use-conversation-controller'
import { conversationDraftContext } from '@/features/conversations/lib/conversation-state'
import { AppTooltipButton } from '@/components/app-tooltip'
import {
  AgentChatSurface,
  AgentProvider,
  AgentSessionTree,
} from '@/features/agent/components/agent-sidebar/agent-sidebar'
import { DEFAULT_AGENT_ID } from '@/features/agent/agent-definition'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host/meo-editor-host'
import { GitPanel } from '@/features/git/components/git-panel/git-panel'
import { useGitWorkspaceController } from '@/features/git/hooks/use-git-workspace-controller'
import { findGitChangeByFilePath } from '@/features/git/lib/repository-state'
import {
  SettingsDialog,
  type SettingsSectionId,
} from '@/features/settings/components/settings-dialog/settings-dialog'
import { FileTabs } from '@/features/workspace/components/file-tabs/file-tabs'
import { WorkspaceFileSystemPanel } from '@/features/workspace/components/workspace-file-system-panel/workspace-file-system-panel'
import { WorkspaceFilePreview } from '@/features/workspace/components/workspace-file-preview/workspace-file-preview'
import {
  WorkspaceEditorDirectorySidebar,
  WorkspaceEditorDirectoryToggle,
  WorkspaceEditorDirectoryToggleSlot,
  WorkspaceEditorDirectoryToggleSpacer,
  WorkspaceEditorEmptyState,
  WorkspaceEditorLoadingState,
  WorkspaceEditorSurface,
  WorkspaceEditorView,
} from '@/features/workspace/components/workspace-editor-surface/workspace-editor-surface'
import { WorkspaceTreePanel } from '@/features/workspace/components/workspace-tree-panel/workspace-tree-panel'
import {
  WorkspaceSidebar,
  type WorkspaceSidebarSurfaceMode as PanelSurfaceMode,
} from '@/features/workspace/components/workspace-sidebar/workspace-sidebar'
import {
  WorkspaceSidebarTabs,
} from '@/features/workspace/components/workspace-sidebar-tabs/workspace-sidebar-tabs'
import { NewProjectDialog } from '@/features/workspace/components/new-project-dialog/new-project-dialog'
import { ProjectBootstrap } from '@/features/workspace/components/project-bootstrap/project-bootstrap'
import {
  ProjectMenu,
  type ProjectMenuFrameRect,
  type ProjectMenuSurface,
} from '@/features/workspace/components/project-menu/project-menu'
import type { WorkspaceTreeActivationEvent } from '@/features/workspace/components/workspace-tree/workspace-tree'
import {
  useWorkspaceStore,
  type WorkspaceDiffTab,
} from '@/features/workspace/store/use-workspace-store'
import {
  getBaseName,
  normalizeFilePath,
} from '@/features/workspace/lib/workspace-paths'
import { getWorkspaceFileTabIdsForPath } from '@/features/workspace/lib/workspace-file-operation-state'
import {
  createDiffTab,
  FIXED_FILE_TAB_ID,
  FIXED_GIT_TAB_ID,
  type AgentLayoutFixedTab,
} from '@/features/workspace/lib/workspace-tabs'
import { useWorkspaceChangeSubscription } from '@/features/workspace/hooks/use-workspace-change-subscription'
import { useWorkspaceDocumentNavigation } from '@/features/workspace/hooks/use-workspace-document-navigation'
import { useWorkspaceDocumentPersistence } from '@/features/workspace/hooks/use-workspace-document-persistence'
import { useWorkspaceFileOperations } from '@/features/workspace/hooks/use-workspace-file-operations'
import { useWorkspaceFileSystemState } from '@/features/workspace/hooks/use-workspace-file-system-state'
import { useWorkspaceProjectController } from '@/features/workspace/hooks/use-workspace-project-controller'
import { useWorkspaceTabPersistence } from '@/features/workspace/hooks/use-workspace-tab-persistence'
import { useWorkspaceTabViewState } from '@/features/workspace/hooks/use-workspace-tab-view-state'
import {
  resolveWorkspaceTreeActiveFilePath,
  type WorkspaceTreeActiveFileMode,
} from '@/features/workspace/lib/workspace-tree-active-file'
import {
  createWorkspaceRefreshCoordinator,
  type WorkspaceRefreshRequest,
  type WorkspaceRefreshScheduleMode,
} from '@/features/workspace/lib/workspace-refresh-coordinator'
import { getOpenFileProfileDuration, recordOpenFileProfile } from '@/lib/open-file-profile'
import { CommandPalette } from '@/features/command-palette/components/command-palette/command-palette'
import { useSettingsStore, type AppLayoutPreference } from '@/hooks/use-settings-store'
import { useDevToolsFocusSettlement } from '@/hooks/use-devtools-focus-settlement'
import { HtmlPreview } from '@/features/editor/components/html-preview/html-preview'
import { AppShell } from '@/features/layout/components/app-shell/app-shell'
import {
  AppChromeSearchButton,
  AppChromeSidebarToggleButton,
  AppLayoutModeSwitch,
} from '@/features/layout/components/app-chrome-controls/app-chrome-controls'
import { useShellLayoutController } from '@/features/layout/hooks/use-shell-layout-controller'
import { useAppAppearanceController } from '@/features/appearance/hooks/use-app-appearance-controller'
import './App.css'

const CodeEditor = lazy(async () => {
  const startedAt = performance.now()
  recordOpenFileProfile('lazy:code-editor:start')
  const module = await import('@/features/editor/components/code-editor/code-editor')
  recordOpenFileProfile('lazy:code-editor:end', { durationMs: getOpenFileProfileDuration(startedAt) })
  return { default: module.CodeEditor }
})
const GitDiffEditor = lazy(async () => {
  const startedAt = performance.now()
  recordOpenFileProfile('lazy:git-diff-editor:start')
  const module = await import('@/features/editor/components/git-diff-editor/git-diff-editor')
  recordOpenFileProfile('lazy:git-diff-editor:end', { durationMs: getOpenFileProfileDuration(startedAt) })
  return { default: module.GitDiffEditor }
})
let meoEditorHostModulePromise: Promise<typeof import('@/features/editor/components/meo-editor-host/meo-editor-host')> | null = null

function loadMeoEditorHostModule(reason: 'lazy' | 'startup-preload') {
  if (!meoEditorHostModulePromise) {
    const startedAt = performance.now()
    recordOpenFileProfile('lazy:meo-editor-host:start', { reason })
    meoEditorHostModulePromise = import('@/features/editor/components/meo-editor-host/meo-editor-host')
      .then((module) => {
        recordOpenFileProfile('lazy:meo-editor-host:end', {
          durationMs: getOpenFileProfileDuration(startedAt),
          reason,
        })
        return module
      })
  } else {
    recordOpenFileProfile('lazy:meo-editor-host:reuse', { reason })
  }

  return meoEditorHostModulePromise
}

if (typeof window !== 'undefined') {
  window.setTimeout(() => {
    void loadMeoEditorHostModule('startup-preload')
  }, 0)
}

const MeoEditorHost = lazy(async () => {
  const startedAt = performance.now()
  const module = await loadMeoEditorHostModule('lazy')
  recordOpenFileProfile('lazy:meo-editor-host:lazy-resolved', { durationMs: getOpenFileProfileDuration(startedAt) })
  return { default: module.MeoEditorHost }
})

const WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS = 140

type WorkspaceTreeFileClickMode = 'open-tab' | 'replace-active-tab'

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

  const [confirmDialogOptions, setConfirmDialogOptions] = useState<{
    isOpen: boolean
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    isDanger?: boolean
    onConfirm: () => void
    onCancel: () => void
  } | null>(null)

  function requestConfirm(options: {
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    isDanger?: boolean
  }): Promise<boolean> {
    return new Promise((resolve) => {
      setConfirmDialogOptions({
        ...options,
        isOpen: true,
        onConfirm: () => {
          setConfirmDialogOptions((prev) => prev ? { ...prev, isOpen: false } : null)
          resolve(true)
        },
        onCancel: () => {
          setConfirmDialogOptions((prev) => prev ? { ...prev, isOpen: false } : null)
          resolve(false)
        }
      })
    })
  }

  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('appearance')
  const [agentWorkspaceState, setAgentWorkspaceState] = useState<AgentWorkspaceState | null>(null)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [activeAgentLayoutFixedTab, setActiveAgentLayoutFixedTab] = useState<AgentLayoutFixedTab>('file')
  const [isAgentLayoutFixedTabActive, setIsAgentLayoutFixedTabActive] = useState(false)
  const [isDirectorySidebarOpen, setIsDirectorySidebarOpen] = useState(true)
  const meoEditorHostRef = useRef<MeoEditorHostHandle | null>(null)
  const activeTabId = useWorkspaceStore((state) => state.activeTabId)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const moveTab = useWorkspaceStore((state) => state.moveTab)
  const openDiffTab = useWorkspaceStore((state) => state.openDiffTab)
  const openTabs = useWorkspaceStore((state) => state.openTabs)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const syncFileTabsWithDisk = useWorkspaceStore((state) => state.syncFileTabsWithDisk)
  const tree = useWorkspaceStore((state) => state.tree)
  const updateDiffTabDraft = useWorkspaceStore((state) => state.updateDiffTabDraft)
  const updateFileTabsContent = useWorkspaceStore((state) => state.updateFileTabsContent)
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
    shouldRenderWorkspaceEditor,
  } = useWorkspaceTabViewState({
    activeAgentLayoutFixedTab,
    activeTabId,
    isAgentLayout,
    isAgentLayoutFixedTabActive,
    openTabs,
  })
  const isActiveMeoEditorMountedRef = useRef(false)
  isActiveMeoEditorMountedRef.current = currentEditorKind === 'prose' && currentFileViewMode === 'meo'
  const [isActiveEditorComposing, setIsActiveEditorComposing] = useState(false)
  const windowCloseRequestInFlightRef = useRef(false)
  const currentPathRef = useRef<string | null>(currentPath)
  const performWorkspaceRefreshRef = useRef<(request: Required<WorkspaceRefreshRequest>) => Promise<void>>(async () => {})
  const workspaceRefreshCoordinatorRef = useRef<ReturnType<typeof createWorkspaceRefreshCoordinator> | null>(null)
  currentPathRef.current = currentPath
  const isActiveWorkspacePath = useCallback((rootPath: string) => {
    const activePath = currentPathRef.current
    return Boolean(
      activePath
      && normalizeFilePath(activePath) === normalizeFilePath(rootPath),
    )
  }, [])
  const loadTree = useCallback(async (
    rootPath: string,
    options: { onlyIfCurrent?: boolean } = {},
  ) => {
    const nextTree = await window.appApi.loadWorkspaceTree(rootPath)

    if (options.onlyIfCurrent && !isActiveWorkspacePath(rootPath)) {
      return
    }

    setTree(nextTree)
  }, [isActiveWorkspacePath, setTree])
  const reloadActiveWorkspaceTree = useCallback(async (rootPath: string) => {
    await loadTree(rootPath, { onlyIfCurrent: true })
  }, [loadTree])
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
  const isDirectorySidebarAvailable = Boolean(
    currentPath
    && isAgentLayout
    && shouldRenderWorkspaceEditor
    && (activeFileTab || activeDiffTab),
  )
  const isDirectorySidebarVisible = isDirectorySidebarAvailable && isDirectorySidebarOpen
  const isDirectoryToggleSlotVisible = isDirectorySidebarAvailable && !isDirectorySidebarVisible

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
    requestConfirmation: requestConfirm,
    setStatusMessage,
  })

  const syncOpenDiffTabs = useCallback(async (workspacePath: string) => {
    if (!isActiveWorkspacePath(workspacePath)) {
      return
    }

    const diffTabs = useWorkspaceStore.getState().openTabs.filter((tab): tab is WorkspaceDiffTab => tab.kind === 'diff')

    await Promise.all(diffTabs.map(async (tab) => {
      if (tab.diff.source.kind === 'commit') {
        return
      }

      try {
        const nextDiff = await window.appApi.getGitFileDiff(workspacePath, tab.diff.change.path, tab.diff.change.scope)

        if (!isActiveWorkspacePath(workspacePath)) {
          return
        }

        openDiffTab(createDiffTab(nextDiff), false)
      } catch {
        if (isActiveWorkspacePath(workspacePath) && !tab.isDirty) {
          closeTab(tab.id)
        }
      }
    }))
  }, [closeTab, isActiveWorkspacePath, openDiffTab])

  async function reconcileWorkspaceFileAfterGitDiscard(workspacePath: string, filePath: string) {
    if (!isActiveWorkspacePath(workspacePath)) {
      return
    }

    try {
      const nextContent = await window.appApi.readWorkspaceFile(filePath)

      if (!isActiveWorkspacePath(workspacePath)) {
        return
      }

      syncFileTabsWithDisk(filePath, nextContent)
    } catch {
      if (isActiveWorkspacePath(workspacePath)) {
        for (const tabId of getWorkspaceFileTabIdsForPath(
          useWorkspaceStore.getState().openTabs,
          filePath,
        )) {
          closeTab(tabId)
        }
      }
    }
  }

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
    requestConfirmation: requestConfirm,
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
    requestConfirmation: requestConfirm,
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
    requestConfirmation: requestConfirm,
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
    requestConfirmation: requestConfirm,
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
  const isAppModalLayerOpen = isSettingsOpen
    || isCommandPaletteOpen
    || isNewProjectDialogOpen
    || Boolean(confirmDialogOptions?.isOpen)
    || isGlobalProjectMenuOpen
  const isShortcutBlockingLayerOpen = isAppModalLayerOpen || isProjectMenuOpen

  async function handleRequestWindowClose() {
    if (windowCloseRequestInFlightRef.current) {
      return
    }

    windowCloseRequestInFlightRef.current = true

    try {
      if (!(await confirmDiscardDirtyTabs('close'))) {
        return
      }

      await window.appApi.closeWindow()
    } finally {
      windowCloseRequestInFlightRef.current = false
    }
  }

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

  function renderWorkspaceTreePanel(options: {
    activeFileMode?: WorkspaceTreeActiveFileMode
    directoryHeaderAction?: ReactNode
    fileClickMode?: WorkspaceTreeFileClickMode
    showDirectoryHeader?: boolean
    surfaceMode?: PanelSurfaceMode
    title?: string
  } = {}) {
    const {
      activeFileMode = 'track-active-file',
      directoryHeaderAction,
      fileClickMode = 'open-tab',
      showDirectoryHeader = false,
      surfaceMode = 'docked',
      title = '文件树',
    } = options
    const menuPortalTarget = surfaceMode === 'drawer' ? leftDrawerOverlayRoot : null
    const treeActiveFilePath = resolveWorkspaceTreeActiveFilePath(activeTreePath, activeFileMode)
    const handleSelectFile = (filePath: string, event: WorkspaceTreeActivationEvent) => {
      if (
        fileClickMode === 'replace-active-tab'
        && event.button === 0
        && !event.ctrlKey
        && !event.metaKey
      ) {
        void replaceActiveFileWithPath(filePath)
        return
      }

      void openFile(filePath)
    }

    return (
      <WorkspaceTreePanel
        activeFilePath={treeActiveFilePath}
        directoryHeaderAction={directoryHeaderAction}
        expandedPaths={expandedPaths}
        gitRepositoryState={gitRepositoryState}
        iconTheme={iconTheme}
        isCreatingDirectory={isCreatingDirectory}
        isCreatingFile={isCreatingFile}
        menuPortalTarget={menuPortalTarget}
        nodes={tree}
        setExpandedPaths={setExpandedPaths}
        showDirectoryHeader={showDirectoryHeader}
        title={title}
        workspacePath={currentPath}
        workspaceUnavailableMessage={workspaceUnavailableMessage}
        onCreateDirectory={() => void handleCreateDirectory()}
        onCreateFile={() => void handleCreateFile()}
        onDeleteNode={(node) => handleDeleteNode(node)}
        onMoveNode={(node, targetDirectoryPath) => handleMoveNode(node, targetDirectoryPath)}
        onOpenDiff={(change) => {
          void openGitDiff(change)
        }}
        onOpenInCodeEditor={(filePath) => {
          void openFile(filePath, currentPath, 'code')
        }}
        onRenameNode={(node, nextName) => handleRenameNode(node, nextName)}
        onSelectFile={handleSelectFile}
        onToggleFileTreeExpansion={handleToggleFileTreeExpansion}
      />
    )
  }

  function renderProjectMenu(surface: ProjectMenuSurface, frameRect: ProjectMenuFrameRect | null = null) {
    if (!projectMenuMode || projectMenuSurface !== surface) {
      return null
    }

    const portalContainer = surface === 'left-drawer'
      ? leftDrawerOverlayRoot
      : surface === 'right-drawer'
        ? rightDrawerOverlayRoot
        : null

    if (surface !== 'global' && (!frameRect || !portalContainer)) {
      return null
    }

    return (
      <ProjectMenu
        activeProjectId={activeWorkspaceContext.kind === 'project' ? activeWorkspaceContext.projectId : null}
        anchorRect={projectMenuAnchorRect}
        canUseNoProject={isAgentLayout && activeWorkspaceContext.kind === 'project'}
        frameRect={frameRect}
        isBusy={isProjectActionBusy}
        mode={projectMenuMode}
        portalContainer={portalContainer}
        projects={projectState.projects}
        surface={surface}
        onAddExistingProject={handleAddExistingProject}
        onClose={closeProjectMenu}
        onCreateProject={openNewProjectDialog}
        onSelectProject={handleSelectProject}
        onUseNoProject={handleUseNoProject}
      />
    )
  }

  function renderGitPanel(options: {
    surfaceMode?: PanelSurfaceMode
  } = {}) {
    const { surfaceMode = 'docked' } = options
    const menuPortalTarget = surfaceMode === 'drawer' ? leftDrawerOverlayRoot : null

    return (
      <div className='sidebar-stack-pane sidebar-git-pane' id='git-panel'>
        <GitPanel
          busyLabel={gitBusyLabel}
          commitMessage={gitCommitMessage}
          historyRefreshVersion={gitHistoryRefreshVersion}
          isLoading={isGitLoading}
          layout={gitPanelLayout}
          onCommit={handleCommitGitChanges}
          onCommitAndSync={handleCommitAndSyncGitChanges}
          onCommitMessageChange={setGitCommitMessage}
          onDiscardAll={handleDiscardAllGitChanges}
          onDiscardMany={handleDiscardGitChanges}
          onInitialize={handleInitializeGit}
          onLayoutChange={setGitPanelLayout}
          onOpenFile={(filePath) => {
            void openFile(filePath)
          }}
          onOpenDiff={(change) => {
            void openGitDiff(change)
          }}
          onOpenMeoDiff={(change) => {
            void openGitDiff(change, { mode: 'split', view: 'meo' })
          }}
          onOpenCommitFileDiff={(commitHash, change) => {
            void openGitCommitFileDiff(commitHash, change)
          }}
          onPull={handlePullGitChanges}
          onPush={handlePushGitChanges}
          onRefresh={refreshGitPanel}
          onRevertCommit={handleRevertGitCommit}
          onStage={handleStageGitPaths}
          onUnstage={handleUnstageGitPaths}
          repositoryState={gitRepositoryState}
          workspacePath={currentPath}
          iconTheme={iconTheme}
          menuPortalTarget={menuPortalTarget}
        />
      </div>
    )
  }

  function renderSidebarWorkspaceTabs(options: {
    surfaceMode: PanelSurfaceMode
    tabListAction?: ReactNode
    workspaceTreeOptions?: Parameters<typeof renderWorkspaceTreePanel>[0]
  }) {
    const {
      surfaceMode,
      tabListAction,
      workspaceTreeOptions,
    } = options

    return (
      <WorkspaceSidebarTabs
        activeTab={activeLeftSidebarTab}
        filePanel={renderWorkspaceTreePanel({
          ...workspaceTreeOptions,
          surfaceMode,
        })}
        gitPanel={renderGitPanel({ surfaceMode })}
        tabListAction={tabListAction}
        onActiveTabChange={setActiveLeftSidebarTab}
      />
    )
  }

  useEffect(() => {
    if (
      isAgentLayout
      || (
        displayActiveTabId !== FIXED_FILE_TAB_ID
        && displayActiveTabId !== FIXED_GIT_TAB_ID
      )
    ) {
      return
    }

    setIsAgentLayoutFixedTabActive(false)
    setActiveAgentLayoutFixedTab('file')
  }, [displayActiveTabId, isAgentLayout])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      await hydrateWorkspaceIconThemes(() => cancelled)

      const [
        nextProjectState,
        nextConversationState,
        nextActiveContext,
      ] = await Promise.all([
        window.appApi.getProjectState(),
        window.appApi.getConversationState(),
        window.appApi.getActiveWorkspaceContext(),
      ])

      if (cancelled) {
        return
      }

      hydrateProjectState(nextProjectState)
      hydrateConversationState(nextConversationState)
      setActiveWorkspaceContext(nextActiveContext)
      const activeProject = nextActiveContext.kind === 'project'
        ? nextProjectState.projects.find((project) => project.id === nextActiveContext.projectId) ?? null
        : nextProjectState.projects.find((project) => project.id === nextProjectState.lastProjectId) ?? null

      if (await restoreInitialConversationContext(
        nextActiveContext,
        nextConversationState,
        { isCancelled: () => cancelled },
      )) {
        return
      }

      if (nextActiveContext.kind === 'conversationDraft') {
        setStatusMessage('新对话')
        return
      }

      if (!activeProject) {
        setActiveWorkspaceContext(conversationDraftContext)
        setStatusMessage('新对话')
        return
      }

      try {
        await connectWorkspace(activeProject.path)
        if (!cancelled) {
          await restoreWorkspaceTabs(activeProject.path, activeProject.lastFilePath)
        }

        if (!cancelled) {
          setStatusMessage('已恢复上次项目')
        }
      } catch {
        if (!cancelled) {
          setStatusMessage('创建或打开项目以开始。')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

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

  useEffect(() => {
    const unsubscribe = window.appApi.onWindowCloseRequested(() => {
      void handleRequestWindowClose()
    })

    return unsubscribe
  }, [handleRequestWindowClose])

  useEffect(() => {
    return () => {
      void window.appApi.stopWorkspaceWatch()
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const isMac = platform === 'darwin'
      const modifier = isMac ? event.metaKey : event.ctrlKey

      if (!isShortcutBlockingLayerOpen && event.ctrlKey && event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        void handleStartContextualConversation()
        return
      }

      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsCommandPaletteOpen((prev) => !prev)
      }
    };

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeProject, isShortcutBlockingLayerOpen, platform])

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

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()

      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        void handleSaveActiveTab()
        return
      }

      if ((event.ctrlKey || event.metaKey) && key === 'w') {
        event.preventDefault()
        if (displayActiveTabId) {
          void closeEditorTab(displayActiveTabId)
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Tab') {
        event.preventDefault()
        cycleTabs(event.shiftKey ? -1 : 1)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'PageDown') {
        event.preventDefault()
        cycleTabs(1)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'PageUp') {
        event.preventDefault()
        cycleTabs(-1)
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [closeEditorTab, cycleTabs, displayActiveTabId, handleSaveActiveTab])

  const handleCloseCommandPalette = useCallback(() => setIsCommandPaletteOpen(false), [])
  const handleOpenCommandPaletteFromChrome = useCallback(() => {
    closeDrawers()
    setIsCommandPaletteOpen(true)
  }, [closeDrawers])
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
    const isDrawerSurface = surfaceMode === 'drawer'

    return (
      <WorkspaceSidebar
        chromeStyle={shellChromeVars}
        drawerHeaderActions={isDrawerSurface ? (
          <>
            <AppChromeSearchButton onClick={handleOpenCommandPaletteFromChrome} />
            <AppChromeSidebarToggleButton
              isDrawer={isLeftSidebarDrawer}
              isDrawerOpen={isLeftDrawerOpen}
              isSidebarVisible={isLeftSidebarVisible}
              onClick={toggleWorkspaceSidebar}
            />
          </>
        ) : undefined}
        hasWorkspace={Boolean(currentPath)}
        isPickingWorkspace={isPickingWorkspace}
        overlay={isDrawerSurface
          ? renderProjectMenu('left-drawer', leftDrawerOverlayRoot?.getBoundingClientRect() ?? null)
          : undefined}
        overlayRootRef={isDrawerSurface ? setLeftDrawerOverlayRoot : undefined}
        platform={shellPlatform}
        showWorkspaceSwitch={!isAgentLayout}
        surfaceMode={surfaceMode}
        surfaceRef={isDrawerSurface ? leftDrawerSurfaceRef : undefined}
        workspaceLabel={editorWorkspaceSwitchLabel}
        onOpenSettings={() => {
          setIsSettingsOpen(true)

          if (isDrawerSurface) {
            handleLeftDrawerOpenChange(false)
          }
        }}
        onOpenWorkspaceSwitch={(anchorRect) => {
          openProjectMenu(
            'editor-switch',
            anchorRect,
            { surface: isDrawerSurface ? 'left-drawer' : 'global' },
          )
        }}
      >
        {isAgentLayout ? (
          <AgentSessionTree
            isProjectAddMenuOpen={isProjectAddMenuOpenForSurface(isDrawerSurface ? 'left-drawer' : 'global')}
            menuPortalTarget={isDrawerSurface ? leftDrawerOverlayRoot : null}
            onOpenProjectAddMenu={isDrawerSurface
              ? (anchorRect) => openProjectMenu('agent-add', anchorRect, { surface: 'left-drawer' })
              : undefined}
            onRequestClose={isDrawerSurface ? () => handleLeftDrawerOpenChange(false) : undefined}
          />
        ) : renderSidebarWorkspaceTabs({ surfaceMode })}
      </WorkspaceSidebar>
    )
  }

  function renderAgentPanel() {
    return <AgentChatSurface />
  }

  function renderDirectorySidebarToggle() {
    if (!isDirectorySidebarAvailable) {
      return null
    }

    return (
      <WorkspaceEditorDirectoryToggle
        isVisible={isDirectorySidebarVisible}
        onToggle={() => setIsDirectorySidebarOpen((currentValue) => !currentValue)}
      />
    )
  }

  function renderDirectorySidebar(options: {
    activeFileMode?: WorkspaceTreeActiveFileMode
    action?: ReactNode
    fileClickMode: WorkspaceTreeFileClickMode
    showWorkspaceTabs?: boolean
  }) {
    const {
      activeFileMode,
      action,
      fileClickMode,
      showWorkspaceTabs = true,
    } = options

    return (
      <WorkspaceEditorDirectorySidebar>
        {showWorkspaceTabs
          ? renderSidebarWorkspaceTabs({
              surfaceMode: 'docked',
              tabListAction: action,
              workspaceTreeOptions: {
                activeFileMode,
                fileClickMode,
              },
            })
          : renderWorkspaceTreePanel({
              activeFileMode,
              directoryHeaderAction: action,
              fileClickMode,
              showDirectoryHeader: true,
              surfaceMode: 'docked',
              title: workspaceLabel,
            })}
      </WorkspaceEditorDirectorySidebar>
    )
  }

  function renderEditorEmptyState() {
    return (
      <WorkspaceEditorEmptyState
        hasWorkspace={Boolean(currentPath)}
        isPickingWorkspace={isPickingWorkspace}
        onOpenWorkspaceSwitch={(anchorRect) => {
          openProjectMenu('editor-switch', anchorRect)
        }}
      />
    )
  }

  function renderFixedFilePanel() {
    return (
      <WorkspaceFileSystemPanel
        fileSystemState={workspaceFileSystemState}
        gitRepositoryState={gitRepositoryState}
        iconTheme={iconTheme}
        meoSettings={meo}
        nodes={tree}
        theme={theme}
        title={workspaceLabel}
        workspacePath={currentPath}
        workspaceUnavailableMessage={workspaceUnavailableMessage}
        onOpenFile={(filePath) => {
          void openFile(filePath)
        }}
        onFileSystemNavigationChange={handleWorkspaceFileSystemNavigationChange}
        onFileSystemSelectionChange={handleWorkspaceFileSystemSelectionChange}
        onFileSystemViewChange={handleWorkspaceFileSystemViewChange}
      />
    )
  }

  function renderEditorSurface() {
    const directorySidebarToggle = renderDirectorySidebarToggle()
    const editorToolbarLeadingAction = isDirectoryToggleSlotVisible
      ? <WorkspaceEditorDirectoryToggleSpacer />
      : null
    const isCodeEditorView = Boolean(activeFileTab && (
      (currentEditorKind === 'code' && currentFileViewMode === 'code')
      || (currentEditorKind === 'prose' && currentFileViewMode === 'code')
    ))
    const isHtmlPreviewEditorView = Boolean(activeFileTab && currentEditorKind === 'code' && currentFileViewMode === 'preview')
    const isFileSurfaceView = Boolean(activeFileTab && currentEditorKind === 'file' && currentFileViewMode === 'file')

    return (
      <WorkspaceEditorSurface
        tabs={(
          <FileTabs
            activeTabId={displayActiveTabId}
            iconTheme={iconTheme}
            tabs={displayTabs}
            workspacePath={currentPath}
            onActivate={activateFileTab}
            onClose={(tabId) => {
              void closeEditorTab(tabId)
            }}
            onMoveTab={(movingId, targetId, position) => {
              moveTab(movingId, targetId, position)
            }}
            onOpenDiff={async (filePath) => {
              const latestGitState = await refreshGitState(currentPath, { silent: true })
              const nextChange = findGitChangeByFilePath(latestGitState, filePath)
              if (nextChange) {
                void openGitDiff(nextChange)
              }
            }}
            getHasDiff={(filePath) => Boolean(findGitChangeByFilePath(gitRepositoryState, filePath))}
          />
        )}
      >
        {activeFixedPanelTab?.fixedTabKind === 'file-panel' ? renderFixedFilePanel() : null}
        {activeFixedPanelTab?.fixedTabKind === 'git-panel' ? renderGitPanel() : null}
        {isDirectorySidebarVisible ? renderDirectorySidebar({
          action: directorySidebarToggle,
          fileClickMode: 'replace-active-tab',
        }) : null}
        {isDirectoryToggleSlotVisible ? (
          <WorkspaceEditorDirectoryToggleSlot>
            {directorySidebarToggle}
          </WorkspaceEditorDirectoryToggleSlot>
        ) : null}
        {!activeFixedPanelTab && !activeFileTab && !activeDiffTab ? renderEditorEmptyState() : null}

        {shouldRenderWorkspaceEditor && activeDiffTab ? (
          <Suspense fallback={<WorkspaceEditorLoadingState label='Loading diff editor...' />}>
            <GitDiffEditor
              key={activeDiffTab.id}
              diff={activeDiffTab.diff}
              draftContent={activeDiffDraftContent}
              navigationRequest={activeDiffTab.navigationRequest ?? null}
              hasDirtyRelatedFileTab={activeDiffHasDirtyRelatedFileTab}
              leadingToolbarAction={editorToolbarLeadingAction}
              theme={theme}
              onDiscardChange={(change) => {
                void handleDiscardGitChange(change)
              }}
              onDraftChange={(nextValue) => {
                updateDiffTabDraft(activeDiffTab.id, nextValue)
              }}
              onSaveEditedFile={handleSaveDiffFile}
              onStageChange={(change) => {
                void handleStageGitPaths([change.path])
              }}
              onUnstageChange={(change) => {
                void handleUnstageGitPaths([change.path])
              }}
            />
          </Suspense>
        ) : null}

        {shouldRenderWorkspaceEditor && activeFileTab && currentEditorKind === 'prose' && currentFileViewMode === 'meo' ? (
          <Suspense fallback={<WorkspaceEditorLoadingState />}>
            <MeoEditorHost
              key={activeFileTab.id}
              ref={meoEditorHostRef}
              filePath={activeFileTab.filePath}
              gitDiffRequest={activeFileTab.gitDiffRequest ?? null}
              hasLeadingToolbarInset={isDirectoryToggleSlotVisible}
              onChange={(nextValue) => {
                updateFileTabsContent(activeFileTab.filePath, nextValue)
              }}
              onCompositionChange={setIsActiveEditorComposing}
              onOpenFile={(targetFilePath) => {
                void openFile(targetFilePath, currentPath, 'meo')
              }}
              onOpenGitDiff={(targetFilePath, gitAction) => {
                void (async () => {
                  if (!currentPath) {
                    return
                  }

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
              }}
              onApplyGitDiffSelection={handleApplyGitDiffSelection}
              onSave={(content) => {
                void handleSave({
                  content,
                  filePath: activeFileTab.filePath,
                })
              }}
              value={currentFileContent}
              savedValue={activeFileTab.savedContent}
              theme={theme}
              gitRepositoryState={gitRepositoryState}
              meoSettings={meo}
              workspacePath={currentPath}
            />
          </Suspense>
        ) : null}

        {shouldRenderWorkspaceEditor && activeFileTab && isCodeEditorView ? (
          <WorkspaceEditorView leadingToolbarAction={editorToolbarLeadingAction}>
            <Suspense fallback={<WorkspaceEditorLoadingState />}>
              <CodeEditor
                key={activeFileTab.id}
                disabled={false}
                filePath={activeFileTab.filePath}
                onChange={(nextValue) => {
                  updateFileTabsContent(activeFileTab.filePath, nextValue)
                }}
                onCompositionChange={setIsActiveEditorComposing}
                onSave={(content) => {
                  void handleSave({
                    content,
                    filePath: activeFileTab.filePath,
                  })
                }}
                value={currentFileContent}
                theme={theme}
              />
            </Suspense>
          </WorkspaceEditorView>
        ) : null}

        {shouldRenderWorkspaceEditor && activeFileTab && isHtmlPreviewEditorView ? (
          <WorkspaceEditorView leadingToolbarAction={editorToolbarLeadingAction}>
            <HtmlPreview
              content={currentFileContent}
              filePath={activeFileTab.filePath}
            />
          </WorkspaceEditorView>
        ) : null}

        {shouldRenderWorkspaceEditor && activeFileTab && isFileSurfaceView ? (
          <WorkspaceEditorView>
            <Suspense fallback={<WorkspaceEditorLoadingState label='正在加载文件...' />}>
              <WorkspaceFilePreview
                key={activeFileTab.id}
                filePath={activeFileTab.filePath}
                gitRepositoryState={gitRepositoryState}
                iconTheme={iconTheme}
                leadingToolbarActions={editorToolbarLeadingAction}
                meoSettings={meo}
                theme={theme}
                workspacePath={currentPath}
              />
            </Suspense>
          </WorkspaceEditorView>
        ) : null}
      </WorkspaceEditorSurface>
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

    return isAgentLayout ? renderAgentPanel() : renderEditorSurface()
  }

  function renderRightPanel(surfaceMode: PanelSurfaceMode) {
    if (surfaceMode === 'docked' && needsProjectBootstrap) {
      return null
    }

    return isAgentLayout ? renderEditorSurface() : renderAgentPanel()
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
      leftChromeSearchAction={<AppChromeSearchButton onClick={handleOpenCommandPaletteFromChrome} />}
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
      renderRightDrawerOverlay={(frameRect) => renderProjectMenu('right-drawer', frameRect)}
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

      {renderProjectMenu('global')}
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

      <AlertDialog.Backdrop
        isOpen={confirmDialogOptions?.isOpen ?? false}
        onOpenChange={(isOpen) => {
          if (!isOpen && confirmDialogOptions) {
            confirmDialogOptions.onCancel()
          }
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.CloseTrigger />
            <AlertDialog.Header>
              <AlertDialog.Icon status={confirmDialogOptions?.isDanger ? "danger" : "warning"} />
              <AlertDialog.Heading>{confirmDialogOptions?.title}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p className="text-[var(--foreground-primary)] whitespace-pre-wrap">{confirmDialogOptions?.message}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button variant="tertiary" onPress={() => confirmDialogOptions?.onCancel()}>
                {confirmDialogOptions?.cancelLabel ?? '取消'}
              </Button>
              <Button variant={confirmDialogOptions?.isDanger ? "danger" : "primary"} onPress={() => confirmDialogOptions?.onConfirm()}>
                {confirmDialogOptions?.confirmLabel ?? '确认'}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>

      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        onClose={handleCloseCommandPalette}
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

        setSettingsSection('providers')
        setIsSettingsOpen(true)
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

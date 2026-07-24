import { describe, expect, it, vi } from 'vitest'
import { createWorkspaceEditorConfiguration } from '../src/features/workspace/components/workspace-workbench/workspace-editor-configuration'
import { createWorkspaceNavigationConfiguration } from '../src/features/workspace/components/workspace-workbench/workspace-navigation-configuration'

describe('workspace navigation configuration', () => {
  it('maps controller actions without losing specialized editor modes', () => {
    const openFile = vi.fn()
    const openGitDiff = vi.fn()
    const replaceActiveFileWithPath = vi.fn()
    const setActiveTab = vi.fn()
    const createDirectory = vi.fn()
    const configuration = createWorkspaceNavigationConfiguration({
      activeTab: 'file',
      activeTreePath: 'C:\\workspace\\notes.md',
      currentPath: 'C:\\workspace',
      fileOperations: {
        createDirectory,
        createFile: vi.fn(),
        deleteNode: vi.fn(),
        expandedPaths: new Set<string>(),
        isCreatingDirectory: false,
        isCreatingFile: false,
        moveNode: vi.fn(),
        renameNode: vi.fn(),
        setExpandedPaths: vi.fn(),
        toggleTreeExpansion: vi.fn(),
      },
      git: {
        busyLabel: null,
        commit: vi.fn(),
        commitAndSync: vi.fn(),
        commitMessage: '',
        discardAll: vi.fn(),
        discardChanges: vi.fn(),
        historyRefreshVersion: 0,
        initializeRepository: vi.fn(),
        isLoading: false,
        panelLayout: 'compact',
        pull: vi.fn(),
        push: vi.fn(),
        refreshPanel: vi.fn(),
        repositoryState: null,
        revertCommit: vi.fn(),
        setCommitMessage: vi.fn(),
        setPanelLayout: vi.fn(),
        stagePaths: vi.fn(),
        unstagePaths: vi.fn(),
      },
      iconTheme: null,
      navigation: {
        openFile,
        openGitCommitFileDiff: vi.fn(),
        openGitDiff,
        replaceActiveFileWithPath,
      },
      setActiveTab,
      tree: [],
      workspaceLabel: 'workspace',
      workspaceUnavailableMessage: null,
    })
    const change = { path: 'notes.md' } as Parameters<
      typeof configuration.gitPanel.onOpenDiff
    >[0]

    configuration.gitPanel.onOpenMeoDiff(change)
    configuration.treePanel.onOpenInCodeEditor('C:\\workspace\\code.ts')
    configuration.onReplaceActiveFile('C:\\workspace\\next.md')
    configuration.onActiveTabChange('git')
    configuration.treePanel.onCreateDirectory()

    expect(openGitDiff).toHaveBeenCalledWith(change, {
      mode: 'split',
      view: 'meo',
    })
    expect(openFile).toHaveBeenCalledWith(
      'C:\\workspace\\code.ts',
      'C:\\workspace',
      'code',
    )
    expect(replaceActiveFileWithPath).toHaveBeenCalledWith(
      'C:\\workspace\\next.md',
    )
    expect(setActiveTab).toHaveBeenCalledWith('git')
    expect(createDirectory).toHaveBeenCalledOnce()
  })
})

describe('workspace editor configuration', () => {
  it('preserves save, close, MEO open, and workspace-switch callbacks', () => {
    type EditorConfigurationOptions = Parameters<
      typeof createWorkspaceEditorConfiguration
    >[0]

    const activateFileTab = vi.fn()
    const closeEditorTab = vi.fn()
    const moveTab = vi.fn()
    const openFile = vi.fn()
    const openGitDiff = vi.fn()
    const onOpenWorkspaceSwitch = vi.fn()
    const saveWorkspaceFile = vi.fn()
    const navigationConfiguration = {
      marker: 'navigation',
    } as unknown as EditorConfigurationOptions['navigationConfiguration']
    const options = {
      currentPath: 'C:\\workspace',
      editorHostRef: { current: null },
      editorSurface: {
        activeDiffDraftContent: null,
        activeDiffHasDirtyRelatedFileTab: false,
        activeDiffTab: null,
        activeFileTab: null,
        activeFixedPanelTab: null,
        displayActiveTabId: null,
        displayTabs: [],
        isDirectorySidebarAvailable: true,
        isDirectorySidebarVisible: false,
        isDirectoryToggleSlotVisible: true,
        shouldRenderWorkspaceEditor: true,
        toggleDirectorySidebar: vi.fn(),
      },
      fileSystem: {
        handleWorkspaceFileSystemNavigationChange: vi.fn(),
        handleWorkspaceFileSystemSelectionChange: vi.fn(),
        handleWorkspaceFileSystemViewChange: vi.fn(),
        workspaceFileSystemState: {
          navigation: null,
          selectedPath: null,
          view: 'list',
        },
      },
      git: {
        applyDiffSelection: vi.fn(),
        discardChange: vi.fn(),
        refreshGitState: vi.fn().mockResolvedValue(null),
        repositoryState: null,
        stagePaths: vi.fn(),
        unstagePaths: vi.fn(),
      },
      iconTheme: null,
      isPickingWorkspace: false,
      meoSettings: {
        focusedLineHighlight: false,
        gitDiffLineHighlights: true,
        imageFolder: 'assets',
        outlinePosition: 'right',
      },
      moveTab,
      navigation: {
        activateFileTab,
        openFile,
        openGitDiff,
      },
      navigationConfiguration,
      onActiveEditorCompositionChange: vi.fn(),
      onOpenMeoEditorGitDiff: vi.fn(),
      onOpenWorkspaceSwitch,
      persistence: {
        closeEditorTab,
        saveDiffFile: vi.fn(),
        saveWorkspaceFile,
      },
      theme: 'light',
      tree: [],
      workspaceLabel: 'workspace',
      workspaceUnavailableMessage: null,
    } satisfies EditorConfigurationOptions
    const configuration = createWorkspaceEditorConfiguration(options)

    configuration.editorContent.fileActions.openFile('C:\\workspace\\next.md')
    configuration.editorContent.fileActions.saveFile(
      'C:\\workspace\\notes.md',
      'updated',
    )
    configuration.fileTabs.onActivate('tab-1')
    configuration.fileTabs.onClose?.('tab-1')
    configuration.fileTabs.onMoveTab?.('tab-1', 'tab-2', 'after')
    configuration.emptyState.onOpenWorkspaceSwitch()

    expect(openFile).toHaveBeenCalledWith(
      'C:\\workspace\\next.md',
      'C:\\workspace',
      'meo',
    )
    expect(saveWorkspaceFile).toHaveBeenCalledWith({
      content: 'updated',
      filePath: 'C:\\workspace\\notes.md',
    })
    expect(activateFileTab).toHaveBeenCalledWith('tab-1')
    expect(closeEditorTab).toHaveBeenCalledWith('tab-1')
    expect(moveTab).toHaveBeenCalledWith('tab-1', 'tab-2', 'after')
    expect(onOpenWorkspaceSwitch).toHaveBeenCalledOnce()
    expect(configuration.navigation).toBe(navigationConfiguration)
  })
})

import type { CSSProperties } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, ScrollShadow, Toast, toast } from '@heroui/react'
import {
  AddLine,
  FileFill,
  FolderOpenFill,
  GitCompareLine,
  LayoutLeftbarCloseLine,
  LayoutRightbarCloseLine,
  SelectorVerticalLine,
} from '@mingcute/react'
import { AppTitlebar } from '@/components/app-titlebar'
import { AgentSidebar } from '@/features/agent/components/agent-sidebar'
import type { AgentWorkspaceState } from '@/features/agent/types'
import { GitDiffEditor } from '@/features/editor/components/git-diff-editor'
import { CodeEditor } from '@/features/editor/components/code-editor'
import { WritingEditor } from '@/features/editor/components/writing-editor'
import { GitPanel } from '@/features/git/components/git-panel'
import type { GitChangeItem, GitChangeScope, GitRepositoryState } from '@/features/git/types'
import {
  SettingsDialog,
  type SettingsSectionId,
} from '@/features/settings/components/settings-dialog'
import { FileTabs } from '@/features/workspace/components/file-tabs'
import { WorkspaceTree } from '@/features/workspace/components/workspace-tree'
import { getSupportedWorkspaceEditorKind } from '@/features/workspace/lib/file-types'
import {
  useWorkspaceStore,
  type WorkspaceDiffTab,
  type WorkspaceDisplayTab,
  type WorkspaceFileTab,
} from '@/features/workspace/store/use-workspace-store'
import type {
  WorkspaceIconTheme,
  WorkspaceIconThemeCatalogOption,
} from '@/features/workspace/types'
import './App.css'

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function getRelativePath(rootPath: string, filePath: string) {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '')
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/')
  const normalizedRootPath = normalizedRoot.replace(/[\\/]+/g, '/')

  if (!normalizedFilePath.startsWith(normalizedRootPath)) {
    return getBaseName(filePath)
  }

  return normalizedFilePath.slice(normalizedRootPath.length).replace(/^\/+/, '')
}

function getDirectoryRelativePath(rootPath: string, filePath: string) {
  const relativePath = getRelativePath(rootPath, filePath)
  const segments = relativePath.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

function getNextUntitledFileName(existingNames: string[]) {
  const occupiedNames = new Set(existingNames.map((name) => name.toLowerCase()))

  if (!occupiedNames.has('untitled.md')) {
    return 'untitled.md'
  }

  let index = 2
  while (occupiedNames.has(`untitled-${index}.md`)) {
    index += 1
  }

  return `untitled-${index}.md`
}

function isWorkspaceFileTab(tab: WorkspaceDisplayTab | null | undefined): tab is WorkspaceFileTab {
  return tab?.kind === 'file'
}

function isWorkspaceDiffTab(tab: WorkspaceDisplayTab | null | undefined): tab is WorkspaceDiffTab {
  return tab?.kind === 'diff'
}

function createDiffTabId(filePath: string, scope: GitChangeScope) {
  return `git-diff://${scope}/${encodeURIComponent(filePath)}`
}

function normalizeFilePath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').toLowerCase()
}

type StoredTabState = {
  activePath: string | null
  paths: string[]
}

const DESKTOP_AGENT_BREAKPOINT = 1160
const MOBILE_STACK_BREAKPOINT = 860
const RESIZE_HANDLE_WIDTH = 12
const MIN_EDITOR_WIDTH = 480
const LEFT_SIDEBAR_MIN_WIDTH = 240
const LEFT_SIDEBAR_MAX_WIDTH = 520
const RIGHT_SIDEBAR_MIN_WIDTH = 300
const RIGHT_SIDEBAR_MAX_WIDTH = 560
const DEFAULT_LEFT_SIDEBAR_WIDTH = 320
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 368
const DEFAULT_GIT_PANEL_HEIGHT = 292
const MIN_GIT_PANEL_HEIGHT = 200
const TAB_STORAGE_PREFIX = 'writing-workspace:file-tabs:'
const LEGACY_TAB_STORAGE_PREFIX = 'writing-workspace:editor-tabs:'
const SETTINGS_TAB_PATH = 'app://settings'

type ResizePanel = 'left' | 'right'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getTabStorageKey(workspacePath: string) {
  return `${TAB_STORAGE_PREFIX}${encodeURIComponent(workspacePath)}`
}

function getLegacyTabStorageKey(workspacePath: string) {
  return `${LEGACY_TAB_STORAGE_PREFIX}${encodeURIComponent(workspacePath)}`
}

function readStoredTabState(workspacePath: string): StoredTabState {
  try {
    const rawValue = window.localStorage.getItem(getTabStorageKey(workspacePath))
      ?? window.localStorage.getItem(getLegacyTabStorageKey(workspacePath))
    if (!rawValue) {
      return {
        activePath: null,
        paths: [],
      }
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredTabState>
    const paths = Array.isArray(parsedValue.paths)
      ? parsedValue.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      : []

    return {
      activePath: typeof parsedValue.activePath === 'string' && parsedValue.activePath.trim().length > 0
        ? parsedValue.activePath
        : null,
      paths,
    }
  } catch {
    return {
      activePath: null,
      paths: [],
    }
  }
}

function dedupePaths(paths: string[]) {
  return [...new Set(paths)]
}

function toStoredWorkspaceTab(filePath: string, content: string): WorkspaceFileTab {
  const editorKind = getSupportedWorkspaceEditorKind(filePath)

  if (!editorKind) {
    throw new Error('Unsupported file type')
  }

  return {
    content,
    editorKind,
    exists: true,
    filePath,
    isDirty: false,
    kind: 'file',
    savedContent: content,
  }
}

function createDiffTab(change: GitChangeItem, scope: GitChangeScope, diff: Awaited<ReturnType<typeof window.appApi.getGitFileDiff>>): WorkspaceDiffTab {
  return {
    diff,
    exists: true,
    filePath: createDiffTabId(change.path, scope),
    isDirty: false,
    kind: 'diff',
    title: getBaseName(change.path),
  }
}

function App() {
  const platform = window.appApi.platform
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [isImportingIconTheme, setIsImportingIconTheme] = useState(false)
  const [isApplyingIconTheme, setIsApplyingIconTheme] = useState(false)
  const [isSettingsTabOpen, setIsSettingsTabOpen] = useState(false)
  const [isSettingsTabActive, setIsSettingsTabActive] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('providers')
  const [agentWorkspaceState, setAgentWorkspaceState] = useState<AgentWorkspaceState | null>(null)
  const [iconTheme, setIconTheme] = useState<WorkspaceIconTheme | null>(null)
  const [iconThemeOptions, setIconThemeOptions] = useState<WorkspaceIconThemeCatalogOption[]>([])
  const [, setStatusMessage] = useState('Open a folder to start.')
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
  const [rightSidebarWidth, setRightSidebarWidth] = useState(DEFAULT_RIGHT_SIDEBAR_WIDTH)
  const [gitPanelHeight, setGitPanelHeight] = useState(DEFAULT_GIT_PANEL_HEIGHT)
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(false)
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(false)
  const [activeResizePanel, setActiveResizePanel] = useState<ResizePanel | null>(null)
  const [isGitPanelResizing, setIsGitPanelResizing] = useState(false)
  const [gitRepositoryState, setGitRepositoryState] = useState<GitRepositoryState | null>(null)
  const [isGitLoading, setIsGitLoading] = useState(false)
  const [gitBusyLabel, setGitBusyLabel] = useState<string | null>(null)
  const [gitErrorMessage, setGitErrorMessage] = useState<string | null>(null)
  const [gitCommitMessage, setGitCommitMessage] = useState('')
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const leftSidebarBodyRef = useRef<HTMLDivElement | null>(null)
  const activeTabPath = useWorkspaceStore((state) => state.activeTabPath)
  const activateTab = useWorkspaceStore((state) => state.activateTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const markTabMissing = useWorkspaceStore((state) => state.markTabMissing)
  const markTabSaved = useWorkspaceStore((state) => state.markTabSaved)
  const openDiffTab = useWorkspaceStore((state) => state.openDiffTab)
  const openTab = useWorkspaceStore((state) => state.openTab)
  const openTabs = useWorkspaceStore((state) => state.openTabs)
  const renameTab = useWorkspaceStore((state) => state.renameTab)
  const replaceTabs = useWorkspaceStore((state) => state.replaceTabs)
  const resetOpenTabs = useWorkspaceStore((state) => state.resetOpenTabs)
  const setCurrentPath = useWorkspaceStore((state) => state.setCurrentPath)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const syncTabWithDisk = useWorkspaceStore((state) => state.syncTabWithDisk)
  const tree = useWorkspaceStore((state) => state.tree)
  const updateTabContent = useWorkspaceStore((state) => state.updateTabContent)
  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.filePath === activeTabPath) ?? null,
    [activeTabPath, openTabs],
  )
  const activeFileTab = isWorkspaceFileTab(activeTab) ? activeTab : null
  const activeDiffTab = isWorkspaceDiffTab(activeTab) ? activeTab : null
  const displayTabs = useMemo<WorkspaceDisplayTab[]>(
    () => {
      if (!isSettingsTabOpen) {
        return openTabs
      }

      return [
        ...openTabs,
        {
          content: '',
          editorKind: 'rich-text',
          exists: true,
          filePath: SETTINGS_TAB_PATH,
          isDirty: false,
          kind: 'settings',
          savedContent: '',
        },
      ]
    },
    [isSettingsTabOpen, openTabs],
  )
  const displayActiveTabPath = isSettingsTabActive ? SETTINGS_TAB_PATH : activeTabPath
  const currentFileContent = activeFileTab?.content ?? ''
  const currentEditorKind = activeFileTab?.editorKind ?? null
  const currentFilePath = activeFileTab?.filePath ?? null
  const dirtyTabs = useMemo(
    () => openTabs.filter((tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.isDirty),
    [openTabs],
  )
  const rootFileNames = useMemo(
    () => tree.filter((node) => node.kind === 'file').map((node) => node.name),
    [tree],
  )
  const workspaceLabel = currentPath
    ? getBaseName(currentPath)
    : 'Current workspace'
  const shellPlatform = platform === 'darwin' ? 'macos' : 'windows'
  const isMobileStacked = typeof window !== 'undefined' && window.innerWidth <= MOBILE_STACK_BREAKPOINT
  const isAgentPanelVisible = typeof window !== 'undefined' && window.innerWidth > DESKTOP_AGENT_BREAKPOINT
  const isLeftSidebarVisible = !isLeftSidebarCollapsed
  const isRightSidebarVisible = isAgentPanelVisible && !isRightSidebarCollapsed
  const effectiveLeftSidebarWidth = isLeftSidebarVisible ? leftSidebarWidth : 0
  const effectiveRightSidebarWidth = isRightSidebarVisible ? rightSidebarWidth : 0
  const activeTreePath = activeFileTab?.filePath ?? activeDiffTab?.diff.change.path ?? null
  const currentGitChange = useMemo(() => {
    if (!currentFilePath || !gitRepositoryState?.isRepository) {
      return null
    }

    const targetPath = normalizeFilePath(currentFilePath)
    return gitRepositoryState.unstagedChanges.find((change) => normalizeFilePath(change.path) === targetPath)
      ?? gitRepositoryState.stagedChanges.find((change) => normalizeFilePath(change.path) === targetPath)
      ?? null
  }, [currentFilePath, gitRepositoryState])

  function getPersistedActiveFilePath() {
    const activeTabId = useWorkspaceStore.getState().activeTabPath
    const tab = useWorkspaceStore.getState().openTabs.find((candidate) => candidate.filePath === activeTabId)
    return tab?.kind === 'file' ? tab.filePath : null
  }

  function getShellWidth() {
    return appShellRef.current?.clientWidth ?? window.innerWidth
  }

  function getGitPanelMaxHeight() {
    const containerHeight = leftSidebarBodyRef.current?.clientHeight ?? 0
    return clamp(containerHeight - 180, MIN_GIT_PANEL_HEIGHT, 520)
  }

  function clampGitHeight(nextHeight: number) {
    return clamp(nextHeight, MIN_GIT_PANEL_HEIGHT, getGitPanelMaxHeight())
  }

  function clampLeftWidth(nextWidth: number, shellWidth: number, currentRightWidth: number) {
    const reservedWidth = MIN_EDITOR_WIDTH + RESIZE_HANDLE_WIDTH + (currentRightWidth > 0 ? currentRightWidth + RESIZE_HANDLE_WIDTH : 0)
    const maxWidth = Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, shellWidth - reservedWidth))

    return clamp(nextWidth, LEFT_SIDEBAR_MIN_WIDTH, maxWidth)
  }

  function clampRightWidth(nextWidth: number, shellWidth: number, currentLeftWidth: number) {
    const reservedWidth = MIN_EDITOR_WIDTH + currentLeftWidth + RESIZE_HANDLE_WIDTH * 2
    const maxWidth = Math.min(RIGHT_SIDEBAR_MAX_WIDTH, Math.max(RIGHT_SIDEBAR_MIN_WIDTH, shellWidth - reservedWidth))

    return clamp(nextWidth, RIGHT_SIDEBAR_MIN_WIDTH, maxWidth)
  }

  function resizeSidebar(panel: ResizePanel, pointerClientX: number) {
    if (isMobileStacked) {
      return
    }

    const shell = appShellRef.current

    if (!shell) {
      return
    }

    const shellRect = shell.getBoundingClientRect()
    const shellWidth = shellRect.width

    if (panel === 'left') {
      const nextWidth = pointerClientX - shellRect.left
      setLeftSidebarWidth(clampLeftWidth(nextWidth, shellWidth, effectiveRightSidebarWidth))
      return
    }

    if (!isAgentPanelVisible) {
      return
    }

    const nextWidth = shellRect.right - pointerClientX
    setRightSidebarWidth(clampRightWidth(nextWidth, shellWidth, effectiveLeftSidebarWidth))
  }

  function handleResizeStart(panel: ResizePanel) {
    if (
      isMobileStacked
      || (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
      return
    }

    setActiveResizePanel(panel)
  }

  function handleGitPanelResize(pointerClientY: number) {
    const container = leftSidebarBodyRef.current

    if (!container) {
      return
    }

    const rect = container.getBoundingClientRect()
    const nextHeight = rect.bottom - pointerClientY
    setGitPanelHeight(clampGitHeight(nextHeight))
  }

  async function getWorkspaceState(workspacePath: string) {
    return window.appApi.getWorkspaceState(workspacePath)
  }

  async function updateWorkspaceState(
    workspacePath: string,
    patch: { lastFilePath?: string | null, lastAgentSessionPath?: string | null, markAsLastOpened?: boolean },
  ) {
    await window.appApi.updateWorkspaceState(workspacePath, patch)
  }

  async function syncPersistedActiveFile(workspacePath: string) {
    await updateWorkspaceState(workspacePath, {
      lastFilePath: getPersistedActiveFilePath(),
    })
  }

  async function syncOpenDiffTabs(workspacePath: string) {
    const diffTabs = useWorkspaceStore.getState().openTabs.filter((tab): tab is WorkspaceDiffTab => tab.kind === 'diff')

    await Promise.all(diffTabs.map(async (tab) => {
      try {
        const nextDiff = await window.appApi.getGitFileDiff(workspacePath, tab.diff.change.path, tab.diff.change.scope)
        openDiffTab(createDiffTab(nextDiff.change, nextDiff.change.scope, nextDiff), false)
      } catch {
        closeTab(tab.filePath)
      }
    }))
  }

  async function refreshGitState(workspacePath: string | null, options: { silent?: boolean } = {}) {
    if (!workspacePath) {
      setGitRepositoryState(null)
      return null
    }

    if (!options.silent) {
      setIsGitLoading(true)
    }

    try {
      const nextState = await window.appApi.getGitRepositoryState(workspacePath)
      setGitRepositoryState(nextState)
      setGitErrorMessage(null)
      await syncOpenDiffTabs(workspacePath)
      return nextState
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load Git status.'
      setGitErrorMessage(message)
      return null
    } finally {
      if (!options.silent) {
        setIsGitLoading(false)
      }
    }
  }

  async function runGitAction<T>(label: string, action: () => Promise<T>) {
    setGitBusyLabel(label)
    setGitErrorMessage(null)

    try {
      return await action()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Git action failed.'
      setGitErrorMessage(message)
      toast.danger('Git action failed', {
        description: message,
      })
      throw error
    } finally {
      setGitBusyLabel(null)
    }
  }

  function confirmDiscardDirtyTabs(reason: 'close' | 'switch-workspace') {
    if (dirtyTabs.length === 0) {
      return true
    }

    const dirtyNames = dirtyTabs
      .slice(0, 4)
      .map((tab) => getBaseName(tab.filePath))
      .join(', ')
    const remainingCount = dirtyTabs.length - Math.min(dirtyTabs.length, 4)
    const extraLabel = remainingCount > 0 ? ` and ${remainingCount} more` : ''
    const actionLabel = reason === 'close'
      ? 'Closing them now will discard the unsaved changes.'
      : 'Switching workspaces now will discard the unsaved changes.'

    return window.confirm(
      `${dirtyTabs.length} tab${dirtyTabs.length > 1 ? 's have' : ' has'} unsaved changes: ${dirtyNames}${extraLabel}.\n\n${actionLabel}`,
    )
  }

  function closeEditorTab(filePath: string, options: { force?: boolean, silent?: boolean } = {}) {
    if (filePath === SETTINGS_TAB_PATH) {
      setIsSettingsTabOpen(false)
      setIsSettingsTabActive(false)

      if (!options.silent) {
        setStatusMessage('Settings closed')
      }

      return true
    }

    const targetTab = openTabs.find((tab) => tab.filePath === filePath)

    if (!targetTab) {
      return false
    }

    if (targetTab.kind === 'file' && targetTab.isDirty && !options.force) {
      const confirmed = window.confirm(
        `"${getBaseName(targetTab.filePath)}" has unsaved changes.\n\nClose this tab and discard them?`,
      )

      if (!confirmed) {
        return false
      }
    }

    closeTab(filePath)

    if (currentPath) {
      void syncPersistedActiveFile(currentPath)
    }

    if (!options.silent) {
      setStatusMessage(`${getBaseName(targetTab.kind === 'diff' ? targetTab.diff.change.path : targetTab.filePath)} closed`)
    }

    return true
  }

  async function connectWorkspace(nextPath: string) {
    await window.appApi.stopWorkspaceWatch()
    await loadTree(nextPath)
    setCurrentPath(nextPath)
    resetOpenTabs()
    setIsSettingsTabOpen(false)
    setIsSettingsTabActive(false)
    setGitCommitMessage('')
    setGitErrorMessage(null)
    await refreshGitState(nextPath, { silent: true })
    await window.appApi.startWorkspaceWatch(nextPath)
    await updateWorkspaceState(nextPath, { markAsLastOpened: true })
  }

  async function loadTree(rootPath: string) {
    const nextTree = await window.appApi.loadWorkspaceTree(rootPath)
    setTree(nextTree)
  }

  async function openFile(filePath: string, workspacePath: string | null = currentPath) {
    setIsSettingsTabActive(false)
    const existingTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.kind === 'file' && tab.filePath === filePath)

    if (existingTab) {
      activateTab(filePath)

      if (workspacePath) {
        await updateWorkspaceState(workspacePath, { lastFilePath: filePath })
      }

      setStatusMessage(`${getBaseName(filePath)} focused`)
      return
    }

    const editorKind = getSupportedWorkspaceEditorKind(filePath)

    if (!editorKind) {
      toast.warning(`Cannot open ${getBaseName(filePath)} yet`, {
        description: 'Only Markdown/text files and supported code files can open in tabs right now.',
      })
      setStatusMessage(`${getBaseName(filePath)} is not supported yet`)
      return
    }

    try {
      const fileContent = await window.appApi.readWorkspaceFile(filePath)
      openTab({ filePath, content: fileContent, editorKind })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open file.'
      toast.danger(`Failed to open ${getBaseName(filePath)}`, {
        description: message,
      })
      setStatusMessage(message)
      return
    }

    if (workspacePath) {
      await updateWorkspaceState(workspacePath, { lastFilePath: filePath })
    }

    setStatusMessage(`${getBaseName(filePath)} opened`)
  }

  async function openGitDiff(change: GitChangeItem) {
    if (!currentPath) {
      return
    }

    try {
      const diff = await window.appApi.getGitFileDiff(currentPath, change.path, change.scope)
      openDiffTab(createDiffTab(change, change.scope, diff))
      setIsSettingsTabActive(false)
      setStatusMessage(`${getBaseName(change.path)} diff opened`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the diff view.'
      toast.danger('Failed to open diff', {
        description: message,
      })
      setStatusMessage(message)
    }
  }

  async function restoreWorkspaceTabs(workspacePath: string, fallbackFilePath?: string | null) {
    const workspaceState = await getWorkspaceState(workspacePath)
    const storedState = readStoredTabState(workspacePath)
    const fallbackPath = fallbackFilePath ?? workspaceState.lastFilePath
    const candidatePaths = dedupePaths([
      ...storedState.paths,
      ...(fallbackPath ? [fallbackPath] : []),
    ])

    if (candidatePaths.length === 0) {
      replaceTabs([], null)
      setIsSettingsTabActive(false)
      return
    }

    const settledTabs = await Promise.all(candidatePaths.map(async (filePath) => {
      if (!getSupportedWorkspaceEditorKind(filePath)) {
        return null
      }

      try {
        const content = await window.appApi.readWorkspaceFile(filePath)
        return toStoredWorkspaceTab(filePath, content)
      } catch {
        return null
      }
    }))
    const nextTabs = settledTabs.filter((tab): tab is WorkspaceFileTab => tab !== null)
    const requestedActivePath = storedState.activePath ?? fallbackPath ?? null
    const nextActivePath = nextTabs.some((tab) => tab.filePath === requestedActivePath)
      ? requestedActivePath
      : nextTabs[0]?.filePath ?? null

    replaceTabs(nextTabs, nextActivePath)
    setIsSettingsTabActive(false)
    await updateWorkspaceState(workspacePath, { lastFilePath: nextActivePath })
  }

  async function handlePickWorkspace() {
    if (!confirmDiscardDirtyTabs('switch-workspace')) {
      return
    }

    setIsPickingWorkspace(true)
    try {
      const nextPath = await window.appApi.pickWorkspace()
      if (nextPath) {
        await connectWorkspace(nextPath)
        await restoreWorkspaceTabs(nextPath)
        setStatusMessage('Workspace connected')
      }
    } finally {
      setIsPickingWorkspace(false)
    }
  }

  async function handleCreateFile() {
    if (!currentPath) {
      return
    }

    const nextRelativePath = getNextUntitledFileName(rootFileNames)

    try {
      setIsCreatingFile(true)
      const { filePath } = await window.appApi.createWorkspaceFile(currentPath, nextRelativePath)
      await loadTree(currentPath)
      await openFile(filePath)
      await refreshGitState(currentPath, { silent: true })
      setStatusMessage(`${nextRelativePath} created`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create file.'
      setStatusMessage(message)
    } finally {
      setIsCreatingFile(false)
    }
  }

  async function handlePickWorkspaceIconTheme() {
    try {
      setIsImportingIconTheme(true)
      const nextIconTheme = await window.appApi.pickWorkspaceIconTheme()

      if (!nextIconTheme) {
        return
      }

      setIconTheme(nextIconTheme)
      setIconThemeOptions(await window.appApi.getWorkspaceIconThemeCatalog())
      setStatusMessage(`${nextIconTheme.extensionLabel}: ${nextIconTheme.activeThemeLabel}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to import the VSIX icon theme.'
      setStatusMessage(message)
    } finally {
      setIsImportingIconTheme(false)
    }
  }

  async function handleSelectWorkspaceIconTheme(selection: { sourceVsixPath: string, themeId: string }) {
    if (
      iconTheme?.activeThemeId === selection.themeId
      && iconTheme.sourceVsixPath === selection.sourceVsixPath
    ) {
      return
    }

    try {
      setIsApplyingIconTheme(true)
      const nextIconTheme = await window.appApi.setWorkspaceIconTheme(selection)

      if (!nextIconTheme) {
        return
      }

      setIconTheme(nextIconTheme)
      setIconThemeOptions(await window.appApi.getWorkspaceIconThemeCatalog())
      setStatusMessage(`${nextIconTheme.extensionLabel}: ${nextIconTheme.activeThemeLabel}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to switch the icon theme.'
      setStatusMessage(message)
    } finally {
      setIsApplyingIconTheme(false)
    }
  }

  function openSettings(section: SettingsSectionId) {
    setSettingsSection(section)
    setIsSettingsTabOpen(true)
    setIsSettingsTabActive(true)
  }

  async function handleRenameFile(filePath: string, nextName: string) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    const trimmedName = nextName.trim()
    if (!trimmedName) {
      throw new Error('File name is required.')
    }

    const nextBaseName = /\.[a-z0-9]+$/i.test(trimmedName) ? trimmedName : `${trimmedName}.md`
    const parentDirectory = getDirectoryRelativePath(currentPath, filePath)
    const nextRelativePath = parentDirectory ? `${parentDirectory}/${nextBaseName}` : nextBaseName

    const { filePath: nextFilePath } = await window.appApi.renameWorkspaceFile(currentPath, filePath, nextRelativePath)
    await loadTree(currentPath)
    renameTab(filePath, nextFilePath)
    await refreshGitState(currentPath, { silent: true })

    if (activeTabPath === filePath) {
      await updateWorkspaceState(currentPath, { lastFilePath: nextFilePath })
    }

    setStatusMessage(`${nextBaseName} renamed`)
  }

  async function handleDeleteFile(filePath: string) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    const targetTab = openTabs.find((tab) => tab.kind === 'file' && tab.filePath === filePath)
    if (targetTab?.isDirty) {
      const confirmed = window.confirm(
        `"${getBaseName(filePath)}" has unsaved changes.\n\nDelete the file and discard those changes?`,
      )

      if (!confirmed) {
        return
      }
    }

    await window.appApi.deleteWorkspaceFile(currentPath, filePath)
    await loadTree(currentPath)
    await refreshGitState(currentPath, { silent: true })

    if (targetTab) {
      closeTab(filePath)
      await syncPersistedActiveFile(currentPath)
    }

    setStatusMessage(`${getBaseName(filePath)} deleted`)
  }

  async function handleSave() {
    if (!currentFilePath) {
      return
    }

    await window.appApi.saveWorkspaceFile(currentFilePath, currentFileContent)
    markTabSaved(currentFilePath, currentFileContent)
    setStatusMessage('Changes saved')

    if (currentPath) {
      await loadTree(currentPath)
      await refreshGitState(currentPath, { silent: true })
    }
  }

  async function handleSaveDiffFile(filePath: string, content: string) {
    await window.appApi.saveWorkspaceFile(filePath, content)
    syncTabWithDisk(filePath, content)

    if (currentPath) {
      await loadTree(currentPath)
      await refreshGitState(currentPath, { silent: true })
    }
  }

  function activateFileTab(filePath: string) {
    if (filePath === SETTINGS_TAB_PATH) {
      setIsSettingsTabOpen(true)
      setIsSettingsTabActive(true)
      return
    }

    setIsSettingsTabActive(false)
    activateTab(filePath)

    const targetTab = displayTabs.find((tab) => tab.filePath === filePath)

    if (currentPath && targetTab?.kind === 'file') {
      void updateWorkspaceState(currentPath, { lastFilePath: targetTab.filePath })
    }
  }

  function cycleTabs(direction: 1 | -1) {
    if (displayTabs.length < 2 || !displayActiveTabPath) {
      return
    }

    const currentIndex = displayTabs.findIndex((tab) => tab.filePath === displayActiveTabPath)
    if (currentIndex === -1) {
      return
    }

    const nextIndex = (currentIndex + direction + displayTabs.length) % displayTabs.length
    const nextTab = displayTabs[nextIndex]

    activateFileTab(nextTab.filePath)
  }

  async function handleInitializeGit() {
    if (!currentPath) {
      return
    }

    await runGitAction('Initializing repository...', async () => {
      const nextState = await window.appApi.initializeGitRepository(currentPath)
      setGitRepositoryState(nextState)
      setStatusMessage('Git repository initialized')
    })
  }

  async function handleStageGitPaths(filePaths: string[]) {
    if (!currentPath || filePaths.length === 0) {
      return
    }

    await runGitAction('Staging changes...', async () => {
      const nextState = await window.appApi.stageGitPaths(currentPath, filePaths)
      setGitRepositoryState(nextState)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Git changes staged')
    })
  }

  async function handleUnstageGitPaths(filePaths: string[]) {
    if (!currentPath || filePaths.length === 0) {
      return
    }

    await runGitAction('Unstaging changes...', async () => {
      const nextState = await window.appApi.unstageGitPaths(currentPath, filePaths)
      setGitRepositoryState(nextState)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Git changes unstaged')
    })
  }

  async function handleDiscardGitChange(change: GitChangeItem) {
    if (!currentPath) {
      return
    }

    const confirmed = window.confirm(`Discard the current ${change.scope} change for "${change.relativePath}"?`)

    if (!confirmed) {
      return
    }

    await runGitAction('Discarding change...', async () => {
      const nextState = await window.appApi.discardGitChange(currentPath, change)
      setGitRepositoryState(nextState)
      await loadTree(currentPath)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage(`${change.relativePath} reverted`)
    })
  }

  async function handleCommitGitChanges() {
    if (!currentPath) {
      return
    }

    await runGitAction('Creating commit...', async () => {
      const nextState = await window.appApi.commitGitChanges(currentPath, gitCommitMessage)
      setGitRepositoryState(nextState)
      setGitCommitMessage('')
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Commit created')
    })
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const persistedIconTheme = await window.appApi.getWorkspaceIconTheme()
        const persistedIconThemeOptions = await window.appApi.getWorkspaceIconThemeCatalog()
        if (!cancelled) {
          setIconTheme(persistedIconTheme)
          setIconThemeOptions(persistedIconThemeOptions)
        }
      } catch {
        if (!cancelled) {
          setIconTheme(null)
          setIconThemeOptions([])
        }
      }

      const restoreState = await window.appApi.getWorkspaceRestoreState()
      const lastWorkspacePath = restoreState.workspacePath

      if (!lastWorkspacePath || cancelled) {
        return
      }

      try {
        await connectWorkspace(lastWorkspacePath)

        if (!cancelled) {
          await restoreWorkspaceTabs(lastWorkspacePath, restoreState.filePath)
        }

        if (!cancelled) {
          setStatusMessage('Last workspace restored')
        }
      } catch {
        if (!cancelled) {
          setStatusMessage('Open a folder to start.')
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsubscribe = window.appApi.onWorkspaceChanged(async (event) => {
      if (!currentPath || event.rootPath !== currentPath) {
        return
      }

      await loadTree(currentPath)
      await refreshGitState(currentPath, { silent: true })

      const affectedTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.kind === 'file' && tab.filePath === event.path)

      if (!affectedTab) {
        return
      }

      if (event.type === 'unlink') {
        if (affectedTab.isDirty) {
          markTabMissing(event.path)
          setStatusMessage(`${getBaseName(event.path)} was removed externally. Save to recreate it.`)
          return
        }

        closeTab(event.path)
        await syncPersistedActiveFile(currentPath)
        setStatusMessage(`${getBaseName(event.path)} was removed`)
        return
      }

      if (event.type === 'add') {
        if (affectedTab.isDirty) {
          setStatusMessage(`${getBaseName(event.path)} returned on disk. Kept your unsaved version.`)
          return
        }

        const updatedContent = await window.appApi.readWorkspaceFile(event.path)
        syncTabWithDisk(event.path, updatedContent)
        setStatusMessage(`${getBaseName(event.path)} reloaded`)
        return
      }

      if (event.type === 'change') {
        if (affectedTab.isDirty) {
          setStatusMessage(`${getBaseName(event.path)} changed on disk. Kept your unsaved version.`)
          return
        }

        const updatedContent = await window.appApi.readWorkspaceFile(event.path)
        syncTabWithDisk(event.path, updatedContent)
        setStatusMessage('Synced with external edits')
      }
    })

    return unsubscribe
  }, [closeTab, currentPath, markTabMissing, openDiffTab, syncTabWithDisk])

  useEffect(() => {
    return () => {
      void window.appApi.stopWorkspaceWatch()
    }
  }, [])

  useEffect(() => {
    if (!currentPath) {
      return
    }

    const storedPaths = openTabs
      .filter((tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.exists)
      .map((tab) => tab.filePath)

    window.localStorage.setItem(getTabStorageKey(currentPath), JSON.stringify({
      activePath: getPersistedActiveFilePath(),
      paths: storedPaths,
    } satisfies StoredTabState))
  }, [activeTabPath, currentPath, openTabs])

  useEffect(() => {
    if (!activeResizePanel) {
      return
    }

    const resizePanel = activeResizePanel

    function handlePointerMove(event: PointerEvent) {
      resizeSidebar(resizePanel, event.clientX)
    }

    function stopResizing() {
      setActiveResizePanel(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [activeResizePanel, isAgentPanelVisible, isMobileStacked, leftSidebarWidth, rightSidebarWidth])

  useEffect(() => {
    if (!isGitPanelResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      handleGitPanelResize(event.clientY)
    }

    function stopResizing() {
      setIsGitPanelResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isGitPanelResizing])

  useEffect(() => {
    const storage = window.localStorage
    const savedLeftWidth = storage.getItem('writing-workspace:left-sidebar-width')
    const savedRightWidth = storage.getItem('writing-workspace:right-sidebar-width')
    const savedLeftCollapsed = storage.getItem('writing-workspace:left-sidebar-collapsed')
    const savedRightCollapsed = storage.getItem('writing-workspace:right-sidebar-collapsed')
    const savedGitPanelHeight = storage.getItem('writing-workspace:git-panel-height')

    if (savedLeftWidth) {
      const parsedLeftWidth = Number(savedLeftWidth)
      if (Number.isFinite(parsedLeftWidth)) {
        setLeftSidebarWidth(parsedLeftWidth)
      }
    }

    if (savedRightWidth) {
      const parsedRightWidth = Number(savedRightWidth)
      if (Number.isFinite(parsedRightWidth)) {
        setRightSidebarWidth(parsedRightWidth)
      }
    }

    if (savedGitPanelHeight) {
      const parsedGitPanelHeight = Number(savedGitPanelHeight)
      if (Number.isFinite(parsedGitPanelHeight)) {
        setGitPanelHeight(parsedGitPanelHeight)
      }
    }

    if (savedLeftCollapsed) {
      setIsLeftSidebarCollapsed(savedLeftCollapsed === 'true')
    }

    if (savedRightCollapsed) {
      setIsRightSidebarCollapsed(savedRightCollapsed === 'true')
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:left-sidebar-width', String(leftSidebarWidth))
  }, [leftSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:right-sidebar-width', String(rightSidebarWidth))
  }, [rightSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:git-panel-height', String(gitPanelHeight))
  }, [gitPanelHeight])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:left-sidebar-collapsed', String(isLeftSidebarCollapsed))
  }, [isLeftSidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem('writing-workspace:right-sidebar-collapsed', String(isRightSidebarCollapsed))
  }, [isRightSidebarCollapsed])

  useEffect(() => {
    function syncSidebarWidths() {
      const shellWidth = getShellWidth()
      const nextLeftWidth = clampLeftWidth(leftSidebarWidth, shellWidth, effectiveRightSidebarWidth)
      const nextRightWidth = isRightSidebarVisible
        ? clampRightWidth(rightSidebarWidth, shellWidth, isLeftSidebarVisible ? nextLeftWidth : 0)
        : rightSidebarWidth

      if (nextLeftWidth !== leftSidebarWidth) {
        setLeftSidebarWidth(nextLeftWidth)
      }

      if (nextRightWidth !== rightSidebarWidth) {
        setRightSidebarWidth(nextRightWidth)
      }
    }

    syncSidebarWidths()
    window.addEventListener('resize', syncSidebarWidths)

    return () => window.removeEventListener('resize', syncSidebarWidths)
  }, [effectiveRightSidebarWidth, isLeftSidebarVisible, isRightSidebarVisible, leftSidebarWidth, rightSidebarWidth])

  useEffect(() => {
    setGitPanelHeight((currentValue) => clampGitHeight(currentValue))
  }, [leftSidebarWidth, isLeftSidebarVisible])

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()

      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault()
        void handleSave()
        return
      }

      if ((event.ctrlKey || event.metaKey) && key === 'w') {
        event.preventDefault()
        if (isSettingsTabActive) {
          closeEditorTab(SETTINGS_TAB_PATH)
          return
        }

        if (displayActiveTabPath) {
          closeEditorTab(displayActiveTabPath)
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
  }, [displayActiveTabPath, displayTabs, isSettingsTabActive])

  useEffect(() => {
    if (!isLeftSidebarVisible && activeResizePanel === 'left') {
      setActiveResizePanel(null)
    }

    if (!isRightSidebarVisible && activeResizePanel === 'right') {
      setActiveResizePanel(null)
    }
  }, [activeResizePanel, isLeftSidebarVisible, isRightSidebarVisible])

  return (
    <div
      ref={appShellRef}
      className='app-shell'
      data-platform={shellPlatform}
      data-left-collapsed={isLeftSidebarVisible ? 'false' : 'true'}
      data-resizing={activeResizePanel || isGitPanelResizing ? 'true' : 'false'}
      data-right-collapsed={isRightSidebarVisible ? 'false' : 'true'}
      style={
        {
          '--git-panel-height': `${gitPanelHeight}px`,
          '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
          '--right-sidebar-width': `${effectiveRightSidebarWidth}px`,
        } as CSSProperties
      }
    >
      <AppTitlebar />
      <button
        type='button'
        className='panel-toggle-button panel-toggle-button-overlay panel-toggle-button-overlay-left'
        aria-label={isLeftSidebarVisible ? 'Collapse workspace sidebar' : 'Expand workspace sidebar'}
        onClick={() => {
          setIsLeftSidebarCollapsed((currentValue) => !currentValue)
        }}
      >
        <span className={`panel-toggle-icon${isLeftSidebarVisible ? '' : ' is-collapsed'}`} aria-hidden='true'>
          <LayoutLeftbarCloseLine size={16} />
        </span>
      </button>

      {isAgentPanelVisible ? (
        <button
          type='button'
          className='panel-toggle-button panel-toggle-button-overlay panel-toggle-button-overlay-right'
          aria-label={isRightSidebarVisible ? 'Collapse assistant sidebar' : 'Expand assistant sidebar'}
          onClick={() => {
            setIsRightSidebarCollapsed((currentValue) => !currentValue)
          }}
        >
          <span className={`panel-toggle-icon${isRightSidebarVisible ? '' : ' is-collapsed'}`} aria-hidden='true'>
            <LayoutRightbarCloseLine size={16} />
          </span>
        </button>
      ) : null}

      <aside className={`panel panel-sidebar${isLeftSidebarVisible ? '' : ' is-collapsed'}`}>
        <div className='section-title workspace-section-title'>
          <button
            type='button'
            onClick={() => {
              void handlePickWorkspace()
            }}
            disabled={isPickingWorkspace}
            className='section-title-text'
            aria-label={isPickingWorkspace ? 'Opening workspace' : 'Open workspace'}
          >
            <span className='section-title-label'>{workspaceLabel}</span>
            <SelectorVerticalLine size={24} className='section-title-icon' />
          </button>

          <div className='section-title-drag-spacer' aria-hidden='true' />

          <div className='section-title-actions'>
            <Button
              variant='ghost'
              size='sm'
              onPress={() => {
                openSettings('file-icons')
              }}
              className='section-settings-button'
              aria-label='Open settings'
            >
              Settings
            </Button>

            <Button
              isIconOnly
              variant='ghost'
              onPress={() => {
                void handleCreateFile()
              }}
              isDisabled={!currentPath || isCreatingFile}
              className='section-create-button'
              aria-label={isCreatingFile ? 'Creating file' : 'Create file'}
            >
              <AddLine size={18} />
            </Button>
          </div>
        </div>

        <div ref={leftSidebarBodyRef} className='sidebar-stack'>
          <div className='sidebar-stack-pane sidebar-tree-pane'>
            <ScrollShadow className='tree-scroll' hideScrollBar>
              <WorkspaceTree
                activeFilePath={activeTreePath}
                iconTheme={iconTheme}
                nodes={tree}
                onSelectFile={(filePath) => {
                  void openFile(filePath)
                }}
                onRenameFile={(filePath, nextName) => handleRenameFile(filePath, nextName)}
                onDeleteFile={(filePath) => handleDeleteFile(filePath)}
              />
            </ScrollShadow>
          </div>

          <div className='sidebar-stack-resize-slot'>
            <div
              role='separator'
              className={`sidebar-stack-resize-handle${isGitPanelResizing ? ' is-active' : ''}`}
              aria-label='Resize Git panel'
              aria-controls='git-panel'
              aria-orientation='horizontal'
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return
                }

                setIsGitPanelResizing(true)
              }}
            />
          </div>

          <div className='sidebar-stack-pane sidebar-git-pane' id='git-panel'>
            <GitPanel
              busyLabel={gitBusyLabel}
              commitMessage={gitCommitMessage}
              errorMessage={gitErrorMessage}
              isLoading={isGitLoading}
              onCommit={() => {
                void handleCommitGitChanges()
              }}
              onCommitMessageChange={setGitCommitMessage}
              onDiscard={(change) => {
                void handleDiscardGitChange(change)
              }}
              onInitialize={() => {
                void handleInitializeGit()
              }}
              onOpenDiff={(change) => {
                void openGitDiff(change)
              }}
              onRefresh={() => {
                void refreshGitState(currentPath, { silent: false })
              }}
              onStage={(filePaths) => {
                void handleStageGitPaths(filePaths)
              }}
              onUnstage={(filePaths) => {
                void handleUnstageGitPaths(filePaths)
              }}
              repositoryState={gitRepositoryState}
              workspacePath={currentPath}
            />
          </div>
        </div>
      </aside>

      <div className={`panel-resize-slot panel-resize-slot-left${isLeftSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          className={`panel-resize-handle${activeResizePanel === 'left' ? ' is-active' : ''}`}
          aria-label='Resize workspace sidebar'
          aria-controls='editor-main'
          aria-orientation='vertical'
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }

            handleResizeStart('left')
          }}
        />
      </div>

      <main className='panel panel-editor' id='editor-main'>
        <div className='editor-frame'>
          <FileTabs
            activeFilePath={displayActiveTabPath}
            actions={currentPath ? (
              <button
                type='button'
                className='editor-toolbar-icon-button'
                aria-label={currentGitChange ? `Open diff for ${getBaseName(currentGitChange.path)}` : 'Open diff for current file'}
                title={currentGitChange ? 'Open diff for current file' : 'Current file has no Git changes'}
                disabled={!currentGitChange}
                onClick={() => {
                  if (!currentGitChange) {
                    return
                  }

                  void openGitDiff(currentGitChange)
                }}
              >
                <GitCompareLine size={16} />
              </button>
            ) : null}
            tabs={displayTabs}
            workspacePath={currentPath}
            onActivate={activateFileTab}
            onClose={(filePath) => {
              closeEditorTab(filePath)
            }}
          />

          <div className='editor-content-shell' id='writing-editor-panel'>
            {isSettingsTabActive ? (
              <SettingsDialog
                activeSection={settingsSection}
                agentState={agentWorkspaceState}
                iconTheme={iconTheme}
                iconThemeOptions={iconThemeOptions}
                isIconThemeBusy={isImportingIconTheme || isApplyingIconTheme}
                workspacePath={currentPath}
                onAgentStateChange={setAgentWorkspaceState}
                onImportIconTheme={handlePickWorkspaceIconTheme}
                onSectionChange={setSettingsSection}
                onSelectIconTheme={handleSelectWorkspaceIconTheme}
                onStatusMessage={setStatusMessage}
              />
            ) : !activeFileTab && !activeDiffTab ? (
              <div className='editor-empty-state'>
                <div className='editor-empty-content'>
                  <p className='eyebrow'>Ready</p>
                  <div className='editor-empty-copy'>
                    <h3>Open a workspace, then start with a clean draft.</h3>
                    <p>
                      The file tree, editor, Git changes, and assistant stay together in one calm desktop workspace.
                    </p>
                  </div>
                  <div className='editor-empty-actions'>
                    <Button variant='primary' onPress={handlePickWorkspace} isDisabled={isPickingWorkspace}>
                      <FolderOpenFill className='mr-2' size={16} />
                      Open Folder
                    </Button>
                    <Button
                      variant='outline'
                      onPress={() => {
                        void handleCreateFile()
                      }}
                      isDisabled={!currentPath || isCreatingFile}
                    >
                      <FileFill className='mr-2' size={16} />
                      Create Draft
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeDiffTab ? (
              <GitDiffEditor
                diff={activeDiffTab.diff}
                onSaveEditedFile={handleSaveDiffFile}
              />
            ) : null}

            {activeFileTab && currentEditorKind === 'rich-text' ? (
              <WritingEditor
                disabled={!currentFilePath}
                onChange={(nextValue) => {
                  if (!currentFilePath) {
                    return
                  }

                  updateTabContent(currentFilePath, nextValue)
                }}
                value={currentFileContent}
              />
            ) : null}

            {activeFileTab && currentEditorKind === 'code' ? (
              <CodeEditor
                disabled={false}
                filePath={activeFileTab.filePath}
                onChange={(nextValue) => {
                  updateTabContent(activeFileTab.filePath, nextValue)
                }}
                value={currentFileContent}
              />
            ) : null}
          </div>
        </div>
      </main>

      <div className={`panel-resize-slot panel-resize-slot-right${isRightSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          className={`panel-resize-handle${activeResizePanel === 'right' ? ' is-active' : ''}`}
          aria-label='Resize assistant sidebar'
          aria-controls='editor-main'
          aria-orientation='vertical'
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }

            handleResizeStart('right')
          }}
        />
      </div>

      <aside className={`panel panel-agent${isRightSidebarVisible ? '' : ' is-collapsed'}`}>
        <AgentSidebar
          workspacePath={currentPath}
          onWorkspaceStateChange={setAgentWorkspaceState}
        />
      </aside>

      <Toast.Provider placement='bottom end' />
    </div>
  )
}

export default App

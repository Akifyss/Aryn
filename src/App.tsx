import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Tooltip, Toast, toast, Modal, AlertDialog, Drawer } from '@heroui/react'
import {
  FileLine,
  FolderOpenFill,
  GitCompareLine,
  LayoutLeftLine,
  LayoutRightLine,
  SelectorVerticalLine,
} from '@mingcute/react'
import { Icon } from '@iconify/react'
import type { WorkspaceNode } from '@/features/workspace/types'
import { AppScrollArea } from '@/components/app-scroll-area'
import { AppTitlebar } from '@/components/app-titlebar'
import { AgentSidebar } from '@/features/agent/components/agent-sidebar'
import type { AgentMessageFileChangeKind, AgentWorkspaceState } from '@/features/agent/types'
import { GitDiffEditor } from '@/features/editor/components/git-diff-editor'
import { CodeEditor } from '@/features/editor/components/code-editor'
import { isLineWithinVisualDiff } from '@/features/editor/lib/git-diff-navigation'
import { MeoEditorHost, type MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host'
import { WritingEditor } from '@/features/editor/components/writing-editor'
import { GitPanel } from '@/features/git/components/git-panel'
import type {
  GitChangeItem,
  GitChangeScope,
  GitDiffBlockAction,
  GitDiffSelection,
  GitFileDiffResult,
  GitPanelLayout,
  GitRepositoryState,
} from '@/features/git/types'
import {
  SettingsDialog,
  type SettingsSectionId,
} from '@/features/settings/components/settings-dialog'
import type { AppIconCatalogOption } from '@/features/settings/types'
import { FileTabs } from '@/features/workspace/components/file-tabs'
import { WorkspaceTree } from '@/features/workspace/components/workspace-tree'
import {
  createWorkspaceFileTabId,
  useWorkspaceStore,
  type WorkspaceDiffTab,
  type WorkspaceDiffNavigationRequest,
  type WorkspaceDisplayTab,
  type WorkspaceFileGitDiffRequest,
  type WorkspaceFileTab,
  type WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'
import {
  getDefaultWorkspaceFileViewMode,
  supportsMeoEditor,
  supportsHtmlPreview,
  type WorkspaceFileViewMode,
} from '@/features/workspace/lib/file-types'
import {
  createWorkspaceRefreshCoordinator,
  type WorkspaceRefreshRequest,
  type WorkspaceRefreshScheduleMode,
} from '@/features/workspace/lib/workspace-refresh-coordinator'
import type {
  WorkspaceIconTheme,
  WorkspaceIconThemeCatalogOption,
} from '@/features/workspace/types'
import { CommandPalette } from '@/features/command-palette/components/command-palette'
import { useSettingsStore, type AppTheme } from '@/hooks/use-settings-store'
import { HtmlPreview } from '@/features/editor/components/html-preview'
import {
  COMPACT_LAYOUT_BREAKPOINT,
  deriveLayoutMode,
  deriveShellPlatform,
  FULL_LAYOUT_BREAKPOINT,
  getShellChromeVars,
  RIGHT_DRAWER_MAX_WIDTH,
  type LayoutMode,
  type ShellPlatform,
} from '@/features/layout/shell-layout'
import './App.css'

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

type ResolvedAppTheme = 'light' | 'dark'

function resolveAppTheme(theme: AppTheme): ResolvedAppTheme {
  if (theme !== 'auto') {
    return theme
  }

  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getThemeLinkedWorkspaceIconOption(
  resolvedTheme: ResolvedAppTheme,
  iconThemeOptions: WorkspaceIconThemeCatalogOption[],
) {
  const targetLabel = resolvedTheme === 'dark' ? 'flow dawn' : 'flow deep'

  return iconThemeOptions.find((option) => option.label.toLowerCase().includes(targetLabel)) ?? null
}

const THEME_LINKED_ICON_SWITCH_DELAY_MS = 300

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

function getNextUntitledDirectoryName(existingNames: string[]) {
  const occupiedNames = new Set(existingNames.map((name) => name.toLowerCase()))

  if (!occupiedNames.has('new-folder')) {
    return 'new-folder'
  }

  let index = 1
  while (occupiedNames.has(`new-folder-${index}`)) {
    index += 1
  }

  return `new-folder-${index}`
}

function isWorkspaceFileTab(tab: WorkspaceDisplayTab | null | undefined): tab is WorkspaceFileTab {
  return tab?.kind === 'file'
}

function isWorkspaceDiffTab(tab: WorkspaceDisplayTab | null | undefined): tab is WorkspaceDiffTab {
  return tab?.kind === 'diff'
}

function isWorkspaceAutosaveTab(tab: WorkspaceDisplayTab | WorkspaceFileTab | null | undefined): tab is WorkspaceFileTab {
  return tab?.kind === 'file' && tab.viewMode !== 'preview'
}

function createDiffTabId(filePath: string, scope: GitChangeScope) {
  return `git-diff://${scope}/${encodeURIComponent(filePath)}`
}

function normalizeFilePath(filePath: string) {
  return filePath.replace(/[\\/]+/g, '/').toLowerCase()
}

function hasPathPrefix(filePath: string, prefixPath: string) {
  const normalizedFilePath = normalizeFilePath(filePath).replace(/\/+$/, '')
  const normalizedPrefixPath = normalizeFilePath(prefixPath).replace(/\/+$/, '')

  return normalizedFilePath === normalizedPrefixPath || normalizedFilePath.startsWith(`${normalizedPrefixPath}/`)
}

function getWorkspaceTabSourcePath(tab: WorkspaceDisplayTab | WorkspaceDiffTab | WorkspaceFileTab) {
  return tab.kind === 'diff' ? tab.diff.change.path : tab.filePath
}

function getPathSeparator(filePath: string) {
  return filePath.includes('\\') ? '\\' : '/'
}

function shouldOpenGitDiffForLine(
  diff: GitFileDiffResult,
  source: 'revision' | 'worktree',
  lineNumber?: number,
) {
  if (typeof lineNumber !== 'number') {
    return true
  }

  return isLineWithinVisualDiff(diff.originalContent, diff.modifiedContent, source, lineNumber)
}

function createWorkspaceFileGitDiffRequest(
  change: GitChangeItem,
  source: 'revision' | 'worktree',
  lineNumber?: number,
  mode: WorkspaceFileGitDiffRequest['mode'] = 'split',
): WorkspaceFileGitDiffRequest {
  return {
    ...(typeof lineNumber === 'number' ? { lineNumber: Math.max(1, Math.floor(lineNumber)) } : null),
    mode,
    requestKey: `${change.scope}:${change.path}:${source}:${lineNumber ?? 'open'}:${Date.now()}`,
    scope: change.scope,
    source,
  }
}

function joinPath(basePath: string, relativeSuffix: string) {
  const separator = getPathSeparator(basePath)
  const normalizedBasePath = basePath.replace(/[\\/]+$/, '')
  const normalizedSuffix = relativeSuffix.replace(/[\\/]+/g, separator).replace(/^[\\/]+/, '')

  return normalizedSuffix ? `${normalizedBasePath}${separator}${normalizedSuffix}` : normalizedBasePath
}

function rebasePathPrefix(filePath: string, currentPrefix: string, nextPrefix: string) {
  const normalizedFilePath = filePath.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const normalizedCurrentPrefix = currentPrefix.replace(/[\\/]+/g, '/').replace(/\/+$/, '')
  const suffix = normalizedFilePath === normalizedCurrentPrefix
    ? ''
    : normalizedFilePath.slice(normalizedCurrentPrefix.length).replace(/^\/+/, '')

  return joinPath(nextPrefix, suffix)
}

type StoredTabState = {
  activePath: string | null
  entries?: Array<{
    path: string
    viewMode?: WorkspaceFileViewMode
  }>
  paths: string[]
}

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
const DEFAULT_GIT_PANEL_LAYOUT: GitPanelLayout = 'list'
const DRAWER_INTERACTION_REFRESH_STABLE_FRAMES = 2
const DRAWER_INTERACTION_REFRESH_MAX_FRAMES = 36
const APP_STORAGE_PREFIX = 'aryn'
const LEGACY_APP_STORAGE_PREFIX = String.fromCharCode(
  119,
  114,
  105,
  116,
  105,
  110,
  103,
  45,
  119,
  111,
  114,
  107,
  115,
  112,
  97,
  99,
  101,
)
const TAB_STORAGE_PREFIX = `${APP_STORAGE_PREFIX}:file-tabs:`
const LEGACY_TAB_STORAGE_PREFIXES = [
  `${APP_STORAGE_PREFIX}:editor-tabs:`,
  `${LEGACY_APP_STORAGE_PREFIX}:file-tabs:`,
  `${LEGACY_APP_STORAGE_PREFIX}:editor-tabs:`,
]
const LAYOUT_STORAGE_KEYS = {
  activeLeftSidebarTab: `${APP_STORAGE_PREFIX}:active-left-sidebar-tab`,
  gitPanelHeight: `${APP_STORAGE_PREFIX}:git-panel-height`,
  gitPanelLayout: `${APP_STORAGE_PREFIX}:git-panel-layout`,
  leftSidebarCollapsed: `${APP_STORAGE_PREFIX}:left-sidebar-collapsed`,
  leftSidebarWidth: `${APP_STORAGE_PREFIX}:left-sidebar-width`,
  rightSidebarCollapsed: `${APP_STORAGE_PREFIX}:right-sidebar-collapsed`,
  rightSidebarWidth: `${APP_STORAGE_PREFIX}:right-sidebar-width`,
} as const
const LEGACY_LAYOUT_STORAGE_KEYS: Record<keyof typeof LAYOUT_STORAGE_KEYS, string[]> = {
  activeLeftSidebarTab: [],
  gitPanelHeight: [`${LEGACY_APP_STORAGE_PREFIX}:git-panel-height`],
  gitPanelLayout: [`${LEGACY_APP_STORAGE_PREFIX}:git-panel-layout`],
  leftSidebarCollapsed: [`${LEGACY_APP_STORAGE_PREFIX}:left-sidebar-collapsed`],
  leftSidebarWidth: [`${LEGACY_APP_STORAGE_PREFIX}:left-sidebar-width`],
  rightSidebarCollapsed: [`${LEGACY_APP_STORAGE_PREFIX}:right-sidebar-collapsed`],
  rightSidebarWidth: [`${LEGACY_APP_STORAGE_PREFIX}:right-sidebar-width`],
}
const SETTINGS_TAB_ID = 'app://settings'
const SETTINGS_TAB_PATH = 'app://settings'
const WORKSPACE_AUTO_SAVE_DELAY_MS = 1000
const INTERNAL_SAVE_EVENT_TTL_MS = 2500
const WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS = 140

type ResizePanel = 'left' | 'right'
type PanelSurfaceMode = 'docked' | 'drawer'
type LeftSidebarTab = 'file' | 'git'

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getTabStorageKey(workspacePath: string) {
  return `${TAB_STORAGE_PREFIX}${encodeURIComponent(workspacePath)}`
}

function getLegacyTabStorageKey(workspacePath: string) {
  return LEGACY_TAB_STORAGE_PREFIXES.map((prefix) => `${prefix}${encodeURIComponent(workspacePath)}`)
}

function readStoredLocalStorageValue(
  storage: Storage,
  key: keyof typeof LAYOUT_STORAGE_KEYS,
) {
  const currentKey = LAYOUT_STORAGE_KEYS[key]
  const currentValue = storage.getItem(currentKey)

  if (currentValue !== null) {
    return currentValue
  }

  for (const candidateKey of LEGACY_LAYOUT_STORAGE_KEYS[key]) {
    const value = storage.getItem(candidateKey)

    if (value !== null) {
      storage.setItem(currentKey, value)
      storage.removeItem(candidateKey)
      return value
    }
  }

  return null
}

function getLocalStorage() {
  return typeof window === 'undefined' ? null : window.localStorage
}

function readStoredLayoutNumber(
  key: keyof typeof LAYOUT_STORAGE_KEYS,
  fallback: number,
) {
  const storage = getLocalStorage()
  const value = storage ? readStoredLocalStorageValue(storage, key) : null
  const parsedValue = value === null ? NaN : Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function readStoredLayoutBoolean(
  key: keyof typeof LAYOUT_STORAGE_KEYS,
  fallback: boolean,
) {
  const storage = getLocalStorage()
  const value = storage ? readStoredLocalStorageValue(storage, key) : null

  return value === null ? fallback : value === 'true'
}

function readStoredGitPanelLayout() {
  const storage = getLocalStorage()
  const value = storage ? readStoredLocalStorageValue(storage, 'gitPanelLayout') : null

  return value === 'list' || value === 'tree' ? value : DEFAULT_GIT_PANEL_LAYOUT
}

function readStoredLeftSidebarTab() {
  const storage = getLocalStorage()
  const value = storage ? readStoredLocalStorageValue(storage, 'activeLeftSidebarTab') : null

  return value === 'git' ? value : 'file'
}

function readStoredTabState(workspacePath: string): StoredTabState {
  try {
    const currentStorageKey = getTabStorageKey(workspacePath)
    const currentValue = window.localStorage.getItem(currentStorageKey)
    const rawValue = currentValue ?? getLegacyTabStorageKey(workspacePath).reduce<string | null>((storedValue, storageKey) => {
      if (storedValue !== null) {
        return storedValue
      }

      const legacyValue = window.localStorage.getItem(storageKey)

      if (legacyValue !== null) {
        window.localStorage.setItem(currentStorageKey, legacyValue)
        window.localStorage.removeItem(storageKey)
      }

      return legacyValue
    }, null)
    if (!rawValue) {
      return {
        activePath: null,
        paths: [],
      }
    }

    const parsedValue = JSON.parse(rawValue) as Partial<StoredTabState>
    const entries = Array.isArray(parsedValue.entries)
      ? parsedValue.entries.filter(
        (entry): entry is { path: string, viewMode?: WorkspaceFileViewMode } => (
          typeof entry === 'object'
          && entry !== null
          && typeof entry.path === 'string'
          && entry.path.trim().length > 0
          && (
            entry.viewMode === undefined
            || entry.viewMode === 'default'
            || entry.viewMode === 'code'
            || entry.viewMode === 'preview'
            || entry.viewMode === 'meo'
          )
        ),
      )
      : []
    const paths = Array.isArray(parsedValue.paths)
      ? parsedValue.paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
      : []

    return {
      activePath: typeof parsedValue.activePath === 'string' && parsedValue.activePath.trim().length > 0
        ? parsedValue.activePath
        : null,
      entries,
      paths: entries.length > 0 ? entries.map((entry) => entry.path) : paths,
    }
  } catch {
    return {
      activePath: null,
      entries: [],
      paths: [],
    }
  }
}

function dedupeStoredEntries(entries: Array<{ path: string, viewMode?: WorkspaceFileViewMode }>) {
  const seen = new Set<string>()

  return entries.filter((entry) => {
    const key = `${entry.path}::${entry.viewMode ?? 'default'}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function resolveWorkspaceFileViewMode(
  filePath: string,
  editorKind: WorkspaceFileTab['editorKind'],
  preferredViewMode?: WorkspaceFileViewMode,
) {
  if (preferredViewMode === 'default' && editorKind === 'rich-text') {
    return 'default'
  }

  if (preferredViewMode === 'meo' && supportsMeoEditor(filePath, editorKind)) {
    return preferredViewMode
  }

  if (preferredViewMode === 'preview' && editorKind === 'code' && supportsHtmlPreview(filePath)) {
    return preferredViewMode
  }

  if (preferredViewMode === 'code' && (editorKind === 'rich-text' || supportsHtmlPreview(filePath))) {
    return preferredViewMode
  }

  return getDefaultWorkspaceFileViewMode(filePath, editorKind)
}

function toStoredWorkspaceTab(
  filePath: string,
  content: string,
  editorKind: WorkspaceFileTab['editorKind'],
  viewMode: WorkspaceFileViewMode,
): WorkspaceFileTab {

  return {
    content,
    editorKind,
    exists: true,
    filePath,
    id: createWorkspaceFileTabId(filePath, viewMode),
    isDirty: false,
    kind: 'file',
    savedContent: content,
    viewMode,
  }
}

function createDiffTab(
  change: GitChangeItem,
  scope: GitChangeScope,
  diff: Awaited<ReturnType<typeof window.appApi.getGitFileDiff>>,
  navigationRequest?: WorkspaceDiffNavigationRequest | null,
): WorkspaceDiffTab {
  const id = createDiffTabId(change.path, scope)
  return {
    draftContent: null,
    diff,
    exists: true,
    filePath: id,
    id,
    isDirty: false,
    kind: 'diff',
    navigationRequest: navigationRequest ?? null,
    title: getBaseName(change.path),
  }
}


function App() {
  const platform = window.appApi.platform
  const { meo, theme } = useSettingsStore()
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedAppTheme>(() => resolveAppTheme(theme))

  // Apply theme to document root
  useEffect(() => {
    const applyTheme = (t: 'light' | 'dark') => {
      const body = window.document.body
      const root = window.document.documentElement
      setResolvedTheme(t)

      // HeroUI/Tailwind official pattern: apply to html and body
      root.classList.remove('light', 'dark')
      root.classList.add(t)
      root.setAttribute('data-theme', t)

      body.classList.remove('light', 'dark')
      body.classList.add(t)

      // Also set the theme-color meta tag for better UI integration
      const meta = window.document.querySelector('meta[name="theme-color"]')
      if (meta) {
        // Match official OKLCH background tokens
        meta.setAttribute('content', t === 'dark' ? '#242526' : '#f5f6f8')
      }
    }

    if (theme === 'auto') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      applyTheme(systemTheme)

      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const handleChange = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light')
      }
      mediaQuery.addEventListener('change', handleChange)
      return () => mediaQuery.removeEventListener('change', handleChange)
    }

    applyTheme(theme)
  }, [theme])

  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)

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

  const [isImportingIconTheme, setIsImportingIconTheme] = useState(false)
  const [isApplyingIconTheme, setIsApplyingIconTheme] = useState(false)
  const [isSettingsTabOpen, setIsSettingsTabOpen] = useState(false)
  const [isSettingsTabActive, setIsSettingsTabActive] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('appearance')
  const [agentWorkspaceState, setAgentWorkspaceState] = useState<AgentWorkspaceState | null>(null)
  const [iconTheme, setIconTheme] = useState<WorkspaceIconTheme | null>(null)
  const [iconThemeOptions, setIconThemeOptions] = useState<WorkspaceIconThemeCatalogOption[]>([])
  const [appIconId, setAppIconId] = useState<string | null>(null)
  const [appIconOptions, setAppIconOptions] = useState<AppIconCatalogOption[]>([])
  const [isApplyingAppIcon, setIsApplyingAppIcon] = useState(false)
  const lastIconThemeLinkedThemeRef = useRef<ResolvedAppTheme>(resolvedTheme)
  const iconThemeLinkRequestRef = useRef(0)
  const [, setStatusMessage] = useState('Open a folder to start.')
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [activeSettingsTab, setActiveSettingsTab] = useState<'general' | 'file-icons' | 'agent'>('general')

  const [leftSidebarWidth, setLeftSidebarWidth] = useState(
    () => readStoredLayoutNumber('leftSidebarWidth', DEFAULT_LEFT_SIDEBAR_WIDTH),
  )
  const [rightSidebarWidth, setRightSidebarWidth] = useState(
    () => readStoredLayoutNumber('rightSidebarWidth', DEFAULT_RIGHT_SIDEBAR_WIDTH),
  )
  const [gitPanelHeight, setGitPanelHeight] = useState(
    () => readStoredLayoutNumber('gitPanelHeight', DEFAULT_GIT_PANEL_HEIGHT),
  )
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('leftSidebarCollapsed', false),
  )
  const [isRightSidebarCollapsed, setIsRightSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('rightSidebarCollapsed', false),
  )
  const [activeResizePanel, setActiveResizePanel] = useState<ResizePanel | null>(null)
  const [isGitPanelResizing, setIsGitPanelResizing] = useState(false)
  const [activeLeftSidebarTab, setActiveLeftSidebarTab] = useState<LeftSidebarTab>(() => readStoredLeftSidebarTab())
  const [gitRepositoryState, setGitRepositoryState] = useState<GitRepositoryState | null>(null)
  const [isGitLoading, setIsGitLoading] = useState(false)
  const [gitBusyLabel, setGitBusyLabel] = useState<string | null>(null)
  const [gitErrorMessage, setGitErrorMessage] = useState<string | null>(null)
  const [gitCommitMessage, setGitCommitMessage] = useState('')
  const [gitPanelLayout, setGitPanelLayout] = useState<GitPanelLayout>(() => readStoredGitPanelLayout())
  const [shellWidth, setShellWidth] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth : FULL_LAYOUT_BREAKPOINT + 1
  ))
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false)
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const leftSidebarBodyRef = useRef<HTMLDivElement | null>(null)
  const leftDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const rightDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const meoEditorHostRef = useRef<MeoEditorHostHandle | null>(null)
  const activeTabId = useWorkspaceStore((state) => state.activeTabId)
  const activateTab = useWorkspaceStore((state) => state.activateTab)
  const closeTab = useWorkspaceStore((state) => state.closeTab)
  const currentPath = useWorkspaceStore((state) => state.currentPath)
  const markDiffTabSaved = useWorkspaceStore((state) => state.markDiffTabSaved)
  const markFileTabsMissing = useWorkspaceStore((state) => state.markFileTabsMissing)
  const markFileTabsSaved = useWorkspaceStore((state) => state.markFileTabsSaved)
  const moveTab = useWorkspaceStore((state) => state.moveTab)
  const openDiffTab = useWorkspaceStore((state) => state.openDiffTab)
  const openTab = useWorkspaceStore((state) => state.openTab)
  const openTabs = useWorkspaceStore((state) => state.openTabs)
  const renameTab = useWorkspaceStore((state) => state.renameTab)
  const replaceTabs = useWorkspaceStore((state) => state.replaceTabs)
  const resetOpenTabs = useWorkspaceStore((state) => state.resetOpenTabs)
  const setCurrentPath = useWorkspaceStore((state) => state.setCurrentPath)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const syncFileTabsWithDisk = useWorkspaceStore((state) => state.syncFileTabsWithDisk)
  const tree = useWorkspaceStore((state) => state.tree)
  const updateDiffTabDraft = useWorkspaceStore((state) => state.updateDiffTabDraft)
  const updateFileTabsContent = useWorkspaceStore((state) => state.updateFileTabsContent)
  const loadTree = useCallback(async (rootPath: string) => {
    const nextTree = await window.appApi.loadWorkspaceTree(rootPath)
    setTree(nextTree)
  }, [setTree])
  const activeTab = useMemo(
    () => openTabs.find((tab) => tab.id === activeTabId) ?? null,
    [activeTabId, openTabs],
  )
  const activeFileTab = isWorkspaceFileTab(activeTab) ? activeTab : null
  const activeDiffTab = isWorkspaceDiffTab(activeTab) ? activeTab : null
  const activeDiffDraftContent = activeDiffTab?.draftContent ?? activeDiffTab?.diff.modifiedContent ?? ''
  const activeDiffHasDirtyRelatedFileTab = useMemo(() => {
    if (!activeDiffTab) {
      return false
    }

    const diffPath = normalizeFilePath(activeDiffTab.diff.change.path)

    return openTabs.some((tab: WorkspaceTab) => (
      tab.kind === 'file'
      && tab.isDirty
      && normalizeFilePath(tab.filePath) === diffPath
    ))
  }, [activeDiffTab?.diff.change.path, openTabs])
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
          id: SETTINGS_TAB_ID,
          isDirty: false,
          kind: 'settings',
          savedContent: '',
        },
      ]
    },
    [isSettingsTabOpen, openTabs],
  )
  const displayActiveTabId = isSettingsTabActive ? SETTINGS_TAB_ID : activeTabId
  const currentFileContent = activeFileTab?.content ?? ''
  const currentEditorKind = activeFileTab?.editorKind ?? null
  const currentFileViewMode = activeFileTab?.viewMode ?? null
  const currentFilePath = activeFileTab?.filePath ?? null
  const isActiveMeoEditorMountedRef = useRef(false)
  isActiveMeoEditorMountedRef.current = currentEditorKind === 'rich-text' && currentFileViewMode === 'meo'
  const activeWorkspaceAutosaveTab = isWorkspaceAutosaveTab(activeFileTab) ? activeFileTab : null
  const [isActiveEditorComposing, setIsActiveEditorComposing] = useState(false)
  const workspaceAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const workspaceAutosaveTargetRef = useRef<{ content: string, filePath: string } | null>(null)
  const workspaceAutosavePromiseRef = useRef<Promise<void> | null>(null)
  const diffAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const diffAutosaveTargetRef = useRef<{ tabId: string } | null>(null)
  const diffAutosavePromiseRef = useRef<Promise<boolean> | null>(null)
  const flushDiffTabRef = useRef<(tab: WorkspaceDiffTab, options?: { announce?: boolean }) => Promise<boolean>>(async () => false)
  const previousWorkspaceAutosavePathRef = useRef<string | null>(null)
  const previousActiveDiffTabIdRef = useRef<string | null>(null)
  const internalWorkspaceSavePathsRef = useRef(new Set<string>())
  const internalWorkspaceSaveTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const windowCloseRequestInFlightRef = useRef(false)
  const currentPathRef = useRef<string | null>(currentPath)
  const gitRepositoryStateRef = useRef<GitRepositoryState | null>(gitRepositoryState)
  const latestGitRefreshRequestIdRef = useRef(0)
  const latestVisibleGitRefreshRequestIdRef = useRef<number | null>(null)
  const performWorkspaceRefreshRef = useRef<(request: Required<WorkspaceRefreshRequest>) => Promise<void>>(async () => {})
  const workspaceRefreshCoordinatorRef = useRef<ReturnType<typeof createWorkspaceRefreshCoordinator> | null>(null)
  currentPathRef.current = currentPath
  gitRepositoryStateRef.current = gitRepositoryState

  if (!workspaceRefreshCoordinatorRef.current) {
    workspaceRefreshCoordinatorRef.current = createWorkspaceRefreshCoordinator({
      debounceMs: WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS,
      onFlush: (request) => performWorkspaceRefreshRef.current(request),
    })
  }
  const captureActiveMeoViewPosition = useCallback(() => {
    if (!isActiveMeoEditorMountedRef.current) {
      return
    }

    meoEditorHostRef.current?.captureViewPosition()
  }, [])
  const rootFileNames = useMemo(
    () => tree.filter((node) => node.kind === 'file').map((node) => node.name),
    [tree],
  )
  const rootDirNames = useMemo(
    () => tree.filter((node) => node.kind === 'directory').map((node) => node.name),
    [tree],
  )
  const workspaceLabel = currentPath
    ? getBaseName(currentPath)
    : 'Current workspace'
  const shellPlatform: ShellPlatform = deriveShellPlatform(platform)
  const shellChromeVars = getShellChromeVars(shellPlatform) as CSSProperties
  const layoutMode: LayoutMode = deriveLayoutMode(shellWidth)
  const isLeftSidebarDrawer = layoutMode !== 'full'
  const isRightSidebarDrawer = layoutMode === 'focus'
  const isRightDrawerFullWidth = shellWidth <= RIGHT_DRAWER_MAX_WIDTH
  const isLeftSidebarVisible = !isLeftSidebarDrawer && !isLeftSidebarCollapsed
  const isRightSidebarVisible = !isRightSidebarDrawer && !isRightSidebarCollapsed
  const isAppModalLayerOpen = isSettingsOpen || isCommandPaletteOpen || Boolean(confirmDialogOptions?.isOpen)
  const isLeftPanelOverlayElevated = !isAppModalLayerOpen && !isRightDrawerOpen
  const isRightPanelOverlayElevated = !isAppModalLayerOpen && !isLeftDrawerOpen
  const isLeftPanelOverlayTopLayer = !isAppModalLayerOpen && isLeftDrawerOpen
  const isRightPanelOverlayTopLayer = !isAppModalLayerOpen && isRightDrawerOpen
  const effectiveLeftSidebarWidth = isLeftSidebarVisible ? leftSidebarWidth : 0
  const effectiveRightSidebarWidth = isRightSidebarVisible ? rightSidebarWidth : 0
  const activeTreePath = activeFileTab?.filePath ?? activeDiffTab?.diff.change.path ?? null
  const canAttemptOpenCurrentDiff = Boolean(
    activeFileTab
    && currentPath
    && gitRepositoryState?.isRepository
  )

  function findGitChangeByFilePath(
    repositoryState: GitRepositoryState | null,
    filePath: string,
    preferredScopes: GitChangeScope[] = ['unstaged', 'staged'],
  ) {
    if (!repositoryState?.isRepository) {
      return null
    }

    const targetPath = normalizeFilePath(filePath)

    const changesByScope: Record<GitChangeScope, GitChangeItem[]> = {
      staged: repositoryState.stagedChanges,
      unstaged: repositoryState.unstagedChanges,
    }

    for (const scope of preferredScopes) {
      const matchingChange = changesByScope[scope].find((change) => normalizeFilePath(change.path) === targetPath)

      if (matchingChange) {
        return matchingChange
      }
    }

    return null
  }

  function getPersistedActiveFilePath() {
    const activeTabId = useWorkspaceStore.getState().activeTabId
    const tab = useWorkspaceStore.getState().openTabs.find((candidate) => candidate.id === activeTabId)
    return tab?.kind === 'file' ? tab.filePath : null
  }

  function getDirtyWorkspaceTabsSnapshot() {
    return useWorkspaceStore.getState().openTabs.filter(
      (tab) => tab.isDirty,
    )
  }

  function getDirtyWorkspaceTabsForPaths(filePaths?: string[]) {
    const normalizedTargets = filePaths?.map((filePath) => normalizeFilePath(filePath))

    return getDirtyWorkspaceTabsSnapshot().filter((tab) => {
      if (!normalizedTargets?.length) {
        return true
      }

      return normalizedTargets.includes(normalizeFilePath(getWorkspaceTabSourcePath(tab)))
    })
  }

  function getDirtyWorkspaceTabsForNodePath(nodePath: string) {
    return getDirtyWorkspaceTabsSnapshot().filter((tab) => hasPathPrefix(getWorkspaceTabSourcePath(tab), nodePath))
  }

  function hasDirtyFileTabsForPath(filePath: string) {
    const normalizedPath = normalizeFilePath(filePath)

    return useWorkspaceStore.getState().openTabs.some((tab) => (
      tab.kind === 'file'
      && tab.isDirty
      && normalizeFilePath(tab.filePath) === normalizedPath
    ))
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
    if (
      (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
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

    const nextWidth = shellRect.right - pointerClientX
    setRightSidebarWidth(clampRightWidth(nextWidth, shellWidth, effectiveLeftSidebarWidth))
  }

  function handleResizeStart(panel: ResizePanel) {
    if (
      (panel === 'left' && !isLeftSidebarVisible)
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

  function rebaseExpandedTreePaths(currentNodePath: string, nextNodePath: string) {
    setExpandedPaths((currentExpandedPaths) => {
      const nextExpandedPaths = new Set<string>()

      currentExpandedPaths.forEach((expandedPath) => {
        if (hasPathPrefix(expandedPath, currentNodePath)) {
          nextExpandedPaths.add(rebasePathPrefix(expandedPath, currentNodePath, nextNodePath))
          return
        }

        nextExpandedPaths.add(expandedPath)
      })

      return nextExpandedPaths
    })
  }

  function updateOpenTabsForMovedNode(currentNodePath: string, nextNodePath: string) {
    const currentTabs = [...useWorkspaceStore.getState().openTabs]

    currentTabs.forEach((tab) => {
      if (tab.kind === 'file' && hasPathPrefix(tab.filePath, currentNodePath)) {
        renameTab(tab.filePath, rebasePathPrefix(tab.filePath, currentNodePath, nextNodePath))
        return
      }

      if (tab.kind === 'diff' && hasPathPrefix(tab.diff.change.path, currentNodePath)) {
        closeTab(tab.id)
      }
    })
  }

  function closeTabsForNode(nodePath: string) {
    const currentTabs = [...useWorkspaceStore.getState().openTabs]

    currentTabs.forEach((tab) => {
      const targetPath = tab.kind === 'diff' ? tab.diff.change.path : tab.filePath
      if (hasPathPrefix(targetPath, nodePath)) {
        closeTab(tab.id)
      }
    })
  }

  function closeFileTabsForPath(filePath: string) {
    const currentTabs = useWorkspaceStore.getState().openTabs

    currentTabs.forEach((tab) => {
      if (tab.kind === 'file' && tab.filePath === filePath) {
        closeTab(tab.id)
      }
    })
  }

  const syncOpenDiffTabs = useCallback(async (workspacePath: string) => {
    const diffTabs = useWorkspaceStore.getState().openTabs.filter((tab): tab is WorkspaceDiffTab => tab.kind === 'diff')

    await Promise.all(diffTabs.map(async (tab) => {
      try {
        const nextDiff = await window.appApi.getGitFileDiff(workspacePath, tab.diff.change.path, tab.diff.change.scope)
        openDiffTab(createDiffTab(nextDiff.change, nextDiff.change.scope, nextDiff), false)
      } catch {
        if (!tab.isDirty) {
          closeTab(tab.id)
        }
      }
    }))
  }, [closeTab, openDiffTab])

  async function persistDiffTabContent(
    tabId: string,
    filePath: string,
    content: string,
    options: { announce?: boolean } = {},
  ) {
    const { announce = false } = options
    markInternalWorkspaceSave(filePath)

    try {
      await window.appApi.saveWorkspaceFile(filePath, content)
    } catch (error) {
      clearInternalWorkspaceSaveMarker(filePath)
      throw error
    }

    syncFileTabsWithDisk(filePath, content)
    markDiffTabSaved(tabId, content)

    if (announce) {
      setStatusMessage('Changes saved')
    }

    if (currentPath) {
      await performWorkspaceRefresh(currentPath, {
        refreshGit: true,
        refreshTree: true,
      })
    }
  }

  async function flushDiffTab(tab: WorkspaceDiffTab, options: { announce?: boolean } = {}) {
    if (!tab.isDirty || tab.diff.change.scope !== 'unstaged' || !tab.diff.modifiedExists) {
      return false
    }

    if (hasDirtyFileTabsForPath(tab.diff.change.path)) {
      return false
    }

    const draftContent = tab.draftContent ?? tab.diff.modifiedContent

    if (draftContent === tab.diff.modifiedContent) {
      updateDiffTabDraft(tab.id, null)
      return false
    }

    await persistDiffTabContent(tab.id, tab.diff.change.path, draftContent, options)
    return true
  }

  async function flushDirtyDiffTabs(filePaths?: string[]) {
    if (Array.isArray(filePaths) && filePaths.length === 0) {
      return false
    }

    const normalizedTargets = filePaths?.map((filePath) => normalizeFilePath(filePath))
    const dirtyDiffTabs = useWorkspaceStore.getState().openTabs.filter(
      (tab): tab is WorkspaceDiffTab => (
        tab.kind === 'diff'
        && tab.isDirty
        && (!normalizedTargets?.length || normalizedTargets.includes(normalizeFilePath(tab.diff.change.path)))
      ),
    )

    let didSave = false

    for (const tab of dirtyDiffTabs) {
      const saved = await flushDiffTab(tab)
      didSave = didSave || saved
    }

    return didSave
  }

  flushDiffTabRef.current = flushDiffTab

  const clearDiffAutosaveTimer = useCallback(() => {
    if (!diffAutosaveTimerRef.current) {
      return
    }

    clearTimeout(diffAutosaveTimerRef.current)
    diffAutosaveTimerRef.current = null
  }, [])

  const flushDiffAutosave = useCallback(async (tabId?: string) => {
    clearDiffAutosaveTimer()

    if (diffAutosavePromiseRef.current) {
      await diffAutosavePromiseRef.current
    }

    const targetTabId = tabId ?? diffAutosaveTargetRef.current?.tabId

    if (!targetTabId) {
      return false
    }

    const targetTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceDiffTab => (
        tab.kind === 'diff'
        && tab.id === targetTabId
        && tab.isDirty
      ),
    )

    if (!targetTab) {
      if (diffAutosaveTargetRef.current?.tabId === targetTabId) {
        diffAutosaveTargetRef.current = null
      }

      return false
    }

    const savePromise = flushDiffTabRef.current(targetTab)
    diffAutosavePromiseRef.current = savePromise

    try {
      return await savePromise
    } finally {
      if (diffAutosavePromiseRef.current === savePromise) {
        diffAutosavePromiseRef.current = null
      }

      if (diffAutosaveTargetRef.current?.tabId === targetTab.id) {
        diffAutosaveTargetRef.current = null
      }
    }
  }, [clearDiffAutosaveTimer])

  async function ensureWorkspaceTabsSavedBeforeNodeMutation(options: {
    actionLabel: string
    nodePath: string
  }) {
    if (isActiveEditorComposing) {
      const message = `Finish the current IME composition before ${options.actionLabel.toLowerCase()}.`
      toast.warning('Finish editing first', {
        description: message,
      })
      setStatusMessage(message)
      return false
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()

    const dirtyDiffPaths = Array.from(new Set(
      getDirtyWorkspaceTabsForNodePath(options.nodePath)
        .filter((tab): tab is WorkspaceDiffTab => tab.kind === 'diff')
        .map((tab) => tab.diff.change.path),
    ))

    try {
      await flushDirtyDiffTabs(dirtyDiffPaths)
    } catch {
      // Keep unsaved tabs visible and block the tree mutation below.
    }

    const remainingDirtyTabs = getDirtyWorkspaceTabsForNodePath(options.nodePath)

    if (remainingDirtyTabs.length === 0) {
      return true
    }

    const dirtyNames = remainingDirtyTabs
      .slice(0, 4)
      .map((tab) => getBaseName(getWorkspaceTabSourcePath(tab)))
      .join(', ')
    const remainingCount = remainingDirtyTabs.length - Math.min(remainingDirtyTabs.length, 4)
    const extraLabel = remainingCount > 0 ? ` and ${remainingCount} more` : ''
    const message = `Save or close the unsaved tab${remainingDirtyTabs.length > 1 ? 's' : ''} (${dirtyNames}${extraLabel}) before ${options.actionLabel.toLowerCase()}.`

    toast.warning('Unsaved changes need attention', {
      description: message,
    })
    setStatusMessage(message)
    return false
  }

  async function ensureWorkspaceTabsSavedBeforeGitAction(options: {
    actionLabel: string
    filePaths?: string[]
  }) {
    if (isActiveEditorComposing) {
      const message = 'Finish the current IME composition before running this Git action.'
      toast.warning('Finish editing first', {
        description: message,
      })
      setStatusMessage(message)
      return false
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()

    if (options.filePaths?.length) {
      const uniqueFilePaths = Array.from(new Set(options.filePaths.map((filePath) => normalizeFilePath(filePath))))
      const workspaceTabs = useWorkspaceStore.getState().openTabs

      for (const normalizedPath of uniqueFilePaths) {
        const matchingFileTab = workspaceTabs.find(
          (tab): tab is WorkspaceFileTab => (
            isWorkspaceAutosaveTab(tab)
            && tab.isDirty
            && normalizeFilePath(tab.filePath) === normalizedPath
          ),
        )

        if (!matchingFileTab) {
          continue
        }

        await flushWorkspaceAutosave(matchingFileTab.filePath)
      }
    }

    try {
      await flushDirtyDiffTabs(options.filePaths)
    } catch {
      // Keep unsaved tabs visible and block the Git action below.
    }

    const remainingDirtyTabs = getDirtyWorkspaceTabsForPaths(options.filePaths)

    if (remainingDirtyTabs.length === 0) {
      return true
    }

    const dirtyNames = remainingDirtyTabs
      .slice(0, 4)
      .map((tab) => getBaseName(getWorkspaceTabSourcePath(tab)))
      .join(', ')
    const remainingCount = remainingDirtyTabs.length - Math.min(remainingDirtyTabs.length, 4)
    const extraLabel = remainingCount > 0 ? ` and ${remainingCount} more` : ''
    const message = `Save the unsaved tab${remainingDirtyTabs.length > 1 ? 's' : ''} (${dirtyNames}${extraLabel}) before ${options.actionLabel.toLowerCase()}.`

    toast.warning('Unsaved changes need attention', {
      description: message,
    })
    setStatusMessage(message)
    return false
  }

  const refreshGitState = useCallback(async (workspacePath: string | null, options: { silent?: boolean } = {}) => {
    if (!workspacePath) {
      latestGitRefreshRequestIdRef.current += 1
      setGitRepositoryState(null)
      return null
    }

    const requestId = latestGitRefreshRequestIdRef.current + 1
    latestGitRefreshRequestIdRef.current = requestId

    if (!options.silent) {
      latestVisibleGitRefreshRequestIdRef.current = requestId
      setIsGitLoading(true)
    }

    try {
      const nextState = await window.appApi.getGitRepositoryState(workspacePath)

      // Multiple refreshes can overlap during saves and external FS events.
      // Only the latest completed request is allowed to update UI state.
      if (latestGitRefreshRequestIdRef.current === requestId) {
        setGitRepositoryState(nextState)
        setGitErrorMessage(null)
        await syncOpenDiffTabs(workspacePath)
      }

      return nextState
    } catch (error) {
      if (latestGitRefreshRequestIdRef.current !== requestId) {
        return gitRepositoryStateRef.current
      }

      const message = error instanceof Error ? error.message : 'Unable to load Git status.'
      setGitErrorMessage(message)
      return null
    } finally {
      if (!options.silent && latestVisibleGitRefreshRequestIdRef.current === requestId) {
        setIsGitLoading(false)
        latestVisibleGitRefreshRequestIdRef.current = null
      }
    }
  }, [syncOpenDiffTabs])

  const performWorkspaceRefresh = useCallback(async (
    rootPath: string,
    options: Omit<WorkspaceRefreshRequest, 'rootPath'> = {},
  ) => {
    const activeWorkspacePath = currentPathRef.current

    if (!activeWorkspacePath || activeWorkspacePath !== rootPath) {
      return
    }

    if (options.refreshTree) {
      await loadTree(rootPath)
    }

    if (options.refreshGit) {
      await refreshGitState(rootPath, { silent: options.gitSilent ?? true })
    }
  }, [loadTree, refreshGitState])

  performWorkspaceRefreshRef.current = async (request) => {
    await performWorkspaceRefresh(request.rootPath, request)
  }

  const requestWorkspaceRefresh = useCallback((
    request: WorkspaceRefreshRequest,
    mode: WorkspaceRefreshScheduleMode = 'immediate',
  ) => {
    return workspaceRefreshCoordinatorRef.current?.request(request, mode) ?? Promise.resolve()
  }, [])

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

  const clearInternalWorkspaceSaveMarker = useCallback((filePath: string) => {
    internalWorkspaceSavePathsRef.current.delete(filePath)
    const timer = internalWorkspaceSaveTimersRef.current.get(filePath)

    if (timer) {
      clearTimeout(timer)
      internalWorkspaceSaveTimersRef.current.delete(filePath)
    }
  }, [])

  const markInternalWorkspaceSave = useCallback((filePath: string) => {
    clearInternalWorkspaceSaveMarker(filePath)
    internalWorkspaceSavePathsRef.current.add(filePath)
    internalWorkspaceSaveTimersRef.current.set(filePath, setTimeout(() => {
      clearInternalWorkspaceSaveMarker(filePath)
    }, INTERNAL_SAVE_EVENT_TTL_MS))
  }, [clearInternalWorkspaceSaveMarker])

  const consumeInternalWorkspaceSave = useCallback((filePath: string) => {
    if (!internalWorkspaceSavePathsRef.current.has(filePath)) {
      return false
    }

    clearInternalWorkspaceSaveMarker(filePath)
    return true
  }, [clearInternalWorkspaceSaveMarker])

  const clearWorkspaceAutosaveTimer = useCallback(() => {
    if (!workspaceAutosaveTimerRef.current) {
      return
    }

    clearTimeout(workspaceAutosaveTimerRef.current)
    workspaceAutosaveTimerRef.current = null
  }, [])

  const persistWorkspaceFileContent = useCallback(async (
    filePath: string,
    content: string,
    options: { announce?: boolean, syncMode?: 'mark' | 'sync' } = {},
  ) => {
    const { announce = false, syncMode = 'mark' } = options
    markInternalWorkspaceSave(filePath)

    try {
      await window.appApi.saveWorkspaceFile(filePath, content)
    } catch (error) {
      clearInternalWorkspaceSaveMarker(filePath)
      throw error
    }

    if (syncMode === 'sync') {
      syncFileTabsWithDisk(filePath, content)
    } else {
      markFileTabsSaved(filePath, content)
    }

    if (announce) {
      setStatusMessage('Changes saved')
    }

    if (currentPath) {
      await performWorkspaceRefresh(currentPath, {
        refreshGit: true,
        refreshTree: true,
      })
    }
  }, [
    clearInternalWorkspaceSaveMarker,
    currentPath,
    markInternalWorkspaceSave,
    markFileTabsSaved,
    performWorkspaceRefresh,
    syncFileTabsWithDisk,
  ])

  const flushWorkspaceAutosave = useCallback(async (filePath?: string) => {
    clearWorkspaceAutosaveTimer()

    if (workspaceAutosavePromiseRef.current) {
      await workspaceAutosavePromiseRef.current
    }

    const targetFilePath = filePath ?? workspaceAutosaveTargetRef.current?.filePath

    if (!targetFilePath) {
      return false
    }

    const targetTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceFileTab => (
        isWorkspaceAutosaveTab(tab)
        && tab.filePath === targetFilePath
        && tab.isDirty
      ),
    )

    if (!targetTab) {
      if (workspaceAutosaveTargetRef.current?.filePath === targetFilePath) {
        workspaceAutosaveTargetRef.current = null
      }

      return false
    }

    const savePromise = persistWorkspaceFileContent(targetTab.filePath, targetTab.content, {
      announce: false,
      syncMode: 'mark',
    })
    workspaceAutosavePromiseRef.current = savePromise

    try {
      await savePromise
      return true
    } finally {
      if (workspaceAutosavePromiseRef.current === savePromise) {
        workspaceAutosavePromiseRef.current = null
      }

      if (workspaceAutosaveTargetRef.current?.filePath === targetTab.filePath) {
        workspaceAutosaveTargetRef.current = null
      }
    }
  }, [clearWorkspaceAutosaveTimer, persistWorkspaceFileContent])

  async function confirmDiscardDirtyTabs(reason: 'close' | 'switch-workspace') {
    await flushWorkspaceAutosave()
    await flushDiffAutosave()
    try {
      await flushDirtyDiffTabs()
    } catch {
      // Keep dirty tabs visible and fall back to explicit discard confirmation.
    }

    const pendingDirtyTabs = getDirtyWorkspaceTabsSnapshot()

    if (pendingDirtyTabs.length === 0) {
      return true
    }

    const dirtyNames = pendingDirtyTabs
      .slice(0, 4)
      .map((tab) => getBaseName(tab.kind === 'diff' ? tab.diff.change.path : tab.filePath))
      .join(', ')
    const remainingCount = pendingDirtyTabs.length - Math.min(pendingDirtyTabs.length, 4)
    const extraLabel = remainingCount > 0 ? ` and ${remainingCount} more` : ''
    const actionLabel = reason === 'close'
      ? 'Closing them now will discard the unsaved changes.'
      : 'Switching workspaces now will discard the unsaved changes.'

    return await requestConfirm({
      title: 'Unsaved Changes',
      message: `${pendingDirtyTabs.length} tab${pendingDirtyTabs.length > 1 ? 's have' : ' has'} unsaved changes: ${dirtyNames}${extraLabel}.\n\n${actionLabel}`,
      confirmLabel: 'Discard Changes',
      isDanger: true,
    })
  }

  async function closeEditorTab(tabId: string, options: { force?: boolean, silent?: boolean } = {}) {
    if (tabId === displayActiveTabId) {
      captureActiveMeoViewPosition()
    }

    if (tabId === SETTINGS_TAB_ID) {
      setIsSettingsTabOpen(false)
      setIsSettingsTabActive(false)

      if (!options.silent) {
        setStatusMessage('Settings closed')
      }

      return true
    }

    const targetTab = openTabs.find((tab) => tab.id === tabId)

    if (!targetTab) {
      return false
    }

    if (isWorkspaceAutosaveTab(targetTab) && targetTab.isDirty) {
      await flushWorkspaceAutosave(targetTab.filePath)
    }

    const latestTargetTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.id === tabId) ?? targetTab

    if (latestTargetTab.kind === 'diff' && latestTargetTab.isDirty) {
      try {
        await flushDiffTab(latestTargetTab)
      } catch {
        // Leave the tab dirty so close confirmation can still protect the draft.
      }
    }

    const settledTargetTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.id === tabId) ?? latestTargetTab

    if (settledTargetTab.isDirty && !options.force) {
      const confirmed = await requestConfirm({
        title: 'Unsaved Changes',
        message: `"${getBaseName(settledTargetTab.kind === 'diff' ? settledTargetTab.diff.change.path : settledTargetTab.filePath)}" has unsaved changes.\n\nClose this tab and discard them?`,
        confirmLabel: 'Discard & Close',
        isDanger: true,
      })

      if (!confirmed) {
        return false
      }
    }

    closeTab(tabId)

    if (currentPath) {
      void syncPersistedActiveFile(currentPath)
    }

    if (!options.silent) {
      setStatusMessage(`${getBaseName(settledTargetTab.kind === 'diff' ? settledTargetTab.diff.change.path : settledTargetTab.filePath)} closed`)
    }

    return true
  }

  async function connectWorkspace(nextPath: string) {
    if (currentPath && normalizeFilePath(currentPath) === normalizeFilePath(nextPath)) {
      return
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()
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

  const openFile = useCallback(async (
    filePath: string,
    workspacePath: string | null = currentPath,
    preferredViewMode?: WorkspaceFileViewMode,
  ) => {
    captureActiveMeoViewPosition()
    setIsSettingsTabActive(false)

    const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)

    if (!editorKind) {
      toast.warning(`Cannot open ${getBaseName(filePath)} yet`, {
        description: 'Only text files can open in tabs right now. This file looks binary or unsupported.',
      })
      setStatusMessage(`${getBaseName(filePath)} is not supported yet`)
      return
    }

    try {
      const targetViewMode = resolveWorkspaceFileViewMode(filePath, editorKind, preferredViewMode)
      const existingTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => (
          tab.kind === 'file'
          && tab.filePath === filePath
          && tab.viewMode === targetViewMode
        ),
      )

      if (existingTab) {
        activateTab(existingTab.id)

        if (isLeftSidebarDrawer) {
          setIsLeftDrawerOpen(false)
        }

        if (workspacePath) {
          await updateWorkspaceState(workspacePath, { lastFilePath: filePath })
        }

        setStatusMessage(`${getBaseName(filePath)} focused`)
        return
      }

      const fileContent = await window.appApi.readWorkspaceFile(filePath)
      openTab({
        filePath,
        content: fileContent,
        editorKind,
        viewMode: targetViewMode,
      })
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

    if (isLeftSidebarDrawer) {
      setIsLeftDrawerOpen(false)
    }

    setStatusMessage(`${getBaseName(filePath)} opened`)
  }, [currentPath, activateTab, captureActiveMeoViewPosition, isLeftSidebarDrawer, openTab])

  const openAgentMessageFile = useCallback(async (
    filePath: string,
    changeKind: AgentMessageFileChangeKind,
  ) => {
    const existingFileTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.filePath === filePath,
    )

    if (existingFileTab) {
      captureActiveMeoViewPosition()
      setIsSettingsTabActive(false)
      activateTab(existingFileTab.id)

      if (isRightSidebarDrawer) {
        setIsRightDrawerOpen(false)
      }

      if (currentPath) {
        void window.appApi.updateWorkspaceState(currentPath, { lastFilePath: filePath })
      }

      setStatusMessage(`${getBaseName(filePath)} focused`)
      return
    }

    if (changeKind === 'deleted') {
      toast.warning(`Cannot reopen ${getBaseName(filePath)}`, {
        description: 'This file was deleted by the agent. Open tabs for it can still be focused if they already exist.',
      })
      setStatusMessage(`${getBaseName(filePath)} was deleted`)
      return
    }

    await openFile(filePath)

    if (isRightSidebarDrawer) {
      setIsRightDrawerOpen(false)
    }
  }, [activateTab, captureActiveMeoViewPosition, currentPath, isRightSidebarDrawer, openFile])

  async function openMeoGitDiff(
    change: GitChangeItem,
    diff: GitFileDiffResult,
    gitDiffRequest: WorkspaceFileGitDiffRequest,
  ) {
    const targetViewMode: WorkspaceFileViewMode = 'meo'
    const existingTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceFileTab => (
        tab.kind === 'file'
        && tab.filePath === change.path
        && tab.viewMode === targetViewMode
      ),
    )
    let fileContent = existingTab?.content ?? diff.modifiedContent
    let fileExists = existingTab?.exists ?? diff.modifiedExists

    if (!existingTab) {
      try {
        fileContent = await window.appApi.readWorkspaceFile(change.path)
        fileExists = true
      } catch {
        fileExists = diff.modifiedExists
      }
    }

    openTab({
      content: fileContent,
      editorKind: diff.editorKind,
      exists: fileExists,
      filePath: change.path,
      gitDiffRequest,
      viewMode: targetViewMode,
    })
    setIsSettingsTabActive(false)

    if (currentPath) {
      await updateWorkspaceState(currentPath, { lastFilePath: change.path })
    }

    if (isLeftSidebarDrawer) {
      setIsLeftDrawerOpen(false)
    }

    setStatusMessage(`${getBaseName(change.path)} diff opened`)
  }

  async function openGitDiff(
    change: GitChangeItem,
    options?: {
      lineNumber?: number
      mode?: WorkspaceFileGitDiffRequest['mode']
      source?: 'revision' | 'worktree'
    },
  ) {
    if (!currentPath) {
      return
    }

    captureActiveMeoViewPosition()

    try {
      const diff = await window.appApi.getGitFileDiff(currentPath, change.path, change.scope)
      const navigationSource = options?.source ?? 'worktree'

      if (!shouldOpenGitDiffForLine(diff, navigationSource, options?.lineNumber)) {
        return
      }

      if (supportsMeoEditor(change.path, diff.editorKind)) {
        await openMeoGitDiff(
          change,
          diff,
          createWorkspaceFileGitDiffRequest(
            change,
            navigationSource,
            options?.lineNumber,
            options?.mode ?? 'split',
          ),
        )
        return
      }

      const navigationRequest = typeof options?.lineNumber === 'number'
        ? {
          lineNumber: Math.max(1, Math.floor(options.lineNumber)),
          requestKey: `${change.scope}:${change.path}:${navigationSource}:${Date.now()}`,
          source: navigationSource,
        } satisfies WorkspaceDiffNavigationRequest
        : null
      openDiffTab(createDiffTab(change, change.scope, diff, navigationRequest))
      setIsSettingsTabActive(false)

      if (isLeftSidebarDrawer) {
        setIsLeftDrawerOpen(false)
      }

      setStatusMessage(`${getBaseName(change.path)} diff opened`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open the diff view.'
      toast.danger('Failed to open diff', {
        description: message,
      })
      setStatusMessage(message)
    }
  }

  async function openCurrentFileDiff() {
    if (!currentPath || !activeFileTab) {
      return
    }

    const latestGitState = await refreshGitState(currentPath, { silent: true })
    const nextChange = findGitChangeByFilePath(latestGitState, activeFileTab.filePath)

    if (!nextChange) {
      toast.warning('No Git diff for current file', {
        description: 'Save the file first, then make sure it is tracked or changed in this repository.',
      })
      setStatusMessage('Current file has no Git diff yet')
      return
    }

    await openGitDiff(nextChange)
  }

  async function restoreWorkspaceTabs(workspacePath: string, fallbackFilePath?: string | null) {
    const workspaceState = await getWorkspaceState(workspacePath)
    const storedState = readStoredTabState(workspacePath)
    const fallbackPath = fallbackFilePath ?? workspaceState.lastFilePath
    const candidateEntries = dedupeStoredEntries([
      ...(storedState.entries ?? []).map((entry) => ({
        path: entry.path,
        viewMode: entry.viewMode,
      })),
      ...(storedState.entries?.length
        ? []
        : storedState.paths.map((path) => ({ path }))),
      ...(fallbackPath ? [{ path: fallbackPath }] : []),
    ])

    if (candidateEntries.length === 0) {
      replaceTabs([], null)
      setIsSettingsTabActive(false)
      return
    }

    const settledTabs = await Promise.all(candidateEntries.map(async ({ path: filePath, viewMode }) => {
      const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)

      if (!editorKind) {
        return null
      }

      try {
        const content = await window.appApi.readWorkspaceFile(filePath)
        return toStoredWorkspaceTab(
          filePath,
          content,
          editorKind,
          resolveWorkspaceFileViewMode(filePath, editorKind, viewMode),
        )
      } catch {
        return null
      }
    }))
    const nextTabs = settledTabs.filter((tab): tab is WorkspaceFileTab => tab !== null)
    const requestedActiveId = storedState.activePath ?? fallbackPath ?? null
    const nextActiveId = nextTabs.some((tab) => tab.id === requestedActiveId || tab.filePath === requestedActiveId)
      ? nextTabs.find((tab) => tab.id === requestedActiveId || tab.filePath === requestedActiveId)?.id ?? null
      : nextTabs[0]?.id ?? null

    replaceTabs(nextTabs, nextActiveId)
    setIsSettingsTabActive(false)
    const nextActiveFileTab = nextTabs.find((tab) => tab.id === nextActiveId && tab.kind === 'file')
    await updateWorkspaceState(workspacePath, { lastFilePath: nextActiveFileTab?.filePath ?? null })
  }

  async function handlePickWorkspace() {
    if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return
    }

    setIsPickingWorkspace(true)
    try {
      const nextPath = await window.appApi.pickWorkspace()
      if (nextPath) {
        if (currentPath && normalizeFilePath(currentPath) === normalizeFilePath(nextPath)) {
          setStatusMessage('Workspace already open')
          return
        }

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
      await performWorkspaceRefresh(currentPath, {
        refreshGit: true,
        refreshTree: true,
      })
      await openFile(filePath)
      setStatusMessage(`${nextRelativePath} created`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create file.'
      setStatusMessage(message)
    } finally {
      setIsCreatingFile(false)
    }
  }

  async function handleCreateDirectory() {
    if (!currentPath) {
      return
    }

    const nextRelativePath = getNextUntitledDirectoryName(rootDirNames)

    try {
      setIsCreatingDirectory(true)
      await window.appApi.createWorkspaceDirectory(currentPath, nextRelativePath)
      await performWorkspaceRefresh(currentPath, {
        refreshTree: true,
      })
      setStatusMessage(`${nextRelativePath} created`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create directory.'
      setStatusMessage(message)
    } finally {
      setIsCreatingDirectory(false)
    }
  }

  function handleToggleFileTreeExpansion() {
    if (expandedPaths.size > 0) {
      setExpandedPaths(new Set())
      setStatusMessage('All folders collapsed')
    } else {
      const allDirs = new Set<string>()
      const collect = (items: WorkspaceNode[]) => {
        for (const node of items) {
          if (node.kind === 'directory') {
            allDirs.add(node.path)
            if (node.children) collect(node.children)
          }
        }
      }
      collect(tree)
      setExpandedPaths(allDirs)
      setStatusMessage('All folders expanded')
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

  async function handleSelectAppIcon(nextAppIconId: string) {
    if (appIconId === nextAppIconId) {
      return
    }

    try {
      setIsApplyingAppIcon(true)
      const appliedAppIconId = await window.appApi.setAppIconSelection(nextAppIconId)
      setAppIconId(appliedAppIconId)
      const selectedOption = appIconOptions.find((option) => option.id === appliedAppIconId)
      setStatusMessage(selectedOption
        ? `应用图标已切换为 ${selectedOption.label}`
        : '应用图标已更新')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to switch the app icon.'
      setStatusMessage(message)
    } finally {
      setIsApplyingAppIcon(false)
    }
  }

  function openSettings(section: SettingsSectionId) {
    setSettingsSection(section)
    setIsSettingsTabOpen(true)
    setIsSettingsTabActive(true)
  }

  async function handleMoveWorkspaceNode(node: WorkspaceNode, nextRelativePath: string, successMessage: string) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    if (!(await ensureWorkspaceTabsSavedBeforeNodeMutation({
      actionLabel: `moving ${node.kind === 'directory' ? 'this folder' : 'this file'}`,
      nodePath: node.path,
    }))) {
      return
    }

    const { filePath: nextFilePath } = await window.appApi.moveWorkspaceEntry(currentPath, node.path, nextRelativePath)
    await performWorkspaceRefresh(currentPath, {
      refreshGit: true,
      refreshTree: true,
    })
    updateOpenTabsForMovedNode(node.path, nextFilePath)
    rebaseExpandedTreePaths(node.path, nextFilePath)
    await syncPersistedActiveFile(currentPath)
    setStatusMessage(successMessage)
  }

  async function handleRenameNode(node: WorkspaceNode, nextName: string) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    const trimmedName = nextName.trim()
    if (!trimmedName) {
      throw new Error(`${node.kind === 'directory' ? 'Folder' : 'File'} name is required.`)
    }

    const currentBaseName = getBaseName(node.path)
    const currentExtensionMatch = currentBaseName.match(/(\.[^./\\]+)$/)
    const nextBaseName = node.kind === 'file' && currentExtensionMatch && !/\.[^./\\]+$/.test(trimmedName)
      ? `${trimmedName}${currentExtensionMatch[1]}`
      : trimmedName
    const parentDirectory = getDirectoryRelativePath(currentPath, node.path)
    const nextRelativePath = parentDirectory ? `${parentDirectory}/${nextBaseName}` : nextBaseName

    await handleMoveWorkspaceNode(node, nextRelativePath, `${nextBaseName} renamed`)
  }

  async function handleMoveNode(node: WorkspaceNode, targetDirectoryPath: string) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    const targetRelativePath = getRelativePath(currentPath, targetDirectoryPath)
    const nextRelativePath = targetRelativePath ? `${targetRelativePath}/${node.name}` : node.name

    await handleMoveWorkspaceNode(node, nextRelativePath, `${node.name} moved`)
  }

  async function handleDeleteNode(node: WorkspaceNode) {
    if (!currentPath) {
      throw new Error('Open a workspace first.')
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()

    const dirtyDiffPaths = Array.from(new Set(
      getDirtyWorkspaceTabsForNodePath(node.path)
        .filter((tab): tab is WorkspaceDiffTab => tab.kind === 'diff')
        .map((tab) => tab.diff.change.path),
    ))

    try {
      await flushDirtyDiffTabs(dirtyDiffPaths)
    } catch {
      // Fall back to explicit discard confirmation below.
    }

    const hasDirtyTabs = getDirtyWorkspaceTabsForNodePath(node.path).length > 0

    if (hasDirtyTabs) {
      const targetLabel = node.kind === 'directory'
        ? `"${node.name}" contains unsaved editor tabs.\n\nDelete the folder and discard those changes?`
        : `"${node.name}" has unsaved changes in an editor tab.\n\nDelete the file and discard those changes?`
      const confirmed = await requestConfirm({
        title: node.kind === 'directory' ? 'Delete Folder' : 'Delete File',
        message: targetLabel,
        confirmLabel: 'Delete',
        isDanger: true,
      })

      if (!confirmed) {
        return
      }
    }

    await window.appApi.deleteWorkspaceFile(currentPath, node.path)
    await performWorkspaceRefresh(currentPath, {
      refreshGit: true,
      refreshTree: true,
    })
    closeTabsForNode(node.path)
    await syncPersistedActiveFile(currentPath)
    setStatusMessage(`${node.name} deleted`)
  }

  async function handleSave(options: { content?: string, filePath?: string, announce?: boolean } = {}) {
    const targetFilePath = options.filePath ?? currentFilePath

    if (!targetFilePath || isActiveEditorComposing) {
      return
    }

    const targetContent = options.content
      ?? (
        targetFilePath === currentFilePath
          ? currentFileContent
          : useWorkspaceStore.getState().openTabs.find(
            (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.filePath === targetFilePath,
          )?.content
      )

    if (typeof targetContent !== 'string') {
      return
    }

    await persistWorkspaceFileContent(targetFilePath, targetContent, {
      announce: options.announce ?? true,
      syncMode: 'mark',
    })
  }

  async function handleSaveDiffFile(filePath: string, content: string, options: { announce?: boolean } = {}) {
    const targetDiffTab = useWorkspaceStore.getState().openTabs.find(
      (tab): tab is WorkspaceDiffTab => (
        tab.kind === 'diff'
        && tab.diff.change.path === filePath
        && tab.isDirty
      ),
    ) ?? activeDiffTab

    if (!targetDiffTab) {
      await persistWorkspaceFileContent(filePath, content, {
        announce: options.announce ?? false,
        syncMode: 'sync',
      })
      return
    }

    await persistDiffTabContent(targetDiffTab.id, filePath, content, {
      announce: options.announce ?? false,
    })
  }

  async function handleSaveActiveTab() {
    if (activeDiffTab) {
      if (!activeDiffTab.isDirty || isActiveEditorComposing) {
        return
      }

      const targetDiffTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceDiffTab => tab.kind === 'diff' && tab.id === activeDiffTab.id,
      ) ?? activeDiffTab

      await flushDiffTab(targetDiffTab, { announce: true })
      return
    }

    await handleSave()
  }

  async function handleApplyGitDiffSelection(
    change: GitChangeItem,
    selection: GitDiffSelection,
    action: GitDiffBlockAction,
  ) {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: action === 'stage'
        ? 'staging this diff block'
        : action === 'unstage'
          ? 'unstaging this diff block'
          : 'discarding this diff block',
      filePaths: [change.path],
    }))) {
      return
    }

    const statusMessage = action === 'stage'
      ? 'Git block staged'
      : action === 'unstage'
        ? 'Git block unstaged'
        : 'Git block reverted'
    const busyLabel = action === 'stage'
      ? 'Staging diff block...'
      : action === 'unstage'
        ? 'Unstaging diff block...'
        : 'Reverting diff block...'

    await runGitAction(busyLabel, async () => {
      const nextState = await window.appApi.applyGitDiffSelection(currentPath, change.path, change.scope, selection, action)
      setGitRepositoryState(nextState)

      if (action === 'discard') {
        await loadTree(currentPath)

        try {
          const nextContent = await window.appApi.readWorkspaceFile(change.path)
          syncFileTabsWithDisk(change.path, nextContent)
        } catch {
          closeFileTabsForPath(change.path)
        }
      }

      await syncOpenDiffTabs(currentPath)
      setStatusMessage(statusMessage)
    })
  }

  function activateFileTab(tabId: string) {
    if (tabId !== displayActiveTabId) {
      captureActiveMeoViewPosition()
    }

    if (tabId === SETTINGS_TAB_ID) {
      setIsSettingsTabOpen(true)
      setIsSettingsTabActive(true)
      return
    }

    setIsSettingsTabActive(false)
    activateTab(tabId)

    const targetTab = displayTabs.find((tab) => tab.id === tabId)

    if (currentPath && targetTab?.kind === 'file') {
      void updateWorkspaceState(currentPath, { lastFilePath: targetTab.filePath })
    }
  }

  function cycleTabs(direction: 1 | -1) {
    if (displayTabs.length < 2 || !displayActiveTabId) {
      return
    }

    const currentIndex = displayTabs.findIndex((tab) => tab.id === displayActiveTabId)
    if (currentIndex === -1) {
      return
    }

    const nextIndex = (currentIndex + direction + displayTabs.length) % displayTabs.length
    const nextTab = displayTabs[nextIndex]

    activateFileTab(nextTab.id)
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

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: 'staging changes',
      filePaths,
    }))) {
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

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: 'discarding Git changes',
      filePaths: [change.path],
    }))) {
      return
    }

    const confirmed = await requestConfirm({
      title: 'Discard Change',
      message: `Discard the current ${change.scope} change for "${change.relativePath}"?`,
      confirmLabel: 'Discard',
      isDanger: true,
    })

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

  async function handleDiscardGitChanges(changes: GitChangeItem[]) {
    if (!currentPath || changes.length === 0) {
      return
    }

    if (changes.length === 1) {
      await handleDiscardGitChange(changes[0])
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: 'discarding Git changes',
      filePaths: changes.map((change) => change.path),
    }))) {
      return
    }

    const confirmed = await requestConfirm({
      title: 'Discard Changes',
      message: `Discard ${changes.length} working tree changes?`,
      confirmLabel: 'Discard All',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction('Discarding changes...', async () => {
      await Promise.all(changes.map(async (change) => {
        await window.appApi.discardGitChange(currentPath, change)
      }))
      await performWorkspaceRefresh(currentPath, {
        refreshGit: true,
        refreshTree: true,
      })
      setStatusMessage(`${changes.length} changes discarded`)
    })
  }

  async function handleCommitGitChanges() {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: 'creating a commit',
    }))) {
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

  async function handleCommitAndSyncGitChanges() {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: 'committing and syncing',
    }))) {
      return
    }

    await runGitAction('Committing and syncing...', async () => {
      const nextState = await window.appApi.commitAndSyncGitChanges(currentPath, gitCommitMessage)
      setGitRepositoryState(nextState)
      setGitCommitMessage('')
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Commit and sync completed')
    })
  }

  async function handlePushGitChanges() {
    if (!currentPath) {
      return
    }

    await runGitAction('Pushing changes...', async () => {
      const nextState = await window.appApi.pushGitChanges(currentPath)
      setGitRepositoryState(nextState)
      setStatusMessage('Git changes pushed')
    })
  }

  async function handlePullGitChanges() {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: 'pulling Git changes',
    }))) {
      return
    }

    await runGitAction('Pulling changes...', async () => {
      const nextState = await window.appApi.pullGitChanges(currentPath)
      setGitRepositoryState(nextState)
      await loadTree(currentPath)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Git changes pulled')
    })
  }

  async function handleDiscardAllGitChanges() {
    if (!currentPath || !gitRepositoryState?.unstagedChanges.length) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: 'discarding all Git changes',
      filePaths: gitRepositoryState.unstagedChanges.map((change) => change.path),
    }))) {
      return
    }

    const confirmed = await requestConfirm({
      title: 'Discard All Changes',
      message: 'Discard all working tree changes?\n\nThis will revert tracked files and delete untracked files.',
      confirmLabel: 'Discard All',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction('Discarding all working tree changes...', async () => {
      const nextState = await window.appApi.discardAllGitChanges(currentPath)
      setGitRepositoryState(nextState)
      await loadTree(currentPath)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Working tree changes discarded')
    })
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [
          persistedIconTheme,
          persistedIconThemeOptions,
          persistedAppIconId,
          persistedAppIconOptions,
        ] = await Promise.all([
          window.appApi.getWorkspaceIconTheme(),
          window.appApi.getWorkspaceIconThemeCatalog(),
          window.appApi.getAppIconSelection(),
          window.appApi.getAppIconCatalog(),
        ])
        if (!cancelled) {
          setIconTheme(persistedIconTheme)
          setIconThemeOptions(persistedIconThemeOptions)
          setAppIconId(persistedAppIconId)
          setAppIconOptions(persistedAppIconOptions)
        }
      } catch {
        if (!cancelled) {
          setIconTheme(null)
          setIconThemeOptions([])
          setAppIconId(null)
          setAppIconOptions([])
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
    return () => {
      workspaceRefreshCoordinatorRef.current?.dispose()
    }
  }, [])

  useEffect(() => {
    if (!currentPath || isImportingIconTheme || isApplyingIconTheme || iconThemeOptions.length === 0) {
      return
    }

    if (lastIconThemeLinkedThemeRef.current === resolvedTheme) {
      return
    }

    const targetOption = getThemeLinkedWorkspaceIconOption(resolvedTheme, iconThemeOptions)

    if (!targetOption) {
      lastIconThemeLinkedThemeRef.current = resolvedTheme
      return
    }

    if (
      iconTheme?.activeThemeId === targetOption.themeId
      && iconTheme.sourceVsixPath === targetOption.sourceVsixPath
    ) {
      lastIconThemeLinkedThemeRef.current = resolvedTheme
      return
    }

    const requestId = iconThemeLinkRequestRef.current + 1
    iconThemeLinkRequestRef.current = requestId
    lastIconThemeLinkedThemeRef.current = resolvedTheme

    // Let the lightweight color theme repaint before importing the heavier icon theme.
    const timerId = window.setTimeout(() => {
      setIsApplyingIconTheme(true)

      void (async () => {
        try {
          const nextIconTheme = await window.appApi.setWorkspaceIconTheme({
            sourceVsixPath: targetOption.sourceVsixPath,
            themeId: targetOption.themeId,
          })

          if (iconThemeLinkRequestRef.current !== requestId || !nextIconTheme) {
            return
          }

          const nextIconThemeOptions = await window.appApi.getWorkspaceIconThemeCatalog()

          if (iconThemeLinkRequestRef.current !== requestId) {
            return
          }

          setIconTheme(nextIconTheme)
          setIconThemeOptions(nextIconThemeOptions)
          setStatusMessage(`${nextIconTheme.extensionLabel}: ${nextIconTheme.activeThemeLabel}`)
        } catch (error) {
          if (iconThemeLinkRequestRef.current === requestId) {
            const message = error instanceof Error ? error.message : 'Unable to switch the icon theme.'
            setStatusMessage(message)
          }
        } finally {
          if (iconThemeLinkRequestRef.current === requestId) {
            setIsApplyingIconTheme(false)
          }
        }
      })()
    }, THEME_LINKED_ICON_SWITCH_DELAY_MS)

    return () => window.clearTimeout(timerId)
  }, [
    currentPath,
    iconTheme,
    iconThemeOptions,
    isApplyingIconTheme,
    isImportingIconTheme,
    resolvedTheme,
  ])

  useEffect(() => {
    setIsActiveEditorComposing(false)
  }, [currentEditorKind, currentFilePath, currentFileViewMode])

  useEffect(() => {
    if (!appIconId) {
      return
    }

    const selectedOption = appIconOptions.find((option) => option.id === appIconId)

    if (!selectedOption) {
      return
    }

    const iconLink = document.querySelector<HTMLLinkElement>("link[rel='icon']")

    if (iconLink) {
      iconLink.href = selectedOption.previewSrc
    }
  }, [appIconId, appIconOptions])

  useEffect(() => {
    const previousPath = previousWorkspaceAutosavePathRef.current
    const nextPath = activeWorkspaceAutosaveTab?.filePath ?? null

    if (previousPath && previousPath !== nextPath) {
      const previousTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => isWorkspaceAutosaveTab(tab) && tab.filePath === previousPath,
      )

      if (previousTab?.isDirty) {
        void flushWorkspaceAutosave(previousPath)
      }
    }

    previousWorkspaceAutosavePathRef.current = nextPath
  }, [activeWorkspaceAutosaveTab?.filePath, flushWorkspaceAutosave])

  useEffect(() => {
    const previousTabId = previousActiveDiffTabIdRef.current
    const nextTabId = activeDiffTab?.id ?? null

    if (previousTabId && previousTabId !== nextTabId) {
      const previousDiffTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceDiffTab => tab.kind === 'diff' && tab.id === previousTabId,
      )

      if (previousDiffTab?.isDirty) {
        void flushDiffAutosave(previousDiffTab.id)
      }
    }

    previousActiveDiffTabIdRef.current = nextTabId
  }, [activeDiffTab?.id, flushDiffAutosave])

  useEffect(() => {
    clearDiffAutosaveTimer()

    if (
      !activeDiffTab?.isDirty
      || activeDiffTab.diff.change.scope !== 'unstaged'
      || !activeDiffTab.diff.modifiedExists
      || isActiveEditorComposing
      || activeDiffHasDirtyRelatedFileTab
    ) {
      if (!activeDiffTab) {
        diffAutosaveTargetRef.current = null
      }
      return
    }

    diffAutosaveTargetRef.current = {
      tabId: activeDiffTab.id,
    }
    diffAutosaveTimerRef.current = setTimeout(() => {
      void flushDiffAutosave(activeDiffTab.id)
    }, WORKSPACE_AUTO_SAVE_DELAY_MS)

    return clearDiffAutosaveTimer
  }, [
    activeDiffTab?.diff.change.path,
    activeDiffTab?.diff.change.scope,
    activeDiffTab?.diff.modifiedContent,
    activeDiffTab?.diff.modifiedExists,
    activeDiffTab?.draftContent,
    activeDiffTab?.id,
    activeDiffTab?.isDirty,
    activeDiffHasDirtyRelatedFileTab,
    clearDiffAutosaveTimer,
    flushDiffAutosave,
    isActiveEditorComposing,
  ])

  useEffect(() => {
    clearWorkspaceAutosaveTimer()

    if (!activeWorkspaceAutosaveTab?.isDirty || isActiveEditorComposing) {
      if (!activeWorkspaceAutosaveTab) {
        workspaceAutosaveTargetRef.current = null
      }
      return
    }

    workspaceAutosaveTargetRef.current = {
      content: activeWorkspaceAutosaveTab.content,
      filePath: activeWorkspaceAutosaveTab.filePath,
    }
    workspaceAutosaveTimerRef.current = setTimeout(() => {
      void flushWorkspaceAutosave(activeWorkspaceAutosaveTab.filePath)
    }, WORKSPACE_AUTO_SAVE_DELAY_MS)

    return clearWorkspaceAutosaveTimer
  }, [
    activeWorkspaceAutosaveTab?.content,
    activeWorkspaceAutosaveTab?.filePath,
    activeWorkspaceAutosaveTab?.isDirty,
    clearWorkspaceAutosaveTimer,
    flushWorkspaceAutosave,
    isActiveEditorComposing,
  ])

  useEffect(() => () => {
    clearWorkspaceAutosaveTimer()
    clearDiffAutosaveTimer()
    void flushWorkspaceAutosave()
    void flushDiffAutosave()
    internalWorkspaceSaveTimersRef.current.forEach((timer) => {
      clearTimeout(timer)
    })
    internalWorkspaceSaveTimersRef.current.clear()
    internalWorkspaceSavePathsRef.current.clear()
  }, [clearDiffAutosaveTimer, clearWorkspaceAutosaveTimer, flushDiffAutosave, flushWorkspaceAutosave])

  useEffect(() => {
    const unsubscribe = window.appApi.onWorkspaceChanged(async (event) => {
      if (!currentPath || event.rootPath !== currentPath) {
        return
      }

      if ((event.type === 'add' || event.type === 'change') && consumeInternalWorkspaceSave(event.path)) {
        return
      }

      const isGitMetadataChange = normalizeFilePath(event.path).endsWith('/.git/index')

      void requestWorkspaceRefresh({
        refreshGit: true,
        refreshTree: !isGitMetadataChange,
        rootPath: currentPath,
      }, 'debounced').catch(() => {
        // The workspace may have changed before the debounced refresh executes.
      })

      const affectedTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.kind === 'file' && tab.filePath === event.path)

      if (!affectedTab) {
        return
      }

      if (event.type === 'unlink') {
        if (affectedTab.isDirty) {
          markFileTabsMissing(event.path)
          setStatusMessage(`${getBaseName(event.path)} was removed externally. Save to recreate it.`)
          return
        }

        closeFileTabsForPath(event.path)
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
        syncFileTabsWithDisk(event.path, updatedContent)
        setStatusMessage(`${getBaseName(event.path)} reloaded`)
        return
      }

      if (event.type === 'change') {
        if (affectedTab.isDirty) {
          setStatusMessage(`${getBaseName(event.path)} changed on disk. Kept your unsaved version.`)
          return
        }

        const updatedContent = await window.appApi.readWorkspaceFile(event.path)
        syncFileTabsWithDisk(event.path, updatedContent)
        setStatusMessage('Synced with external edits')
      }
    })

    return unsubscribe
  }, [consumeInternalWorkspaceSave, currentPath, markFileTabsMissing, requestWorkspaceRefresh, syncFileTabsWithDisk])

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

      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsCommandPaletteOpen((prev) => !prev)
      }
    };

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [platform])

  useEffect(() => {
    if (!currentPath) {
      return
    }

    const storedEntries = openTabs
      .filter((tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.exists)
      .map((tab) => ({
        path: tab.filePath,
        viewMode: tab.viewMode,
      }))

    window.localStorage.setItem(getTabStorageKey(currentPath), JSON.stringify({
      activePath: useWorkspaceStore.getState().activeTabId,
      entries: storedEntries,
      paths: storedEntries.map((entry) => entry.path),
    } satisfies StoredTabState))
  }, [activeTabId, currentPath, openTabs])

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
  }, [activeResizePanel, isLeftSidebarVisible, isRightSidebarVisible, leftSidebarWidth, rightSidebarWidth])

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
    function syncShellWidth() {
      const nextShellWidth = getShellWidth()
      setShellWidth((currentWidth) => (
        currentWidth === nextShellWidth ? currentWidth : nextShellWidth
      ))
    }

    syncShellWidth()

    const shell = appShellRef.current
    const resizeObserver = typeof ResizeObserver !== 'undefined' && shell
      ? new ResizeObserver(() => {
        syncShellWidth()
      })
      : null

    if (shell && resizeObserver) {
      resizeObserver.observe(shell)
    }

    window.addEventListener('resize', syncShellWidth)

    return () => {
      resizeObserver?.disconnect()
      window.removeEventListener('resize', syncShellWidth)
    }
  }, [])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEYS.leftSidebarWidth, String(leftSidebarWidth))
  }, [leftSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEYS.rightSidebarWidth, String(rightSidebarWidth))
  }, [rightSidebarWidth])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEYS.gitPanelHeight, String(gitPanelHeight))
  }, [gitPanelHeight])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEYS.gitPanelLayout, gitPanelLayout)
  }, [gitPanelLayout])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEYS.activeLeftSidebarTab, activeLeftSidebarTab)
  }, [activeLeftSidebarTab])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEYS.leftSidebarCollapsed, String(isLeftSidebarCollapsed))
  }, [isLeftSidebarCollapsed])

  useEffect(() => {
    window.localStorage.setItem(LAYOUT_STORAGE_KEYS.rightSidebarCollapsed, String(isRightSidebarCollapsed))
  }, [isRightSidebarCollapsed])

  useEffect(() => {
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
  }, [effectiveRightSidebarWidth, isLeftSidebarVisible, isRightSidebarVisible, leftSidebarWidth, rightSidebarWidth, shellWidth])

  useEffect(() => {
    setGitPanelHeight((currentValue) => clampGitHeight(currentValue))
  }, [leftSidebarWidth, isLeftSidebarVisible])

  useEffect(() => {
    if (!isLeftSidebarDrawer && isLeftDrawerOpen) {
      setIsLeftDrawerOpen(false)
    }

    if (!isRightSidebarDrawer && isRightDrawerOpen) {
      setIsRightDrawerOpen(false)
    }
  }, [isLeftDrawerOpen, isLeftSidebarDrawer, isRightDrawerOpen, isRightSidebarDrawer])

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
        if (isSettingsTabActive) {
          closeEditorTab(SETTINGS_TAB_ID)
          return
        }

        if (displayActiveTabId) {
          closeEditorTab(displayActiveTabId)
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
  }, [closeEditorTab, cycleTabs, displayActiveTabId, handleSaveActiveTab, isSettingsTabActive])

  useEffect(() => {
    if (!isLeftSidebarVisible && activeResizePanel === 'left') {
      setActiveResizePanel(null)
    }

    if (!isRightSidebarVisible && activeResizePanel === 'right') {
      setActiveResizePanel(null)
    }
  }, [activeResizePanel, isLeftSidebarVisible, isRightSidebarVisible])

  const commandPaletteActions = useMemo(() => [
    {
      label: 'Open Settings',
      icon: 'lucide:settings',
      onSelect: () => setIsSettingsOpen(true)
    },
    {
      label: 'Create New File',
      icon: 'lucide:file-plus',
      onSelect: () => handleCreateFile()
    },
    {
      label: 'Create New Folder',
      icon: 'lucide:folder-plus',
      onSelect: () => handleCreateDirectory()
    },
    {
      label: 'Switch Workspace',
      icon: 'mingcute:transfer-4-line',
      onSelect: () => handlePickWorkspace()
    }
  ], [handleCreateFile, handleCreateDirectory, handlePickWorkspace])

  const handleOpenSession = useCallback((sessionPath: string) => {
    if (currentPath) {
      void window.appApi.openAgentSession(currentPath, sessionPath)
    }
  }, [currentPath])

  const handleCloseCommandPalette = useCallback(() => setIsCommandPaletteOpen(false), [])
  const handleLeftDrawerOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setIsRightDrawerOpen(false)
    }

    setIsLeftDrawerOpen(isOpen)
  }, [])
  const handleRightDrawerOpenChange = useCallback((isOpen: boolean) => {
    if (isOpen) {
      setIsLeftDrawerOpen(false)
    }

    setIsRightDrawerOpen(isOpen)
  }, [])
  useEffect(() => {
    const openDrawerSide = isLeftDrawerOpen ? 'left' : isRightDrawerOpen ? 'right' : null

    if (!openDrawerSide) {
      return
    }

    let cancelled = false
    let rafId = 0
    let frameCount = 0
    let stableFrameCount = 0
    let previousRectSignature = ''

    // Fixed chrome elements sit outside the drawer tree, so we invalidate once
    // immediately when the drawer mounts. That keeps the top controls clickable
    // while the slide animation is still in flight.
    void window.appApi.refreshWindowInteractionRegions('soft').catch(() => {})

    const getDrawerSurface = () => (
      openDrawerSide === 'left'
        ? leftDrawerSurfaceRef.current
        : rightDrawerSurfaceRef.current
    )

    const tick = () => {
      if (cancelled) {
        return
      }

      frameCount += 1

      const drawerSurface = getDrawerSurface()
      if (!drawerSurface) {
        if (frameCount < DRAWER_INTERACTION_REFRESH_MAX_FRAMES) {
          rafId = window.requestAnimationFrame(tick)
        }
        return
      }

      const rect = drawerSurface.getBoundingClientRect()
      const rectSignature = [
        Math.round(rect.x * 10) / 10,
        Math.round(rect.y * 10) / 10,
        Math.round(rect.width * 10) / 10,
        Math.round(rect.height * 10) / 10,
      ].join(':')

      stableFrameCount = rectSignature === previousRectSignature ? stableFrameCount + 1 : 0
      previousRectSignature = rectSignature

      if (
        stableFrameCount >= DRAWER_INTERACTION_REFRESH_STABLE_FRAMES
        || frameCount >= DRAWER_INTERACTION_REFRESH_MAX_FRAMES
      ) {
        // Electron frameless hit-testing can lag behind drawer transforms until the
        // animated bounds settle. Refreshing once here preserves clickability without
        // nudging the window during the active slide animation.
        void window.appApi.refreshWindowInteractionRegions('hard').catch(() => {})
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
    }
  }, [isLeftDrawerOpen, isRightDrawerOpen])
  useEffect(() => {
    if (!isLeftDrawerOpen && !isRightDrawerOpen) {
      return
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') {
        return
      }

      if (isRightDrawerOpen) {
        handleRightDrawerOpenChange(false)
        return
      }

      if (isLeftDrawerOpen) {
        handleLeftDrawerOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleWindowKeyDown)

    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown)
    }
  }, [handleLeftDrawerOpenChange, handleRightDrawerOpenChange, isLeftDrawerOpen, isRightDrawerOpen])
  const toggleAssistantSurface = useCallback(() => {
    if (isRightSidebarDrawer) {
      handleRightDrawerOpenChange(!isRightDrawerOpen)
      return
    }

    setIsRightSidebarCollapsed((currentValue) => !currentValue)
  }, [handleRightDrawerOpenChange, isRightDrawerOpen, isRightSidebarDrawer])

  function renderWorkspaceSidebar(surfaceMode: PanelSurfaceMode) {
    const isDrawerSurface = surfaceMode === 'drawer'
    const closeWorkspaceSurface = () => {
      if (isDrawerSurface) {
        setIsLeftDrawerOpen(false)
        return
      }

      setIsLeftSidebarCollapsed(true)
    }

    return (
      <div
        ref={isDrawerSurface ? leftDrawerSurfaceRef : undefined}
        className={`workspace-sidebar-surface${isDrawerSurface ? ' is-drawer' : ''}`}
        data-platform={shellPlatform}
        style={isDrawerSurface ? shellChromeVars : undefined}
      >
        <div className={`section-title workspace-section-title${isDrawerSurface ? ' is-drawer-surface' : ''}`}>
          {!isDrawerSurface ? (
            <button
              type='button'
              className='panel-toggle-button workspace-section-toggle workspace-toggle-brand-button'
              aria-label='Collapse workspace sidebar'
              onClick={closeWorkspaceSurface}
            >
              <span className='panel-toggle-icon workspace-toggle-brand-icon' aria-hidden='true'>
                <img className='workspace-toggle-brand-logo' src='/branding/logo_xl.svg' alt='' draggable='false' />
                <span className='workspace-toggle-brand-glyph'>
                  <LayoutLeftLine size={16} />
                </span>
              </span>
            </button>
          ) : null}
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
          </button>

          <div className='section-title-drag-spacer' aria-hidden='true' />
        </div>

        <div ref={isDrawerSurface ? undefined : leftSidebarBodyRef} className='sidebar-stack'>
          <div className='sidebar-vertical-tabs'>
            <button
              type='button'
              className={`sidebar-vertical-tab${activeLeftSidebarTab === 'file' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveLeftSidebarTab('file')
              }}
            >
              <FileLine size={16} className='sidebar-vertical-tab-icon' />
              <span className='sidebar-vertical-tab-label'>文件</span>
            </button>
            <button
              type='button'
              className={`sidebar-vertical-tab${activeLeftSidebarTab === 'git' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveLeftSidebarTab('git')
              }}
            >
              <GitCompareLine size={16} className='sidebar-vertical-tab-icon' />
              <span className='sidebar-vertical-tab-label'>Git</span>
            </button>
            <button
              type='button'
              className='sidebar-vertical-tab'
              onClick={() => {
                setIsCommandPaletteOpen(true)

                if (isDrawerSurface) {
                  setIsLeftDrawerOpen(false)
                }
              }}
            >
              <Icon icon='lucide:search' width={16} height={16} className='sidebar-vertical-tab-icon' />
              <span className='sidebar-vertical-tab-label'>搜索</span>
            </button>
          </div>

          {activeLeftSidebarTab === 'file' ? (
            <div className='sidebar-stack-pane sidebar-tree-pane'>
              <div className='file-panel-header'>
                <span className='file-panel-title'>文件树</span>
                <div className='file-panel-actions'>
                  <Tooltip closeDelay={0}>
                    <Tooltip.Trigger>
                      <button
                        type='button'
                        className='file-panel-action'
                        onClick={() => void handleCreateFile()}
                        disabled={!currentPath || isCreatingFile}
                        aria-label='Create File'
                      >
                        <Icon icon='lucide:file-plus' width={16} height={16} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Create File</Tooltip.Content>
                  </Tooltip>
                  <Tooltip closeDelay={0}>
                    <Tooltip.Trigger>
                      <button
                        type='button'
                        className='file-panel-action'
                        onClick={() => void handleCreateDirectory()}
                        disabled={!currentPath || isCreatingDirectory}
                        aria-label='Create Folder'
                      >
                        <Icon icon='lucide:folder-plus' width={16} height={16} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Create Folder</Tooltip.Content>
                  </Tooltip>
                  <Tooltip closeDelay={0}>
                    <Tooltip.Trigger>
                      <button
                        type='button'
                        className='file-panel-action'
                        onClick={handleToggleFileTreeExpansion}
                        disabled={!currentPath || tree.length === 0}
                        aria-label='Toggle Expansion'
                      >
                        <Icon
                          icon={expandedPaths.size > 0 ? 'lucide:fold-vertical' : 'lucide:unfold-vertical'}
                          width={16}
                          height={16}
                        />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>{expandedPaths.size > 0 ? 'Collapse All' : 'Expand All'}</Tooltip.Content>
                  </Tooltip>
                </div>
              </div>

              <AppScrollArea
                className='tree-scroll'
                contentClassName='tree-scroll-content'
              >
                <WorkspaceTree
                  activeFilePath={activeTreePath}
                  iconTheme={iconTheme}
                  nodes={tree}
                  expandedPaths={expandedPaths}
                  setExpandedPaths={setExpandedPaths}
                  workspacePath={currentPath}
                  gitRepositoryState={gitRepositoryState}
                  onSelectFile={(filePath) => {
                    void openFile(filePath)
                  }}
                  onOpenInWritingEditor={(filePath) => {
                    void openFile(filePath, currentPath, 'default')
                  }}
                  onOpenInCodeEditor={(filePath) => {
                    void openFile(filePath, currentPath, 'code')
                  }}
                  onOpenInMeoEditor={(filePath) => {
                    void openFile(filePath, currentPath, 'meo')
                  }}
                  onRenameNode={(node, nextName) => handleRenameNode(node, nextName)}
                  onDeleteNode={(node) => handleDeleteNode(node)}
                  onMoveNode={(node, targetDirectoryPath) => handleMoveNode(node, targetDirectoryPath)}
                />
              </AppScrollArea>
            </div>
          ) : (
            <div className='sidebar-stack-pane sidebar-git-pane' id='git-panel'>
              <GitPanel
                busyLabel={gitBusyLabel}
                commitMessage={gitCommitMessage}
                isLoading={isGitLoading}
                layout={gitPanelLayout}
                onCommit={() => {
                  void handleCommitGitChanges()
                }}
                onCommitAndSync={() => {
                  void handleCommitAndSyncGitChanges()
                }}
                onCommitMessageChange={setGitCommitMessage}
                onDiscardAll={() => {
                  void handleDiscardAllGitChanges()
                }}
                onDiscardMany={(changes) => {
                  void handleDiscardGitChanges(changes)
                }}
                onInitialize={() => {
                  void handleInitializeGit()
                }}
                onLayoutChange={setGitPanelLayout}
                onOpenFile={(filePath) => {
                  void openFile(filePath)
                }}
                onOpenDiff={(change) => {
                  void openGitDiff(change)
                }}
                onPull={() => {
                  void handlePullGitChanges()
                }}
                onPush={() => {
                  void handlePushGitChanges()
                }}
                onRefresh={() => {
                  if (!currentPath) {
                    return
                  }

                  void performWorkspaceRefresh(currentPath, {
                    gitSilent: false,
                    refreshGit: true,
                  })
                }}
                onStage={(filePaths) => {
                  void handleStageGitPaths(filePaths)
                }}
                onUnstage={(filePaths) => {
                  void handleUnstageGitPaths(filePaths)
                }}
                repositoryState={gitRepositoryState}
                workspacePath={currentPath}
                iconTheme={iconTheme}
              />
            </div>
          )}
        </div>

        <div className='sidebar-footer'>
          <button
            type='button'
            className='sidebar-footer-item'
            onClick={() => {
              setIsSettingsOpen(true)

              if (isDrawerSurface) {
                setIsLeftDrawerOpen(false)
              }
            }}
          >
            <Icon icon='lucide:settings' width={16} height={16} />
            <span>设置</span>
          </button>
        </div>
      </div>
    )
  }

  function renderAgentPanel(surfaceMode: PanelSurfaceMode = 'docked') {
    const isDrawerSurface = surfaceMode === 'drawer'

    return (
      <AgentSidebar
        iconTheme={iconTheme}
        onOpenMessageFile={openAgentMessageFile}
        onOpenProviderSettings={() => {
          if (isDrawerSurface) {
            setIsRightDrawerOpen(false)
          }

          setSettingsSection('providers')
          setIsSettingsOpen(true)
        }}
        workspacePath={currentPath}
        onWorkspaceStateChange={setAgentWorkspaceState}
      />
    )
  }

  return (
    <div
      ref={appShellRef}
      className="app-shell text-foreground bg-background"
      data-layout={layoutMode}
      data-platform={shellPlatform}
      data-left-collapsed={isLeftSidebarDrawer || !isLeftSidebarVisible ? 'true' : 'false'}
      data-left-drawer-open={isLeftDrawerOpen ? 'true' : 'false'}
      data-modal-layer-open={isAppModalLayerOpen ? 'true' : 'false'}
      data-resizing={activeResizePanel || isGitPanelResizing ? 'true' : 'false'}
      data-right-collapsed={isRightSidebarDrawer || !isRightSidebarVisible ? 'true' : 'false'}
      data-right-drawer-open={isRightDrawerOpen ? 'true' : 'false'}
      style={
        {
          '--git-panel-height': `${gitPanelHeight}px`,
          '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
          '--right-sidebar-width': `${effectiveRightSidebarWidth}px`,
          ...shellChromeVars,
        } as CSSProperties
      }
    >
      {isLeftSidebarDrawer || !isLeftSidebarVisible ? (
        <button
          type='button'
          className='panel-toggle-button panel-toggle-button-overlay panel-toggle-button-overlay-left workspace-toggle-brand-button'
          data-overlay-elevated={isLeftPanelOverlayElevated ? 'true' : 'false'}
          data-react-aria-top-layer={isLeftPanelOverlayTopLayer ? 'true' : undefined}
          aria-label={isLeftSidebarDrawer
            ? (isLeftDrawerOpen ? 'Close workspace panel' : 'Open workspace panel')
            : (isLeftSidebarVisible ? 'Collapse workspace sidebar' : 'Expand workspace sidebar')}
          onClick={() => {
            if (isLeftSidebarDrawer) {
              handleLeftDrawerOpenChange(!isLeftDrawerOpen)
              return
            }

            setIsLeftSidebarCollapsed((currentValue) => !currentValue)
          }}
        >
          <span className='panel-toggle-icon workspace-toggle-brand-icon' aria-hidden='true'>
            <img className='workspace-toggle-brand-logo' src='/branding/logo_xl.svg' alt='' draggable='false' />
            <span className='workspace-toggle-brand-glyph'>
              <LayoutLeftLine size={16} />
            </span>
          </span>
        </button>
      ) : null}

      <button
        type='button'
        className='panel-toggle-button panel-toggle-button-overlay panel-toggle-button-overlay-right'
        data-overlay-elevated={isRightPanelOverlayElevated ? 'true' : 'false'}
        data-react-aria-top-layer={isRightPanelOverlayTopLayer ? 'true' : undefined}
        aria-label={isRightSidebarDrawer
          ? (isRightDrawerOpen ? 'Close assistant panel' : 'Open assistant panel')
          : (isRightSidebarVisible ? 'Collapse assistant sidebar' : 'Expand assistant sidebar')}
        onClick={toggleAssistantSurface}
      >
        <span className='panel-toggle-icon' aria-hidden='true'>
          <LayoutRightLine size={16} />
        </span>
      </button>

      {isLeftSidebarVisible ? (
        <aside className='panel panel-sidebar'>
          {renderWorkspaceSidebar('docked')}
        </aside>
      ) : null}

      {false && (
      <aside className={`panel panel-sidebar${isLeftSidebarVisible ? '' : ' is-collapsed'}`}>
        <div className='section-title workspace-section-title'>
          <button
            type='button'
            className='panel-toggle-button workspace-section-toggle workspace-toggle-brand-button'
            aria-label='Collapse workspace sidebar'
            onClick={() => {
              setIsLeftSidebarCollapsed(true)
            }}
          >
            <span className='panel-toggle-icon workspace-toggle-brand-icon' aria-hidden='true'>
              <img className='workspace-toggle-brand-logo' src='/branding/logo_xl.svg' alt='' draggable='false' />
              <span className='workspace-toggle-brand-glyph'>
                <LayoutLeftLine size={16} />
              </span>
            </span>
          </button>
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
          </button>

          <div className='section-title-drag-spacer' aria-hidden='true' />

        </div>

        <div ref={leftSidebarBodyRef} className='sidebar-stack'>
          <div className='sidebar-vertical-tabs'>
            <button
              type='button'
              className={`sidebar-vertical-tab${activeLeftSidebarTab === 'file' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveLeftSidebarTab('file')
              }}
            >
              <FileLine size={16} className='sidebar-vertical-tab-icon' />
              <span className='sidebar-vertical-tab-label'>文件</span>
            </button>
            <button
              type='button'
              className={`sidebar-vertical-tab${activeLeftSidebarTab === 'git' ? ' is-active' : ''}`}
              onClick={() => {
                setActiveLeftSidebarTab('git')
              }}
            >
              <GitCompareLine size={16} className='sidebar-vertical-tab-icon' />
              <span className='sidebar-vertical-tab-label'>Git</span>
            </button>
            <button
              type='button'
              className='sidebar-vertical-tab'
              onClick={() => {
                setIsCommandPaletteOpen(true)
              }}
            >
              <Icon icon='lucide:search' width={16} height={16} className='sidebar-vertical-tab-icon' />
              <span className='sidebar-vertical-tab-label'>搜索</span>
            </button>
          </div>

          {activeLeftSidebarTab === 'file' ? (
            <div className='sidebar-stack-pane sidebar-tree-pane'>
              <div className='file-panel-header'>
                <span className='file-panel-title'>文件树</span>
                <div className='file-panel-actions'>
                  <Tooltip closeDelay={0}>
                    <Tooltip.Trigger>
                      <button
                        type='button'
                        className='file-panel-action'
                        onClick={() => void handleCreateFile()}
                        disabled={!currentPath || isCreatingFile}
                        aria-label='Create File'
                      >
                        <Icon icon='lucide:file-plus' width={16} height={16} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Create File</Tooltip.Content>
                  </Tooltip>
                  <Tooltip closeDelay={0}>
                    <Tooltip.Trigger>
                      <button
                        type='button'
                        className='file-panel-action'
                        onClick={() => void handleCreateDirectory()}
                        disabled={!currentPath || isCreatingDirectory}
                        aria-label='Create Folder'
                      >
                        <Icon icon='lucide:folder-plus' width={16} height={16} />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>Create Folder</Tooltip.Content>
                  </Tooltip>
                  <Tooltip closeDelay={0}>
                    <Tooltip.Trigger>
                      <button
                        type='button'
                        className='file-panel-action'
                        onClick={handleToggleFileTreeExpansion}
                        disabled={!currentPath || tree.length === 0}
                        aria-label='Toggle Expansion'
                      >
                        <Icon 
                          icon={expandedPaths.size > 0 ? 'lucide:fold-vertical' : 'lucide:unfold-vertical'} 
                          width={16} height={16} 
                        />
                      </button>
                    </Tooltip.Trigger>
                    <Tooltip.Content>{expandedPaths.size > 0 ? 'Collapse All' : 'Expand All'}</Tooltip.Content>
                  </Tooltip>
                </div>
              </div>

              <AppScrollArea
                className='tree-scroll'
                contentClassName='tree-scroll-content'
              >
                <WorkspaceTree
                  activeFilePath={activeTreePath}
                  iconTheme={iconTheme}
                  nodes={tree}
                  expandedPaths={expandedPaths}
                  setExpandedPaths={setExpandedPaths}
                  workspacePath={currentPath}
                  gitRepositoryState={gitRepositoryState}
                  onSelectFile={(filePath) => {
                    void openFile(filePath)
                  }}
                  onOpenInWritingEditor={(filePath) => {
                    void openFile(filePath, currentPath, 'default')
                  }}
                  onOpenInCodeEditor={(filePath) => {
                    void openFile(filePath, currentPath, 'code')
                  }}
                  onOpenInMeoEditor={(filePath) => {
                    void openFile(filePath, currentPath, 'meo')
                  }}
                  onRenameNode={(node, nextName) => handleRenameNode(node, nextName)}
                  onDeleteNode={(node) => handleDeleteNode(node)}
                  onMoveNode={(node, targetDirectoryPath) => handleMoveNode(node, targetDirectoryPath)}
                />
              </AppScrollArea>
            </div>
          ) : (
            <div className='sidebar-stack-pane sidebar-git-pane' id='git-panel'>
              <GitPanel
                busyLabel={gitBusyLabel}
                commitMessage={gitCommitMessage}
                isLoading={isGitLoading}
                layout={gitPanelLayout}
                onCommit={() => {
                  void handleCommitGitChanges()
                }}
                onCommitAndSync={() => {
                  void handleCommitAndSyncGitChanges()
                }}
                onCommitMessageChange={setGitCommitMessage}
                onDiscardAll={() => {
                  void handleDiscardAllGitChanges()
                }}
                onDiscardMany={(changes) => {
                  void handleDiscardGitChanges(changes)
                }}
                onInitialize={() => {
                  void handleInitializeGit()
                }}
                onLayoutChange={setGitPanelLayout}
                onOpenFile={(filePath) => {
                  void openFile(filePath)
                }}
                onOpenDiff={(change) => {
                  void openGitDiff(change)
                }}
                onPull={() => {
                  void handlePullGitChanges()
                }}
                onPush={() => {
                  void handlePushGitChanges()
                }}
                onRefresh={() => {
                  if (!currentPath) {
                    return
                  }

                  void performWorkspaceRefresh(currentPath, {
                    gitSilent: false,
                    refreshGit: true,
                  })
                }}
                onStage={(filePaths) => {
                  void handleStageGitPaths(filePaths)
                }}
                onUnstage={(filePaths) => {
                  void handleUnstageGitPaths(filePaths)
                }}
                repositoryState={gitRepositoryState}
                workspacePath={currentPath}
                iconTheme={iconTheme}
              />
            </div>
          )}
        </div>

        <div className='sidebar-footer'>
          <button 
            type='button' 
            className='sidebar-footer-item'
            onClick={() => setIsSettingsOpen(true)}
          >
            <Icon icon='lucide:settings' width={16} height={16} />
            <span>设置</span>
          </button>
        </div>
      </aside>
      )}

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
            activeTabId={displayActiveTabId}
            tabs={displayTabs}
            workspacePath={currentPath}
            onActivate={activateFileTab}
            onClose={(tabId) => {
              closeEditorTab(tabId)
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

          <div className='editor-content-shell' id='writing-editor-panel'>
            {isSettingsTabActive ? (
              <SettingsDialog
                activeSection={settingsSection}
                appIconId={appIconId}
                appIconOptions={appIconOptions}
                agentState={agentWorkspaceState}
                iconTheme={iconTheme}
                iconThemeOptions={iconThemeOptions}
                isAppIconBusy={isApplyingAppIcon}
                isIconThemeBusy={isImportingIconTheme || isApplyingIconTheme}
                resolvedTheme={resolvedTheme}
                workspacePath={currentPath}
                onAgentStateChange={setAgentWorkspaceState}
                onImportIconTheme={handlePickWorkspaceIconTheme}
                onSectionChange={setSettingsSection}
                onSelectAppIcon={handleSelectAppIcon}
                onSelectIconTheme={handleSelectWorkspaceIconTheme}
                onStatusMessage={setStatusMessage}
              />
            ) : !activeFileTab && !activeDiffTab ? (
              <div className='editor-empty-state'>
                <div className='editor-empty-content'>
                  <div className='editor-empty-logo-shell' aria-hidden='true'>
                    <img className='editor-empty-logo' src='/branding/logo.svg' alt='' />
                  </div>
                  <div className='editor-empty-actions'>
                    <Button variant='outline' onPress={() => setIsCommandPaletteOpen(true)}>
                      <Icon icon='lucide:search' width={16} height={16} className='mr-2' />
                      搜索
                    </Button>
                    <Button
                      variant='outline'
                      onPress={() => {
                        void handleCreateFile()
                      }}
                      isDisabled={!currentPath || isCreatingFile}
                    >
                      <FileLine className='mr-2' size={16} />
                      新建文件
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {activeDiffTab ? (
              <GitDiffEditor
                key={activeDiffTab.id}
                diff={activeDiffTab.diff}
                draftContent={activeDiffDraftContent}
                navigationRequest={activeDiffTab.navigationRequest ?? null}
                hasDirtyRelatedFileTab={activeDiffHasDirtyRelatedFileTab}
                theme={theme}
                onApplyBlockAction={handleApplyGitDiffSelection}
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
            ) : null}

            {activeFileTab && currentEditorKind === 'rich-text' && currentFileViewMode === 'default' ? (
              <WritingEditor
                key={activeFileTab.id}
                disabled={!currentFilePath}
                onChange={(nextValue) => {
                  if (!currentFilePath) {
                    return
                  }

                  updateFileTabsContent(currentFilePath, nextValue)
                }}
                onCompositionChange={setIsActiveEditorComposing}
                value={currentFileContent}
                theme={theme}
              />
            ) : null}

            {activeFileTab && currentEditorKind === 'rich-text' && currentFileViewMode === 'meo' ? (
              <MeoEditorHost
                key={activeFileTab.id}
                ref={meoEditorHostRef}
                filePath={activeFileTab.filePath}
                gitDiffRequest={activeFileTab.gitDiffRequest ?? null}
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
                      await openGitDiff(nextChange, gitAction)
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
            ) : null}

            {activeFileTab && currentEditorKind === 'code' && currentFileViewMode === 'preview' ? (
              <HtmlPreview
                content={currentFileContent}
                filePath={activeFileTab.filePath}
              />
            ) : null}

            {activeFileTab && (
              (currentEditorKind === 'code' && currentFileViewMode !== 'preview')
              || (currentEditorKind === 'rich-text' && currentFileViewMode === 'code')
            ) ? (
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

      {isRightSidebarVisible ? (
        <aside className='panel panel-agent'>
          {renderAgentPanel('docked')}
        </aside>
      ) : null}

      {false && (
      <aside className={`panel panel-agent${isRightSidebarVisible ? '' : ' is-collapsed'}`}>
        <AgentSidebar
          iconTheme={iconTheme}
          onOpenMessageFile={openAgentMessageFile}
          onOpenProviderSettings={() => {
            setSettingsSection('providers')
            setIsSettingsOpen(true)
          }}
          workspacePath={currentPath}
          onWorkspaceStateChange={setAgentWorkspaceState}
        />
      </aside>
      )}

      {isLeftSidebarDrawer ? (
        <Drawer
          isOpen={isLeftDrawerOpen}
          onOpenChange={handleLeftDrawerOpenChange}
        >
          <Drawer.Backdrop
            className='panel-drawer-backdrop'
            variant='opaque'
          >
            <Drawer.Content placement='left' className='panel-drawer panel-drawer-left' data-platform={shellPlatform}>
              <Drawer.Dialog
                aria-label='Workspace'
                className={`panel-drawer-dialog ${resolvedTheme === 'dark' ? 'dark' : ''}`}
              >
                <Drawer.Body className='panel-drawer-body'>
                  {renderWorkspaceSidebar('drawer')}
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      ) : null}

      {isRightSidebarDrawer ? (
        <Drawer
          isOpen={isRightDrawerOpen}
          onOpenChange={handleRightDrawerOpenChange}
        >
          <Drawer.Backdrop
            className='panel-drawer-backdrop'
            variant='opaque'
          >
            <Drawer.Content placement='right' className='panel-drawer panel-drawer-right' data-platform={shellPlatform}>
              <Drawer.Dialog
                aria-label='Assistant'
                className={`panel-drawer-dialog ${resolvedTheme === 'dark' ? 'dark' : ''}`}
              >
                <Drawer.Body className='panel-drawer-body panel-drawer-body-agent'>
                  <div
                    ref={rightDrawerSurfaceRef}
                    className='panel panel-agent panel-agent-drawer'
                    data-full-width={isRightDrawerFullWidth ? 'true' : 'false'}
                    data-platform={shellPlatform}
                    style={shellChromeVars}
                  >
                    {renderAgentPanel('drawer')}
                  </div>
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      ) : null}

      <Toast.Provider placement='bottom end' />

      <Modal>
        <Modal.Backdrop 
          isOpen={isSettingsOpen} 
          onOpenChange={setIsSettingsOpen}
          variant='opaque'
        >
          <Modal.Container scroll='inside' className='flex items-center justify-center p-0 m-0 border-none shadow-none bg-transparent'>
            <Modal.Dialog className={`settings-modal p-0 m-0 relative ${resolvedTheme === 'dark' ? 'dark' : ''}`}>
              <Modal.CloseTrigger 
                className='settings-modal-close'
                aria-label='Close settings'
              >
                <Icon icon='lucide:x' width={16} height={16} />
              </Modal.CloseTrigger>
              <Modal.Body className='p-0 m-0'>
                <SettingsDialog
                  activeSection={settingsSection}
                  appIconId={appIconId}
                  appIconOptions={appIconOptions}
                  agentState={agentWorkspaceState}
                  iconTheme={iconTheme}
                  iconThemeOptions={iconThemeOptions}
                  isAppIconBusy={isApplyingAppIcon}
                  isIconThemeBusy={isImportingIconTheme || isApplyingIconTheme}
                  resolvedTheme={resolvedTheme}
                  workspacePath={currentPath}
                  onAgentStateChange={setAgentWorkspaceState}
                  onImportIconTheme={handlePickWorkspaceIconTheme}
                  onSectionChange={setSettingsSection}
                  onSelectAppIcon={handleSelectAppIcon}
                  onSelectIconTheme={handleSelectWorkspaceIconTheme}
                  onStatusMessage={setStatusMessage}
                />
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <AlertDialog>
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
                 <p className="text-[var(--foreground)] whitespace-pre-wrap">{confirmDialogOptions?.message}</p>
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
      </AlertDialog>

      <CommandPalette 
        isOpen={isCommandPaletteOpen}
        onClose={handleCloseCommandPalette}
        files={tree}
        sessions={agentWorkspaceState?.sessions ?? []}
        onOpenFile={openFile}
        onOpenSession={handleOpenSession}
        actions={commandPaletteActions}
        theme={theme}
      />
      <AppTitlebar onRequestClose={() => {
        void handleRequestWindowClose()
      }}
        drawerSide={isLeftDrawerOpen ? 'left' : isRightDrawerOpen ? 'right' : null}
        isDrawerOpen={isLeftDrawerOpen || isRightDrawerOpen}
      />
    </div>
  )
}

export default App

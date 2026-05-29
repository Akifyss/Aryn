import type { CSSProperties, FormEvent } from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Button, Tooltip, Toast, toast, Modal, AlertDialog, Drawer, Tabs } from '@heroui/react'
import {
  FileLine,
  FolderLine,
  FolderOpenLine,
  GitBranchLine,
  LayoutLeftLine,
  LayoutRightLine,
  NewFolderLine,
  CheckLine,
  SearchLine,
} from '@mingcute/react'
import { Icon } from '@iconify/react'
import type { ProjectRecord, ProjectState, WorkspaceNode } from '@/features/workspace/types'
import { AppScrollArea } from '@/components/app-scroll-area'
import { AppTitlebar } from '@/components/app-titlebar'
import {
  type AgentProjectSessionRequest,
  AgentChatSurface,
  AgentProvider,
  AgentSessionTree,
  AgentSidebar,
} from '@/features/agent/components/agent-sidebar'
import type { AgentMessageFileChangeKind, AgentWorkspaceState } from '@/features/agent/types'
import { isLineWithinVisualDiff } from '@/features/editor/lib/git-diff-navigation'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host'
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
import { FileTabs } from '@/features/workspace/components/file-tabs'
import { WorkspaceTree } from '@/features/workspace/components/workspace-tree'
import {
  createWorkspaceFileTabId,
  dedupeWorkspaceTabs,
  useWorkspaceStore,
  type WorkspaceFixedPanelTab,
  type WorkspaceDiffTab,
  type WorkspaceDiffNavigationRequest,
  type WorkspaceDisplayTab,
  type WorkspaceFileGitDiffRequest,
  type WorkspaceFileTab,
  type WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'
import {
  normalizeWorkspaceFileViewMode,
  supportsMeoEditor,
  type LegacyWorkspaceFileViewMode,
  type WorkspaceFileViewMode,
} from '@/features/workspace/lib/file-types'
import {
  createWorkspaceRefreshCoordinator,
  type WorkspaceRefreshRequest,
  type WorkspaceRefreshScheduleMode,
} from '@/features/workspace/lib/workspace-refresh-coordinator'
import { getOpenFileProfileDuration, recordOpenFileProfile } from '@/lib/open-file-profile'
import type {
  WorkspaceIconTheme,
  WorkspaceIconThemeCatalogOption,
} from '@/features/workspace/types'
import { CommandPalette } from '@/features/command-palette/components/command-palette'
import { useSettingsStore, type AppLayoutPreference, type AppTheme } from '@/hooks/use-settings-store'
import type {
  PersistedLayoutState,
  PersistedWorkspaceTabState,
  PersistentClientStateSnapshot,
} from '@/features/persistence/types'
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

const CodeEditor = lazy(async () => {
  const startedAt = performance.now()
  recordOpenFileProfile('lazy:code-editor:start')
  const module = await import('@/features/editor/components/code-editor')
  recordOpenFileProfile('lazy:code-editor:end', { durationMs: getOpenFileProfileDuration(startedAt) })
  return { default: module.CodeEditor }
})
const GitDiffEditor = lazy(async () => {
  const startedAt = performance.now()
  recordOpenFileProfile('lazy:git-diff-editor:start')
  const module = await import('@/features/editor/components/git-diff-editor')
  recordOpenFileProfile('lazy:git-diff-editor:end', { durationMs: getOpenFileProfileDuration(startedAt) })
  return { default: module.GitDiffEditor }
})
let meoEditorHostModulePromise: Promise<typeof import('@/features/editor/components/meo-editor-host')> | null = null

function loadMeoEditorHostModule(reason: 'lazy' | 'startup-preload') {
  if (!meoEditorHostModulePromise) {
    const startedAt = performance.now()
    recordOpenFileProfile('lazy:meo-editor-host:start', { reason })
    meoEditorHostModulePromise = import('@/features/editor/components/meo-editor-host')
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

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function EditorLoadingState({ label = 'Loading editor...' }: { label?: string }) {
  useEffect(() => {
    recordOpenFileProfile('editor:fallback:mounted', { label })

    return () => {
      recordOpenFileProfile('editor:fallback:unmounted', { label })
    }
  }, [label])

  return (
    <div className='editor-lazy-fallback' role='status' aria-live='polite'>
      <span className='editor-lazy-spinner' aria-hidden='true' />
      <span>{label}</span>
    </div>
  )
}

type ResolvedAppTheme = 'light' | 'dark'
type WindowAppearanceTheme = ResolvedAppTheme | 'system'

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

function isWorkspaceFixedPanelTab(tab: WorkspaceDisplayTab | null | undefined): tab is WorkspaceFixedPanelTab {
  return tab?.kind === 'fixed-panel'
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
    viewMode?: LegacyWorkspaceFileViewMode
  }>
  paths: string[]
}

const RESIZE_HANDLE_WIDTH = 12
const MIN_EDITOR_WIDTH = 480
const LEFT_SIDEBAR_MIN_WIDTH = 240
const LEFT_SIDEBAR_MAX_WIDTH = 520
const RIGHT_SIDEBAR_MIN_WIDTH = 300
const RIGHT_SIDEBAR_MAX_WIDTH = 560
const AGENT_LAYOUT_CHAT_MIN_WIDTH = 320
const AGENT_LAYOUT_RIGHT_SIDEBAR_MIN_WIDTH = 520
const DEFAULT_LEFT_SIDEBAR_WIDTH = 320
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 368
const DEFAULT_GIT_PANEL_HEIGHT = 292
const MIN_GIT_PANEL_HEIGHT = 200
const DEFAULT_GIT_PANEL_LAYOUT: GitPanelLayout = 'list'
const DRAWER_INTERACTION_REFRESH_STABLE_FRAMES = 2
const DRAWER_INTERACTION_REFRESH_MAX_FRAMES = 36
const SETTINGS_TAB_ID = 'app://settings'
const SETTINGS_TAB_PATH = 'app://settings'
const FIXED_FILE_TAB_ID = 'app://fixed/files'
const FIXED_GIT_TAB_ID = 'app://fixed/git'
const WORKSPACE_AUTO_SAVE_DELAY_MS = 1000
const INTERNAL_SAVE_EVENT_TTL_MS = 2500
const WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS = 140

type ResizePanel = 'left' | 'right'
type PanelSurfaceMode = 'docked' | 'drawer'
type LeftSidebarTab = 'file' | 'git'
type AgentLayoutFixedTab = 'file' | 'git'
type AgentRightSidebarWidthMode = 'max' | 'fixed'
type ProjectMenuMode = 'agent-add' | 'agent-new-switch' | 'editor-switch'
type ProjectMenuAnchorRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>

const PROJECT_MENU_MARGIN_PX = 8
const PROJECT_MENU_GAP_PX = 8
const PROJECT_MENU_AGENT_ADD_WIDTH_PX = 288
const PROJECT_MENU_EDITOR_SWITCH_WIDTH_PX = 320
const PROJECT_MENU_AGENT_ADD_ESTIMATED_HEIGHT_PX = 96
const PROJECT_MENU_EDITOR_SWITCH_MAX_HEIGHT_PX = 520
const PROJECT_MENU_EDITOR_SWITCH_MIN_HEIGHT_PX = 180
const PROJECT_MENU_EDITOR_SWITCH_SEARCH_HEIGHT_PX = 36
const PROJECT_MENU_EDITOR_SWITCH_ACTIONS_HEIGHT_PX = 72
const PROJECT_MENU_PROJECT_ROW_HEIGHT_PX = 34
const PROJECT_MENU_PROJECT_LIST_MAX_HEIGHT_PX = 320

let initialLayoutState: PersistedLayoutState | null = null
let persistedWorkspaceTabState = new Map<string, PersistedWorkspaceTabState>()

export function initializeAppPersistentState(snapshot: PersistentClientStateSnapshot) {
  initialLayoutState = snapshot.app.layout
  persistedWorkspaceTabState = new Map(Object.entries(snapshot.workspace.workspaceTabs))
}

const emptyProjectState: ProjectState = {
  activeProjectId: null,
  projects: [],
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function serializeProjectMenuAnchorRect(rect: ProjectMenuAnchorRect): ProjectMenuAnchorRect {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  }
}

function estimateProjectMenuHeight(
  mode: ProjectMenuMode,
  projectCount: number,
  viewportHeight: number,
) {
  const viewportMaxHeight = Math.max(160, viewportHeight - (PROJECT_MENU_MARGIN_PX * 2))

  if (mode === 'agent-add') {
    return Math.min(PROJECT_MENU_AGENT_ADD_ESTIMATED_HEIGHT_PX, viewportMaxHeight)
  }

  const listHeight = Math.min(
    PROJECT_MENU_PROJECT_LIST_MAX_HEIGHT_PX,
    Math.max(PROJECT_MENU_PROJECT_ROW_HEIGHT_PX, projectCount * PROJECT_MENU_PROJECT_ROW_HEIGHT_PX),
  )
  const estimatedHeight = PROJECT_MENU_EDITOR_SWITCH_SEARCH_HEIGHT_PX
    + listHeight
    + PROJECT_MENU_EDITOR_SWITCH_ACTIONS_HEIGHT_PX

  return Math.min(
    PROJECT_MENU_EDITOR_SWITCH_MAX_HEIGHT_PX,
    viewportMaxHeight,
    Math.max(PROJECT_MENU_EDITOR_SWITCH_MIN_HEIGHT_PX, estimatedHeight),
  )
}

function resolveProjectMenuStyle(
  mode: ProjectMenuMode,
  anchorRect: ProjectMenuAnchorRect | null,
  projectCount = 0,
): CSSProperties | undefined {
  if (!anchorRect || typeof window === 'undefined') {
    return undefined
  }

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxWidth = Math.max(240, viewportWidth - (PROJECT_MENU_MARGIN_PX * 2))
  const width = Math.min(
    mode === 'agent-add' ? PROJECT_MENU_AGENT_ADD_WIDTH_PX : PROJECT_MENU_EDITOR_SWITCH_WIDTH_PX,
    maxWidth,
  )
  const maxLeft = Math.max(PROJECT_MENU_MARGIN_PX, viewportWidth - width - PROJECT_MENU_MARGIN_PX)
  const preferredLeft = mode === 'editor-switch'
    ? anchorRect.left + (anchorRect.width / 2) - (width / 2)
    : anchorRect.left
  const left = clamp(preferredLeft, PROJECT_MENU_MARGIN_PX, maxLeft)
  const estimatedHeight = estimateProjectMenuHeight(mode, projectCount, viewportHeight)
  const maxHeight = mode === 'agent-add'
    ? PROJECT_MENU_AGENT_ADD_ESTIMATED_HEIGHT_PX
    : PROJECT_MENU_EDITOR_SWITCH_MAX_HEIGHT_PX
  const availableBelow = Math.max(0, viewportHeight - anchorRect.bottom - PROJECT_MENU_MARGIN_PX - PROJECT_MENU_GAP_PX)
  const availableAbove = Math.max(0, anchorRect.top - PROJECT_MENU_MARGIN_PX - PROJECT_MENU_GAP_PX)
  const preferredHeight = Math.min(estimatedHeight, maxHeight)
  const opensBelow = availableBelow >= preferredHeight || availableBelow >= availableAbove
  const availableHeight = opensBelow ? availableBelow : availableAbove
  const renderedHeight = Math.min(preferredHeight, availableHeight)
  const preferredTop = anchorRect.bottom + PROJECT_MENU_GAP_PX
  const fallbackTop = anchorRect.top - PROJECT_MENU_GAP_PX - renderedHeight
  const top = opensBelow
    ? Math.min(preferredTop, viewportHeight - renderedHeight - PROJECT_MENU_MARGIN_PX)
    : Math.max(PROJECT_MENU_MARGIN_PX, fallbackTop)
  const bottom = viewportHeight - anchorRect.top + PROJECT_MENU_GAP_PX

  return {
    left: `${left}px`,
    maxHeight: `${availableHeight}px`,
    ...(opensBelow
      ? { bottom: 'auto', top: `${Math.max(PROJECT_MENU_MARGIN_PX, top)}px` }
      : { bottom: `${bottom}px`, top: 'auto' }),
    width: `${width}px`,
  }
}

function readStoredLayoutNumber(
  key: keyof PersistedLayoutState,
  fallback: number,
) {
  const value = initialLayoutState?.[key]
  const parsedValue = typeof value === 'number' ? value : NaN

  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function readStoredLayoutBoolean(
  key: keyof PersistedLayoutState,
  fallback: boolean,
) {
  const value = initialLayoutState?.[key]

  return typeof value === 'boolean' ? value : fallback
}

function readStoredGitPanelLayout() {
  const value = initialLayoutState?.gitPanelLayout

  return value === 'list' || value === 'tree' ? value : DEFAULT_GIT_PANEL_LAYOUT
}

function readStoredAgentRightSidebarWidthMode(): AgentRightSidebarWidthMode {
  const value = initialLayoutState?.agentRightSidebarWidthMode

  return value === 'fixed' ? 'fixed' : 'max'
}

function readStoredLeftSidebarTab() {
  const value = initialLayoutState?.activeLeftSidebarTab

  return value === 'git' ? value : 'file'
}

function getFixedPanelTab(tab: AgentLayoutFixedTab): WorkspaceFixedPanelTab {
  if (tab === 'git') {
    return {
      content: '',
      editorKind: 'prose',
      exists: true,
      filePath: FIXED_GIT_TAB_ID,
      fixedTabKind: 'git-panel',
      id: FIXED_GIT_TAB_ID,
      isDirty: false,
      kind: 'fixed-panel',
      savedContent: '',
    }
  }

  return {
    content: '',
    editorKind: 'prose',
    exists: true,
    filePath: FIXED_FILE_TAB_ID,
    fixedTabKind: 'file-panel',
    id: FIXED_FILE_TAB_ID,
    isDirty: false,
    kind: 'fixed-panel',
    savedContent: '',
  }
}

function readStoredTabState(workspacePath: string): StoredTabState {
  const storedState = persistedWorkspaceTabState.get(workspacePath)

  if (storedState) {
    return {
      activePath: storedState.activePath,
      entries: storedState.entries,
      paths: storedState.paths,
    }
  }

  return {
    activePath: null,
    entries: [],
    paths: [],
  }
}

function writeStoredTabState(workspacePath: string, state: StoredTabState) {
  const entries = state.entries ?? state.paths.map((entryPath) => ({ path: entryPath }))
  const nextState: PersistedWorkspaceTabState = {
    activePath: state.activePath,
    entries,
    paths: entries.map((entry) => entry.path),
  }

  persistedWorkspaceTabState.set(workspacePath, nextState)
  void window.appApi.updateWorkspaceTabState(workspacePath, nextState).catch(() => undefined)
}

function dedupeStoredEntries(entries: Array<{ path: string, viewMode?: LegacyWorkspaceFileViewMode }>) {
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
  preferredViewMode?: LegacyWorkspaceFileViewMode,
) {
  return normalizeWorkspaceFileViewMode(filePath, editorKind, preferredViewMode)
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
  const { layoutPreference, meo, theme } = useSettingsStore()
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedAppTheme>(() => resolveAppTheme(theme))

  // Apply theme to document root
  useEffect(() => {
    const applyDocumentTheme = (t: ResolvedAppTheme) => {
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

    const applyTheme = (t: ResolvedAppTheme, appearanceTheme: WindowAppearanceTheme = t) => {
      applyDocumentTheme(t)
      void window.appApi.setWindowTheme({
        appearanceTheme,
        backgroundTheme: t,
      })
    }

    if (theme === 'auto') {
      if (platform !== 'darwin') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        applyTheme(systemTheme, 'system')

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
        const handleChange = (e: MediaQueryListEvent) => {
          applyTheme(e.matches ? 'dark' : 'light', 'system')
        }
        mediaQuery.addEventListener('change', handleChange)
        return () => mediaQuery.removeEventListener('change', handleChange)
      }

      let disposed = false
      const unsubscribeWindowTheme = window.appApi.onWindowThemeChanged(({ resolvedTheme }) => {
        applyDocumentTheme(resolvedTheme)
      })

      void window.appApi.setWindowTheme({ appearanceTheme: 'system' }).then(
        ({ resolvedTheme }) => {
          if (!disposed) {
            applyDocumentTheme(resolvedTheme ?? resolveAppTheme('auto'))
          }
        },
        () => {
          if (!disposed) {
            applyDocumentTheme(resolveAppTheme('auto'))
          }
        }
      )
      return () => {
        disposed = true
        unsubscribeWindowTheme()
      }
    }

    applyTheme(theme)
  }, [theme])

  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false)
  const [projectState, setProjectState] = useState<ProjectState>(emptyProjectState)
  const [projectMenuMode, setProjectMenuMode] = useState<ProjectMenuMode | null>(null)
  const [projectMenuAnchorRect, setProjectMenuAnchorRect] = useState<ProjectMenuAnchorRect | null>(null)
  const [projectMenuSearch, setProjectMenuSearch] = useState('')
  const [isProjectActionBusy, setIsProjectActionBusy] = useState(false)
  const [hasLoadedProjectState, setHasLoadedProjectState] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [pendingAgentProjectSessionRequest, setPendingAgentProjectSessionRequest] = useState<AgentProjectSessionRequest | null>(null)

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
  const lastIconThemeLinkedThemeRef = useRef<ResolvedAppTheme>(resolvedTheme)
  const iconThemeLinkRequestRef = useRef(0)
  const [, setStatusMessage] = useState('Open a folder to start.')
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [activeAgentLayoutFixedTab, setActiveAgentLayoutFixedTab] = useState<AgentLayoutFixedTab>('file')
  const [isAgentLayoutFixedTabActive, setIsAgentLayoutFixedTabActive] = useState(false)

  const [leftSidebarWidth, setLeftSidebarWidth] = useState(
    () => readStoredLayoutNumber('leftSidebarWidth', DEFAULT_LEFT_SIDEBAR_WIDTH),
  )
  const [editorRightSidebarWidth, setEditorRightSidebarWidth] = useState(
    () => readStoredLayoutNumber('editorRightSidebarWidth', DEFAULT_RIGHT_SIDEBAR_WIDTH),
  )
  const [agentRightSidebarWidth, setAgentRightSidebarWidth] = useState(
    () => readStoredLayoutNumber('agentRightSidebarWidth', AGENT_LAYOUT_RIGHT_SIDEBAR_MIN_WIDTH),
  )
  const [agentRightSidebarWidthMode, setAgentRightSidebarWidthMode] = useState<AgentRightSidebarWidthMode>(
    () => readStoredAgentRightSidebarWidthMode(),
  )
  const [gitPanelHeight, setGitPanelHeight] = useState(
    () => readStoredLayoutNumber('gitPanelHeight', DEFAULT_GIT_PANEL_HEIGHT),
  )
  const [isLeftSidebarCollapsed, setIsLeftSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('leftSidebarCollapsed', false),
  )
  const [isEditorRightSidebarCollapsed, setIsEditorRightSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('editorRightSidebarCollapsed', false),
  )
  const [isAgentRightSidebarCollapsed, setIsAgentRightSidebarCollapsed] = useState(
    () => readStoredLayoutBoolean('agentRightSidebarCollapsed', false),
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
  const [isWindowFullScreen, setIsWindowFullScreen] = useState(false)
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false)
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false)
  const [rightDrawerDragRegion, setRightDrawerDragRegion] = useState<{
    height: number
    left: number
    top: number
    width: number
  } | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const leftSidebarBodyRef = useRef<HTMLDivElement | null>(null)
  const leftDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const rightDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const meoEditorHostRef = useRef<MeoEditorHostHandle | null>(null)
  const agentProjectSessionRequestIdRef = useRef(0)
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
      isWorkspaceAutosaveTab(tab)
      && tab.isDirty
      && normalizeFilePath(tab.filePath) === diffPath
    ))
  }, [activeDiffTab?.diff.change.path, openTabs])
  const appLayoutPreference: AppLayoutPreference = layoutPreference
  const isAgentLayout = appLayoutPreference === 'agent'
  const rightSidebarWidth = isAgentLayout ? agentRightSidebarWidth : editorRightSidebarWidth
  const setRightSidebarWidth = isAgentLayout ? setAgentRightSidebarWidth : setEditorRightSidebarWidth
  const isRightSidebarCollapsed = isAgentLayout ? isAgentRightSidebarCollapsed : isEditorRightSidebarCollapsed
  const setIsRightSidebarCollapsed = isAgentLayout ? setIsAgentRightSidebarCollapsed : setIsEditorRightSidebarCollapsed
  const displayTabs = useMemo<WorkspaceDisplayTab[]>(
    () => {
      const fixedTabs = isAgentLayout
        ? [getFixedPanelTab('git'), getFixedPanelTab('file')]
        : []
      const workspaceTabs = [
        ...fixedTabs,
        ...openTabs,
      ]

      if (!isSettingsTabOpen) {
        return workspaceTabs
      }

      return [
        ...workspaceTabs,
        {
          content: '',
          editorKind: 'prose',
          exists: true,
          filePath: SETTINGS_TAB_PATH,
          id: SETTINGS_TAB_ID,
          isDirty: false,
          kind: 'settings',
          savedContent: '',
        },
      ]
    },
    [isAgentLayout, isSettingsTabOpen, openTabs],
  )
  const displayActiveTabId = isSettingsTabActive
    ? SETTINGS_TAB_ID
    : isAgentLayout && (isAgentLayoutFixedTabActive || !activeTabId)
      ? (activeAgentLayoutFixedTab === 'git' ? FIXED_GIT_TAB_ID : FIXED_FILE_TAB_ID)
      : activeTabId
  const displayActiveTab = useMemo(
    () => displayTabs.find((tab) => tab.id === displayActiveTabId) ?? null,
    [displayActiveTabId, displayTabs],
  )
  const activeFixedPanelTab = isWorkspaceFixedPanelTab(displayActiveTab) ? displayActiveTab : null
  const shouldRenderWorkspaceEditor = !activeFixedPanelTab && !isSettingsTabActive
  const currentFileContent = activeFileTab?.content ?? ''
  const currentEditorKind = activeFileTab?.editorKind ?? null
  const currentFileViewMode = activeFileTab?.viewMode ?? null
  const currentFilePath = activeFileTab?.filePath ?? null
  const isActiveMeoEditorMountedRef = useRef(false)
  isActiveMeoEditorMountedRef.current = currentEditorKind === 'prose' && currentFileViewMode === 'meo'
  useEffect(() => {
    if (!activeFileTab) {
      return
    }

    recordOpenFileProfile('app:active-file-tab:committed', {
      chars: activeFileTab.content.length,
      editorKind: activeFileTab.editorKind,
      filePath: activeFileTab.filePath,
      tabId: activeFileTab.id,
      viewMode: activeFileTab.viewMode,
    })
  }, [activeFileTab?.id])
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
  const activeProject = useMemo(
    () => projectState.projects.find((project) => project.id === projectState.activeProjectId) ?? null,
    [projectState.activeProjectId, projectState.projects],
  )
  const needsProjectBootstrap = hasLoadedProjectState && !activeProject
  const filteredProjectMenuProjects = useMemo(() => {
    const query = projectMenuSearch.trim().toLowerCase()

    if (!query) {
      return projectState.projects
    }

    return projectState.projects.filter((project) => (
      project.name.toLowerCase().includes(query)
      || project.path.toLowerCase().includes(query)
    ))
  }, [projectMenuSearch, projectState.projects])
  const shellPlatform: ShellPlatform = deriveShellPlatform(platform)
  const baseShellChromeVars = getShellChromeVars(shellPlatform, { isFullScreen: isWindowFullScreen })
  const shellChromeVars = {
    ...baseShellChromeVars,
    ...(isAgentLayout
      ? {
          '--right-panel-content-inset':
            'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap))',
        }
      : null),
  } as CSSProperties
  const layoutMode: LayoutMode = deriveLayoutMode(shellWidth)
  const isLeftSidebarDrawer = layoutMode !== 'full'
  const isRightSidebarDrawer = !isAgentLayout && layoutMode === 'focus'
  const isRightDrawerFullWidth = shellWidth <= RIGHT_DRAWER_MAX_WIDTH
  const isLeftSidebarVisible = !isLeftSidebarDrawer && !isLeftSidebarCollapsed
  const isRightSidebarVisible = !isRightSidebarDrawer && !isRightSidebarCollapsed
  const isAppModalLayerOpen = isSettingsOpen
    || isCommandPaletteOpen
    || isNewProjectDialogOpen
    || Boolean(confirmDialogOptions?.isOpen)
    || Boolean(projectMenuMode)
  const isLeftPanelOverlayElevated = !isAppModalLayerOpen && !isRightDrawerOpen
  const isRightPanelOverlayElevated = !isAppModalLayerOpen && !isLeftDrawerOpen
  const isLeftPanelOverlayTopLayer = !isAppModalLayerOpen && isLeftDrawerOpen
  const isRightPanelOverlayTopLayer = !isAppModalLayerOpen && isRightDrawerOpen
  const effectiveLeftSidebarWidth = isLeftSidebarVisible ? leftSidebarWidth : 0
  const effectiveRightSidebarWidth = isRightSidebarVisible ? rightSidebarWidth : 0
  const rightSidebarWidthReservedForLeftClamp = isAgentLayout && agentRightSidebarWidthMode === 'max'
    ? (isRightSidebarVisible ? AGENT_LAYOUT_RIGHT_SIDEBAR_MIN_WIDTH : 0)
    : effectiveRightSidebarWidth
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
      (tab) => tab.kind === 'diff' ? tab.isDirty : isWorkspaceAutosaveTab(tab) && tab.isDirty,
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
      isWorkspaceAutosaveTab(tab)
      && tab.isDirty
      && normalizeFilePath(tab.filePath) === normalizedPath
    ))
  }

  function getShellWidth() {
    return appShellRef.current?.clientWidth ?? window.innerWidth
  }

  function getGitPanelMaxHeight() {
    if (isAgentLayout) {
      return 520
    }

    const containerHeight = leftSidebarBodyRef.current?.clientHeight ?? 0
    return clamp(containerHeight - 180, MIN_GIT_PANEL_HEIGHT, 520)
  }

  function clampGitHeight(nextHeight: number) {
    return clamp(nextHeight, MIN_GIT_PANEL_HEIGHT, getGitPanelMaxHeight())
  }

  function clampLeftWidth(nextWidth: number, shellWidth: number, currentRightWidth: number) {
    const centerMinWidth = isAgentLayout ? AGENT_LAYOUT_CHAT_MIN_WIDTH : MIN_EDITOR_WIDTH
    const reservedWidth = centerMinWidth + RESIZE_HANDLE_WIDTH + (currentRightWidth > 0 ? currentRightWidth + RESIZE_HANDLE_WIDTH : 0)
    const maxWidth = Math.min(LEFT_SIDEBAR_MAX_WIDTH, Math.max(LEFT_SIDEBAR_MIN_WIDTH, shellWidth - reservedWidth))

    return clamp(nextWidth, LEFT_SIDEBAR_MIN_WIDTH, maxWidth)
  }

  function clampRightWidth(nextWidth: number, shellWidth: number, currentLeftWidth: number) {
    const centerMinWidth = isAgentLayout ? AGENT_LAYOUT_CHAT_MIN_WIDTH : MIN_EDITOR_WIDTH
    const reservedWidth = centerMinWidth + currentLeftWidth + RESIZE_HANDLE_WIDTH * 2
    const minWidth = isAgentLayout ? AGENT_LAYOUT_RIGHT_SIDEBAR_MIN_WIDTH : RIGHT_SIDEBAR_MIN_WIDTH
    const availableWidth = Math.max(minWidth, shellWidth - reservedWidth)
    const maxWidth = isAgentLayout
      ? availableWidth
      : Math.min(RIGHT_SIDEBAR_MAX_WIDTH, availableWidth)

    return clamp(nextWidth, minWidth, maxWidth)
  }

  function getAgentRightSidebarMaxWidth(nextLeftWidth = effectiveLeftSidebarWidth) {
    return clampRightWidth(Number.POSITIVE_INFINITY, getShellWidth(), nextLeftWidth)
  }

  function isAgentRightSidebarMaxWidth(nextWidth: number, shellWidth: number, nextLeftWidth: number) {
    return nextWidth >= clampRightWidth(Number.POSITIVE_INFINITY, shellWidth, nextLeftWidth) - 0.5
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
      setLeftSidebarWidth(clampLeftWidth(nextWidth, shellWidth, rightSidebarWidthReservedForLeftClamp))
      return
    }

    const nextWidth = shellRect.right - pointerClientX
    const nextRightWidth = clampRightWidth(nextWidth, shellWidth, effectiveLeftSidebarWidth)
    setRightSidebarWidth(nextRightWidth)

    if (isAgentLayout) {
      setAgentRightSidebarWidthMode(
        isAgentRightSidebarMaxWidth(nextRightWidth, shellWidth, effectiveLeftSidebarWidth) ? 'max' : 'fixed',
      )
    }
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
      const message = '请先结束当前输入法组合，再执行此 Git 操作。'
      toast.warning('请先完成编辑', {
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
    const extraLabel = remainingCount > 0 ? ` 等 ${remainingCount} 个` : ''
    const message = `请先保存未保存的标签页（${dirtyNames}${extraLabel}），再${options.actionLabel}。`

    toast.warning('存在未保存的更改', {
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

    if (tabId === FIXED_FILE_TAB_ID || tabId === FIXED_GIT_TAB_ID) {
      return false
    }

    if (tabId === SETTINGS_TAB_ID) {
      setIsSettingsTabOpen(false)
      setIsSettingsTabActive(false)
      setIsAgentLayoutFixedTabActive(false)

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
    setIsAgentLayoutFixedTabActive(false)
    setGitCommitMessage('')
    setGitErrorMessage(null)
    await refreshGitState(nextPath, { silent: true })
    await window.appApi.startWorkspaceWatch(nextPath)
    await updateWorkspaceState(nextPath, { markAsLastOpened: true })
  }

  async function switchActiveWorkspace(
    project: ProjectRecord,
    options: { restoreTabs?: boolean, skipDirtyConfirm?: boolean } = {},
  ) {
    if (currentPath && normalizeFilePath(currentPath) === normalizeFilePath(project.path)) {
      await window.appApi.setActiveProject(project.id)
      setProjectState(await window.appApi.getProjectState())
      return true
    }

    if (!options.skipDirtyConfirm && !(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return false
    }

    const nextProjectState = await window.appApi.setActiveProject(project.id)
    setProjectState(nextProjectState)
    await connectWorkspace(project.path)

    if (options.restoreTabs !== false) {
      await restoreWorkspaceTabs(project.path)
    }

    return true
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

  const expandAgentEditorSurface = useCallback(() => {
    if (!isAgentLayout) {
      return
    }

    setIsAgentRightSidebarCollapsed((currentValue) => {
      if (!currentValue) {
        return currentValue
      }

      setAgentRightSidebarWidth(
        agentRightSidebarWidthMode === 'max'
          ? getAgentRightSidebarMaxWidth()
          : clampRightWidth(agentRightSidebarWidth, getShellWidth(), effectiveLeftSidebarWidth),
      )

      return false
    })
  }, [
    agentRightSidebarWidth,
    agentRightSidebarWidthMode,
    effectiveLeftSidebarWidth,
    isAgentLayout,
  ])

  const openFile = useCallback(async (
    filePath: string,
    workspacePath: string | null = currentPath,
    preferredViewMode?: LegacyWorkspaceFileViewMode,
  ) => {
    const openStartedAt = performance.now()
    recordOpenFileProfile('app:open-file:start', {
      filePath,
      preferredViewMode: preferredViewMode ?? null,
      workspacePath,
    })
    captureActiveMeoViewPosition()
    recordOpenFileProfile('app:open-file:capture-active-position:end', {
      elapsedMs: getOpenFileProfileDuration(openStartedAt),
    })
    setIsSettingsTabActive(false)
    setIsAgentLayoutFixedTabActive(false)

    const editorKindStartedAt = performance.now()
    recordOpenFileProfile('app:open-file:resolve-editor-kind:start', { filePath })
    const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)
    recordOpenFileProfile('app:open-file:resolve-editor-kind:end', {
      durationMs: getOpenFileProfileDuration(editorKindStartedAt),
      editorKind,
    })

    if (!editorKind) {
      toast.warning(`Cannot open ${getBaseName(filePath)} yet`, {
        description: 'Only text files can open in tabs right now. This file looks binary or unsupported.',
      })
      setStatusMessage(`${getBaseName(filePath)} is not supported yet`)
      recordOpenFileProfile('app:open-file:unsupported:end', {
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
      })
      return
    }

    expandAgentEditorSurface()

    try {
      const targetViewMode = resolveWorkspaceFileViewMode(filePath, editorKind, preferredViewMode)
      recordOpenFileProfile('app:open-file:resolve-view-mode:end', {
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
        targetViewMode,
      })
      const existingTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => (
          tab.kind === 'file'
          && tab.filePath === filePath
          && tab.viewMode === targetViewMode
        ),
      )

      if (existingTab) {
        const activateStartedAt = performance.now()
        recordOpenFileProfile('app:open-file:existing-tab:activate:start', { tabId: existingTab.id })
        activateTab(existingTab.id)
        recordOpenFileProfile('app:open-file:existing-tab:activate:end', {
          durationMs: getOpenFileProfileDuration(activateStartedAt),
        })

        if (isLeftSidebarDrawer) {
          setIsLeftDrawerOpen(false)
        }

        if (workspacePath) {
          const updateStateStartedAt = performance.now()
          recordOpenFileProfile('app:open-file:update-workspace-state:start', { filePath, workspacePath })
          await updateWorkspaceState(workspacePath, { lastFilePath: filePath })
          recordOpenFileProfile('app:open-file:update-workspace-state:end', {
            durationMs: getOpenFileProfileDuration(updateStateStartedAt),
          })
        }

        setStatusMessage(`${getBaseName(filePath)} focused`)
        recordOpenFileProfile('app:open-file:existing-tab:end', {
          elapsedMs: getOpenFileProfileDuration(openStartedAt),
        })
        return
      }

      const readStartedAt = performance.now()
      recordOpenFileProfile('app:open-file:read-file:start', { filePath })
      const fileContent = await window.appApi.readWorkspaceFile(filePath)
      recordOpenFileProfile('app:open-file:read-file:end', {
        chars: fileContent.length,
        durationMs: getOpenFileProfileDuration(readStartedAt),
      })
      const openTabStartedAt = performance.now()
      recordOpenFileProfile('app:open-file:open-tab:start', {
        editorKind,
        filePath,
        targetViewMode,
      })
      openTab({
        filePath,
        content: fileContent,
        editorKind,
        viewMode: targetViewMode,
      })
      recordOpenFileProfile('app:open-file:open-tab:end', {
        durationMs: getOpenFileProfileDuration(openTabStartedAt),
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open file.'
      toast.danger(`Failed to open ${getBaseName(filePath)}`, {
        description: message,
      })
      setStatusMessage(message)
      recordOpenFileProfile('app:open-file:error:end', {
        elapsedMs: getOpenFileProfileDuration(openStartedAt),
        message,
      })
      return
    }

    if (workspacePath) {
      const updateStateStartedAt = performance.now()
      recordOpenFileProfile('app:open-file:update-workspace-state:start', { filePath, workspacePath })
      await updateWorkspaceState(workspacePath, { lastFilePath: filePath })
      recordOpenFileProfile('app:open-file:update-workspace-state:end', {
        durationMs: getOpenFileProfileDuration(updateStateStartedAt),
      })
    }

    if (isLeftSidebarDrawer) {
      setIsLeftDrawerOpen(false)
    }

    setStatusMessage(`${getBaseName(filePath)} opened`)
    recordOpenFileProfile('app:open-file:end', {
      elapsedMs: getOpenFileProfileDuration(openStartedAt),
    })
  }, [
    activateTab,
    captureActiveMeoViewPosition,
    currentPath,
    expandAgentEditorSurface,
    isLeftSidebarDrawer,
    openTab,
  ])

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
      setIsAgentLayoutFixedTabActive(false)
      expandAgentEditorSurface()
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
  }, [
    activateTab,
    captureActiveMeoViewPosition,
    currentPath,
    expandAgentEditorSurface,
    isRightSidebarDrawer,
    openFile,
  ])

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
    setIsAgentLayoutFixedTabActive(false)

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
      view?: 'meo' | 'monaco'
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

      if (options?.view === 'meo' && supportsMeoEditor(change.path, diff.editorKind)) {
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
      setIsAgentLayoutFixedTabActive(false)

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
      setIsAgentLayoutFixedTabActive(false)
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
    const nextTabs = dedupeWorkspaceTabs(settledTabs.filter((tab): tab is WorkspaceFileTab => tab !== null))
    const requestedActiveId = storedState.activePath ?? fallbackPath ?? null
    const nextActiveId = nextTabs.some((tab) => tab.id === requestedActiveId || tab.filePath === requestedActiveId)
      ? nextTabs.find((tab) => tab.id === requestedActiveId || tab.filePath === requestedActiveId)?.id ?? null
      : nextTabs[0]?.id ?? null

    replaceTabs(nextTabs, nextActiveId)
    setIsSettingsTabActive(false)
    setIsAgentLayoutFixedTabActive(false)
    const nextActiveFileTab = nextTabs.find((tab) => tab.id === nextActiveId && tab.kind === 'file')
    await updateWorkspaceState(workspacePath, { lastFilePath: nextActiveFileTab?.filePath ?? null })
  }

  async function handlePickWorkspace() {
    if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return
    }

    setIsPickingWorkspace(true)
    try {
      const nextProjectState = await window.appApi.addExistingProject()
      if (nextProjectState) {
        setProjectState(nextProjectState)
        const nextActiveProject = nextProjectState.projects.find((project) => project.id === nextProjectState.activeProjectId)

        if (nextActiveProject) {
          await connectWorkspace(nextActiveProject.path)
          await restoreWorkspaceTabs(nextActiveProject.path, nextActiveProject.lastFilePath)
          setStatusMessage('项目已打开')
        }
      }
    } finally {
      setIsPickingWorkspace(false)
    }
  }

  function openProjectMenu(mode: ProjectMenuMode, anchorRect?: ProjectMenuAnchorRect) {
    setProjectMenuAnchorRect(anchorRect ? serializeProjectMenuAnchorRect(anchorRect) : null)
    setProjectMenuSearch('')
    setProjectMenuMode(mode)
  }

  function closeProjectMenu() {
    setProjectMenuAnchorRect(null)
    setProjectMenuMode(null)
    setProjectMenuSearch('')
  }

  function openNewProjectDialog() {
    setNewProjectName('')
    setIsNewProjectDialogOpen(true)
    closeProjectMenu()
  }

  async function activateProjectFromState(
    nextProjectState: ProjectState,
    options: { restoreTabs?: boolean, startAgentNewSession?: boolean } = {},
  ) {
    setProjectState(nextProjectState)
    const nextActiveProject = nextProjectState.projects.find((project) => project.id === nextProjectState.activeProjectId)

    if (!nextActiveProject) {
      return false
    }

    let agentSessionRequestId: number | null = null

    if (options.startAgentNewSession) {
      agentProjectSessionRequestIdRef.current += 1
      agentSessionRequestId = agentProjectSessionRequestIdRef.current
      flushSync(() => {
        setPendingAgentProjectSessionRequest({
          kind: 'new',
          projectId: nextActiveProject.id,
          requestId: agentSessionRequestId!,
        })
      })
    }

    try {
      await connectWorkspace(nextActiveProject.path)

      if (options.restoreTabs !== false) {
        await restoreWorkspaceTabs(nextActiveProject.path, nextActiveProject.lastFilePath)
      }

      return true
    } catch (error) {
      if (agentSessionRequestId !== null) {
        setPendingAgentProjectSessionRequest((currentValue) => (
          currentValue?.requestId === agentSessionRequestId ? null : currentValue
        ))
      }
      throw error
    }
  }

  async function handleCreateEmptyProject(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    const trimmedName = newProjectName.trim()

    if (!trimmedName) {
      return
    }

    if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return
    }

    setIsProjectActionBusy(true)
    try {
      const nextProjectState = await window.appApi.createEmptyProject(trimmedName)
      await activateProjectFromState(nextProjectState)
      setIsNewProjectDialogOpen(false)
      setNewProjectName('')
      setStatusMessage('项目已创建')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create project.'
      toast.danger('创建项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function handleAddExistingProject() {
    if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return
    }

    setIsProjectActionBusy(true)
    try {
      const nextProjectState = await window.appApi.addExistingProject()

      if (!nextProjectState) {
        return
      }

      await activateProjectFromState(nextProjectState, {
        startAgentNewSession: projectMenuMode === 'agent-new-switch',
      })
      closeProjectMenu()
      setStatusMessage('项目已打开')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open project.'
      toast.danger('打开项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function handleSelectProject(project: ProjectRecord) {
    setIsProjectActionBusy(true)
    try {
      if (projectMenuMode === 'agent-new-switch') {
        const didSwitch = await requestAgentProjectSession(project, { kind: 'new' })
        if (didSwitch) {
          closeProjectMenu()
          setStatusMessage(`${project.name} 已激活`)
        }
        return
      }

      const didSwitch = await switchActiveWorkspace(project)
      if (didSwitch) {
        closeProjectMenu()
        setStatusMessage(`${project.name} 已激活`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to switch project.'
      toast.danger('切换项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function handleRemoveProject(project: ProjectRecord) {
    const confirmed = await requestConfirm({
      title: '移除项目',
      message: `要从项目列表移除“${project.name}”吗？\n\n这不会删除本地文件夹。`,
      confirmLabel: '移除',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    setIsProjectActionBusy(true)
    try {
      const wasActive = projectState.activeProjectId === project.id
      const nextProjectState = await window.appApi.removeProject(project.id)
      setProjectState(nextProjectState)

      if (wasActive) {
        const nextActiveProject = nextProjectState.projects.find((candidate) => candidate.id === nextProjectState.activeProjectId)
        if (nextActiveProject) {
          await connectWorkspace(nextActiveProject.path)
          await restoreWorkspaceTabs(nextActiveProject.path, nextActiveProject.lastFilePath)
        } else {
          await window.appApi.stopWorkspaceWatch()
          setCurrentPath(null)
          setTree([])
          resetOpenTabs()
          setAgentWorkspaceState(null)
        }
      }

      setStatusMessage('项目已移除')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to remove project.'
      toast.danger('移除项目失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function handleShowProjectInFolder(project: ProjectRecord) {
    try {
      await window.appApi.openPath(project.path)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open project folder.'
      toast.danger('打开文件夹失败', { description: message })
      setStatusMessage(message)
    }
  }

  async function requestAgentProjectSession(
    project: ProjectRecord,
    request: { kind: 'new' } | { kind: 'session', sessionPath: string },
  ) {
    agentProjectSessionRequestIdRef.current += 1
    const requestId = agentProjectSessionRequestIdRef.current
    const nextRequest = request.kind === 'session'
      ? {
          kind: 'session' as const,
          projectId: project.id,
          requestId,
          sessionPath: request.sessionPath,
        }
      : {
          kind: 'new' as const,
          projectId: project.id,
          requestId,
        }

    flushSync(() => {
      setPendingAgentProjectSessionRequest(nextRequest)
    })

    try {
      const didSwitch = await switchActiveWorkspace(project)

      if (!didSwitch) {
        setPendingAgentProjectSessionRequest((currentValue) => (
          currentValue?.requestId === requestId ? null : currentValue
        ))
        return false
      }

      return true
    } catch (error) {
      setPendingAgentProjectSessionRequest((currentValue) => (
        currentValue?.requestId === requestId ? null : currentValue
      ))
      const message = error instanceof Error ? error.message : 'Unable to open project conversation.'
      toast.danger('打开对话失败', { description: message })
      setStatusMessage(message)
      return false
    }
  }

  async function handleOpenProjectSession(project: ProjectRecord, sessionPath: string) {
    await requestAgentProjectSession(project, { kind: 'session', sessionPath })
  }

  async function handleStartProjectSession(project: ProjectRecord) {
    await requestAgentProjectSession(project, { kind: 'new' })
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

  function renderWorkspaceTreePanel() {
    return (
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
            onOpenInCodeEditor={(filePath) => {
              void openFile(filePath, currentPath, 'code')
            }}
            onRenameNode={(node, nextName) => handleRenameNode(node, nextName)}
            onDeleteNode={(node) => handleDeleteNode(node)}
            onMoveNode={(node, targetDirectoryPath) => handleMoveNode(node, targetDirectoryPath)}
          />
        </AppScrollArea>
      </div>
    )
  }

  function renderProjectMenu() {
    if (!projectMenuMode) {
      return null
    }

    const isSwitchMenu = projectMenuMode === 'editor-switch' || projectMenuMode === 'agent-new-switch'
    const menuStyle = resolveProjectMenuStyle(projectMenuMode, projectMenuAnchorRect, filteredProjectMenuProjects.length)
    const projectMenuActions = (
      <div className='project-menu-actions'>
        <button
          type='button'
          className='project-menu-action'
          disabled={isProjectActionBusy}
          onClick={openNewProjectDialog}
        >
          <NewFolderLine size={18} />
          <span>新建空白项目</span>
        </button>
        <button
          type='button'
          className='project-menu-action'
          disabled={isProjectActionBusy}
          onClick={() => {
            void handleAddExistingProject()
          }}
        >
          <FolderOpenLine size={18} />
          <span>使用现有文件夹</span>
        </button>
      </div>
    )

    return (
      <div
        className='project-menu-backdrop'
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) {
            closeProjectMenu()
          }
        }}
      >
        <div
          className={`project-menu project-menu-${projectMenuMode}`}
          role='dialog'
          aria-label={isSwitchMenu ? '切换项目' : '添加项目'}
          style={menuStyle}
        >
          {isSwitchMenu ? (
            <>
              <label className='project-menu-search'>
                <SearchLine size={16} />
                <input
                  autoFocus
                  value={projectMenuSearch}
                  placeholder='搜索项目'
                  onChange={(event) => setProjectMenuSearch(event.target.value)}
                />
              </label>
              <AppScrollArea
                className='project-menu-list'
                contentClassName='project-menu-list-content'
              >
                {filteredProjectMenuProjects.map((project) => {
                  const isActive = project.id === projectState.activeProjectId

                  return (
                    <button
                      type='button'
                      key={project.id}
                      className={`project-menu-project${isActive ? ' is-active' : ''}`}
                      disabled={isProjectActionBusy}
                      onClick={() => {
                        void handleSelectProject(project)
                      }}
                    >
                      <FolderLine size={17} />
                      <span className='project-menu-project-name'>{project.name}</span>
                      {isActive ? <CheckLine className='project-menu-project-check' size={18} /> : null}
                    </button>
                  )
                })}
                {filteredProjectMenuProjects.length === 0 ? (
                  <div className='project-menu-empty'>没有匹配项目</div>
                ) : null}
              </AppScrollArea>
              {projectMenuActions}
            </>
          ) : projectMenuActions}
        </div>
      </div>
    )
  }

  function renderNewProjectDialog() {
    return (
      <Modal.Backdrop
        isOpen={isNewProjectDialogOpen}
        onOpenChange={(isOpen) => {
          setIsNewProjectDialogOpen(isOpen)
        }}
      >
        <Modal.Container className='project-create-modal-container'>
          <Modal.Dialog
            aria-label='新建空白项目'
            className={`project-create-modal ${resolvedTheme === 'dark' ? 'dark' : ''}`}
          >
            <Modal.CloseTrigger className='project-create-modal-close' aria-label='关闭'>
              <Icon icon='lucide:x' width={16} height={16} />
            </Modal.CloseTrigger>
            <Modal.Body>
              <form className='project-create-form' onSubmit={(event) => void handleCreateEmptyProject(event)}>
                <div className='project-create-heading'>
                  <h2>新建空白项目</h2>
                  <p>创建后会自动切换到这个项目。</p>
                </div>
                <label className='project-create-field'>
                  <span>项目名称</span>
                  <input
                    autoFocus
                    value={newProjectName}
                    placeholder='Untitled Project'
                    onChange={(event) => setNewProjectName(event.target.value)}
                  />
                </label>
                <div className='project-create-footer'>
                  <Button variant='tertiary' type='button' onPress={() => setIsNewProjectDialogOpen(false)}>
                    取消
                  </Button>
                  <Button variant='primary' type='submit' isDisabled={!newProjectName.trim() || isProjectActionBusy}>
                    创建
                  </Button>
                </div>
              </form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    )
  }

  function renderProjectBootstrap() {
    return (
      <div className='project-bootstrap'>
        <div className='project-bootstrap-panel'>
          <div className='project-bootstrap-logo' aria-hidden='true'>
            <img src='./branding/logo.svg' alt='' />
          </div>
          <div className='project-bootstrap-copy'>
            <h1>选择一个项目开始</h1>
            <p>Aryn 会把编辑器、Git、文件树和 Agent 对话绑定到当前 active 项目。</p>
          </div>
          <div className='project-bootstrap-actions'>
            <Button
              variant='primary'
              onPress={openNewProjectDialog}
              isDisabled={isProjectActionBusy}
            >
              <NewFolderLine className='mr-2' size={16} />
              新建空白项目
            </Button>
            <Button
              variant='outline'
              onPress={() => {
                void handleAddExistingProject()
              }}
              isDisabled={isProjectActionBusy}
            >
              <FolderOpenLine className='mr-2' size={16} />
              使用现有文件夹
            </Button>
          </div>
        </div>
      </div>
    )
  }

  function renderGitPanel() {
    return (
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
          onOpenMeoDiff={(change) => {
            void openGitDiff(change, { mode: 'split', view: 'meo' })
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
    )
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
    setIsAgentLayoutFixedTabActive(false)
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
        ? '暂存这个差异块'
        : action === 'unstage'
          ? '取消暂存这个差异块'
          : '放弃这个差异块',
      filePaths: [change.path],
    }))) {
      return
    }

    const statusMessage = action === 'stage'
      ? 'Git 差异块已暂存'
      : action === 'unstage'
        ? 'Git 差异块已取消暂存'
        : 'Git 差异块已还原'
    const busyLabel = action === 'stage'
      ? '正在暂存差异块...'
      : action === 'unstage'
        ? '正在取消暂存差异块...'
        : '正在还原差异块...'

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

    if (tabId === FIXED_FILE_TAB_ID || tabId === FIXED_GIT_TAB_ID) {
      setIsSettingsTabActive(false)
      setActiveAgentLayoutFixedTab(tabId === FIXED_GIT_TAB_ID ? 'git' : 'file')
      setIsAgentLayoutFixedTabActive(true)
      return
    }

    if (tabId === SETTINGS_TAB_ID) {
      setIsSettingsTabOpen(true)
      setIsSettingsTabActive(true)
      setIsAgentLayoutFixedTabActive(false)
      return
    }

    setIsSettingsTabActive(false)
    setIsAgentLayoutFixedTabActive(false)
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

  useEffect(() => {
    if (isAgentLayout || displayActiveTabId !== FIXED_FILE_TAB_ID && displayActiveTabId !== FIXED_GIT_TAB_ID) {
      return
    }

    setIsAgentLayoutFixedTabActive(false)
    setActiveAgentLayoutFixedTab('file')
  }, [displayActiveTabId, isAgentLayout])

  async function handleInitializeGit() {
    if (!currentPath) {
      return
    }

    await runGitAction('正在初始化仓库...', async () => {
      const nextState = await window.appApi.initializeGitRepository(currentPath)
      setGitRepositoryState(nextState)
      setStatusMessage('Git 仓库已初始化')
    })
  }

  async function handleStageGitPaths(filePaths: string[]) {
    if (!currentPath || filePaths.length === 0) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: '暂存更改',
      filePaths,
    }))) {
      return
    }

    await runGitAction('正在暂存更改...', async () => {
      const nextState = await window.appApi.stageGitPaths(currentPath, filePaths)
      setGitRepositoryState(nextState)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Git 更改已暂存')
    })
  }

  async function handleUnstageGitPaths(filePaths: string[]) {
    if (!currentPath || filePaths.length === 0) {
      return
    }

    await runGitAction('正在取消暂存...', async () => {
      const nextState = await window.appApi.unstageGitPaths(currentPath, filePaths)
      setGitRepositoryState(nextState)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Git 更改已取消暂存')
    })
  }

  async function handleDiscardGitChange(change: GitChangeItem) {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: '放弃 Git 更改',
      filePaths: [change.path],
    }))) {
      return
    }

    const confirmed = await requestConfirm({
      title: '放弃更改',
      message: `要放弃 "${change.relativePath}" 当前的${change.scope === 'staged' ? '已暂存' : '未暂存'}更改吗？`,
      confirmLabel: '放弃',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction('正在放弃更改...', async () => {
      const nextState = await window.appApi.discardGitChange(currentPath, change)
      setGitRepositoryState(nextState)
      await loadTree(currentPath)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage(`${change.relativePath} 已还原`)
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
      actionLabel: '放弃 Git 更改',
      filePaths: changes.map((change) => change.path),
    }))) {
      return
    }

    const confirmed = await requestConfirm({
      title: '放弃更改',
      message: `要放弃 ${changes.length} 个工作区更改吗？`,
      confirmLabel: '全部放弃',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction('正在放弃更改...', async () => {
      await Promise.all(changes.map(async (change) => {
        await window.appApi.discardGitChange(currentPath, change)
      }))
      await performWorkspaceRefresh(currentPath, {
        refreshGit: true,
        refreshTree: true,
      })
      setStatusMessage(`${changes.length} 个更改已放弃`)
    })
  }

  async function handleCommitGitChanges() {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: '创建提交',
    }))) {
      return
    }

    await runGitAction('正在创建提交...', async () => {
      const nextState = await window.appApi.commitGitChanges(currentPath, gitCommitMessage)
      setGitRepositoryState(nextState)
      setGitCommitMessage('')
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('提交已创建')
    })
  }

  async function handleCommitAndSyncGitChanges() {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: '提交并同步',
    }))) {
      return
    }

    await runGitAction('正在提交并同步...', async () => {
      const nextState = await window.appApi.commitAndSyncGitChanges(currentPath, gitCommitMessage)
      setGitRepositoryState(nextState)
      setGitCommitMessage('')
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('提交并同步已完成')
    })
  }

  async function handlePushGitChanges() {
    if (!currentPath) {
      return
    }

    await runGitAction('正在推送更改...', async () => {
      const nextState = await window.appApi.pushGitChanges(currentPath)
      setGitRepositoryState(nextState)
      setStatusMessage('Git 更改已推送')
    })
  }

  async function handlePullGitChanges() {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: '拉取 Git 更改',
    }))) {
      return
    }

    await runGitAction('正在拉取更改...', async () => {
      const nextState = await window.appApi.pullGitChanges(currentPath)
      setGitRepositoryState(nextState)
      await loadTree(currentPath)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('Git 更改已拉取')
    })
  }

  async function handleDiscardAllGitChanges() {
    if (!currentPath || !gitRepositoryState?.unstagedChanges.length) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: '放弃所有 Git 更改',
      filePaths: gitRepositoryState.unstagedChanges.map((change) => change.path),
    }))) {
      return
    }

    const confirmed = await requestConfirm({
      title: '放弃所有更改',
      message: '要放弃所有工作区更改吗？\n\n这会还原已跟踪文件，并删除未跟踪文件。',
      confirmLabel: '全部放弃',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    await runGitAction('正在放弃所有工作区更改...', async () => {
      const nextState = await window.appApi.discardAllGitChanges(currentPath)
      setGitRepositoryState(nextState)
      await loadTree(currentPath)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('工作区更改已放弃')
    })
  }

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const [
          persistedIconTheme,
          persistedIconThemeOptions,
        ] = await Promise.all([
          window.appApi.getWorkspaceIconTheme(),
          window.appApi.getWorkspaceIconThemeCatalog(),
        ])
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

      const nextProjectState = await window.appApi.getProjectState()

      if (cancelled) {
        return
      }

      setProjectState(nextProjectState)
      setHasLoadedProjectState(true)
      const activeProject = nextProjectState.projects.find((project) => project.id === nextProjectState.activeProjectId) ?? null

      if (!activeProject) {
        setStatusMessage('创建或打开项目以开始。')
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
    let mounted = true

    void window.appApi.isWindowMaximized().then(({ isFullScreen }) => {
      if (mounted) {
        setIsWindowFullScreen(isFullScreen)
      }
    })

    const unsubscribe = window.appApi.onWindowStateChanged(({ isFullScreen }) => {
      setIsWindowFullScreen(isFullScreen)
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

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

    writeStoredTabState(currentPath, {
      activePath: useWorkspaceStore.getState().activeTabId,
      entries: storedEntries,
      paths: storedEntries.map((entry) => entry.path),
    })
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
  }, [
    activeResizePanel,
    isLeftSidebarVisible,
    isRightSidebarVisible,
    leftSidebarWidth,
    rightSidebarWidth,
    rightSidebarWidthReservedForLeftClamp,
  ])

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
    const timeout = window.setTimeout(() => {
      void window.appApi.updateLayoutState({
        activeLeftSidebarTab,
        agentRightSidebarCollapsed: isAgentRightSidebarCollapsed,
        agentRightSidebarWidth,
        agentRightSidebarWidthMode,
        editorRightSidebarCollapsed: isEditorRightSidebarCollapsed,
        editorRightSidebarWidth,
        gitPanelHeight,
        gitPanelLayout,
        leftSidebarCollapsed: isLeftSidebarCollapsed,
        leftSidebarWidth,
      }).catch(() => undefined)
    }, 180)

    return () => window.clearTimeout(timeout)
  }, [
    activeLeftSidebarTab,
    agentRightSidebarWidth,
    agentRightSidebarWidthMode,
    editorRightSidebarWidth,
    gitPanelHeight,
    gitPanelLayout,
    isAgentRightSidebarCollapsed,
    isEditorRightSidebarCollapsed,
    isLeftSidebarCollapsed,
    leftSidebarWidth,
  ])

  useEffect(() => {
    const nextLeftWidth = clampLeftWidth(leftSidebarWidth, shellWidth, rightSidebarWidthReservedForLeftClamp)
    const nextRightWidth = isRightSidebarVisible
      ? clampRightWidth(rightSidebarWidth, shellWidth, isLeftSidebarVisible ? nextLeftWidth : 0)
      : rightSidebarWidth

    if (nextLeftWidth !== leftSidebarWidth) {
      setLeftSidebarWidth(nextLeftWidth)
    }

    if (nextRightWidth !== rightSidebarWidth) {
      setRightSidebarWidth(nextRightWidth)
    }
  }, [
    isLeftSidebarVisible,
    isRightSidebarVisible,
    leftSidebarWidth,
    rightSidebarWidth,
    rightSidebarWidthReservedForLeftClamp,
    shellWidth,
  ])

  useEffect(() => {
    setGitPanelHeight((currentValue) => clampGitHeight(currentValue))
  }, [leftSidebarWidth, isLeftSidebarVisible])

  useEffect(() => {
    if (!isAgentLayout || isRightSidebarDrawer || !isRightSidebarVisible) {
      return
    }

    if (agentRightSidebarWidthMode !== 'max') {
      return
    }

    const nextWidth = getAgentRightSidebarMaxWidth(effectiveLeftSidebarWidth)
    if (nextWidth !== rightSidebarWidth) {
      setRightSidebarWidth(nextWidth)
    }
  }, [agentRightSidebarWidthMode, effectiveLeftSidebarWidth, isAgentLayout, isRightSidebarDrawer, isRightSidebarVisible, rightSidebarWidth, shellWidth])

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
          void closeEditorTab(SETTINGS_TAB_ID)
          return
        }

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
    const currentProject = currentPath
      ? projectState.projects.find((project) => project.id === projectState.activeProjectId)
        ?? projectState.projects.find((project) => normalizeFilePath(project.path) === normalizeFilePath(currentPath))
      : null

    if (currentPath && currentProject) {
      agentProjectSessionRequestIdRef.current += 1
      setPendingAgentProjectSessionRequest({
        kind: 'session',
        projectId: currentProject.id,
        requestId: agentProjectSessionRequestIdRef.current,
        sessionPath,
      })
    }
  }, [currentPath, projectState.activeProjectId, projectState.projects])

  const handleCloseCommandPalette = useCallback(() => setIsCommandPaletteOpen(false), [])
  const handleOpenCommandPaletteFromChrome = useCallback(() => {
    setIsLeftDrawerOpen(false)
    setIsRightDrawerOpen(false)
    setIsCommandPaletteOpen(true)
  }, [])
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
    if (!isRightDrawerOpen || !isRightSidebarDrawer) {
      setRightDrawerDragRegion(null)
      return
    }

    let cancelled = false
    let rafId = 0
    let frameCount = 0
    let stableFrameCount = 0
    let previousRectSignature = ''

    const publishDragRegion = (rect: DOMRect) => {
      setRightDrawerDragRegion((currentRegion) => {
        const nextRegion = {
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
        }

        if (
          currentRegion
          && currentRegion.height === nextRegion.height
          && currentRegion.left === nextRegion.left
          && currentRegion.top === nextRegion.top
          && currentRegion.width === nextRegion.width
        ) {
          return currentRegion
        }

        return nextRegion
      })
    }

    const tick = () => {
      if (cancelled) {
        return
      }

      frameCount += 1

      const dragSpacer = rightDrawerSurfaceRef.current?.querySelector<HTMLElement>('.agent-threadbar-drag-spacer, .file-tabs-drag-spacer')
      if (!dragSpacer) {
        if (frameCount < DRAWER_INTERACTION_REFRESH_MAX_FRAMES) {
          rafId = window.requestAnimationFrame(tick)
        }
        return
      }

      const rect = dragSpacer.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        if (frameCount < DRAWER_INTERACTION_REFRESH_MAX_FRAMES) {
          rafId = window.requestAnimationFrame(tick)
        }
        return
      }

      publishDragRegion(rect)

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
        return
      }

      rafId = window.requestAnimationFrame(tick)
    }

    rafId = window.requestAnimationFrame(tick)

    const dragSpacer = rightDrawerSurfaceRef.current?.querySelector<HTMLElement>('.agent-threadbar-drag-spacer, .file-tabs-drag-spacer')
    const resizeObserver = typeof ResizeObserver !== 'undefined' && dragSpacer
      ? new ResizeObserver(() => {
          publishDragRegion(dragSpacer.getBoundingClientRect())
        })
      : null

    resizeObserver?.observe(dragSpacer as Element)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
    }
  }, [isRightDrawerOpen, isRightSidebarDrawer, shellWidth])

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

    setIsRightSidebarCollapsed((currentValue) => {
      if (currentValue && isAgentLayout) {
        setAgentRightSidebarWidth(
          agentRightSidebarWidthMode === 'max'
            ? getAgentRightSidebarMaxWidth()
            : clampRightWidth(agentRightSidebarWidth, getShellWidth(), effectiveLeftSidebarWidth),
        )
      }

      return !currentValue
    })
  }, [
    agentRightSidebarWidth,
    agentRightSidebarWidthMode,
    effectiveLeftSidebarWidth,
    handleRightDrawerOpenChange,
    isAgentLayout,
    isRightDrawerOpen,
    isRightSidebarDrawer,
  ])

  function expandCollapsedAssistantSurface() {
    if (isRightSidebarDrawer) {
      handleRightDrawerOpenChange(true)
      return
    }

    setIsRightSidebarCollapsed((currentValue) => {
      if (!currentValue) {
        return currentValue
      }

      if (isAgentLayout) {
        setAgentRightSidebarWidth(
          agentRightSidebarWidthMode === 'max'
            ? getAgentRightSidebarMaxWidth()
            : clampRightWidth(agentRightSidebarWidth, getShellWidth(), effectiveLeftSidebarWidth),
        )
      }

      return false
    })
  }

  function handleCollapsedAgentFixedTabClick(tab: AgentLayoutFixedTab) {
    expandCollapsedAssistantSurface()

    if (tab === 'git') {
      activateFileTab(FIXED_GIT_TAB_ID)
      return
    }

    activateFileTab(displayActiveTab?.kind === 'file' ? displayActiveTab.id : FIXED_FILE_TAB_ID)
  }

  function renderWorkspaceSidebar(surfaceMode: PanelSurfaceMode) {
    const isDrawerSurface = surfaceMode === 'drawer'

    return (
      <div
        ref={isDrawerSurface ? leftDrawerSurfaceRef : undefined}
        className={`workspace-sidebar-surface${isDrawerSurface ? ' is-drawer' : ''}`}
        data-platform={shellPlatform}
        style={isDrawerSurface ? shellChromeVars : undefined}
      >
        <div className={`section-title workspace-section-title${isDrawerSurface ? ' is-drawer-surface' : ''}`}>
          <button
            type='button'
            onClick={(event) => {
              openProjectMenu('editor-switch', event.currentTarget.getBoundingClientRect())
            }}
            disabled={isPickingWorkspace}
            className='section-title-text'
            aria-label={isPickingWorkspace ? 'Opening workspace' : '切换项目'}
          >
            <span className='section-title-label'>{activeProject?.name ?? workspaceLabel}</span>
          </button>

          <div className='section-title-drag-spacer' aria-hidden='true' />
        </div>

        <div ref={isDrawerSurface ? undefined : leftSidebarBodyRef} className='sidebar-stack'>
          {isAgentLayout ? (
            <AgentSessionTree
              onRequestClose={isDrawerSurface ? () => setIsLeftDrawerOpen(false) : undefined}
            />
          ) : (
            <>
              <Tabs
                aria-label='工作区面板'
                className='sidebar-vertical-tabs'
                orientation='vertical'
                selectedKey={activeLeftSidebarTab}
                onSelectionChange={(key) => {
                  if (key === 'file' || key === 'git') {
                    setActiveLeftSidebarTab(key)
                  }
                }}
              >
                <Tabs.ListContainer className='sidebar-vertical-tabs-list-container'>
                  <Tabs.List aria-label='工作区面板' className='sidebar-vertical-tabs-list'>
                    <Tabs.Tab id='file' className='sidebar-vertical-tab'>
                      <FolderLine size={16} className='sidebar-vertical-tab-icon' />
                      <span className='sidebar-vertical-tab-label'>文件</span>
                      <Tabs.Indicator className='sidebar-vertical-tab-indicator' />
                    </Tabs.Tab>
                    <Tabs.Tab id='git' className='sidebar-vertical-tab'>
                      <GitBranchLine size={16} className='sidebar-vertical-tab-icon' />
                      <span className='sidebar-vertical-tab-label'>更改</span>
                      <Tabs.Indicator className='sidebar-vertical-tab-indicator' />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>

                <Tabs.Panel id='file' className='sidebar-vertical-tab-panel'>
                  {renderWorkspaceTreePanel()}
                </Tabs.Panel>
                <Tabs.Panel id='git' className='sidebar-vertical-tab-panel'>
                  {renderGitPanel()}
                </Tabs.Panel>
              </Tabs>
            </>
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

    if (isAgentLayout) {
      return <AgentChatSurface />
    }

    return (
      <AgentSidebar
        externalSessionRequest={pendingAgentProjectSessionRequest}
        onExternalSessionRequestHandled={(requestId) => {
          setPendingAgentProjectSessionRequest((currentValue) => (
            currentValue?.requestId === requestId ? null : currentValue
          ))
        }}
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
        workspaceState={agentWorkspaceState}
        onWorkspaceStateChange={setAgentWorkspaceState}
        onOpenProjectAddMenu={(anchorRect) => openProjectMenu('agent-add', anchorRect)}
        onOpenProjectSwitchMenu={(anchorRect, options) => openProjectMenu(options?.startNewSession ? 'agent-new-switch' : 'editor-switch', anchorRect)}
        onOpenProjectFolder={handleShowProjectInFolder}
        onOpenProjectSession={handleOpenProjectSession}
        onRemoveProject={handleRemoveProject}
        onStartProjectSession={handleStartProjectSession}
        projectState={projectState}
      />
    )
  }

  function renderEditorSurface() {
    return (
      <div className='editor-frame'>
        <FileTabs
          activeTabId={displayActiveTabId}
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

        <div className='editor-content-shell' id='editor-content-panel'>
          {activeFixedPanelTab?.fixedTabKind === 'file-panel' ? renderWorkspaceTreePanel() : null}
          {activeFixedPanelTab?.fixedTabKind === 'git-panel' ? renderGitPanel() : null}
          {isSettingsTabActive ? (
            <SettingsDialog
              activeSection={settingsSection}
              agentState={agentWorkspaceState}
              iconTheme={iconTheme}
              iconThemeOptions={iconThemeOptions}
              isIconThemeBusy={isImportingIconTheme || isApplyingIconTheme}
              resolvedTheme={resolvedTheme}
              workspacePath={currentPath}
              onAgentStateChange={setAgentWorkspaceState}
              onSectionChange={setSettingsSection}
              onSelectIconTheme={handleSelectWorkspaceIconTheme}
              onStatusMessage={setStatusMessage}
            />
          ) : !activeFixedPanelTab && !activeFileTab && !activeDiffTab ? (
            <div className='editor-empty-state'>
              <div className='editor-empty-content'>
                <div className='editor-empty-logo-shell' aria-hidden='true'>
                  <img className='editor-empty-logo' src='./branding/logo.svg' alt='' />
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

          {shouldRenderWorkspaceEditor && activeDiffTab ? (
            <Suspense fallback={<EditorLoadingState label='Loading diff editor...' />}>
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
            </Suspense>
          ) : null}

          {shouldRenderWorkspaceEditor && activeFileTab && currentEditorKind === 'prose' && currentFileViewMode === 'meo' ? (
            <Suspense fallback={<EditorLoadingState />}>
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

          {shouldRenderWorkspaceEditor && activeFileTab && (
            (currentEditorKind === 'code' && currentFileViewMode === 'code')
            || (currentEditorKind === 'prose' && currentFileViewMode === 'code')
          ) ? (
            <Suspense fallback={<EditorLoadingState />}>
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
          ) : null}

          {shouldRenderWorkspaceEditor && activeFileTab && currentEditorKind === 'code' && currentFileViewMode === 'preview' ? (
            <HtmlPreview
              content={currentFileContent}
              filePath={activeFileTab.filePath}
            />
          ) : null}
        </div>
      </div>
    )
  }

  const leftChromeControls = (
      <div
        className='left-chrome-actions'
        data-overlay-elevated={isLeftPanelOverlayElevated ? 'true' : 'false'}
        data-react-aria-top-layer={isLeftPanelOverlayTopLayer ? 'true' : undefined}
      >
        <button
          type='button'
          className='panel-toggle-button'
          aria-label={isLeftSidebarDrawer
            ? (isLeftDrawerOpen ? 'Close workspace panel' : 'Open workspace panel')
            : (isLeftSidebarVisible ? 'Collapse workspace sidebar' : 'Expand workspace sidebar')}
          onClick={() => {
            if (isLeftSidebarDrawer) {
              handleLeftDrawerOpenChange(!isLeftDrawerOpen)
              return
            }

            if (isLeftSidebarVisible) {
              setIsLeftSidebarCollapsed(true)
              return
            }

            setIsLeftSidebarCollapsed(false)
          }}
        >
          <span className='panel-toggle-icon' aria-hidden='true'>
            <LayoutLeftLine size={16} />
          </span>
        </button>
        <button
          type='button'
          className='panel-toggle-button left-chrome-search-button'
          aria-label='Open search'
          onClick={handleOpenCommandPaletteFromChrome}
        >
          <Icon icon='lucide:search' width={17} height={17} aria-hidden='true' />
        </button>
      </div>
  )

  const appShell = (
    <div
      ref={appShellRef}
      className="app-shell text-foreground bg-background"
      data-app-layout={appLayoutPreference}
      data-layout={layoutMode}
      data-platform={shellPlatform}
      data-left-collapsed={isLeftSidebarDrawer || !isLeftSidebarVisible ? 'true' : 'false'}
      data-left-drawer-open={isLeftDrawerOpen ? 'true' : 'false'}
      data-modal-layer-open={isAppModalLayerOpen ? 'true' : 'false'}
      data-resizing={activeResizePanel || isGitPanelResizing ? 'true' : 'false'}
      data-right-collapsed={isRightSidebarDrawer || !isRightSidebarVisible ? 'true' : 'false'}
      data-right-drawer-open={isRightDrawerOpen ? 'true' : 'false'}
      data-window-fullscreen={isWindowFullScreen ? 'true' : 'false'}
      style={
        {
          '--git-panel-height': `${gitPanelHeight}px`,
          '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
          '--right-sidebar-width': `${effectiveRightSidebarWidth}px`,
          ...shellChromeVars,
        } as CSSProperties
      }
    >
      {isAgentLayout && !isRightSidebarVisible ? (
        <div
          className='agent-collapsed-tab-actions'
          data-overlay-elevated={isRightPanelOverlayElevated ? 'true' : 'false'}
          data-react-aria-top-layer={isRightPanelOverlayTopLayer ? 'true' : undefined}
        >
          <button
            type='button'
            className='agent-collapsed-tab-button'
            aria-label='Expand right sidebar and open Git'
            title='Git'
            onClick={() => {
              handleCollapsedAgentFixedTabClick('git')
            }}
          >
            <GitBranchLine size={16} />
          </button>
          <button
            type='button'
            className='agent-collapsed-tab-button'
            aria-label='Expand right sidebar and open files'
            title='Files'
            onClick={() => {
              handleCollapsedAgentFixedTabClick('file')
            }}
          >
            <FolderLine size={16} />
          </button>
        </div>
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
        {needsProjectBootstrap ? renderProjectBootstrap() : isAgentLayout ? renderAgentPanel('docked') : renderEditorSurface()}
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
          {needsProjectBootstrap ? null : isAgentLayout ? renderEditorSurface() : renderAgentPanel('docked')}
        </aside>
      ) : null}


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
                    data-agent-editor-surface={isAgentLayout ? 'true' : 'false'}
                    data-full-width={isRightDrawerFullWidth ? 'true' : 'false'}
                    data-platform={shellPlatform}
                    style={shellChromeVars}
                  >
                    {isAgentLayout ? renderEditorSurface() : renderAgentPanel('drawer')}
                  </div>
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      ) : null}

      {rightDrawerDragRegion ? (
        <div
          aria-hidden='true'
          className='right-drawer-window-drag-region'
          data-react-aria-top-layer='true'
          style={{
            height: `${rightDrawerDragRegion.height}px`,
            left: `${rightDrawerDragRegion.left}px`,
            top: `${rightDrawerDragRegion.top}px`,
            width: `${rightDrawerDragRegion.width}px`,
          }}
        />
      ) : null}

      <Toast.Provider placement='bottom end' />

      {renderProjectMenu()}
      {renderNewProjectDialog()}

      <Modal.Backdrop
        isOpen={isSettingsOpen}
        onOpenChange={setIsSettingsOpen}
        variant='opaque'
      >
        <Modal.Container scroll='inside' className='flex items-center justify-center p-0 m-0 border-none shadow-none bg-transparent'>
          <Modal.Dialog
            aria-label='Settings'
            className={`settings-modal p-0 m-0 relative ${resolvedTheme === 'dark' ? 'dark' : ''}`}
          >
            <Modal.CloseTrigger
              className='settings-modal-close'
              aria-label='Close settings'
            >
              <Icon icon='lucide:x' width={16} height={16} />
            </Modal.CloseTrigger>
            <Modal.Body className='p-0 m-0'>
              <SettingsDialog
                activeSection={settingsSection}
                agentState={agentWorkspaceState}
                iconTheme={iconTheme}
                iconThemeOptions={iconThemeOptions}
                isIconThemeBusy={isImportingIconTheme || isApplyingIconTheme}
                resolvedTheme={resolvedTheme}
                workspacePath={currentPath}
                onAgentStateChange={setAgentWorkspaceState}
                onSectionChange={setSettingsSection}
                onSelectIconTheme={handleSelectWorkspaceIconTheme}
                onStatusMessage={setStatusMessage}
              />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>

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
        isDrawerOpen={isLeftDrawerOpen || isRightDrawerOpen}
        leftControls={leftChromeControls}
      />
    </div>
  )

  if (isAgentLayout) {
    return (
      <AgentProvider
        externalSessionRequest={pendingAgentProjectSessionRequest}
        onExternalSessionRequestHandled={(requestId) => {
          setPendingAgentProjectSessionRequest((currentValue) => (
            currentValue?.requestId === requestId ? null : currentValue
          ))
        }}
        iconTheme={iconTheme}
        onOpenMessageFile={openAgentMessageFile}
        onOpenProviderSettings={() => {
          if (isRightSidebarDrawer) {
            setIsRightDrawerOpen(false)
          }

          setSettingsSection('providers')
          setIsSettingsOpen(true)
        }}
        workspacePath={currentPath}
        workspaceState={agentWorkspaceState}
        onWorkspaceStateChange={setAgentWorkspaceState}
        onOpenProjectAddMenu={(anchorRect) => openProjectMenu('agent-add', anchorRect)}
        onOpenProjectSwitchMenu={(anchorRect, options) => openProjectMenu(options?.startNewSession ? 'agent-new-switch' : 'editor-switch', anchorRect)}
        onOpenProjectFolder={handleShowProjectInFolder}
        onOpenProjectSession={handleOpenProjectSession}
        onRemoveProject={handleRemoveProject}
        onStartProjectSession={handleStartProjectSession}
        projectState={projectState}
      >
        {appShell}
      </AgentProvider>
    )
  }

  return appShell
}

export default App

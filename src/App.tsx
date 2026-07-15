import type {
  CSSProperties,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
  TransitionEvent as ReactTransitionEvent,
} from 'react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Menu } from '@base-ui/react/menu'
import { Tabs as BaseTabs } from '@base-ui/react/tabs'
import { Button, Toast, toast, Modal, AlertDialog, Drawer } from '@heroui/react'
import {
  FileLine,
  FolderLine,
  FolderForbidLine,
  FolderOpenLine,
  GitBranchLine,
  LayoutLeftLine,
  LayoutRightLine,
  NewFolderLine,
  Chat3Line,
  CheckLine,
  DownLine,
  SearchLine,
} from '@mingcute/react'
import { Icon } from '@iconify/react'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationState,
  ConversationTitleSource,
  CreateConversationWorkspaceRequest,
} from '@/features/conversations/types'
import type {
  ProjectRecord,
  ProjectState,
  WorkspaceIconThemeCatalogOption,
  WorkspaceIconThemeMode,
  WorkspaceIconThemeSelection,
  WorkspaceIconThemesByMode,
  WorkspaceFileSystemNavigationState,
  WorkspaceFileSystemState,
  WorkspaceFileSystemView,
  WorkspaceNode,
} from '@/features/workspace/types'
import { AppScrollArea } from '@/components/app-scroll-area'
import { AppTooltip, AppTooltipButton } from '@/components/app-tooltip'
import { AppTitlebar } from '@/components/app-titlebar'
import { ProjectIcon } from '@/components/project-icon'
import {
  AgentChatSurface,
  AgentProvider,
  AgentSessionTree,
} from '@/features/agent/components/agent-sidebar'
import type { AgentProjectSessionRequest } from '@/features/agent/lib/project-session-request'
import { DEFAULT_AGENT_ID, type AgentId } from '@/features/agent/agent-definition'
import type { AgentMessageFileChangeKind, AgentWorkspaceState } from '@/features/agent/types'
import { isLineWithinVisualDiff } from '@/features/editor/lib/git-diff-navigation'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host'
import { GitPanel } from '@/features/git/components/git-panel'
import type {
  GitChangeItem,
  GitChangeScope,
  GitCommitFileChange,
  GitCommitItem,
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
import { WorkspaceFileSystemPanel } from '@/features/workspace/components/workspace-file-system-panel'
import { WorkspaceFilePreview } from '@/features/workspace/components/workspace-file-preview'
import { WorkspaceTreePanel } from '@/features/workspace/components/workspace-tree-panel'
import type { WorkspaceTreeActivationEvent } from '@/features/workspace/components/workspace-tree'
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
  resolveWorkspaceTreeActiveFilePath,
  type WorkspaceTreeActiveFileMode,
} from '@/features/workspace/lib/workspace-tree-active-file'
import {
  createWorkspaceRefreshCoordinator,
  type WorkspaceRefreshRequest,
  type WorkspaceRefreshScheduleMode,
} from '@/features/workspace/lib/workspace-refresh-coordinator'
import { shouldCloseClickOpenedMenu } from '@/lib/base-ui-menu'
import { getOpenFileProfileDuration, recordOpenFileProfile } from '@/lib/open-file-profile'
import { CommandPalette } from '@/features/command-palette/components/command-palette'
import { useSettingsStore, type AppLayoutPreference, type AppTheme } from '@/hooks/use-settings-store'
import { useDevToolsFocusSettlement } from '@/hooks/use-devtools-focus-settlement'
import type {
  PersistedLayoutState,
  PersistedWorkspaceTabState,
  PersistentClientStateSnapshot,
} from '@/features/persistence/types'
import { HtmlPreview } from '@/features/editor/components/html-preview'
import {
  AGENT_CHAT_MIN_WIDTH,
  AGENT_EDITOR_MIN_WIDTH,
  COMPACT_LAYOUT_BREAKPOINT,
  clampAgentChatWidth,
  clampEditorRightSidebarWidth,
  clampLeftSidebarWidth,
  deriveLayoutMode,
  deriveShellPlatform,
  EDITOR_MAIN_MIN_WIDTH,
  EDITOR_RIGHT_SIDEBAR_MAX_WIDTH,
  EDITOR_RIGHT_SIDEBAR_MIN_WIDTH,
  FULL_LAYOUT_BREAKPOINT,
  getShellChromeVars,
  getShellChromeOverlayState,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_DRAWER_MAX_WIDTH,
  resolveAgentLayoutWidths,
  SIDEBAR_RESIZE_END_EVENT,
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

function createEmptyWorkspaceIconThemes(): WorkspaceIconThemesByMode {
  return {
    dark: null,
    light: null,
  }
}

function resolveAppTheme(theme: AppTheme): ResolvedAppTheme {
  if (theme !== 'auto') {
    return theme
  }

  if (typeof window === 'undefined') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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
  return tab?.kind === 'file' && (tab.viewMode === 'code' || tab.viewMode === 'meo')
}

function createDiffTabId(diff: GitFileDiffResult) {
  if (diff.source.kind === 'commit') {
    return `git-commit-diff://${diff.source.commit.hash}/${encodeURIComponent(diff.change.path)}`
  }

  const { path: filePath, scope } = diff.change
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
  fileSystem?: WorkspaceFileSystemState | null
  paths: string[]
}

const DEFAULT_LEFT_SIDEBAR_WIDTH = 320
const DEFAULT_RIGHT_SIDEBAR_WIDTH = 368
const DEFAULT_GIT_PANEL_HEIGHT = 292
const MIN_GIT_PANEL_HEIGHT = 200
const DEFAULT_GIT_PANEL_LAYOUT: GitPanelLayout = 'list'
const DRAWER_INTERACTION_REFRESH_STABLE_FRAMES = 2
const DRAWER_INTERACTION_REFRESH_MAX_FRAMES = 36
const SIDEBAR_LAYOUT_TRANSITION_FALLBACK_MS = 1000
const SIDEBAR_LAYOUT_TRANSITION_TARGET_SELECTOR = [
  '.titlebar-spacer',
  '.left-chrome-actions',
  '.panel-sidebar',
  '.panel-agent:not(.panel-agent-drawer)',
  '.panel-sidebar > .workspace-sidebar-surface',
  '.panel-agent:not(.panel-agent-drawer) > .agent-shell',
  '.panel-agent:not(.panel-agent-drawer) > .editor-frame',
  '.panel-resize-slot',
  '.file-tabs-shell',
  '.agent-threadbar',
].join(',')
const FIXED_FILE_TAB_ID = 'app://fixed/files'
const FIXED_GIT_TAB_ID = 'app://fixed/git'
const WORKSPACE_AUTO_SAVE_DELAY_MS = 1000
const INTERNAL_SAVE_EVENT_TTL_MS = 2500
const WORKSPACE_CHANGE_REFRESH_DEBOUNCE_MS = 140
const DEFAULT_WORKSPACE_FILE_SYSTEM_STATE: WorkspaceFileSystemState = {
  navigation: null,
  selectedPath: null,
  view: 'icons',
}
const WORKSPACE_FILE_SYSTEM_VIEWS: WorkspaceFileSystemView[] = ['icons', 'list', 'columns', 'gallery']

type ResizePanel = 'left' | 'right'
type SidebarResizePreview = {
  agentChatWidth: number
  editorRightSidebarWidth: number
  leftSidebarWidth: number
}
type SidebarResizeSession = {
  left: number
  right: number
  width: number
}
type PanelSurfaceMode = 'docked' | 'drawer'
type WorkspaceTreeFileClickMode = 'open-tab' | 'replace-active-tab'
type LeftSidebarTab = 'file' | 'git'
type AgentLayoutFixedTab = 'file' | 'git'
type DrawerDragRegion = {
  height: number
  left: number
  top: number
  width: number
}
type ProjectMenuMode = 'agent-add' | 'agent-new-switch' | 'editor-switch'
type ProjectMenuSurface = 'global' | 'left-drawer' | 'right-drawer'
type ProjectMenuAnchorRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>
type ProjectMenuFrameRect = Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>
type ProjectMenuStyle = CSSProperties & {
  '--project-menu-list-max-height'?: string
}
type ProjectMenuOpenOptions = {
  surface?: ProjectMenuSurface
}

const PROJECT_MENU_MARGIN_PX = 8
const PROJECT_MENU_GAP_PX = 8
const PROJECT_MENU_AGENT_ADD_WIDTH_PX = 288
const PROJECT_MENU_EDITOR_SWITCH_WIDTH_PX = 320
const PROJECT_MENU_AGENT_ADD_ESTIMATED_HEIGHT_PX = 96
const PROJECT_MENU_EDITOR_SWITCH_MAX_HEIGHT_PX = 520
const PROJECT_MENU_EDITOR_SWITCH_MIN_HEIGHT_PX = 180
const PROJECT_MENU_EDITOR_SWITCH_SEARCH_HEIGHT_PX = 36
const PROJECT_MENU_EDITOR_SWITCH_ACTIONS_HEIGHT_PX = 72
const PROJECT_MENU_AGENT_PROJECTLESS_ACTION_HEIGHT_PX = 39
const PROJECT_MENU_PROJECT_ROW_HEIGHT_PX = 34
const PROJECT_MENU_PROJECT_LIST_MAX_HEIGHT_PX = 320
const PROJECT_MENU_EDITOR_SWITCH_VERTICAL_CHROME_PX = 24

let initialLayoutState: PersistedLayoutState | null = null
let persistedWorkspaceTabState = new Map<string, PersistedWorkspaceTabState>()

export function initializeAppPersistentState(snapshot: PersistentClientStateSnapshot) {
  initialLayoutState = snapshot.app.layout
  persistedWorkspaceTabState = new Map(Object.entries(snapshot.workspace.workspaceTabs))
}

const emptyProjectState: ProjectState = {
  lastProjectId: null,
  projects: [],
}

const emptyConversationState: ConversationState = {
  version: 2,
  conversations: [],
}

const conversationDraftContext: ActiveWorkspaceContext = { kind: 'conversationDraft' }

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

function resolveProjectMenuStyle(
  mode: ProjectMenuMode,
  includesProjectlessAction = false,
  frameRect: ProjectMenuFrameRect | null = null,
): ProjectMenuStyle | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  const viewportWidth = frameRect?.width ?? window.innerWidth
  const viewportHeight = frameRect?.height ?? window.innerHeight
  const maxWidth = Math.max(240, viewportWidth - (PROJECT_MENU_MARGIN_PX * 2))
  const width = Math.min(
    mode === 'agent-add' ? PROJECT_MENU_AGENT_ADD_WIDTH_PX : PROJECT_MENU_EDITOR_SWITCH_WIDTH_PX,
    maxWidth,
  )
  const maxHeight = mode === 'agent-add'
    ? PROJECT_MENU_AGENT_ADD_ESTIMATED_HEIGHT_PX
    : PROJECT_MENU_EDITOR_SWITCH_MAX_HEIGHT_PX
  const availableHeight = Math.max(
    PROJECT_MENU_EDITOR_SWITCH_MIN_HEIGHT_PX,
    viewportHeight - (PROJECT_MENU_MARGIN_PX * 2),
  )
  const menuMaxHeight = Math.min(maxHeight, availableHeight)
  const fixedMenuHeight = PROJECT_MENU_EDITOR_SWITCH_SEARCH_HEIGHT_PX
    + PROJECT_MENU_EDITOR_SWITCH_ACTIONS_HEIGHT_PX
    + (includesProjectlessAction ? PROJECT_MENU_AGENT_PROJECTLESS_ACTION_HEIGHT_PX : 0)
    + PROJECT_MENU_EDITOR_SWITCH_VERTICAL_CHROME_PX
  const listMaxHeight = Math.max(
    PROJECT_MENU_PROJECT_ROW_HEIGHT_PX,
    Math.min(PROJECT_MENU_PROJECT_LIST_MAX_HEIGHT_PX, menuMaxHeight - fixedMenuHeight),
  )

  const style: ProjectMenuStyle = {
    width: `${width}px`,
  }

  if (mode !== 'agent-add') {
    style['--project-menu-list-max-height'] = `${listMaxHeight}px`
  }

  return style
}

function createProjectMenuVirtualAnchor(
  anchorRect: ProjectMenuAnchorRect | null,
  frameRect: ProjectMenuFrameRect | null = null,
) {
  const fallbackLeft = (frameRect?.left ?? 0) + PROJECT_MENU_MARGIN_PX
  const fallbackTop = (frameRect?.top ?? 0) + PROJECT_MENU_MARGIN_PX
  const rect = anchorRect ?? {
    bottom: fallbackTop,
    height: 0,
    left: fallbackLeft,
    right: fallbackLeft,
    top: fallbackTop,
    width: 0,
  }

  return {
    getBoundingClientRect() {
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
        x: rect.left,
        y: rect.top,
        toJSON() {
          return this
        },
      }
    },
  }
}

function resolveProjectMenuCollisionBoundary(frameRect: ProjectMenuFrameRect | null) {
  if (!frameRect) {
    return undefined
  }

  return {
    height: frameRect.height,
    width: frameRect.width,
    x: frameRect.left,
    y: frameRect.top,
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
      fileSystem: storedState.fileSystem ?? null,
      paths: storedState.paths,
    }
  }

  return {
    activePath: null,
    entries: [],
    paths: [],
  }
}

function normalizeWorkspaceFileSystemNavigation(
  navigation: WorkspaceFileSystemNavigationState | null | undefined,
): WorkspaceFileSystemNavigationState | null {
  if (!navigation || !Array.isArray(navigation.stack) || navigation.stack.length === 0) {
    return null
  }

  const stack = navigation.stack
    .filter((path): path is string => typeof path === 'string')
    .map((path) => {
      const normalizedPath = path.trim().replace(/[\\/]+/g, '/').replace(/^\/+/, '')

      if (!normalizedPath) {
        return ''
      }

      return normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`
    })
    .filter((path, index, allPaths) => index === 0 || path !== allPaths[index - 1])

  if (stack.length === 0) {
    return null
  }

  const index = Number.isFinite(navigation.index)
    ? clamp(Math.trunc(navigation.index), 0, stack.length - 1)
    : 0

  return { index, stack }
}

function normalizeWorkspaceFileSystemState(
  state: WorkspaceFileSystemState | null | undefined,
): WorkspaceFileSystemState {
  if (!state) {
    return DEFAULT_WORKSPACE_FILE_SYSTEM_STATE
  }

  return {
    navigation: normalizeWorkspaceFileSystemNavigation(state.navigation),
    selectedPath: state.selectedPath || null,
    view: WORKSPACE_FILE_SYSTEM_VIEWS.includes(state.view) ? state.view : 'icons',
  }
}

function writeStoredTabState(workspacePath: string, state: StoredTabState) {
  const entries = state.entries ?? state.paths.map((entryPath) => ({ path: entryPath }))
  const previousState = persistedWorkspaceTabState.get(workspacePath)
  const fileSystem = state.fileSystem === undefined
    ? previousState?.fileSystem
    : state.fileSystem ?? undefined
  const nextState: PersistedWorkspaceTabState = {
    activePath: state.activePath,
    entries,
    ...(fileSystem ? { fileSystem } : null),
    paths: entries.map((entry) => entry.path),
  }

  persistedWorkspaceTabState.set(workspacePath, nextState)
  void window.appApi.updateWorkspaceTabState(workspacePath, nextState).catch(() => undefined)
}

function readStoredFileSystemState(workspacePath: string | null): WorkspaceFileSystemState {
  if (!workspacePath) {
    return DEFAULT_WORKSPACE_FILE_SYSTEM_STATE
  }

  return normalizeWorkspaceFileSystemState(persistedWorkspaceTabState.get(workspacePath)?.fileSystem)
}

function writeStoredFileSystemState(workspacePath: string, fileSystem: WorkspaceFileSystemState) {
  writeStoredTabState(workspacePath, {
    ...readStoredTabState(workspacePath),
    fileSystem: normalizeWorkspaceFileSystemState(fileSystem),
  })
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
  diff: GitFileDiffResult,
  navigationRequest?: WorkspaceDiffNavigationRequest | null,
): WorkspaceDiffTab {
  const id = createDiffTabId(diff)
  return {
    draftContent: null,
    diff,
    exists: true,
    filePath: id,
    id,
    isDirty: false,
    kind: 'diff',
    navigationRequest: navigationRequest ?? null,
    title: diff.source.kind === 'commit'
      ? `${getBaseName(change.path)} @ ${diff.source.commit.shortHash}`
      : getBaseName(change.path),
  }
}


function App() {
  const platform = window.appApi.platform
  const { layoutPreference, meo, theme, setLayoutPreference } = useSettingsStore()
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
        meta.setAttribute('content', t === 'dark' ? '#0a0a0b' : '#ffffff')
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
  const [conversationState, setConversationState] = useState<ConversationState>(emptyConversationState)
  const [activeWorkspaceContext, setActiveWorkspaceContext] = useState<ActiveWorkspaceContext>(conversationDraftContext)
  const [projectMenuMode, setProjectMenuMode] = useState<ProjectMenuMode | null>(null)
  const [projectMenuSurface, setProjectMenuSurface] = useState<ProjectMenuSurface>('global')
  const [projectMenuAnchorRect, setProjectMenuAnchorRect] = useState<ProjectMenuAnchorRect | null>(null)
  const [projectMenuSearch, setProjectMenuSearch] = useState('')
  const [isProjectActionBusy, setIsProjectActionBusy] = useState(false)
  const [hasLoadedProjectState, setHasLoadedProjectState] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [isNewProjectDialogOpen, setIsNewProjectDialogOpen] = useState(false)
  const [shouldStartAgentSessionAfterProjectCreate, setShouldStartAgentSessionAfterProjectCreate] = useState(false)
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

  const [isApplyingIconTheme, setIsApplyingIconTheme] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSectionId>('appearance')
  const [agentWorkspaceState, setAgentWorkspaceState] = useState<AgentWorkspaceState | null>(null)
  const [iconThemes, setIconThemes] = useState<WorkspaceIconThemesByMode>(() => createEmptyWorkspaceIconThemes())
  const [iconThemeOptions, setIconThemeOptions] = useState<WorkspaceIconThemeCatalogOption[]>([])
  const iconTheme = useMemo(() => iconThemes[resolvedTheme], [iconThemes, resolvedTheme])
  const [, setStatusMessage] = useState('Open a folder to start.')
  const [workspaceUnavailableMessage, setWorkspaceUnavailableMessage] = useState<string | null>(null)
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [activeAgentLayoutFixedTab, setActiveAgentLayoutFixedTab] = useState<AgentLayoutFixedTab>('file')
  const [isAgentLayoutFixedTabActive, setIsAgentLayoutFixedTabActive] = useState(false)
  const [isDirectorySidebarOpen, setIsDirectorySidebarOpen] = useState(true)

  const [leftSidebarWidth, setLeftSidebarWidth] = useState(
    () => readStoredLayoutNumber('leftSidebarWidth', DEFAULT_LEFT_SIDEBAR_WIDTH),
  )
  const [editorRightSidebarWidth, setEditorRightSidebarWidth] = useState(
    () => readStoredLayoutNumber('editorRightSidebarWidth', DEFAULT_RIGHT_SIDEBAR_WIDTH),
  )
  const [agentChatWidth, setAgentChatWidth] = useState(
    () => readStoredLayoutNumber('agentChatWidth', AGENT_CHAT_MIN_WIDTH),
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
  const [gitHistoryRefreshVersion, setGitHistoryRefreshVersion] = useState(0)
  const [shellWidth, setShellWidth] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth : FULL_LAYOUT_BREAKPOINT + 1
  ))
  const [isWindowFullScreen, setIsWindowFullScreen] = useState(false)
  const [isLeftDrawerOpen, setIsLeftDrawerOpen] = useState(false)
  const [isRightDrawerOpen, setIsRightDrawerOpen] = useState(false)
  const [drawerDragRegion, setDrawerDragRegion] = useState<DrawerDragRegion | null>(null)
  const appShellRef = useRef<HTMLDivElement | null>(null)
  const sidebarLayoutTransitionTimerRef = useRef<number | null>(null)
  const sidebarLayoutTransitionTargetsRef = useRef<HTMLElement[]>([])
  const resizeSidebarRef = useRef<(panel: ResizePanel, pointerClientX: number) => void>(() => undefined)
  const finishSidebarResizeRef = useRef<(panel: ResizePanel) => void>(() => undefined)
  const sidebarResizePreviewRef = useRef<SidebarResizePreview | null>(null)
  const sidebarResizeSessionRef = useRef<SidebarResizeSession | null>(null)
  const leftSidebarBodyRef = useRef<HTMLDivElement | null>(null)
  const leftDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [leftDrawerOverlayRoot, setLeftDrawerOverlayRoot] = useState<HTMLDivElement | null>(null)
  const rightDrawerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [rightDrawerOverlayRoot, setRightDrawerOverlayRoot] = useState<HTMLDivElement | null>(null)
  const meoEditorHostRef = useRef<MeoEditorHostHandle | null>(null)
  const agentProjectSessionRequestIdRef = useRef(0)
  const editorEmptyWorkspaceTriggerRef = useRef<HTMLButtonElement | null>(null)
  const finishSidebarLayoutTransition = useCallback(() => {
    if (sidebarLayoutTransitionTimerRef.current !== null) {
      window.clearTimeout(sidebarLayoutTransitionTimerRef.current)
      sidebarLayoutTransitionTimerRef.current = null
    }

    for (const target of sidebarLayoutTransitionTargetsRef.current) {
      target.removeAttribute('data-sidebar-transition')
    }

    sidebarLayoutTransitionTargetsRef.current = []
    appShellRef.current?.removeAttribute('data-sidebar-transition')
  }, [])
  const runSidebarLayoutTransition = useCallback((update: () => void) => {
    const shell = appShellRef.current
    if (!shell || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishSidebarLayoutTransition()
      update()
      return
    }

    finishSidebarLayoutTransition()
    const transitionTargets = [
      shell,
      ...shell.querySelectorAll<HTMLElement>(SIDEBAR_LAYOUT_TRANSITION_TARGET_SELECTOR),
    ]
    sidebarLayoutTransitionTargetsRef.current = transitionTargets
    for (const target of transitionTargets) {
      target.dataset.sidebarTransition = 'true'
    }

    update()
    sidebarLayoutTransitionTimerRef.current = window.setTimeout(() => {
      finishSidebarLayoutTransition()
    }, SIDEBAR_LAYOUT_TRANSITION_FALLBACK_MS)
  }, [finishSidebarLayoutTransition])
  const handleSidebarLayoutTransitionEnd = useCallback((event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && event.propertyName === 'grid-template-columns') {
      finishSidebarLayoutTransition()
    }
  }, [finishSidebarLayoutTransition])
  useEffect(() => {
    return finishSidebarLayoutTransition
  }, [finishSidebarLayoutTransition])
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
  const replaceActiveFileTab = useWorkspaceStore((state) => state.replaceActiveFileTab)
  const replaceTabs = useWorkspaceStore((state) => state.replaceTabs)
  const resetOpenTabs = useWorkspaceStore((state) => state.resetOpenTabs)
  const setCurrentPath = useWorkspaceStore((state) => state.setCurrentPath)
  const setTree = useWorkspaceStore((state) => state.setTree)
  const syncFileTabsWithDisk = useWorkspaceStore((state) => state.syncFileTabsWithDisk)
  const tree = useWorkspaceStore((state) => state.tree)
  const updateDiffTabDraft = useWorkspaceStore((state) => state.updateDiffTabDraft)
  const updateFileTabsContent = useWorkspaceStore((state) => state.updateFileTabsContent)
  const [workspaceFileSystemStateVersion, setWorkspaceFileSystemStateVersion] = useState(0)
  const workspaceFileSystemState = useMemo(
    () => readStoredFileSystemState(currentPath),
    [currentPath, workspaceFileSystemStateVersion],
  )
  const updateWorkspaceFileSystemState = useCallback(
    (patch: Partial<WorkspaceFileSystemState>) => {
      if (!currentPath) {
        return
      }

      const previousState = readStoredFileSystemState(currentPath)
      const hasNavigationPatch = Object.prototype.hasOwnProperty.call(patch, 'navigation')
      const hasSelectedPathPatch = Object.prototype.hasOwnProperty.call(patch, 'selectedPath')
      const nextState: WorkspaceFileSystemState = {
        navigation: hasNavigationPatch ? patch.navigation ?? null : previousState.navigation,
        selectedPath: hasSelectedPathPatch ? patch.selectedPath ?? null : previousState.selectedPath,
        view: patch.view ?? previousState.view,
      }
      writeStoredFileSystemState(currentPath, nextState)
      setWorkspaceFileSystemStateVersion((version) => version + 1)
    },
    [currentPath],
  )
  const handleWorkspaceFileSystemViewChange = useCallback(
    (view: WorkspaceFileSystemView) => {
      updateWorkspaceFileSystemState({ view })
    },
    [updateWorkspaceFileSystemState],
  )
  const handleWorkspaceFileSystemNavigationChange = useCallback(
    (navigation: WorkspaceFileSystemNavigationState) => {
      updateWorkspaceFileSystemState({ navigation })
    },
    [updateWorkspaceFileSystemState],
  )
  const handleWorkspaceFileSystemSelectionChange = useCallback(
    (selectedPath: string | null) => {
      updateWorkspaceFileSystemState({ selectedPath })
    },
    [updateWorkspaceFileSystemState],
  )
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
  const isRightSidebarCollapsed = isAgentLayout ? isAgentRightSidebarCollapsed : isEditorRightSidebarCollapsed
  const setIsRightSidebarCollapsed = isAgentLayout ? setIsAgentRightSidebarCollapsed : setIsEditorRightSidebarCollapsed
  const displayTabs = useMemo<WorkspaceDisplayTab[]>(
    () => {
      const fixedTabs = isAgentLayout
        ? [getFixedPanelTab('git'), getFixedPanelTab('file')]
        : []

      return [
        ...fixedTabs,
        ...openTabs,
      ]
    },
    [isAgentLayout, openTabs],
  )
  const displayActiveTabId = isAgentLayout && (isAgentLayoutFixedTabActive || !activeTabId)
    ? (activeAgentLayoutFixedTab === 'git' ? FIXED_GIT_TAB_ID : FIXED_FILE_TAB_ID)
    : activeTabId
  const displayActiveTab = useMemo(
    () => displayTabs.find((tab) => tab.id === displayActiveTabId) ?? null,
    [displayActiveTabId, displayTabs],
  )
  const activeFixedPanelTab = isWorkspaceFixedPanelTab(displayActiveTab) ? displayActiveTab : null
  const shouldRenderWorkspaceEditor = !activeFixedPanelTab
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
  useDevToolsFocusSettlement()

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
    : '选择工作目录'
  const activeProject = useMemo(
    () => {
      if (activeWorkspaceContext.kind === 'project') {
        return projectState.projects.find((project) => project.id === activeWorkspaceContext.projectId) ?? null
      }

      return currentPath
        ? projectState.projects.find((project) => normalizeFilePath(project.path) === normalizeFilePath(currentPath)) ?? null
        : null
    },
    [activeWorkspaceContext, currentPath, projectState.projects],
  )
  const needsProjectBootstrap = hasLoadedProjectState
    && !activeProject
    && activeWorkspaceContext.kind === 'project'
  const editorWorkspaceSwitchLabel = activeWorkspaceContext.kind === 'project' && activeProject
    ? activeProject.name
    : workspaceLabel
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
  const shellChromeVars = getShellChromeVars(shellPlatform, { isFullScreen: isWindowFullScreen }) as CSSProperties
  const shouldExposeAgentWorkspaceTools = !isAgentLayout || Boolean(currentPath)
  const layoutMode: LayoutMode = deriveLayoutMode(shellWidth)
  const isLeftSidebarDrawer = layoutMode !== 'full'
  const isRightSidebarDrawer = !isAgentLayout && layoutMode === 'focus'
  const isRightDrawerFullWidth = shellWidth <= RIGHT_DRAWER_MAX_WIDTH
  const isLeftSidebarVisible = !isLeftSidebarDrawer && !isLeftSidebarCollapsed
  const isRightSidebarVisible = !isRightSidebarDrawer && !isRightSidebarCollapsed && shouldExposeAgentWorkspaceTools
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
  const shellChromeOverlayState = getShellChromeOverlayState({
    isLeftDrawerOpen,
    isModalLayerOpen: isAppModalLayerOpen,
    isRightDrawerOpen,
  })
  const sidebarResizePreview = activeResizePanel ? sidebarResizePreviewRef.current : null
  const renderedLeftSidebarWidth = sidebarResizePreview?.leftSidebarWidth ?? leftSidebarWidth
  const renderedAgentChatWidth = sidebarResizePreview?.agentChatWidth ?? agentChatWidth
  const renderedEditorRightSidebarWidth = sidebarResizePreview?.editorRightSidebarWidth ?? editorRightSidebarWidth
  const effectiveLeftSidebarWidth = isLeftSidebarVisible ? renderedLeftSidebarWidth : 0
  const agentLayoutWidths = isAgentLayout
    ? resolveAgentLayoutWidths({
      agentChatWidth: renderedAgentChatWidth,
      isEditorVisible: isRightSidebarVisible,
      leftSidebarWidth: effectiveLeftSidebarWidth,
      shellWidth,
    })
    : null
  const effectiveAgentChatWidth = agentLayoutWidths?.chatWidth ?? 0
  const effectiveAgentChatTrackWidth = agentLayoutWidths?.chatTrackWidth ?? 0
  const effectiveAgentEditorTrackWidth = agentLayoutWidths?.editorTrackWidth ?? 0
  const effectiveRightSidebarWidth = isRightSidebarVisible
    ? (isAgentLayout
      ? effectiveAgentEditorTrackWidth
      : renderedEditorRightSidebarWidth)
    : 0
  const rightSidebarWidthReservedForLeftClamp = isAgentLayout
    ? (isRightSidebarVisible ? AGENT_EDITOR_MIN_WIDTH : 0)
    : effectiveRightSidebarWidth
  const activeTreePath = activeFileTab?.filePath ?? activeDiffTab?.diff.change.path ?? null
  const isDirectorySidebarAvailable = Boolean(
    currentPath
    && isAgentLayout
    && shouldRenderWorkspaceEditor
    && (activeFileTab || activeDiffTab),
  )
  const isDirectorySidebarVisible = isDirectorySidebarAvailable && isDirectorySidebarOpen
  const isDirectoryToggleSlotVisible = isDirectorySidebarAvailable && !isDirectorySidebarVisible
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
      (tab) => tab.kind === 'diff'
        ? tab.diff.source.kind === 'working-tree' && tab.isDirty
        : isWorkspaceAutosaveTab(tab) && tab.isDirty,
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
    const centerMinWidth = isAgentLayout && currentRightWidth > 0
      ? effectiveAgentChatWidth
      : (isAgentLayout ? AGENT_CHAT_MIN_WIDTH : EDITOR_MAIN_MIN_WIDTH)

    return clampLeftSidebarWidth({
      centerMinWidth,
      nextWidth,
      rightSidebarWidth: currentRightWidth,
      shellWidth,
    })
  }

  function clampEditorRightWidth(nextWidth: number, shellWidth: number, currentLeftWidth: number) {
    return clampEditorRightSidebarWidth(nextWidth, shellWidth, currentLeftWidth)
  }

  function applySidebarResizePreview(preview: SidebarResizePreview, session: SidebarResizeSession) {
    const shell = appShellRef.current

    if (!shell) {
      return
    }

    const nextLeftWidth = isLeftSidebarVisible ? preview.leftSidebarWidth : 0
    shell.style.setProperty('--left-sidebar-width', `${nextLeftWidth}px`)
    shell.style.setProperty('--left-sidebar-content-width', `${preview.leftSidebarWidth}px`)

    if (isAgentLayout) {
      const nextAgentLayoutWidths = resolveAgentLayoutWidths({
        agentChatWidth: preview.agentChatWidth,
        isEditorVisible: isRightSidebarVisible,
        leftSidebarWidth: nextLeftWidth,
        shellWidth: session.width,
      })

      if (isRightSidebarVisible) {
        preview.agentChatWidth = nextAgentLayoutWidths.chatWidth
      }

      shell.style.setProperty('--agent-chat-track-width', `${nextAgentLayoutWidths.chatTrackWidth}px`)
      shell.style.setProperty('--agent-editor-track-width', `${nextAgentLayoutWidths.editorTrackWidth}px`)
      shell.style.setProperty('--right-sidebar-width', `${nextAgentLayoutWidths.editorTrackWidth}px`)
      return
    }

    const nextRightWidth = isRightSidebarVisible
      ? clampEditorRightWidth(preview.editorRightSidebarWidth, session.width, nextLeftWidth)
      : 0

    preview.editorRightSidebarWidth = nextRightWidth
    shell.style.setProperty('--right-sidebar-content-width', `${nextRightWidth}px`)
    shell.style.setProperty('--right-sidebar-width', `${nextRightWidth}px`)
  }

  function notifySidebarResizeEnd() {
    window.requestAnimationFrame(() => {
      window.dispatchEvent(new Event(SIDEBAR_RESIZE_END_EVENT))
    })
  }

  function resizeSidebar(panel: ResizePanel, pointerClientX: number) {
    if (
      (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
      return
    }

    const preview = sidebarResizePreviewRef.current
    const session = sidebarResizeSessionRef.current

    if (!preview || !session) {
      return
    }

    if (panel === 'left') {
      const nextWidth = pointerClientX - session.left
      preview.leftSidebarWidth = clampLeftWidth(nextWidth, session.width, rightSidebarWidthReservedForLeftClamp)
      applySidebarResizePreview(preview, session)
      return
    }

    if (isAgentLayout) {
      const nextWidth = pointerClientX - session.left - effectiveLeftSidebarWidth
      preview.agentChatWidth = clampAgentChatWidth(nextWidth, session.width, effectiveLeftSidebarWidth)
      applySidebarResizePreview(preview, session)
      return
    }

    const nextWidth = session.right - pointerClientX
    preview.editorRightSidebarWidth = clampEditorRightWidth(nextWidth, session.width, effectiveLeftSidebarWidth)
    applySidebarResizePreview(preview, session)
  }

  resizeSidebarRef.current = resizeSidebar

  function finishSidebarResize(panel: ResizePanel) {
    const preview = sidebarResizePreviewRef.current

    sidebarResizePreviewRef.current = null
    sidebarResizeSessionRef.current = null

    if (!preview) {
      setActiveResizePanel(null)
      return
    }

    if (panel === 'left') {
      setLeftSidebarWidth(preview.leftSidebarWidth)
      if (isAgentLayout) {
        if (isRightSidebarVisible) {
          setAgentChatWidth(preview.agentChatWidth)
        }
      } else {
        setEditorRightSidebarWidth(preview.editorRightSidebarWidth)
      }
    } else if (isAgentLayout) {
      setAgentChatWidth(preview.agentChatWidth)
    } else {
      setEditorRightSidebarWidth(preview.editorRightSidebarWidth)
    }

    setActiveResizePanel(null)
    notifySidebarResizeEnd()
  }

  finishSidebarResizeRef.current = finishSidebarResize

  function handleResizeKeyDown(panel: ResizePanel, event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) {
      return
    }

    if (
      event.key !== 'ArrowLeft'
      && event.key !== 'ArrowRight'
      && event.key !== 'Home'
      && event.key !== 'End'
    ) {
      return
    }

    if (
      (panel === 'left' && !isLeftSidebarVisible)
      || (panel === 'right' && !isRightSidebarVisible)
    ) {
      return
    }

    event.preventDefault()

    const resizeStep = event.shiftKey ? 32 : 8
    const currentShellWidth = getShellWidth()

    if (panel === 'left') {
      const nextWidth = event.key === 'Home'
        ? LEFT_SIDEBAR_MIN_WIDTH
        : event.key === 'End'
          ? LEFT_SIDEBAR_MAX_WIDTH
          : renderedLeftSidebarWidth + (event.key === 'ArrowLeft' ? -resizeStep : resizeStep)
      const nextLeftSidebarWidth = clampLeftWidth(nextWidth, currentShellWidth, rightSidebarWidthReservedForLeftClamp)

      setLeftSidebarWidth(nextLeftSidebarWidth)

      if (isAgentLayout && isRightSidebarVisible) {
        setAgentChatWidth((currentWidth) => (
          clampAgentChatWidth(currentWidth, currentShellWidth, isLeftSidebarVisible ? nextLeftSidebarWidth : 0)
        ))
      } else if (isRightSidebarVisible) {
        setEditorRightSidebarWidth((currentWidth) => (
          clampEditorRightWidth(currentWidth, currentShellWidth, nextLeftSidebarWidth)
        ))
      }

      notifySidebarResizeEnd()
      return
    }

    if (isAgentLayout) {
      const nextWidth = event.key === 'Home'
        ? AGENT_CHAT_MIN_WIDTH
        : event.key === 'End'
          ? Number.POSITIVE_INFINITY
          : effectiveAgentChatWidth + (event.key === 'ArrowLeft' ? -resizeStep : resizeStep)

      setAgentChatWidth(clampAgentChatWidth(nextWidth, currentShellWidth, effectiveLeftSidebarWidth))
      notifySidebarResizeEnd()
      return
    }

    const nextWidth = event.key === 'Home'
      ? EDITOR_RIGHT_SIDEBAR_MIN_WIDTH
      : event.key === 'End'
        ? EDITOR_RIGHT_SIDEBAR_MAX_WIDTH
        : renderedEditorRightSidebarWidth + (event.key === 'ArrowLeft' ? resizeStep : -resizeStep)

    setEditorRightSidebarWidth(clampEditorRightWidth(nextWidth, currentShellWidth, effectiveLeftSidebarWidth))
    notifySidebarResizeEnd()
  }

  function handleResizeStart(panel: ResizePanel) {
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
    sidebarResizePreviewRef.current = {
      agentChatWidth: isRightSidebarVisible ? effectiveAgentChatWidth : agentChatWidth,
      editorRightSidebarWidth,
      leftSidebarWidth,
    }
    sidebarResizeSessionRef.current = {
      left: shellRect.left,
      right: shellRect.right,
      width: shellRect.width,
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
    patch: { lastFilePath?: string | null, lastAgentSessionPath?: string | null, markAsLastOpened?: boolean, prefersNewAgentSession?: boolean },
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
      if (tab.diff.source.kind === 'commit') {
        return
      }

      try {
        const nextDiff = await window.appApi.getGitFileDiff(workspacePath, tab.diff.change.path, tab.diff.change.scope)
        openDiffTab(createDiffTab(nextDiff.change, nextDiff), false)
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
    if (
      tab.diff.source.kind !== 'working-tree'
      || !tab.isDirty
      || tab.diff.change.scope !== 'unstaged'
      || !tab.diff.modifiedExists
    ) {
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
        && tab.diff.source.kind === 'working-tree'
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

    try {
      await loadTree(nextPath)
      setWorkspaceUnavailableMessage(null)
      currentPathRef.current = nextPath
      setCurrentPath(nextPath)
      resetOpenTabs()
      setIsAgentLayoutFixedTabActive(false)
      setGitCommitMessage('')
      setGitErrorMessage(null)
      await refreshGitState(nextPath, { silent: true })
      await window.appApi.startWorkspaceWatch(nextPath)
      await updateWorkspaceState(nextPath, { markAsLastOpened: true })
    } catch (error) {
      await window.appApi.stopWorkspaceWatch().catch(() => undefined)
      resetWorkspaceSurface({ unavailableMessage: '无法访问当前工作目录。' })
      throw error
    }
  }

  function resetWorkspaceSurface(options: { unavailableMessage?: string | null } = {}) {
    latestGitRefreshRequestIdRef.current += 1
    currentPathRef.current = null
    setCurrentPath(null)
    setTree([])
    setExpandedPaths(new Set())
    resetOpenTabs()
    setIsAgentLayoutFixedTabActive(false)
    setGitCommitMessage('')
    setGitErrorMessage(null)
    setGitRepositoryState(null)
    setAgentWorkspaceState(null)
    setPendingAgentProjectSessionRequest(null)
    setWorkspaceUnavailableMessage(options.unavailableMessage ?? null)
  }

  async function disconnectWorkspaceSurface(options: { unavailableMessage?: string | null } = {}) {
    await window.appApi.stopWorkspaceWatch()
    resetWorkspaceSurface(options)
  }

  async function switchActiveWorkspace(
    project: ProjectRecord,
    options: { restoreTabs?: boolean, skipDirtyConfirm?: boolean } = {},
  ) {
    if (currentPath && normalizeFilePath(currentPath) === normalizeFilePath(project.path)) {
      await window.appApi.setActiveProject(project.id)
      setProjectState(await window.appApi.getProjectState())
      setActiveWorkspaceContext({ kind: 'project', projectId: project.id })
      return true
    }

    if (!options.skipDirtyConfirm && !(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return false
    }

    const nextProjectState = await window.appApi.setActiveProject(project.id)
    setProjectState(nextProjectState)
    setActiveWorkspaceContext({ kind: 'project', projectId: project.id })
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

      return false
    })
  }, [isAgentLayout])

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
        description: 'This file could not be opened from the workspace.',
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

      const fileContent = await (async () => {
        if (editorKind === 'file') {
          return ''
        }

        const readStartedAt = performance.now()
        recordOpenFileProfile('app:open-file:read-file:start', { filePath })
        const content = await window.appApi.readWorkspaceFile(filePath)
        recordOpenFileProfile('app:open-file:read-file:end', {
          chars: content.length,
          durationMs: getOpenFileProfileDuration(readStartedAt),
        })
        return content
      })()
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

  const replaceActiveFileWithPath = useCallback(async (filePath: string) => {
    const replaceStartedAt = performance.now()
    const storeSnapshot = useWorkspaceStore.getState()
    const currentActiveTab = storeSnapshot.openTabs.find((tab) => tab.id === storeSnapshot.activeTabId) ?? null
    const currentActiveFileTab = currentActiveTab?.kind === 'file' ? currentActiveTab : null

    recordOpenFileProfile('app:replace-active-file:start', {
      activeTabId: storeSnapshot.activeTabId,
      filePath,
    })

    if (currentActiveFileTab && normalizeFilePath(currentActiveFileTab.filePath) === normalizeFilePath(filePath)) {
      setIsAgentLayoutFixedTabActive(false)
      activateTab(currentActiveFileTab.id)
      setStatusMessage(`${getBaseName(filePath)} focused`)
      return
    }

    if (currentActiveFileTab && isWorkspaceAutosaveTab(currentActiveFileTab) && currentActiveFileTab.isDirty) {
      if (isActiveEditorComposing) {
        const message = '请先结束当前输入法组合，再切换目录文件。'
        toast.warning('请先完成编辑', { description: message })
        setStatusMessage(message)
        return
      }

      try {
        await flushWorkspaceAutosave(currentActiveFileTab.filePath)
      } catch (error) {
        const message = error instanceof Error ? error.message : '保存当前文件失败。'
        toast.danger('无法切换文件', { description: message })
        setStatusMessage(message)
        return
      }

      const latestActiveTab = useWorkspaceStore.getState().openTabs.find((tab) => tab.id === currentActiveFileTab.id)
      if (isWorkspaceAutosaveTab(latestActiveTab) && latestActiveTab.isDirty) {
        const message = '当前文件仍有未保存内容。请保存后再切换目录文件。'
        toast.warning('无法切换文件', { description: message })
        setStatusMessage(message)
        return
      }
    }

    captureActiveMeoViewPosition()
    setIsAgentLayoutFixedTabActive(false)

    const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)
    if (!editorKind) {
      toast.warning(`Cannot open ${getBaseName(filePath)} yet`, {
        description: 'This file could not be opened from the workspace.',
      })
      setStatusMessage(`${getBaseName(filePath)} is not supported yet`)
      recordOpenFileProfile('app:replace-active-file:unsupported:end', {
        elapsedMs: getOpenFileProfileDuration(replaceStartedAt),
      })
      return
    }

    expandAgentEditorSurface()

    try {
      const targetViewMode = resolveWorkspaceFileViewMode(filePath, editorKind, currentActiveFileTab?.viewMode)
      const targetTabId = createWorkspaceFileTabId(filePath, targetViewMode)
      const existingTargetTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.id === targetTabId,
      )
      const fileContent = existingTargetTab
        ? existingTargetTab.content
        : editorKind === 'file'
          ? ''
          : await window.appApi.readWorkspaceFile(filePath)

      replaceActiveFileTab({
        filePath,
        content: fileContent,
        editorKind,
        viewMode: targetViewMode,
      })

      if (currentPath) {
        await updateWorkspaceState(currentPath, { lastFilePath: filePath })
      }

      setStatusMessage(existingTargetTab ? `${getBaseName(filePath)} focused` : `${getBaseName(filePath)} opened`)
      recordOpenFileProfile('app:replace-active-file:end', {
        elapsedMs: getOpenFileProfileDuration(replaceStartedAt),
        reusedExistingTab: Boolean(existingTargetTab),
        targetViewMode,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open file.'
      toast.danger(`Failed to open ${getBaseName(filePath)}`, {
        description: message,
      })
      setStatusMessage(message)
      recordOpenFileProfile('app:replace-active-file:error:end', {
        elapsedMs: getOpenFileProfileDuration(replaceStartedAt),
        message,
      })
    }
  }, [
    activateTab,
    captureActiveMeoViewPosition,
    currentPath,
    expandAgentEditorSurface,
    flushWorkspaceAutosave,
    isActiveEditorComposing,
    replaceActiveFileTab,
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
      openDiffTab(createDiffTab(change, diff, navigationRequest))
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

  async function openGitCommitFileDiff(commitHash: string, change: GitCommitFileChange) {
    if (!currentPath) {
      return
    }

    captureActiveMeoViewPosition()

    try {
      const diff = await window.appApi.getGitCommitFileDiff(currentPath, commitHash, change.path)

      openDiffTab(createDiffTab(diff.change, diff))
      setIsAgentLayoutFixedTabActive(false)

      if (isLeftSidebarDrawer) {
        setIsLeftDrawerOpen(false)
      }

      setStatusMessage(`已打开 ${getBaseName(change.path)} 的提交差异`)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开该提交差异。'
      toast.danger('打开提交差异失败', {
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
      setIsAgentLayoutFixedTabActive(false)
      return
    }

    const settledTabs = await Promise.all(candidateEntries.map(async ({ path: filePath, viewMode }) => {
      const editorKind = await window.appApi.resolveWorkspaceEditorKind(filePath)

      if (!editorKind) {
        return null
      }

      try {
        const content = editorKind === 'file'
          ? ''
          : await window.appApi.readWorkspaceFile(filePath)
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
        const nextActiveProject = nextProjectState.projects.find((project) => project.id === nextProjectState.lastProjectId)

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

  function openProjectMenu(
    mode: ProjectMenuMode,
    anchorRect?: ProjectMenuAnchorRect,
    options: ProjectMenuOpenOptions = {},
  ) {
    setProjectMenuSurface(options.surface ?? 'global')
    setProjectMenuAnchorRect(anchorRect ? serializeProjectMenuAnchorRect(anchorRect) : null)
    setProjectMenuSearch('')
    setProjectMenuMode(mode)
  }

  function closeProjectMenu() {
    setProjectMenuAnchorRect(null)
    setProjectMenuMode(null)
    setProjectMenuSurface('global')
    setProjectMenuSearch('')
  }

  function openNewProjectDialog() {
    setShouldStartAgentSessionAfterProjectCreate(shouldStartNewAgentSessionForProjectMenu())
    setNewProjectName('')
    setIsNewProjectDialogOpen(true)
    closeProjectMenu()
  }

  function shouldStartNewAgentSessionForProjectMenu() {
    return projectMenuMode === 'agent-new-switch'
      || (projectMenuMode === 'editor-switch' && !isAgentLayout)
  }

  async function activateProjectFromState(
    nextProjectState: ProjectState,
    options: { restoreTabs?: boolean, startAgentNewSession?: boolean } = {},
  ) {
    setProjectState(nextProjectState)
    const nextActiveProject = nextProjectState.projects.find((project) => project.id === nextProjectState.lastProjectId)

    if (!nextActiveProject) {
      return false
    }

    setActiveWorkspaceContext({ kind: 'project', projectId: nextActiveProject.id })
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
      await activateProjectFromState(nextProjectState, {
        startAgentNewSession: shouldStartAgentSessionAfterProjectCreate,
      })
      setIsNewProjectDialogOpen(false)
      setShouldStartAgentSessionAfterProjectCreate(false)
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
        startAgentNewSession: shouldStartNewAgentSessionForProjectMenu(),
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
      if (shouldStartNewAgentSessionForProjectMenu()) {
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
      const wasActive = activeWorkspaceContext.kind === 'project'
        && activeWorkspaceContext.projectId === project.id
      const nextProjectState = await window.appApi.removeProject(project.id)
      setProjectState(nextProjectState)

      if (wasActive) {
        const nextActiveProject = nextProjectState.projects.find((candidate) => candidate.id === nextProjectState.lastProjectId)
        if (nextActiveProject) {
          setActiveWorkspaceContext({ kind: 'project', projectId: nextActiveProject.id })
          await connectWorkspace(nextActiveProject.path)
          await restoreWorkspaceTabs(nextActiveProject.path, nextActiveProject.lastFilePath)
        } else {
          setActiveWorkspaceContext(conversationDraftContext)
          await disconnectWorkspaceSurface()
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
    request: { kind: 'new' } | { agentId: AgentId, kind: 'session', sessionPath: string },
  ) {
    agentProjectSessionRequestIdRef.current += 1
    const requestId = agentProjectSessionRequestIdRef.current
    const nextRequest = request.kind === 'session'
      ? {
          kind: 'session' as const,
          agentId: request.agentId,
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

  async function handleOpenProjectSession(project: ProjectRecord, agentId: AgentId, sessionPath: string) {
    await requestAgentProjectSession(project, { agentId, kind: 'session', sessionPath })
  }

  async function handleStartProjectSession(project: ProjectRecord) {
    await requestAgentProjectSession(project, { kind: 'new' })
  }

  async function handleStartContextualConversation() {
    if (activeProject) {
      await handleStartProjectSession(activeProject)
      return
    }

    await handleStartStandaloneConversation()
  }

  async function handleUseNoProject() {
    setIsProjectActionBusy(true)
    try {
      const didEnterDraft = await enterConversationDraft()
      if (didEnterDraft) {
        closeProjectMenu()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start a projectless conversation.'
      toast.danger('进入普通对话失败', { description: message })
      setStatusMessage(message)
    } finally {
      setIsProjectActionBusy(false)
    }
  }

  async function enterConversationDraft(options: { skipDirtyConfirm?: boolean } = {}) {
    if (!options.skipDirtyConfirm && currentPath && !(await confirmDiscardDirtyTabs('switch-workspace'))) {
      return false
    }

    await flushWorkspaceAutosave()
    await flushDiffAutosave()
    const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
    setActiveWorkspaceContext(nextContext)
    await disconnectWorkspaceSurface()
    setStatusMessage('新对话')
    return true
  }

  async function handleStartStandaloneConversation() {
    await enterConversationDraft()
  }

  async function handleCreateConversationWorkspace(request: CreateConversationWorkspaceRequest) {
    let record: ConversationRecord | null = null

    try {
      record = await window.appApi.createConversationWorkspace(request)

      if (!record.workspacePath) {
        throw new Error('Conversation workspace was not created.')
      }

      const nextConversationState = await window.appApi.getConversationState()
      setConversationState(nextConversationState)
      setActiveWorkspaceContext({ kind: 'conversation', conversationId: record.id })
      await connectWorkspace(record.workspacePath)
      return record
    } catch (error) {
      if (record) {
        setConversationState(await window.appApi.removeDraftConversation(record.id))
        const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
        setActiveWorkspaceContext(nextContext)
      }

      throw error
    }
  }

  async function handleConversationSessionStarted(
    conversationId: string,
    patch: {
      agentSessionPath: string | null
      lastMessagePreview?: string | null
      title?: string | null
      titleSource?: ConversationTitleSource
    },
  ) {
    const updatedConversation = await window.appApi.updateConversation(conversationId, {
      agentSessionPath: patch.agentSessionPath,
      lastMessagePreview: patch.lastMessagePreview ?? null,
      status: 'active',
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.titleSource !== undefined ? { titleSource: patch.titleSource } : {}),
    })
    setConversationState(await window.appApi.getConversationState())
    if (updatedConversation.workspacePath && updatedConversation.agentSessionPath) {
      await window.appApi.updateWorkspaceState(updatedConversation.workspacePath, {
        lastAgentSessionPath: updatedConversation.agentSessionPath,
      })
    }
  }

  async function handleConversationTitleSuggested(
    conversationId: string,
    suggestion: { agentSessionPath: string; title: string },
  ) {
    const nextTitle = suggestion.title.trim()

    if (!nextTitle) {
      return
    }

    try {
      const currentConversationState = await window.appApi.getConversationState()
      const conversation = currentConversationState.conversations.find((item) => item.id === conversationId) ?? null

      if (
        !conversation
        || conversation.agentSessionPath !== suggestion.agentSessionPath
        || conversation.titleSource === 'user'
        || conversation.title.trim() === nextTitle
      ) {
        setConversationState(currentConversationState)
        return
      }

      const updatedConversation = await window.appApi.updateConversation(conversationId, {
        title: nextTitle,
        titleSource: 'agent',
      })
      setConversationState(await window.appApi.getConversationState())

      if (activeWorkspaceContext.kind === 'conversation' && activeWorkspaceContext.conversationId === conversationId) {
        setStatusMessage(updatedConversation.title)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update the conversation title.'
      setStatusMessage(message)
      throw error
    }
  }

  async function handleConversationDraftFailed(conversationId: string) {
    const activeContext = await window.appApi.getActiveWorkspaceContext()
    const currentConversationState = await window.appApi.getConversationState()
    const failedConversation = currentConversationState.conversations.find((conversation) => conversation.id === conversationId) ?? null
    setConversationState(await window.appApi.removeDraftConversation(conversationId))

    if (activeContext.kind === 'conversation' && activeContext.conversationId === conversationId) {
      const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
      setActiveWorkspaceContext(nextContext)

      if (
        !failedConversation?.workspacePath
        || (
          currentPathRef.current
          && normalizeFilePath(currentPathRef.current) === normalizeFilePath(failedConversation.workspacePath)
        )
      ) {
        await disconnectWorkspaceSurface()
      }
    }
  }

  async function handleOpenConversation(conversation: ConversationRecord) {
    const targetWorkspacePath = conversation.workspacePath
    const isCurrentWorkspace = Boolean(
      currentPath
      && targetWorkspacePath
      && normalizeFilePath(currentPath) === normalizeFilePath(targetWorkspacePath),
    )

    if (currentPath && !isCurrentWorkspace) {
      if (!(await confirmDiscardDirtyTabs('switch-workspace'))) {
        return
      }
    }

    try {
      await window.appApi.setActiveWorkspaceContext({ kind: 'conversation', conversationId: conversation.id })
      setActiveWorkspaceContext({ kind: 'conversation', conversationId: conversation.id })

      const workspaceExists = targetWorkspacePath
        ? (await window.appApi.workspacePathExists(targetWorkspacePath)).exists
        : false

      if (!targetWorkspacePath || !workspaceExists) {
        await disconnectWorkspaceSurface({ unavailableMessage: '这个对话的工作目录已被移动或删除。' })
        setStatusMessage(`${conversation.title}：工作目录不可用`)
        toast.warning('对话工作目录不可用', { description: '这个对话的工作目录已被移动或删除。' })
        return
      }

      if (conversation.agentSessionPath) {
        await window.appApi.updateWorkspaceState(targetWorkspacePath, {
          lastAgentSessionPath: conversation.agentSessionPath,
        })
      }
      const sessionExists = conversation.agentSessionPath
        ? (await window.appApi.agentSessionExists({
            agentId: conversation.agentId,
            workspacePath: targetWorkspacePath,
          }, conversation.agentSessionPath)).exists
        : false
      await connectWorkspace(targetWorkspacePath)
      await restoreWorkspaceTabs(targetWorkspacePath)
      setPendingAgentProjectSessionRequest(null)
      setStatusMessage(conversation.title)

      if (!sessionExists) {
        toast.warning('无法恢复对话内容', { description: '对应的 Agent session 文件不存在或不可读。工作目录仍可继续浏览。' })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to open conversation.'
      toast.danger('打开对话失败', { description: message })
      setStatusMessage(message)
    }
  }

  async function handleRenameConversation(conversation: ConversationRecord, title: string) {
    const nextTitle = title.trim()

    if (!nextTitle || nextTitle === conversation.title.trim()) {
      return
    }

    try {
      const updatedConversation = await window.appApi.updateConversation(conversation.id, {
        title: nextTitle,
        titleSource: 'user',
      })
      setConversationState(await window.appApi.getConversationState())

      if (activeWorkspaceContext.kind === 'conversation' && activeWorkspaceContext.conversationId === conversation.id) {
        setStatusMessage(updatedConversation.title)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to rename conversation.'
      toast.danger('重命名对话失败', { description: message })
      setStatusMessage(message)
      throw error
    }
  }

  async function handleRemoveConversation(conversation: ConversationRecord) {
    const confirmed = await requestConfirm({
      title: '删除对话',
      message: `要删除“${conversation.title}”吗？\n\n这会从对话列表移除该记录，不会删除工作目录中的文件。`,
      confirmLabel: '删除',
      isDanger: true,
    })

    if (!confirmed) {
      return
    }

    const wasActive = activeWorkspaceContext.kind === 'conversation'
      && activeWorkspaceContext.conversationId === conversation.id

    try {
      if (wasActive) {
        await flushWorkspaceAutosave()
        await flushDiffAutosave()
      }

      const nextConversationState = await window.appApi.removeConversation(conversation.id)
      setConversationState(nextConversationState)

      if (wasActive) {
        setActiveWorkspaceContext(conversationDraftContext)

        if (
          !conversation.workspacePath
          || (
            currentPathRef.current
            && normalizeFilePath(currentPathRef.current) === normalizeFilePath(conversation.workspacePath)
          )
        ) {
          await disconnectWorkspaceSurface()
        }

        setStatusMessage('新对话')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to delete conversation.'
      toast.danger('删除对话失败', { description: message })
      setStatusMessage(message)
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

    const isSwitchMenu = projectMenuMode === 'editor-switch' || projectMenuMode === 'agent-new-switch'
    const hasProjectMenuProjects = projectState.projects.length > 0
    const renderedProjectMenuMode = isSwitchMenu && !hasProjectMenuProjects ? 'agent-add' : projectMenuMode
    const showProjectlessAction = isAgentLayout
      && renderedProjectMenuMode === 'agent-new-switch'
      && activeWorkspaceContext.kind === 'project'
    const menuStyle = resolveProjectMenuStyle(
      renderedProjectMenuMode,
      showProjectlessAction,
      frameRect,
    )
    const menuAnchor = createProjectMenuVirtualAnchor(projectMenuAnchorRect, frameRect)
    const collisionBoundary = resolveProjectMenuCollisionBoundary(frameRect)
    const menuAlign = renderedProjectMenuMode === 'editor-switch' ? 'center' : 'start'
    const projectMenuActions = (
      <>
        <div className='project-menu-actions'>
          <Menu.Item
            nativeButton
            render={<button type='button' />}
            className={({ highlighted }) => `project-menu-action${highlighted ? ' is-highlighted' : ''}`}
            disabled={isProjectActionBusy}
            label='新建空白项目'
            onClick={openNewProjectDialog}
          >
            <NewFolderLine size={18} />
            <span>新建空白项目</span>
          </Menu.Item>
          <Menu.Item
            nativeButton
            render={<button type='button' />}
            className={({ highlighted }) => `project-menu-action${highlighted ? ' is-highlighted' : ''}`}
            disabled={isProjectActionBusy}
            label='使用现有文件夹'
            onClick={() => {
              void handleAddExistingProject()
            }}
          >
            <FolderOpenLine size={18} />
            <span>使用现有文件夹</span>
          </Menu.Item>
        </div>
        {showProjectlessAction ? (
          <div className='project-menu-actions project-menu-projectless-actions'>
            <Menu.Item
              nativeButton
              render={<button type='button' />}
              className={({ highlighted }) => `project-menu-action${highlighted ? ' is-highlighted' : ''}`}
              disabled={isProjectActionBusy}
              label='不使用项目'
              onClick={() => {
                void handleUseNoProject()
              }}
            >
              <FolderForbidLine size={18} />
              <span className='project-menu-action-spacer'>不使用项目</span>
            </Menu.Item>
          </div>
        ) : null}
      </>
    )

    return (
      <Menu.Root
        modal={false}
        open={isProjectMenuOpen}
        onOpenChange={(open, details) => {
          if (open) {
            return
          }

          if (shouldCloseClickOpenedMenu(details)) {
            closeProjectMenu()
          } else {
            details.cancel?.()
          }
        }}
      >
        <Menu.Portal
          container={portalContainer ?? undefined}
        >
          <Menu.Backdrop
            className={`project-menu-backdrop${surface === 'global' ? '' : ' is-local'}`}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) {
                closeProjectMenu()
              }
            }}
          />
          <Menu.Positioner
            align={menuAlign}
            anchor={menuAnchor}
            className={`project-menu-positioner${surface === 'global' ? '' : ' is-local'}`}
            collisionAvoidance={{ side: 'flip', align: 'shift', fallbackAxisSide: 'none' }}
            collisionBoundary={collisionBoundary}
            collisionPadding={PROJECT_MENU_MARGIN_PX}
            positionMethod='fixed'
            side='bottom'
            sideOffset={PROJECT_MENU_GAP_PX}
          >
            <Menu.Popup
              className={`project-menu project-menu-${renderedProjectMenuMode}`}
              data-surface={surface}
              aria-label={isSwitchMenu && hasProjectMenuProjects ? '切换项目' : '添加项目'}
              finalFocus={false}
              style={menuStyle}
            >
              {isSwitchMenu && hasProjectMenuProjects ? (
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
                      const isActive = activeWorkspaceContext.kind === 'project'
                        && project.id === activeWorkspaceContext.projectId

                      return (
                        <Menu.Item
                          key={project.id}
                          nativeButton
                          render={<button type='button' />}
                          className={({ highlighted }) => (
                            `project-menu-project${isActive ? ' is-active' : ''}${highlighted ? ' is-highlighted' : ''}`
                          )}
                          disabled={isProjectActionBusy}
                          label={project.name}
                          onClick={() => {
                            void handleSelectProject(project)
                          }}
                        >
                          <ProjectIcon />
                          <span className='project-menu-project-name'>{project.name}</span>
                          {isActive ? <CheckLine className='project-menu-project-check' size={16} /> : null}
                        </Menu.Item>
                      )
                    })}
                    {filteredProjectMenuProjects.length === 0 ? (
                      <div className='project-menu-empty'>没有匹配项目</div>
                    ) : null}
                  </AppScrollArea>
                  {projectMenuActions}
                </>
              ) : projectMenuActions}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    )
  }

  function renderNewProjectDialog() {
    return (
      <Modal.Backdrop
        isOpen={isNewProjectDialogOpen}
        onOpenChange={(isOpen) => {
          setIsNewProjectDialogOpen(isOpen)
          if (!isOpen) {
            setShouldStartAgentSessionAfterProjectCreate(false)
          }
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
                  <Button
                    variant='tertiary'
                    type='button'
                    onPress={() => {
                      setIsNewProjectDialogOpen(false)
                      setShouldStartAgentSessionAfterProjectCreate(false)
                    }}
                  >
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
            <p>Aryn 会把编辑器、Git、文件树和 Agent 对话绑定到当前项目。</p>
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
          onOpenCommitFileDiff={(commitHash, change) => {
            void openGitCommitFileDiff(commitHash, change)
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

            void (async () => {
              await performWorkspaceRefresh(currentPath, {
                gitSilent: false,
                refreshGit: true,
              })
              setGitHistoryRefreshVersion((version) => version + 1)
            })()
          }}
          onRevertCommit={(commit) => {
            void handleRevertGitCommit(commit)
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
      <BaseTabs.Root
        className='sidebar-workspace-tabs'
        orientation='horizontal'
        value={activeLeftSidebarTab}
        onValueChange={(value) => {
          if (value === 'file' || value === 'git') {
            setActiveLeftSidebarTab(value)
          }
        }}
      >
        <div className='sidebar-workspace-tabs-list-container'>
          <BaseTabs.List aria-label='工作区面板' className='sidebar-workspace-tabs-list'>
            <BaseTabs.Tab value='file' className='sidebar-workspace-tab'>
              <FolderLine size={16} className='sidebar-workspace-tab-icon' />
              <span className='sidebar-workspace-tab-label'>文件</span>
            </BaseTabs.Tab>
            <BaseTabs.Tab value='git' className='sidebar-workspace-tab'>
              <GitBranchLine size={16} className='sidebar-workspace-tab-icon' />
              <span className='sidebar-workspace-tab-label'>更改</span>
            </BaseTabs.Tab>
            <BaseTabs.Indicator className='sidebar-workspace-tab-indicator' />
          </BaseTabs.List>
          {tabListAction ? (
            <div className='sidebar-workspace-tabs-action'>
              {tabListAction}
            </div>
          ) : null}
        </div>

        <BaseTabs.Panel value='file' className='sidebar-workspace-tab-panel'>
          {renderWorkspaceTreePanel({
            ...workspaceTreeOptions,
            surfaceMode,
          })}
        </BaseTabs.Panel>
        <BaseTabs.Panel value='git' className='sidebar-workspace-tab-panel'>
          {renderGitPanel({ surfaceMode })}
        </BaseTabs.Panel>
      </BaseTabs.Root>
    )
  }

  async function handleSelectWorkspaceIconTheme(
    mode: WorkspaceIconThemeMode,
    selection: WorkspaceIconThemeSelection,
  ) {
    const currentIconTheme = iconThemes[mode]
    const isDefaultSelection = !selection.themeId && !selection.sourceVsixPath

    if (
      !isDefaultSelection
      && currentIconTheme?.activeThemeId === selection.themeId
      && currentIconTheme.sourceVsixPath === selection.sourceVsixPath
    ) {
      return
    }

    try {
      setIsApplyingIconTheme(true)
      const nextIconTheme = await window.appApi.setWorkspaceIconTheme(mode, selection)

      setIconThemes((currentValue) => ({
        ...currentValue,
        [mode]: nextIconTheme,
      }))
      setIconThemeOptions(await window.appApi.getWorkspaceIconThemeCatalog())
      setStatusMessage(nextIconTheme
        ? `${nextIconTheme.extensionLabel}: ${nextIconTheme.activeThemeLabel}`
        : '文件图标主题：默认')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to switch the icon theme.'
      setStatusMessage(message)
    } finally {
      setIsApplyingIconTheme(false)
    }
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
        && tab.diff.source.kind === 'working-tree'
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
      setActiveAgentLayoutFixedTab(tabId === FIXED_GIT_TAB_ID ? 'git' : 'file')
      setIsAgentLayoutFixedTabActive(true)
      return
    }

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
      setGitHistoryRefreshVersion((version) => version + 1)
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
      setGitHistoryRefreshVersion((version) => version + 1)
      setGitCommitMessage('')
      await syncOpenDiffTabs(currentPath)
      setStatusMessage('提交并同步已完成')
    })
  }

  async function handleRevertGitCommit(commit: GitCommitItem) {
    if (!currentPath) {
      return
    }

    if (!(await ensureWorkspaceTabsSavedBeforeGitAction({
      actionLabel: '还原 Git 提交',
    }))) {
      return
    }

    const confirmed = await requestConfirm({
      title: '还原提交',
      message: `要还原提交“${commit.subject}”（${commit.shortHash}）吗？\n\n这会创建一个新提交来撤销它引入的更改，不会改写现有历史。`,
      confirmLabel: '还原提交',
    })

    if (!confirmed) {
      return
    }

    await runGitAction('正在还原提交...', async () => {
      const nextState = await window.appApi.revertGitCommit(currentPath, commit.hash)
      setGitRepositoryState(nextState)
      setGitHistoryRefreshVersion((version) => version + 1)
      await loadTree(currentPath)
      await syncOpenDiffTabs(currentPath)
      setStatusMessage(`提交 ${commit.shortHash} 已还原`)
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
      setGitHistoryRefreshVersion((version) => version + 1)
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
          persistedLightIconTheme,
          persistedDarkIconTheme,
          persistedIconThemeOptions,
        ] = await Promise.all([
          window.appApi.getWorkspaceIconTheme('light'),
          window.appApi.getWorkspaceIconTheme('dark'),
          window.appApi.getWorkspaceIconThemeCatalog(),
        ])
        if (!cancelled) {
          setIconThemes({
            dark: persistedDarkIconTheme,
            light: persistedLightIconTheme,
          })
          setIconThemeOptions(persistedIconThemeOptions)
        }
      } catch {
        if (!cancelled) {
          setIconThemes(createEmptyWorkspaceIconThemes())
          setIconThemeOptions([])
        }
      }

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

      setProjectState(nextProjectState)
      setConversationState(nextConversationState)
      setActiveWorkspaceContext(nextActiveContext)
      setHasLoadedProjectState(true)
      const activeProject = nextActiveContext.kind === 'project'
        ? nextProjectState.projects.find((project) => project.id === nextActiveContext.projectId) ?? null
        : nextProjectState.projects.find((project) => project.id === nextProjectState.lastProjectId) ?? null
      const activeConversation = nextActiveContext.kind === 'conversation'
        ? nextConversationState.conversations.find((conversation) => conversation.id === nextActiveContext.conversationId) ?? null
        : null

      if (nextActiveContext.kind === 'conversation') {
        if (!activeConversation) {
          const nextContext = await window.appApi.setActiveWorkspaceContext(conversationDraftContext)
          setActiveWorkspaceContext(nextContext)
          await disconnectWorkspaceSurface()
          setStatusMessage('新对话')
          return
        }

        if (!activeConversation.workspacePath) {
          await disconnectWorkspaceSurface({ unavailableMessage: '这个对话没有可恢复的工作目录。' })
          setStatusMessage('对话工作目录不可用')
          return
        }

        try {
          const workspaceExists = (await window.appApi.workspacePathExists(activeConversation.workspacePath)).exists

          if (!workspaceExists) {
            await disconnectWorkspaceSurface({ unavailableMessage: '这个对话的工作目录已被移动或删除。' })
            setStatusMessage(`${activeConversation.title}：工作目录不可用`)
            toast.warning('对话工作目录不可用', { description: '上次打开的普通对话目录已被移动或删除。' })
            return
          }

          if (activeConversation.agentSessionPath) {
            await window.appApi.updateWorkspaceState(activeConversation.workspacePath, {
              lastAgentSessionPath: activeConversation.agentSessionPath,
            })
          }
          const sessionExists = activeConversation.agentSessionPath
            ? (await window.appApi.agentSessionExists({
                agentId: activeConversation.agentId,
                workspacePath: activeConversation.workspacePath,
              }, activeConversation.agentSessionPath)).exists
            : false
          await connectWorkspace(activeConversation.workspacePath)
          if (!cancelled) {
            await restoreWorkspaceTabs(activeConversation.workspacePath)
          }

          if (!cancelled) {
            setStatusMessage(activeConversation.title)

            if (!sessionExists) {
              toast.warning('无法恢复对话内容', { description: '对应的 Agent session 文件不存在或不可读。工作目录仍可继续浏览。' })
            }
          }
        } catch (error) {
          if (!cancelled) {
            const message = error instanceof Error ? error.message : 'Unable to restore conversation.'
            setStatusMessage(message)
          }
        }
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
      || activeDiffTab.diff.source.kind !== 'working-tree'
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
    activeDiffTab?.diff.source.kind,
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

      const affectedTab = useWorkspaceStore.getState().openTabs.find(
        (tab): tab is WorkspaceFileTab => tab.kind === 'file' && tab.filePath === event.path,
      )

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

        if (affectedTab.viewMode === 'file') {
          setStatusMessage(`${getBaseName(event.path)} is up to date`)
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

        if (affectedTab.viewMode === 'file') {
          setStatusMessage(`${getBaseName(event.path)} changed on disk`)
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
    let animationFrameId: number | null = null
    let latestPointerClientX: number | null = null

    function applyLatestPointerPosition() {
      if (latestPointerClientX === null) {
        return
      }

      const pointerClientX = latestPointerClientX
      latestPointerClientX = null
      resizeSidebarRef.current(resizePanel, pointerClientX)
    }

    function handlePointerMove(event: PointerEvent) {
      latestPointerClientX = event.clientX

      if (animationFrameId !== null) {
        return
      }

      animationFrameId = window.requestAnimationFrame(() => {
        animationFrameId = null
        applyLatestPointerPosition()
      })
    }

    function stopResizing(event: PointerEvent) {
      if (event.type === 'pointerup') {
        latestPointerClientX = event.clientX
      }

      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
        animationFrameId = null
      }

      applyLatestPointerPosition()
      finishSidebarResizeRef.current(resizePanel)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)
    window.addEventListener('pointercancel', stopResizing)

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    return () => {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId)
      }

      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
      window.removeEventListener('pointercancel', stopResizing)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [activeResizePanel])

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
    if (activeResizePanel || isGitPanelResizing) {
      finishSidebarLayoutTransition()
    }
  }, [activeResizePanel, finishSidebarLayoutTransition, isGitPanelResizing])

  useEffect(() => {
    let syncFrameId: number | null = null

    function syncShellWidth() {
      const nextShellWidth = getShellWidth()
      setShellWidth((currentWidth) => (
        currentWidth === nextShellWidth ? currentWidth : nextShellWidth
      ))
    }

    function scheduleShellWidthSync() {
      finishSidebarLayoutTransition()

      if (syncFrameId !== null) {
        return
      }

      syncFrameId = window.requestAnimationFrame(() => {
        syncFrameId = null
        syncShellWidth()
      })
    }

    syncShellWidth()

    const shell = appShellRef.current
    const resizeObserver = typeof ResizeObserver !== 'undefined' && shell
      ? new ResizeObserver(() => {
        scheduleShellWidthSync()
      })
      : null

    if (shell && resizeObserver) {
      resizeObserver.observe(shell)
    }

    window.addEventListener('resize', scheduleShellWidthSync)

    return () => {
      if (syncFrameId !== null) {
        window.cancelAnimationFrame(syncFrameId)
      }

      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleShellWidthSync)
    }
  }, [finishSidebarLayoutTransition])

  useEffect(() => {
    if (activeResizePanel) {
      return
    }

    const timeout = window.setTimeout(() => {
      void window.appApi.updateLayoutState({
        activeLeftSidebarTab,
        agentChatWidth,
        agentRightSidebarCollapsed: isAgentRightSidebarCollapsed,
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
    activeResizePanel,
    agentChatWidth,
    editorRightSidebarWidth,
    gitPanelHeight,
    gitPanelLayout,
    isAgentRightSidebarCollapsed,
    isEditorRightSidebarCollapsed,
    isLeftSidebarCollapsed,
    leftSidebarWidth,
  ])

  useEffect(() => {
    if (activeResizePanel) {
      return
    }

    const nextLeftWidth = clampLeftWidth(leftSidebarWidth, shellWidth, rightSidebarWidthReservedForLeftClamp)

    if (nextLeftWidth !== leftSidebarWidth) {
      setLeftSidebarWidth(nextLeftWidth)
    }

    if (isAgentLayout) {
      if (!isRightSidebarVisible) {
        return
      }

      const nextAgentChatWidth = clampAgentChatWidth(
        agentChatWidth,
        shellWidth,
        isLeftSidebarVisible ? nextLeftWidth : 0,
      )

      if (nextAgentChatWidth !== agentChatWidth) {
        setAgentChatWidth(nextAgentChatWidth)
      }

      return
    }

    if (!isRightSidebarVisible) {
      return
    }

    const nextRightWidth = clampEditorRightWidth(
      editorRightSidebarWidth,
      shellWidth,
      isLeftSidebarVisible ? nextLeftWidth : 0,
    )
    if (nextRightWidth !== editorRightSidebarWidth) {
      setEditorRightSidebarWidth(nextRightWidth)
    }
  }, [
    activeResizePanel,
    agentChatWidth,
    editorRightSidebarWidth,
    isAgentLayout,
    isLeftSidebarVisible,
    isRightSidebarVisible,
    leftSidebarWidth,
    rightSidebarWidthReservedForLeftClamp,
    shellWidth,
  ])

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

  useEffect(() => {
    if (!isLeftSidebarVisible && activeResizePanel === 'left') {
      sidebarResizePreviewRef.current = null
      sidebarResizeSessionRef.current = null
      setActiveResizePanel(null)
    }

    if (!isRightSidebarVisible && activeResizePanel === 'right') {
      sidebarResizePreviewRef.current = null
      sidebarResizeSessionRef.current = null
      setActiveResizePanel(null)
    }
  }, [activeResizePanel, isLeftSidebarVisible, isRightSidebarVisible])

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
  const revealEditorAssistantSurface = useCallback(() => {
    if (isAgentLayout) {
      return
    }

    if (isRightSidebarDrawer) {
      handleRightDrawerOpenChange(true)
      return
    }

    setIsEditorRightSidebarCollapsed(false)
  }, [handleRightDrawerOpenChange, isAgentLayout, isRightSidebarDrawer])
  const handleOpenSession = useCallback((sessionPath: string) => {
    const currentProject = currentPath
      ? projectState.projects.find((project) => normalizeFilePath(project.path) === normalizeFilePath(currentPath))
      : null

    if (currentPath && currentProject) {
      agentProjectSessionRequestIdRef.current += 1
      setPendingAgentProjectSessionRequest({
        agentId: agentWorkspaceState?.runtime.agentId ?? DEFAULT_AGENT_ID,
        kind: 'session',
        projectId: currentProject.id,
        requestId: agentProjectSessionRequestIdRef.current,
        sessionPath,
      })
      revealEditorAssistantSurface()
    }
  }, [agentWorkspaceState?.runtime.agentId, currentPath, projectState.projects, revealEditorAssistantSurface])
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
    const hasDrawerDragTarget = (isLeftDrawerOpen && isLeftSidebarDrawer)
      || (isRightDrawerOpen && isRightSidebarDrawer)

    if (!hasDrawerDragTarget) {
      setDrawerDragRegion(null)
      return
    }

    let cancelled = false
    let rafId = 0
    let frameCount = 0
    let stableFrameCount = 0
    let previousRectSignature = ''
    let resizeObserver: ResizeObserver | null = null
    let observedDragSpacer: HTMLElement | null = null

    const publishDragRegion = (rect: DOMRect) => {
      setDrawerDragRegion((currentRegion) => {
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

    const resolveDragSpacer = () => {
      if (isLeftDrawerOpen && isLeftSidebarDrawer) {
        return leftDrawerSurfaceRef.current?.querySelector<HTMLElement>('.section-title-drag-spacer') ?? null
      }

      if (isRightDrawerOpen && isRightSidebarDrawer) {
        return rightDrawerSurfaceRef.current?.querySelector<HTMLElement>('.agent-threadbar-drag-spacer, .file-tabs-drag-spacer') ?? null
      }

      return null
    }

    const syncResizeObserver = (dragSpacer: HTMLElement) => {
      if (typeof ResizeObserver === 'undefined' || observedDragSpacer === dragSpacer) {
        return
      }

      resizeObserver?.disconnect()
      resizeObserver = new ResizeObserver(() => {
        publishDragRegion(dragSpacer.getBoundingClientRect())
      })
      resizeObserver.observe(dragSpacer)
      observedDragSpacer = dragSpacer
    }

    const tick = () => {
      if (cancelled) {
        return
      }

      frameCount += 1

      const dragSpacer = resolveDragSpacer()
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
      syncResizeObserver(dragSpacer)

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

    return () => {
      cancelled = true
      window.cancelAnimationFrame(rafId)
      resizeObserver?.disconnect()
    }
  }, [isLeftDrawerOpen, isLeftSidebarDrawer, isRightDrawerOpen, isRightSidebarDrawer, shellWidth])

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

    runSidebarLayoutTransition(() => {
      setIsRightSidebarCollapsed((currentValue) => {
        if (currentValue && !isAgentLayout) {
          setEditorRightSidebarWidth(
            clampEditorRightWidth(editorRightSidebarWidth, getShellWidth(), effectiveLeftSidebarWidth),
          )
        }

        return !currentValue
      })
    })
  }, [
    editorRightSidebarWidth,
    effectiveLeftSidebarWidth,
    handleRightDrawerOpenChange,
    isAgentLayout,
    isRightDrawerOpen,
    isRightSidebarDrawer,
    runSidebarLayoutTransition,
  ])

  function expandCollapsedAssistantSurface() {
    if (isRightSidebarDrawer) {
      handleRightDrawerOpenChange(true)
      return
    }

    if (!isRightSidebarCollapsed) {
      return
    }

    runSidebarLayoutTransition(() => {
      setIsRightSidebarCollapsed((currentValue) => {
        if (!currentValue) {
          return currentValue
        }

        if (!isAgentLayout) {
          setEditorRightSidebarWidth(
            clampEditorRightWidth(editorRightSidebarWidth, getShellWidth(), effectiveLeftSidebarWidth),
          )
        }

        return false
      })
    })
  }

  function handleCollapsedAgentFixedTabClick(tab: AgentLayoutFixedTab) {
    expandCollapsedAssistantSurface()

    if (tab === 'git') {
      activateFileTab(FIXED_GIT_TAB_ID)
      return
    }

    activateFileTab(FIXED_FILE_TAB_ID)
  }

  const isEditorLayoutSwitchDisabled = activeWorkspaceContext.kind === 'conversationDraft' && isAgentLayout

  const renderLayoutModeSwitchButton = () => (
    <BaseTabs.Root
      className='layout-mode-tabs-root'
      orientation='horizontal'
      value={appLayoutPreference}
      onValueChange={(value) => {
        if (value === 'agent') {
          setLayoutPreference('agent')
          return
        }

        if (value === 'editor' && !isEditorLayoutSwitchDisabled) {
          setLayoutPreference('editor')
        }
      }}
    >
      <BaseTabs.List
        className='layout-mode-segmented-control'
        aria-label='Layout mode'
      >
        <AppTooltip tooltip='Agent 模式' triggerMode='focusable'>
          <BaseTabs.Tab
            value='agent'
            className={`layout-mode-segmented-option${isAgentLayout ? ' is-active' : ''}`}
            aria-label='Agent mode'
          >
            <Chat3Line size={16} aria-hidden='true' />
          </BaseTabs.Tab>
        </AppTooltip>
        <AppTooltip
          tooltip={isEditorLayoutSwitchDisabled ? '先选择工作目录' : '编辑器模式'}
          triggerMode='focusable'
        >
          <BaseTabs.Tab
            value='editor'
            className={`layout-mode-segmented-option${!isAgentLayout ? ' is-active' : ''}`}
            disabled={isEditorLayoutSwitchDisabled}
            aria-label={isEditorLayoutSwitchDisabled ? 'Editor mode, select a workspace first' : 'Editor mode'}
          >
            <FolderLine size={16} aria-hidden='true' />
          </BaseTabs.Tab>
        </AppTooltip>
        <BaseTabs.Indicator className='layout-mode-segmented-indicator' />
      </BaseTabs.List>
    </BaseTabs.Root>
  )

  const renderLeftChromeSearchButton = () => (
    <AppTooltipButton
      type='button'
      className='panel-toggle-button left-chrome-search-button'
      aria-label='Open search'
      tooltip='搜索'
      preventFocusOnPress
      onClick={handleOpenCommandPaletteFromChrome}
    >
      <Icon icon='lucide:search' width={16} height={16} aria-hidden='true' />
    </AppTooltipButton>
  )

  const renderLeftSidebarToggleButton = () => {
    const toggleAriaLabel = isLeftSidebarDrawer
      ? (isLeftDrawerOpen ? 'Close workspace panel' : 'Open workspace panel')
      : (isLeftSidebarVisible ? 'Collapse sidebar' : 'Expand sidebar')
    const toggleTooltip = isLeftSidebarDrawer
      ? (isLeftDrawerOpen ? '关闭抽屉' : '打开抽屉')
      : (isLeftSidebarVisible ? '收起侧边栏' : '展开侧边栏')

    return (
      <AppTooltipButton
        type='button'
        className='panel-toggle-button'
        aria-label={toggleAriaLabel}
        tooltip={toggleTooltip}
        preventFocusOnPress
        onClick={() => {
          if (isLeftSidebarDrawer) {
            handleLeftDrawerOpenChange(!isLeftDrawerOpen)
            return
          }

          runSidebarLayoutTransition(() => {
            setIsLeftSidebarCollapsed((currentValue) => {
              const nextCollapsed = !currentValue

              return nextCollapsed
            })
          })
        }}
      >
        <span className='panel-toggle-icon' aria-hidden='true'>
          <LayoutLeftLine size={16} />
        </span>
      </AppTooltipButton>
    )
  }

  function renderWorkspaceSidebar(surfaceMode: PanelSurfaceMode) {
    const isDrawerSurface = surfaceMode === 'drawer'
    const workspaceSwitchButtonClassName = `section-title-text editor-workspace-switch-button${currentPath ? '' : ' is-empty'}`
    const renderWorkspaceSwitchButton = (className = 'section-title-text', showDropdownIcon = false) => (
      <button
        type='button'
        onClick={(event) => {
          openProjectMenu(
            'editor-switch',
            event.currentTarget.getBoundingClientRect(),
            { surface: isDrawerSurface ? 'left-drawer' : 'global' },
          )
        }}
        disabled={isPickingWorkspace}
        className={className}
        aria-label={isPickingWorkspace ? 'Opening workspace' : '选择或切换工作目录'}
      >
        <ProjectIcon />
        <span className='section-title-label'>{editorWorkspaceSwitchLabel}</span>
        {showDropdownIcon ? (
          <DownLine className='editor-workspace-switch-chevron' size={16} aria-hidden='true' />
        ) : null}
      </button>
    )

    return (
      <div
        ref={isDrawerSurface ? leftDrawerSurfaceRef : undefined}
        className={`workspace-sidebar-surface${isDrawerSurface ? ' is-drawer' : ''}`}
        data-platform={shellPlatform}
        style={isDrawerSurface ? shellChromeVars : undefined}
      >
        <div className={`section-title workspace-section-title${isDrawerSurface ? ' is-drawer-surface' : ''}`}>
          <div className='section-title-drag-spacer' aria-hidden='true' />
          {isDrawerSurface ? renderLeftChromeSearchButton() : null}
          {isDrawerSurface ? renderLeftSidebarToggleButton() : null}
        </div>

        {!isAgentLayout ? (
          <div className='editor-workspace-switch-row'>
            {renderWorkspaceSwitchButton(workspaceSwitchButtonClassName, true)}
          </div>
        ) : null}

        <div ref={isDrawerSurface ? undefined : leftSidebarBodyRef} className='sidebar-stack'>
          {isAgentLayout ? (
            <AgentSessionTree
              isProjectAddMenuOpen={isProjectAddMenuOpenForSurface(isDrawerSurface ? 'left-drawer' : 'global')}
              menuPortalTarget={isDrawerSurface ? leftDrawerOverlayRoot : null}
              onOpenProjectAddMenu={isDrawerSurface
                ? (anchorRect) => openProjectMenu('agent-add', anchorRect, { surface: 'left-drawer' })
                : undefined}
              onRequestClose={isDrawerSurface ? () => setIsLeftDrawerOpen(false) : undefined}
            />
          ) : (
            renderSidebarWorkspaceTabs({ surfaceMode })
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
        {isDrawerSurface ? (
          <div ref={setLeftDrawerOverlayRoot} className='drawer-local-overlay-root'>
            {renderProjectMenu('left-drawer', leftDrawerOverlayRoot?.getBoundingClientRect() ?? null)}
          </div>
        ) : null}
      </div>
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
      <AppTooltipButton
        type='button'
        className={`editor-directory-toggle${isDirectorySidebarVisible ? ' is-active' : ''}`}
        aria-label={isDirectorySidebarVisible ? '隐藏目录侧边栏' : '显示目录侧边栏'}
        aria-pressed={isDirectorySidebarVisible}
        onClick={() => setIsDirectorySidebarOpen((currentValue) => !currentValue)}
        tooltip={isDirectorySidebarVisible ? '隐藏目录' : '显示目录'}
      >
        <Icon
          icon={isDirectorySidebarVisible ? 'ri:menu-fold-line' : 'ri:menu-fold-2-line'}
          width={16}
          height={16}
          aria-hidden='true'
        />
      </AppTooltipButton>
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
      <aside className='editor-directory-sidebar'>
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
      </aside>
    )
  }

  function renderEditorEmptyState() {
    return !currentPath ? (
      <div className='editor-empty-state is-workspace-missing'>
        <div className='editor-empty-content'>
          <div className='editor-empty-logo-shell' aria-hidden='true'>
            <FolderOpenLine className='editor-empty-folder-icon' size={30} />
          </div>
          <div className='editor-empty-copy'>
            <h3>选择工作目录</h3>
            <p>当前对话会保留在右侧。连接一个文件夹后，可以在这里浏览、搜索和编辑文件。</p>
          </div>
          <div className='editor-empty-actions'>
            <Button
              ref={editorEmptyWorkspaceTriggerRef}
              variant='primary'
              onPress={() => {
                openProjectMenu(
                  'editor-switch',
                  editorEmptyWorkspaceTriggerRef.current?.getBoundingClientRect(),
                )
              }}
              isDisabled={isPickingWorkspace}
            >
              <FolderOpenLine className='mr-2' size={16} />
              选择工作目录
            </Button>
          </div>
        </div>
      </div>
    ) : (
      <div className='editor-empty-state'>
        <div className='editor-empty-content'>
          <div className='editor-empty-logo-shell' aria-hidden='true'>
            <img className='editor-empty-logo' src='./branding/logo.svg' alt='' />
          </div>
          <div className='editor-empty-copy'>
            <h3>打开文件开始编辑</h3>
            <p>从左侧文件树选择一个文件，或使用搜索快速打开内容。</p>
          </div>
          <div className='editor-empty-actions'>
            <Button variant='outline' onPress={() => setIsCommandPaletteOpen(true)}>
              <SearchLine className='mr-2' size={16} />
              搜索
            </Button>
            <Button
              variant='outline'
              onPress={() => {
                void handleCreateFile()
              }}
              isDisabled={isCreatingFile}
            >
              <FileLine className='mr-2' size={16} />
              新建文件
            </Button>
          </div>
        </div>
      </div>
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
      ? <span className='editor-directory-toggle-spacer' aria-hidden='true' />
      : null
    const isCodeEditorView = Boolean(activeFileTab && (
      (currentEditorKind === 'code' && currentFileViewMode === 'code')
      || (currentEditorKind === 'prose' && currentFileViewMode === 'code')
    ))
    const isHtmlPreviewEditorView = Boolean(activeFileTab && currentEditorKind === 'code' && currentFileViewMode === 'preview')
    const isFileSurfaceView = Boolean(activeFileTab && currentEditorKind === 'file' && currentFileViewMode === 'file')

    return (
      <div className='editor-frame'>
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

        <div className='editor-content-shell' id='editor-content-panel'>
          {activeFixedPanelTab?.fixedTabKind === 'file-panel' ? renderFixedFilePanel() : null}
          {activeFixedPanelTab?.fixedTabKind === 'git-panel' ? renderGitPanel() : null}
          {isDirectorySidebarVisible ? renderDirectorySidebar({
            action: directorySidebarToggle,
            fileClickMode: 'replace-active-tab',
          }) : null}
          {isDirectoryToggleSlotVisible ? (
            <div className='editor-directory-toggle-slot'>
              {directorySidebarToggle}
            </div>
          ) : null}
          {!activeFixedPanelTab && !activeFileTab && !activeDiffTab ? renderEditorEmptyState() : null}

          {shouldRenderWorkspaceEditor && activeDiffTab ? (
            <Suspense fallback={<EditorLoadingState label='Loading diff editor...' />}>
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
            <Suspense fallback={<EditorLoadingState />}>
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
            <div className='editor-view-shell'>
              {editorToolbarLeadingAction ? (
                <div className='editor-plain-toolbar'>
                  {editorToolbarLeadingAction}
                </div>
              ) : null}
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
            </div>
          ) : null}

          {shouldRenderWorkspaceEditor && activeFileTab && isHtmlPreviewEditorView ? (
            <div className='editor-view-shell'>
              {editorToolbarLeadingAction ? (
                <div className='editor-plain-toolbar'>
                  {editorToolbarLeadingAction}
                </div>
              ) : null}
              <HtmlPreview
                content={currentFileContent}
                filePath={activeFileTab.filePath}
              />
            </div>
          ) : null}

          {shouldRenderWorkspaceEditor && activeFileTab && isFileSurfaceView ? (
            <div className='editor-view-shell'>
              <Suspense fallback={<EditorLoadingState label='正在加载文件...' />}>
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
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const leftChromeSurface = isLeftDrawerOpen ? 'drawer' : isLeftSidebarVisible ? 'docked' : 'collapsed'

  const leftChromeControls = (
    <div
      className='left-chrome-actions'
      data-left-surface={leftChromeSurface}
      data-overlay-elevated={shellChromeOverlayState.leftControlsElevated ? 'true' : 'false'}
      data-react-aria-top-layer={shellChromeOverlayState.leftControlsTopLayer ? 'true' : undefined}
    >
      {renderLayoutModeSwitchButton()}
      {!isLeftDrawerOpen ? (
        <>
          {isLeftSidebarVisible ? <div className='left-chrome-drag-spacer' aria-hidden='true' /> : null}
          {renderLeftChromeSearchButton()}
          {renderLeftSidebarToggleButton()}
        </>
      ) : null}
    </div>
  )

  const appShell = (
    <div
      ref={appShellRef}
      className="app-shell"
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
      onTransitionEnd={handleSidebarLayoutTransitionEnd}
      style={
        {
          '--git-panel-height': `${gitPanelHeight}px`,
          '--agent-chat-track-width': `${effectiveAgentChatTrackWidth}px`,
          '--agent-editor-track-width': `${effectiveAgentEditorTrackWidth}px`,
          '--left-sidebar-content-width': `${renderedLeftSidebarWidth}px`,
          '--left-sidebar-width': `${effectiveLeftSidebarWidth}px`,
          '--right-sidebar-content-width': `${renderedEditorRightSidebarWidth}px`,
          '--right-sidebar-width': `${effectiveRightSidebarWidth}px`,
          ...shellChromeVars,
        } as CSSProperties
      }
    >
      {isAgentLayout && shouldExposeAgentWorkspaceTools && !isRightSidebarVisible ? (
        <div
          className='agent-collapsed-tab-actions'
          data-overlay-elevated={shellChromeOverlayState.rightControlsElevated ? 'true' : 'false'}
          data-react-aria-top-layer={shellChromeOverlayState.rightControlsTopLayer ? 'true' : undefined}
        >
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
        </div>
      ) : null}

      {shouldExposeAgentWorkspaceTools ? (() => {
        const rightSidebarToggleAriaLabel = isRightSidebarDrawer
          ? (isRightDrawerOpen ? 'Close assistant panel' : 'Open assistant panel')
          : (isRightSidebarVisible ? 'Collapse assistant sidebar' : 'Expand assistant sidebar')
        const rightSidebarToggleTooltip = isRightSidebarDrawer
          ? (isRightDrawerOpen ? '关闭抽屉' : '打开抽屉')
          : (isRightSidebarVisible ? '收起侧边栏' : '展开侧边栏')

        return (
          <AppTooltipButton
            type='button'
            className='panel-toggle-button panel-toggle-button-overlay panel-toggle-button-overlay-right'
            data-overlay-elevated={shellChromeOverlayState.rightControlsElevated ? 'true' : 'false'}
            data-react-aria-top-layer={shellChromeOverlayState.rightControlsTopLayer ? 'true' : undefined}
            aria-label={rightSidebarToggleAriaLabel}
            tooltip={rightSidebarToggleTooltip}
            preventFocusOnPress
            onClick={toggleAssistantSurface}
          >
            <span className='panel-toggle-icon' aria-hidden='true'>
              <LayoutRightLine size={16} />
            </span>
          </AppTooltipButton>
        )
      })() : null}

      {!isLeftSidebarDrawer ? (
        <aside
          id='workspace-sidebar-panel'
          className={`panel panel-sidebar${isLeftSidebarVisible ? '' : ' is-collapsed'}`}
          aria-hidden={isLeftSidebarVisible ? undefined : true}
          inert={isLeftSidebarVisible ? undefined : true}
        >
          {renderWorkspaceSidebar('docked')}
        </aside>
      ) : null}


      <div className={`panel-resize-slot panel-resize-slot-left${isLeftSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          tabIndex={0}
          className={`panel-resize-handle${activeResizePanel === 'left' ? ' is-active' : ''}`}
          aria-label='Resize workspace sidebar'
          aria-controls='workspace-sidebar-panel'
          aria-orientation='vertical'
          aria-valuemin={LEFT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={Math.round(clampLeftWidth(LEFT_SIDEBAR_MAX_WIDTH, shellWidth, rightSidebarWidthReservedForLeftClamp))}
          aria-valuenow={Math.round(renderedLeftSidebarWidth)}
          onKeyDown={(event) => handleResizeKeyDown('left', event)}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }

            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            handleResizeStart('left')
          }}
        />
      </div>

      <main className='panel panel-editor' id='editor-main'>
        {needsProjectBootstrap ? renderProjectBootstrap() : isAgentLayout ? renderAgentPanel() : renderEditorSurface()}
      </main>

      <div className={`panel-resize-slot panel-resize-slot-right${isRightSidebarVisible ? '' : ' is-hidden'}`}>
        <div
          role='separator'
          tabIndex={0}
          className={`panel-resize-handle${activeResizePanel === 'right' ? ' is-active' : ''}`}
          aria-label={isAgentLayout ? 'Resize Agent chat panel' : 'Resize assistant sidebar'}
          aria-controls={isAgentLayout ? 'editor-main' : 'assistant-sidebar-panel'}
          aria-orientation='vertical'
          aria-valuemin={isAgentLayout ? AGENT_CHAT_MIN_WIDTH : EDITOR_RIGHT_SIDEBAR_MIN_WIDTH}
          aria-valuemax={Math.round(isAgentLayout
            ? clampAgentChatWidth(Number.POSITIVE_INFINITY, shellWidth, effectiveLeftSidebarWidth)
            : clampEditorRightWidth(EDITOR_RIGHT_SIDEBAR_MAX_WIDTH, shellWidth, effectiveLeftSidebarWidth))}
          aria-valuenow={Math.round(isAgentLayout ? effectiveAgentChatWidth : renderedEditorRightSidebarWidth)}
          onKeyDown={(event) => handleResizeKeyDown('right', event)}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return
            }

            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            handleResizeStart('right')
          }}
        />
      </div>

      {!isRightSidebarDrawer && shouldExposeAgentWorkspaceTools ? (
        <aside
          id='assistant-sidebar-panel'
          className={`panel panel-agent${isRightSidebarVisible ? '' : ' is-collapsed'}`}
          aria-hidden={isRightSidebarVisible ? undefined : true}
          inert={isRightSidebarVisible ? undefined : true}
        >
          {needsProjectBootstrap ? null : isAgentLayout ? renderEditorSurface() : renderAgentPanel()}
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
                    {isAgentLayout ? renderEditorSurface() : renderAgentPanel()}
                    <div ref={setRightDrawerOverlayRoot} className='drawer-local-overlay-root'>
                      {renderProjectMenu('right-drawer', rightDrawerOverlayRoot?.getBoundingClientRect() ?? null)}
                    </div>
                  </div>
                </Drawer.Body>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      ) : null}

      {drawerDragRegion ? (
        <div
          aria-hidden='true'
          className='drawer-window-drag-region'
          data-react-aria-top-layer='true'
          style={{
            height: `${drawerDragRegion.height}px`,
            left: `${drawerDragRegion.left}px`,
            top: `${drawerDragRegion.top}px`,
            width: `${drawerDragRegion.width}px`,
          }}
        />
      ) : null}

      <Toast.Provider placement='bottom end' />

      {renderProjectMenu('global')}
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
            <AppTooltip tooltip='关闭' triggerMode='context'>
              <Modal.CloseTrigger
                className='settings-modal-close'
                aria-label='Close settings'
              >
                <Icon icon='lucide:x' width={16} height={16} />
              </Modal.CloseTrigger>
            </AppTooltip>
            <Modal.Body className='p-0 m-0'>
              <SettingsDialog
                activeSection={settingsSection}
                agentState={agentWorkspaceState}
                iconThemes={iconThemes}
                iconThemeOptions={iconThemeOptions}
                isIconThemeBusy={isApplyingIconTheme}
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
      <AppTitlebar onRequestClose={() => {
        void handleRequestWindowClose()
      }}
        isDrawerOpen={isLeftDrawerOpen || isRightDrawerOpen}
        isLeftDrawerOpen={isLeftDrawerOpen}
        leftControls={leftChromeControls}
      />
    </div>
  )

  const agentSurfaceMode = !isAgentLayout && isRightSidebarDrawer ? 'drawer' : 'docked'
  const agentProjectMenuSurface: ProjectMenuSurface = agentSurfaceMode === 'drawer' ? 'right-drawer' : 'global'

  return (
    <AgentProvider
      activeWorkspaceContext={activeWorkspaceContext}
      conversationState={conversationState}
      externalSessionRequest={pendingAgentProjectSessionRequest}
      onExternalSessionRequestHandled={(requestId) => {
        setPendingAgentProjectSessionRequest((currentValue) => (
          currentValue?.requestId === requestId ? null : currentValue
        ))
      }}
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
          setIsRightDrawerOpen(false)
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

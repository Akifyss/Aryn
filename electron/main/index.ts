import { Menu, app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import throttle from 'lodash.throttle'
import {
  applyGitDiffSelection,
  commitAndSyncGitChanges,
  commitGitChanges,
  discardAllGitChanges,
  discardGitChange,
  getGitBaseline,
  getGitCommitDetails,
  getGitCommitFileDiff,
  getGitCommitHistory,
  getGitLineBlame,
  getGitFileDiff,
  getGitRepositoryState,
  initializeGitRepository,
  pullGitChanges,
  pushGitChanges,
  revertGitCommit,
  stageGitPaths,
  unstageGitPaths,
} from './git'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceFile,
  getWorkspaceFileDataUrl,
  getWorkspaceFileUrl,
  loadWorkspaceDirectory,
  loadWorkspaceFile,
  loadWorkspaceTree,
  moveWorkspaceEntry,
  resolveWorkspaceEditorKind,
  saveWorkspaceFile,
  saveWorkspaceImage,
  unwatchWorkspace,
  watchWorkspace,
  workspaceFileExists,
  workspacePathExists,
} from './workspace'
import { AgentManager } from './agent-manager'
import { discoverAgentCatalog } from './agent-cli-discovery'
import {
  AppStateStore,
  getWorkspaceEntry,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  normalizeAppSettings,
  normalizeLayoutState,
  normalizeMigrationState,
} from './app-state'
import { cleanupStaleJsonTempFiles } from './json-file-store'
import type { PersistedProjectRecord, PersistedWorkspaceIconThemeSelection } from './app-state'
import { ConversationStore, type ConversationDraftCleanupResult } from './conversations'
import {
  normalizeMeoFileState,
  normalizeWorkspaceTabState,
  WorkspaceStateStore,
} from './workspace-state-store'
import type { ActiveWorkspaceContext, CreateConversationWorkspaceRequest, UpdateConversationRequest } from '../../src/features/conversations/types'
import type { AgentClientEvent, AgentInteractionResponse, AgentPromptAttachment, AgentPromptSendOptions, AgentProviderAuthUiEvent, AgentQueuedMessageUpdate, AgentRequestScope, AgentRunningPromptBehavior, AgentSessionCreateOptions, OpenCodeSurfaceRequest } from '../../src/features/agent/types'
import type { GitChangeItem, GitChangeScope, GitDiffBlockAction, GitDiffSelection } from '../../src/features/git/types'
import type { LocalStorageStateMigration } from '../../src/features/persistence/types'
import type {
  ProjectRecord,
  ProjectState,
  WorkspaceIconThemeCatalogOption,
  WorkspaceIconThemeMode,
} from '../../src/features/workspace/types'
import {
  importWorkspaceIconThemeFromVsix,
  loadWorkspaceIconThemeCatalogFromVsix,
} from './workspace-icon-theme'
import { getDefaultAppIconAssetPath } from './app-icon'
import { createArynPaths, prepareArynDataDirectories } from './aryn-paths'
import {
  defaultBundledWorkspaceIconThemeIds,
  isBundledWorkspaceIconThemePath,
  resolveBundledWorkspaceIconThemePath,
  resolveBundledWorkspaceIconThemePaths,
} from './bundled-workspace-icon-theme'
import { ensureUsableFolderName } from './path-names'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬ dist-electron
// │ ├─┬ main
// │ │ └── index.js    > Electron-Main
// │ └─┬ preload
// │   └── index.mjs   > Preload-Scripts
// ├─┬ dist
// │ └── index.html    > Electron-Renderer
//
process.env.APP_ROOT = app.getAppPath()

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

// Disable GPU Acceleration for Windows 7
if (os.release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (process.env.ARYN_ELECTRON_DEBUG !== '1' && !app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let allowWindowClose = false
function getOptionalAppPath(name: Parameters<typeof app.getPath>[0]) {
  try {
    return app.getPath(name)
  } catch {
    return null
  }
}

const preload = path.join(MAIN_DIST, 'preload', 'index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')
const homeDir = os.homedir() || getOptionalAppPath('home') || process.cwd()
const documentsDir = getOptionalAppPath('documents') ?? path.join(homeDir, 'Documents')
const tempDir = getOptionalAppPath('temp') ?? os.tmpdir()
const legacyUserDataDir = getOptionalAppPath('userData')
const arynPaths = createArynPaths({
  appName: app.getName(),
  documentsDir,
  homeDir,
  legacyUserDataDir,
  publicDir: process.env.VITE_PUBLIC,
  tempDir,
})
const arynDataDir = arynPaths.arynDataDir
const agentDir = arynPaths.piAgentDir
const workspaceIconThemeCacheDir = arynPaths.workspaceIconThemeCacheDir
const bundledWorkspaceIconThemeDirectoryPath = arynPaths.bundledWorkspaceIconThemeDirectoryPath
const workspaceIconThemeModes = ['light', 'dark'] as const satisfies readonly WorkspaceIconThemeMode[]
const appStateStore = new AppStateStore(arynPaths.appStatePath, arynPaths.legacyAppStatePaths)
const workspaceStateStore = new WorkspaceStateStore(arynPaths.workspaceStatePath)
const conversationStore = new ConversationStore(arynPaths.conversationIndexPath, arynPaths.documentsDir)
const RENDERER_LOCAL_STORAGE_MIGRATION_VERSION = 1

type WindowBackgroundTheme = 'light' | 'dark'
type WindowAppearanceTheme = WindowBackgroundTheme | 'system'
type WindowThemeState = { resolvedTheme: WindowBackgroundTheme }
const MAX_PICKED_IMAGE_ATTACHMENT_BYTES = 12 * 1024 * 1024

function getAgentAttachmentMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()

  switch (extension) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    default:
      return undefined
  }
}

const WINDOW_BACKGROUND_COLORS = {
  dark: '#1f1f1f',
  light: '#f5f6f8',
} as const satisfies Record<WindowBackgroundTheme, string>

let windowAppearanceTheme: WindowAppearanceTheme = 'system'

function getPathBaseName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value
}

prepareArynDataDirectories(arynPaths)

function normalizeProjectPath(projectPath: string) {
  return path.resolve(projectPath)
}

function getProjectPathIdentity(projectPath: string) {
  const normalizedPath = normalizeProjectPath(projectPath)
  return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath
}

function createProjectRecord(projectPath: string, patch: Partial<PersistedProjectRecord> = {}): PersistedProjectRecord {
  const normalizedPath = normalizeProjectPath(projectPath)
  const timestamp = new Date().toISOString()

  return {
    id: normalizedPath,
    name: getPathBaseName(normalizedPath),
    path: normalizedPath,
    addedAt: timestamp,
    lastOpenedAt: timestamp,
    lastFilePath: null,
    ...patch,
  }
}

async function filterExistingProjects(projects: PersistedProjectRecord[]) {
  const settledProjects = await Promise.all(projects.map(async (project) => {
    const exists = await workspacePathExists(project.path)
    return exists ? project : null
  }))

  return settledProjects.filter((project): project is PersistedProjectRecord => Boolean(project))
}

function toProjectState(projects: PersistedProjectRecord[], lastProjectId: string | null): ProjectState {
  return {
    lastProjectId,
    projects: projects.map((project): ProjectRecord => ({
      id: project.id,
      name: project.name,
      path: project.path,
      addedAt: project.addedAt,
      lastOpenedAt: project.lastOpenedAt,
      lastFilePath: project.lastFilePath,
    })),
  }
}

async function getVisibleProjectState(): Promise<ProjectState> {
  const state = await appStateStore.read()
  const visibleProjects = await filterExistingProjects(state.workspace.projects)
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id))
  const fallbackLastProjectId = state.workspace.lastProjectId
    && visibleProjects.some((project) => project.id === state.workspace.lastProjectId)
    ? state.workspace.lastProjectId
    : visibleProjects[0]?.id ?? null
  const activeContext = state.workspace.activeContext
  const visibleActiveContext = activeContext.kind === 'project'
    ? visibleProjectIds.has(activeContext.projectId)
      ? activeContext
      : fallbackLastProjectId
        ? { kind: 'project' as const, projectId: fallbackLastProjectId }
        : { kind: 'conversationDraft' as const }
    : activeContext
  const lastProjectId = visibleActiveContext.kind === 'project'
    ? visibleActiveContext.projectId
    : fallbackLastProjectId
  const lastWorkspacePath = visibleActiveContext.kind === 'project'
    ? visibleProjects.find((project) => project.id === lastProjectId)?.path ?? null
    : state.workspace.lastWorkspacePath

  if (
    lastProjectId !== state.workspace.lastProjectId
    || visibleActiveContext.kind !== state.workspace.activeContext.kind
    || (
      visibleActiveContext.kind === 'project'
      && state.workspace.activeContext.kind === 'project'
      && visibleActiveContext.projectId !== state.workspace.activeContext.projectId
    )
    || lastWorkspacePath !== state.workspace.lastWorkspacePath
  ) {
    await appStateStore.update((currentState) => ({
      ...currentState,
      workspace: {
        ...currentState.workspace,
        activeContext: visibleActiveContext,
        lastProjectId,
        lastWorkspacePath,
      },
    }))
  }

  return toProjectState(visibleProjects, lastProjectId)
}

function sanitizeProjectFolderName(name: string) {
  const sanitized = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+$/, '')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .slice(0, 100)
    .trim()

  return ensureUsableFolderName(sanitized, 'Untitled Project')
}

function isAlreadyExistsError(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EEXIST'
}

async function createUniqueProjectPath(parentPath: string, folderName: string) {
  const basePath = path.join(parentPath, folderName)

  for (let index = 0; index < 1000; index += 1) {
    const candidatePath = index === 0 ? basePath : `${basePath} ${index + 1}`

    try {
      await mkdir(candidatePath)
      return candidatePath
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error
      }
    }
  }

  throw new Error('Unable to find an available project folder name.')
}

async function upsertProject(projectPath: string, options: { name?: string, makeActive?: boolean } = {}) {
  const normalizedPath = normalizeProjectPath(projectPath)
  const pathIdentity = getProjectPathIdentity(normalizedPath)
  const now = new Date().toISOString()
  let nextProject: PersistedProjectRecord | null = null

  await appStateStore.update((currentState) => {
    const existingProject = currentState.workspace.projects.find((project) => getProjectPathIdentity(project.path) === pathIdentity)
    const projects = existingProject
      ? currentState.workspace.projects.map((project) => {
          if (getProjectPathIdentity(project.path) !== pathIdentity) {
            return project
          }

          nextProject = {
            ...project,
            ...(options.name ? { name: options.name } : {}),
            ...(options.makeActive ? { lastOpenedAt: now } : {}),
          }
          return nextProject
        })
      : [
          ...currentState.workspace.projects,
          createProjectRecord(normalizedPath, {
            ...(options.name ? { name: options.name } : {}),
            ...(options.makeActive ? { lastOpenedAt: now } : {}),
          }),
        ]

    if (!existingProject) {
      nextProject = projects[projects.length - 1]
    }
    const persistedWorkspacePath = nextProject?.path ?? normalizedPath

    return {
      ...currentState,
      workspace: {
        ...currentState.workspace,
        lastProjectId: options.makeActive ? nextProject?.id ?? currentState.workspace.lastProjectId : currentState.workspace.lastProjectId,
        activeContext: options.makeActive && nextProject?.id
          ? { kind: 'project', projectId: nextProject.id }
          : currentState.workspace.activeContext,
        entries: {
          ...currentState.workspace.entries,
          [persistedWorkspacePath]: currentState.workspace.entries[persistedWorkspacePath] ?? {
            lastAgentSessionPath: null,
            lastFilePath: null,
            prefersNewAgentSession: false,
          },
        },
        lastWorkspacePath: options.makeActive ? persistedWorkspacePath : currentState.workspace.lastWorkspacePath,
        projects,
      },
    }
  })

  return getVisibleProjectState()
}

function getInitialWindowBackgroundColor() {
  return WINDOW_BACKGROUND_COLORS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']
}

function normalizeWindowBackgroundTheme(theme: unknown): WindowBackgroundTheme | null {
  return theme === 'dark' || theme === 'light' ? theme : null
}

function normalizeWindowAppearanceTheme(theme: unknown): WindowAppearanceTheme | null {
  return theme === 'dark' || theme === 'light' || theme === 'system' ? theme : null
}

function resolveWindowBackgroundTheme(appearanceTheme: WindowAppearanceTheme): WindowBackgroundTheme {
  if (appearanceTheme === 'dark' || appearanceTheme === 'light') {
    return appearanceTheme
  }

  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function applyWindowBackgroundTheme(theme: WindowBackgroundTheme) {
  if (!win || win.isDestroyed()) {
    return
  }

  win.setBackgroundColor(WINDOW_BACKGROUND_COLORS[theme])
}

function emitWindowThemeState(state: WindowThemeState) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return
  }

  win.webContents.send('window:theme-changed', state)
}

const agentManager = new AgentManager(
  (event: AgentClientEvent) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.send('agent:event', event)
  },
  { agentDir },
)
let legacyBuiltinAgentScope: AgentRequestScope | null = null

function normalizeAgentIpcScope(scopeOrWorkspacePath: AgentRequestScope | string): AgentRequestScope {
  if (typeof scopeOrWorkspacePath !== 'string') return scopeOrWorkspacePath
  return {
    agentId: 'builtin-pi',
    sessionPath: null,
    workspacePath: scopeOrWorkspacePath,
  }
}

function rememberLegacyBuiltinScope(scope: AgentRequestScope, state: Awaited<ReturnType<AgentManager['loadWorkspaceState']>>) {
  if (scope.agentId !== 'builtin-pi' || !scope.workspacePath) return
  legacyBuiltinAgentScope = {
    agentId: 'builtin-pi',
    sessionPath: state.activeSession?.sessionPath ?? null,
    workspacePath: scope.workspacePath,
  }
}

function requireLegacyBuiltinScope() {
  if (!legacyBuiltinAgentScope?.workspacePath || !legacyBuiltinAgentScope.sessionPath) {
    throw new Error('No embedded PI session is active for this legacy Agent request.')
  }
  return legacyBuiltinAgentScope
}

type PendingProviderAuthPrompt = {
  flowId: string
  provider: string
  reject: (error: Error) => void
  resolve: (value: string) => void
}
type ActiveProviderAuthFlow = {
  controller: AbortController
  flowId: string
}

const activeProviderAuthFlows = new Map<string, ActiveProviderAuthFlow>()
const pendingProviderAuthPrompts = new Map<string, PendingProviderAuthPrompt>()

function emitProviderAuthUiEvent(event: AgentProviderAuthUiEvent) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    return
  }

  win.webContents.send('agent:provider-auth-ui-event', event)
}

function requestProviderAuthInput(
  provider: string,
  flowId: string,
  prompt: { allowEmpty?: boolean, message: string, placeholder?: string },
) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    throw new Error('No renderer window is available for provider login.')
  }

  const requestId = randomUUID()
  emitProviderAuthUiEvent({
    type: 'prompt',
    allowEmpty: prompt.allowEmpty,
    message: prompt.message,
    placeholder: prompt.placeholder,
    provider,
    requestId,
  })

  return new Promise<string>((resolve, reject) => {
    pendingProviderAuthPrompts.set(requestId, {
      flowId,
      provider,
      reject,
      resolve,
    })
  })
}

function rejectProviderAuthPrompts(provider: string, flowId?: string, message = 'Login cancelled.') {
  for (const [requestId, pendingPrompt] of pendingProviderAuthPrompts.entries()) {
    if (pendingPrompt.provider !== provider || (flowId && pendingPrompt.flowId !== flowId)) {
      continue
    }

    pendingProviderAuthPrompts.delete(requestId)
    pendingPrompt.reject(new Error(message))
  }
}

function cancelProviderAuthFlow(provider: string, message = 'Login cancelled.') {
  const activeFlow = activeProviderAuthFlows.get(provider)

  if (!activeFlow) {
    rejectProviderAuthPrompts(provider, undefined, message)
    return false
  }

  activeProviderAuthFlows.delete(provider)
  rejectProviderAuthPrompts(provider, activeFlow.flowId, message)

  if (!activeFlow.controller.signal.aborted) {
    activeFlow.controller.abort(new Error(message))
  }

  return true
}

function cancelAllProviderAuthFlows(message = 'Login cancelled.') {
  for (const provider of Array.from(activeProviderAuthFlows.keys())) {
    cancelProviderAuthFlow(provider, message)
  }
}

nativeTheme.on('updated', () => {
  if (process.platform !== 'darwin' || windowAppearanceTheme !== 'system') {
    return
  }

  const resolvedTheme = resolveWindowBackgroundTheme(windowAppearanceTheme)
  applyWindowBackgroundTheme(resolvedTheme)
  emitWindowThemeState({ resolvedTheme })
})

function getWindowChromeState(targetWindow: BrowserWindow | null = win) {
  return {
    isFullScreen: targetWindow?.isFullScreen() ?? false,
    isMaximized: targetWindow?.isMaximized() ?? false,
  }
}

function toErrorDialogText(error: unknown) {
  if (error instanceof Error) {
    return error.stack || `${error.name}: ${error.message}`
  }

  return String(error)
}

function reportMainProcessError(title: string, error: unknown) {
  console.error(title, error)
  dialog.showErrorBox(title, toErrorDialogText(error))
}

function emitWindowChromeState(targetWindow: BrowserWindow) {
  if (targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
    return
  }

  targetWindow.webContents.send('window:state-changed', getWindowChromeState(targetWindow))
}

async function persistWindowState(targetWindow: BrowserWindow) {
  if (targetWindow.isDestroyed()) {
    return
  }

  const isMaximized = targetWindow.isMaximized()
  const bounds = isMaximized
    ? targetWindow.getNormalBounds()
    : targetWindow.getBounds()

  await appStateStore.update((currentState) => ({
    ...currentState,
    window: {
      width: Math.max(MIN_WINDOW_WIDTH, bounds.width),
      height: Math.max(MIN_WINDOW_HEIGHT, bounds.height),
      isMaximized,
    },
  }))
}

function persistWindowStateInBackground(targetWindow: BrowserWindow) {
  void persistWindowState(targetWindow).catch((error) => {
    console.warn('Failed to persist window state.', error)
  })
}

function bindWindowStatePersistence(targetWindow: BrowserWindow) {
  const persistBounds = throttle(() => {
    persistWindowStateInBackground(targetWindow)
  }, 240)

  targetWindow.on('resize', persistBounds)
  targetWindow.on('maximize', () => {
    persistBounds.cancel()
    persistWindowStateInBackground(targetWindow)
    emitWindowChromeState(targetWindow)
  })
  targetWindow.on('unmaximize', () => {
    persistBounds.cancel()
    persistWindowStateInBackground(targetWindow)
    emitWindowChromeState(targetWindow)
  })
  targetWindow.on('enter-full-screen', () => {
    emitWindowChromeState(targetWindow)
  })
  targetWindow.on('leave-full-screen', () => {
    emitWindowChromeState(targetWindow)
  })
  targetWindow.on('close', () => {
    persistBounds.cancel()
    persistWindowStateInBackground(targetWindow)
  })
  targetWindow.on('closed', () => {
    persistBounds.cancel()
  })
}

async function createWindow() {
  const appState = await appStateStore.read()
  const appIconPath = getDefaultAppIconAssetPath(process.env.VITE_PUBLIC)
  const titlebarOptions = process.platform === 'darwin'
    ? {
        titleBarStyle: 'hidden' as const,
        trafficLightPosition: { x: 16, y: 14 },
      }
    : {
        frame: false,
      }

  win = new BrowserWindow({
    title: 'Aryn',
    icon: appIconPath,
    backgroundColor: getInitialWindowBackgroundColor(),
    autoHideMenuBar: true,
    show: false,
    width: appState.window.width,
    height: appState.window.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    ...titlebarOptions,
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
  })

  bindWindowStatePersistence(win)

  const targetWindow = win
  let hasShownInitialWindow = false
  let initialWindowFallbackTimer: ReturnType<typeof setTimeout> | null = null
  const showInitialWindow = () => {
    if (hasShownInitialWindow || targetWindow.isDestroyed()) {
      return
    }

    if (initialWindowFallbackTimer) {
      clearTimeout(initialWindowFallbackTimer)
      initialWindowFallbackTimer = null
    }

    hasShownInitialWindow = true
    targetWindow.show()
  }
  const handleRendererReady = (event: Electron.IpcMainEvent) => {
    if (event.sender === targetWindow.webContents) {
      showInitialWindow()
    }
  }

  ipcMain.on('app:renderer-ready', handleRendererReady)
  targetWindow.webContents.once('did-fail-load', showInitialWindow)
  targetWindow.once('closed', () => {
    ipcMain.off('app:renderer-ready', handleRendererReady)
    if (initialWindowFallbackTimer) {
      clearTimeout(initialWindowFallbackTimer)
      initialWindowFallbackTimer = null
    }
  })
  initialWindowFallbackTimer = setTimeout(showInitialWindow, VITE_DEV_SERVER_URL ? 15000 : 8000)

  win.on('close', (event) => {
    if (allowWindowClose) {
      allowWindowClose = false
      return
    }

    if (win?.webContents.isDestroyed()) {
      allowWindowClose = true
      return
    }

    event.preventDefault()
    win?.webContents.send('window:close-requested')
  })

  if (appState.window.isMaximized) {
    win.maximize()
  }

  const sendRendererWindowEvent = (channel: 'window:devtools-opened' | 'window:devtools-closed') => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.send(channel)
  }

  win.webContents.on('devtools-opened', () => {
    sendRendererWindowEvent('window:devtools-opened')
  })

  win.webContents.on('devtools-closed', () => {
    sendRendererWindowEvent('window:devtools-closed')
  })

  if (VITE_DEV_SERVER_URL) { // #298
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'right' })
  } else {
    win.loadFile(indexHtml)
  }

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (VITE_DEV_SERVER_URL) {
    win.webContents.on('context-menu', (_event, params) => {
      win?.webContents.inspectElement(params.x, params.y)
    })
  }

  applyDefaultAppIcon()
}

function applyDefaultAppIcon() {
  const iconPath = getDefaultAppIconAssetPath(process.env.VITE_PUBLIC)
  const icon = nativeImage.createFromPath(iconPath)

  if (!icon.isEmpty()) {
    if (process.platform === 'darwin' && app.dock) {
      app.dock.setIcon(icon)
    }

    if (win && !win.isDestroyed()) {
      win.setIcon(icon)
    }
  }

  return iconPath
}

function isBundledWorkspaceIconTheme(vsixPath: string) {
  return isBundledWorkspaceIconThemePath(vsixPath, bundledWorkspaceIconThemeDirectoryPath)
}

async function importWorkspaceIconTheme(vsixPath: string, preferredThemeId?: string | null) {
  return importWorkspaceIconThemeFromVsix(
    vsixPath,
    workspaceIconThemeCacheDir,
    preferredThemeId,
    isBundledWorkspaceIconTheme(vsixPath) ? 'bundled' : 'external',
  )
}

async function loadWorkspaceIconThemeCatalog(vsixPath: string) {
  return loadWorkspaceIconThemeCatalogFromVsix(
    vsixPath,
    workspaceIconThemeCacheDir,
    isBundledWorkspaceIconTheme(vsixPath) ? 'bundled' : 'external',
  )
}

async function loadBundledWorkspaceIconThemeCatalogs() {
  const bundledWorkspaceIconThemePaths = await resolveBundledWorkspaceIconThemePaths(
    bundledWorkspaceIconThemeDirectoryPath,
  )

  const catalogs = await Promise.allSettled(
    bundledWorkspaceIconThemePaths.map((themePath) => loadWorkspaceIconThemeCatalog(themePath)),
  )

  return catalogs
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof loadWorkspaceIconThemeCatalog>>> => (
      result.status === 'fulfilled'
    ))
    .map((result) => result.value)
}

async function resolveBundledWorkspaceIconThemeSelection(
  preferredThemeId?: string | null,
  mode: WorkspaceIconThemeMode = 'light',
): Promise<{
  activeThemeId: string | null
  sourceVsixPath: string
}> {
  const bundledThemeCatalogs = await loadBundledWorkspaceIconThemeCatalogs()

  if (preferredThemeId) {
    const preferredThemeCatalog = bundledThemeCatalogs.find((theme) => (
      theme.themes.some((themeOption) => themeOption.id === preferredThemeId)
    ))

    if (preferredThemeCatalog) {
      return {
        activeThemeId: preferredThemeId,
        sourceVsixPath: preferredThemeCatalog.sourceVsixPath,
      }
    }
  }

  const defaultBundledWorkspaceIconThemeId = defaultBundledWorkspaceIconThemeIds[mode]
  const defaultThemeCatalog = bundledThemeCatalogs.find((theme) => (
    theme.themes.some((themeOption) => themeOption.id === defaultBundledWorkspaceIconThemeId)
  ))

  if (defaultThemeCatalog) {
    return {
      activeThemeId: defaultBundledWorkspaceIconThemeId,
      sourceVsixPath: defaultThemeCatalog.sourceVsixPath,
    }
  }

  const firstCatalog = bundledThemeCatalogs[0]
  const firstThemeId = firstCatalog?.themes[0]?.id ?? null

  if (firstCatalog) {
    return {
      activeThemeId: firstThemeId,
      sourceVsixPath: firstCatalog.sourceVsixPath,
    }
  }

  return {
    activeThemeId: null,
    sourceVsixPath: await resolveBundledWorkspaceIconThemePath(bundledWorkspaceIconThemeDirectoryPath),
  }
}

async function loadBundledWorkspaceIconTheme(
  preferredThemeId?: string | null,
  mode: WorkspaceIconThemeMode = 'light',
) {
  const selection = await resolveBundledWorkspaceIconThemeSelection(preferredThemeId, mode)

  return importWorkspaceIconTheme(selection.sourceVsixPath, selection.activeThemeId)
}

function toPersistedWorkspaceIconThemeSelection(
  theme: Awaited<ReturnType<typeof importWorkspaceIconTheme>>,
): PersistedWorkspaceIconThemeSelection {
  if (theme.sourceKind === 'bundled') {
    return {
      activeThemeId: theme.activeThemeId,
      sourceKind: 'bundled',
      sourceVsixPath: null,
    }
  }

  return {
    activeThemeId: theme.activeThemeId,
    sourceKind: 'external',
    sourceVsixPath: theme.sourceVsixPath,
  }
}

async function updatePersistedWorkspaceIconTheme(
  mode: WorkspaceIconThemeMode,
  theme: Awaited<ReturnType<typeof importWorkspaceIconTheme>>,
) {
  await appStateStore.update((currentState) => ({
    ...currentState,
    ui: {
      ...currentState.ui,
      workspaceIconThemes: {
        ...currentState.ui.workspaceIconThemes,
        [mode]: toPersistedWorkspaceIconThemeSelection(theme),
      },
    },
  }))
}

function toCatalogOptions(theme: Awaited<ReturnType<typeof loadWorkspaceIconThemeCatalog>>): WorkspaceIconThemeCatalogOption[] {
  return theme.themes.map((themeOption) => ({
    key: `${theme.sourceVsixPath}::${themeOption.id}`,
    label: themeOption.label,
    sourceKind: theme.sourceKind,
    sourceVsixPath: theme.sourceVsixPath,
    themeId: themeOption.id,
  }))
}

async function getEffectiveWorkspaceIconThemeSelection(
  mode: WorkspaceIconThemeMode = 'light',
): Promise<{
  activeThemeId: string | null
  sourceVsixPath: string | null
}> {
  const state = await appStateStore.read()
  const persistedSelection = state.ui.workspaceIconThemes[mode]
  const persistedVsixPath = persistedSelection.sourceVsixPath

  if (!persistedSelection.activeThemeId && !persistedVsixPath) {
    return {
      activeThemeId: null,
      sourceVsixPath: null,
    }
  }

  if (persistedSelection.sourceKind === 'bundled' || !persistedVsixPath) {
    const selection = await resolveBundledWorkspaceIconThemeSelection(persistedSelection.activeThemeId, mode)

    if (selection.activeThemeId !== persistedSelection.activeThemeId) {
      await appStateStore.update((currentState) => ({
        ...currentState,
        ui: {
          ...currentState.ui,
          workspaceIconThemes: {
            ...currentState.ui.workspaceIconThemes,
            [mode]: {
              activeThemeId: selection.activeThemeId,
              sourceKind: 'bundled',
              sourceVsixPath: null,
            },
          },
        },
      }))
    }

    return selection
  }

  if (persistedSelection.sourceKind === null && isBundledWorkspaceIconTheme(persistedVsixPath)) {
    const selection = await resolveBundledWorkspaceIconThemeSelection(persistedSelection.activeThemeId, mode)

    await appStateStore.update((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        workspaceIconThemes: {
          ...currentState.ui.workspaceIconThemes,
          [mode]: {
            activeThemeId: selection.activeThemeId,
            sourceKind: 'bundled',
            sourceVsixPath: null,
          },
        },
      },
    }))

    return selection
  }

  if (persistedVsixPath) {
    return {
      activeThemeId: persistedSelection.activeThemeId,
      sourceVsixPath: persistedVsixPath,
    }
  }

  return resolveBundledWorkspaceIconThemeSelection(persistedSelection.activeThemeId, mode)
}

async function getWorkspaceIconThemeCatalog() {
  const selections = await Promise.all(workspaceIconThemeModes.map((mode) => getEffectiveWorkspaceIconThemeSelection(mode)))
  const bundledThemes = await loadBundledWorkspaceIconThemeCatalogs()
  const catalogOptions = bundledThemes.flatMap(toCatalogOptions)
  const importedVsixPaths = new Set(
    selections
      .map((selection) => selection.sourceVsixPath)
      .filter((sourceVsixPath): sourceVsixPath is string => (
        typeof sourceVsixPath === 'string' && !isBundledWorkspaceIconTheme(sourceVsixPath)
      )),
  )

  for (const sourceVsixPath of importedVsixPaths) {
    try {
      const importedTheme = await loadWorkspaceIconThemeCatalog(sourceVsixPath)
      catalogOptions.push(...toCatalogOptions(importedTheme))
    } catch {
      // Ignore broken imported themes so built-in themes remain selectable.
    }
  }

  return catalogOptions
}

function readLocalStorageMigration(value: unknown): LocalStorageStateMigration {
  return value && typeof value === 'object'
    ? value as LocalStorageStateMigration
    : {}
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
}

function readWorkspaceIconThemeMode(value: unknown): WorkspaceIconThemeMode {
  return value === 'dark' ? 'dark' : 'light'
}

function readRequiredPathArgument(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }

  return value
}

function readPathPatch(value: unknown) {
  if (value === null) {
    return {
      shouldApply: true,
      value: null,
    }
  }

  if (typeof value === 'string') {
    return {
      shouldApply: true,
      value: value.trim() ? value : null,
    }
  }

  return {
    shouldApply: false,
    value: null,
  }
}

async function applyLocalStorageStateMigration(migration: LocalStorageStateMigration) {
  const currentAppState = await appStateStore.read()
  const shouldApplyMigration = currentAppState.migrations.rendererLocalStorage < RENDERER_LOCAL_STORAGE_MIGRATION_VERSION

  if (!shouldApplyMigration) {
    return
  }

  if (migration.settings !== undefined || migration.layout !== undefined) {
    await appStateStore.update((currentState) => ({
      ...currentState,
      ...(migration.layout !== undefined
        ? {
            layout: normalizeLayoutState({
              ...currentState.layout,
              ...readRecord(migration.layout),
            }),
          }
        : null),
      ...(migration.settings !== undefined
        ? {
            settings: normalizeAppSettings({
              ...currentState.settings,
              ...readRecord(migration.settings),
              agent: {
                ...currentState.settings.agent,
                ...readRecord(readRecord(migration.settings).agent),
              },
              meo: {
                ...currentState.settings.meo,
                ...readRecord(readRecord(migration.settings).meo),
              },
            }),
          }
        : null),
    }))
  }

  if (migration.workspaceTabs || migration.meoFileStates) {
    await workspaceStateStore.update((currentState) => ({
      ...currentState,
      meoFileStates: {
        ...currentState.meoFileStates,
        ...Object.fromEntries(
          Object.entries(migration.meoFileStates ?? {})
            .filter(([filePath]) => filePath.trim().length > 0)
            .map(([filePath, state]) => [filePath, normalizeMeoFileState(state)]),
        ),
      },
      workspaceTabs: {
        ...currentState.workspaceTabs,
        ...Object.fromEntries(
          Object.entries(migration.workspaceTabs ?? {})
            .filter(([workspacePath]) => workspacePath.trim().length > 0)
            .map(([workspacePath, state]) => [workspacePath, normalizeWorkspaceTabState(state)]),
        ),
      },
    }))
  }

  await appStateStore.update((currentState) => ({
    ...currentState,
    migrations: normalizeMigrationState({
      ...currentState.migrations,
      rendererLocalStorage: RENDERER_LOCAL_STORAGE_MIGRATION_VERSION,
    }),
  }))
}

async function getPersistentClientStateSnapshot() {
  const [appState, workspaceState] = await Promise.all([
    appStateStore.read(),
    workspaceStateStore.read(),
  ])

  return {
    app: {
      layout: appState.layout,
      settings: appState.settings,
    },
    workspace: {
      meoFileStates: workspaceState.meoFileStates,
      workspaceTabs: workspaceState.workspaceTabs,
    },
  }
}

async function cleanupConversationStateReferences(result: ConversationDraftCleanupResult) {
  const validConversationIds = new Set(result.state.conversations.map((conversation) => conversation.id))
  const removedConversationIds = new Set(result.removedDrafts.map((conversation) => conversation.id))
  const removedWorkspacePathIds = new Set(
    result.removedDrafts
      .map((conversation) => conversation.workspacePath)
      .filter((workspacePath): workspacePath is string => Boolean(workspacePath))
      .map(getProjectPathIdentity),
  )

  await appStateStore.update((currentState) => {
    let didChange = false
    const entries = { ...currentState.workspace.entries }

    for (const workspacePath of Object.keys(entries)) {
      if (removedWorkspacePathIds.has(getProjectPathIdentity(workspacePath))) {
        delete entries[workspacePath]
        didChange = true
      }
    }

    let activeContext = currentState.workspace.activeContext
    if (
      activeContext.kind === 'conversation'
      && (
        removedConversationIds.has(activeContext.conversationId)
        || !validConversationIds.has(activeContext.conversationId)
      )
    ) {
      activeContext = { kind: 'conversationDraft' }
      didChange = true
    }

    let lastWorkspacePath = currentState.workspace.lastWorkspacePath
    if (
      lastWorkspacePath
      && removedWorkspacePathIds.has(getProjectPathIdentity(lastWorkspacePath))
    ) {
      lastWorkspacePath = null
      didChange = true
    }

    if (!didChange) {
      return currentState
    }

    return {
      ...currentState,
      workspace: {
        ...currentState.workspace,
        activeContext,
        entries,
        lastWorkspacePath,
      },
    }
  })
}

async function discardDraftWorkspaceSessions(workspacePath: string | null | undefined) {
  if (!workspacePath) {
    return
  }

  try {
    await agentManager.discardWorkspaceSessions(workspacePath)
  } catch (error) {
    console.warn('Failed to clean up draft conversation sessions.', error)
  }
}

async function cleanupArynDataDirectoryTempFiles() {
  try {
    const removedCount = await cleanupStaleJsonTempFiles(arynDataDir, { recursive: true })
    if (removedCount > 0) {
      console.info(`Cleaned up ${removedCount} stale Aryn JSON temp file${removedCount === 1 ? '' : 's'}.`)
    }
  } catch (error) {
    console.warn('Failed to clean up stale Aryn JSON temp files.', error)
  }
}

async function startApplication() {
  Menu.setApplicationMenu(null)
  applyDefaultAppIcon()
  await cleanupArynDataDirectoryTempFiles()

  try {
    const cleanupResult = await conversationStore.cleanupDrafts()
    await Promise.all(cleanupResult.removedDrafts.map((conversation) => (
      discardDraftWorkspaceSessions(conversation.workspacePath)
    )))
    await cleanupConversationStateReferences(cleanupResult)
  } catch (error) {
    console.warn('Failed to clean up draft conversations.', error)
  }

  await createWindow()
}

void app.whenReady()
  .then(startApplication)
  .catch((error) => {
    reportMainProcessError('Aryn Startup Error', error)
    app.exit(1)
  })

app.on('window-all-closed', () => {
  win = null
  cancelAllProviderAuthFlows()
  agentManager.dispose()
  void unwatchWorkspace().catch((error) => {
    console.warn('Failed to stop workspace watcher.', error)
  })
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    // Focus on the main window if the user tried to open another
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    void createWindow().catch((error) => {
      reportMainProcessError('Aryn Runtime Error', error)
    })
  }
})

ipcMain.handle('workspace:pick-directory', async () => {
  if (!win) {
    return null
  }

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Open Workspace',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return result.filePaths[0]
})

ipcMain.handle('project:get-state', async () => {
  return getVisibleProjectState()
})

ipcMain.handle('workspace:get-active-context', async () => {
  await getVisibleProjectState()
  const state = await appStateStore.read()
  return state.workspace.activeContext
})

ipcMain.handle('workspace:set-active-context', async (_event, context: ActiveWorkspaceContext) => {
  const contextRecord = readRecord(context)
  const kind = contextRecord.kind
  let nextContext: ActiveWorkspaceContext
  let nextLastProjectId: string | null | undefined
  let nextWorkspacePath: string | null | undefined

  if (kind === 'project') {
    const projectId = typeof contextRecord.projectId === 'string' ? contextRecord.projectId : ''
    const state = await appStateStore.read()
    const project = state.workspace.projects.find((candidate) => candidate.id === projectId)

    if (!project) {
      throw new Error('Project not found.')
    }

    nextContext = { kind: 'project', projectId: project.id }
    nextLastProjectId = project.id
    nextWorkspacePath = project.path
  } else if (kind === 'conversation') {
    const conversationId = typeof contextRecord.conversationId === 'string' ? contextRecord.conversationId : ''
    const conversationState = await conversationStore.read()
    const conversation = conversationState.conversations.find((candidate) => candidate.id === conversationId)

    if (!conversation) {
      throw new Error('Conversation not found.')
    }

    nextContext = { kind: 'conversation', conversationId: conversation.id }
    nextWorkspacePath = conversation.workspacePath
  } else {
    nextContext = { kind: 'conversationDraft' }
  }

  await appStateStore.update((currentState) => ({
    ...currentState,
    workspace: {
      ...currentState.workspace,
      activeContext: nextContext,
      lastProjectId: nextLastProjectId !== undefined
        ? nextLastProjectId
        : currentState.workspace.lastProjectId,
      entries: nextWorkspacePath
        ? {
            ...currentState.workspace.entries,
            [nextWorkspacePath]: currentState.workspace.entries[nextWorkspacePath] ?? {
              lastAgentSessionPath: null,
              lastFilePath: null,
              prefersNewAgentSession: false,
            },
          }
        : currentState.workspace.entries,
      lastWorkspacePath: nextWorkspacePath !== undefined
        ? nextWorkspacePath
        : currentState.workspace.lastWorkspacePath,
    },
  }))

  return nextContext
})

ipcMain.handle('project:create-empty', async (_event, name: string) => {
  const trimmedName = typeof name === 'string' ? name.trim() : ''

  if (!trimmedName) {
    throw new Error('Project name is required.')
  }

  const projectRootPath = arynPaths.documentsDir
  const folderName = sanitizeProjectFolderName(trimmedName)
  await mkdir(projectRootPath, { recursive: true })
  const projectPath = await createUniqueProjectPath(projectRootPath, folderName)

  return upsertProject(projectPath, {
    makeActive: true,
    name: getPathBaseName(projectPath),
  })
})

ipcMain.handle('project:add-existing', async () => {
  if (!win) {
    return null
  }

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Use Existing Folder',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  return upsertProject(result.filePaths[0], { makeActive: true })
})

ipcMain.handle('project:set-active', async (_event, projectId: string) => {
  const normalizedProjectId = typeof projectId === 'string' ? projectId : ''
  const now = new Date().toISOString()
  let nextActivePath: string | null = null
  let didFindProject = false

  await appStateStore.update((currentState) => {
    const targetProject = currentState.workspace.projects.find((project) => project.id === normalizedProjectId)

    if (!targetProject) {
      return currentState
    }

    didFindProject = true
    nextActivePath = targetProject.path

    return {
      ...currentState,
      workspace: {
        ...currentState.workspace,
        activeContext: { kind: 'project', projectId: targetProject.id },
        lastProjectId: targetProject.id,
        lastWorkspacePath: targetProject.path,
        projects: currentState.workspace.projects.map((project) => (
          project.id === targetProject.id ? { ...project, lastOpenedAt: now } : project
        )),
      },
    }
  })

  if (!didFindProject) {
    throw new Error('Project not found.')
  }

  const nextState = await getVisibleProjectState()
  const activeProject = nextState.projects.find((project) => project.id === nextState.lastProjectId)

  if (nextActivePath && activeProject?.id !== normalizedProjectId) {
    throw new Error('Project folder is no longer available.')
  }

  return nextState
})

ipcMain.handle('project:remove', async (_event, projectId: string) => {
  const normalizedProjectId = typeof projectId === 'string' ? projectId : ''
  const currentState = await appStateStore.read()
  const projectExists = currentState.workspace.projects.some((project) => project.id === normalizedProjectId)

  if (projectExists) {
    const remainingVisibleProjects = await filterExistingProjects(
      currentState.workspace.projects.filter((project) => project.id !== normalizedProjectId),
    )
    const nextVisibleProject = remainingVisibleProjects[0] ?? null

    await appStateStore.update((currentState) => {
      const remainingProjects = currentState.workspace.projects.filter((project) => project.id !== normalizedProjectId)
      const removedProject = currentState.workspace.projects.find((project) => project.id === normalizedProjectId) ?? null
      const currentActiveProject = remainingProjects.find((project) => project.id === currentState.workspace.lastProjectId) ?? null
      const removedActive = currentState.workspace.lastProjectId === normalizedProjectId
      const nextActiveProject = removedActive ? nextVisibleProject : currentActiveProject ?? nextVisibleProject
      const activeContext = currentState.workspace.activeContext
      const nextActiveContext = activeContext.kind === 'project'
        ? activeContext.projectId === normalizedProjectId
          ? nextActiveProject
            ? { kind: 'project' as const, projectId: nextActiveProject.id }
            : { kind: 'conversationDraft' as const }
          : remainingProjects.some((project) => project.id === activeContext.projectId)
            ? activeContext
            : nextActiveProject
              ? { kind: 'project' as const, projectId: nextActiveProject.id }
              : { kind: 'conversationDraft' as const }
        : activeContext
      const nextLastWorkspacePath = nextActiveContext.kind === 'project'
        ? remainingProjects.find((project) => project.id === nextActiveContext.projectId)?.path ?? null
        : nextActiveContext.kind === 'conversation'
          ? currentState.workspace.lastWorkspacePath
          : currentState.workspace.lastWorkspacePath === removedProject?.path
            ? null
            : currentState.workspace.lastWorkspacePath

      return {
        ...currentState,
        workspace: {
          ...currentState.workspace,
          lastProjectId: nextActiveProject?.id ?? null,
          activeContext: nextActiveContext,
          lastWorkspacePath: nextLastWorkspacePath,
          projects: remainingProjects,
        },
      }
    })
  }

  return getVisibleProjectState()
})

ipcMain.handle('conversation:get-state', async () => {
  return conversationStore.read()
})

ipcMain.handle('conversation:create-workspace', async (_event, request?: CreateConversationWorkspaceRequest) => {
  const record = await conversationStore.createWorkspace({
    agentId: request?.agentId,
    initialPrompt: typeof request?.initialPrompt === 'string' ? request.initialPrompt : null,
  })

  await appStateStore.update((currentState) => ({
    ...currentState,
    workspace: {
      ...currentState.workspace,
      activeContext: { kind: 'conversation', conversationId: record.id },
      entries: {
        ...currentState.workspace.entries,
        ...(record.workspacePath
          ? {
              [record.workspacePath]: currentState.workspace.entries[record.workspacePath] ?? {
                lastAgentSessionPath: null,
                lastFilePath: null,
                prefersNewAgentSession: false,
              },
            }
          : {}),
      },
      lastWorkspacePath: record.workspacePath ?? currentState.workspace.lastWorkspacePath,
    },
  }))

  return record
})

ipcMain.handle('conversation:update', async (_event, conversationId: string, patch: UpdateConversationRequest) => {
  const record = await conversationStore.updateConversation(conversationId, patch)
  const workspacePath = record.workspacePath
  const agentSessionPath = record.agentSessionPath

  if (workspacePath && agentSessionPath) {
    await appStateStore.update((currentState) => ({
      ...currentState,
      workspace: {
        ...currentState.workspace,
        entries: {
          ...currentState.workspace.entries,
          [workspacePath]: {
            ...getWorkspaceEntry(currentState, workspacePath),
            lastAgentSessionPath: agentSessionPath,
            prefersNewAgentSession: false,
          },
        },
      },
    }))
  }

  return record
})

ipcMain.handle('conversation:remove-draft', async (_event, conversationId: string) => {
  const previousState = await conversationStore.read()
  const draftWorkspacePath = previousState.conversations.find((conversation) => (
    conversation.id === conversationId && conversation.status === 'draft'
  ))?.workspacePath ?? null

  if (draftWorkspacePath) {
    await agentManager.releaseWorkspaceRuntime(draftWorkspacePath)
  }

  const nextState = await conversationStore.removeDraft(conversationId)
  await discardDraftWorkspaceSessions(draftWorkspacePath)
  const removedDraft = previousState.conversations.find((conversation) => (
    conversation.id === conversationId
    && conversation.status === 'draft'
    && !nextState.conversations.some((candidate) => candidate.id === conversation.id)
  )) ?? null

  if (removedDraft?.workspacePath) {
    await appStateStore.update((currentState) => {
      const entries = { ...currentState.workspace.entries }
      delete entries[removedDraft.workspacePath!]

      return {
        ...currentState,
        workspace: {
          ...currentState.workspace,
          activeContext: currentState.workspace.activeContext.kind === 'conversation'
            && currentState.workspace.activeContext.conversationId === removedDraft.id
            ? { kind: 'conversationDraft' }
            : currentState.workspace.activeContext,
          entries,
          lastWorkspacePath: currentState.workspace.lastWorkspacePath === removedDraft.workspacePath
            ? null
            : currentState.workspace.lastWorkspacePath,
        },
      }
    })
  }

  return nextState
})

ipcMain.handle('conversation:remove', async (_event, conversationId: string) => {
  const previousState = await conversationStore.read()
  const removedConversation = previousState.conversations.find((conversation) => (
    conversation.id === conversationId
  )) ?? null

  if (!removedConversation) {
    throw new Error('Conversation not found.')
  }

  const removedWorkspacePath = removedConversation.workspacePath

  if (removedWorkspacePath) {
    await agentManager.releaseWorkspaceRuntime(removedWorkspacePath)
  }

  const nextState = await conversationStore.removeConversation(conversationId)

  await appStateStore.update((currentState) => {
    const entries = { ...currentState.workspace.entries }
    const removedWorkspaceIdentity = removedWorkspacePath ? getProjectPathIdentity(removedWorkspacePath) : null
    const hasRemainingWorkspaceOwner = Boolean(
      removedWorkspaceIdentity
      && (
        currentState.workspace.projects.some((project) => (
          getProjectPathIdentity(project.path) === removedWorkspaceIdentity
        ))
        || nextState.conversations.some((conversation) => (
          conversation.workspacePath
          && getProjectPathIdentity(conversation.workspacePath) === removedWorkspaceIdentity
        ))
      ),
    )

    if (removedWorkspaceIdentity && !hasRemainingWorkspaceOwner) {
      for (const workspacePath of Object.keys(entries)) {
        if (getProjectPathIdentity(workspacePath) === removedWorkspaceIdentity) {
          delete entries[workspacePath]
        }
      }
    }

    return {
      ...currentState,
      workspace: {
        ...currentState.workspace,
        activeContext: currentState.workspace.activeContext.kind === 'conversation'
          && currentState.workspace.activeContext.conversationId === removedConversation.id
          ? { kind: 'conversationDraft' }
          : currentState.workspace.activeContext,
        entries,
        lastWorkspacePath: removedWorkspacePath
          && !hasRemainingWorkspaceOwner
          && currentState.workspace.lastWorkspacePath
          && getProjectPathIdentity(currentState.workspace.lastWorkspacePath) === getProjectPathIdentity(removedWorkspacePath)
          ? null
          : currentState.workspace.lastWorkspacePath,
      },
    }
  })

  return nextState
})

ipcMain.handle('shell:open-path', async (_event, targetPath: string) => {
  const trimmedPath = typeof targetPath === 'string' ? targetPath.trim() : ''
  if (!trimmedPath) {
    throw new Error('Path is required.')
  }
  try {
    await stat(trimmedPath)
  } catch {
    throw new Error('The selected item no longer exists.')
  }
  const errorMessage = await shell.openPath(trimmedPath)
  if (errorMessage) {
    throw new Error(errorMessage)
  }
  return { ok: true }
})

ipcMain.handle('shell:show-item-in-folder', async (_event, targetPath: string) => {
  const trimmedPath = typeof targetPath === 'string' ? targetPath.trim() : ''
  if (!trimmedPath) {
    throw new Error('Path is required.')
  }
  try {
    await stat(trimmedPath)
  } catch {
    throw new Error('The selected item no longer exists.')
  }
  shell.showItemInFolder(trimmedPath)
  return { ok: true }
})

ipcMain.handle('workspace:load-tree', async (_, rootPath: string) => {
  return loadWorkspaceTree(rootPath)
})

ipcMain.handle('workspace:load-directory', async (_, rootPath: string, directoryPath?: string) => {
  return loadWorkspaceDirectory(
    readRequiredPathArgument(rootPath, 'Workspace path'),
    typeof directoryPath === 'string' ? directoryPath : '',
  )
})

ipcMain.handle('workspace:get-restore-state', async () => {
  const settings = await appStateStore.read()
  const activeContext = settings.workspace.activeContext
  let restoreWorkspacePath: string | null = null
  let restoreAgentSessionPath: string | null = null

  if (activeContext.kind === 'project') {
    const activeProject = settings.workspace.projects.find((project) => project.id === activeContext.projectId)
      ?? settings.workspace.projects.find((project) => project.id === settings.workspace.lastProjectId)
      ?? null
    restoreWorkspacePath = activeProject?.path ?? null
  } else if (activeContext.kind === 'conversation') {
    const conversationState = await conversationStore.read()
    const activeConversation = conversationState.conversations.find((conversation) => (
      conversation.id === activeContext.conversationId
    )) ?? null
    restoreWorkspacePath = activeConversation?.workspacePath ?? null
    restoreAgentSessionPath = activeConversation?.agentSessionPath ?? null
  }

  if (!restoreWorkspacePath) {
    return {
      agentSessionPath: null,
      filePath: null,
      workspacePath: null,
    }
  }

  if (!(await workspacePathExists(restoreWorkspacePath))) {
    await appStateStore.update((currentState) => ({
      ...currentState,
      workspace: {
        ...currentState.workspace,
        activeContext: currentState.workspace.activeContext.kind === 'project'
          ? { kind: 'conversationDraft' }
          : currentState.workspace.activeContext,
        lastWorkspacePath: currentState.workspace.lastWorkspacePath === restoreWorkspacePath
          ? null
          : currentState.workspace.lastWorkspacePath,
      },
    }))
    return {
      agentSessionPath: null,
      filePath: null,
      workspacePath: null,
    }
  }

  const workspaceEntry = getWorkspaceEntry(settings, restoreWorkspacePath)
  const lastFilePath = workspaceEntry.lastFilePath
  const agentSessionPath = restoreAgentSessionPath
    ?? (workspaceEntry.prefersNewAgentSession ? null : workspaceEntry.lastAgentSessionPath)

  if (!lastFilePath || !(await workspaceFileExists(restoreWorkspacePath, lastFilePath))) {
    if (lastFilePath) {
      await appStateStore.update((currentState) => ({
        ...currentState,
        workspace: {
          ...currentState.workspace,
          entries: {
            ...currentState.workspace.entries,
            [restoreWorkspacePath]: {
              ...getWorkspaceEntry(currentState, restoreWorkspacePath),
              lastFilePath: null,
            },
          },
        },
      }))
    }

    return {
      agentSessionPath,
      filePath: null,
      workspacePath: restoreWorkspacePath,
    }
  }

  return {
    agentSessionPath,
    filePath: lastFilePath,
    workspacePath: restoreWorkspacePath,
  }
})

ipcMain.handle('workspace:get-state', async (_, workspacePath: string) => {
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    return {
      lastAgentSessionPath: null,
      lastFilePath: null,
      prefersNewAgentSession: false,
    }
  }

  const state = await appStateStore.read()
  return getWorkspaceEntry(state, workspacePath)
})

ipcMain.handle('workspace:update-state', async (
  _,
  workspacePath: string,
  patch: {
    lastAgentSessionPath?: string | null
    lastFilePath?: string | null
    markAsLastOpened?: boolean
    prefersNewAgentSession?: boolean
  },
) => {
  const normalizedWorkspacePath = readRequiredPathArgument(workspacePath, 'Workspace path')
  const patchRecord = readRecord(patch)
  const hasLastAgentSessionPath = Object.prototype.hasOwnProperty.call(patchRecord, 'lastAgentSessionPath')
  const hasLastFilePath = Object.prototype.hasOwnProperty.call(patchRecord, 'lastFilePath')
  const hasPrefersNewAgentSession = Object.prototype.hasOwnProperty.call(patchRecord, 'prefersNewAgentSession')
  const markAsLastOpened = patchRecord.markAsLastOpened === true
  const entryPatch: { lastAgentSessionPath?: string | null; lastFilePath?: string | null; prefersNewAgentSession?: boolean } = {}
  let shouldPatchLastFilePath = false

  if (hasLastAgentSessionPath) {
    const lastAgentSessionPatch = readPathPatch(patchRecord.lastAgentSessionPath)
    if (lastAgentSessionPatch.shouldApply) {
      entryPatch.lastAgentSessionPath = lastAgentSessionPatch.value
    }
  }

  if (hasPrefersNewAgentSession) {
    entryPatch.prefersNewAgentSession = patchRecord.prefersNewAgentSession === true
  }

  if (hasLastFilePath) {
    const lastFilePathPatch = readPathPatch(patchRecord.lastFilePath)
    if (lastFilePathPatch.shouldApply) {
      entryPatch.lastFilePath = lastFilePathPatch.value
      shouldPatchLastFilePath = true
    }
  }

  await appStateStore.update((currentState) => ({
    ...currentState,
    workspace: {
      ...currentState.workspace,
      entries: {
        ...currentState.workspace.entries,
        [normalizedWorkspacePath]: {
          ...getWorkspaceEntry(currentState, normalizedWorkspacePath),
          ...entryPatch,
        },
      },
      lastWorkspacePath: markAsLastOpened ? normalizedWorkspacePath : currentState.workspace.lastWorkspacePath,
      projects: currentState.workspace.projects.map((project) => (
        getProjectPathIdentity(project.path) === getProjectPathIdentity(normalizedWorkspacePath)
          ? {
              ...project,
              ...(shouldPatchLastFilePath ? { lastFilePath: entryPatch.lastFilePath ?? null } : {}),
              ...(markAsLastOpened ? { lastOpenedAt: new Date().toISOString() } : {}),
            }
          : project
      )),
    },
  }))

  return { ok: true }
})

ipcMain.handle('persistence:initialize', async (_, migrationPayload?: unknown) => {
  await applyLocalStorageStateMigration(readLocalStorageMigration(migrationPayload))
  return getPersistentClientStateSnapshot()
})

ipcMain.handle('settings:update-state', async (_, patch: unknown) => {
  const patchRecord = readRecord(patch)

  await appStateStore.update((currentState) => ({
    ...currentState,
    settings: normalizeAppSettings({
      ...currentState.settings,
      ...patchRecord,
      agent: {
        ...currentState.settings.agent,
        ...readRecord(patchRecord.agent),
      },
      meo: {
        ...currentState.settings.meo,
        ...readRecord(patchRecord.meo),
      },
    }),
  }))

  return { ok: true }
})

ipcMain.handle('layout:update-state', async (_, patch: unknown) => {
  await appStateStore.update((currentState) => ({
    ...currentState,
    layout: normalizeLayoutState({
      ...currentState.layout,
      ...readRecord(patch),
    }),
  }))

  return { ok: true }
})

ipcMain.handle('workspace-tabs:get-state', async (_, workspacePath: string) => {
  if (typeof workspacePath !== 'string' || !workspacePath.trim()) {
    return null
  }

  const state = await workspaceStateStore.read()
  return state.workspaceTabs[workspacePath] ?? null
})

ipcMain.handle('workspace-tabs:update-state', async (_, workspacePath: string, tabState: unknown) => {
  const normalizedWorkspacePath = readRequiredPathArgument(workspacePath, 'Workspace path')

  await workspaceStateStore.update((currentState) => ({
    ...currentState,
    workspaceTabs: {
      ...currentState.workspaceTabs,
      [normalizedWorkspacePath]: normalizeWorkspaceTabState(tabState),
    },
  }))

  return { ok: true }
})

ipcMain.handle('meo-state:update', async (_, filePath: string, state: unknown) => {
  const normalizedFilePath = readRequiredPathArgument(filePath, 'File path')

  await workspaceStateStore.update((currentState) => ({
    ...currentState,
    meoFileStates: {
      ...currentState.meoFileStates,
      [normalizedFilePath]: normalizeMeoFileState(state),
    },
  }))

  return { ok: true }
})

ipcMain.handle('ui:get-state', async () => {
  const state = await appStateStore.read()
  return state.ui
})

ipcMain.handle('ui:update-state', async (_, patch: unknown) => {
  const patchRecord = readRecord(patch)
  const agentComposerHeight = typeof patchRecord.agentComposerHeight === 'number'
    ? patchRecord.agentComposerHeight
    : undefined

  await appStateStore.update((currentState) => ({
    ...currentState,
    ui: {
      ...currentState.ui,
      ...(agentComposerHeight !== undefined ? { agentComposerHeight } : {}),
    },
  }))

  return { ok: true }
})

ipcMain.handle('window:set-theme', (_event, theme: unknown) => {
  const themePayload = theme && typeof theme === 'object'
    ? theme as { appearanceTheme?: unknown; backgroundTheme?: unknown }
    : null
  const appearanceTheme = normalizeWindowAppearanceTheme(themePayload?.appearanceTheme)
  const hasBackgroundTheme = Boolean(
    themePayload && Object.prototype.hasOwnProperty.call(themePayload, 'backgroundTheme'),
  )
  const backgroundTheme = normalizeWindowBackgroundTheme(themePayload?.backgroundTheme)

  if (!appearanceTheme || (hasBackgroundTheme && !backgroundTheme) || !win || win.isDestroyed()) {
    return { ok: false }
  }

  windowAppearanceTheme = appearanceTheme

  if (process.platform === 'darwin') {
    nativeTheme.themeSource = appearanceTheme
  }

  const resolvedBackgroundTheme = backgroundTheme ?? resolveWindowBackgroundTheme(appearanceTheme)
  applyWindowBackgroundTheme(resolvedBackgroundTheme)
  return { ok: true, resolvedTheme: resolvedBackgroundTheme }
})

ipcMain.handle('workspace:read-file', async (_, filePath: string) => {
  return loadWorkspaceFile(filePath)
})

ipcMain.handle('workspace:resolve-editor-kind', async (_, filePath: string) => {
  return resolveWorkspaceEditorKind(filePath)
})

ipcMain.handle('workspace:save-file', async (_, filePath: string, content: string) => {
  await saveWorkspaceFile(filePath, content)
  return { ok: true }
})

ipcMain.handle('workspace:file-exists', async (_, rootPath: string, filePath: string) => {
  return { exists: await workspaceFileExists(rootPath, filePath) }
})

ipcMain.handle('workspace:get-file-url', async (_, rootPath: string, filePath: string) => {
  return {
    url: await getWorkspaceFileUrl(
      readRequiredPathArgument(rootPath, 'Workspace path'),
      readRequiredPathArgument(filePath, 'File path'),
    ),
  }
})

ipcMain.handle('workspace:get-file-data-url', async (_, rootPath: string, filePath: string, contentType?: string) => {
  return {
    url: await getWorkspaceFileDataUrl(
      readRequiredPathArgument(rootPath, 'Workspace path'),
      readRequiredPathArgument(filePath, 'File path'),
      typeof contentType === 'string' ? contentType : undefined,
    ),
  }
})

ipcMain.handle('workspace:path-exists', async (_, workspacePath: string) => {
  return { exists: await workspacePathExists(workspacePath) }
})

ipcMain.handle(
  'workspace:save-image',
  async (
    _,
    rootPath: string,
    relativeDirectoryPath: string,
    fileName: string,
    imageData: string,
  ) => {
    const filePath = await saveWorkspaceImage(rootPath, relativeDirectoryPath, fileName, imageData)
    return { filePath }
  },
)

ipcMain.handle('workspace:create-file', async (_, rootPath: string, relativeFilePath: string) => {
  const filePath = await createWorkspaceFile(rootPath, relativeFilePath)
  return { filePath }
})

ipcMain.handle('workspace:create-directory', async (_, rootPath: string, relativeDirPath: string) => {
  const dirPath = await createWorkspaceDirectory(rootPath, relativeDirPath)
  return { dirPath }
})

ipcMain.handle('workspace:move-entry', async (_, rootPath: string, entryPath: string, nextRelativePath: string) => {
  const nextFilePath = await moveWorkspaceEntry(rootPath, entryPath, nextRelativePath)
  return { filePath: nextFilePath }
})

ipcMain.handle('workspace:delete-file', async (_, rootPath: string, filePath: string) => {
  await deleteWorkspaceFile(rootPath, filePath)
  return { ok: true }
})

ipcMain.handle('git:get-state', async (_, workspacePath: string) => {
  return getGitRepositoryState(workspacePath)
})

ipcMain.handle('git:init', async (_, workspacePath: string) => {
  return initializeGitRepository(workspacePath)
})

ipcMain.handle('git:stage-paths', async (_, workspacePath: string, filePaths: string[]) => {
  return stageGitPaths(workspacePath, filePaths)
})

ipcMain.handle('git:unstage-paths', async (_, workspacePath: string, filePaths: string[]) => {
  return unstageGitPaths(workspacePath, filePaths)
})

ipcMain.handle('git:discard-change', async (_, workspacePath: string, change: GitChangeItem) => {
  return discardGitChange(workspacePath, change)
})

ipcMain.handle(
  'git:apply-selection',
  async (
    _,
    workspacePath: string,
    filePath: string,
    scope: GitChangeScope,
    selection: GitDiffSelection,
    action: GitDiffBlockAction,
  ) => {
    return applyGitDiffSelection(workspacePath, filePath, scope, selection, action)
  },
)

ipcMain.handle('git:discard-all', async (_, workspacePath: string) => {
  return discardAllGitChanges(workspacePath)
})

ipcMain.handle('git:commit', async (_, workspacePath: string, message: string) => {
  return commitGitChanges(workspacePath, message)
})

ipcMain.handle('git:commit-and-sync', async (_, workspacePath: string, message: string) => {
  return commitAndSyncGitChanges(workspacePath, message)
})

ipcMain.handle('git:pull', async (_, workspacePath: string) => {
  return pullGitChanges(workspacePath)
})

ipcMain.handle('git:push', async (_, workspacePath: string) => {
  return pushGitChanges(workspacePath)
})

ipcMain.handle('git:revert-commit', async (_, workspacePath: string, commitHash: string) => {
  return revertGitCommit(workspacePath, commitHash)
})

ipcMain.handle('git:get-file-diff', async (_, workspacePath: string, filePath: string, scope: GitChangeScope) => {
  return getGitFileDiff(workspacePath, filePath, scope)
})

ipcMain.handle('git:get-commit-history', async (_, workspacePath: string, limit?: number) => {
  return getGitCommitHistory(workspacePath, limit)
})

ipcMain.handle('git:get-commit-details', async (_, workspacePath: string, commitHash: string) => {
  return getGitCommitDetails(workspacePath, commitHash)
})

ipcMain.handle('git:get-commit-file-diff', async (_, workspacePath: string, commitHash: string, filePath: string) => {
  return getGitCommitFileDiff(workspacePath, commitHash, filePath)
})

ipcMain.handle(
  'git:get-baseline',
  async (
    _,
    workspacePath: string,
    filePath: string,
  ) => {
    return getGitBaseline(workspacePath, filePath)
  },
)

ipcMain.handle(
  'git:get-line-blame',
  async (
    _,
    workspacePath: string,
    filePath: string,
    lineNumber: number,
    contentText?: string,
  ) => {
    return getGitLineBlame(workspacePath, filePath, lineNumber, contentText)
  },
)

ipcMain.handle('workspace:start-watch', async (_, rootPath: string) => {
  await watchWorkspace(rootPath, (event) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.send('workspace:changed', event)
  })

  return { ok: true }
})

ipcMain.handle('workspace:stop-watch', async () => {
  await unwatchWorkspace()
  return { ok: true }
})

ipcMain.handle('workspace-icons:get-theme', async (_, modeValue?: unknown) => {
  const mode = readWorkspaceIconThemeMode(modeValue)
  const state = await appStateStore.read()
  const persistedSourceSelection = state.ui.workspaceIconThemes[mode]
  const persistedSelection = await getEffectiveWorkspaceIconThemeSelection(mode)

  if (!persistedSelection.sourceVsixPath || !persistedSelection.activeThemeId) {
    return null
  }

  const theme = await importWorkspaceIconTheme(
    persistedSelection.sourceVsixPath,
    persistedSelection.activeThemeId,
  )
    .catch(async (error) => {
      if (persistedSourceSelection.sourceKind === 'bundled') {
        try {
          return await loadBundledWorkspaceIconTheme(null, mode)
        } catch {
          throw error
        }
      }

      if (
        persistedSourceSelection.sourceKind !== 'external'
        && persistedSourceSelection.sourceKind !== null
      ) {
        return null
      }

      await appStateStore.update((currentState) => ({
        ...currentState,
        ui: {
          ...currentState.ui,
          workspaceIconThemes: {
            ...currentState.ui.workspaceIconThemes,
            [mode]: {
              activeThemeId: null,
              sourceKind: null,
              sourceVsixPath: null,
            },
          },
        },
      }))

      return null
    })

  return theme
})

ipcMain.handle('workspace-icons:pick-theme', async (_, modeValue?: unknown) => {
  const mode = readWorkspaceIconThemeMode(modeValue)

  if (!win) {
    return null
  }

  const result = await dialog.showOpenDialog(win, {
    filters: [
      {
        name: 'VS Code Icon Theme',
        extensions: ['vsix'],
      },
    ],
    properties: ['openFile'],
    title: 'Import VSIX Icon Theme',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return null
  }

  const theme = await importWorkspaceIconTheme(result.filePaths[0])
  await updatePersistedWorkspaceIconTheme(mode, theme)

  return theme
})

ipcMain.handle('workspace-icons:set-active-theme', async (_, modeValue: unknown, themeIdValue?: unknown) => {
  const hasExplicitMode = modeValue === 'light' || modeValue === 'dark'
  const mode = hasExplicitMode ? readWorkspaceIconThemeMode(modeValue) : 'light'
  const rawThemeId = hasExplicitMode ? themeIdValue : modeValue
  const themeId = typeof rawThemeId === 'string' && rawThemeId.trim()
    ? rawThemeId.trim()
    : null

  if (!themeId) {
    throw new Error('Icon theme id is required.')
  }

  const currentSelection = await getEffectiveWorkspaceIconThemeSelection(mode)
  const shouldResolveBundledTheme = !currentSelection.sourceVsixPath
    || isBundledWorkspaceIconTheme(currentSelection.sourceVsixPath)
  const nextSelection = shouldResolveBundledTheme
    ? await resolveBundledWorkspaceIconThemeSelection(themeId, mode)
    : currentSelection

  if (!nextSelection.sourceVsixPath) {
    throw new Error('Icon theme VSIX path is required.')
  }

  const nextThemeId = shouldResolveBundledTheme
    ? nextSelection.activeThemeId ?? themeId
    : themeId
  const theme = await importWorkspaceIconTheme(nextSelection.sourceVsixPath, nextThemeId)

  await updatePersistedWorkspaceIconTheme(mode, theme)

  return theme
})

ipcMain.handle('workspace-icons:catalog', async () => {
  return getWorkspaceIconThemeCatalog()
})

ipcMain.handle('workspace-icons:select-theme', async (
  _,
  modeOrSelection: unknown,
  selectionValue?: unknown,
) => {
  const hasExplicitMode = modeOrSelection === 'light' || modeOrSelection === 'dark'
  const mode = hasExplicitMode ? readWorkspaceIconThemeMode(modeOrSelection) : 'light'
  const selection = hasExplicitMode ? selectionValue : modeOrSelection
  const selectionRecord = readRecord(selection)
  const sourceVsixPath = typeof selectionRecord.sourceVsixPath === 'string' && selectionRecord.sourceVsixPath.trim()
    ? readRequiredPathArgument(selectionRecord.sourceVsixPath, 'Icon theme VSIX path')
    : null
  const themeId = typeof selectionRecord.themeId === 'string' && selectionRecord.themeId.trim()
    ? selectionRecord.themeId.trim()
    : null

  if (!sourceVsixPath && !themeId) {
    await appStateStore.update((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        workspaceIconThemes: {
          ...currentState.ui.workspaceIconThemes,
          [mode]: {
            activeThemeId: null,
            sourceKind: null,
            sourceVsixPath: null,
          },
        },
      },
    }))

    return null
  }

  if (!sourceVsixPath) {
    throw new Error('Icon theme VSIX path is required.')
  }

  if (!themeId) {
    throw new Error('Icon theme id is required.')
  }

  const theme = await importWorkspaceIconTheme(sourceVsixPath, themeId)

  await updatePersistedWorkspaceIconTheme(mode, theme)

  return theme
})

ipcMain.handle('agent:get-catalog', async (_event, options?: { force?: boolean }) => {
  return discoverAgentCatalog({ force: options?.force === true })
})

ipcMain.handle('agent:load-workspace', async (
  _event,
  scopeOrWorkspacePath: AgentRequestScope | string,
  preferredSessionPath?: string | null,
  options?: { restoreSession?: boolean },
) => {
  const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
  const state = await agentManager.loadWorkspaceState(scope, preferredSessionPath ?? null, options)
  rememberLegacyBuiltinScope(scope, state)
  return state
})

ipcMain.handle('agent:load-draft-state', async (_event, agentId?: AgentRequestScope['agentId']) => {
  return agentManager.loadDraftState(agentId)
})

ipcMain.handle('agent:list-sessions', async (_event, scopeOrWorkspacePath: AgentRequestScope | string) => {
  return agentManager.listSessionItems(normalizeAgentIpcScope(scopeOrWorkspacePath))
})

ipcMain.handle('agent:read-session', async (_event, scopeOrWorkspacePath: AgentRequestScope | string, sessionPath: string) => {
  return agentManager.readSession(normalizeAgentIpcScope(scopeOrWorkspacePath), sessionPath)
})

ipcMain.handle('agent:opencode-surface-request', async (_event, scope: AgentRequestScope, request: OpenCodeSurfaceRequest) => {
  return agentManager.requestOpenCodeSurface(scope, request)
})

ipcMain.handle('agent:session-exists', async (_event, scopeOrWorkspacePath: AgentRequestScope | string, sessionPath: string) => {
  return { exists: await agentManager.sessionExists(normalizeAgentIpcScope(scopeOrWorkspacePath), sessionPath) }
})

ipcMain.handle('agent:create-session', async (_event, scopeOrWorkspacePath: AgentRequestScope | string, options?: string | AgentSessionCreateOptions) => {
  const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
  const state = await agentManager.createSession(scope, options)
  rememberLegacyBuiltinScope(scope, state)
  return state
})

ipcMain.handle('agent:open-session', async (_event, scopeOrWorkspacePath: AgentRequestScope | string, sessionPath: string) => {
  const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
  const state = await agentManager.openSession(scope, sessionPath)
  rememberLegacyBuiltinScope(scope, state)
  return state
})

ipcMain.handle('agent:delete-session', async (_event, scopeOrWorkspacePath: AgentRequestScope | string, sessionPath: string) => {
  const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
  const state = await agentManager.deleteSession(scope, sessionPath)
  rememberLegacyBuiltinScope(scope, state)
  return state
})

ipcMain.handle('agent:rename-session', async (_event, scopeOrWorkspacePath: AgentRequestScope | string, sessionPath: string, name: string) => {
  const scope = normalizeAgentIpcScope(scopeOrWorkspacePath)
  const state = await agentManager.renameSession(scope, sessionPath, name)
  rememberLegacyBuiltinScope(scope, state)
  return state
})

ipcMain.handle('agent:pick-attachments', async () => {
  if (!win) {
    return []
  }

  const result = await dialog.showOpenDialog(win, {
    filters: [
      {
        name: 'Supported attachments',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'html', 'css', 'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'cpp', 'c', 'h', 'hpp', 'sql', 'docx', 'pdf'],
      },
      {
        name: 'All files',
        extensions: ['*'],
      },
    ],
    properties: ['openFile', 'multiSelections'],
    title: 'Attach Files',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return []
  }

  return Promise.all(result.filePaths.map(async (filePath): Promise<AgentPromptAttachment> => {
    const mimeType = getAgentAttachmentMimeType(filePath)
    const fileStats = await stat(filePath).catch(() => null)
    const isImage = Boolean(mimeType)
    const shouldInlineImage = isImage && (!fileStats || fileStats.size <= MAX_PICKED_IMAGE_ATTACHMENT_BYTES)
    const data = shouldInlineImage
      ? `data:${mimeType};base64,${(await readFile(filePath)).toString('base64')}`
      : undefined

    return {
      ...(data ? { data } : {}),
      fileName: path.basename(filePath),
      kind: isImage ? 'image' : 'file',
      ...(mimeType ? { mimeType } : {}),
      path: filePath,
      ...(fileStats ? { size: fileStats.size } : {}),
    }
  }))
})

ipcMain.handle('agent:send-prompt', async (
  _event,
  scopeOrPrompt: AgentRequestScope | string,
  promptOrStreamingBehavior?: string | AgentRunningPromptBehavior,
  streamingBehaviorOrAttachments?: AgentRunningPromptBehavior | AgentPromptAttachment[],
  attachmentsOrOptions?: AgentPromptAttachment[] | AgentPromptSendOptions,
  options?: AgentPromptSendOptions,
) => {
  if (typeof scopeOrPrompt !== 'string') {
    return agentManager.sendPrompt(
      scopeOrPrompt,
      String(promptOrStreamingBehavior ?? ''),
      streamingBehaviorOrAttachments as AgentRunningPromptBehavior | undefined,
      attachmentsOrOptions as AgentPromptAttachment[] | undefined,
      options,
    )
  }
  return agentManager.sendPrompt(
    requireLegacyBuiltinScope(),
    scopeOrPrompt,
    promptOrStreamingBehavior as AgentRunningPromptBehavior | undefined,
    streamingBehaviorOrAttachments as AgentPromptAttachment[] | undefined,
  )
})

ipcMain.handle('agent:update-queued-message', async (
  _event,
  scopeOrUpdate: AgentRequestScope | AgentQueuedMessageUpdate,
  maybeUpdate?: AgentQueuedMessageUpdate,
) => {
  return scopeOrUpdate && typeof scopeOrUpdate === 'object' && 'agentId' in scopeOrUpdate
    ? agentManager.updateQueuedMessage(scopeOrUpdate, maybeUpdate as AgentQueuedMessageUpdate)
    : agentManager.updateQueuedMessage(requireLegacyBuiltinScope(), scopeOrUpdate)
})

ipcMain.handle('agent:select-model', async (_event, scopeOrModelKey: AgentRequestScope | string, maybeModelKey?: string) => {
  return typeof scopeOrModelKey === 'string'
    ? agentManager.selectModel(requireLegacyBuiltinScope(), scopeOrModelKey)
    : agentManager.selectModel(scopeOrModelKey, String(maybeModelKey ?? ''))
})

ipcMain.handle('agent:select-thinking-level', async (
  _event,
  scopeOrLevel: AgentRequestScope | string,
  levelOrModelKey?: string,
  maybeModelKey?: string,
) => {
  return typeof scopeOrLevel === 'string'
    ? agentManager.selectThinkingLevel(requireLegacyBuiltinScope(), scopeOrLevel, levelOrModelKey)
    : agentManager.selectThinkingLevel(scopeOrLevel, String(levelOrModelKey ?? ''), maybeModelKey)
})

ipcMain.handle('agent:update-provider-auth', async (_event, rootPath: string | null, provider: string, apiKey: string | null) => {
  return agentManager.updateProviderAuth(rootPath, provider, apiKey)
})

ipcMain.handle('agent:login-provider-auth', async (_event, rootPath: string | null, provider: string) => {
  cancelProviderAuthFlow(provider, 'A new login was started.')
  const controller = new AbortController()
  const flowId = randomUUID()
  activeProviderAuthFlows.set(provider, { controller, flowId })

  try {
    return await agentManager.loginProviderAuth(rootPath, provider, {
      emitAuth: (providerId, info) => {
        emitProviderAuthUiEvent({
          type: 'auth',
          instructions: info.instructions,
          provider: providerId,
          url: info.url,
        })
      },
      emitComplete: (providerId, ok, message) => {
        emitProviderAuthUiEvent({
          type: 'complete',
          message,
          ok,
          provider: providerId,
        })
      },
      emitProgress: (providerId, message) => {
        emitProviderAuthUiEvent({
          type: 'progress',
          message,
          provider: providerId,
        })
      },
      openExternal: async (url) => {
        await shell.openExternal(url)
      },
      requestInput: (providerId, prompt) => requestProviderAuthInput(providerId, flowId, prompt),
      signal: controller.signal,
    })
  } finally {
    const activeFlow = activeProviderAuthFlows.get(provider)
    if (activeFlow?.flowId === flowId) {
      activeProviderAuthFlows.delete(provider)
    }
    rejectProviderAuthPrompts(provider, flowId)
  }
})

ipcMain.handle('agent:logout-provider-auth', async (_event, rootPath: string | null, provider: string) => {
  cancelProviderAuthFlow(provider)
  return agentManager.logoutProviderAuth(rootPath, provider)
})

ipcMain.handle('agent:cancel-provider-auth', async (_event, provider: string) => {
  return { ok: cancelProviderAuthFlow(provider) }
})

ipcMain.handle('agent:respond-provider-auth-prompt', async (_event, requestId: string, value: string | null) => {
  const pendingPrompt = pendingProviderAuthPrompts.get(requestId)
  if (!pendingPrompt) {
    return { ok: false }
  }

  pendingProviderAuthPrompts.delete(requestId)

  if (value === null) {
    pendingPrompt.reject(new Error('Login cancelled.'))
    return { ok: true }
  }

  pendingPrompt.resolve(value)
  return { ok: true }
})

ipcMain.handle('agent:abort', async (_event, scope?: AgentRequestScope) => {
  return agentManager.abortActivePrompt(scope ?? requireLegacyBuiltinScope())
})

ipcMain.handle('agent:respond-interaction', async (_event, response: AgentInteractionResponse) => {
  return { ok: await agentManager.respondToInteraction(response) }
})

ipcMain.handle('window:minimize', () => {
  win?.minimize()
})

ipcMain.handle('shell:open-external', async (_event, href: string) => {
  const trimmedHref = typeof href === 'string' ? href.trim() : ''
  if (!trimmedHref) {
    return { ok: false }
  }

  await shell.openExternal(trimmedHref)
  return { ok: true }
})

ipcMain.handle('window:toggle-maximize', () => {
  if (!win) {
    return getWindowChromeState(null)
  }

  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }

  return getWindowChromeState(win)
})

ipcMain.handle('window:close', () => {
  if (!win) {
    return
  }

  allowWindowClose = true
  win.close()
})

ipcMain.handle('window:is-maximized', () => {
  return getWindowChromeState()
})

ipcMain.handle('window:refresh-interaction-regions', async (_event, mode: 'soft' | 'hard' = 'hard') => {
  if (!win || win.isDestroyed()) {
    return { ok: false }
  }

  if (mode === 'soft') {
    win.webContents.invalidate()
    return { ok: true }
  }

  // Frameless windows on macOS can keep stale draggable hit regions until the
  // next actual resize. A one-pixel width nudge-and-restore is enough to force
  // Chromium to rebuild the hit-test map, and is lighter than repeatedly
  // invalidating the whole window while the drawer is animating.
  if (!win.isMaximized() && !win.isFullScreen()) {
    const bounds = win.getBounds()
    const nudgedBounds = {
      ...bounds,
      width: bounds.width + 1,
    }

    win.setBounds(nudgedBounds, false)
    await new Promise((resolve) => setTimeout(resolve, 0))

    if (!win.isDestroyed()) {
      win.setBounds(bounds, false)
    }
  } else {
    win.webContents.invalidate()
  }

  return { ok: true }
})

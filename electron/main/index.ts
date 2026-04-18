import { Menu, app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
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
  getGitLineBlame,
  getGitFileDiff,
  getGitRepositoryState,
  initializeGitRepository,
  pullGitChanges,
  pushGitChanges,
  stageGitPaths,
  unstageGitPaths,
} from './git'
import {
  createWorkspaceDirectory,
  createWorkspaceFile,
  deleteWorkspaceFile,
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
import { PiAgentManager } from './agent'
import {
  AppStateStore,
  getWorkspaceEntry,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
} from './app-state'
import type { AgentClientEvent } from '../../src/features/agent/types'
import type { GitChangeItem, GitChangeScope, GitDiffBlockAction, GitDiffSelection } from '../../src/features/git/types'
import type { WorkspaceIconThemeCatalogOption } from '../../src/features/workspace/types'
import {
  importWorkspaceIconThemeFromVsix,
} from './workspace-icon-theme'
import {
  getAppIconAssetPath,
  getAppIconCatalog,
  resolveAppIconId,
} from './app-icons'
import {
  disposeBundledMeoEditorServer,
  getBundledMeoEditorBootstrap,
} from './meo-editor'

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

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
let allowWindowClose = false
const preload = path.join(MAIN_DIST, 'preload', 'index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')
const appStatePath = path.join(app.getPath('userData'), 'app-state.json')
const agentDir = path.join(app.getPath('userData'), 'pi-agent')
const workspaceIconThemeCacheDir = path.join(app.getPath('temp'), app.getName(), 'workspace-icon-themes')
const meoEditorCacheDir = path.join(app.getPath('temp'), app.getName(), 'meo-editor')
const bundledWorkspaceIconThemePath = path.join(
  process.env.VITE_PUBLIC,
  'icon-themes',
  'thang-nm.flow-icons-1.3.2.vsix',
)
const legacyWorkspaceSettingsPath = path.join(app.getPath('userData'), 'workspace-settings.json')
const appStateStore = new AppStateStore(appStatePath, legacyWorkspaceSettingsPath)
const agentManager = new PiAgentManager(
  (event: AgentClientEvent) => {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return
    }

    win.webContents.send('agent:event', event)
  },
  { agentDir },
)

async function persistWindowState(targetWindow: BrowserWindow) {
  const bounds = targetWindow.isMaximized()
    ? targetWindow.getNormalBounds()
    : targetWindow.getBounds()

  await appStateStore.update((currentState) => ({
    ...currentState,
    window: {
      width: Math.max(MIN_WINDOW_WIDTH, bounds.width),
      height: Math.max(MIN_WINDOW_HEIGHT, bounds.height),
      isMaximized: targetWindow.isMaximized(),
    },
  }))
}

function bindWindowStatePersistence(targetWindow: BrowserWindow) {
  const persistBounds = throttle(() => {
    void persistWindowState(targetWindow)
  }, 240)

  targetWindow.on('resize', persistBounds)
  targetWindow.on('maximize', () => {
    persistBounds.cancel()
    void persistWindowState(targetWindow)
  })
  targetWindow.on('unmaximize', () => {
    persistBounds.cancel()
    void persistWindowState(targetWindow)
  })
  targetWindow.on('close', () => {
    persistBounds.cancel()
    void persistWindowState(targetWindow)
  })
}

async function createWindow() {
  const appState = await appStateStore.read()
  const appIconPath = getAppIconAssetPath(process.env.VITE_PUBLIC, appState.ui.appIconId)

  win = new BrowserWindow({
    title: 'Aryn',
    icon: appIconPath,
    backgroundColor: '#ffffff',
    frame: false,
    autoHideMenuBar: true,
    width: appState.window.width,
    height: appState.window.height,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
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

  applyAppIconSelection(appState.ui.appIconId)
}

function applyAppIconSelection(appIconId?: string | null) {
  const resolvedAppIconId = resolveAppIconId(appIconId)
  const iconPath = getAppIconAssetPath(process.env.VITE_PUBLIC, resolvedAppIconId)
  const icon = nativeImage.createFromPath(iconPath)

  if (!icon.isEmpty()) {
    if (process.platform === 'darwin') {
      app.dock.setIcon(icon)
    }

    if (win && !win.isDestroyed()) {
      win.setIcon(icon)
    }
  }

  return resolvedAppIconId
}

function isBundledWorkspaceIconThemePath(vsixPath: string) {
  return path.resolve(vsixPath) === path.resolve(bundledWorkspaceIconThemePath)
}

async function importWorkspaceIconTheme(vsixPath: string, preferredThemeId?: string | null) {
  return importWorkspaceIconThemeFromVsix(
    vsixPath,
    workspaceIconThemeCacheDir,
    preferredThemeId,
    isBundledWorkspaceIconThemePath(vsixPath) ? 'bundled' : 'external',
  )
}

async function loadBundledWorkspaceIconTheme(preferredThemeId?: string | null) {
  return importWorkspaceIconTheme(bundledWorkspaceIconThemePath, preferredThemeId)
}

function toCatalogOptions(theme: Awaited<ReturnType<typeof importWorkspaceIconTheme>>): WorkspaceIconThemeCatalogOption[] {
  return theme.themes.map((themeOption) => ({
    key: `${theme.sourceVsixPath}::${themeOption.id}`,
    label: themeOption.label,
    sourceKind: theme.sourceKind,
    sourceVsixPath: theme.sourceVsixPath,
    themeId: themeOption.id,
  }))
}

async function getEffectiveWorkspaceIconThemeSelection(): Promise<{
  activeThemeId: string | null
  sourceVsixPath: string
}> {
  const state = await appStateStore.read()
  const persistedVsixPath = state.ui.workspaceIconTheme.sourceVsixPath

  if (persistedVsixPath) {
    return {
      activeThemeId: state.ui.workspaceIconTheme.activeThemeId,
      sourceVsixPath: persistedVsixPath,
    }
  }

  return {
    activeThemeId: null,
    sourceVsixPath: bundledWorkspaceIconThemePath,
  }
}

async function getWorkspaceIconThemeCatalog() {
  const selection = await getEffectiveWorkspaceIconThemeSelection()
  const bundledTheme = await loadBundledWorkspaceIconTheme()
  const catalogOptions = [...toCatalogOptions(bundledTheme)]

  if (!isBundledWorkspaceIconThemePath(selection.sourceVsixPath)) {
    try {
      const importedTheme = await importWorkspaceIconTheme(selection.sourceVsixPath, selection.activeThemeId)
      catalogOptions.push(...toCatalogOptions(importedTheme))
    } catch {
      // Ignore broken imported themes so built-in themes remain selectable.
    }
  }

  return catalogOptions
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  applyAppIconSelection((await appStateStore.read()).ui.appIconId)

  void createWindow()
})

app.on('window-all-closed', () => {
  win = null
  agentManager.dispose()
  void disposeBundledMeoEditorServer()
  void unwatchWorkspace()
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
    void createWindow()
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

ipcMain.handle('workspace:load-tree', async (_, rootPath: string) => {
  return loadWorkspaceTree(rootPath)
})

ipcMain.handle('workspace:get-restore-state', async () => {
  const settings = await appStateStore.read()
  const lastWorkspacePath = settings.workspace.lastWorkspacePath

  if (!lastWorkspacePath) {
    return {
      agentSessionPath: null,
      filePath: null,
      workspacePath: null,
    }
  }

  if (!(await workspacePathExists(lastWorkspacePath))) {
    await appStateStore.update((currentState) => ({
      ...currentState,
      workspace: {
        ...currentState.workspace,
        lastWorkspacePath: null,
      },
    }))
    return {
      agentSessionPath: null,
      filePath: null,
      workspacePath: null,
    }
  }

  const workspaceEntry = getWorkspaceEntry(settings, lastWorkspacePath)
  const lastFilePath = workspaceEntry.lastFilePath

  if (!lastFilePath || !(await workspaceFileExists(lastWorkspacePath, lastFilePath))) {
    if (lastFilePath) {
      await appStateStore.update((currentState) => ({
        ...currentState,
        workspace: {
          ...currentState.workspace,
          entries: {
            ...currentState.workspace.entries,
            [lastWorkspacePath]: {
              ...getWorkspaceEntry(currentState, lastWorkspacePath),
              lastFilePath: null,
            },
          },
        },
      }))
    }

    return {
      agentSessionPath: workspaceEntry.lastAgentSessionPath,
      filePath: null,
      workspacePath: lastWorkspacePath,
    }
  }

  return {
    agentSessionPath: workspaceEntry.lastAgentSessionPath,
    filePath: lastFilePath,
    workspacePath: lastWorkspacePath,
  }
})

ipcMain.handle('workspace:get-state', async (_, workspacePath: string) => {
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
  },
) => {
  await appStateStore.update((currentState) => ({
    ...currentState,
    workspace: {
      entries: {
        ...currentState.workspace.entries,
        [workspacePath]: {
          ...getWorkspaceEntry(currentState, workspacePath),
          ...(patch.lastAgentSessionPath !== undefined ? { lastAgentSessionPath: patch.lastAgentSessionPath } : {}),
          ...(patch.lastFilePath !== undefined ? { lastFilePath: patch.lastFilePath } : {}),
        },
      },
      lastWorkspacePath: patch.markAsLastOpened ? workspacePath : currentState.workspace.lastWorkspacePath,
    },
  }))

  return { ok: true }
})

ipcMain.handle('ui:get-state', async () => {
  const state = await appStateStore.read()
  return state.ui
})

ipcMain.handle('ui:update-state', async (_, patch: { agentComposerHeight?: number }) => {
  await appStateStore.update((currentState) => ({
    ...currentState,
    ui: {
      ...currentState.ui,
      ...(patch.agentComposerHeight !== undefined ? { agentComposerHeight: patch.agentComposerHeight } : {}),
    },
  }))

  return { ok: true }
})

ipcMain.handle('app-icons:catalog', async () => {
  return getAppIconCatalog(process.env.VITE_PUBLIC)
})

ipcMain.handle('app-icons:get-selection', async () => {
  const state = await appStateStore.read()
  return resolveAppIconId(state.ui.appIconId)
})

ipcMain.handle('app-icons:select', async (_, appIconId: string) => {
  const nextAppIconId = resolveAppIconId(appIconId)

  await appStateStore.update((currentState) => ({
    ...currentState,
    ui: {
      ...currentState.ui,
      appIconId: nextAppIconId,
    },
  }))

  applyAppIconSelection(nextAppIconId)
  return nextAppIconId
})

ipcMain.handle('workspace:read-file', async (_, filePath: string) => {
  return loadWorkspaceFile(filePath)
})

ipcMain.handle('workspace:get-meo-bootstrap', async () => {
  return getBundledMeoEditorBootstrap(process.env.VITE_PUBLIC, meoEditorCacheDir)
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

ipcMain.handle('git:get-file-diff', async (_, workspacePath: string, filePath: string, scope: GitChangeScope) => {
  return getGitFileDiff(workspacePath, filePath, scope)
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

ipcMain.handle('workspace-icons:get-theme', async () => {
  const state = await appStateStore.read()
  const persistedSelection = await getEffectiveWorkspaceIconThemeSelection()
  const theme = await importWorkspaceIconTheme(
    persistedSelection.sourceVsixPath,
    persistedSelection.activeThemeId,
  )
    .catch(async (error) => {
      if (!state.ui.workspaceIconTheme.sourceVsixPath) {
        return null
      }

      await appStateStore.update((currentState) => ({
        ...currentState,
        ui: {
          ...currentState.ui,
          workspaceIconTheme: {
            activeThemeId: null,
            sourceVsixPath: null,
          },
        },
      }))

      try {
        return await loadBundledWorkspaceIconTheme()
      } catch {
        throw error
      }
    })

  return theme
})

ipcMain.handle('workspace-icons:pick-theme', async () => {
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
  await appStateStore.update((currentState) => ({
    ...currentState,
    ui: {
      ...currentState.ui,
      workspaceIconTheme: {
        activeThemeId: theme.activeThemeId,
        sourceVsixPath: theme.sourceVsixPath,
      },
    },
  }))

  return theme
})

ipcMain.handle('workspace-icons:set-active-theme', async (_, themeId: string) => {
  const selection = await getEffectiveWorkspaceIconThemeSelection()
  const theme = await importWorkspaceIconTheme(selection.sourceVsixPath, themeId)

  await appStateStore.update((currentState) => ({
    ...currentState,
    ui: {
      ...currentState.ui,
      workspaceIconTheme: {
        activeThemeId: theme.activeThemeId,
        sourceVsixPath: theme.sourceVsixPath,
      },
    },
  }))

  return theme
})

ipcMain.handle('workspace-icons:catalog', async () => {
  return getWorkspaceIconThemeCatalog()
})

ipcMain.handle('workspace-icons:select-theme', async (_, selection: { sourceVsixPath: string, themeId: string }) => {
  const theme = await importWorkspaceIconTheme(selection.sourceVsixPath, selection.themeId)

  await appStateStore.update((currentState) => ({
    ...currentState,
    ui: {
      ...currentState.ui,
      workspaceIconTheme: {
        activeThemeId: theme.activeThemeId,
        sourceVsixPath: theme.sourceVsixPath,
      },
    },
  }))

  return theme
})

ipcMain.handle('agent:load-workspace', async (_event, rootPath: string, preferredSessionPath?: string | null) => {
  return agentManager.loadWorkspaceState(rootPath, preferredSessionPath ?? null)
})

ipcMain.handle('agent:create-session', async (_event, rootPath: string, name?: string) => {
  return agentManager.createSession(rootPath, name)
})

ipcMain.handle('agent:open-session', async (_event, rootPath: string, sessionPath: string) => {
  return agentManager.openSession(rootPath, sessionPath)
})

ipcMain.handle('agent:delete-session', async (_event, rootPath: string, sessionPath: string) => {
  return agentManager.deleteSession(rootPath, sessionPath)
})

ipcMain.handle('agent:rename-session', async (_event, name: string) => {
  return agentManager.renameActiveSession(name)
})

ipcMain.handle('agent:send-prompt', async (_event, prompt: string, streamingBehavior?: 'steer' | 'followUp') => {
  return agentManager.sendPrompt(prompt, streamingBehavior)
})

ipcMain.handle('agent:select-model', async (_event, modelKey: string) => {
  return agentManager.selectModel(modelKey)
})

ipcMain.handle('agent:update-provider-auth', async (_event, rootPath: string, provider: string, apiKey: string | null) => {
  return agentManager.updateProviderAuth(rootPath, provider, apiKey)
})

ipcMain.handle('agent:abort', async () => {
  return agentManager.abortActivePrompt()
})

ipcMain.handle('window:minimize', () => {
  win?.minimize()
})

ipcMain.handle('window:toggle-maximize', () => {
  if (!win) {
    return { isMaximized: false }
  }

  if (win.isMaximized()) {
    win.unmaximize()
  } else {
    win.maximize()
  }

  return { isMaximized: win.isMaximized() }
})

ipcMain.handle('window:close', () => {
  if (!win) {
    return
  }

  allowWindowClose = true
  win.close()
})

ipcMain.handle('window:is-maximized', () => {
  return { isMaximized: win?.isMaximized() ?? false }
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

import { Menu, app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import throttle from 'lodash.throttle'
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  loadWorkspaceFile,
  loadWorkspaceTree,
  renameWorkspaceFile,
  saveWorkspaceFile,
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
process.env.APP_ROOT = path.join(__dirname, '../..')

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
const preload = path.join(__dirname, '../preload/index.mjs')
const indexHtml = path.join(RENDERER_DIST, 'index.html')
const appStatePath = path.join(app.getPath('userData'), 'app-state.json')
const legacyWorkspaceSettingsPath = path.join(app.getPath('userData'), 'workspace-settings.json')
const appStateStore = new AppStateStore(appStatePath, legacyWorkspaceSettingsPath)
const agentManager = new PiAgentManager((event: AgentClientEvent) => {
  win?.webContents.send('agent:event', event)
})

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

  win = new BrowserWindow({
    title: 'AWA',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    backgroundColor: '#ffffff',
    frame: false,
    titleBarStyle: 'hidden',
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  void createWindow()
})

app.on('window-all-closed', () => {
  win = null
  agentManager.dispose()
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

ipcMain.handle('workspace:read-file', async (_, filePath: string) => {
  return loadWorkspaceFile(filePath)
})

ipcMain.handle('workspace:save-file', async (_, filePath: string, content: string) => {
  await saveWorkspaceFile(filePath, content)
  return { ok: true }
})

ipcMain.handle('workspace:create-file', async (_, rootPath: string, relativeFilePath: string) => {
  const filePath = await createWorkspaceFile(rootPath, relativeFilePath)
  return { filePath }
})

ipcMain.handle('workspace:rename-file', async (_, rootPath: string, filePath: string, nextRelativeFilePath: string) => {
  const nextFilePath = await renameWorkspaceFile(rootPath, filePath, nextRelativeFilePath)
  return { filePath: nextFilePath }
})

ipcMain.handle('workspace:delete-file', async (_, rootPath: string, filePath: string) => {
  await deleteWorkspaceFile(rootPath, filePath)
  return { ok: true }
})

ipcMain.handle('workspace:start-watch', async (_, rootPath: string) => {
  await watchWorkspace(rootPath, (event) => {
    win?.webContents.send('workspace:changed', event)
  })

  return { ok: true }
})

ipcMain.handle('workspace:stop-watch', async () => {
  await unwatchWorkspace()
  return { ok: true }
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

ipcMain.handle('agent:rename-session', async (_event, name: string) => {
  return agentManager.renameActiveSession(name)
})

ipcMain.handle('agent:send-prompt', async (_event, prompt: string) => {
  return agentManager.sendPrompt(prompt)
})

ipcMain.handle('agent:select-model', async (_event, modelKey: string) => {
  return agentManager.selectModel(modelKey)
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
  win?.close()
})

ipcMain.handle('window:is-maximized', () => {
  return { isMaximized: win?.isMaximized() ?? false }
})

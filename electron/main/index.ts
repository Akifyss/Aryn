import { Menu, app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import {
  createWorkspaceFile,
  deleteWorkspaceFile,
  loadWorkspaceFile,
  loadWorkspaceTree,
  renameWorkspaceFile,
  saveWorkspaceFile,
  unwatchWorkspace,
  watchWorkspace,
  workspacePathExists,
} from './workspace'
import { PiAgentManager } from './agent'
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
const workspaceSettingsPath = path.join(app.getPath('userData'), 'workspace-settings.json')
const agentManager = new PiAgentManager((event: AgentClientEvent) => {
  win?.webContents.send('agent:event', event)
})

type WorkspaceSettings = {
  lastWorkspacePath: string | null
}

async function readWorkspaceSettings(): Promise<WorkspaceSettings> {
  try {
    const raw = await readFile(workspaceSettingsPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<WorkspaceSettings>
    return {
      lastWorkspacePath: parsed.lastWorkspacePath ?? null,
    }
  } catch {
    return {
      lastWorkspacePath: null,
    }
  }
}

async function writeWorkspaceSettings(nextSettings: WorkspaceSettings) {
  await writeFile(workspaceSettingsPath, JSON.stringify(nextSettings, null, 2), 'utf8')
}

async function createWindow() {
  win = new BrowserWindow({
    title: 'AWA',
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    backgroundColor: '#ffffff',
    frame: false,
    titleBarStyle: 'hidden',
    autoHideMenuBar: true,
    minWidth: 1080,
    minHeight: 720,
    webPreferences: {
      preload,
      // Warning: Enable nodeIntegration and disable contextIsolation is not secure in production
      // nodeIntegration: true,

      // Consider using contextBridge.exposeInMainWorld
      // Read more on https://www.electronjs.org/docs/latest/tutorial/context-isolation
      // contextIsolation: false,
    },
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
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()
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
    createWindow()
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

  const selectedPath = result.filePaths[0]
  await writeWorkspaceSettings({ lastWorkspacePath: selectedPath })
  return selectedPath
})

ipcMain.handle('workspace:load-tree', async (_, rootPath: string) => {
  return loadWorkspaceTree(rootPath)
})

ipcMain.handle('workspace:get-last-directory', async () => {
  const settings = await readWorkspaceSettings()
  const lastWorkspacePath = settings.lastWorkspacePath

  if (!lastWorkspacePath) {
    return null
  }

  if (!(await workspacePathExists(lastWorkspacePath))) {
    await writeWorkspaceSettings({ lastWorkspacePath: null })
    return null
  }

  return lastWorkspacePath
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

ipcMain.handle('agent:load-workspace', async (_event, rootPath: string) => {
  return agentManager.loadWorkspaceState(rootPath)
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

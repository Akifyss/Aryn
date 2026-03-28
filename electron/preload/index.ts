import { ipcRenderer, contextBridge } from 'electron'
import type { WorkspaceChangeEvent, WorkspaceNode } from '../../src/features/workspace/types'

contextBridge.exposeInMainWorld('appApi', {
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick-directory') as Promise<string | null>,
  getLastWorkspace: () => ipcRenderer.invoke('workspace:get-last-directory') as Promise<string | null>,
  loadWorkspaceTree: (rootPath: string) => ipcRenderer.invoke('workspace:load-tree', rootPath) as Promise<WorkspaceNode[]>,
  readWorkspaceFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath) as Promise<string>,
  saveWorkspaceFile: (filePath: string, content: string) => ipcRenderer.invoke('workspace:save-file', filePath, content) as Promise<{ ok: boolean }>,
  createWorkspaceFile: (rootPath: string, relativeFilePath: string) => ipcRenderer.invoke('workspace:create-file', rootPath, relativeFilePath) as Promise<{ filePath: string }>,
  renameWorkspaceFile: (rootPath: string, filePath: string, nextRelativeFilePath: string) => ipcRenderer.invoke('workspace:rename-file', rootPath, filePath, nextRelativeFilePath) as Promise<{ filePath: string }>,
  deleteWorkspaceFile: (rootPath: string, filePath: string) => ipcRenderer.invoke('workspace:delete-file', rootPath, filePath) as Promise<{ ok: boolean }>,
  startWorkspaceWatch: (rootPath: string) => ipcRenderer.invoke('workspace:start-watch', rootPath) as Promise<{ ok: boolean }>,
  stopWorkspaceWatch: () => ipcRenderer.invoke('workspace:stop-watch') as Promise<{ ok: boolean }>,
  minimizeWindow: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<{ isMaximized: boolean }>,
  closeWindow: () => ipcRenderer.invoke('window:close') as Promise<void>,
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<{ isMaximized: boolean }>,
  onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: WorkspaceChangeEvent) => {
      listener(payload)
    }

    ipcRenderer.on('workspace:changed', wrappedListener)

    return () => {
      ipcRenderer.off('workspace:changed', wrappedListener)
    }
  },
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)

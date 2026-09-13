import { app, dialog, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { terminalIdentity, type TerminalOpenRequest, type TerminalRef, type TerminalViewRef } from '../../shared/contracts/terminal'
import { TerminalManager } from './terminal-manager'

export function registerTerminalIpc({ getWindow, projectPath }: {
  getWindow: () => BrowserWindow | null
  projectPath: (id: string) => Promise<string | null>
}) {
  const watched = new Set<number>()
  const manager = new TerminalManager({ projectPath, screenReaderEnabled: () => app.isAccessibilitySupportEnabled(), emit: (owner, event) => {
    const window = getWindow()
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.id === owner) {
      window.webContents.send('terminal:event', event)
    }
  } })
  const owner = (event: IpcMainInvokeEvent | IpcMainEvent) => {
    const window = getWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      throw new Error('终端请求来源无效。')
    }
    const id = event.sender.id
    if (!watched.has(id)) {
      watched.add(id)
      event.sender.once('destroyed', () => { manager.closeOwner(id); watched.delete(id) })
      event.sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) manager.detachOwner(id)
      })
      event.sender.on('render-process-gone', () => manager.detachOwner(id))
    }
    return id
  }
  ipcMain.handle('terminal:open', (event, request: TerminalOpenRequest) => manager.open(owner(event), request))
  ipcMain.handle('terminal:write', (event, request: TerminalRef & { data: string }) => manager.write(owner(event), request))
  ipcMain.handle('terminal:resize', (event, request: TerminalRef & { cols: number; rows: number }) => manager.resize(owner(event), request))
  ipcMain.on('terminal:acknowledge', (event, request: TerminalRef & { viewId: string; sequence: number }) => {
    try { manager.acknowledge(owner(event), request) } catch { /* Untrusted or late fire-and-forget event. */ }
  })
  ipcMain.on('terminal:detach', (event, request: TerminalViewRef) => {
    try { manager.detach(owner(event), request) } catch { /* Already detached or invalid sender. */ }
  })
  const closing = new Map<string, { action: 'close' | 'restart'; result: Promise<boolean> }>()
  ipcMain.handle('terminal:close', (event, id: string, action: 'close' | 'restart' = 'close') => {
    const ownerId = owner(event)
    terminalIdentity(id)
    if (action !== 'close' && action !== 'restart') throw new Error('终端操作无效。')
    const key = `${ownerId}:${id}`
    const pending = closing.get(key)
    // Duplicate clicks share their own result. Close and restart must not both
    // consume one approval: the renderer could otherwise reopen a removed tab.
    if (pending) return pending.action === action ? pending.result : Promise.resolve(false)
    const generation = manager.generation(ownerId, id)
    const close = (async () => {
      const activity = await manager.inspectClose(ownerId, id)
      const window = getWindow()
      if (!window || window.isDestroyed() || window.webContents.isDestroyed() || window.webContents.id !== ownerId
        || manager.generation(ownerId, id) !== generation) return false
      if (activity.status !== 'idle') {
        const verb = action === 'restart' ? '重新启动' : '关闭'
        const detail = activity.status === 'unknown'
          ? `暂时无法确认终端是否空闲。${verb}将结束此终端中可能仍在运行的任务。`
          : `${activity.processes.length ? `仍在运行：${activity.processes.join('、')}。\n` : ''}${verb}将中断此终端中的任务，并结束 shell 及其子进程。`
        const result = await dialog.showMessageBox(window, { type: 'warning', title: `${verb}终端`,
          message: activity.status === 'busy' ? `任务仍在运行，${verb}终端？` : `${verb}此终端？`, detail,
          buttons: ['取消', `${verb}终端`], defaultId: 0, cancelId: 0, noLink: true })
        if (result.response !== 1) return false
      }
      if (manager.generation(ownerId, id) !== generation) return false
      manager.close(ownerId, id)
      return true
    })().finally(() => closing.delete(key))
    closing.set(key, { action, result: close })
    return close
  })
  return manager
}

import { randomUUID } from 'node:crypto'
import { app, ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { terminalIdentity, type TerminalCloseAction, type TerminalCloseConfirmation, type TerminalOpenRequest, type TerminalRef, type TerminalViewRef } from '../../shared/contracts/terminal'
import { TerminalManager } from './terminal-manager'

export function registerTerminalIpc({ getWindow, projectPath }: {
  getWindow: () => BrowserWindow | null
  projectPath: (id: string) => Promise<string | null>
}) {
  const watched = new Set<number>()
  const closing = new Map<string, {
    ownerId: number
    requestId: string
    action: TerminalCloseAction
    result: Promise<boolean>
    cancel: () => void
    respond: (confirmed: boolean) => void
  }>()
  const cancelOwnerConfirmations = (ownerId: number) => {
    for (const [key, pending] of closing) {
      if (pending.ownerId !== ownerId) continue
      pending.cancel()
      closing.delete(key)
    }
  }
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
      event.sender.once('destroyed', () => { cancelOwnerConfirmations(id); manager.closeOwner(id); watched.delete(id) })
      event.sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) { cancelOwnerConfirmations(id); manager.detachOwner(id) }
      })
      event.sender.on('render-process-gone', () => { cancelOwnerConfirmations(id); manager.detachOwner(id) })
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
  ipcMain.on('terminal:confirm-close', (event, requestId: unknown, confirmed: unknown) => {
    try {
      const ownerId = owner(event)
      if (typeof requestId !== 'string' || typeof confirmed !== 'boolean') return
      for (const pending of closing.values()) {
        if (pending.ownerId === ownerId && pending.requestId === requestId) pending.respond(confirmed)
      }
    } catch { /* Untrusted or late fire-and-forget response. */ }
  })
  ipcMain.handle('terminal:close', (event, id: string, action: TerminalCloseAction = 'close') => {
    const ownerId = owner(event)
    terminalIdentity(id)
    if (action !== 'close' && action !== 'restart') throw new Error('终端操作无效。')
    const key = `${ownerId}:${id}`
    const pending = closing.get(key)
    // Duplicate clicks share their own result. Close and restart must not both
    // consume one approval: the renderer could otherwise reopen a removed tab.
    if (pending) return pending.action === action ? pending.result : Promise.resolve(false)
    const generation = manager.generation(ownerId, id)
    const requestId = randomUUID()
    let cancelled = false
    let respond: ((confirmed: boolean) => void) | undefined
    const currentWindow = () => {
      const window = getWindow()
      return !cancelled && window && !window.isDestroyed() && !window.webContents.isDestroyed()
        && window.webContents.id === ownerId && manager.generation(ownerId, id) === generation ? window : null
    }
    const close = (async () => {
      const activity = await manager.inspectClose(ownerId, id)
      const window = currentWindow()
      if (!window) return false
      if (activity.status !== 'idle') {
        const answer = new Promise<boolean>(resolve => { respond = resolve })
        window.webContents.send('terminal:close-confirmation', {
          requestId, action, status: activity.status, processes: activity.processes,
        } satisfies TerminalCloseConfirmation)
        if (!await answer) return false
      }
      if (!currentWindow()) return false
      manager.close(ownerId, id)
      return true
    })().finally(() => {
      // A reloaded renderer may already have started another request for this tab.
      if (closing.get(key)?.requestId === requestId) closing.delete(key)
    })
    closing.set(key, { ownerId, requestId, action, result: close,
      cancel: () => { cancelled = true; respond?.(false) },
      respond: confirmed => respond?.(confirmed),
    })
    return close
  })
  return manager
}

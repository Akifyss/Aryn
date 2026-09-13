import { beforeEach, expect, it, vi } from 'vitest'

const { handles, listeners, dialogs, instances } = vi.hoisted(() => ({
  handles: new Map<string, (...args: any[]) => any>(), listeners: new Map<string, (...args: any[]) => any>(),
  dialogs: vi.fn(), instances: [] as any[],
}))
vi.mock('electron', () => ({ app: { isAccessibilitySupportEnabled: () => false }, dialog: { showMessageBox: dialogs },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => handles.set(name, handler),
    on: (name: string, handler: (...args: any[]) => any) => listeners.set(name, handler) } }))
vi.mock('../electron/main/terminal/terminal-manager', () => ({ TerminalManager: class {
  incarnation = 'one'
  open = vi.fn(); write = vi.fn(); resize = vi.fn(); acknowledge = vi.fn(); detach = vi.fn(); detachOwner = vi.fn(); close = vi.fn(); closeOwner = vi.fn()
  inspectClose = vi.fn().mockResolvedValue({ status: 'busy', processes: ['node.exe'] })
  generation = () => this.incarnation
  constructor() { instances.push(this) }
} }))
import { registerTerminalIpc } from '../electron/main/terminal/register-terminal-ipc'

let sender: any, window: any, event: any
beforeEach(() => {
  handles.clear(); listeners.clear(); instances.length = 0; dialogs.mockReset()
  sender = { id: 1, mainFrame: {}, once: vi.fn(), on: vi.fn(), isDestroyed: () => false }
  window = { webContents: sender, isDestroyed: () => false }
  event = { sender, senderFrame: sender.mainFrame }
  registerTerminalIpc({ getWindow: () => window, projectPath: async () => '/project' })
})

it('rejects calls from peer contents and subframes before touching the manager', () => {
  const open = handles.get('terminal:open')!
  expect(() => open({ ...event, sender: { ...sender } }, {})).toThrow('来源无效')
  expect(() => open({ ...event, senderFrame: {} }, {})).toThrow('来源无效')
  expect(instances[0].open).not.toHaveBeenCalled()
  open(event, { id: 'terminal://test' })
  expect(instances[0].open).toHaveBeenCalledWith(1, { id: 'terminal://test' })
  sender.once.mock.calls[0][1]()
  expect(instances[0].closeOwner).toHaveBeenCalledWith(1)
})
it('detaches renderer subscriptions on main-frame reload or crash without closing shells', () => {
  handles.get('terminal:open')!(event, { id: 'terminal://test' })
  const navigation = sender.on.mock.calls.find(([name]: [string]) => name === 'did-start-navigation')[1]
  navigation({}, 'file:///app', false, false)
  navigation({}, 'file:///app', true, true)
  expect(instances[0].detachOwner).not.toHaveBeenCalled()
  navigation({}, 'file:///app', false, true)
  sender.on.mock.calls.find(([name]: [string]) => name === 'render-process-gone')[1]()
  expect(instances[0].detachOwner).toHaveBeenCalledTimes(2)
  expect(instances[0].closeOwner).not.toHaveBeenCalled()
})
it('deduplicates close dialogs, honors cancel, and closes on explicit confirmation', async () => {
  let resolve!: (answer: { response: number }) => void
  dialogs.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const close = handles.get('terminal:close')!
  const first = close(event, 'terminal://test')
  expect(close(event, 'terminal://test')).toBe(first)
  await vi.waitFor(() => expect(dialogs).toHaveBeenCalledOnce())
  resolve({ response: 0 })
  expect(await first).toBe(false)
  expect(instances[0].close).not.toHaveBeenCalled()
  dialogs.mockResolvedValueOnce({ response: 1 })
  expect(await close(event, 'terminal://test')).toBe(true)
  expect(instances[0].close).toHaveBeenCalledWith(1, 'terminal://test')
})
it('does not let a stale dialog close a replacement process', async () => {
  let resolve!: (answer: { response: number }) => void
  dialogs.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const pending = handles.get('terminal:close')!(event, 'terminal://test')
  await vi.waitFor(() => expect(dialogs).toHaveBeenCalledOnce())
  instances[0].incarnation = 'two'
  resolve({ response: 1 })
  expect(await pending).toBe(false)
  expect(instances[0].close).not.toHaveBeenCalled()
})
it('closes an idle or exited session without asking', async () => {
  instances[0].inspectClose.mockResolvedValue({ status: 'idle', processes: [] })
  expect(await handles.get('terminal:close')!(event, 'terminal://test')).toBe(true)
  expect(dialogs).not.toHaveBeenCalled()
  expect(instances[0].close).toHaveBeenCalledOnce()
})
it('uses accurate task names and keeps cancel as the default', async () => {
  dialogs.mockResolvedValue({ response: 0 })
  await handles.get('terminal:close')!(event, 'terminal://test')
  expect(dialogs.mock.calls[0][1]).toMatchObject({ type: 'warning', defaultId: 0, cancelId: 0,
    message: '任务仍在运行，关闭终端？', detail: expect.stringContaining('node.exe') })
})
it('explains an inconclusive probe without claiming a task is running', async () => {
  instances[0].inspectClose.mockResolvedValue({ status: 'unknown', processes: [] })
  dialogs.mockResolvedValue({ response: 0 })
  expect(await handles.get('terminal:close')!(event, 'terminal://test')).toBe(false)
  expect(dialogs.mock.calls[0][1]).toMatchObject({ message: '关闭此终端？', detail: expect.stringContaining('无法确认') })
  expect(instances[0].close).not.toHaveBeenCalled()
})
it('shares the probe across repeated clicks and rejects a replaced session before showing a dialog', async () => {
  let resolve!: (value: unknown) => void
  instances[0].inspectClose.mockReturnValue(new Promise(done => { resolve = done }))
  const close = handles.get('terminal:close')!
  const pending = close(event, 'terminal://test')
  expect(close(event, 'terminal://test')).toBe(pending)
  expect(instances[0].inspectClose).toHaveBeenCalledOnce()
  instances[0].incarnation = 'two'
  resolve({ status: 'busy', processes: ['node'] })
  expect(await pending).toBe(false)
  expect(dialogs).not.toHaveBeenCalled()
  expect(instances[0].close).not.toHaveBeenCalled()
})
it('does not show a dialog after the owning window is destroyed during a probe', async () => {
  const pending = handles.get('terminal:close')!(event, 'terminal://test')
  window.isDestroyed = () => true
  expect(await pending).toBe(false)
  expect(dialogs).not.toHaveBeenCalled()
})
it('uses the same protection with accurate wording for restart, and rejects unknown actions', async () => {
  dialogs.mockResolvedValue({ response: 0 })
  const close = handles.get('terminal:close')!
  expect(await close(event, 'terminal://test', 'restart')).toBe(false)
  expect(dialogs.mock.calls[0][1]).toMatchObject({ message: '任务仍在运行，重新启动终端？', buttons: ['取消', '重新启动终端'] })
  expect(() => close(event, 'terminal://test', 'force')).toThrow('操作无效')
  expect(instances[0].close).not.toHaveBeenCalled()
})
it.each([['close', 'restart'], ['restart', 'close']])('does not share a pending %s approval with %s', async (firstAction, secondAction) => {
  let resolve!: (answer: { response: number }) => void
  dialogs.mockReturnValueOnce(new Promise(done => { resolve = done }))
  const close = handles.get('terminal:close')!
  const first = close(event, 'terminal://test', firstAction)
  await vi.waitFor(() => expect(dialogs).toHaveBeenCalledOnce())
  expect(await close(event, 'terminal://test', secondAction)).toBe(false)
  resolve({ response: 1 })
  expect(await first).toBe(true)
  expect(instances[0].close).toHaveBeenCalledOnce()
})
it('does not throw on invalid asynchronous acknowledgements', () => {
  expect(() => listeners.get('terminal:acknowledge')!({ ...event, senderFrame: {} }, null)).not.toThrow()
  expect(instances[0].acknowledge).not.toHaveBeenCalled()
})

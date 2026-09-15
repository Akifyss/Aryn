import { beforeEach, expect, it, vi } from 'vitest'

const { handles, listeners, instances } = vi.hoisted(() => ({
  handles: new Map<string, (...args: any[]) => any>(), listeners: new Map<string, (...args: any[]) => any>(),
  instances: [] as any[],
}))
vi.mock('electron', () => ({ app: { isAccessibilitySupportEnabled: () => false },
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
const close = (id = 'terminal://test', action = 'close') => handles.get('terminal:close')!(event, id, action)
const respond = (requestId: unknown, confirmed: unknown, source = event) => listeners.get('terminal:confirm-close')!(source, requestId, confirmed)
const request = async (index = 0) => {
  await vi.waitFor(() => expect(sender.send.mock.calls.length).toBeGreaterThan(index))
  expect(sender.send.mock.calls[index][0]).toBe('terminal:close-confirmation')
  return sender.send.mock.calls[index][1]
}
const lifecycle = (name: string, ...args: unknown[]) => sender.on.mock.calls.find(([eventName]: [string]) => eventName === name)[1](...args)
beforeEach(() => {
  handles.clear(); listeners.clear(); instances.length = 0
  sender = { id: 1, mainFrame: {}, once: vi.fn(), on: vi.fn(), send: vi.fn(), isDestroyed: () => false }
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
  lifecycle('did-start-navigation', {}, 'file:///app', false, false)
  lifecycle('did-start-navigation', {}, 'file:///app', true, true)
  expect(instances[0].detachOwner).not.toHaveBeenCalled()
  lifecycle('did-start-navigation', {}, 'file:///app', false, true)
  lifecycle('render-process-gone')
  expect(instances[0].detachOwner).toHaveBeenCalledTimes(2)
  expect(instances[0].closeOwner).not.toHaveBeenCalled()
})
it('deduplicates close requests, honors cancel, and closes on explicit confirmation', async () => {
  const first = close()
  expect(close()).toBe(first)
  const firstRequest = await request()
  expect(firstRequest).toMatchObject({ action: 'close', status: 'busy', processes: ['node.exe'] })
  expect(instances[0].inspectClose).toHaveBeenCalledOnce()
  respond(firstRequest.requestId, false)
  expect(await first).toBe(false)
  expect(instances[0].close).not.toHaveBeenCalled()
  const second = close()
  const secondRequest = await request(1)
  expect(secondRequest.requestId).not.toBe(firstRequest.requestId)
  respond(secondRequest.requestId, true)
  expect(await second).toBe(true)
  expect(instances[0].close).toHaveBeenCalledWith(1, 'terminal://test')
})
it('does not let a stale confirmation close a replacement process', async () => {
  const pending = close()
  const { requestId } = await request()
  instances[0].incarnation = 'two'
  respond(requestId, true)
  expect(await pending).toBe(false)
  expect(instances[0].close).not.toHaveBeenCalled()
})
it('closes an idle or exited session without asking', async () => {
  instances[0].inspectClose.mockResolvedValue({ status: 'idle', processes: [] })
  expect(await close()).toBe(true)
  expect(sender.send).not.toHaveBeenCalled()
  expect(instances[0].close).toHaveBeenCalledOnce()
})
it('keeps an inconclusive probe distinct from a running task', async () => {
  instances[0].inspectClose.mockResolvedValue({ status: 'unknown', processes: [] })
  const pending = close()
  const prompt = await request()
  expect(prompt.status).toBe('unknown')
  respond(prompt.requestId, false)
  expect(await pending).toBe(false)
  expect(instances[0].close).not.toHaveBeenCalled()
})
it('rejects a replaced session before sending a confirmation', async () => {
  const pending = close()
  instances[0].incarnation = 'two'
  expect(await pending).toBe(false)
  expect(sender.send).not.toHaveBeenCalled()
  expect(instances[0].close).not.toHaveBeenCalled()
})
it('does not send a confirmation after the owning window is destroyed during a probe', async () => {
  const pending = close()
  window.isDestroyed = () => true
  expect(await pending).toBe(false)
  expect(sender.send).not.toHaveBeenCalled()
})
it('uses the same protection for restart and rejects unknown actions', async () => {
  const pending = close('terminal://test', 'restart')
  const prompt = await request()
  expect(prompt.action).toBe('restart')
  respond(prompt.requestId, false)
  expect(await pending).toBe(false)
  expect(() => close('terminal://test', 'force')).toThrow('操作无效')
  expect(instances[0].close).not.toHaveBeenCalled()
})
it.each([['close', 'restart'], ['restart', 'close']])('does not share a pending %s approval with %s', async (firstAction, secondAction) => {
  const first = close('terminal://test', firstAction)
  const prompt = await request()
  expect(await close('terminal://test', secondAction)).toBe(false)
  respond(prompt.requestId, true)
  expect(await first).toBe(true)
  expect(instances[0].close).toHaveBeenCalledOnce()
})
it('accepts only a boolean response with the pending token from the trusted main frame', async () => {
  const pending = close()
  const { requestId } = await request()
  respond('outdated-request', true)
  respond(requestId, 'true')
  respond(requestId, true, { ...event, sender: { ...sender } })
  respond(requestId, true, { ...event, senderFrame: {} })
  await Promise.resolve()
  expect(instances[0].close).not.toHaveBeenCalled()
  expect(close()).toBe(pending)
  respond(requestId, false)
  expect(await pending).toBe(false)
})
it('keeps confirmations for different terminals independent', async () => {
  const first = close()
  const second = close('terminal://peer')
  const firstRequest = await request()
  const secondRequest = await request(1)
  respond(firstRequest.requestId, false)
  respond(secondRequest.requestId, true)
  expect(await first).toBe(false)
  expect(await second).toBe(true)
  expect(instances[0].close).toHaveBeenCalledOnce()
  expect(instances[0].close).toHaveBeenCalledWith(1, 'terminal://peer')
})
it.each(['reload', 'crash', 'destroy'])('cancels pending confirmations on renderer %s', async reason => {
  const pending = close()
  const { requestId } = await request()
  if (reason === 'reload') lifecycle('did-start-navigation', {}, 'file:///app', false, true)
  else if (reason === 'crash') lifecycle('render-process-gone')
  else sender.once.mock.calls[0][1]()
  respond(requestId, true)
  expect(await pending).toBe(false)
  expect(instances[0].close).not.toHaveBeenCalled()
})
it('invalidates a probe on reload without deleting the new renderer request', async () => {
  let finishProbe!: (activity: unknown) => void
  instances[0].inspectClose.mockReturnValueOnce(new Promise(resolve => { finishProbe = resolve }))
  const oldRequest = close()
  lifecycle('did-start-navigation', {}, 'file:///app', false, true)
  const newRequest = close()
  const prompt = await request()
  finishProbe({ status: 'idle', processes: [] })
  expect(await oldRequest).toBe(false)
  expect(close()).toBe(newRequest)
  respond(prompt.requestId, true)
  expect(await newRequest).toBe(true)
  expect(instances[0].close).toHaveBeenCalledOnce()
})
it('rechecks the window after confirmation and releases failures for retry', async () => {
  const pending = close()
  const prompt = await request()
  respond(prompt.requestId, true)
  window.isDestroyed = () => true
  expect(await pending).toBe(false)
  expect(instances[0].close).not.toHaveBeenCalled()
  window.isDestroyed = () => false
  instances[0].inspectClose.mockRejectedValueOnce(new Error('probe failed'))
  await expect(close()).rejects.toThrow('probe failed')
  instances[0].inspectClose.mockResolvedValue({ status: 'idle', processes: [] })
  expect(await close()).toBe(true)
})
it('does not throw on invalid asynchronous acknowledgements', () => {
  expect(() => listeners.get('terminal:acknowledge')!({ ...event, senderFrame: {} }, null)).not.toThrow()
  expect(instances[0].acknowledge).not.toHaveBeenCalled()
})

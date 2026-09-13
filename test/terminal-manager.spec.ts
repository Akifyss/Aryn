import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IPty } from 'node-pty'
import { TerminalManager } from '../electron/main/terminal/terminal-manager'
import { terminalEnvironment } from '../electron/main/terminal/terminal-shell'
import { terminalSize, type TerminalEvent } from '../electron/shared/contracts/terminal'
import type { TerminalActivity } from '../electron/main/terminal/terminal-processes'

function fakePty() {
  let data: (text: string) => void = () => {}, exit: (event: { exitCode: number }) => void = () => {}
  const pty = { pid: 999999, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), pause: vi.fn(), resume: vi.fn(),
    onData: (fn: typeof data) => { data = fn; return { dispose: vi.fn() } },
    onExit: (fn: typeof exit) => { exit = fn; return { dispose: vi.fn() } } }
  return { pty: pty as unknown as IPty, data: (text: string) => data(text), exit: (code: number) => exit({ exitCode: code }) }
}
let manager: TerminalManager
let streams: ReturnType<typeof fakePty>[]
let events: TerminalEvent[]
let spawn: ReturnType<typeof vi.fn>
const request = { id: 'terminal://one', projectId: 'project', cols: 80, rows: 24, viewId: 'view-one' }
beforeEach(() => {
  streams = []; events = []
  spawn = vi.fn(() => { const stream = fakePty(); streams.push(stream); return stream.pty })
  manager = new TerminalManager({ projectPath: async () => process.cwd(), spawn,
    shell: async () => ({ file: 'shell', args: [], label: 'Shell' }), emit: (_owner, event) => events.push(event) })
})
afterEach(() => manager.dispose())

describe('terminal session ownership and lifecycle', () => {
  it('deduplicates concurrent creates and keeps one shell across reattachment', async () => {
    const [first, peer] = await Promise.all([manager.open(1, request), manager.open(1, request)])
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(first.generation).toBe(peer.generation)
    streams[0].data('hello\r\n世界\r\n')
    await vi.waitFor(() => expect(events.some(event => event.type === 'data')).toBe(true))
    const attached = await manager.open(1, request)
    expect(attached.screen).toContain('世界')
    expect(attached.sequence).toBe(1)
    expect(spawn).toHaveBeenCalledTimes(1)
  })
  it('never rebinds a tab to a different project or window', async () => {
    const first = await manager.open(1, request)
    await expect(manager.open(1, { ...request, projectId: 'other' })).rejects.toThrow('不属于')
    expect(() => manager.write(2, { ...first, data: 'secret' })).toThrow()
    const second = await manager.open(2, request)
    expect(second.generation).not.toBe(first.generation)
    manager.closeOwner(1)
    expect(streams[0].pty.kill).toHaveBeenCalledOnce()
    expect(streams[1].pty.kill).not.toHaveBeenCalled()
  })
  it('rejects late input and resize from the previous incarnation', async () => {
    const first = await manager.open(1, request)
    manager.close(1, first.id)
    const next = await manager.open(1, request)
    expect(next.generation).not.toBe(first.generation)
    expect(() => manager.write(1, { ...first, data: 'late' })).toThrow()
    expect(() => manager.resize(1, { ...first, cols: 100, rows: 30 })).toThrow()
    expect(streams[1].pty.write).not.toHaveBeenCalled()
  })
  it('cancels creation before shell resolution without leaking a process', async () => {
    let resolve!: (value: string) => void
    const projectPath = new Promise<string>(done => { resolve = done })
    manager.dispose()
    manager = new TerminalManager({ projectPath: () => projectPath, spawn, emit: () => {} })
    const pending = manager.open(1, request)
    const rejected = expect(pending).rejects.toThrow('已关闭')
    manager.close(1, request.id)
    resolve(process.cwd())
    await rejected
    expect(spawn).not.toHaveBeenCalled()
  })
  it('settles an in-flight parser snapshot if its terminal closes', async () => {
    await manager.open(1, request)
    const attached = manager.open(1, request)
    const rejected = expect(attached).rejects.toThrow('已关闭')
    await Promise.resolve()
    manager.close(1, request.id)
    await rejected
  })
  it('cleans up on project removal including background terminals', async () => {
    await manager.open(1, request)
    await manager.open(1, { ...request, id: 'terminal://two', projectId: 'other' })
    manager.closeProject('project')
    expect(streams[0].pty.kill).toHaveBeenCalledOnce()
    expect(streams[1].pty.kill).not.toHaveBeenCalled()
  })
  it('retains final output and exit status until explicitly closed', async () => {
    const opened = await manager.open(1, request)
    streams[0].data('last output\r\n')
    streams[0].exit(7)
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('exit'))
    expect(events.map(event => event.type)).toEqual(['data', 'exit'])
    const restored = await manager.open(1, request)
    expect(restored).toMatchObject({ generation: opened.generation, status: 'exited', exitCode: 7 })
    expect(restored.screen).toContain('last output')
    expect(() => manager.write(1, { ...opened, data: 'x' })).toThrow('已退出')
  })
  it('validates directory existence and allows retry after creation failure', async () => {
    manager.dispose()
    const root = vi.fn().mockResolvedValueOnce('/aryn-directory-that-does-not-exist').mockResolvedValue(process.cwd())
    manager = new TerminalManager({ projectPath: root, spawn, shell: async () => ({ file: 'shell', args: [], label: 'Shell' }), emit: () => {} })
    await expect(manager.open(1, request)).rejects.toThrow('目录不存在')
    await expect(manager.open(1, request)).resolves.toMatchObject({ status: 'running' })
    expect(spawn).toHaveBeenCalledOnce()
  })
})

describe('terminal close activity', () => {
  let probe: ReturnType<typeof vi.fn>
  const idle: TerminalActivity = { status: 'idle', processes: [] }
  const busy: TerminalActivity = { status: 'busy', processes: ['node'] }
  const mark = (status: 'idle' | 'busy', nonce?: string) => {
    const script = Buffer.from(spawn.mock.calls[0][1].at(-1), 'base64').toString('utf16le')
    const token = nonce ?? script.match(/633;Aryn;([^;]+);/)![1]
    const sequence = `\x1b]633;Aryn;${token};${status}\x07`
    streams[0].data(sequence.slice(0, 15))
    streams[0].data(sequence.slice(15))
  }
  beforeEach(() => {
    manager.dispose()
    probe = vi.fn().mockResolvedValue(idle)
    manager = new TerminalManager({ projectPath: async () => process.cwd(), spawn, inspectProcesses: probe,
      shell: async () => ({ file: 'pwsh', args: ['-NoLogo'], label: 'PowerShell' }), emit: (_owner, event) => events.push(event) })
  })
  it('closes a ready shell directly and keeps markers out of restored screen content', async () => {
    await manager.open(1, request)
    mark('idle')
    expect(await manager.inspectClose(1, request.id)).toEqual(idle)
    expect((await manager.open(1, request)).screen).not.toContain('Aryn')
  })
  it('protects builtins even without children, and protects background children at the prompt', async () => {
    await manager.open(1, request)
    mark('busy')
    expect((await manager.inspectClose(1, request.id)).status).toBe('busy')
    mark('idle')
    probe.mockResolvedValue(busy)
    expect(await manager.inspectClose(1, request.id)).toEqual(busy)
  })
  it('never assumes idle before shell readiness or when hooks/probes are unavailable', async () => {
    await manager.open(1, request)
    expect((await manager.inspectClose(1, request.id)).status).toBe('unknown')
    mark('idle', 'some-other-session')
    expect((await manager.inspectClose(1, request.id)).status).toBe('unknown')
    mark('idle')
    probe.mockRejectedValue(new Error('permission denied'))
    expect((await manager.inspectClose(1, request.id)).status).toBe('unknown')
  })
  it('invalidates idle immediately on Enter, before shell execution output arrives', async () => {
    const ref = await manager.open(1, request)
    mark('idle')
    await manager.inspectClose(1, request.id)
    manager.write(1, { ...ref, data: 'Start-Sleep 30\r' })
    expect((await manager.inspectClose(1, request.id)).status).toBe('unknown')
    mark('busy')
    expect((await manager.inspectClose(1, request.id)).status).toBe('busy')
    mark('idle') // Includes cancellation or a command finishing normally.
    expect(await manager.inspectClose(1, request.id)).toEqual(idle)
  })
  it('refreshes the process snapshot if a command ends during the probe', async () => {
    await manager.open(1, request)
    mark('busy')
    probe.mockImplementationOnce(async () => { mark('idle'); return idle }).mockResolvedValueOnce(busy)
    expect(await manager.inspectClose(1, request.id)).toEqual(busy)
    expect(probe).toHaveBeenCalledTimes(2)
  })
  it('discards a busy process snapshot when the command has since returned to its prompt', async () => {
    await manager.open(1, request)
    mark('busy')
    probe.mockImplementationOnce(async () => { mark('idle'); return busy }).mockResolvedValueOnce(idle)
    expect(await manager.inspectClose(1, request.id)).toEqual(idle)
    expect(probe).toHaveBeenCalledTimes(2)
  })
  it('bounds retries if input keeps arriving while probing', async () => {
    const ref = await manager.open(1, request)
    mark('idle')
    probe.mockImplementation(async () => { manager.write(1, { ...ref, data: 'x' }); return idle })
    expect((await manager.inspectClose(1, request.id)).status).toBe('unknown')
    expect(probe).toHaveBeenCalledTimes(2)
  })
  it('does not warn about an already exited process when its probe completes late', async () => {
    await manager.open(1, request)
    probe.mockImplementationOnce(async () => { streams[0].exit(0); return busy })
    expect(await manager.inspectClose(1, request.id)).toEqual(idle)
  })
  it('settles and cancels a pending probe when the owner closes', async () => {
    await manager.open(1, request)
    probe.mockImplementation(() => new Promise(() => {}))
    const pending = manager.inspectClose(1, request.id)
    await vi.waitFor(() => expect(probe).toHaveBeenCalledOnce())
    manager.closeOwner(1)
    expect(await pending).toEqual(idle)
    expect(probe.mock.calls[0][1].aborted).toBe(true)
  })
  it('lets a not-yet-started or nonexistent terminal close without probing', async () => {
    expect(await manager.inspectClose(1, request.id)).toEqual(idle)
    manager.dispose()
    manager = new TerminalManager({ projectPath: () => new Promise(() => {}), spawn, inspectProcesses: probe, emit: () => {} })
    const pending = manager.open(1, request)
    const rejected = expect(pending).rejects.toThrow('已关闭')
    expect(await manager.inspectClose(1, request.id)).toEqual(idle)
    manager.close(1, request.id)
    await rejected
    expect(probe).not.toHaveBeenCalled()
  })
})

describe('terminal stream and bounds', () => {
  it('contains a ConPTY resize failure that arrives from the asynchronous output queue', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const opened = await manager.open(1, request)
      vi.mocked(streams[0].pty.resize).mockImplementationOnce(() => { throw new Error('Cannot resize a pty that has already exited') })
      streams[0].data('final output\r\n')
      manager.resize(1, { ...opened, cols: 90, rows: 25 })
      await vi.waitFor(() => expect(events.some(event => event.type === 'error')).toBe(true))
      streams[0].exit(0)
      expect(await manager.open(1, request)).toMatchObject({ status: 'exited', exitCode: 0 })
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: '无法调整终端尺寸。' }))
    } finally { warning.mockRestore() }
  })
  it('contains late protocol replies to a closed native PTY', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await manager.open(1, request)
      vi.mocked(streams[0].pty.write).mockImplementationOnce(() => { throw new Error('PTY closed') })
      streams[0].data('\x1b[6n')
      await vi.waitFor(() => expect(events.some(event => event.type === 'error')).toBe(true))
      expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: '无法向终端发送协议回复。' }))
    } finally { warning.mockRestore() }
  })
  it('keeps a detached background process flowing with bounded headless history', async () => {
    const opened = await manager.open(1, request)
    streams[0].data('x'.repeat(600 * 1024))
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('data'))
    expect(streams[0].pty.pause).toHaveBeenCalledOnce()
    manager.detachOwner(1) // Renderer reloads while another project is visible.
    expect(streams[0].pty.resume).toHaveBeenCalledOnce()
    streams[0].data('background\r\n'.repeat(60000) + 'BACKGROUND_DONE\r\n')
    streams[0].exit(0)
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('exit'))
    const reattached = await manager.open(1, { ...request, viewId: 'view-two' })
    expect(reattached).toMatchObject({ generation: opened.generation, status: 'exited', exitCode: 0 })
    expect(reattached.screen).toContain('BACKGROUND_DONE')
    expect(reattached.screen.split('\n').length).toBeLessThanOrEqual(5025)
    expect(streams[0].pty.kill).not.toHaveBeenCalled()
  })
  it('ignores stale view detach and acknowledgements after reattachment', async () => {
    const opened = await manager.open(1, request)
    await manager.open(1, { ...request, viewId: 'view-two' })
    manager.detach(1, { id: request.id, viewId: 'view-one' })
    streams[0].data('x'.repeat(600 * 1024))
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('data'))
    manager.acknowledge(1, { ...opened, viewId: 'view-one', sequence: 1 })
    expect(streams[0].pty.resume).not.toHaveBeenCalled()
    manager.acknowledge(1, { ...opened, viewId: 'view-two', sequence: 1 })
    expect(streams[0].pty.resume).toHaveBeenCalledOnce()
  })
  it('orders pending old-grid output, resize, and new-grid output in one stream', async () => {
    const opened = await manager.open(1, request)
    streams[0].data('old-grid\r\n')
    manager.resize(1, { ...opened, cols: 30, rows: 10 })
    streams[0].data('new-grid\r\n')
    await vi.waitFor(() => expect(events).toHaveLength(3))
    expect(events.map(event => event.type)).toEqual(['data', 'resize', 'data'])
    expect(events).toEqual([
      expect.objectContaining({ sequence: 1, data: 'old-grid\r\n' }),
      expect.objectContaining({ sequence: 2, cols: 30, rows: 10 }),
      expect.objectContaining({ sequence: 3, data: 'new-grid\r\n' }),
    ])
    expect(await manager.open(1, request)).toMatchObject({ cols: 30, rows: 10, sequence: 3 })
  })
  it('pauses on slow consumers and resumes after parsing acknowledgement', async () => {
    const opened = await manager.open(1, request)
    streams[0].data('x'.repeat(600 * 1024))
    expect(streams[0].pty.pause).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(events.at(-1)?.type).toBe('data'))
    expect(streams[0].pty.resume).not.toHaveBeenCalled()
    manager.acknowledge(1, { ...opened, viewId: request.viewId, sequence: 999999 })
    expect(streams[0].pty.resume).not.toHaveBeenCalled()
    manager.acknowledge(1, { ...opened, viewId: request.viewId, sequence: 1 })
    expect(streams[0].pty.resume).toHaveBeenCalledOnce()
  })
  it('restores bounded parsed screen state without replaying historical queries', async () => {
    await manager.open(1, request)
    streams[0].data('\x1b[31mred\x1b[0m\r\n\x1b[6n' + 'line\r\n'.repeat(6000) + 'tail')
    await vi.waitFor(() => expect(events.some(event => event.type === 'data')).toBe(true))
    const attached = await manager.open(1, request)
    expect(attached.screen).not.toContain('\x1b[6n')
    expect(attached.screen).toContain('tail')
    expect(attached.screen.split('\n').length).toBeLessThanOrEqual(5025)
    expect(streams[0].pty.write).toHaveBeenCalledTimes(1) // Live query only; snapshot never repeats it.
    expect(streams[0].pty.write).toHaveBeenCalledWith(expect.stringMatching(/^\x1b\[\d+;\d+R$/))
  })
  it('ignores disposed process output and duplicate acknowledgements', async () => {
    const opened = await manager.open(1, request)
    manager.close(1, request.id)
    streams[0].data('late'); streams[0].exit(0)
    manager.acknowledge(1, { ...opened, viewId: request.viewId, sequence: 1 })
    expect(events.map(event => event.type)).toEqual(['closed'])
  })
  it('validates input and grid limits and skips redundant resize', async () => {
    const opened = await manager.open(1, request)
    expect(() => manager.write(1, { ...opened, data: 'x'.repeat(65537) })).toThrow('过长')
    expect(() => manager.resize(1, { ...opened, cols: 0, rows: 30 })).toThrow()
    manager.resize(1, { ...opened, cols: 80, rows: 24 })
    expect(streams[0].pty.resize).not.toHaveBeenCalled()
    manager.resize(1, { ...opened, cols: 100, rows: 40 })
    expect(streams[0].pty.resize).toHaveBeenCalledWith(100, 40)
    expect(terminalSize(2, 1)).toEqual({ cols: 2, rows: 1 })
  })
  it('does not leak host IPC, Electron or debug environment to commands', () => {
    expect(terminalEnvironment({ PATH: '/bin', HOME: '/home/a', ELECTRON_RUN_AS_NODE: '1', NODE_CHANNEL_FD: '4',
      NODE_OPTIONS: '--inspect', ARYN_HOME: '/private', CUSTOM: 'keep', BASH_ENV: '/host/inject' }))
      .toEqual({ PATH: '/bin', HOME: '/home/a', CUSTOM: 'keep', TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Aryn' })
  })
})

import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { release } from 'node:os'
import type { IPty } from 'node-pty'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { SerializeAddon } from '@xterm/addon-serialize'
import { TERMINAL_MAX_INPUT, TERMINAL_MAX_SESSIONS, TERMINAL_SCROLLBACK, terminalIdentity, terminalSize,
  type TerminalEvent, type TerminalPayload, type TerminalOpenRequest, type TerminalRef, type TerminalViewRef, type TerminalSnapshot } from '../../shared/contracts/terminal'
import { resolveTerminalShell, terminalEnvironment } from './terminal-shell'
import { inspectTerminalProcesses, unknownActivity, type TerminalActivity } from './terminal-processes'
import { TerminalShellActivity } from './terminal-shell-activity'
import { prepareZshIntegration } from './terminal-zsh-integration'

const require = createRequire(import.meta.url)
const HIGH_WATER = 512 * 1024
const LOW_WATER = 128 * 1024
const WINDOWS_PTY = process.platform === 'win32'
  ? { backend: 'conpty' as const, buildNumber: Number(release().split('.')[2]) || 0 } : undefined
type PendingOutput = { type: 'data'; data: string } | { type: 'resize'; cols: number; rows: number }
type Session = {
  id: string; projectId: string; owner: number; generation: string; disposed: boolean
  ready: Promise<void>; pty?: IPty; terminal?: HeadlessTerminal; serializer?: SerializeAddon
  cancellation: AbortController
  activity: TerminalShellActivity
  viewId: string | null
  cwd: string; shell: string; sequence: number; exitCode: number | null
  pendingExit: number | null; output: PendingOutput[]; queued: number; writing: boolean
  unacknowledged: Map<number, number>; outstanding: number; paused: boolean
  timer?: ReturnType<typeof setTimeout>
  subscriptions: Array<{ dispose: () => void }>
}
type Dependencies = {
  projectPath: (projectId: string) => Promise<string | null>
  emit: (owner: number, event: TerminalEvent) => void
  spawn?: (file: string, args: string[], options: Parameters<typeof import('node-pty').spawn>[2]) => IPty
  shell?: typeof resolveTerminalShell
  screenReaderEnabled?: () => boolean
  inspectProcesses?: typeof inspectTerminalProcesses
}

/** Owns PTYs and their bounded screen state. UI visibility never owns a process. */
export class TerminalManager {
  private sessions = new Map<string, Session>()
  constructor(private readonly dependencies: Dependencies) {}
  private key(owner: number, id: string) { return `${owner}:${terminalIdentity(id)}` }
  private active(session: Session) {
    if (session.disposed) throw session.cancellation.signal.reason ?? new Error('终端已关闭。')
  }
  private async whileAlive<T>(session: Session, work: Promise<T>): Promise<T> {
    this.active(session)
    let abort!: () => void
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => reject(session.cancellation.signal.reason)
      session.cancellation.signal.addEventListener('abort', abort, { once: true })
    })
    try { return await Promise.race([work, cancelled]) }
    finally { session.cancellation.signal.removeEventListener('abort', abort) }
  }

  async open(owner: number, request: TerminalOpenRequest): Promise<TerminalSnapshot> {
    const key = this.key(owner, request.id)
    terminalIdentity(request.projectId)
    if (request.viewId !== undefined) terminalIdentity(request.viewId)
    const size = terminalSize(request.cols, request.rows)
    let session = this.sessions.get(key)
    if (session && session.projectId !== request.projectId) throw new Error('终端不属于此项目。')
    if (!session) {
      if (this.sessions.size >= TERMINAL_MAX_SESSIONS) throw new Error(`最多打开 ${TERMINAL_MAX_SESSIONS} 个终端，请先关闭不用的终端。`)
      session = { id: request.id, projectId: request.projectId, owner, generation: randomUUID(), disposed: false, cancellation: new AbortController(),
        ready: Promise.resolve(), activity: new TerminalShellActivity(), viewId: null, cwd: '', shell: '', sequence: 0, exitCode: null, pendingExit: null,
        output: [], queued: 0, writing: false, unacknowledged: new Map(), outstanding: 0, paused: false, subscriptions: [] }
      this.sessions.set(key, session) // Reserve before any await: close can cancel creation.
      session.ready = this.start(session, size).catch(error => {
        this.destroy(session!, error)
        if (this.sessions.get(key) === session) this.sessions.delete(key)
        throw error
      })
    }
    if (request.viewId !== undefined) {
      session.viewId = request.viewId
      this.resetAcknowledgements(session)
    }
    await this.whileAlive(session, session.ready)
    this.active(session)
    // A parser barrier gives one coherent screen/sequence. Subsequent live output
    // may cross the IPC reply; the renderer subscribes first and filters by sequence.
    await this.whileAlive(session, new Promise<void>(resolve => session!.terminal!.write('', resolve)))
    this.active(session)
    const screen = session.serializer!.serialize({ scrollback: TERMINAL_SCROLLBACK })
    if (request.viewId === session.viewId) this.resetAcknowledgements(session)
    return { id: session.id, generation: session.generation, projectId: session.projectId, cwd: session.cwd, shell: session.shell,
      sequence: session.sequence, cols: session.terminal!.cols, rows: session.terminal!.rows,
      screen, screenReaderMode: this.dependencies.screenReaderEnabled?.() ?? false,
      windowsPty: WINDOWS_PTY,
      status: session.exitCode === null ? 'running' : 'exited', exitCode: session.exitCode }
  }

  private async start(session: Session, size: { cols: number; rows: number }) {
    const cwd = await this.dependencies.projectPath(session.projectId)
    this.active(session)
    if (!cwd || !await stat(cwd).then(value => value.isDirectory(), () => false)) throw new Error('项目目录不存在，请检查目录后重试。')
    let env = terminalEnvironment()
    const shell = await (this.dependencies.shell ?? resolveTerminalShell)(env)
    this.active(session)
    const integration = await prepareZshIntegration(shell.file, shell.args, env, session.activity.nonce).catch(error => {
      // Shell integration is optional: a read-only/full temp directory must not
      // prevent the shell from opening. Missing readiness stays conservatively unknown.
      console.warn('[terminal] Unable to prepare zsh activity detection.', error)
      return null
    })
    if (integration) {
      if (session.disposed) await integration.dispose()
      else {
        env = integration.env
        session.subscriptions.push(integration)
      }
    }
    this.active(session)
    // CJS entry points also work when this manager is bundled as Electron ESM.
    const { Terminal } = require('@xterm/headless') as typeof import('@xterm/headless')
    const { SerializeAddon: Serializer } = require('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')
    const terminal = new Terminal({ ...size, scrollback: TERMINAL_SCROLLBACK, allowProposedApi: true, windowsPty: WINDOWS_PTY })
    const serializer = new Serializer()
    // SerializeAddon uses only the buffer API shared by headless and browser terminals.
    terminal.loadAddon(serializer as unknown as import('@xterm/headless').ITerminalAddon)
    session.subscriptions.push(terminal.parser.registerOscHandler(633, data => session.activity.onOsc(data)))
    Object.assign(session, { terminal, serializer, cwd, shell: shell.label })
    const spawn = this.dependencies.spawn ?? (require('node-pty') as typeof import('node-pty')).spawn
    const pty = spawn(shell.file, session.activity.launchArgs(shell.file, shell.args), { ...size, cwd, env, name: 'xterm-256color',
      // Use node-pty's matching redistributable. It closes the pseudoconsole
      // directly instead of racing a separate AttachConsole helper during quit.
      ...(process.platform === 'win32' ? { useConptyDll: true } : {}) })
    session.pty = pty
    session.subscriptions.push(terminal.onData(data => {
      if (!session.disposed && session.pendingExit === null) this.ptyAction(session, () => pty.write(data), '无法向终端发送协议回复。')
    }), pty.onData(data => this.enqueue(session, data)), pty.onExit(({ exitCode }) => {
      session.pendingExit = exitCode
      this.flush(session)
    }))
  }

  private enqueue(session: Session, data: string) {
    if (session.disposed || !data) return
    const last = session.output.at(-1)
    if (last?.type === 'data') last.data += data
    else session.output.push({ type: 'data', data })
    session.queued += data.length
    this.flow(session)
    if (!session.timer) session.timer = setTimeout(() => { session.timer = undefined; this.flush(session) }, 8)
  }

  private flush(session: Session) {
    if (session.disposed || session.writing) return
    if (session.timer) { clearTimeout(session.timer); session.timer = undefined }
    let next = session.output.shift()
    // Grid changes share the output stream: parse old-grid bytes before resizing,
    // then notify the view before ConPTY can emit its new-grid redraw.
    while (next?.type === 'resize') {
      session.terminal!.resize(next.cols, next.rows)
      this.emit(session, { ...next, sequence: ++session.sequence })
      if (session.pendingExit === null) {
        const { cols, rows } = next
        this.ptyAction(session, () => session.pty!.resize(cols, rows), '无法调整终端尺寸。')
      }
      next = session.output.shift()
    }
    if (!next) {
      if (session.pendingExit !== null && session.exitCode === null) {
        session.exitCode = session.pendingExit
        this.emit(session, { type: 'exit', exitCode: session.exitCode })
      }
      return
    }
    const data = next.data
    session.writing = true
    session.terminal!.write(data, () => {
      if (session.disposed) return
      session.writing = false
      session.queued -= data.length
      session.sequence++
      if (session.viewId !== null) {
        session.unacknowledged.set(session.sequence, data.length)
        session.outstanding += data.length
      }
      this.emit(session, { type: 'data', sequence: session.sequence, data })
      this.flow(session)
      this.flush(session)
    })
  }

  private emit(session: Session, event: TerminalPayload) {
    if (session.viewId === null && (event.type === 'data' || event.type === 'resize')) return
    this.dependencies.emit(session.owner, { ...event, id: session.id, generation: session.generation })
  }

  private ptyAction(session: Session, action: () => void, message: string) {
    try { action() }
    catch (error) {
      // ConPTY can reject I/O before onExit reaches us. These callbacks run
      // outside the IPC promise; uncaught errors would terminate the whole app.
      console.warn('[terminal]', message, error)
      this.emit(session, { type: 'error', message })
    }
  }

  private flow(session: Session) {
    if (!session.pty || session.disposed || session.pendingExit !== null) return
    const size = session.queued + session.outstanding
    if (size > HIGH_WATER && !session.paused) { session.pty.pause(); session.paused = true }
    else if (size < LOW_WATER && session.paused) { session.pty.resume(); session.paused = false }
  }

  private resolve(owner: number, reference: TerminalRef) {
    const session = this.sessions.get(this.key(owner, reference.id))
    if (!session || session.disposed || session.generation !== reference.generation) throw new Error('终端会话已结束或已重新启动。')
    return session
  }

  write(owner: number, request: TerminalRef & { data: string }) {
    const session = this.resolve(owner, request)
    if (typeof request.data !== 'string' || request.data.length > TERMINAL_MAX_INPUT) throw new Error('终端输入过长。')
    if (!session.pty || session.pendingExit !== null) throw new Error('终端已退出，请重新启动。')
    session.activity.onInput(request.data)
    session.pty.write(request.data)
  }

  resize(owner: number, request: TerminalRef & { cols: number; rows: number }) {
    const session = this.resolve(owner, request)
    const { cols, rows } = terminalSize(request.cols, request.rows)
    const pending = [...session.output].reverse().find(item => item.type === 'resize')
    const size = pending ?? session.terminal
    if (size?.cols === cols && size.rows === rows) return
    // Coalesce adjacent resize requests, but never skip over intervening bytes.
    if (session.output.at(-1)?.type === 'resize') session.output.pop()
    session.output.push({ type: 'resize', cols, rows })
    this.flush(session)
  }

  acknowledge(owner: number, request: TerminalRef & { viewId: string; sequence: number }) {
    // Late acknowledgements from a disposed view are harmless.
    const session = this.sessions.get(this.key(owner, request.id))
    if (!session || session.generation !== request.generation || session.viewId !== request.viewId
      || !Number.isInteger(request.sequence) || request.sequence > session.sequence) return
    for (const [sequence, length] of session.unacknowledged) {
      if (sequence > request.sequence) break
      session.outstanding -= length
      session.unacknowledged.delete(sequence)
    }
    this.flow(session)
  }

  private resetAcknowledgements(session: Session) {
    session.unacknowledged.clear()
    session.outstanding = 0
    this.flow(session)
  }

  detach(owner: number, request: TerminalViewRef) {
    const session = this.sessions.get(this.key(owner, request.id))
    if (!session || session.viewId !== request.viewId) return
    session.viewId = null
    this.resetAcknowledgements(session)
  }

  detachOwner(owner: number) {
    for (const session of this.sessions.values()) if (session.owner === owner) {
      session.viewId = null
      this.resetAcknowledgements(session)
    }
  }

  async inspectClose(owner: number, id: string): Promise<TerminalActivity> {
    const session = this.sessions.get(this.key(owner, id))
    const finished = () => !session || session.disposed || session.pendingExit !== null || !session.pty
    const idle: TerminalActivity = { status: 'idle', processes: [] }
    if (!session || finished()) return idle // Includes creation that has not spawned a PTY yet.
    const drain = async () => {
      this.flush(session)
      await this.whileAlive(session, new Promise<void>(resolve => session.terminal!.write('', resolve)))
    }
    try {
      // Recheck once if input or a command boundary changed during the OS scan.
      // An unbounded retry would make a noisy/interactive terminal impossible to close.
      for (let attempt = 0; attempt < 2; attempt++) {
        await drain()
        if (finished()) return idle
        const revision = session.activity.revision
        const processes = await this.whileAlive(session,
          (this.dependencies.inspectProcesses ?? inspectTerminalProcesses)(session.pty!.pid, session.cancellation.signal))
        await drain()
        if (finished()) return idle
        if (revision !== session.activity.revision) continue
        if (processes.status === 'busy') return processes
        if (session.activity.status === 'busy') return { status: 'busy', processes: [] }
        if (processes.status === 'unknown') return processes
        // Absence of children alone cannot prove a shell is idle: builtins and
        // scripts can execute in-process. Unsupported/disabled hooks stay unknown.
        return session.activity.status === 'idle' ? idle : unknownActivity()
      }
    } catch {
      if (finished()) return idle
    }
    return unknownActivity()
  }

  generation(owner: number, id: string) { return this.sessions.get(this.key(owner, id))?.generation }

  close(owner: number, id: string) {
    const key = this.key(owner, id)
    const session = this.sessions.get(key)
    if (!session) return
    this.destroy(session)
    this.sessions.delete(key)
    this.emit(session, { type: 'closed' })
  }

  private destroy(session: Session, reason: unknown = new Error('终端已关闭。')) {
    if (session.disposed) return
    session.disposed = true
    session.cancellation.abort(reason)
    if (session.timer) clearTimeout(session.timer)
    session.subscriptions.forEach(subscription => subscription.dispose())
    try { if (session.pendingExit === null) session.pty?.kill() } catch (error) { console.warn('[terminal] Failed to terminate PTY.', error) }
    session.terminal?.dispose()
    session.output = []
    session.unacknowledged.clear()
  }

  closeProject(projectId: string) {
    for (const session of this.sessions.values()) if (session.projectId === projectId) this.close(session.owner, session.id)
  }
  closeOwner(owner: number) {
    for (const session of this.sessions.values()) if (session.owner === owner) this.close(owner, session.id)
  }
  dispose() { for (const session of this.sessions.values()) this.close(session.owner, session.id) }
}

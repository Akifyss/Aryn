import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import spawn from 'cross-spawn'
import { terminateChildProcessTree } from './child-process-lifecycle'
import { createExternalCliEnvironment, resolveExternalCliCommand } from './external-cli-environment'

type JsonRecord = Record<string, unknown>

type JsonLineProcessOptions = {
  args: string[]
  command: string
  cwd?: string
  env?: NodeJS.ProcessEnv
  maxProtocolLineLength?: number
  onEvent: (message: JsonRecord) => void
  onExit?: (error: Error) => void
}

type PendingRequest = {
  reject: (error: Error) => void
  resolve: (message: JsonRecord) => void
  timeout: NodeJS.Timeout
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_MAX_PROTOCOL_LINE_LENGTH = 64 * 1024 * 1024

function formatProtocolError(value: unknown, fallback: string) {
  if (value instanceof Error) return value.message
  if (value && typeof value === 'object') {
    const candidate = value as JsonRecord
    if (typeof candidate.message === 'string') return candidate.message
    if (candidate.data && typeof candidate.data === 'object') {
      const data = candidate.data as JsonRecord
      if (typeof data.message === 'string') return data.message
    }
    try {
      return JSON.stringify(value)
    } catch {
      return fallback
    }
  }
  return value === undefined || value === null ? fallback : String(value)
}

function asError(value: unknown, fallback: string) {
  return value instanceof Error ? value : new Error(formatProtocolError(value, fallback))
}

export class JsonLineProcess {
  private buffer = ''
  private child: ChildProcessWithoutNullStreams | null = null
  private discardingOversizedLine = false
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private stderr = ''
  private terminalError: Error | null = null

  constructor(private readonly options: JsonLineProcessOptions) {}

  private get maxProtocolLineLength() {
    const configured = this.options.maxProtocolLineLength
    return typeof configured === 'number' && Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : DEFAULT_MAX_PROTOCOL_LINE_LENGTH
  }

  start() {
    if (this.child) {
      return
    }
    if (this.terminalError) {
      throw this.terminalError
    }

    this.buffer = ''
    this.discardingOversizedLine = false
    this.stderr = ''
    const environment = createExternalCliEnvironment(this.options.env)
    const command = resolveExternalCliCommand(this.options.command, environment) ?? this.options.command
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(command, this.options.args, {
        cwd: this.options.cwd,
        detached: process.platform !== 'win32',
        env: environment,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }) as ChildProcessWithoutNullStreams
    } catch (error) {
      const terminalError = asError(error, `Failed to start ${this.options.command}.`)
      this.enterTerminalState(terminalError, null, false)
      throw terminalError
    }
    this.child = child
    const reportUnexpectedExit = (error: Error, terminate = false) => {
      this.enterTerminalState(error, child, terminate)
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (this.child === child) this.consumeStdout(chunk)
    })
    child.stderr.on('data', (chunk: string) => {
      if (this.child === child) this.stderr = `${this.stderr}${chunk}`.slice(-16_384)
    })
    child.once('error', (error) => {
      reportUnexpectedExit(error, true)
    })
    child.stdin.once('error', (error) => {
      reportUnexpectedExit(error, true)
    })
    child.once('close', (code, signal) => {
      const detail = this.stderr.trim()
      reportUnexpectedExit(new Error(
        `${this.options.command} exited${code === null ? '' : ` with code ${code}`}${signal ? ` (${signal})` : ''}${detail ? `: ${detail}` : ''}`,
      ))
    })
  }

  async request<T extends JsonRecord = JsonRecord>(
    message: JsonRecord,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    this.start()
    const id = typeof message.id === 'string' && message.id ? message.id : randomUUID()
    if (this.pendingRequests.has(id)) {
      throw new Error(`${this.options.command} request id "${id}" is already pending.`)
    }
    const payload = { ...message, id }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`${this.options.command} request "${String(message.type ?? 'unknown')}" timed out.`))
      }, timeoutMs)
      this.pendingRequests.set(id, {
        reject,
        resolve: (response) => resolve(response as T),
        timeout,
      })
      try {
        this.write(payload)
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(message: JsonRecord) {
    this.start()
    this.write(message)
  }

  stop() {
    const child = this.child
    this.child = null
    const error = new Error(`${this.options.command} process was stopped.`)
    this.terminalError = error
    this.failAll(error)
    terminateChildProcessTree(child, { detachedProcessGroup: process.platform !== 'win32' })
  }

  private write(message: JsonRecord) {
    const child = this.child
    if (!child || child.stdin.destroyed) {
      throw new Error(`${this.options.command} process is not writable.`)
    }
    child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private consumeStdout(chunk: string) {
    if (this.discardingOversizedLine) {
      const newlineIndex = chunk.indexOf('\n')
      if (newlineIndex < 0) return
      this.discardingOversizedLine = false
      chunk = chunk.slice(newlineIndex + 1)
    }
    this.buffer += chunk
    let newlineIndex = this.buffer.indexOf('\n')

    while (newlineIndex >= 0) {
      const rawLine = this.buffer.slice(0, newlineIndex).replace(/\r$/, '')
      this.buffer = this.buffer.slice(newlineIndex + 1)
      newlineIndex = this.buffer.indexOf('\n')
      if (!rawLine.trim()) {
        continue
      }
      if (rawLine.length > this.maxProtocolLineLength) {
        const error = new Error(`Oversized JSON line from ${this.options.command} was discarded.`)
        this.failAll(error)
        if (!this.emitEvent({
          type: 'protocol_error',
          message: error.message,
        })) return
        continue
      }

      let message: JsonRecord
      try {
        const parsed = JSON.parse(rawLine)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          if (!this.emitEvent({
            type: 'protocol_error',
            message: `Non-object JSON received from ${this.options.command}.`,
          })) return
          continue
        }
        message = parsed as JsonRecord
      } catch {
        if (!this.emitEvent({
          type: 'protocol_error',
          message: `Invalid JSON received from ${this.options.command}.`,
        })) return
        continue
      }

      const id = typeof message.id === 'string' ? message.id : null
      const pending = id ? this.pendingRequests.get(id) : null
      if (id && pending) {
        this.pendingRequests.delete(id)
        clearTimeout(pending.timeout)
        if (message.success === false || ('error' in message && message.error != null)) {
          pending.reject(new Error(formatProtocolError(message.error, `${this.options.command} request failed.`)))
        } else {
          pending.resolve(message)
        }
        continue
      }

      if (!this.emitEvent(message)) return
    }

    if (this.buffer.length > this.maxProtocolLineLength) {
      this.buffer = ''
      this.discardingOversizedLine = true
      const error = new Error(`Oversized unterminated JSON line from ${this.options.command} was discarded.`)
      this.failAll(error)
      this.emitEvent({
        type: 'protocol_error',
        message: error.message,
      })
    }
  }

  private emitEvent(message: JsonRecord) {
    try {
      this.options.onEvent(message)
      return true
    } catch (error) {
      const terminalError = new Error(
        `${this.options.command} event handler failed: ${formatProtocolError(error, 'Unknown event handler error.')}`,
      )
      this.enterTerminalState(terminalError, this.child, true)
      return false
    }
  }

  private enterTerminalState(
    error: Error,
    expectedChild: ChildProcessWithoutNullStreams | null,
    terminate: boolean,
  ) {
    if (expectedChild && this.child !== expectedChild) return
    const child = expectedChild ?? this.child
    this.child = null
    this.terminalError = error
    this.failAll(error)
    if (terminate) {
      terminateChildProcessTree(child, { detachedProcessGroup: process.platform !== 'win32' })
    }
    try {
      this.options.onExit?.(error)
    } catch {
      // Adapter exit handlers must not crash the Electron main process.
    }
  }

  private failAll(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }
}

// Stable tab identity is separate from the incarnation of its running shell.
export type TerminalRef = { id: string; generation: string }
export type TerminalViewRef = { id: string; viewId: string }
// An omitted viewId reads/creates a session without attaching a renderer consumer.
export type TerminalOpenRequest = { id: string; projectId: string; cols: number; rows: number; viewId?: string }
export type TerminalStatus = 'running' | 'exited'
export type TerminalSnapshot = TerminalRef & {
  projectId: string
  cwd: string
  shell: string
  cols: number
  rows: number
  sequence: number
  status: TerminalStatus
  exitCode: number | null
  screen: string
  screenReaderMode: boolean
  windowsPty?: { backend: 'conpty'; buildNumber: number }
}
export type TerminalPayload =
  | { type: 'data'; sequence: number; data: string }
  | { type: 'resize'; sequence: number; cols: number; rows: number }
  | { type: 'exit'; exitCode: number }
  | { type: 'error'; message: string }
  | { type: 'closed' }
export type TerminalEvent = TerminalRef & TerminalPayload
export type TerminalCloseAction = 'close' | 'restart'
export type TerminalCloseConfirmation = {
  requestId: string
  action: TerminalCloseAction
  status: 'busy' | 'unknown'
  processes: string[]
}
export type TerminalApi = {
  open: (request: TerminalOpenRequest) => Promise<TerminalSnapshot>
  write: (request: TerminalRef & { data: string }) => Promise<void>
  resize: (request: TerminalRef & { cols: number; rows: number }) => Promise<void>
  acknowledge: (request: TerminalRef & { viewId: string; sequence: number }) => void
  detach: (request: TerminalViewRef) => void
  close: (id: string, action?: TerminalCloseAction) => Promise<boolean>
  onCloseConfirmation: (listener: (request: TerminalCloseConfirmation) => void) => () => void
  respondCloseConfirmation: (requestId: string, confirmed: boolean) => void
  onEvent: (listener: (event: TerminalEvent) => void) => () => void
}

export const TERMINAL_SCROLLBACK = 5000
export const TERMINAL_MAX_INPUT = 64 * 1024
export const TERMINAL_MAX_SESSIONS = 24

// Standard protocol queries are answered once by the canonical headless parser,
// including while a renderer is loading. Browser views consume these without
// sending a second response to the process.
export const TERMINAL_CSI_QUERIES = [
  { final: 'c' }, { prefix: '>', final: 'c' }, { final: 'n' }, { prefix: '?', final: 'n' },
  { intermediates: '$', final: 'p' }, { prefix: '?', intermediates: '$', final: 'p' },
] as const

export function terminalIdentity(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error('终端标识无效。')
  }
  return value
}

export function terminalSize(cols: unknown, rows: unknown) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || (cols as number) < 2 || (cols as number) > 500
    || (rows as number) < 1 || (rows as number) > 300) throw new Error('终端尺寸无效。')
  return { cols: cols as number, rows: rows as number }
}

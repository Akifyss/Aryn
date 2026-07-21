import { spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'

type TerminateChildProcessOptions = {
  // A detached group's leader can exit before its descendants. Only enable
  // this for a short-lived escalation after signaling that same group.
  allowExitedProcessGroup?: boolean
  detachedProcessGroup?: boolean
  signal?: NodeJS.Signals
}

function ignoreMissingProcess(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ESRCH'
}

export function terminateChildProcessTree(
  child: ChildProcess | null | undefined,
  options: TerminateChildProcessOptions = {},
) {
  if (!child) return
  const signal = options.signal ?? 'SIGTERM'
  const childHasExited = child.exitCode !== null || child.signalCode !== null
  if (process.platform === 'win32' && child.pid) {
    if (childHasExited) return
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR
    const taskkill = systemRoot
      ? path.join(systemRoot, 'System32', 'taskkill.exe')
      : 'taskkill.exe'
    const result = spawnSync(taskkill, ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      timeout: 5_000,
      windowsHide: true,
    })
    if (!result.error && result.status === 0) return
  }

  if (process.platform !== 'win32' && options.detachedProcessGroup && child.pid) {
    if (childHasExited && !options.allowExitedProcessGroup) return
    try {
      process.kill(-child.pid, signal)
      return
    } catch (error) {
      if (ignoreMissingProcess(error)) return
    }
  }

  if (childHasExited) return

  try {
    child.kill(signal)
  } catch {
    // Process cleanup is best-effort and must not crash the Electron main process.
  }
}

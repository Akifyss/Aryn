import { spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'

type TerminateChildProcessOptions = {
  detachedProcessGroup?: boolean
}

function ignoreMissingProcess(error: unknown) {
  return error && typeof error === 'object' && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ESRCH'
}

export function terminateChildProcessTree(
  child: ChildProcess | null | undefined,
  options: TerminateChildProcessOptions = {},
) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid) {
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
    try {
      process.kill(-child.pid, 'SIGTERM')
      return
    } catch (error) {
      if (ignoreMissingProcess(error)) return
    }
  }

  try {
    child.kill()
  } catch {
    // Process cleanup is best-effort and must not crash the Electron main process.
  }
}

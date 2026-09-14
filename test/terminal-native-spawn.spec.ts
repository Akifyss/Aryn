import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { TerminalManager } from '../electron/main/terminal/terminal-manager'
import { resolveTerminalShell, terminalEnvironment } from '../electron/main/terminal/terminal-shell'

// This must run on macOS as well as Windows: importing node-pty does not execute
// Darwin's spawn-helper, and mocks cannot detect a broken native installation.
it('starts the native shell, exchanges output, resizes, and preserves its exit code', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'aryn-terminal-native-'))
  const shell = await resolveTerminalShell(terminalEnvironment())
  // Exercise the resolved executable without running user profile scripts.
  const args = process.platform === 'win32' ? ['-NoLogo', '-NoProfile']
    : shell.label === 'zsh' ? ['-f', '-l']
      : shell.label === 'bash' ? ['--noprofile', '--norc', '-l'] : shell.args
  const manager = new TerminalManager({ projectPath: async () => cwd, emit: () => {},
    shell: async () => ({ ...shell, args }) })
  const request = { id: 'terminal://native-spawn', projectId: 'native-spawn', cols: 100, rows: 24 }
  try {
    const ref = await manager.open(1, request)
    expect(ref.status).toBe('running')
    if (process.platform === 'win32') {
      await expect.poll(async () => (await manager.inspectClose(1, ref.id)).status, { timeout: 10000 }).toBe('idle')
    }
    const command = process.platform === 'win32'
      ? "Write-Output ('ARYN_' + 'NATIVE_OK'); Write-Output ('中文' + '终端'); Write-Output (Get-Location).Path"
      : "printf 'ARYN_%s\\n' 'NATIVE_OK'; printf '%s%s\\n' '中文' '终端'; pwd"
    manager.write(1, { ...ref, data: `${command}\r` })
    await expect.poll(async () => (await manager.open(1, request)).screen, { timeout: 10000 }).toContain('ARYN_NATIVE_OK')
    await expect.poll(async () => (await manager.open(1, request)).screen, { timeout: 10000 }).toContain('中文终端')
    // macOS resolves /var to /private/var; both retain the unique directory name.
    await expect.poll(async () => (await manager.open(1, request)).screen, { timeout: 10000 }).toContain(path.basename(cwd))
    manager.resize(1, { ...ref, cols: 90, rows: 30 })
    await expect.poll(async () => (await manager.open(1, request)).cols, { timeout: 5000 }).toBe(90)
    manager.write(1, { ...ref, data: 'exit 7\r' })
    await expect.poll(async () => (await manager.open(1, request)).exitCode, { timeout: 10000 }).toBe(7)
    expect((await manager.open(1, request)).screen).toContain('ARYN_NATIVE_OK')
    manager.close(1, ref.id)
  } finally {
    manager.dispose()
    await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 30000)

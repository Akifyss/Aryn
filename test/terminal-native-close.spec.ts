import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { TerminalManager } from '../electron/main/terminal/terminal-manager'
import { resolveTerminalShell, terminalEnvironment } from '../electron/main/terminal/terminal-shell'

const managers: TerminalManager[] = []
afterEach(() => { for (const manager of managers.splice(0)) manager.dispose() })

// Real, isolated PTYs: proves command boundaries survive ConPTY and that cmdlets
// without a child PID are protected. No user profile or project files are changed.
it.skipIf(process.platform !== 'win32')('distinguishes PowerShell idle, in-process commands, and background children', async () => {
  const preferred = await resolveTerminalShell(terminalEnvironment())
  const legacy = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  for (const file of new Set([preferred.file, legacy])) {
    const manager = new TerminalManager({ projectPath: async () => process.cwd(), emit: () => {},
      shell: async () => ({ file, args: ['-NoLogo', '-NoProfile'], label: 'PowerShell' }) })
    managers.push(manager)
    const request = { id: 'terminal://native-close', projectId: 'test', cols: 100, rows: 24 }
    const ref = await manager.open(1, request)
    const waitStatus = async (status: string) => {
      await expect.poll(async () => (await manager.inspectClose(1, ref.id)).status, { timeout: 12000, interval: 200 }).toBe(status)
    }
    await waitStatus('idle')
    manager.write(1, { ...ref, data: 'Start-Sleep -Seconds 30\r' })
    await waitStatus('busy')
    manager.write(1, { ...ref, data: '\x03' })
    await waitStatus('idle')
    // A background job leaves the shell at its prompt, but its process is live.
    manager.write(1, { ...ref, data: 'Start-Job { Start-Sleep -Seconds 30 } | Out-Null\r' })
    await expect.poll(async () => (await manager.inspectClose(1, ref.id)).processes.length, { timeout: 12000, interval: 200 }).toBeGreaterThan(0)
    manager.write(1, { ...ref, data: 'Get-Job | Stop-Job; Get-Job | Remove-Job\r' })
    await waitStatus('idle')
    if (file !== legacy) {
      manager.write(1, { ...ref, data: "Start-ThreadJob { Start-Sleep -Seconds 30 } | Out-Null; Write-Output ('THREAD_' + 'READY')\r" })
      await expect.poll(async () => (await manager.open(1, request)).screen, { timeout: 5000 }).toMatch(/THREAD_READY[\s\S]*PS [^>]+>/)
      // Thread jobs have no child PID; the last prompt must not assert idle.
      expect((await manager.inspectClose(1, ref.id)).status).not.toBe('idle')
      manager.write(1, { ...ref, data: 'Get-Job | Stop-Job; Get-Job | Remove-Job\r' })
      await waitStatus('idle')
    }
    manager.write(1, { ...ref, data: 'exit\r' })
    await expect.poll(async () => (await manager.open(1, request)).status, { timeout: 5000 }).toBe('exited')
    expect((await manager.inspectClose(1, ref.id)).status).toBe('idle')
    manager.dispose()
  }
}, 60000)

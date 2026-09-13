import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { terminalEnvironment } from './terminal-shell'

const execute = promisify(execFile)
export type TerminalActivity = { status: 'idle' | 'busy' | 'unknown'; processes: string[] }
export type TerminalProcess = { pid: number; parentPid: number; name: string; started?: number }
export const unknownActivity = (): TerminalActivity => ({ status: 'unknown', processes: [] })

// Never collect command lines or environments. A single process-table snapshot
// includes descendants and background jobs, without spawning probes in the PTY.
const WINDOWS_PROCESS_QUERY = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
  'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,CreationDate |',
  'Select-Object ProcessId,ParentProcessId,Name,@{Name="Started";Expression={$_.CreationDate.Ticks}} | ConvertTo-Json -Compress',
].join('\n')

export function parseTerminalProcesses(output: string, platform: NodeJS.Platform): TerminalProcess[] {
  if (platform === 'win32') {
    const value: unknown = JSON.parse(output.replace(/^\uFEFF/, ''))
    const rows = Array.isArray(value) ? value : [value]
    return rows.map(row => {
      if (!row || !Number.isInteger(row.ProcessId) || !Number.isInteger(row.ParentProcessId) || typeof row.Name !== 'string') {
        throw new Error('Invalid process table')
      }
      return { pid: row.ProcessId, parentPid: row.ParentProcessId, name: row.Name,
        started: typeof row.Started === 'number' ? row.Started : undefined }
    })
  }
  return output.trim().split('\n').filter(Boolean).flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (!match) throw new Error('Invalid process table')
    // Zombies have no work left to interrupt; stopped jobs still do.
    if (/^[ZX]/.test(match[3])) return []
    return [{ pid: Number(match[1]), parentPid: Number(match[2]), name: match[4] }]
  })
}

export function terminalProcessActivity(pid: number, rows: TerminalProcess[], platform: NodeJS.Platform): TerminalActivity {
  const root = rows.find(row => row.pid === pid)
  if (!root) return unknownActivity() // Do not confuse an incomplete probe with an idle shell.
  const children = new Map<number, TerminalProcess[]>()
  for (const row of rows) {
    const siblings = children.get(row.parentPid) ?? []
    siblings.push(row)
    children.set(row.parentPid, siblings)
  }
  const seen = new Set([pid])
  const names = new Set<string>()
  const queue = [root]
  for (let index = 0; index < queue.length; index++) {
    const parent = queue[index]
    for (const child of children.get(parent.pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      // Windows may reuse a dead parent's PID. Older children cannot belong to it.
      if (child.started !== undefined && parent.started !== undefined && child.started < parent.started) continue
      queue.push(child)
      const name = (platform === 'win32' ? path.win32 : path.posix).basename(child.name)
      if (platform === 'win32' && /^(conhost|openconsole)\.exe$/i.test(name)) continue
      names.add(name.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 80) || '进程')
    }
  }
  return { status: names.size ? 'busy' : 'idle', processes: [...names].slice(0, 5) }
}

export async function inspectTerminalProcesses(pid: number, signal: AbortSignal): Promise<TerminalActivity> {
  if (!Number.isInteger(pid) || pid <= 0) return unknownActivity()
  try {
    const windows = process.platform === 'win32'
    const executable = windows
      ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : '/bin/ps'
    const args = windows
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(WINDOWS_PROCESS_QUERY, 'utf16le').toString('base64')]
      : ['-A', '-o', 'pid=,ppid=,stat=,comm=']
    const { stdout } = await execute(executable, args, {
      encoding: 'utf8', timeout: 2500, maxBuffer: 4 * 1024 * 1024, windowsHide: true,
      signal, env: terminalEnvironment() as NodeJS.ProcessEnv,
    })
    return terminalProcessActivity(pid, parseTerminalProcesses(stdout, process.platform), process.platform)
  } catch {
    // Timeout, permissions, missing tools and cancellation never mean "idle".
    return unknownActivity()
  }
}

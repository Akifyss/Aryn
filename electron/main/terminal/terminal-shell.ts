import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export function terminalEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  // Electron, debug and host IPC variables are not part of the user's shell.
  const privateNames = /^(ELECTRON_|ARYN_|VSCODE_INSPECTOR_OPTIONS$|NODE_OPTIONS$|NODE_CHANNEL_FD$|NODE_CHANNEL_SERIALIZATION_MODE$|BASH_ENV$|ENV$|ARGV0$)/i
  return { ...Object.fromEntries(Object.entries(source).filter((entry): entry is [string, string] =>
    entry[1] !== undefined && !privateNames.test(entry[0]))), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Aryn' }
}

async function executable(candidate: string) {
  try {
    await access(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
    return (await stat(candidate)).isFile()
  } catch { return false }
}

export async function resolveTerminalShell(env: Record<string, string>) {
  if (process.platform === 'win32') {
    const envPath = Object.entries(env).find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
    const candidates = [
      ...envPath.split(path.delimiter).filter(Boolean).map(dir => path.join(dir.replace(/^"|"$/g, ''), 'pwsh.exe')),
      path.join(env.ProgramFiles ?? 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
      path.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ]
    for (const file of candidates) if (await executable(file)) return { file, args: ['-NoLogo'], label: 'PowerShell' }
    throw new Error('找不到 PowerShell，请安装 PowerShell 后重试。')
  }
  const candidate = env.SHELL || os.userInfo().shell || '/bin/sh'
  if (!path.isAbsolute(candidate) || !await executable(candidate)) throw new Error('默认 shell 不可用，请检查系统 shell 配置。')
  return { file: candidate, args: ['-l'], label: path.basename(candidate) }
}

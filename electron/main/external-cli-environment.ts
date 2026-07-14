import { execFile } from 'node:child_process'
import { accessSync, constants, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const LOGIN_PATH_MARKER = '__ARYN_LOGIN_PATH__='
let loginShellPath: string | null = null
let loginShellPathPromise: Promise<void> | null = null

function isDependencyBinaryPath(value: string) {
  const normalized = path.normalize(value.trim()).replace(/[\\/]+$/, '')
  if (!normalized) return false
  return path.basename(normalized).toLowerCase() === '.bin'
    && path.basename(path.dirname(normalized)).toLowerCase() === 'node_modules'
}

export function getExternalCliPath(rawPath: string | undefined) {
  return (rawPath ?? '')
    .split(path.delimiter)
    .filter((entry) => entry && !isDependencyBinaryPath(entry))
    .join(path.delimiter)
}

function mergePathValues(...values: Array<string | null | undefined>) {
  const seen = new Set<string>()
  const entries: string[] = []
  for (const value of values) {
    for (const entry of (value ?? '').split(path.delimiter)) {
      const normalized = entry.trim()
      if (!normalized) continue
      const identity = process.platform === 'win32' ? normalized.toLowerCase() : normalized
      if (seen.has(identity)) continue
      seen.add(identity)
      entries.push(normalized)
    }
  }
  return entries.join(path.delimiter)
}

export async function prepareExternalCliEnvironment() {
  if (process.platform === 'win32' || loginShellPath !== null) return
  if (loginShellPathPromise) return loginShellPathPromise
  loginShellPathPromise = (async () => {
    const shell = process.env.SHELL?.trim() || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh')
    try {
      const { stdout } = await execFileAsync(shell, [
        '-ilc',
        `printf '\n${LOGIN_PATH_MARKER}%s\n' "$PATH"`,
      ], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024,
        timeout: 4_000,
        windowsHide: true,
      })
      const markedLine = stdout.split(/\r?\n/).reverse().find((line) => line.startsWith(LOGIN_PATH_MARKER))
      loginShellPath = markedLine?.slice(LOGIN_PATH_MARKER.length).trim() || ''
    } catch {
      // GUI-launched apps can lack a usable login shell. The inherited PATH
      // remains the safe fallback and CLI discovery will report a clear error.
      loginShellPath = ''
    }
  })().finally(() => {
    loginShellPathPromise = null
  })
  return loginShellPathPromise
}

export function createExternalCliEnvironment(overrides: Partial<NodeJS.ProcessEnv> = {}) {
  const environment = { ...process.env, ...overrides }
  const overridePathEntry = Object.entries(overrides).find(([key]) => key.toLowerCase() === 'path')
  const inheritedPathEntry = Object.entries(process.env).find(([key]) => key.toLowerCase() === 'path')
  const pathKey = overridePathEntry?.[0] ?? inheritedPathEntry?.[0] ?? 'PATH'
  for (const key of Object.keys(environment)) {
    if (key !== pathKey && key.toLowerCase() === 'path') delete environment[key]
  }
  const requestedPath = overridePathEntry?.[1] ?? inheritedPathEntry?.[1]
  environment[pathKey] = getExternalCliPath(overridePathEntry
    ? mergePathValues(requestedPath)
    : mergePathValues(loginShellPath, requestedPath))
  return environment
}

export function resolveExternalCliCommand(
  command: string,
  environment: NodeJS.ProcessEnv = createExternalCliEnvironment(),
) {
  const isRunnableFile = (candidate: string) => {
    try {
      if (!existsSync(candidate) || !statSync(candidate).isFile()) return false
      if (process.platform !== 'win32') accessSync(candidate, constants.X_OK)
      return true
    } catch {
      return false
    }
  }
  if (path.isAbsolute(command)) return isRunnableFile(command) ? command : null
  const pathEntry = Object.entries(environment).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  const extensions = process.platform === 'win32'
    ? ['.exe', '.com', '.cmd', '.bat', '']
    : ['']

  for (const directory of pathEntry.split(path.delimiter)) {
    const normalizedDirectory = directory.trim().replace(/^"|"$/g, '')
    if (!normalizedDirectory) continue
    for (const extension of extensions) {
      const candidate = path.join(normalizedDirectory, `${command}${extension}`)
      if (isRunnableFile(candidate)) return candidate
    }
  }
  return null
}

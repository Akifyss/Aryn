import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import spawn from 'cross-spawn'
import { terminateChildProcessTree } from '../../../child-process-lifecycle'

export type OpenCodeServer = {
  close: () => void
  onExit?: (listener: (error: Error) => void) => () => void
  url: string
}

export type OpenCodeServerLaunchOptions = {
  command: string
  environment: NodeJS.ProcessEnv
  hostname: string
  port: number
  timeout: number
}

export async function launchOpenCodeServer(
  options: OpenCodeServerLaunchOptions,
): Promise<OpenCodeServer> {
  const child = spawn(options.command, [
    'serve',
    `--hostname=${options.hostname}`,
    `--port=${options.port}`,
  ], {
    env: options.environment,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  }) as ChildProcessWithoutNullStreams
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  return new Promise((resolve, reject) => {
    let output = ''
    let settled = false
    const exitListeners = new Set<(error: Error) => void>()
    const finishWithError = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      terminateChildProcessTree(child)
      reject(error)
    }
    const timeout = setTimeout(() => {
      finishWithError(new Error(`Timeout waiting for OpenCode server to start after ${options.timeout}ms.`))
    }, options.timeout)

    child.stdout.on('data', (chunk: string) => {
      if (settled) return
      output = `${output}${chunk}`.slice(-64 * 1024)
      for (const line of output.split(/\r?\n/)) {
        if (!line.startsWith('opencode server listening')) continue
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (!match) {
          finishWithError(new Error(`Failed to parse OpenCode server URL from output: ${line}`))
          return
        }
        settled = true
        clearTimeout(timeout)
        resolve({
          close: () => terminateChildProcessTree(child),
          onExit: (listener) => {
            exitListeners.add(listener)
            return () => exitListeners.delete(listener)
          },
          url: match[1],
        })
        return
      }
    })
    child.stderr.on('data', (chunk: string) => {
      if (!settled) output = `${output}${chunk}`.slice(-64 * 1024)
    })
    child.once('error', (error) => finishWithError(error))
    child.once('exit', (code) => {
      const error = new Error(
        `OpenCode server (${options.command}) exited with code ${code ?? 'unknown'}${output.trim() ? `\nServer output: ${output.trim()}` : ''}`,
      )
      finishWithError(error)
      for (const listener of exitListeners) listener(error)
      exitListeners.clear()
    })
  })
}

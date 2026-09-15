import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { TerminalManager } from '../electron/main/terminal/terminal-manager'
import * as integration from '../electron/main/terminal/terminal-zsh-integration'

afterEach(() => vi.restoreAllMocks())
const exists = (directory: string) => access(directory).then(() => true, () => false)
const request = { id: 'terminal://zsh-cleanup', projectId: 'project', cols: 80, rows: 24 }

it('uses private startup files and leaves the caller environment unchanged', async () => {
  const env = { HOME: '/test home', ZDOTDIR: '/custom config' }
  const prepared = (await integration.prepareZshIntegration('/bin/zsh', ['-l'], env, 'test-session'))!
  try {
    expect(env).toEqual({ HOME: '/test home', ZDOTDIR: '/custom config' })
    expect(prepared.env.ARYN_ZSH_USER_DIR).toBe(env.ZDOTDIR)
    expect(prepared.env.ARYN_ZSH_DIR_SET).toBe('1')
    expect(await readdir(prepared.env.ZDOTDIR)).toEqual(['.zshenv'])
    expect(await readFile(path.join(prepared.env.ZDOTDIR, '.zshenv'), 'utf8')).not.toContain('\r')
  } finally { await prepared.dispose() }
  expect(await exists(prepared.env.ZDOTDIR)).toBe(false)
  for (const [file, args] of [['/bin/bash', ['-l']], ['/bin/zsh', ['-f', '-l']], ['/bin/zsh', ['-c', 'echo hi']]] as const) {
    expect(await integration.prepareZshIntegration(file, [...args], env, 'test')).toBeNull()
  }
})

it('removes prepared files if close wins while startup preparation is pending', async () => {
  const prepared = (await integration.prepareZshIntegration('/bin/zsh', ['-l'], {}, 'test-session'))!
  let resolve!: (value: typeof prepared) => void
  const prepare = vi.spyOn(integration, 'prepareZshIntegration').mockImplementation(() => new Promise(done => { resolve = done }))
  const spawn = vi.fn()
  const manager = new TerminalManager({ projectPath: async () => process.cwd(), emit: () => {}, spawn,
    shell: async () => ({ file: '/bin/zsh', args: ['-l'], label: 'zsh' }) })
  try {
    const pending = manager.open(1, request)
    const rejected = expect(pending).rejects.toThrow('已关闭')
    await vi.waitFor(() => expect(prepare).toHaveBeenCalledOnce())
    manager.close(1, request.id)
    resolve(prepared)
    await rejected
    await vi.waitFor(async () => expect(await exists(prepared.env.ZDOTDIR)).toBe(false))
    expect(spawn).not.toHaveBeenCalled()
  } finally { manager.dispose(); await prepared.dispose() }
})

it('cleans up integration files when native spawn fails', async () => {
  let directory = ''
  const manager = new TerminalManager({ projectPath: async () => process.cwd(), emit: () => {},
    shell: async () => ({ file: '/bin/zsh', args: ['-l'], label: 'zsh' }),
    spawn: (_file, _args, options) => { directory = options!.env!.ZDOTDIR!; throw new Error('native spawn failed') } })
  try {
    await expect(manager.open(1, request)).rejects.toThrow('native spawn failed')
    expect(directory).not.toBe('')
    await vi.waitFor(async () => expect(await exists(directory)).toBe(false))
  } finally { manager.dispose() }
})

it('does not prevent shell startup when optional integration cannot be prepared', async () => {
  vi.spyOn(integration, 'prepareZshIntegration').mockRejectedValue(new Error('disk full'))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const spawn = vi.fn((_file: string, _args: string[], options: Parameters<typeof import('node-pty').spawn>[2]) => {
    expect(options?.env?.ZDOTDIR).toBeUndefined()
    throw new Error('reached native spawn')
  })
  const manager = new TerminalManager({ projectPath: async () => process.cwd(), emit: () => {}, spawn,
    shell: async env => { delete env.ZDOTDIR; return { file: '/bin/zsh', args: ['-l'], label: 'zsh' } } })
  try {
    await expect(manager.open(1, request)).rejects.toThrow('reached native spawn')
    expect(spawn).toHaveBeenCalledOnce()
    expect(warning).toHaveBeenCalledOnce()
  } finally { manager.dispose() }
})

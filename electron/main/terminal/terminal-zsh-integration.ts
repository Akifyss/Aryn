import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import bootstrap from './shell-integration/zsh.zsh?raw'

// Bundle the script as text so packaged apps never ask zsh to source an ASAR path.
// Only intercept .zshenv; zsh itself must load all subsequent system/user files
// with the real ZDOTDIR (macOS /etc/zshrc derives HISTFILE and key maps from it).
export async function prepareZshIntegration(file: string, args: string[], env: Record<string, string>, nonce: string) {
  if (path.basename(file) !== 'zsh' || args.some(arg => !['-l', '-i', '--login', '--interactive'].includes(arg))) return null
  const directory = await mkdtemp(path.join(os.tmpdir(), 'aryn-zsh-'))
  const dispose = () => rm(directory, { recursive: true, force: true }).catch(error => {
    console.warn('[terminal] Failed to remove zsh integration files.', error)
  })
  try {
    await writeFile(path.join(directory, '.zshenv'), bootstrap.replace(/\r\n/g, '\n'), { mode: 0o600 })
    return { env: { ...env, ZDOTDIR: directory, ARYN_ZSH_USER_DIR: env.ZDOTDIR ?? env.HOME ?? os.homedir(),
      ARYN_ZSH_DIR_SET: env.ZDOTDIR === undefined ? '0' : '1', ARYN_ZSH_NONCE: nonce }, dispose }
  } catch (error) {
    await dispose()
    throw error
  }
}

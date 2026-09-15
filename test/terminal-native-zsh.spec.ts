import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { afterEach, expect, it } from 'vitest'
import { TerminalManager } from '../electron/main/terminal/terminal-manager'
import { prepareZshIntegration } from '../electron/main/terminal/terminal-zsh-integration'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup() })

async function terminal(files: Record<string, string> = {}, args = ['-l'], dotdir?: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-zsh-close-'))
  for (const [name, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true })
    await writeFile(path.join(root, name), content)
  }
  let exited = true
  let exitCode: number | null = null
  let exitSubscription: { dispose: () => void } | undefined
  const manager = new TerminalManager({ projectPath: async () => root, emit: () => {},
    spawn: (file, args, options) => {
      const { spawn } = createRequire(import.meta.url)('node-pty') as typeof import('node-pty')
      const pty = spawn(file, args, options)
      exited = false
      // Keep this observer independent of manager.dispose(), which detaches its
      // own listeners before sending SIGHUP. Sending a signal is not an exit.
      exitSubscription = pty.onExit(event => { exitCode = event.exitCode; exited = true })
      return pty
    },
    shell: async env => {
      env.HOME = root
      delete env.ZDOTDIR
      if (dotdir) env.ZDOTDIR = path.join(root, dotdir)
      return { file: '/bin/zsh', args, label: 'zsh' }
    } })
  const cleanup = async () => {
    manager.dispose()
    try {
      await expect.poll(() => exited, { timeout: 7000, message: `zsh must exit before removing ${root}` }).toBe(true)
    } finally { exitSubscription?.dispose() }
    await rm(root, { recursive: true, force: true })
  }
  cleanups.push(cleanup)
  const request = { id: 'terminal://zsh', projectId: 'zsh', cols: 160, rows: 30 }
  const ref = await manager.open(1, request)
  const write = (data: string) => manager.write(1, { ...ref, data })
  const output = () => manager.open(1, request).then(snapshot => snapshot.screen)
  const activity = () => manager.inspectClose(1, ref.id)
  const waitStatus = async (status: string) => {
    try { await expect.poll(async () => (await activity()).status, { timeout: 7000 }).toBe(status) }
    catch (cause) { throw new Error(`Expected zsh ${status}: ${await output()}`, { cause }) }
  }
  const waitOutput = (value: string) => expect.poll(output, { timeout: 7000 }).toContain(value)
  return { root, manager, ref, request, write, output, activity, waitStatus, waitOutput, cleanup, exitCode: () => exitCode }
}

it.skipIf(process.platform === 'win32')('waits for shell shutdown before deleting its startup and history directory', async () => {
  const t = await terminal({ '.zshrc': `
# Model shell shutdown work that outlives kill(): history and exit hooks can
# still write into HOME/ZDOTDIR after the manager has detached the terminal.
function TRAPHUP { sleep 0.2; builtin print -r -- saved > "$HOME/exit-history" || exit 9; exit 0; }
` })
  await t.waitStatus('idle')
  await t.cleanup()
  expect(t.exitCode()).toBe(0)
  expect(await access(t.root).then(() => true, () => false)).toBe(false)
})

it.skipIf(process.platform === 'win32')('recognizes idle zsh while protecting builtins, foreground/background jobs and nested readers', async () => {
  const t = await terminal({ '.zshrc': "PROMPT='ARYN_PROMPT> '\n" })
  await t.waitOutput('ARYN_PROMPT>')
  await t.waitStatus('idle')
  t.write('while true; do :; done\r') // No child process: process-table checks alone are insufficient.
  await t.waitStatus('busy')
  expect((await t.activity()).processes).toEqual([])
  t.write('\x03')
  await t.waitStatus('idle')
  t.write('sleep 30\r')
  await expect.poll(async () => (await t.activity()).processes, { timeout: 7000 }).toContain('sleep')
  t.write('\x03')
  await t.waitStatus('idle')
  t.write('sleep 30 &\r')
  await expect.poll(async () => (await t.activity()).processes, { timeout: 7000 }).toContain('sleep')
  t.write('kill $!; wait $!\r')
  await t.waitStatus('idle')
  t.write("typeset aryn_value=''; printf 'NESTED_%s\\n' READER; vared aryn_value\r")
  await t.waitOutput('NESTED_READER')
  expect((await t.activity()).status).not.toBe('idle')
  t.write('\x03')
  await t.waitStatus('idle')
  t.write('zsh -f\r')
  await expect.poll(async () => (await t.activity()).processes, { timeout: 7000 }).toContain('zsh')
  t.write('exit\r')
  await t.waitStatus('idle')
  t.write('exit 7\r')
  await expect.poll(async () => (await t.manager.open(1, t.request)).exitCode).toBe(7)
  expect((await t.activity()).status).toBe('idle')
}, 45000)

it.skipIf(process.platform === 'win32')('preserves login files, redirected ZDOTDIR, prompt hooks, history and exit status', async () => {
  const files = {
    '.zshenv': 'typeset +x ZDOTDIR="$HOME/custom config"\nexport ARYN_TEST_ORDER=env\n',
    'custom config/.zprofile': 'export ARYN_TEST_ORDER="$ARYN_TEST_ORDER,profile"\n',
    'custom config/.zshrc': `export ARYN_TEST_ORDER="$ARYN_TEST_ORDER,rc"
HISTFILE="$ZDOTDIR/history"
HISTSIZE=100
SAVEHIST=100
PROMPT='CUSTOM_PROMPT> '
precmd() { builtin printf 'USER_PRECMD:%s\\n' "$?"; }
preexec() { builtin printf 'USER_PREEXEC\\n'; }
function zle-line-init { builtin printf 'USER_ZLE\\n'; }
zle -N zle-line-init
`,
    'custom config/.zlogin': 'export ARYN_TEST_ORDER="$ARYN_TEST_ORDER,login"\n',
    'custom config/.zlogout': 'builtin printf "%s" "$ARYN_TEST_ORDER,logout" > "$HOME/logout-order"\n',
  }
  const t = await terminal(files)
  await t.waitStatus('idle')
  await t.waitOutput('USER_ZLE')
  t.write("printf 'ORDER=%s\\n' \"$ARYN_TEST_ORDER\"; printf 'DIR=%s\\n' \"$ZDOTDIR\"; false\r")
  await t.waitOutput('ORDER=env,profile,rc,login')
  await t.waitOutput(`DIR=${t.root}/custom config`)
  await t.waitOutput('USER_PRECMD:1')
  await t.waitStatus('idle')
  t.write("printf 'STATUS=%s\\n' \"$?\"; printf 'EXPORT=%s\\n' \"${(t)ZDOTDIR}\"\r")
  await t.waitOutput('STATUS=1')
  await t.waitOutput('EXPORT=scalar\r\n')
  t.write('exit\r')
  await expect.poll(async () => (await t.manager.open(1, t.request)).status).toBe('exited')
  expect(await readFile(path.join(t.root, 'logout-order'), 'utf8')).toBe('env,profile,rc,login,logout')
  const history = await readFile(path.join(t.root, 'custom config/history'), 'utf8')
  expect(history).toContain('STATUS=')
  expect(history).not.toContain('__aryn')
  for (const [name, content] of Object.entries(files)) expect(await readFile(path.join(t.root, name), 'utf8')).toBe(content)
}, 20000)

it.skipIf(process.platform === 'win32')('keeps explicit no-rc zsh sessions unmodified and conservatively unknown', async () => {
  const t = await terminal({}, ['-f', '-l'])
  t.write("printf 'NO_RC_%s\\n' READY\r")
  await t.waitOutput('NO_RC_READY')
  expect((await t.activity()).status).toBe('unknown')
})

it.skipIf(process.platform === 'win32')('preserves a failed user line-init widget without incorrectly allowing an idle close', async () => {
  const t = await terminal({ '.zshrc': `
function zle-line-init { builtin printf 'USER_INIT_FAILED\\n'; return 1; }
zle -N zle-line-init
` })
  await t.waitOutput('USER_INIT_FAILED')
  await t.waitStatus('unknown')
  t.write('while true; do :; done\r')
  await t.waitStatus('busy')
  t.write('\x03')
  await expect.poll(async () => (await t.output()).match(/USER_INIT_FAILED/g)?.length).toBe(2)
  expect((await t.activity()).status).not.toBe('idle')
}, 15000)

it.skipIf(process.platform === 'win32')('composes with ZLE hooks added after the first prompt without recursion or duplicate callbacks', async () => {
  const t = await terminal({ '.zshrc': `
builtin zmodload zsh/zle
builtin autoload -Uz add-zle-hook-widget
function user_init {
  [[ -o nounset && -o ksharrays ]] && builtin printf 'USER_OPTIONS_OK\\n'
  builtin printf 'USER_WIDGET=%s\\n' "$WIDGET"
}
add-zle-hook-widget line-init user_init
setopt nounset ksharrays
` })
  await t.waitStatus('idle')
  await t.waitOutput('USER_OPTIONS_OK')
  await t.waitOutput('USER_WIDGET=user_init')
  t.write("function late_init { builtin printf 'LATE_WIDGET=%s\\n' \"$WIDGET\"; }; add-zle-hook-widget line-init late_init\r")
  await t.waitOutput('LATE_WIDGET=late_init')
  await t.waitStatus('idle')
  t.write("printf 'NEXT_%s\\n' READY\r")
  await t.waitOutput('NEXT_READY')
  await t.waitStatus('idle')
  const screen = await t.output()
  expect(screen.match(/USER_WIDGET=user_init/g)).toHaveLength(3)
  expect(screen.match(/LATE_WIDGET=late_init/g)).toHaveLength(2)
}, 15000)

it.skipIf(process.platform === 'win32')('preserves inherited ZDOTDIR in non-login shells without leaking integration to children', async () => {
  const t = await terminal({ 'startup/.zshrc': "PROMPT='NON_LOGIN> '\n" }, ['-i'], 'startup')
  await t.waitStatus('idle')
  t.write("printf 'DIR=%s\\n' \"$ZDOTDIR\"; if (( ${+ARYN_ZSH_NONCE} + ${+ARYN_ZSH_USER_DIR} + ${+ARYN_ZSH_DIR_SET} )); then printf 'LEAK_%s\\n' FOUND; else printf 'ENV_%s\\n' CLEAN; fi\r")
  await t.waitOutput(`DIR=${t.root}/startup`)
  await t.waitOutput('ENV_CLEAN')
  expect(await t.output()).not.toContain('LEAK_FOUND')
  t.write('while true; do :; done\r')
  await t.waitStatus('busy')
  t.write('\x03')
  await t.waitStatus('idle')
}, 15000)

it.skipIf(process.platform === 'win32')('respects a user disabling startup files instead of forcing hooks on', async () => {
  const t = await terminal({ '.zshenv': 'unsetopt rcs\n' })
  t.write("printf 'DISABLED_%s\\n' READY\r")
  await t.waitOutput('DISABLED_READY')
  expect((await t.activity()).status).toBe('unknown')
})

it.skipIf(process.platform === 'win32')('hands ZDOTDIR back before system profiles derive history and resource paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-zsh-startup-'))
  const config = path.join(root, 'custom config')
  await mkdir(config)
  await writeFile(path.join(root, '.zshenv'), 'typeset +x ZDOTDIR="$HOME/custom config"\n')
  const prepared = (await prepareZshIntegration('/bin/zsh', ['-l'], { HOME: root }, 'test-session'))!
  try {
    // Execute the actual generated .zshenv, then the Apple /etc/zshrc history rule
    // at the same startup boundary. Never write to the host's /etc or dotfiles.
    const { stdout } = await promisify(execFile)('/bin/zsh', ['-f', '-c', `
setopt rcs
builtin source "$ZDOTDIR/.zshenv"
HISTFILE=\${ZDOTDIR:-$HOME}/.zsh_history
builtin printf '%s\\n' "$HISTFILE" "\${(t)ZDOTDIR}"
`], { env: { ...process.env, ...prepared.env } })
    expect(stdout.trim().split('\n')).toEqual([`${config}/.zsh_history`, 'scalar'])
  } finally { await prepared.dispose(); await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'darwin')('preserves macOS default history without a user override', async () => {
  const t = await terminal()
  await t.waitStatus('idle')
  t.write("printf 'HISTORY=%s\\n' \"$HISTFILE\"\r")
  await t.waitOutput(`HISTORY=${t.root}/.zsh_history`)
})

it.skipIf(process.platform === 'win32')('composes with later prompt hooks without changing user shell options', async () => {
  const t = await terminal({ '.zshrc': `
function user_prompt_hook { builtin printf 'LATE_HOOK\\n'; }
precmd_functions+=(user_prompt_hook)
PROMPT='USER_OPTIONS> '
setopt nounset ksharrays
` })
  await t.waitStatus('idle')
  await t.waitOutput('LATE_HOOK')
  t.write("[[ -o nounset && -o ksharrays ]] && printf 'OPTIONS_%s\\n' PRESERVED; while true; do :; done\r")
  await t.waitOutput('OPTIONS_PRESERVED')
  await t.waitStatus('busy')
  t.write('\x03')
  await t.waitStatus('idle')
}, 15000)

it.skipIf(process.platform === 'win32')('lets zsh load the same user configuration when .zshenv changes emulation', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-zsh-emulation-'))
  await writeFile(path.join(root, '.zshenv'), 'export ARYN_TEST_ORDER=env\nemulate sh\n')
  await writeFile(path.join(root, '.zprofile'), 'export ARYN_TEST_ORDER="$ARYN_TEST_ORDER,profile"\n')
  await writeFile(path.join(root, '.zshrc'), 'export ARYN_TEST_ORDER="$ARYN_TEST_ORDER,rc"\n')
  await writeFile(path.join(root, '.zlogin'), 'export ARYN_TEST_ORDER="$ARYN_TEST_ORDER,login"\n')
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: root }
  delete env.ZDOTDIR
  const prepared = (await prepareZshIntegration('/bin/zsh', ['-l'], { HOME: root }, 'test-session'))!
  try {
    const args = ['-i', '-l', '-c', 'builtin printf "ORDER=%s\\nDIR=%s\\n" "$ARYN_TEST_ORDER" "${ZDOTDIR-UNSET}"']
    const run = promisify(execFile)
    const baseline = await run('/bin/zsh', args, { env })
    const wrapped = await run('/bin/zsh', args, { env: { ...env, ...prepared.env } })
    expect(wrapped.stdout).toBe(baseline.stdout)
    expect(wrapped.stderr).toBe(baseline.stderr)
  } finally { await prepared.dispose(); await rm(root, { recursive: true, force: true }) }
})

it.skipIf(process.platform === 'win32')('does not mistake a later prompt hook reading with vared for an idle command line', async () => {
  const t = await terminal({ '.zshrc': `
function user_prompt_setup {
  if [[ -z \${ARYN_TEST_CONFIGURED-} ]]; then
    typeset -g ARYN_TEST_CONFIGURED=1 ARYN_TEST_VALUE=''
    builtin printf 'SETUP_READER\\n'
    vared ARYN_TEST_VALUE
  fi
}
precmd_functions+=(user_prompt_setup)
` })
  await t.waitOutput('SETUP_READER')
  expect((await t.activity()).status).not.toBe('idle')
  t.write('configured\r')
  await t.waitStatus('idle')
})

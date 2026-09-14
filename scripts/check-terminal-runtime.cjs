const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

// A require-only probe misses the Darwin spawn-helper. Run an actual PTY using
// Electron's runtime; no BrowserWindow, user profile, or persistent files.
if (process.argv[2] !== '--probe') {
  const executable = require('electron')
  const packagePath = require.resolve('node-pty/package.json')
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  delete env.NODE_OPTIONS
  const result = spawnSync(executable, [__filename, '--probe', packagePath], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) console.error(result.error)
  process.exit(result.status === 0 && !result.error ? 0 : 1)
}

async function probe() {
  const packagePath = path.resolve(process.argv[3])
  const packageRequire = createRequire(packagePath)
  const pty = packageRequire('./')
  if (process.platform === 'darwin') {
    // Locate the same native directory used by pinned node-pty 1.1.0. This also
    // prints the exact helper path/mode if the native spawn fails for another reason.
    const native = packageRequire('./lib/utils').loadNativeModule('pty')
    const helper = path.resolve(path.dirname(packagePath), 'lib', native.dir, 'spawn-helper')
    const mode = fs.statSync(helper).mode & 0o777
    console.log(`[terminal-runtime] ${process.platform}/${process.arch} helper=${helper} mode=${mode.toString(8)}`)
    fs.accessSync(helper, fs.constants.X_OK)
  }
  const windows = process.platform === 'win32'
  const file = windows ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe') : '/bin/sh'
  const args = windows ? ['-NoLogo', '-NoProfile', '-Command', "Write-Output ('ARYN_' + 'PTY_OK'); exit 7"]
    : ['-c', "printf 'ARYN_%s\\n' 'PTY_OK'; exit 7"]
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^(ELECTRON_|ARYN_|NODE_OPTIONS$|NODE_CHANNEL_|BASH_ENV$|ENV$)/i.test(key)) delete env[key]
  const terminal = pty.spawn(file, args, { cwd: os.tmpdir(), env, cols: 80, rows: 24,
    ...(windows ? { useConptyDll: true } : {}) })
  let output = ''
  terminal.onData(data => { output = (output + data).slice(-10000) })
  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`PTY did not exit: ${output}`))
      try { terminal.kill() } catch { /* The disposable probe process exits below. */ }
    }, 10000)
    terminal.onExit(event => { clearTimeout(timer); resolve(event.exitCode) })
  })
  assert.equal(exitCode, 7)
  assert.match(output, /ARYN_PTY_OK/)
  console.log(`[terminal-runtime] PASS Electron ${process.versions.electron} ${process.platform}/${process.arch}: native spawn, output, exit`)
}

// This is a disposable probe process. node-pty can keep native handles alive
// after onExit, so finish explicitly once output and the shell exit are verified.
probe().then(() => process.exit(0), error => { console.error(error); process.exit(1) })

const { test, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { prepareTerminalRuntime } = require('../prepare-terminal-runtime.cjs')
const afterPack = require('../after-pack-terminal.cjs')
const { Arch } = require('builder-util')

const roots = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aryn-terminal-runtime-'))
  roots.push(root)
  return root
}
function payload(root, directory, mode = 0o644) {
  const target = path.join(root, directory)
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'pty.node'), 'native fixture')
  const helper = path.join(target, 'spawn-helper')
  fs.writeFileSync(helper, '#!/bin/sh\nprintf "HELPER_OK"\n')
  fs.chmodSync(helper, mode)
  return helper
}

test('Windows and Linux require no Darwin helper and do not touch dependencies', () => {
  for (const platform of ['win32', 'linux']) {
    assert.deepEqual(prepareTerminalRuntime({ platform, packageDir: '/does-not-exist' }), [])
    afterPack({ electronPlatformName: platform })
  }
})

test('a missing native payload or a missing helper fails preparation', () => {
  const root = fixture()
  assert.throws(() => prepareTerminalRuntime({ platform: 'darwin', arch: 'arm64', packageDir: root }), /未找到/)
  const helper = payload(root, 'prebuilds/darwin-arm64')
  fs.unlinkSync(helper)
  assert.throws(() => prepareTerminalRuntime({ platform: 'darwin', arch: 'arm64', packageDir: root }), /缺少/)
  fs.mkdirSync(helper)
  assert.throws(() => prepareTerminalRuntime({ platform: 'darwin', arch: 'arm64', packageDir: root }), /不是普通文件/)
})

test('a valid prebuild does not hide an incomplete source build selected first by node-pty', () => {
  const root = fixture()
  payload(root, 'prebuilds/darwin-arm64')
  fs.unlinkSync(payload(root, 'build/Release'))
  assert.throws(() => prepareTerminalRuntime({ platform: 'darwin', arch: 'arm64', packageDir: root }), /build[\\/]Release[\\/]spawn-helper/)
})

test('the macOS packaging hook rejects an absent unpacked payload', () => {
  assert.throws(() => afterPack({ electronPlatformName: 'darwin', arch: Arch.arm64,
    appOutDir: fixture(), packager: { appInfo: { productFilename: 'Aryn' } } }), /app\.asar\.unpacked/)
})

// Real POSIX file modes and OS execution, not mocked stat/chmod. This reproduces
// the npm artifact's 0644 -> EACCES failure even on a Linux test runner.
test('restores both prebuilds and source builds to executable files, idempotently', { skip: process.platform === 'win32' }, () => {
  const root = fixture()
  const helpers = ['prebuilds/darwin-arm64', 'prebuilds/darwin-x64', 'build/Release', 'build/Debug']
    .map(directory => payload(root, directory))
  for (const helper of helpers) assert.equal(spawnSync(helper).error?.code, 'EACCES')
  const options = { platform: 'darwin', arch: 'universal', packageDir: root }
  assert.equal(prepareTerminalRuntime(options).length, 4)
  const modified = helpers.map(helper => fs.statSync(helper).ctimeMs)
  prepareTerminalRuntime(options)
  assert.deepEqual(helpers.map(helper => fs.statSync(helper).ctimeMs), modified)
  for (const helper of helpers) {
    assert.equal(fs.statSync(helper).mode & 0o777, 0o755)
    const result = spawnSync(helper, { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.equal(result.stdout, 'HELPER_OK')
  }
})

test('prepares the actual .app unpacked payload before signing and rejects a missing architecture', { skip: process.platform === 'win32' }, () => {
  const root = fixture()
  const packageDir = path.join(root, 'Aryn.app/Contents/Resources/app.asar.unpacked/node_modules/node-pty')
  const helper = payload(packageDir, 'prebuilds/darwin-arm64')
  const context = { electronPlatformName: 'darwin', arch: Arch.arm64,
    appOutDir: root, packager: { appInfo: { productFilename: 'Aryn' } } }
  afterPack(context)
  assert.equal(spawnSync(helper).status, 0)
  assert.throws(() => afterPack({ ...context, arch: Arch.x64 }), /x64/)
})

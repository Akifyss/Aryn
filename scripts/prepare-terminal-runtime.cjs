const fs = require('node:fs')
const path = require('node:path')

/**
 * node-pty 1.1.0 publishes both Darwin spawn-helpers as 0644. Its install
 * script accepts these prebuilds without restoring +x, so require('node-pty')
 * succeeds but the first PTY fails with posix_spawnp. Prepare the artifact
 * before launch/signing; never mutate an installed, signed application.
 * Upstream: https://github.com/microsoft/node-pty/pull/858
 */
function prepareTerminalRuntime({ platform = process.platform, arch = process.arch, packageDir } = {}) {
  if (platform !== 'darwin') return []
  packageDir ??= path.dirname(require.resolve('node-pty/package.json'))
  const architectures = arch === 'universal' ? ['x64', 'arm64'] : [arch]
  const prepared = new Set()
  for (const architecture of architectures) {
    // Keep in step with node-pty 1.1.0's native loader, including source builds.
    const directories = ['build/Release', 'build/Debug', `prebuilds/darwin-${architecture}`]
    let found = false
    for (const directory of directories) {
      const nativePath = path.join(packageDir, directory, 'pty.node')
      if (!fs.existsSync(nativePath)) continue
      const helperPath = path.join(packageDir, directory, 'spawn-helper')
      let helper
      try { helper = fs.lstatSync(helperPath) }
      catch (cause) { throw new Error(`macOS 终端运行库不完整，缺少 ${helperPath}`, { cause }) }
      if (!helper.isFile()) throw new Error(`macOS 终端辅助程序不是普通文件：${helperPath}`)
      try {
        if ((helper.mode & 0o111) !== 0o111) fs.chmodSync(helperPath, (helper.mode & 0o777) | 0o111)
        fs.accessSync(helperPath, fs.constants.X_OK)
      } catch (cause) {
        throw new Error(`无法准备 macOS 终端辅助程序的执行权限：${helperPath}`, { cause })
      }
      prepared.add(helperPath)
      found = true
    }
    if (!found) throw new Error(`未找到 macOS ${architecture} 终端运行库：${packageDir}`)
  }
  return [...prepared]
}

module.exports = { prepareTerminalRuntime }

if (require.main === module) {
  for (const helper of prepareTerminalRuntime()) console.log(`[terminal-runtime] Executable: ${helper}`)
}

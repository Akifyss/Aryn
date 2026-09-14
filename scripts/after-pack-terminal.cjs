const path = require('node:path')
const { Arch } = require('builder-util')
const { prepareTerminalRuntime } = require('./prepare-terminal-runtime.cjs')

// electron-builder runs afterPack after copying/unpacking, before code signing.
// Check the shipped files too: dependency rebuild/copy can replace prepared files.
module.exports = context => {
  if (context.electronPlatformName !== 'darwin') return
  const packageDir = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`,
    'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', 'node-pty')
  prepareTerminalRuntime({ platform: 'darwin', arch: Arch[context.arch], packageDir })
}

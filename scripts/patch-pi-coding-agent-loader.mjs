import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const targetPath = path.resolve(
  process.cwd(),
  'node_modules',
  '@earendil-works',
  'pi-coding-agent',
  'dist',
  'core',
  'extensions',
  'loader.js',
)

const originalSnippet = '...(isBunBinary ? { virtualModules: VIRTUAL_MODULES, tryNative: false } : { alias: getAliases() }),'
const patchedSnippet = '...(isBunBinary || process.env.PI_FORCE_VIRTUAL_MODULES === "1" ? { virtualModules: VIRTUAL_MODULES, tryNative: false } : { alias: getAliases() }),'

if (!existsSync(targetPath)) {
  console.warn(`[patch-pi-coding-agent-loader] Skipped because ${targetPath} was not found.`)
  process.exit(0)
}

const source = readFileSync(targetPath, 'utf8')

if (source.includes(patchedSnippet)) {
  console.log('[patch-pi-coding-agent-loader] Already patched.')
  process.exit(0)
}

if (!source.includes(originalSnippet)) {
  throw new Error('[patch-pi-coding-agent-loader] Expected snippet was not found. Upstream package may have changed.')
}

writeFileSync(targetPath, source.replace(originalSnippet, patchedSnippet), 'utf8')
console.log('[patch-pi-coding-agent-loader] Applied runtime virtual module patch.')

import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'packages', 'bb-session-surface', 'dist')
const target = path.join(root, 'public', 'bb-session-surface')
const normalizedRoot = `${path.resolve(root)}${path.sep}`
const normalizedTarget = path.resolve(target)

if (!`${normalizedTarget}${path.sep}`.startsWith(normalizedRoot)) {
  throw new Error(`Refusing to replace unexpected surface target: ${normalizedTarget}`)
}

await rm(normalizedTarget, { recursive: true, force: true })
await mkdir(normalizedTarget, { recursive: true })
await cp(source, normalizedTarget, { recursive: true })

console.log(`Synced bb session surface to ${path.relative(root, normalizedTarget)}.`)

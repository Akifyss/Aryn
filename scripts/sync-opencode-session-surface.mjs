import { copyFile, cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = path.join(root, 'packages', 'opencode-session-surface')
const source = path.join(packageRoot, 'dist')
const target = path.join(root, 'public', 'opencode-session-surface')
const publicRoot = path.join(root, 'public')

if (path.dirname(target) !== publicRoot) {
  throw new Error(`Refusing to sync OpenCode surface outside public/: ${target}`)
}

await rm(target, { force: true, recursive: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
await Promise.all([
  copyFile(path.join(packageRoot, 'LICENSE'), path.join(target, 'LICENSE')),
  copyFile(path.join(packageRoot, 'UPSTREAM.md'), path.join(target, 'UPSTREAM.md')),
])

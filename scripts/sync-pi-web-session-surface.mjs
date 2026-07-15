import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'packages', 'pi-web-session-surface', 'dist')
const packageRoot = path.join(root, 'packages', 'pi-web-session-surface')
const target = path.join(root, 'public', 'pi-web-session-surface')
const publicRoot = path.join(root, 'public')

if (path.dirname(target) !== publicRoot) {
  throw new Error(`Refusing to sync pi-web surface outside public/: ${target}`)
}

await rm(target, { force: true, recursive: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })
await cp(path.join(packageRoot, 'LICENSE'), path.join(target, 'LICENSE'))
await cp(path.join(packageRoot, 'UPSTREAM.md'), path.join(target, 'UPSTREAM.md'))

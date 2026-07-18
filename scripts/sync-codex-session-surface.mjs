import { cp, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'packages', 'codex-session-surface', 'dist')
const target = path.join(root, 'public', 'codex-session-surface')

await rm(target, { force: true, recursive: true })
await mkdir(target, { recursive: true })
await cp(source, target, { recursive: true })

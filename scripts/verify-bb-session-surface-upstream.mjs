import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = path.join(root, 'packages', 'bb-session-surface')
const manifestPath = path.join(packageRoot, 'vendor-manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(entryPath))
    if (entry.isFile()) files.push(entryPath)
  }
  return files
}

const documented = new Set(manifest.files.map((entry) => entry.path))
const actual = await listFiles(path.join(packageRoot, 'src', 'upstream'))
const actualRelative = actual.map((filePath) => path.relative(packageRoot, filePath).split(path.sep).join('/'))

const undocumented = actualRelative.filter((filePath) => !documented.has(filePath))
const missing = [...documented].filter((filePath) => !actualRelative.includes(filePath))
const modified = []

for (const entry of manifest.files) {
  const filePath = path.join(packageRoot, entry.path)
  let contents
  try {
    contents = await readFile(filePath)
  } catch {
    continue
  }
  const hash = createHash('sha256').update(contents).digest('hex').toUpperCase()
  if (hash !== entry.sha256) modified.push(entry.path)
}

if (undocumented.length || missing.length || modified.length) {
  const details = [
    undocumented.length ? `Undocumented upstream files:\n${undocumented.join('\n')}` : '',
    missing.length ? `Missing upstream files:\n${missing.join('\n')}` : '',
    modified.length ? `Modified upstream files:\n${modified.join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
  throw new Error(details)
}

console.log(`Verified ${manifest.files.length} bb upstream files at ${manifest.upstreamCommit}.`)

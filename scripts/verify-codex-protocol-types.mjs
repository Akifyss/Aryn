import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const generatedDir = path.join(rootDir, 'src/features/agent/codex-protocol/generated')
const expectedFileCount = 598
const expectedAggregateHash = '245C5862B40E007052542BB0DE70B68F7AD57475DD371748BA34D602147C603B'

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(absolutePath))
    else if (entry.isFile()) files.push(absolutePath)
  }
  return files
}

const files = (await listFiles(generatedDir)).sort()
const hash = createHash('sha256')

for (const absolutePath of files) {
  const relativePath = path.relative(generatedDir, absolutePath).split(path.sep).join('/')
  hash.update(relativePath)
  hash.update('\0')
  hash.update(await readFile(absolutePath))
  hash.update('\0')
}

const actualAggregateHash = hash.digest('hex').toUpperCase()
if (files.length !== expectedFileCount || actualAggregateHash !== expectedAggregateHash) {
  throw new Error(
    'Generated Codex App Server protocol types differ from the pinned official output.\n' +
      `Expected: ${expectedFileCount} files, SHA-256 ${expectedAggregateHash}\n` +
      `Actual:   ${files.length} files, SHA-256 ${actualAggregateHash}\n` +
      'Regenerate the complete tree with the command documented in ' +
      'src/features/agent/codex-protocol/UPSTREAM.md and review the protocol diff.',
  )
}

console.log(`Verified ${files.length} generated Codex protocol files (${actualAggregateHash}).`)

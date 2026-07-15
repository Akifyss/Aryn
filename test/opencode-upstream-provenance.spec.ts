import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const upstreamRoot = 'packages/opencode-session-surface/src/upstream'
const pinnedTreeHash = '6e7eb57377f838c22b223f4ba5d5fd9af1e650d4dd77d2a6d329a4f6686e3522'

const pinnedFiles = {
  'packages/opencode-session-surface/src/upstream/app/context/server-session.ts': '650e991cc6a9e50d4a409737ee303e3680ca2cfbfb83ca60901a737f68d0e884',
  'packages/opencode-session-surface/src/upstream/session-ui/components/basic-tool.css': '798f91d4177d71f942b141aa8d6a1170722ad3be1e77e29cde51b2d86b39df7d',
  'packages/opencode-session-surface/src/upstream/session-ui/components/basic-tool.tsx': 'db2dc775668d146338f83f949a78698cb0f91a776941a2b3527c0379312f8de4',
  'packages/opencode-session-surface/src/upstream/session-ui/components/markdown.css': 'ae3e60175ee07e1d92300d17efc87950977f043db26475968e22127363a8c772',
  'packages/opencode-session-surface/src/upstream/session-ui/components/markdown.tsx': '49487aa7df0f9f2a565106f05a53f489738516efeed027d01108ce53d4f6c631',
  'packages/opencode-session-surface/src/upstream/session-ui/components/message-part.css': 'efed98bcb9a70f5e011f6dd4ec40040438ad377b423fd5ca0fd7d9009575e2e6',
  'packages/opencode-session-surface/src/upstream/session-ui/components/message-part.tsx': 'e42354a4b9355f9c27576471b41296c2adaa68a25f4f0e7d0cd54eca359c6c74',
  'packages/opencode-session-surface/src/upstream/session-ui/components/session-turn.css': '45e513f3ae05ed73c5a6a063870b4d7b26da248c34506129bb6e1ca7f6e02658',
  'packages/opencode-session-surface/src/upstream/session-ui/components/session-turn.tsx': '5523cbc31f9eb782c889c3c9d1d52891121b6b0acc441540401ad5e652cc322d',
  'packages/opencode-session-surface/src/upstream/session-ui/context/data.tsx': 'c68cd31a336b691bf1fcc16a200568a7a1fff08af6afbd4ad8a73210641e7d7e',
} as const

function normalizedHash(value: string) {
  const normalized = `${value.replaceAll('\r\n', '\n').trimEnd()}\n`
  return createHash('sha256').update(normalized).digest('hex')
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return files.flat()
}

async function normalizedTreeHash(directory: string) {
  const hash = createHash('sha256')
  const files = (await listFiles(directory)).sort((left, right) => left.localeCompare(right))
  for (const filePath of files) {
    const relativePath = path.relative(directory, filePath).replaceAll('\\', '/')
    const content = `${(await readFile(filePath, 'utf8')).replaceAll('\r\n', '\n').trimEnd()}\n`
    hash.update(relativePath).update('\0').update(content).update('\0')
  }
  return { fileCount: files.length, hash: hash.digest('hex') }
}

describe('OpenCode upstream provenance', () => {
  it('keeps the official state and message-rendering core byte-equivalent to the pinned commit', async () => {
    for (const [filePath, expectedHash] of Object.entries(pinnedFiles)) {
      const content = await readFile(filePath, 'utf8')
      expect(normalizedHash(content), filePath).toBe(expectedHash)
    }
  })

  it('keeps the complete copied OpenCode source snapshot equivalent to the pinned commit', async () => {
    await expect(normalizedTreeHash(upstreamRoot)).resolves.toEqual({
      fileCount: 162,
      hash: pinnedTreeHash,
    })
  })
})

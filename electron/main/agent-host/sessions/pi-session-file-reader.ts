import { readFile, stat } from 'node:fs/promises'
import {
  migrateSessionEntries,
  parseSessionEntries,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent'

const DEFAULT_MAX_CACHED_SESSION_FILES = 8

export type PiSessionFileSnapshot = {
  branchEntries: SessionEntry[]
  name: string | null
  sessionId: string
  sessionPath: string
  workspacePath: string
}

type CachedSessionFile = {
  signature: string
  value: PiSessionFileSnapshot
}

function sessionFileSignature(value: Awaited<ReturnType<typeof stat>>) {
  return `${value.size}:${value.mtimeMs}:${value.ctimeMs}`
}

function parseSessionFile(content: string, sessionPath: string): PiSessionFileSnapshot {
  const fileEntries = parseSessionEntries(content)
  const header = fileEntries[0]
  if (!header || header.type !== 'session' || typeof header.id !== 'string') {
    throw new Error('Invalid session path.')
  }
  migrateSessionEntries(fileEntries)
  const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== 'session')
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]))
  const reversedBranch: SessionEntry[] = []
  const visited = new Set<string>()
  let current = entries.at(-1)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    reversedBranch.push(current)
    current = current.parentId ? entriesById.get(current.parentId) : undefined
  }
  const sessionInfo = [...entries].reverse().find((entry) => entry.type === 'session_info')
  return {
    branchEntries: reversedBranch.reverse(),
    name: sessionInfo?.type === 'session_info' ? sessionInfo.name?.trim() || null : null,
    sessionId: header.id,
    sessionPath,
    workspacePath: header.cwd,
  }
}

export class PiSessionFileReader {
  private readonly cache = new Map<string, CachedSessionFile>()

  constructor(private readonly maxCachedFiles = DEFAULT_MAX_CACHED_SESSION_FILES) {}

  async read(sessionPath: string) {
    const initialStat = await stat(sessionPath)
    const signature = sessionFileSignature(initialStat)
    const cached = this.cache.get(sessionPath)
    if (cached?.signature === signature) {
      this.cache.delete(sessionPath)
      this.cache.set(sessionPath, cached)
      return cached.value
    }

    const content = await readFile(sessionPath, 'utf8')
    const value = parseSessionFile(content, sessionPath)
    const finalStat = await stat(sessionPath)
    if (sessionFileSignature(finalStat) === signature) {
      this.cache.delete(sessionPath)
      this.cache.set(sessionPath, { signature, value })
      while (this.cache.size > this.maxCachedFiles) {
        const oldestPath = this.cache.keys().next().value
        if (typeof oldestPath !== 'string') break
        this.cache.delete(oldestPath)
      }
    }
    return value
  }
}

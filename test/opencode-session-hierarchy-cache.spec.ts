import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { OpencodeClient, Session } from '@opencode-ai/sdk/v2'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenCodeSessionCatalog } from '../electron/main/agent-host/providers/opencode/session-catalog'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )))
})

function createClient(session: Session) {
  return {
    session: {
      get: vi.fn(async () => ({ data: session })),
      list: vi.fn(async () => ({ data: [session] })),
    },
  } as unknown as OpencodeClient
}

describe('OpenCode session hierarchy cache', () => {
  it('coalesces requests per server client without reusing data across reconnects', async () => {
    const agentDir = await mkdtemp(path.join(os.tmpdir(), 'aryn-opencode-hierarchy-'))
    tempDirectories.push(agentDir)
    const cwd = path.join(agentDir, 'workspace')
    const session = {
      directory: cwd,
      id: 'session-1',
      parentID: undefined,
      time: { created: 1, updated: 1 },
      title: 'Session',
    } as unknown as Session
    const firstClient = createClient(session)
    const secondClient = createClient({ ...session, title: 'Reconnected session' })
    const catalog = new OpenCodeSessionCatalog(agentDir)

    const [first, coalesced] = await Promise.all([
      catalog.loadHierarchy(firstClient, cwd, session.id),
      catalog.loadHierarchy(firstClient, cwd, session.id),
    ])
    const reconnected = await catalog.loadHierarchy(secondClient, cwd, session.id)

    expect(first).toBe(coalesced)
    expect(first.session.title).toBe('Session')
    expect(reconnected.session.title).toBe('Reconnected session')
    expect(firstClient.session.get).toHaveBeenCalledTimes(1)
    expect(secondClient.session.get).toHaveBeenCalledTimes(1)
  })
})

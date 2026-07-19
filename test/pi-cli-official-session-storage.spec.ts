import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { PiCliAgentManager } from '../electron/main/pi-cli-agent'

function legacySessionDirectory(agentDir: string, cwd: string) {
  const resolved = path.resolve(cwd)
  const identity = process.platform === 'win32' ? resolved.toLowerCase() : resolved
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 20)
  return path.join(agentDir, 'external', 'pi', 'sessions', hash)
}

function appendAssistantMessage(session: SessionManager, text: string, timestamp: number) {
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    model: 'test-model',
    provider: 'test-provider',
    stopReason: 'stop',
    timestamp,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 1,
      output: 1,
      totalTokens: 2,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    },
  })
}

describe('PI CLI official session storage', () => {
  const originalSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR

  afterEach(() => {
    if (originalSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = originalSessionDir
  })

  it('lists sessions created outside Aryn and never discards them as Aryn drafts', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-official-'))
    const workspace = path.join(tempRoot, 'workspace')
    const officialDir = path.join(tempRoot, 'official-sessions')
    const agentDir = path.join(tempRoot, 'aryn-data')
    process.env.PI_CODING_AGENT_SESSION_DIR = officialDir
    await mkdir(workspace, { recursive: true })

    const officialSession = SessionManager.create(workspace, officialDir)
    officialSession.appendSessionInfo('Created in PI CLI')
    officialSession.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'This session originated outside Aryn.' }],
      timestamp: 1_775_667_950_000,
    })
    appendAssistantMessage(officialSession, 'Official response.', 1_775_667_950_100)
    const sessionFile = officialSession.getSessionFile()
    const manager = new PiCliAgentManager({ agentDir, emitEvent: () => undefined })

    try {
      await expect(manager.listSessionItems(workspace)).resolves.toEqual([
        expect.objectContaining({
          id: officialSession.getSessionId(),
          messageCount: 2,
          name: 'Created in PI CLI',
          preview: 'Created in PI CLI',
        }),
      ])

      await manager.discardWorkspaceSessions(workspace)
      await expect(stat(sessionFile ?? '').then((value) => value.isFile())).resolves.toBe(true)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('moves legacy Aryn PI CLI sessions into the configured official directory before listing them', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-migration-'))
    const workspace = path.join(tempRoot, 'workspace')
    const officialDir = path.join(tempRoot, 'official-sessions')
    const agentDir = path.join(tempRoot, 'aryn-data')
    const legacyDir = legacySessionDirectory(agentDir, workspace)
    process.env.PI_CODING_AGENT_SESSION_DIR = officialDir
    await mkdir(workspace, { recursive: true })

    const legacySession = SessionManager.create(workspace, legacyDir)
    legacySession.appendMessage({
      role: 'user',
      content: [{ type: 'text', text: 'Move this legacy session safely.' }],
      timestamp: 1_775_667_951_000,
    })
    appendAssistantMessage(legacySession, 'Legacy response.', 1_775_667_951_100)
    const legacyFile = legacySession.getSessionFile()
    const manager = new PiCliAgentManager({ agentDir, emitEvent: () => undefined })

    try {
      await expect(manager.listSessionItems(workspace)).resolves.toEqual([
        expect.objectContaining({ id: legacySession.getSessionId() }),
      ])
      const migrated = await SessionManager.list(workspace, officialDir)
      expect(migrated.map((session) => session.id)).toEqual([legacySession.getSessionId()])
      await expect(stat(legacyFile ?? '')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(migrated[0].path).then((value) => value.isFile())).resolves.toBe(true)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})

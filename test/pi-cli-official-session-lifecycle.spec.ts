import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'

const rpcState = vi.hoisted(() => ({
  failSetSessionName: false,
  processStarts: 0,
}))

vi.mock('../electron/main/json-line-process', async () => {
  const { SessionManager: OfficialSessionManager } = await import('@earendil-works/pi-coding-agent')

  class FakePiRpcProcess {
    private sessionPromise: Promise<InstanceType<typeof OfficialSessionManager>> | null = null

    constructor(private readonly options: { args: string[]; cwd: string }) {}

    start() {
      rpcState.processStarts += 1
    }

    stop() {}

    notify() {}

    async request(message: Record<string, unknown>) {
      if (message.type === 'get_available_models') return { data: { models: [] } }

      const session = await this.getSession()
      if (message.type === 'get_state') {
        return {
          data: {
            isStreaming: false,
            sessionName: session.getSessionName(),
            thinkingLevel: 'medium',
          },
        }
      }
      if (message.type === 'get_messages') {
        return { data: { messages: session.buildSessionContext().messages } }
      }
      if (message.type === 'set_session_name') {
        const name = String(message.name ?? '').trim()
        if (!name) throw new Error('Session name cannot be empty.')
        if (rpcState.failSetSessionName) throw new Error('PI RPC set_session_name failed.')
        session.appendSessionInfo(name)
        return { success: true }
      }

      throw new Error(`Unexpected PI RPC request: ${String(message.type)}`)
    }

    private getSession() {
      this.sessionPromise ??= this.openSession()
      return this.sessionPromise
    }

    private async openSession() {
      if (this.options.args.includes('--no-session')) {
        return OfficialSessionManager.inMemory(this.options.cwd)
      }

      const sessionArgument = this.options.args.indexOf('--session')
      if (sessionArgument < 0) throw new Error('Fake PI RPC only supports existing official sessions.')
      const sessionID = this.options.args[sessionArgument + 1]
      const sessionDir = process.env.PI_CODING_AGENT_SESSION_DIR
      const info = (await OfficialSessionManager.list(this.options.cwd, sessionDir))
        .find((candidate) => candidate.id === sessionID)
      if (!info) throw new Error(`Official PI session not found: ${sessionID}`)
      return OfficialSessionManager.open(info.path, sessionDir, this.options.cwd)
    }
  }

  return { JsonLineProcess: FakePiRpcProcess }
})

import { PiCliAgentManager } from '../electron/main/pi-cli-agent'

type PiIndexRecord = {
  createdAt: string
  cwd: string
  id: string
  materialized: boolean
  modelKey: null
  name: string
  thinkingLevel: 'medium'
  updatedAt: string
}

function appendConversation(session: SessionManager) {
  session.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'Keep this official PI conversation.' }],
    timestamp: 1_775_668_000_000,
  })
  session.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'It remains readable after restart.' }],
    api: 'openai-completions',
    model: 'test-model',
    provider: 'test-provider',
    stopReason: 'stop',
    timestamp: 1_775_668_000_100,
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

async function writeOwnedIndex(agentDir: string, record: PiIndexRecord) {
  const indexPath = path.join(agentDir, 'external', 'pi', 'sessions.json')
  await mkdir(path.dirname(indexPath), { recursive: true })
  await writeFile(indexPath, `${JSON.stringify({ sessions: [record], version: 1 }, null, 2)}\n`, 'utf8')
  return indexPath
}

async function readOwnedIndex(indexPath: string) {
  return JSON.parse(await readFile(indexPath, 'utf8')) as { sessions: PiIndexRecord[]; version: 1 }
}

describe('PI CLI official session lifecycle', () => {
  const originalSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR

  beforeEach(() => {
    rpcState.failSetSessionName = false
    rpcState.processStarts = 0
  })

  afterEach(() => {
    if (originalSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = originalSessionDir
  })

  it('opens, renames, restarts, and explicitly deletes an external official session', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-lifecycle-'))
    const workspace = path.join(tempRoot, 'workspace')
    const officialDir = path.join(tempRoot, 'official-sessions')
    const agentDir = path.join(tempRoot, 'aryn-data')
    process.env.PI_CODING_AGENT_SESSION_DIR = officialDir
    await mkdir(workspace, { recursive: true })

    const officialSession = SessionManager.create(workspace, officialDir)
    officialSession.appendSessionInfo('Created outside Aryn')
    appendConversation(officialSession)
    const sessionID = officialSession.getSessionId()
    const sessionFile = officialSession.getSessionFile() ?? ''
    const firstManager = new PiCliAgentManager({ agentDir, emitEvent: () => undefined })
    let restartedManager: PiCliAgentManager | null = null

    try {
      const opened = await firstManager.openSession(workspace, sessionID)
      expect(opened.activeSession).toMatchObject({
        name: 'Created outside Aryn',
        native: {
          agentId: 'pi',
          messages: [
            expect.objectContaining({ role: 'user' }),
            expect.objectContaining({ role: 'assistant' }),
          ],
          sessionId: sessionID,
        },
      })

      await firstManager.renameSession(workspace, sessionID, 'Renamed in Aryn')
      await expect(SessionManager.list(workspace, officialDir)).resolves.toEqual([
        expect.objectContaining({ id: sessionID, name: 'Renamed in Aryn' }),
      ])

      firstManager.dispose()
      restartedManager = new PiCliAgentManager({ agentDir, emitEvent: () => undefined })
      await expect(restartedManager.listSessionItems(workspace)).resolves.toEqual([
        expect.objectContaining({ id: sessionID, messageCount: 2, name: 'Renamed in Aryn' }),
      ])
      await expect(restartedManager.openSession(workspace, sessionID)).resolves.toMatchObject({
        activeSession: { name: 'Renamed in Aryn', sessionId: sessionID },
      })

      await restartedManager.deleteSession(workspace, sessionID)
      await expect(restartedManager.sessionExists(workspace, sessionID)).resolves.toBe(false)
      await expect(stat(sessionFile)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      firstManager.dispose()
      restartedManager?.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('keeps official, runtime, and owned-index names unchanged when rename validation or PI RPC fails', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-rename-failure-'))
    const workspace = path.join(tempRoot, 'workspace')
    const officialDir = path.join(tempRoot, 'official-sessions')
    const agentDir = path.join(tempRoot, 'aryn-data')
    process.env.PI_CODING_AGENT_SESSION_DIR = officialDir
    await mkdir(workspace, { recursive: true })

    const officialSession = SessionManager.create(workspace, officialDir)
    officialSession.appendSessionInfo('Original name')
    appendConversation(officialSession)
    const sessionID = officialSession.getSessionId()
    const now = new Date().toISOString()
    const indexPath = await writeOwnedIndex(agentDir, {
      createdAt: now,
      cwd: workspace,
      id: sessionID,
      materialized: true,
      modelKey: null,
      name: 'Original name',
      thinkingLevel: 'medium',
      updatedAt: now,
    })
    const manager = new PiCliAgentManager({ agentDir, emitEvent: () => undefined })

    try {
      await expect(manager.renameSession(workspace, sessionID, '   ')).rejects.toThrow('不能为空')
      expect(rpcState.processStarts).toBe(0)
      expect((await readOwnedIndex(indexPath)).sessions[0].name).toBe('Original name')

      await manager.openSession(workspace, sessionID)
      rpcState.failSetSessionName = true
      await expect(manager.renameSession(workspace, sessionID, 'Uncommitted name')).rejects.toThrow(
        'PI RPC set_session_name failed.',
      )

      expect((await readOwnedIndex(indexPath)).sessions[0].name).toBe('Original name')
      await expect(manager.readSession(workspace, sessionID)).resolves.toMatchObject({ name: 'Original name' })
      await expect(SessionManager.list(workspace, officialDir)).resolves.toEqual([
        expect.objectContaining({ id: sessionID, name: 'Original name' }),
      ])
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('retains Aryn ownership when deleting the official session file fails', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-delete-failure-'))
    const workspace = path.join(tempRoot, 'workspace')
    const officialDir = path.join(tempRoot, 'official-sessions')
    const agentDir = path.join(tempRoot, 'aryn-data')
    process.env.PI_CODING_AGENT_SESSION_DIR = officialDir
    await mkdir(workspace, { recursive: true })

    const officialSession = SessionManager.create(workspace, officialDir)
    officialSession.appendSessionInfo('Owned session')
    appendConversation(officialSession)
    const sessionID = officialSession.getSessionId()
    const sessionFile = officialSession.getSessionFile() ?? ''
    const now = new Date().toISOString()
    const indexPath = await writeOwnedIndex(agentDir, {
      createdAt: now,
      cwd: workspace,
      id: sessionID,
      materialized: true,
      modelKey: null,
      name: 'Owned session',
      thinkingLevel: 'medium',
      updatedAt: now,
    })
    const removeSessionFile = vi.fn(async () => {
      throw new Error('cannot delete official file')
    })
    const manager = new PiCliAgentManager({
      agentDir,
      emitEvent: () => undefined,
      removeSessionFile,
    })

    try {
      await expect(manager.deleteSession(workspace, sessionID)).rejects.toThrow('cannot delete official file')
      expect(removeSessionFile).toHaveBeenCalledWith(sessionFile)
      expect((await readOwnedIndex(indexPath)).sessions.map((record) => record.id)).toEqual([sessionID])
      await expect(stat(sessionFile).then((value) => value.isFile())).resolves.toBe(true)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('does not open an official session through a different workspace', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-workspace-isolation-'))
    const workspaceA = path.join(tempRoot, 'workspace-a')
    const workspaceB = path.join(tempRoot, 'workspace-b')
    const officialDir = path.join(tempRoot, 'official-sessions')
    const agentDir = path.join(tempRoot, 'aryn-data')
    process.env.PI_CODING_AGENT_SESSION_DIR = officialDir
    await Promise.all([mkdir(workspaceA, { recursive: true }), mkdir(workspaceB, { recursive: true })])

    const officialSession = SessionManager.create(workspaceA, officialDir)
    appendConversation(officialSession)
    const manager = new PiCliAgentManager({ agentDir, emitEvent: () => undefined })

    try {
      await expect(manager.openSession(workspaceB, officialSession.getSessionId())).rejects.toThrow(
        'PI CLI session not found for this workspace.',
      )
      expect(rpcState.processStarts).toBe(0)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})

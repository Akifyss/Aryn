import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import type { AgentClientEventPayload } from '../src/features/agent/types'

type FakeProcessInstance = {
  emit: (message: Record<string, unknown>) => void
  exit: (error: Error) => void
  notifications: Array<Record<string, unknown>>
  sessionID: string | null
  stopCount: number
}

const rpcState = vi.hoisted(() => ({
  getMessagesGate: null as Promise<void> | null,
  getStateGate: null as Promise<void> | null,
  getStateGates: new Map<string, Promise<void>>(),
  instances: [] as FakeProcessInstance[],
  onGetMessages: null as ((sessionID: string | null) => void) | null,
  onGetState: null as ((sessionID: string | null) => void) | null,
}))

vi.mock('../electron/main/json-line-process', () => {
  class FakePiRpcProcess implements FakeProcessInstance {
    notifications: Array<Record<string, unknown>> = []
    stopCount = 0

    constructor(private readonly options: {
      args: string[]
      onEvent: (message: Record<string, unknown>) => void
      onExit?: (error: Error) => void
    }) {
      rpcState.instances.push(this)
    }

    get sessionID() {
      const existingIndex = this.options.args.indexOf('--session')
      if (existingIndex >= 0) return this.options.args[existingIndex + 1] ?? null
      const createdIndex = this.options.args.indexOf('--session-id')
      return createdIndex >= 0 ? this.options.args[createdIndex + 1] ?? null : null
    }

    start() {}

    stop() {
      this.stopCount += 1
    }

    notify(message: Record<string, unknown>) {
      this.notifications.push(message)
    }

    emit(message: Record<string, unknown>) {
      this.options.onEvent(message)
    }

    exit(error: Error) {
      this.options.onExit?.(error)
    }

    async request(message: Record<string, unknown>) {
      if (message.type === 'get_available_models') return { data: { models: [] } }
      if (message.type === 'get_state') {
        rpcState.onGetState?.(this.sessionID)
        await ((this.sessionID ? rpcState.getStateGates.get(this.sessionID) : null) ?? rpcState.getStateGate)
        return { data: { isStreaming: false, thinkingLevel: 'medium' } }
      }
      if (message.type === 'get_messages') {
        rpcState.onGetMessages?.(this.sessionID)
        await rpcState.getMessagesGate
        return { data: { messages: [] } }
      }
      if (
        message.type === 'abort'
        || message.type === 'prompt'
        || message.type === 'set_model'
        || message.type === 'set_session_name'
        || message.type === 'set_thinking_level'
      ) return { success: true }
      throw new Error(`Unexpected PI RPC request: ${String(message.type)}`)
    }
  }

  return { JsonLineProcess: FakePiRpcProcess }
})

import { PiCliAgentManager } from '../electron/main/pi-cli-agent'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createOfficialSession(workspace: string, sessionDir: string, name: string) {
  const session = SessionManager.create(workspace, sessionDir)
  session.appendSessionInfo(name)
  session.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: name }],
    timestamp: Date.now(),
  })
  session.appendMessage({
    role: 'assistant',
    api: 'openai-completions',
    content: [{ type: 'text', text: `${name} response` }],
    model: 'test-model',
    provider: 'test-provider',
    stopReason: 'stop',
    timestamp: Date.now() + 1,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 1,
      output: 1,
      totalTokens: 2,
    },
  })
  return session.getSessionId()
}

function processInstances(sessionID: string) {
  return rpcState.instances.filter((instance) => instance.sessionID === sessionID)
}

describe('PI CLI runtime coordination', () => {
  const originalSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR

  beforeEach(() => {
    rpcState.getMessagesGate = null
    rpcState.getStateGate = null
    rpcState.getStateGates.clear()
    rpcState.instances = []
    rpcState.onGetMessages = null
    rpcState.onGetState = null
  })

  afterEach(() => {
    if (originalSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR
    else process.env.PI_CODING_AGENT_SESSION_DIR = originalSessionDir
  })

  it('single-flights concurrent opens and keeps background sessions alive', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-runtime-open-'))
    const workspace = path.join(tempRoot, 'workspace')
    const sessionDir = path.join(tempRoot, 'sessions')
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir
    await mkdir(workspace, { recursive: true })
    const sessionA = createOfficialSession(workspace, sessionDir, 'Session A')
    const sessionB = createOfficialSession(workspace, sessionDir, 'Session B')
    const events: AgentClientEventPayload[] = []
    const manager = new PiCliAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })

    try {
      await Promise.all([
        manager.openSession(workspace, sessionA),
        manager.openSession(workspace, sessionA),
      ])
      expect(processInstances(sessionA)).toHaveLength(1)

      const processA = processInstances(sessionA)[0]!
      await manager.openSession(workspace, sessionB)
      expect(processA.stopCount).toBe(0)

      events.length = 0
      await manager.sendPrompt(workspace, sessionA, 'continue in the background')
      expect(events.findLast((event) => event.type === 'workspace_state')).toMatchObject({
        state: { activeSession: { sessionId: sessionB } },
        type: 'workspace_state',
      })

      events.length = 0
      processA.emit({ type: 'queue_update', followUp: ['background work'], steering: [] })
      await manager.drainSessionEvents(workspace, sessionA)
      const stateEvent = events.findLast((event) => event.type === 'workspace_state')
      expect(stateEvent).toMatchObject({
        state: { activeSession: { sessionId: sessionB } },
        type: 'workspace_state',
      })
      expect(processA.stopCount).toBe(0)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('keeps the latest activation when an earlier session finishes opening later', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-runtime-activation-'))
    const workspace = path.join(tempRoot, 'workspace')
    const sessionDir = path.join(tempRoot, 'sessions')
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir
    await mkdir(workspace, { recursive: true })
    const sessionA = createOfficialSession(workspace, sessionDir, 'Slow session A')
    const sessionB = createOfficialSession(workspace, sessionDir, 'Latest session B')
    const slowStartEntered = deferred()
    const allowSlowStart = deferred()
    rpcState.getStateGates.set(sessionA, allowSlowStart.promise)
    rpcState.onGetState = (candidate) => {
      if (candidate === sessionA) slowStartEntered.resolve()
    }
    const events: AgentClientEventPayload[] = []
    const manager = new PiCliAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })

    try {
      const earlierOpen = manager.openSession(workspace, sessionA)
      await slowStartEntered.promise
      await manager.openSession(workspace, sessionB)
      allowSlowStart.resolve()
      await expect(earlierOpen).rejects.toThrow('workspace activation was superseded')

      events.length = 0
      processInstances(sessionB)[0]!.emit({ type: 'queue_update', followUp: ['latest work'], steering: [] })
      await manager.drainSessionEvents(workspace, sessionB)

      expect(events.findLast((event) => event.type === 'workspace_state')).toMatchObject({
        state: { activeSession: { sessionId: sessionB } },
        type: 'workspace_state',
      })
    } finally {
      allowSlowStart.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('orders deletion behind an in-flight start and does not resurrect the deleted session', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-runtime-delete-'))
    const workspace = path.join(tempRoot, 'workspace')
    const sessionDir = path.join(tempRoot, 'sessions')
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir
    await mkdir(workspace, { recursive: true })
    const sessionID = createOfficialSession(workspace, sessionDir, 'Delete race')
    const startEntered = deferred()
    const allowStart = deferred()
    rpcState.getStateGate = allowStart.promise
    rpcState.onGetState = (candidate) => {
      if (candidate === sessionID) startEntered.resolve()
    }
    const events: AgentClientEventPayload[] = []
    const manager = new PiCliAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })

    try {
      const opening = manager.openSession(workspace, sessionID)
      await startEntered.promise
      const deletion = manager.deleteSession(workspace, sessionID)
      allowStart.resolve()

      const [openResult, deleteResult] = await Promise.allSettled([opening, deletion])
      expect(openResult).toMatchObject({
        reason: expect.objectContaining({ message: expect.stringContaining('workspace activation was superseded') }),
        status: 'rejected',
      })
      expect(deleteResult).toEqual({ status: 'fulfilled', value: expect.any(Object) })
      expect(processInstances(sessionID)).toHaveLength(1)
      expect(processInstances(sessionID)[0]?.stopCount).toBeGreaterThan(0)
      await expect(manager.sessionExists(workspace, sessionID)).resolves.toBe(false)
      await expect(manager.openSession(workspace, sessionID)).rejects.toThrow('not found for this workspace')
      expect(processInstances(sessionID)).toHaveLength(1)
      expect(events.findLast((event) => event.type === 'workspace_state')).toMatchObject({
        state: { activeSession: null, sessions: [] },
        type: 'workspace_state',
      })
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('ignores events and exit callbacks from a retired runtime generation', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-runtime-generation-'))
    const workspace = path.join(tempRoot, 'workspace')
    const sessionDir = path.join(tempRoot, 'sessions')
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir
    await mkdir(workspace, { recursive: true })
    const sessionID = createOfficialSession(workspace, sessionDir, 'Generation')
    const events: AgentClientEventPayload[] = []
    const manager = new PiCliAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })

    try {
      await manager.openSession(workspace, sessionID)
      const oldProcess = processInstances(sessionID)[0]!
      await manager.releaseWorkspaceRuntime(workspace)
      await manager.openSession(workspace, sessionID)
      const newProcess = processInstances(sessionID)[1]!
      events.length = 0

      oldProcess.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'stale' } })
      oldProcess.exit(new Error('old process exited late'))
      newProcess.emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'current' } })
      await manager.drainSessionEvents(workspace, sessionID)

      expect(events).toContainEqual({
        type: 'assistant_message_delta',
        delta: 'current',
        sessionId: sessionID,
      })
      expect(events).not.toContainEqual(expect.objectContaining({ delta: 'stale' }))
      expect(events).not.toContainEqual(expect.objectContaining({ message: expect.stringContaining('old process exited late') }))
      expect(newProcess.stopCount).toBe(0)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('suppresses an in-flight workspace snapshot after the workspace is released', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-runtime-workspace-revision-'))
    const workspace = path.join(tempRoot, 'workspace')
    const sessionDir = path.join(tempRoot, 'sessions')
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir
    await mkdir(workspace, { recursive: true })
    const sessionID = createOfficialSession(workspace, sessionDir, 'Workspace revision')
    const messagesEntered = deferred()
    const allowMessages = deferred()
    rpcState.getMessagesGate = allowMessages.promise
    rpcState.onGetMessages = (candidate) => {
      if (candidate === sessionID) messagesEntered.resolve()
    }
    const events: AgentClientEventPayload[] = []
    const manager = new PiCliAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })

    try {
      const opening = manager.openSession(workspace, sessionID)
      await messagesEntered.promise
      const release = manager.releaseWorkspaceRuntime(workspace)
      allowMessages.resolve()
      await Promise.all([opening, release])

      expect(events.filter((event) => event.type === 'workspace_state')).toEqual([])
      expect(processInstances(sessionID)).toHaveLength(1)
      expect(processInstances(sessionID)[0]?.stopCount).toBeGreaterThan(0)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('keeps interactions and deletion isolated per session', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-pi-runtime-interactions-'))
    const workspace = path.join(tempRoot, 'workspace')
    const sessionDir = path.join(tempRoot, 'sessions')
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir
    await mkdir(workspace, { recursive: true })
    const sessionA = createOfficialSession(workspace, sessionDir, 'Interaction A')
    const sessionB = createOfficialSession(workspace, sessionDir, 'Interaction B')
    const manager = new PiCliAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      await manager.openSession(workspace, sessionA)
      await manager.openSession(workspace, sessionB)
      const processA = processInstances(sessionA)[0]!
      const processB = processInstances(sessionB)[0]!
      processA.emit({ id: 'request-a', method: 'confirm', message: 'Allow A?', type: 'extension_ui_request' })
      processB.emit({ id: 'request-b', method: 'confirm', message: 'Allow B?', type: 'extension_ui_request' })
      await Promise.all([
        manager.drainSessionEvents(workspace, sessionA),
        manager.drainSessionEvents(workspace, sessionB),
      ])

      expect(manager.respondToInteraction({
        agentId: 'pi',
        optionId: 'allow_once',
        requestId: 'request-a',
        sessionId: sessionA,
      })).toBe(true)
      expect(processA.notifications).toEqual([
        { confirmed: true, id: 'request-a', type: 'extension_ui_response' },
      ])
      expect(processB.notifications).toEqual([])

      await manager.deleteSession(workspace, sessionA)
      expect(processB.stopCount).toBe(0)
      expect(manager.respondToInteraction({
        agentId: 'pi',
        optionId: 'deny',
        requestId: 'request-b',
        sessionId: sessionB,
      })).toBe(true)
      expect(processB.notifications).toEqual([
        { cancelled: true, id: 'request-b', type: 'extension_ui_response' },
      ])
      await expect(manager.readSession(workspace, sessionB)).resolves.toMatchObject({ sessionId: sessionB })
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})

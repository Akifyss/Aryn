import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Thread } from '../src/features/agent/codex-protocol/generated/v2/Thread'
import type { AgentClientEventPayload } from '../src/features/agent/types'

type FakeClientInstance = {
  emit: (notification: Record<string, unknown>) => void
  exit: (error: Error) => void
  requestServer: (request: Record<string, unknown>) => void
  requests: Array<{ method: string, params: Record<string, unknown> }>
  responses: Array<{ id: string | number, result: unknown }>
  stopCount: number
}

const rpcState = vi.hoisted(() => ({
  deleteErrors: [] as Error[],
  instances: [] as FakeClientInstance[],
  onResume: null as ((threadId: string) => void) | null,
  resumeGates: new Map<string, Promise<void>>(),
  threads: new Map<string, Thread>(),
  unsubscribeErrors: [] as Error[],
}))

vi.mock('../electron/main/external-cli-environment', () => ({
  prepareExternalCliEnvironment: async () => undefined,
}))

vi.mock('../electron/main/codex-rpc-client', () => ({
  CodexRpcClient: class implements FakeClientInstance {
    requests: Array<{ method: string, params: Record<string, unknown> }> = []
    responses: Array<{ id: string | number, result: unknown }> = []
    stopCount = 0

    constructor(private readonly options: {
      onExit: (error: Error) => void
      onNotification: (notification: Record<string, unknown>) => void
      onRequest: (request: Record<string, unknown>) => void
    }) {
      rpcState.instances.push(this)
    }

    start() {}

    stop() {
      this.stopCount += 1
    }

    notifyInitialized() {}

    respond(id: string | number, result: unknown) {
      this.responses.push({ id, result })
    }

    respondError(id: string | number, code: number, message: string) {
      this.responses.push({ id, result: { error: { code, message } } })
    }

    emit(notification: Record<string, unknown>) {
      this.options.onNotification(notification)
    }

    requestServer(request: Record<string, unknown>) {
      this.options.onRequest(request)
    }

    exit(error: Error) {
      this.options.onExit(error)
    }

    async request(method: string, params: Record<string, unknown>) {
      this.requests.push({ method, params })
      if (method === 'initialize') return {}
      if (method === 'account/read') return { account: null, requiresOpenaiAuth: false }
      if (method === 'model/list') return { data: [], nextCursor: null }
      if (method === 'thread/list') {
        return {
          data: [...rpcState.threads.values()].filter((thread) => thread.cwd === params.cwd),
          nextCursor: null,
        }
      }
      if (method === 'thread/resume') {
        const threadId = String(params.threadId)
        rpcState.onResume?.(threadId)
        await rpcState.resumeGates.get(threadId)
        const current = rpcState.threads.get(threadId)
        if (!current) throw new Error('thread not found')
        return {
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          cwd: current.cwd,
          instructionSources: [],
          model: 'gpt-test',
          modelProvider: 'openai',
          reasoningEffort: 'medium',
          sandbox: { type: 'workspaceWrite' },
          serviceTier: null,
          thread: structuredClone(current),
        }
      }
      if (method === 'thread/read') {
        const current = rpcState.threads.get(String(params.threadId))
        if (!current) throw new Error('thread not found')
        return { thread: structuredClone(current) }
      }
      if (method === 'thread/delete') {
        const failure = rpcState.deleteErrors.shift()
        if (failure) throw failure
        rpcState.threads.delete(String(params.threadId))
        return {}
      }
      if (method === 'thread/archive') {
        rpcState.threads.delete(String(params.threadId))
        return {}
      }
      if (method === 'thread/unsubscribe') {
        const failure = rpcState.unsubscribeErrors.shift()
        if (failure) throw failure
        return {}
      }
      if (method === 'thread/name/set' || method === 'turn/interrupt' || method === 'turn/steer') return {}
      if (method === 'turn/start') {
        return {
          turn: {
            completedAt: null,
            durationMs: null,
            error: null,
            id: `turn-${this.requests.length}`,
            items: [],
            itemsView: 'full',
            startedAt: Date.now(),
            status: 'inProgress',
          },
        }
      }
      throw new Error(`Unexpected Codex request: ${method}`)
    }
  },
}))

import { CodexAgentManager } from '../electron/main/codex-agent'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function thread(cwd: string, id: string, status: Thread['status'] = { type: 'idle' }): Thread {
  return {
    agentNickname: null,
    agentRole: null,
    cliVersion: '0.144.5',
    createdAt: Date.now(),
    cwd,
    ephemeral: false,
    forkedFromId: null,
    gitInfo: null,
    id,
    modelProvider: 'openai',
    name: id,
    parentThreadId: null,
    path: null,
    preview: id,
    recencyAt: null,
    sessionId: `session-${id}`,
    source: 'appServer',
    status,
    threadSource: 'aryn',
    turns: [],
    updatedAt: Date.now(),
  }
}

function resumeCount(threadId: string) {
  return rpcState.instances.flatMap((instance) => instance.requests)
    .filter((request) => request.method === 'thread/resume' && request.params.threadId === threadId)
    .length
}

describe('Codex thread binding coordination', () => {
  beforeEach(() => {
    rpcState.deleteErrors = []
    rpcState.instances = []
    rpcState.onResume = null
    rpcState.resumeGates.clear()
    rpcState.threads.clear()
    rpcState.unsubscribeErrors = []
  })

  it('single-flights the same thread while keeping another thread bound in the background', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-open-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    rpcState.threads.set('thread-b', thread(workspace, 'thread-b'))
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      await Promise.all([
        manager.openSession(workspace, 'thread-a'),
        manager.openSession(workspace, 'thread-a'),
      ])
      expect(resumeCount('thread-a')).toBe(1)

      await manager.openSession(workspace, 'thread-b')
      const state = await manager.abortActivePrompt(workspace, 'thread-a')
      expect(state.activeSession?.sessionId).toBe('thread-b')
      expect(resumeCount('thread-a')).toBe(1)
      expect(resumeCount('thread-b')).toBe(1)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('keeps the latest activation when an earlier thread finishes resuming later', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-activation-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    rpcState.threads.set('thread-b', thread(workspace, 'thread-b'))
    const resumeEntered = deferred()
    const allowResume = deferred()
    rpcState.resumeGates.set('thread-a', allowResume.promise)
    rpcState.onResume = (threadId) => {
      if (threadId === 'thread-a') resumeEntered.resolve()
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      const earlierOpen = manager.openSession(workspace, 'thread-a').catch((error: unknown) => error)
      await resumeEntered.promise
      await manager.openSession(workspace, 'thread-b')
      allowResume.resolve()
      await expect(earlierOpen).resolves.toMatchObject({
        message: expect.stringContaining('workspace state request was superseded'),
      })

      const state = await manager.abortActivePrompt(workspace, 'thread-a')
      expect(state.activeSession?.sessionId).toBe('thread-b')
    } finally {
      allowResume.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('orders deletion behind an in-flight resume and does not resurrect the deleted thread', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-delete-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    const resumeEntered = deferred()
    const allowResume = deferred()
    rpcState.resumeGates.set('thread-a', allowResume.promise)
    rpcState.onResume = (threadId) => {
      if (threadId === 'thread-a') resumeEntered.resolve()
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      const opening = manager.openSession(workspace, 'thread-a')
        .then(() => null, (error: unknown) => error)
      await resumeEntered.promise
      const deletion = manager.deleteSession(workspace, 'thread-a')
      allowResume.resolve()

      await expect(opening).resolves.toMatchObject({
        message: expect.stringContaining('workspace state request was superseded'),
      })
      await expect(deletion).resolves.toMatchObject({ activeSession: null, sessions: [] })
      expect(resumeCount('thread-a')).toBe(1)
      await expect(manager.sessionExists(workspace, 'thread-a')).resolves.toBe(false)
      await expect(manager.openSession(workspace, 'thread-a')).rejects.toThrow('not found for this workspace')
      expect(resumeCount('thread-a')).toBe(1)
    } finally {
      allowResume.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('preserves a binding when provider deletion fails so the operation can be retried', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-delete-retry-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    rpcState.deleteErrors.push(new Error('provider delete failed'))
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      await manager.openSession(workspace, 'thread-a')
      await expect(manager.deleteSession(workspace, 'thread-a')).rejects.toThrow('provider delete failed')
      await expect(manager.sessionExists(workspace, 'thread-a')).resolves.toBe(true)
      expect(resumeCount('thread-a')).toBe(1)

      await expect(manager.deleteSession(workspace, 'thread-a')).resolves.toMatchObject({ sessions: [] })
      await expect(manager.sessionExists(workspace, 'thread-a')).resolves.toBe(false)
      expect(resumeCount('thread-a')).toBe(1)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('keeps another thread and its interaction isolated while deleting a background thread', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-isolation-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    rpcState.threads.set('thread-b', thread(workspace, 'thread-b'))
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })
    const internals = manager as unknown as { bindings: Map<string, unknown> }

    try {
      await manager.openSession(workspace, 'thread-a')
      await manager.openSession(workspace, 'thread-b')
      const client = rpcState.instances[0]!
      client.requestServer({
        id: 11,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'command a', itemId: 'item-a', threadId: 'thread-a', turnId: 'turn-a' },
      })
      client.requestServer({
        id: 12,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'command b', itemId: 'item-b', threadId: 'thread-b', turnId: 'turn-b' },
      })

      expect(manager.respondToInteraction({
        agentId: 'codex',
        optionId: 'allow_once',
        requestId: 'codex:11',
        sessionId: 'thread-a',
      })).toBe(true)
      await manager.deleteSession(workspace, 'thread-a')

      expect(internals.bindings.has('thread-a')).toBe(false)
      expect(internals.bindings.has('thread-b')).toBe(true)
      expect(manager.respondToInteraction({
        agentId: 'codex',
        optionId: 'deny',
        requestId: 'codex:12',
        sessionId: 'thread-b',
      })).toBe(true)
      expect(client.responses).toEqual([
        { id: 11, result: { decision: 'accept' } },
        { id: 12, result: { decision: 'decline' } },
      ])
      await expect(manager.readSession(workspace, 'thread-b')).resolves.toMatchObject({ sessionId: 'thread-b' })
      expect(resumeCount('thread-b')).toBe(1)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('ignores notifications and requests from a disconnected App Server generation', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-connection-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    const events: AgentClientEventPayload[] = []
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })
    const internals = manager as unknown as {
      bindings: Map<string, { activeTurnId: string | null }>
      pendingInteractions: Map<string, unknown>
    }

    try {
      await manager.openSession(workspace, 'thread-a')
      const oldClient = rpcState.instances[0]!
      oldClient.exit(new Error('connection lost'))
      await vi.waitFor(() => expect(internals.bindings.has('thread-a')).toBe(false))
      await manager.openSession(workspace, 'thread-a')
      const newClient = rpcState.instances[1]!
      events.length = 0

      oldClient.emit({
        method: 'turn/started',
        params: {
          threadId: 'thread-a',
          turn: {
            completedAt: null,
            durationMs: null,
            error: null,
            id: 'turn-stale',
            items: [],
            itemsView: 'full',
            startedAt: 1,
            status: 'inProgress',
          },
        },
      })
      oldClient.requestServer({
        id: 7,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'stale', itemId: 'item-stale', threadId: 'thread-a', turnId: 'turn-stale' },
      })
      newClient.emit({
        method: 'turn/started',
        params: {
          threadId: 'thread-a',
          turn: {
            completedAt: null,
            durationMs: null,
            error: null,
            id: 'turn-current',
            items: [],
            itemsView: 'full',
            startedAt: 2,
            status: 'inProgress',
          },
        },
      })
      await manager.drainSessionEvents(workspace, 'thread-a')

      expect(internals.bindings.get('thread-a')?.activeTurnId).toBe('turn-current')
      expect(internals.pendingInteractions.size).toBe(0)
      expect(events).not.toContainEqual(expect.objectContaining({
        request: expect.objectContaining({ id: 'codex:7' }),
      }))
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('invalidates a binding that is still resuming when the App Server exits', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-start-exit-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    const resumeEntered = deferred()
    const allowResume = deferred()
    rpcState.resumeGates.set('thread-a', allowResume.promise)
    rpcState.onResume = (threadId) => {
      if (threadId === 'thread-a') resumeEntered.resolve()
    }
    const events: AgentClientEventPayload[] = []
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })
    const internals = manager as unknown as { bindings: Map<string, unknown> }

    try {
      const opening = manager.openSession(workspace, 'thread-a')
        .then(() => null, (error: unknown) => error)
      await resumeEntered.promise
      rpcState.instances[0]!.exit(new Error('connection lost during resume'))
      allowResume.resolve()

      await expect(opening).resolves.toMatchObject({
        message: expect.stringMatching(/superseded during resume|invalidated during initialization/),
      })
      expect(internals.bindings.has('thread-a')).toBe(false)
      expect(events.filter((event) => event.type === 'workspace_state')).toEqual([])
    } finally {
      allowResume.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('does not resurrect an in-flight binding after its workspace is released', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-release-race-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    rpcState.threads.set('thread-b', thread(workspace, 'thread-b'))
    const resumeEntered = deferred()
    const allowResume = deferred()
    rpcState.resumeGates.set('thread-a', allowResume.promise)
    rpcState.onResume = (threadId) => {
      if (threadId === 'thread-a') resumeEntered.resolve()
    }
    const events: AgentClientEventPayload[] = []
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: (event) => events.push(event),
    })
    const internals = manager as unknown as { bindings: Map<string, unknown> }

    try {
      const opening = manager.openSession(workspace, 'thread-a')
        .then(() => null, (error: unknown) => error)
      await resumeEntered.promise
      const release = manager.releaseWorkspaceRuntime(workspace)
      await expect(manager.openSession(workspace, 'thread-b')).rejects.toThrow('workspace operation was superseded')
      expect(resumeCount('thread-b')).toBe(0)
      allowResume.resolve()

      await expect(opening).resolves.toMatchObject({
        message: expect.stringContaining('workspace operation was superseded'),
      })
      await expect(release).resolves.toBeUndefined()
      expect(internals.bindings.has('thread-a')).toBe(false)
      expect(events.filter((event) => event.type === 'workspace_state')).toEqual([])
      expect(rpcState.instances[0]?.requests).toContainEqual({
        method: 'thread/unsubscribe',
        params: { threadId: 'thread-a' },
      })
    } finally {
      allowResume.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('retires interactions with their binding even when native unsubscribe fails', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-interaction-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    rpcState.unsubscribeErrors.push(new Error('unsubscribe failed'))
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })
    const internals = manager as unknown as {
      bindings: Map<string, unknown>
      pendingInteractions: Map<string, unknown>
    }

    try {
      await manager.openSession(workspace, 'thread-a')
      const client = rpcState.instances[0]!
      client.requestServer({
        id: 9,
        method: 'item/commandExecution/requestApproval',
        params: { command: 'echo test', itemId: 'item-1', threadId: 'thread-a', turnId: 'turn-1' },
      })
      expect(internals.pendingInteractions.size).toBe(1)

      await expect(manager.releaseWorkspaceRuntime(workspace)).rejects.toThrow('could not be released')
      expect(internals.bindings.has('thread-a')).toBe(false)
      expect(internals.pendingInteractions.size).toBe(0)
      expect(manager.respondToInteraction({
        agentId: 'codex',
        optionId: 'allow_once',
        requestId: 'codex:9',
        sessionId: 'thread-a',
      })).toBe(false)

      await manager.openSession(workspace, 'thread-a')
      expect(resumeCount('thread-a')).toBe(2)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})

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
  initializeHook: null as ((clientIndex: number) => Promise<void>) | null,
  instances: [] as FakeClientInstance[],
  listHook: null as (() => Promise<void>) | null,
  onResume: null as ((threadId: string) => void) | null,
  readHook: null as ((threadId: string) => Promise<void>) | null,
  resumeGates: new Map<string, Promise<void>>(),
  startHook: null as ((startIndex: number) => Promise<void>) | null,
  startThreadIds: [] as string[],
  starts: 0,
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
      if (method === 'initialize') {
        await rpcState.initializeHook?.(rpcState.instances.indexOf(this))
        return {}
      }
      if (method === 'account/read') return { account: null, requiresOpenaiAuth: false }
      if (method === 'model/list') return { data: [], nextCursor: null }
      if (method === 'thread/list') {
        await rpcState.listHook?.()
        return {
          data: [...rpcState.threads.values()].filter((thread) => thread.cwd === params.cwd),
          nextCursor: null,
        }
      }
      if (method === 'thread/start') {
        const startIndex = rpcState.starts
        rpcState.starts += 1
        await rpcState.startHook?.(startIndex)
        const id = rpcState.startThreadIds[startIndex] ?? `created-thread-${startIndex + 1}`
        const created = thread(String(params.cwd), id)
        return {
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          cwd: created.cwd,
          instructionSources: [],
          model: 'gpt-test',
          modelProvider: 'openai',
          reasoningEffort: 'medium',
          sandbox: { type: 'workspaceWrite' },
          serviceTier: null,
          thread: created,
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
        const threadId = String(params.threadId)
        await rpcState.readHook?.(threadId)
        const current = rpcState.threads.get(threadId)
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
    rpcState.initializeHook = null
    rpcState.instances = []
    rpcState.listHook = null
    rpcState.onResume = null
    rpcState.readHook = null
    rpcState.resumeGates.clear()
    rpcState.startHook = null
    rpcState.startThreadIds = []
    rpcState.starts = 0
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

  it('rolls back a newly created thread when a later creation wins activation', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-create-activation-'))
    const workspace = path.join(tempRoot, 'workspace')
    const firstStartEntered = deferred()
    const allowFirstStart = deferred()
    rpcState.startThreadIds = ['thread-a', 'thread-b']
    rpcState.startHook = async (startIndex) => {
      if (startIndex !== 0) return
      firstStartEntered.resolve()
      await allowFirstStart.promise
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })
    const internals = manager as unknown as { bindings: Map<string, unknown> }

    try {
      const earlierCreation = manager.createSession(workspace)
        .then(() => null, (error: unknown) => error)
      await firstStartEntered.promise
      await expect(manager.createSession(workspace)).resolves.toMatchObject({
        activeSession: expect.objectContaining({ sessionId: 'thread-b' }),
      })
      allowFirstStart.resolve()

      await expect(earlierCreation).resolves.toMatchObject({
        message: expect.stringContaining('activation was superseded'),
      })
      await expect(manager.listSessionItems(workspace)).resolves.toEqual([
        expect.objectContaining({ id: 'thread-b' }),
      ])
      expect(internals.bindings.has('thread-a')).toBe(false)
      expect(internals.bindings.has('thread-b')).toBe(true)
      expect(rpcState.instances[0]?.requests).toContainEqual({
        method: 'thread/unsubscribe',
        params: { threadId: 'thread-a' },
      })
    } finally {
      allowFirstStart.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('does not leave an indexed draft when creation is superseded by workspace release', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-create-release-'))
    const workspace = path.join(tempRoot, 'workspace')
    const startEntered = deferred()
    const allowStart = deferred()
    rpcState.startThreadIds = ['thread-created']
    rpcState.startHook = async () => {
      startEntered.resolve()
      await allowStart.promise
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      const creation = manager.createSession(workspace)
        .then(() => null, (error: unknown) => error)
      await startEntered.promise
      const release = manager.releaseWorkspaceRuntime(workspace)
      allowStart.resolve()

      await expect(creation).resolves.toMatchObject({
        message: expect.stringContaining('was superseded'),
      })
      await expect(release).resolves.toBeUndefined()
      await expect(manager.sessionExists(workspace, 'thread-created')).resolves.toBe(false)
      expect(rpcState.instances[0]?.requests).toContainEqual({
        method: 'thread/unsubscribe',
        params: { threadId: 'thread-created' },
      })
    } finally {
      allowStart.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('does not bind a thread/start result from a disconnected App Server client', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-create-client-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.startThreadIds = ['thread-stale']
    rpcState.startHook = async () => {
      rpcState.instances[0]!.exit(new Error('client exited after thread/start'))
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })
    const internals = manager as unknown as { bindings: Map<string, unknown> }

    try {
      await expect(manager.createSession(workspace)).rejects.toThrow('connection was superseded')
      expect(internals.bindings.has('thread-stale')).toBe(false)
      await expect(manager.sessionExists(workspace, 'thread-stale')).resolves.toBe(false)
    } finally {
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('retains ownership after failed rollback cleanup and lets discard retry it', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-create-cleanup-retry-'))
    const workspace = path.join(tempRoot, 'workspace')
    const startEntered = deferred()
    const allowStart = deferred()
    rpcState.startThreadIds = ['thread-owned']
    rpcState.startHook = async () => {
      startEntered.resolve()
      await allowStart.promise
    }
    rpcState.unsubscribeErrors.push(new Error('temporary unsubscribe failure'))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      const creation = manager.createSession(workspace)
        .then(() => null, (error: unknown) => error)
      await startEntered.promise
      const release = manager.releaseWorkspaceRuntime(workspace)
      allowStart.resolve()
      await expect(creation).resolves.toBeInstanceOf(Error)
      await release

      await expect(manager.sessionExists(workspace, 'thread-owned')).resolves.toBe(true)
      await expect(manager.discardWorkspaceSessions(workspace)).resolves.toBeUndefined()
      await expect(manager.sessionExists(workspace, 'thread-owned')).resolves.toBe(false)
      const unsubscribeRequests = rpcState.instances[0]!.requests.filter((request) => (
        request.method === 'thread/unsubscribe'
        && request.params.threadId === 'thread-owned'
      ))
      expect(unsubscribeRequests).toHaveLength(2)
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('temporary unsubscribe failure'))
    } finally {
      allowStart.resolve()
      manager.dispose()
      warning.mockRestore()
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

  it('cancels a deletion that was still discovering its record when workspace release began', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-delete-release-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    const listEntered = deferred()
    const allowList = deferred()
    rpcState.listHook = async () => {
      listEntered.resolve()
      await allowList.promise
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      const deletion = manager.deleteSession(workspace, 'thread-a')
        .then(() => null, (error: unknown) => error)
      await listEntered.promise
      await manager.releaseWorkspaceRuntime(workspace)
      allowList.resolve()

      await expect(deletion).resolves.toMatchObject({
        message: expect.stringContaining('workspace operation was superseded'),
      })
      expect(rpcState.threads.has('thread-a')).toBe(true)
      expect(rpcState.instances[0]?.requests).not.toContainEqual(expect.objectContaining({
        method: 'thread/delete',
      }))
    } finally {
      allowList.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('does not reinstall a replacement binding after workspace release passes the index-swap point', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-replacement-release-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.startThreadIds = ['draft-thread', 'replacement-thread']
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })
    const internals = manager as unknown as {
      bindings: Map<string, unknown>
      runtimeCoordinator: { retire: (key: string) => Promise<unknown> }
    }
    const originalRetire = internals.runtimeCoordinator.retire.bind(internals.runtimeCoordinator)
    const replacementReachedRetirement = deferred()
    const allowReplacementRetirement = deferred()
    internals.runtimeCoordinator.retire = async (key) => {
      if (key.endsWith('\0draft-thread')) {
        replacementReachedRetirement.resolve()
        await allowReplacementRetirement.promise
      }
      return originalRetire(key)
    }

    try {
      await manager.createSession(workspace)
      await manager.releaseWorkspaceRuntime(workspace)
      const opening = manager.openSession(workspace, 'draft-thread')
        .then(() => null, (error: unknown) => error)
      await replacementReachedRetirement.promise
      const release = manager.releaseWorkspaceRuntime(workspace)
      allowReplacementRetirement.resolve()

      await expect(opening).resolves.toMatchObject({
        message: expect.stringContaining('workspace operation was superseded'),
      })
      await expect(release).resolves.toBeUndefined()
      expect(internals.bindings.has('replacement-thread')).toBe(false)
      await expect(manager.listSessionItems(workspace)).resolves.toEqual([
        expect.objectContaining({ id: 'draft-thread' }),
      ])
    } finally {
      allowReplacementRetirement.resolve()
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

  it('does not hydrate stale thread/read data after its App Server client exits', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-read-exit-'))
    const workspace = path.join(tempRoot, 'workspace')
    rpcState.threads.set('thread-a', thread(workspace, 'thread-a'))
    const readEntered = deferred()
    const allowRead = deferred()
    rpcState.readHook = async (threadId) => {
      if (threadId !== 'thread-a') return
      readEntered.resolve()
      await allowRead.promise
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })
    const internals = manager as unknown as {
      bindings: Map<string, unknown>
      sessionStore: { get: (threadId: string) => unknown }
    }

    try {
      await manager.openSession(workspace, 'thread-a')
      const reading = manager.readSession(workspace, 'thread-a')
        .then(() => null, (error: unknown) => error)
      await readEntered.promise
      rpcState.instances[0]!.exit(new Error('connection lost during read'))
      allowRead.resolve()

      await expect(reading).resolves.toMatchObject({
        message: expect.stringContaining('binding was superseded'),
      })
      expect(internals.bindings.has('thread-a')).toBe(false)
      expect(internals.sessionStore.get('thread-a')).toBeNull()
    } finally {
      allowRead.resolve()
      manager.dispose()
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('does not let a rejected old initialization clear a newer App Server client', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-runtime-client-race-'))
    const firstInitializeEntered = deferred()
    const allowFirstInitialize = deferred()
    rpcState.initializeHook = async (clientIndex) => {
      if (clientIndex !== 0) return
      firstInitializeEntered.resolve()
      await allowFirstInitialize.promise
      throw new Error('old initialization failed')
    }
    const manager = new CodexAgentManager({
      agentDir: path.join(tempRoot, 'agent-data'),
      emitEvent: () => undefined,
    })

    try {
      const firstLoad = manager.loadDraftState().then(() => null, (error: unknown) => error)
      await firstInitializeEntered.promise
      rpcState.instances[0]!.exit(new Error('old client exited'))
      await expect(manager.loadDraftState()).resolves.toMatchObject({ activeSession: null })
      expect(rpcState.instances).toHaveLength(2)

      allowFirstInitialize.resolve()
      await expect(firstLoad).resolves.toMatchObject({ message: 'old initialization failed' })
      await expect(manager.loadDraftState()).resolves.toMatchObject({ activeSession: null })
      expect(rpcState.instances).toHaveLength(2)
    } finally {
      allowFirstInitialize.resolve()
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

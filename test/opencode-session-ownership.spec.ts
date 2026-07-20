import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdkState = vi.hoisted(() => ({
  abortCount: 0,
  abortFails: false,
  createCount: 0,
  createGate: null as Promise<void> | null,
  createStarted: 0,
  deleteFails: false,
  deleteGate: null as Promise<void> | null,
  deleteStarted: 0,
  deletedSessionIds: [] as string[],
  getFailureSessionIds: [] as string[],
  getGate: null as Promise<void> | null,
  getStarted: 0,
  globalEventQueue: [] as Array<Record<string, any>>,
  globalEventSubscribeCount: 0,
  globalEventWaiters: [] as Array<(result: IteratorResult<Record<string, any>>) => void>,
  healthGate: null as Promise<void> | null,
  healthStarted: 0,
  healthVersion: '1.17.18',
  instanceEventSubscribeCount: 0,
  messageResponses: [] as Array<Promise<Array<Record<string, any>>> | Array<Record<string, any>>>,
  messagesReadCount: 0,
  pendingPermissions: [] as Array<Record<string, any>>,
  pendingQuestions: [] as Array<Record<string, any>>,
  permissionReplyCount: 0,
  providerFails: false,
  promptedRequests: [] as Array<Record<string, any>>,
  promptedSessionIds: [] as string[],
  sessions: [] as Array<Record<string, any>>,
  updateFails: false,
}))

vi.mock('@opencode-ai/sdk/v2', () => {
  const client = {
    app: {
      agents: async () => [{ mode: 'primary', name: 'build' }],
    },
    config: {
      providers: async () => {
        if (sdkState.providerFails) throw new Error('provider list failed')
        return {
          default: { test: 'model' },
          providers: [{
            id: 'test',
            models: {
              model: {
                capabilities: { input: { image: false }, reasoning: true },
                id: 'model',
                variants: { high: {} },
              },
            },
          }],
        }
      },
    },
    event: {
      subscribe: async () => {
        sdkState.instanceEventSubscribeCount += 1
        return {
          stream: {
            [Symbol.asyncIterator]() {
              return { next: () => new Promise<IteratorResult<never>>(() => undefined) }
            },
          },
        }
      },
    },
    global: {
      health: async () => {
        sdkState.healthStarted += 1
        await sdkState.healthGate
        return { healthy: true, version: sdkState.healthVersion }
      },
      event: async () => {
        sdkState.globalEventSubscribeCount += 1
        return {
          stream: {
            [Symbol.asyncIterator]() {
              return {
                next: () => {
                  const queued = sdkState.globalEventQueue.shift()
                  if (queued?.__streamDone) return Promise.resolve({ done: true as const, value: undefined })
                  if (queued) return Promise.resolve({ done: false as const, value: queued })
                  return new Promise<IteratorResult<Record<string, any>>>((resolve) => {
                    sdkState.globalEventWaiters.push(resolve)
                  })
                },
              }
            },
          },
        }
      },
    },
    permission: {
      list: async () => sdkState.pendingPermissions,
      reply: async () => {
        sdkState.permissionReplyCount += 1
        return {}
      },
    },
    provider: {
      list: async () => ({
        all: [{ id: 'test', models: {}, name: 'Test' }],
        connected: ['test'],
        default: { test: 'model' },
      }),
    },
    question: {
      list: async () => sdkState.pendingQuestions,
      reject: async () => ({}),
      reply: async () => ({}),
    },
    session: {
      abort: async () => {
        sdkState.abortCount += 1
        if (sdkState.abortFails) throw new Error('abort failed')
        return {}
      },
      create: async ({ directory, metadata, title }: { directory: string, metadata?: Record<string, unknown>, title?: string }) => {
        sdkState.createStarted += 1
        await sdkState.createGate
        const now = Date.now()
        const session = {
          directory,
          id: `aryn-owned-session-${++sdkState.createCount}`,
          metadata,
          parentID: undefined,
          time: { created: now, updated: now },
          title,
          workspaceDirectory: directory,
        }
        sdkState.sessions.push(session)
        return session
      },
      delete: async ({ sessionID }: { sessionID: string }) => {
        sdkState.deleteStarted += 1
        await sdkState.deleteGate
        if (sdkState.deleteFails) throw new Error('delete failed')
        sdkState.deletedSessionIds.push(sessionID)
        sdkState.sessions = sdkState.sessions.filter((session) => session.id !== sessionID)
        return true
      },
      diff: async () => [],
      get: async ({ sessionID }: { sessionID: string }) => {
        sdkState.getStarted += 1
        await sdkState.getGate
        if (sdkState.getFailureSessionIds.includes(sessionID)) {
          throw new Error(`transient session lookup failure: ${sessionID}`)
        }
        return sdkState.sessions.find((session) => session.id === sessionID)
      },
      list: async ({ directory, roots }: { directory: string, roots?: boolean }) => sdkState.sessions.filter((session) => (
        (session.workspaceDirectory ?? session.directory) === directory
        && (!roots || !session.parentID)
      )),
      message: async ({ messageID, sessionID }: { messageID: string, sessionID: string }) => ({
        info: { id: messageID, role: 'user', sessionID, time: { created: 1 } },
        parts: [],
      }),
      messages: async () => {
        sdkState.messagesReadCount += 1
        return await (sdkState.messageResponses.shift() ?? [])
      },
      prompt: async () => ({}),
      promptAsync: async (request: Record<string, any>) => {
        const sessionID = String(request.sessionID)
        sdkState.promptedRequests.push(request)
        sdkState.promptedSessionIds.push(sessionID)
        return {}
      },
      status: async () => Object.fromEntries(sdkState.sessions.map((session) => [
        session.id,
        session.runtimeStatus ?? { type: 'idle' },
      ])),
      todo: async () => [],
      update: async ({ metadata, sessionID, title }: {
        metadata?: Record<string, unknown>
        sessionID: string
        title?: string
      }) => {
        if (sdkState.updateFails) throw new Error('metadata update unavailable')
        const session = sdkState.sessions.find((candidate) => candidate.id === sessionID)
        if (!session) throw new Error(`Session not found: ${sessionID}`)
        if (metadata !== undefined) session.metadata = metadata
        if (title !== undefined) session.title = title
        session.time.updated = Date.now()
        return session
      },
    },
    v2: {
      session: {
        permission: {
          reply: async () => {
            sdkState.permissionReplyCount += 1
            return {}
          },
        },
        question: { reject: async () => ({}), reply: async () => ({}) },
      },
    },
  }

  return {
    createOpencodeClient: () => client,
  }
})

import { OpenCodeAgentManager } from '../electron/main/opencode-agent'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function emitGlobalEvent(directory: string, payload: Record<string, any>) {
  const envelope = { directory, payload }
  const waiter = sdkState.globalEventWaiters.shift()
  if (waiter) {
    waiter({ done: false, value: envelope })
  } else {
    sdkState.globalEventQueue.push(envelope)
  }
}

function endGlobalEventStream() {
  const waiter = sdkState.globalEventWaiters.shift()
  if (waiter) {
    waiter({ done: true, value: undefined })
  } else {
    sdkState.globalEventQueue.push({ __streamDone: true })
  }
}

describe('OpenCode Aryn session ownership', () => {
  let agentDir: string
  let workspacePath: string

  beforeEach(async () => {
    agentDir = await mkdtemp(path.join(tmpdir(), 'aryn-opencode-agent-'))
    workspacePath = path.join(agentDir, 'workspace')
    const now = Date.now()
    sdkState.abortCount = 0
    sdkState.abortFails = false
    sdkState.createGate = null
    sdkState.createStarted = 0
    sdkState.deleteFails = false
    sdkState.deleteGate = null
    sdkState.deleteStarted = 0
    sdkState.deletedSessionIds = []
    sdkState.getFailureSessionIds = []
    sdkState.getGate = null
    sdkState.getStarted = 0
    sdkState.globalEventQueue = []
    sdkState.globalEventSubscribeCount = 0
    sdkState.globalEventWaiters = []
    sdkState.healthGate = null
    sdkState.healthStarted = 0
    sdkState.healthVersion = '1.17.18'
    sdkState.instanceEventSubscribeCount = 0
    sdkState.messageResponses = []
    sdkState.messagesReadCount = 0
    sdkState.pendingPermissions = []
    sdkState.pendingQuestions = []
    sdkState.permissionReplyCount = 0
    sdkState.providerFails = false
    sdkState.promptedRequests = []
    sdkState.promptedSessionIds = []
    sdkState.createCount = 0
    sdkState.sessions = [{
      directory: workspacePath,
      id: 'foreign-native-session',
      parentID: undefined,
      time: { created: now - 1_000, updated: now - 1_000 },
      title: 'Created outside Aryn',
      workspaceDirectory: workspacePath,
    }]
    sdkState.updateFails = false
  })

  it('rejects an incompatible OpenCode server and closes it without starting the event stream', async () => {
    sdkState.healthVersion = '1.18.0'
    const close = vi.fn()
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: () => undefined,
      startServer: async () => ({ close, url: 'http://127.0.0.1:4096' }),
    })

    try {
      await expect(manager.createSession(workspacePath, { name: 'Incompatible server' }))
        .rejects.toThrow(/1\.17\.18/)
      expect(close).toHaveBeenCalledOnce()
      expect(sdkState.globalEventSubscribeCount).toBe(0)
    } finally {
      manager.dispose()
    }
  })

  it('keeps concurrent callers behind the OpenCode initialization barrier', async () => {
    let releaseHealthCheck!: () => void
    sdkState.healthGate = new Promise<void>((resolve) => {
      releaseHealthCheck = resolve
    })
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: () => undefined,
      startServer: async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' }),
    })

    try {
      const firstLoad = manager.loadDraftState()
      await vi.waitFor(() => expect(sdkState.healthStarted).toBe(1))
      let secondLoadSettled = false
      const secondLoad = manager.loadDraftState().finally(() => {
        secondLoadSettled = true
      })

      await Promise.resolve()
      expect(secondLoadSettled).toBe(false)
      expect(sdkState.globalEventSubscribeCount).toBe(0)

      releaseHealthCheck()
      await Promise.all([firstLoad, secondLoad])
      expect(sdkState.healthStarted).toBe(1)
      expect(sdkState.globalEventSubscribeCount).toBe(1)
    } finally {
      manager.dispose()
    }
  })

  it('recovers pending permissions and questions that were missed while the UI was offline', async () => {
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: (event) => events.push(event),
      startServer: async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' }),
    })
    try {
      const state = await manager.createSession(workspacePath, { name: 'Pending interaction session' })
      const sessionID = state.activeSession!.sessionId
      sdkState.pendingPermissions = [{
        always: [],
        id: 'permission-offline',
        metadata: {},
        patterns: ['src/**'],
        permission: 'edit',
        sessionID,
      }]
      sdkState.pendingQuestions = [{
        id: 'question-offline',
        questions: [{ custom: true, header: 'Name', question: 'What name?' }],
        sessionID,
      }]

      await manager.loadWorkspaceState(workspacePath, sessionID)

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          request: expect.objectContaining({ id: 'permission-offline', kind: 'permission' }),
          type: 'interaction_requested',
        }),
        expect.objectContaining({
          request: expect.objectContaining({ id: 'question-offline', kind: 'question' }),
          type: 'interaction_requested',
        }),
      ]))

      sdkState.pendingPermissions = []
      sdkState.pendingQuestions = []
      await manager.loadWorkspaceState(workspacePath, sessionID)

      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ requestId: 'permission-offline', resumeRun: true, type: 'interaction_resolved' }),
        expect.objectContaining({ requestId: 'question-offline', resumeRun: true, type: 'interaction_resolved' }),
      ]))
    } finally {
      manager.dispose()
    }
  })

  it('keeps existing interactions when pending-session ownership can only be partially verified', async () => {
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: (event) => events.push(event),
      startServer: async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' }),
    })
    try {
      const state = await manager.createSession(workspacePath, { name: 'Partial interaction sync' })
      const sessionID = state.activeSession!.sessionId
      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-existing',
          permission: 'bash',
          sessionID,
        },
      })
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        request: expect.objectContaining({ id: 'permission-existing' }),
        type: 'interaction_requested',
      })))

      sdkState.getFailureSessionIds = ['session-with-transient-lookup-failure']
      sdkState.pendingPermissions = [{
        always: [],
        id: 'permission-unverified',
        metadata: {},
        patterns: ['src/**'],
        permission: 'edit',
        sessionID: 'session-with-transient-lookup-failure',
      }]
      await manager.loadWorkspaceState(workspacePath, sessionID)

      expect(events).not.toContainEqual(expect.objectContaining({
        requestId: 'permission-existing',
        type: 'interaction_resolved',
      }))
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'permission-existing',
        sessionId: sessionID,
      })).resolves.toBe(true)
      expect(sdkState.permissionReplyCount).toBe(1)
      expect(events).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('transient session lookup failure'),
        type: 'error',
      }))
    } finally {
      manager.dispose()
    }
  })

  afterEach(async () => {
    await rm(agentDir, { force: true, recursive: true })
  })

  it('lists every official workspace session while discarding only Aryn-owned sessions', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      await manager.createSession(workspacePath, { name: 'Aryn session' })
    } finally {
      manager.dispose()
    }

    const restoredManager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      await expect(restoredManager.listSessionItems(workspacePath)).resolves.toEqual(expect.arrayContaining([
        expect.objectContaining({ id: 'aryn-owned-session-1', name: 'Aryn session' }),
        expect.objectContaining({ id: 'foreign-native-session', name: 'Created outside Aryn' }),
      ]))

      await restoredManager.discardWorkspaceSessions(workspacePath)
      expect(sdkState.deletedSessionIds).toEqual(['aryn-owned-session-1'])
      expect(sdkState.sessions.map((session) => session.id)).toEqual(['foreign-native-session'])
    } finally {
      restoredManager.dispose()
    }
  })

  it('makes concurrent workspace discards idempotent per owned session', async () => {
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: () => undefined,
      startServer: async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' }),
    })
    const allowDelete = deferred()
    try {
      await manager.createSession(workspacePath, { name: 'Discard once' })
      sdkState.deleteGate = allowDelete.promise

      const firstDiscard = manager.discardWorkspaceSessions(workspacePath)
      const secondDiscard = manager.discardWorkspaceSessions(workspacePath)
      await vi.waitFor(() => expect(sdkState.deleteStarted).toBe(1))
      allowDelete.resolve()

      await expect(Promise.all([firstDiscard, secondDiscard])).resolves.toEqual([undefined, undefined])
      expect(sdkState.deletedSessionIds).toEqual(['aryn-owned-session-1'])
    } finally {
      allowDelete.resolve()
      manager.dispose()
    }
  })

  it('refreshes official session creation and deletion events without activating a background session', async () => {
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: (event) => events.push(event),
      startServer: async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' }),
    })
    try {
      await manager.loadWorkspaceState(workspacePath, null, { restoreSession: false })
      const unboundSession = sdkState.sessions.find((session) => session.id === 'foreign-native-session')!
      sdkState.sessions = sdkState.sessions.filter((session) => session.id !== unboundSession.id)
      emitGlobalEvent(workspacePath, {
        type: 'session.deleted',
        properties: { info: unboundSession },
      })
      await vi.waitFor(() => {
        const state = events.filter((event) => event.type === 'workspace_state').at(-1)?.state
        expect(state).toBeDefined()
        expect(state?.sessions).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ id: unboundSession.id }),
        ]))
      })

      const now = Date.now()
      const externalSession = {
        directory: workspacePath,
        id: 'external-event-session',
        parentID: undefined,
        time: { created: now, updated: now },
        title: 'Created from OpenCode',
        workspaceDirectory: workspacePath,
      }
      sdkState.sessions.push(externalSession)
      emitGlobalEvent(workspacePath, {
        type: 'session.created',
        properties: { info: externalSession },
      })

      await vi.waitFor(() => {
        const state = events.filter((event) => event.type === 'workspace_state').at(-1)?.state
        expect(state).toMatchObject({
          activeSession: null,
          sessions: expect.arrayContaining([
            expect.objectContaining({ id: externalSession.id }),
          ]),
        })
      })

      sdkState.sessions = sdkState.sessions.filter((session) => session.id !== externalSession.id)
      emitGlobalEvent(workspacePath, {
        type: 'session.deleted',
        properties: { info: externalSession },
      })

      await vi.waitFor(() => {
        const state = events.filter((event) => event.type === 'workspace_state').at(-1)?.state
        expect(state).toBeDefined()
        expect(state?.activeSession).toBeNull()
        expect(state?.sessions).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ id: externalSession.id }),
        ]))
      })
      await expect(manager.sessionExists(workspacePath, externalSession.id)).resolves.toBe(false)
    } finally {
      manager.dispose()
    }
  })

  it('passes client message and part IDs through promptAsync for official optimistic reconciliation', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Optimistic identity' })
      const sessionID = created.activeSession!.sessionId
      const messageID = 'msg_0123456789abABCDEFGHIJKLMN'
      const textPartID = 'prt_0123456789acABCDEFGHIJKLMN'
      const filePartID = 'prt_0123456789adABCDEFGHIJKLMN'

      await manager.sendPrompt(workspacePath, sessionID, 'hello', undefined, [{
        data: 'data:text/plain;base64,aGVsbG8=',
        fileName: 'hello.txt',
        kind: 'file',
        mimeType: 'text/plain',
      }], {
        clientMessageId: messageID,
        clientPartIds: [textPartID, filePartID],
      })

      expect(sdkState.promptedRequests.at(-1)).toMatchObject({
        messageID,
        parts: [
          expect.objectContaining({ id: textPartID, text: 'hello', type: 'text' }),
          expect.objectContaining({ id: filePartID, filename: 'hello.txt', type: 'file' }),
        ],
        sessionID,
      })
    } finally {
      manager.dispose()
    }
  })

  it('does not present private index data as official history when the CLI is unavailable', async () => {
    const indexDirectory = path.join(agentDir, 'external', 'opencode')
    await mkdir(indexDirectory, { recursive: true })
    await writeFile(path.join(indexDirectory, 'sessions.json'), JSON.stringify({
      sessions: [{
        createdAt: '2026-07-12T00:00:00.000Z',
        cwd: workspacePath,
        id: 'offline-owned-session',
        modelKey: 'test/model',
        thinkingLevel: 'medium',
      }],
      version: 1,
    }))
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: () => undefined,
      startServer: async () => { throw new Error('OpenCode CLI unavailable') },
    })

    try {
      await expect(manager.listSessionItems(workspacePath)).rejects.toThrow('OpenCode CLI unavailable')
    } finally {
      manager.dispose()
    }
  })

  it('keeps official sessions visible when legacy configuration metadata cannot be migrated', async () => {
    const indexDirectory = path.join(agentDir, 'external', 'opencode')
    await mkdir(indexDirectory, { recursive: true })
    await writeFile(path.join(indexDirectory, 'sessions.json'), JSON.stringify({
      sessions: [{
        createdAt: '2026-07-12T00:00:00.000Z',
        cwd: workspacePath,
        id: 'foreign-native-session',
        modelKey: 'test/model',
        thinkingLevel: 'high',
      }],
      version: 1,
    }))
    sdkState.updateFails = true
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: () => undefined,
      startServer: async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' }),
    })

    try {
      await expect(manager.listSessionItems(workspacePath)).resolves.toEqual([
        expect.objectContaining({ id: 'foreign-native-session', name: 'Created outside Aryn' }),
      ])
    } finally {
      manager.dispose()
    }
  })

  it('restores an owned Windows session when OpenCode returns a lossy Unicode directory', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const unicodeWorkspacePath = path.join(agentDir, '中文工作区')
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(unicodeWorkspacePath, { name: 'Unicode session' })
      const sessionID = created.activeSession!.sessionId
      const nativeSession = sdkState.sessions.find((session) => session.id === sessionID)!
      nativeSession.directory = path.join(agentDir, '???')
    } finally {
      manager.dispose()
    }

    const restoredManager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      await expect(restoredManager.loadWorkspaceState(unicodeWorkspacePath)).resolves.toMatchObject({
        activeSession: { sessionId: 'aryn-owned-session-1' },
        sessions: [expect.objectContaining({ id: 'aryn-owned-session-1' })],
      })
    } finally {
      restoredManager.dispose()
    }
  })

  it('uses the global event stream and projects native text deltas into session snapshots', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Native stream' })
      const sessionID = created.activeSession!.sessionId
      expect(created.activeSession).toMatchObject({
        messages: [],
        native: {
          agentId: 'opencode',
          messages: [],
          status: { type: 'idle' },
        },
      })
      expect(sdkState.globalEventSubscribeCount).toBe(1)
      expect(sdkState.instanceEventSubscribeCount).toBe(0)

      emitGlobalEvent(workspacePath, {
        type: 'message.updated',
        properties: {
          info: {
            id: 'assistant-message',
            role: 'assistant',
            sessionID,
            time: { created: Date.now() },
          },
          sessionID,
        },
      })
      emitGlobalEvent(workspacePath, {
        type: 'message.part.updated',
        properties: {
          part: {
            id: 'assistant-text',
            messageID: 'assistant-message',
            sessionID,
            text: '',
            type: 'text',
          },
          sessionID,
        },
      })
      emitGlobalEvent(workspacePath, {
        type: 'message.part.delta',
        properties: {
          delta: 'OK',
          field: 'text',
          messageID: 'assistant-message',
          partID: 'assistant-text',
          sessionID,
        },
      })
      emitGlobalEvent(workspacePath, {
        type: 'session.status',
        properties: {
          sessionID,
          status: {
            type: 'retry',
            action: {
              label: 'Manage quota',
              link: 'https://example.com/quota',
              message: 'Increase quota.',
              provider: 'example',
              reason: 'quota',
              title: 'Quota exhausted',
            },
            attempt: 2,
            message: 'Quota reached',
            next: Date.now() + 1_000,
          },
        },
      })

      await vi.waitFor(() => {
        expect(events.some((event) => (
          event.type === 'opencode_native_event'
          && event.workspacePath === workspacePath
          && event.event.type === 'message.part.delta'
        ))).toBe(true)
        expect(events.some((event) => (
          event.type === 'session_snapshot_updated'
          && event.session.native?.agentId === 'opencode'
          && event.session.native.messages.some((message: Record<string, any>) => (
            message.info.role === 'assistant'
            && message.parts.some((part: Record<string, any>) => part.type === 'text' && part.text === 'OK')
          ))
        ))).toBe(true)
        expect(events.some((event) => (
          event.type === 'session_snapshot_updated'
          && event.session.native?.status?.type === 'retry'
          && event.session.native.status.action?.link === 'https://example.com/quota'
        ))).toBe(true)
      })
    } finally {
      manager.dispose()
    }
  })

  it('reconciles missed messages and status after the global event stream reconnects', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Reconnect session' })
      const sessionID = created.activeSession!.sessionId
      await manager.sendPrompt(workspacePath, sessionID, 'message sent before disconnect')
      const session = sdkState.sessions.find((item) => item.id === sessionID)!
      session.runtimeStatus = { type: 'idle' }
      sdkState.messageResponses.push([{
        info: { id: 'user-after-gap', role: 'user', sessionID, time: { created: 1 } },
        parts: [{ id: 'user-after-gap-text', messageID: 'user-after-gap', sessionID, text: 'recovered', type: 'text' }],
      }])
      expect(sdkState.globalEventSubscribeCount).toBe(1)

      endGlobalEventStream()

      await vi.waitFor(() => {
        expect(sdkState.globalEventSubscribeCount).toBe(2)
        expect(events).toContainEqual(expect.objectContaining({
          type: 'opencode_surface_refresh',
          sessionId: sessionID,
          workspacePath,
        }))
        expect(events.some((event) => (
          event.type === 'workspace_state'
          && event.state.activeSession?.sessionId === sessionID
          && event.state.runtime.isStreaming === false
          && event.state.activeSession.native?.messages.some((message: Record<string, any>) => (
            message.info.id === 'user-after-gap'
          ))
        ))).toBe(true)
      }, { timeout: 1_000 })
    } finally {
      manager.dispose()
    }
  })

  it('serves the official renderer through a constrained workspace-scoped RPC surface', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Surface session' })
      const sessionID = created.activeSession!.sessionId

      await expect(manager.requestSurfaceData(workspacePath, {
        method: 'session.get',
        sessionID,
      })).resolves.toEqual({ data: expect.objectContaining({ id: sessionID, title: 'Surface session' }) })
      await expect(manager.requestSurfaceData(workspacePath, {
        method: 'app.agents',
      })).resolves.toEqual({ data: [expect.objectContaining({ name: 'build' })] })
      await expect(manager.requestSurfaceData(workspacePath, {
        method: 'provider.list',
      })).resolves.toEqual({ data: expect.objectContaining({ connected: ['test'] }) })
      await expect(manager.requestSurfaceData(workspacePath, {
        method: 'session.status',
        sessionID,
      })).resolves.toEqual({ data: { type: 'idle' } })
      await expect(manager.requestSurfaceData(workspacePath, {
        method: 'session.message',
        messageID: 'message-1',
        sessionID,
      })).resolves.toEqual({
        data: expect.objectContaining({ info: expect.objectContaining({ id: 'message-1', sessionID }) }),
      })
    } finally {
      manager.dispose()
    }
  })

  it('targets the requested session even after another session became workspace-active', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const first = await manager.createSession(workspacePath, { name: 'First' })
      const second = await manager.createSession(workspacePath, { name: 'Second' })
      await manager.openSession(workspacePath, second.activeSession!.sessionId)
      await manager.sendPrompt(workspacePath, first.activeSession!.sessionId, 'target first')

      expect(sdkState.promptedSessionIds).toEqual([first.activeSession!.sessionId])
      const renamed = await manager.renameSession(workspacePath, first.activeSession!.sessionId, 'Renamed first')
      expect(renamed.activeSession?.sessionId).toBe(second.activeSession!.sessionId)
      const deleted = await manager.deleteSession(workspacePath, first.activeSession!.sessionId)
      expect(deleted.activeSession?.sessionId).toBe(second.activeSession!.sessionId)
    } finally {
      manager.dispose()
    }
  })

  it('opens an owned root session descendant without listing it as another top-level Aryn session', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    let childSessionID = ''
    try {
      const created = await manager.createSession(workspacePath, { name: 'Parent' })
      const rootSessionID = created.activeSession!.sessionId
      childSessionID = 'child-native-session'
      const now = Date.now()
      sdkState.sessions.push({
        directory: workspacePath,
        id: childSessionID,
        parentID: rootSessionID,
        time: { created: now, updated: now },
        title: 'Subagent child',
      })

      await expect(manager.openSession(workspacePath, childSessionID)).resolves.toMatchObject({
        activeSession: {
          native: { agentId: 'opencode', parentSessionId: rootSessionID },
          sessionId: childSessionID,
        },
        sessions: expect.arrayContaining([expect.objectContaining({ id: rootSessionID })]),
      })
      await expect(manager.requestSurfaceData(workspacePath, {
        method: 'session.get',
        sessionID: childSessionID,
      })).resolves.toEqual({ data: expect.objectContaining({ id: childSessionID, parentID: rootSessionID }) })
      await expect(manager.sendPrompt(workspacePath, childSessionID, 'must stay read only'))
        .rejects.toThrow('子会话')
    } finally {
      manager.dispose()
    }

    const restoredManager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      await expect(restoredManager.loadWorkspaceState(workspacePath, childSessionID)).resolves.toMatchObject({
        activeSession: { sessionId: childSessionID },
      })
    } finally {
      restoredManager.dispose()
    }
  })

  it('routes unopened subagent interactions to the owned root session', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Parent' })
      const rootSessionID = created.activeSession!.sessionId
      const childSessionID = 'unopened-child-session'
      const now = Date.now()
      const child = {
        directory: workspacePath,
        id: childSessionID,
        parentID: rootSessionID,
        time: { created: now, updated: now },
        title: 'Background subagent',
      }
      sdkState.sessions.push(child)

      emitGlobalEvent(workspacePath, {
        type: 'session.created',
        properties: { info: child, sessionID: childSessionID },
      })
      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-child',
          permission: 'bash',
          sessionID: childSessionID,
        },
      })

      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        request: expect.objectContaining({ id: 'permission-child', sessionId: rootSessionID }),
        type: 'interaction_requested',
      })))
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'permission-child',
        sessionId: rootSessionID,
      })).resolves.toBe(true)
      expect(events).toContainEqual(expect.objectContaining({
        requestId: 'permission-child',
        sessionId: rootSessionID,
        type: 'interaction_resolved',
      }))

      emitGlobalEvent(workspacePath, {
        type: 'question.asked',
        properties: {
          id: 'question-child',
          questions: [{ header: 'Choice', options: [{ label: 'A' }], question: 'Pick one' }],
          sessionID: childSessionID,
        },
      })
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        request: expect.objectContaining({ id: 'question-child', sessionId: rootSessionID }),
        type: 'interaction_requested',
      })))
      emitGlobalEvent(workspacePath, {
        type: 'question.replied',
        properties: { answers: [['A']], requestID: 'question-child', sessionID: childSessionID },
      })
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        requestId: 'question-child',
        sessionId: rootSessionID,
        type: 'interaction_resolved',
      })))

      const requestedBeforeDelete = events.filter((event) => event.type === 'interaction_requested').length
      await manager.deleteSession(workspacePath, rootSessionID)
      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-after-delete',
          permission: 'bash',
          sessionID: childSessionID,
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 25))
      expect(events.filter((event) => event.type === 'interaction_requested')).toHaveLength(requestedBeforeDelete)
    } finally {
      manager.dispose()
    }
  })

  it('retires a deleted child subtree without resolving sibling interactions', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Parent' })
      const rootSessionID = created.activeSession!.sessionId
      const now = Date.now()
      const firstChildSessionID = 'first-interactive-child'
      const grandchildSessionID = 'nested-interactive-grandchild'
      const secondChildSessionID = 'second-interactive-child'
      sdkState.sessions.push(
        {
          directory: workspacePath,
          id: grandchildSessionID,
          parentID: firstChildSessionID,
          time: { created: now, updated: now },
          title: 'Nested grandchild',
        },
        {
          directory: workspacePath,
          id: firstChildSessionID,
          parentID: rootSessionID,
          time: { created: now, updated: now },
          title: 'First child',
        },
        {
          directory: workspacePath,
          id: secondChildSessionID,
          parentID: rootSessionID,
          time: { created: now, updated: now },
          title: 'Second child',
        },
      )

      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-grandchild',
          permission: 'bash',
          sessionID: grandchildSessionID,
        },
      })
      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-first-child',
          permission: 'bash',
          sessionID: firstChildSessionID,
        },
      })
      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-second-child',
          permission: 'bash',
          sessionID: secondChildSessionID,
        },
      })
      await vi.waitFor(() => {
        expect(events).toEqual(expect.arrayContaining([
          expect.objectContaining({
            request: expect.objectContaining({ id: 'permission-first-child', sessionId: rootSessionID }),
            type: 'interaction_requested',
          }),
          expect.objectContaining({
            request: expect.objectContaining({ id: 'permission-grandchild', sessionId: rootSessionID }),
            type: 'interaction_requested',
          }),
          expect.objectContaining({
            request: expect.objectContaining({ id: 'permission-second-child', sessionId: rootSessionID }),
            type: 'interaction_requested',
          }),
        ]))
      })

      await manager.deleteSession(workspacePath, firstChildSessionID)

      expect(events).toContainEqual(expect.objectContaining({
        requestId: 'permission-grandchild',
        resumeRun: false,
        sessionId: rootSessionID,
        type: 'interaction_resolved',
      }))
      expect(events).toContainEqual(expect.objectContaining({
        requestId: 'permission-first-child',
        resumeRun: false,
        sessionId: rootSessionID,
        type: 'interaction_resolved',
      }))
      expect(events).not.toContainEqual(expect.objectContaining({
        requestId: 'permission-second-child',
        type: 'interaction_resolved',
      }))
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'permission-grandchild',
        sessionId: rootSessionID,
      })).resolves.toBe(false)
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'permission-second-child',
        sessionId: rootSessionID,
      })).resolves.toBe(true)
    } finally {
      manager.dispose()
    }
  })

  it('does not revive a child binding that finishes loading after its root was deleted', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    const allowChildRead = deferred()
    try {
      const created = await manager.createSession(workspacePath, { name: 'Root delete race' })
      const rootSessionID = created.activeSession!.sessionId
      const childSessionID = 'late-child-session'
      const now = Date.now()
      sdkState.sessions.push({
        directory: workspacePath,
        id: childSessionID,
        parentID: rootSessionID,
        time: { created: now, updated: now },
        title: 'Late child',
      })
      sdkState.getGate = allowChildRead.promise
      const opening = manager.openSession(workspacePath, childSessionID)
        .then(
          (state) => ({ state }),
          (error: unknown) => ({ error }),
        )
      await vi.waitFor(() => expect(sdkState.getStarted).toBeGreaterThan(0))

      await manager.deleteSession(workspacePath, rootSessionID)
      allowChildRead.resolve()

      await expect(opening).resolves.toMatchObject({
        error: expect.objectContaining({ message: expect.stringMatching(/parent session not found|not found for this workspace/i) }),
      })
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'missing-child-request',
        sessionId: rootSessionID,
      })).resolves.toBe(false)
    } finally {
      allowChildRead.resolve()
      manager.dispose()
    }
  })

  it('uses OpenCode official running-prompt semantics instead of advertising a client-side follow-up queue', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Steering' })
      const sessionID = created.activeSession!.sessionId
      expect(created.runtime.supportedRunningPromptBehaviors).toEqual(['steer'])

      await manager.sendPrompt(workspacePath, sessionID, 'start')
      await expect(manager.sendPrompt(workspacePath, sessionID, 'guide', 'steer')).resolves.toEqual({ ok: true })
      await expect(manager.sendPrompt(workspacePath, sessionID, 'queue', 'followUp')).rejects.toThrow('不支持客户端排队')
      expect(sdkState.promptedSessionIds).toEqual([sessionID, sessionID])
    } finally {
      manager.dispose()
    }
  })

  it('does not replace the live event reducer with an in-flight REST snapshot after prompt acceptance', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Streaming session' })
      const messagesReadBeforePrompt = sdkState.messagesReadCount

      await manager.sendPrompt(workspacePath, created.activeSession!.sessionId, 'stream safely')

      expect(sdkState.promptedSessionIds).toEqual([created.activeSession!.sessionId])
      expect(sdkState.messagesReadCount).toBe(messagesReadBeforePrompt)
    } finally {
      manager.dispose()
    }
  })

  it('does not resurrect a message removed while a stale REST history request is in flight', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Hydration race' })
      const sessionID = created.activeSession!.sessionId
      let resolveHistory!: (records: Array<Record<string, any>>) => void
      sdkState.messageResponses.push(new Promise((resolve) => { resolveHistory = resolve }))
      const readsBefore = sdkState.messagesReadCount
      const opening = manager.openSession(workspacePath, sessionID)
      await vi.waitFor(() => expect(sdkState.messagesReadCount).toBe(readsBefore + 1))

      emitGlobalEvent(workspacePath, {
        type: 'message.removed',
        properties: { messageID: 'removed-during-load', sessionID },
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      resolveHistory([{
        info: { id: 'removed-during-load', role: 'user', sessionID, time: { created: Date.now() } },
        parts: [{ id: 'stale-text', messageID: 'removed-during-load', sessionID, type: 'text', text: 'must stay deleted' }],
      }])

      const state = await opening
      expect(state.activeSession?.native?.messages).toEqual([])
    } finally {
      manager.dispose()
    }
  })

  it('persists Aryn-selected model configuration across manager restarts', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    const created = await manager.createSession(workspacePath, { name: 'Configured' })
    const sessionID = created.activeSession!.sessionId
    await manager.selectModel(workspacePath, sessionID, 'test/model')
    manager.dispose()

    const restoredManager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const restored = await restoredManager.loadWorkspaceState(workspacePath, sessionID)
      expect(restored.runtime.selectedModel).toBe('test/model')
      expect(restored.runtime.thinkingLevel).toBe('high')
    } finally {
      restoredManager.dispose()
    }
  })

  it('clears workspace bindings even when stopping a native task fails', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Running' })
      await manager.sendPrompt(workspacePath, created.activeSession!.sessionId, 'keep running')
      sdkState.abortFails = true

      await expect(manager.releaseWorkspaceRuntime(workspacePath)).rejects.toThrow('could not be stopped')
      sdkState.abortFails = false
      await expect(manager.releaseWorkspaceRuntime(workspacePath)).resolves.toBeUndefined()
      expect(sdkState.abortCount).toBe(1)
    } finally {
      manager.dispose()
    }
  })

  it('serializes a late open behind native deletion and never resurrects the deleted binding', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    const allowDelete = deferred()
    try {
      const created = await manager.createSession(workspacePath, { name: 'Delete race' })
      const sessionID = created.activeSession!.sessionId
      sdkState.deleteGate = allowDelete.promise

      const deletion = manager.deleteSession(workspacePath, sessionID)
      await vi.waitFor(() => expect(sdkState.deleteStarted).toBe(1))
      let openingSettled = false
      const opening = manager.openSession(workspacePath, sessionID).finally(() => {
        openingSettled = true
      })

      await Promise.resolve()
      expect(openingSettled).toBe(false)
      allowDelete.resolve()

      await deletion
      await expect(opening).rejects.toThrow()
      expect(sdkState.sessions.some((session) => session.id === sessionID)).toBe(false)
    } finally {
      allowDelete.resolve()
      manager.dispose()
    }
  })

  it('waits for an in-flight workspace binding and prevents it from surviving release', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    const allowGet = deferred()
    try {
      sdkState.getGate = allowGet.promise
      const opening = manager.openSession(workspacePath, 'foreign-native-session')
      await vi.waitFor(() => expect(sdkState.getStarted).toBeGreaterThan(0))
      let releaseSettled = false
      const release = manager.releaseWorkspaceRuntime(workspacePath).finally(() => {
        releaseSettled = true
      })

      await Promise.resolve()
      expect(releaseSettled).toBe(false)
      allowGet.resolve()

      await expect(opening).rejects.toThrow(/superseded|invalidated/i)
      await release
    } finally {
      allowGet.resolve()
      manager.dispose()
    }
  })

  it('does not let a late global event recreate a released workspace binding', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Released event target' })
      const sessionID = created.activeSession!.sessionId
      await manager.releaseWorkspaceRuntime(workspacePath)
      const requestsBeforeEvent = events.filter((event) => event.type === 'interaction_requested').length

      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-after-release',
          permission: 'bash',
          sessionID,
        },
      })
      await new Promise((resolve) => setTimeout(resolve, 25))

      expect(events.filter((event) => event.type === 'interaction_requested')).toHaveLength(requestsBeforeEvent)
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'permission-after-release',
        sessionId: sessionID,
      })).resolves.toBe(false)
    } finally {
      manager.dispose()
    }
  })

  it('does not let a slow session event block another session interaction', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    const allowSlowHistory = deferred<Array<Record<string, any>>>()
    try {
      const first = await manager.createSession(workspacePath, { name: 'Slow session' })
      const second = await manager.createSession(workspacePath, { name: 'Independent session' })
      const firstID = first.activeSession!.sessionId
      const secondID = second.activeSession!.sessionId
      const readsBeforeSlowEvent = sdkState.messagesReadCount
      sdkState.messageResponses.push(allowSlowHistory.promise)

      emitGlobalEvent(workspacePath, {
        type: 'session.idle',
        properties: { sessionID: firstID },
      })
      await vi.waitFor(() => expect(sdkState.messagesReadCount).toBe(readsBeforeSlowEvent + 1))
      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-independent',
          permission: 'bash',
          sessionID: secondID,
        },
      })

      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        request: expect.objectContaining({
          id: 'permission-independent',
          sessionId: secondID,
        }),
        type: 'interaction_requested',
      })), { timeout: 250 })
    } finally {
      allowSlowHistory.resolve([])
      manager.dispose()
    }
  })

  it('suppresses an older workspace snapshot that completes after a newer session was opened', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    const allowFirstHistory = deferred<Array<Record<string, any>>>()
    try {
      const first = await manager.createSession(workspacePath, { name: 'First state' })
      const second = await manager.createSession(workspacePath, { name: 'Second state' })
      const firstID = first.activeSession!.sessionId
      const secondID = second.activeSession!.sessionId
      sdkState.messageResponses.push(allowFirstHistory.promise, [])

      const firstOpen = manager.openSession(workspacePath, firstID)
      await vi.waitFor(() => expect(sdkState.messageResponses).toHaveLength(1))
      await manager.openSession(workspacePath, secondID)
      allowFirstHistory.resolve([])
      await firstOpen

      const workspaceEvents = events.filter((event) => event.type === 'workspace_state')
      expect(workspaceEvents.at(-1)?.state.activeSession?.sessionId).toBe(secondID)
    } finally {
      allowFirstHistory.resolve([])
      manager.dispose()
    }
  })

  it('suppresses a background snapshot assembled before a workspace load commits a new active session', async () => {
    const events: Array<Record<string, any>> = []
    const manager = new OpenCodeAgentManager({
      agentDir,
      emitEvent: (event) => events.push(event),
      startServer: async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' }),
    })
    const allowBackgroundHistory = deferred<Array<Record<string, any>>>()
    try {
      const first = await manager.createSession(workspacePath, { name: 'Load target' })
      const second = await manager.createSession(workspacePath, { name: 'Initially active' })
      const firstID = first.activeSession!.sessionId
      const secondID = second.activeSession!.sessionId
      sdkState.messageResponses.push(allowBackgroundHistory.promise, [])

      emitGlobalEvent(workspacePath, {
        type: 'session.updated',
        properties: {
          info: sdkState.sessions.find((session) => session.id === secondID),
        },
      })
      await vi.waitFor(() => expect(sdkState.messageResponses).toHaveLength(1))

      await expect(manager.loadWorkspaceState(workspacePath, firstID)).resolves.toMatchObject({
        activeSession: expect.objectContaining({ sessionId: firstID }),
      })
      const workspaceEventCount = events.filter((event) => event.type === 'workspace_state').length

      allowBackgroundHistory.resolve([])
      await new Promise((resolve) => setTimeout(resolve, 25))

      expect(events.filter((event) => event.type === 'workspace_state')).toHaveLength(workspaceEventCount)
    } finally {
      allowBackgroundHistory.resolve([])
      manager.dispose()
    }
  })

  it('waits for an in-flight native creation and rolls it back when the workspace is released', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    const allowCreate = deferred()
    try {
      sdkState.createGate = allowCreate.promise
      const creation = manager.createSession(workspacePath, { name: 'Released while creating' })
        .then(
          (state) => ({ state }),
          (error: unknown) => ({ error }),
        )
      await vi.waitFor(() => expect(sdkState.createStarted).toBe(1))

      let releaseSettled = false
      const release = manager.releaseWorkspaceRuntime(workspacePath).finally(() => {
        releaseSettled = true
      })
      await Promise.resolve()
      expect(releaseSettled).toBe(false)

      allowCreate.resolve()
      await expect(creation).resolves.toMatchObject({
        error: expect.objectContaining({ message: expect.stringMatching(/superseded/i) }),
      })
      await release
      expect(sdkState.sessions.map((session) => session.id)).toEqual(['foreign-native-session'])
      expect(sdkState.deletedSessionIds).toEqual(['aryn-owned-session-1'])
    } finally {
      allowCreate.resolve()
      manager.dispose()
    }
  })

  it('rolls back a native creation whose foreground activation was superseded', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    const allowCreate = deferred()
    try {
      sdkState.createGate = allowCreate.promise
      const creation = manager.createSession(workspacePath, { name: 'Superseded creation' })
        .then(
          (state) => ({ state }),
          (error: unknown) => ({ error }),
        )
      await vi.waitFor(() => expect(sdkState.createStarted).toBe(1))

      await expect(manager.openSession(workspacePath, 'foreign-native-session')).resolves.toMatchObject({
        activeSession: expect.objectContaining({ sessionId: 'foreign-native-session' }),
      })
      allowCreate.resolve()

      await expect(creation).resolves.toMatchObject({
        error: expect.objectContaining({ message: expect.stringMatching(/activation was superseded/i) }),
      })
      expect(sdkState.sessions.map((session) => session.id)).toEqual(['foreign-native-session'])
      expect(sdkState.deletedSessionIds).toEqual(['aryn-owned-session-1'])
    } finally {
      allowCreate.resolve()
      manager.dispose()
    }
  })

  it('restores the previous active session when post-create state assembly fails', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const previous = await manager.createSession(workspacePath, { name: 'Previous active' })
      const previousSessionID = previous.activeSession!.sessionId
      sdkState.providerFails = true

      await expect(manager.createSession(workspacePath, { name: 'Incomplete creation' }))
        .rejects.toThrow('provider list failed')
      sdkState.providerFails = false

      expect(sdkState.deletedSessionIds).toContain('aryn-owned-session-2')
      await expect(manager.renameSession(workspacePath, previousSessionID, 'Previous restored'))
        .resolves.toMatchObject({
          activeSession: expect.objectContaining({
            name: 'Previous restored',
            sessionId: previousSessionID,
          }),
        })
    } finally {
      sdkState.providerFails = false
      manager.dispose()
    }
  })

  it('keeps the current binding and ownership when native deletion fails', async () => {
    const startServer = async () => ({ close: () => undefined, url: 'http://127.0.0.1:4096' })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: () => undefined, startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Deletion retry' })
      const sessionID = created.activeSession!.sessionId
      sdkState.deleteFails = true

      await expect(manager.deleteSession(workspacePath, sessionID)).rejects.toThrow('delete failed')
      expect(sdkState.sessions.some((session) => session.id === sessionID)).toBe(true)

      sdkState.deleteFails = false
      await expect(manager.renameSession(workspacePath, sessionID, 'Still bound')).resolves.toMatchObject({
        activeSession: expect.objectContaining({ name: 'Still bound', sessionId: sessionID }),
      })
      await manager.discardWorkspaceSessions(workspacePath)
      expect(sdkState.deletedSessionIds).toContain(sessionID)
    } finally {
      manager.dispose()
    }
  })

  it('refreshes a known workspace without an active binding after a server restart', async () => {
    const events: Array<Record<string, any>> = []
    let exitListener: ((error: Error) => void) | null = null
    const startServer = async () => ({
      close: () => undefined,
      onExit: (listener: (error: Error) => void) => {
        exitListener = listener
        return () => {
          if (exitListener === listener) exitListener = null
        }
      },
      url: 'http://127.0.0.1:4096',
    })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    try {
      await expect(manager.loadWorkspaceState(
        workspacePath,
        null,
        { restoreSession: false },
      )).resolves.toMatchObject({ activeSession: null })
      const now = Date.now()
      sdkState.sessions.push({
        directory: workspacePath,
        id: 'session-discovered-after-restart',
        parentID: undefined,
        time: { created: now, updated: now },
        title: 'Discovered after restart',
        workspaceDirectory: workspacePath,
      })

      const terminate = exitListener
      expect(terminate).not.toBeNull()
      terminate!(new Error('server exited'))

      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        state: expect.objectContaining({
          activeSession: null,
          sessions: expect.arrayContaining([
            expect.objectContaining({ id: 'session-discovered-after-restart' }),
          ]),
        }),
        type: 'workspace_state',
      })))
    } finally {
      manager.dispose()
    }
  })

  it('rejects an old interaction and reconciles pending work after a server restart', async () => {
    const events: Array<Record<string, any>> = []
    let exitListener: ((error: Error) => void) | null = null
    const startServer = async () => ({
      close: () => undefined,
      onExit: (listener: (error: Error) => void) => {
        exitListener = listener
        return () => {
          if (exitListener === listener) exitListener = null
        }
      },
      url: 'http://127.0.0.1:4096',
    })
    const manager = new OpenCodeAgentManager({ agentDir, emitEvent: (event) => events.push(event), startServer })
    try {
      const created = await manager.createSession(workspacePath, { name: 'Server generation' })
      const sessionID = created.activeSession!.sessionId
      emitGlobalEvent(workspacePath, {
        type: 'permission.asked',
        properties: {
          id: 'permission-old-server',
          permission: 'bash',
          sessionID,
        },
      })
      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        request: expect.objectContaining({ id: 'permission-old-server' }),
        type: 'interaction_requested',
      })))

      const terminate = exitListener
      expect(terminate).not.toBeNull()
      sdkState.pendingPermissions = [{
        always: [],
        id: 'permission-new-server',
        metadata: {},
        patterns: ['src/**'],
        permission: 'edit',
        sessionID,
      }]
      terminate!(new Error('server exited'))

      await vi.waitFor(() => expect(events).toContainEqual(expect.objectContaining({
        request: expect.objectContaining({ id: 'permission-new-server' }),
        type: 'interaction_requested',
      })))
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'permission-old-server',
        sessionId: sessionID,
      })).resolves.toBe(false)
      expect(sdkState.permissionReplyCount).toBe(0)
      await expect(manager.respondToInteraction({
        agentId: 'opencode',
        optionId: 'allow_once',
        requestId: 'permission-new-server',
        sessionId: sessionID,
      })).resolves.toBe(true)
      expect(sdkState.permissionReplyCount).toBe(1)
      await vi.waitFor(() => expect(sdkState.globalEventSubscribeCount).toBe(2))
    } finally {
      manager.dispose()
    }
  })
})

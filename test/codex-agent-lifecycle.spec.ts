import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Model } from '../src/features/agent/codex-protocol/generated/v2/Model'
import type { Thread } from '../src/features/agent/codex-protocol/generated/v2/Thread'
import type { CodexThreadRecord } from '../electron/main/codex-agent'
import { CodexAgentManager } from '../electron/main/codex-agent'
import type { CodexSessionStore } from '../electron/main/codex-session-store'

function thread(status: Thread['status'] = { type: 'idle' }): Thread {
  return {
    agentNickname: null,
    agentRole: null,
    cliVersion: '0.144.5',
    createdAt: 1,
    cwd: 'C:/workspace',
    ephemeral: false,
    forkedFromId: null,
    gitInfo: null,
    id: 'thread-1',
    modelProvider: 'openai',
    name: null,
    parentThreadId: null,
    path: null,
    preview: '',
    recencyAt: null,
    sessionId: 'session-1',
    source: 'appServer',
    status,
    threadSource: 'aryn',
    turns: [],
    updatedAt: 1,
  }
}

function record(overrides: Partial<CodexThreadRecord> = {}): CodexThreadRecord {
  return {
    createdAt: '2026-07-18T00:00:00.000Z',
    cwd: 'C:/workspace',
    id: 'thread-1',
    materialized: true,
    model: 'gpt-5.6-sol',
    modelExplicit: false,
    name: null,
    reasoningEffort: 'medium',
    updatedAt: '2026-07-18T00:00:00.000Z',
    ...overrides,
  }
}

function model(overrides: Partial<Model> = {}): Model {
  return {
    additionalSpeedTiers: [],
    availabilityNux: null,
    defaultReasoningEffort: 'medium',
    defaultServiceTier: null,
    description: 'Model',
    displayName: 'Model',
    hidden: false,
    id: 'gpt-5.6-sol',
    inputModalities: ['text'],
    isDefault: true,
    model: 'gpt-5.6-sol',
    serviceTiers: [],
    supportedReasoningEfforts: [{ description: '', reasoningEffort: 'medium' }],
    supportsPersonality: false,
    upgrade: null,
    upgradeInfo: null,
    ...overrides,
  }
}

describe('Codex App Server lifecycle', () => {
  it('hydrates notifications that arrive before thread/resume returns', async () => {
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const currentRecord = record()
    const internals = manager as unknown as {
      client: { request: (method: string) => Promise<unknown>, stop: () => void }
      handleNotification: (notification: {
        method: 'turn/started'
        params: { threadId: string, turn: Thread['turns'][number] }
      }) => Promise<void>
      resumeThread: (value: CodexThreadRecord) => Promise<void>
      sessionStore: CodexSessionStore
    }
    internals.client = {
      request: async (method) => {
        expect(method).toBe('thread/resume')
        await internals.handleNotification({
          method: 'turn/started',
          params: {
            threadId: 'thread-1',
            turn: {
              completedAt: null,
              durationMs: null,
              error: null,
              id: 'turn-live',
              items: [],
              itemsView: 'full',
              startedAt: 2,
              status: 'inProgress',
            },
          },
        })
        return {
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          cwd: 'C:/workspace',
          instructionSources: [],
          model: 'gpt-5.6-sol',
          modelProvider: 'openai',
          reasoningEffort: 'medium',
          sandbox: { type: 'workspaceWrite' },
          serviceTier: null,
          thread: thread(),
        }
      },
      stop: () => undefined,
    }

    try {
      await internals.resumeThread(currentRecord)
      expect(internals.sessionStore.get('thread-1')?.thread.turns).toEqual([
        expect.objectContaining({ id: 'turn-live', status: 'inProgress' }),
      ])
    } finally {
      manager.dispose()
    }
  })

  it('settles an active session when the App Server connection exits', async () => {
    const events: unknown[] = []
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: (event) => events.push(event) })
    const currentRecord = record()
    const fakeClient = { stop: () => undefined }
    const internals = manager as unknown as {
      client: unknown
      handleConnectionExit: (client: unknown, error: Error) => void
      installBinding: (value: CodexThreadRecord, isStreaming: boolean) => Promise<{
        activeTurnId: string | null
        isStreaming: boolean
      }>
      sessionStore: CodexSessionStore
    }
    internals.client = fakeClient
    internals.sessionStore.install(thread({ type: 'active', activeFlags: [] }))
    const binding = await internals.installBinding(currentRecord, true)
    binding.activeTurnId = 'turn-1'

    internals.handleConnectionExit(fakeClient, new Error('connection lost'))

    expect(events).toContainEqual(expect.objectContaining({
      executionState: { type: 'idle' },
      sessionId: 'thread-1',
      type: 'session_snapshot_updated',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      message: expect.stringContaining('connection lost'),
      sessionId: 'thread-1',
      type: 'error',
    }))
    manager.dispose()
  })

  it('unsubscribes loaded threads when releasing a workspace runtime', async () => {
    const requests: Array<{ method: string, params: unknown }> = []
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const currentRecord = record()
    const fakeClient = {
      request: async (method: string, params: unknown) => {
        requests.push({ method, params })
        return {}
      },
      stop: () => undefined,
    }
    const internals = manager as unknown as {
      client: unknown
      index: { read: () => Promise<{ threads: CodexThreadRecord[], version: 1 }> }
      installBinding: (value: CodexThreadRecord, isStreaming: boolean) => Promise<{
        activeTurnId: string | null
      }>
    }
    internals.client = fakeClient
    internals.index = { read: async () => ({ threads: [currentRecord], version: 1 }) }
    const binding = await internals.installBinding(currentRecord, true)
    binding.activeTurnId = 'turn-1'

    try {
      await manager.releaseWorkspaceRuntime('C:/workspace')
      expect(requests).toEqual([
        { method: 'turn/interrupt', params: { threadId: 'thread-1', turnId: 'turn-1' } },
        { method: 'thread/unsubscribe', params: { threadId: 'thread-1' } },
      ])
    } finally {
      manager.dispose()
    }
  })

  it('does not report a duplicate-send failure after turn/start was accepted', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const currentRecord = record({ materialized: false })
    const fakeClient = {
      request: async (method: string) => {
        expect(method).toBe('turn/start')
        return {
          turn: {
            completedAt: null,
            durationMs: null,
            error: null,
            id: 'turn-1',
            items: [],
            itemsView: 'full',
            startedAt: 1,
            status: 'inProgress',
          },
        }
      },
      stop: () => undefined,
    }
    const internals = manager as unknown as {
      client: unknown
      index: { update: () => Promise<never> }
      installBinding: (value: CodexThreadRecord, isStreaming: boolean) => Promise<{
        activeTurnId: string | null
        isStreaming: boolean
      }>
      models: Model[]
      sessionStore: CodexSessionStore
    }
    internals.client = fakeClient
    internals.index = { update: async () => { throw new Error('disk full') } }
    internals.models = [model()]
    internals.sessionStore.install(thread())
    const binding = await internals.installBinding(currentRecord, false)

    try {
      await expect(manager.sendPrompt('C:/workspace', 'thread-1', 'hello')).resolves.toEqual({ ok: true })
      expect(binding).toMatchObject({ activeTurnId: 'turn-1', isStreaming: true })
      expect(currentRecord.materialized).toBe(true)
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('disk full'))
    } finally {
      manager.dispose()
      warning.mockRestore()
    }
  })

  it('deletes the replacement when an unmaterialized thread is replaced concurrently', async () => {
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const original = record({ id: 'draft-thread', materialized: false })
    const replacement = record({ id: 'native-thread', materialized: false })
    let state = { threads: [original], version: 1 as const }
    let releaseUpdate!: () => void
    let signalUpdateStarted!: () => void
    const updateStarted = new Promise<void>((resolve) => { signalUpdateStarted = resolve })
    const updateGate = new Promise<void>((resolve) => { releaseUpdate = resolve })
    const internals = manager as unknown as {
      client: {
        request: (method: string) => Promise<unknown>
        stop: () => void
      }
      index: {
        read: () => Promise<typeof state>
        update: (updater: (current: typeof state) => typeof state) => Promise<typeof state>
      }
      recordReplacements: Map<string, {
        promise: Promise<CodexThreadRecord>
        workspaceIdentity: string
      }>
    }
    internals.client = {
      request: async (method) => {
        if (method === 'thread/list') return { data: [], nextCursor: null }
        if (method === 'thread/unsubscribe') return {}
        throw new Error(`Unexpected Codex request: ${method}`)
      },
      stop: () => undefined,
    }
    internals.index = {
      read: async () => state,
      update: async (updater) => {
        signalUpdateStarted()
        await updateGate
        state = updater(state)
        return state
      },
    }
    internals.recordReplacements.set('draft-thread', {
      promise: Promise.resolve(replacement),
      workspaceIdentity: process.platform === 'win32'
        ? path.resolve('C:/workspace').toLowerCase()
        : path.resolve('C:/workspace'),
    })

    try {
      const deletion = manager.deleteSession('C:/workspace', 'draft-thread')
      await updateStarted
      state = { threads: [replacement], version: 1 }
      releaseUpdate()
      await deletion
      expect(state.threads).toEqual([])
    } finally {
      releaseUpdate()
      manager.dispose()
    }
  })

  it('archives a materialized binding even when its persisted ownership flag is stale', async () => {
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const bindingRecord = record({ materialized: false })
    let state = { threads: [{ ...bindingRecord }], version: 1 as const }
    const requests: Array<{ method: string, params: unknown }> = []
    const internals = manager as unknown as {
      client: {
        request: (method: string, params: unknown) => Promise<unknown>
        stop: () => void
      }
      index: {
        read: () => Promise<typeof state>
        update: (updater: (current: typeof state) => typeof state) => Promise<typeof state>
      }
      installBinding: (value: CodexThreadRecord, isStreaming: boolean) => Promise<{
        record: CodexThreadRecord
      }>
    }
    internals.client = {
      request: async (method, params) => {
        requests.push({ method, params })
        if (method === 'thread/list') return { data: [], nextCursor: null }
        if (method === 'thread/archive') return {}
        throw new Error(`Unexpected Codex request: ${method}`)
      },
      stop: () => undefined,
    }
    internals.index = {
      read: async () => structuredClone(state),
      update: async (updater) => {
        state = updater(structuredClone(state))
        return structuredClone(state)
      },
    }
    const binding = await internals.installBinding(bindingRecord, false)
    binding.record.materialized = true

    try {
      await manager.discardWorkspaceSessions('C:/workspace')
      expect(requests).toContainEqual({
        method: 'thread/archive',
        params: { threadId: 'thread-1' },
      })
      expect(requests).not.toContainEqual(expect.objectContaining({ method: 'thread/unsubscribe' }))
      expect(state.threads).toEqual([])
    } finally {
      manager.dispose()
    }
  })

  it('drops a failed queued prompt and continues with the next prompt', async () => {
    const events: unknown[] = []
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: (event) => events.push(event) })
    const currentRecord = record()
    const requests: string[] = []
    const internals = manager as unknown as {
      client: unknown
      handleNotification: (notification: {
        method: 'turn/completed'
        params: { threadId: string, turn: Thread['turns'][number] }
      }) => Promise<void>
      index: { update: (updater: (state: { threads: CodexThreadRecord[], version: 1 }) => unknown) => Promise<unknown> }
      installBinding: (value: CodexThreadRecord, isStreaming: boolean) => Promise<{
        activeTurnId: string | null
        isStreaming: boolean
        queuedPrompts: Array<{ attachments: [], prompt: string }>
      }>
      sessionStore: CodexSessionStore
    }
    internals.client = {
      request: async (method: string, params: { input?: Array<{ type: string, text?: string }> }) => {
        expect(method).toBe('turn/start')
        const prompt = params.input?.find((input) => input.type === 'text')?.text ?? ''
        requests.push(prompt)
        if (prompt === 'invalid prompt') throw new Error('invalid queued input')
        return {
          turn: {
            completedAt: null,
            durationMs: null,
            error: null,
            id: 'turn-next',
            items: [],
            itemsView: 'full',
            startedAt: 3,
            status: 'inProgress',
          },
        }
      },
      stop: () => undefined,
    }
    internals.index = {
      update: async (updater) => updater({ threads: [currentRecord], version: 1 }),
    }
    internals.sessionStore.install(thread({ type: 'active', activeFlags: [] }))
    const binding = await internals.installBinding(currentRecord, true)
    binding.activeTurnId = 'turn-current'
    binding.queuedPrompts.push(
      { attachments: [], prompt: 'invalid prompt' },
      { attachments: [], prompt: 'valid prompt' },
    )

    try {
      await internals.handleNotification({
        method: 'turn/completed',
        params: {
          threadId: 'thread-1',
          turn: {
            completedAt: 2,
            durationMs: 1,
            error: null,
            id: 'turn-current',
            items: [],
            itemsView: 'full',
            startedAt: 1,
            status: 'completed',
          },
        },
      })
      expect(requests).toEqual(['invalid prompt', 'valid prompt'])
      expect(binding.queuedPrompts).toEqual([])
      expect(binding).toMatchObject({ activeTurnId: 'turn-next', isStreaming: true })
      expect(events).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('invalid queued input'),
        sessionId: 'thread-1',
        type: 'error',
      }))
    } finally {
      manager.dispose()
    }
  })

  it('keeps a turn busy after interrupt acknowledgement until App Server completes it', async () => {
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const currentRecord = record()
    const requests: Array<{ method: string, params: unknown }> = []
    const internals = manager as unknown as {
      client: unknown
      index: { read: () => Promise<{ threads: CodexThreadRecord[], version: 1 }> }
      installBinding: (value: CodexThreadRecord, isStreaming: boolean) => Promise<{
        activeTurnId: string | null
        isStreaming: boolean
      }>
      sessionStore: CodexSessionStore
    }
    internals.client = {
      request: async (method: string, params: unknown) => {
        requests.push({ method, params })
        if (method === 'thread/list') {
          return { data: [thread({ type: 'active', activeFlags: [] })], nextCursor: null }
        }
        return {}
      },
      stop: () => undefined,
    }
    internals.index = { read: async () => ({ threads: [currentRecord], version: 1 }) }
    const activeThread = thread({ type: 'active', activeFlags: [] })
    internals.sessionStore.install(activeThread)
    const binding = await internals.installBinding(currentRecord, true)
    binding.activeTurnId = 'turn-current'

    try {
      const state = await manager.abortActivePrompt('C:/workspace', 'thread-1')
      expect(requests).toContainEqual({
        method: 'turn/interrupt',
        params: { threadId: 'thread-1', turnId: 'turn-current' },
      })
      expect(requests).toContainEqual(expect.objectContaining({ method: 'thread/list' }))
      expect(binding).toMatchObject({ activeTurnId: 'turn-current', isStreaming: true })
      expect(state.runtime).toMatchObject({ executionState: { type: 'busy' }, isStreaming: true })
    } finally {
      manager.dispose()
    }
  })
})

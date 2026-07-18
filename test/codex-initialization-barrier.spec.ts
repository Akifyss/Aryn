import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const processState = vi.hoisted(() => ({
  initializeGate: null as Promise<void> | null,
  initializeError: null as Error | null,
  initializeErrors: [] as Error[],
  initializeRequests: [] as Array<Record<string, unknown>>,
  initializeStarted: 0,
  instances: 0,
  modelListErrors: [] as Error[],
  modelListRequests: [] as Array<Record<string, unknown>>,
  modelPages: [] as Array<{ data: Array<Record<string, unknown>>, nextCursor: string | null }>,
  stopped: 0,
}))

vi.mock('../electron/main/external-cli-environment', () => ({
  prepareExternalCliEnvironment: async () => undefined,
}))

vi.mock('../electron/main/json-line-process', () => ({
  JsonRpcRequestError: class extends Error {},
  JsonLineProcess: class {
    constructor() {
      processState.instances += 1
    }

    notify() {}

    async request(message: { method?: string, params?: Record<string, unknown> }) {
      if (message.method === 'initialize') {
        processState.initializeRequests.push(message.params ?? {})
        processState.initializeStarted += 1
        await processState.initializeGate
        const queuedError = processState.initializeErrors.shift()
        if (queuedError) throw queuedError
        if (processState.initializeError) throw processState.initializeError
        return { result: {} }
      }
      if (message.method === 'model/list') {
        processState.modelListRequests.push(message.params ?? {})
        const queuedError = processState.modelListErrors.shift()
        if (queuedError) throw queuedError
        return { result: processState.modelPages.shift() ?? { data: [], nextCursor: null } }
      }
      return { result: {} }
    }

    start() {}

    stop() {
      processState.stopped += 1
    }
  },
}))

import { CodexAgentManager } from '../electron/main/codex-agent'

describe('Codex App Server initialization', () => {
  beforeEach(() => {
    processState.initializeGate = null
    processState.initializeError = null
    processState.initializeErrors = []
    processState.initializeRequests = []
    processState.initializeStarted = 0
    processState.instances = 0
    processState.modelListErrors = []
    processState.modelListRequests = []
    processState.modelPages = []
    processState.stopped = 0
  })

  it('keeps concurrent callers behind one initialization barrier', async () => {
    let releaseInitialize!: () => void
    processState.initializeGate = new Promise<void>((resolve) => {
      releaseInitialize = resolve
    })
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })

    try {
      const firstLoad = manager.loadDraftState()
      await vi.waitFor(() => expect(processState.initializeStarted).toBe(1))
      let secondLoadSettled = false
      const secondLoad = manager.loadDraftState().finally(() => {
        secondLoadSettled = true
      })

      await Promise.resolve()
      expect(secondLoadSettled).toBe(false)
      expect(processState.instances).toBe(1)

      releaseInitialize()
      await Promise.all([firstLoad, secondLoad])
      expect(processState.initializeStarted).toBe(1)
      expect(processState.instances).toBe(1)
    } finally {
      manager.dispose()
    }
  })

  it('negotiates the same stable protocol surface used by the generated types', async () => {
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })

    try {
      await manager.loadDraftState()
      expect(processState.initializeRequests).toHaveLength(1)
      expect(processState.initializeRequests[0]).toMatchObject({
        capabilities: {
          experimentalApi: false,
        },
      })
    } finally {
      manager.dispose()
    }
  })

  it('stops a partially initialized App Server before surfacing the failure', async () => {
    processState.initializeError = new Error('initialize rejected')
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })

    await expect(manager.loadDraftState()).rejects.toThrow('initialize rejected')
    expect(processState.instances).toBe(1)
    expect(processState.stopped).toBe(1)
    manager.dispose()
  })

  it('loads every page exposed by the official model-list cursor', async () => {
    const first = {
      defaultReasoningEffort: 'medium',
      description: 'First',
      displayName: 'First',
      hidden: false,
      inputModalities: ['text'],
      isDefault: true,
      model: 'gpt-first',
      supportedReasoningEfforts: [],
      supportsPersonality: false,
      upgrade: null,
    }
    const second = { ...first, displayName: 'Second', isDefault: false, model: 'gpt-second' }
    processState.modelPages = [
      { data: [first], nextCursor: 'page-2' },
      { data: [second], nextCursor: null },
    ]
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })

    try {
      const state = await manager.loadDraftState()
      expect(state.runtime.availableModels).toEqual(['openai/gpt-first', 'openai/gpt-second'])
      expect(processState.modelListRequests).toEqual([
        { cursor: null, includeHidden: false, limit: 100 },
        { cursor: 'page-2', includeHidden: false, limit: 100 },
      ])
    } finally {
      manager.dispose()
    }
  })

  it('fails fast when model/list repeats a cursor instead of looping forever', async () => {
    processState.modelPages = [
      { data: [], nextCursor: 'same-page' },
      { data: [], nextCursor: 'same-page' },
    ]
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })

    try {
      await expect(manager.loadDraftState()).rejects.toThrow('repeated cursor "same-page"')
      expect(processState.modelListRequests).toHaveLength(2)
      expect(processState.stopped).toBe(1)
    } finally {
      manager.dispose()
    }
  })

  it('preserves and rebuilds a schema-incompatible models cache before retrying once', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-cache-recovery-'))
    const codexHome = path.join(tempRoot, 'codex-home')
    const agentDir = path.join(tempRoot, 'agent-data')
    const cachePath = path.join(codexHome, 'models_cache.json')
    const previousCodexHome = process.env.CODEX_HOME
    await mkdir(codexHome, { recursive: true })
    await writeFile(cachePath, '{"client_version":"old","models":[]}', 'utf8')
    process.env.CODEX_HOME = codexHome
    processState.initializeErrors = [new Error(
      'codex exited with code 1: failed to load models cache: missing field `supports_reasoning_summaries` at line 1 column 1',
    )]
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const manager = new CodexAgentManager({ agentDir, emitEvent: () => undefined })

    try {
      await expect(manager.loadDraftState()).resolves.toBeTruthy()
      expect(processState.instances).toBe(2)
      expect(processState.stopped).toBe(1)
      await expect(readFile(cachePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(
        path.join(codexHome, 'models_cache.aryn-incompatible.json'),
        'utf8',
      )).resolves.toContain('"client_version":"old"')
    } finally {
      manager.dispose()
      warning.mockRestore()
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousCodexHome
      await rm(tempRoot, { force: true, recursive: true })
    }
  })

  it('rebuilds an existing models cache when an incompatible server leaves model/list pending', async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aryn-codex-cache-timeout-recovery-'))
    const codexHome = path.join(tempRoot, 'codex-home')
    const agentDir = path.join(tempRoot, 'agent-data')
    const cachePath = path.join(codexHome, 'models_cache.json')
    const previousCodexHome = process.env.CODEX_HOME
    await mkdir(codexHome, { recursive: true })
    await writeFile(cachePath, '{"client_version":"newer-client","models":[]}', 'utf8')
    process.env.CODEX_HOME = codexHome
    processState.modelListErrors = [new Error('codex request "model/list" timed out.')]
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const manager = new CodexAgentManager({ agentDir, emitEvent: () => undefined })

    try {
      await expect(manager.loadDraftState()).resolves.toBeTruthy()
      expect(processState.instances).toBe(2)
      expect(processState.stopped).toBe(1)
      expect(processState.modelListRequests).toHaveLength(2)
      await expect(readFile(cachePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(readFile(
        path.join(codexHome, 'models_cache.aryn-incompatible.json'),
        'utf8',
      )).resolves.toContain('"client_version":"newer-client"')
    } finally {
      manager.dispose()
      warning.mockRestore()
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previousCodexHome
      await rm(tempRoot, { force: true, recursive: true })
    }
  })
})

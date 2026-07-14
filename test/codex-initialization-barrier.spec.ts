import { beforeEach, describe, expect, it, vi } from 'vitest'

const processState = vi.hoisted(() => ({
  initializeGate: null as Promise<void> | null,
  initializeStarted: 0,
  instances: 0,
  stopped: 0,
}))

vi.mock('../electron/main/external-cli-environment', () => ({
  prepareExternalCliEnvironment: async () => undefined,
}))

vi.mock('../electron/main/json-line-process', () => ({
  JsonLineProcess: class {
    constructor() {
      processState.instances += 1
    }

    notify() {}

    async request(message: { method?: string }) {
      if (message.method === 'initialize') {
        processState.initializeStarted += 1
        await processState.initializeGate
        return { result: {} }
      }
      if (message.method === 'model/list') return { result: { data: [] } }
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
    processState.initializeStarted = 0
    processState.instances = 0
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
})

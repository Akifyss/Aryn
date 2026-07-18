import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  builtinManagers: [] as Array<{
    created: number
    deleted: string[]
    disposed: number
    id: number
    listed: number
    loaded: number
    opened: string[]
    prompts: string[]
  }>,
  codexPrompts: [] as unknown[][],
  openCodePrompts: [] as unknown[][],
}))

const behavior = vi.hoisted(() => ({
  createFailures: 0,
  loadFailures: 0,
  openFailures: 0,
  remainingSessions: [] as Array<{ path: string }>,
}))

vi.mock('../electron/main/agent', () => ({
  PiAgentManager: class {
    private readonly state = {
      created: 0,
      deleted: [] as string[],
      disposed: 0,
      id: calls.builtinManagers.length + 1,
      listed: 0,
      loaded: 0,
      opened: [] as string[],
      prompts: [] as string[],
    }

    constructor() {
      calls.builtinManagers.push(this.state)
    }

    dispose() {
      this.state.disposed += 1
    }
    async loadWorkspaceState(_cwd: string, sessionPath: string | null = null) {
      this.state.loaded += 1
      if (behavior.loadFailures > 0) {
        behavior.loadFailures -= 1
        throw new Error('load failed')
      }
      return { activeSession: sessionPath ? { sessionPath } : null, runtime: {}, sessions: [] }
    }
    async listSessionItems() {
      this.state.listed += 1
      return behavior.remainingSessions
    }
    async createSession() {
      this.state.created += 1
      if (behavior.createFailures > 0) {
        behavior.createFailures -= 1
        throw new Error('create failed')
      }
      return { activeSession: { sessionPath: 'C:/sessions/new.jsonl' }, runtime: {}, sessions: [] }
    }
    async openSession(_cwd: string, sessionPath: string) {
      this.state.opened.push(sessionPath)
      if (behavior.openFailures > 0) {
        behavior.openFailures -= 1
        throw new Error('open failed')
      }
      return { activeSession: { sessionPath }, runtime: {}, sessions: [] }
    }
    async deleteSession(_cwd: string, sessionPath: string) {
      this.state.deleted.push(sessionPath)
    }
    async sendPrompt(prompt: string) {
      this.state.prompts.push(prompt)
      return { ok: true }
    }
  },
}))

vi.mock('../electron/main/codex-agent', () => ({
  CodexAgentManager: class {
    dispose() {}
    async sendPrompt(...args: unknown[]) {
      calls.codexPrompts.push(args)
      return { ok: true }
    }
  },
}))

vi.mock('../electron/main/opencode-agent', () => ({
  OpenCodeAgentManager: class {
    dispose() {}
    async sendPrompt(...args: unknown[]) {
      calls.openCodePrompts.push(args)
      return { ok: true }
    }
  },
}))

vi.mock('../electron/main/pi-cli-agent', () => ({
  PiCliAgentManager: class { dispose() {} },
}))

import { AgentManager } from '../electron/main/agent-manager'

describe('AgentManager native-session routing', () => {
  beforeEach(() => {
    calls.builtinManagers.length = 0
    calls.codexPrompts.length = 0
    calls.openCodePrompts.length = 0
    behavior.createFailures = 0
    behavior.loadFailures = 0
    behavior.openFailures = 0
    behavior.remainingSessions = []
  })

  it('passes the requested native session directly to an external adapter', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    await manager.sendPrompt({
      agentId: 'codex',
      sessionPath: 'thread-a',
      workspacePath: 'C:/workspace',
    }, 'hello')

    expect(calls.codexPrompts).toEqual([['C:/workspace', 'thread-a', 'hello', undefined, undefined, undefined]])
    manager.dispose()
  })

  it('passes Codex client message IDs through for exact optimistic reconciliation', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    await manager.sendPrompt({
      agentId: 'codex',
      sessionPath: 'thread-a',
      workspacePath: 'C:/workspace',
    }, 'hello', undefined, undefined, { clientMessageId: 'client-user-1' })

    expect(calls.codexPrompts.at(-1)).toEqual([
      'C:/workspace',
      'thread-a',
      'hello',
      undefined,
      undefined,
      { clientMessageId: 'client-user-1' },
    ])
    manager.dispose()
  })

  it('rejects mutable workspace-active routing when no native session is supplied', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    await expect(manager.sendPrompt({
      agentId: 'codex',
      workspacePath: 'C:/workspace',
    }, 'hello')).rejects.toThrow('native session identifier')
    manager.dispose()
  })

  it('rejects malformed interaction responses before they reach an adapter', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })

    await expect(manager.respondToInteraction({
      agentId: 'codex',
      optionId: '',
      requestId: 'request-a',
      sessionId: 'thread-a',
    })).rejects.toThrow('interaction response is invalid')
    manager.dispose()
  })

  it('routes client optimistic IDs only to the OpenCode adapter', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const options = {
      clientMessageId: 'msg_0123456789abABCDEFGHIJKLMN',
      clientPartIds: ['prt_0123456789acABCDEFGHIJKLMN'],
    }
    await manager.sendPrompt({
      agentId: 'opencode',
      sessionPath: 'session-a',
      workspacePath: 'C:/workspace',
    }, 'hello', undefined, [], options)

    expect(calls.openCodePrompts).toEqual([[
      'C:/workspace',
      'session-a',
      'hello',
      undefined,
      [],
      options,
    ]])
    manager.dispose()
  })

  it('keeps embedded PI operations bound to their own session manager', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    await manager.openSession(scope, 'C:/sessions/one.jsonl')
    await manager.openSession(scope, 'C:/sessions/two.jsonl')
    await manager.sendPrompt({ ...scope, sessionPath: 'C:/sessions/one.jsonl' }, 'target one')
    await manager.sendPrompt({ ...scope, sessionPath: 'C:/sessions/two.jsonl' }, 'target two')

    const sessionManagers = calls.builtinManagers.filter((entry) => entry.opened.length > 0)
    expect(sessionManagers).toHaveLength(2)
    expect(sessionManagers.map((entry) => entry.prompts)).toEqual([['target one'], ['target two']])
    manager.dispose()
  })

  it('disposes a newly allocated embedded PI manager when session creation fails', async () => {
    behavior.createFailures = 1
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })

    await expect(manager.createSession({
      agentId: 'builtin-pi',
      workspacePath: 'C:/workspace',
    })).rejects.toThrow('create failed')

    const failedManager = calls.builtinManagers.find((entry) => entry.created > 0)
    expect(failedManager?.disposed).toBe(1)
    manager.dispose()
    expect(failedManager?.disposed).toBe(1)
  })

  it('does not cache a newly allocated embedded PI manager when opening fails', async () => {
    behavior.openFailures = 1
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }

    await expect(manager.openSession(scope, 'C:/sessions/one.jsonl')).rejects.toThrow('open failed')
    await manager.openSession(scope, 'C:/sessions/one.jsonl')

    const attemptedManagers = calls.builtinManagers.filter((entry) => entry.opened.length > 0)
    expect(attemptedManagers).toHaveLength(2)
    expect(attemptedManagers[0]?.disposed).toBe(1)
    expect(attemptedManagers[1]?.disposed).toBe(0)
    manager.dispose()
  })

  it('reuses one fallback manager after deleting the active embedded PI session', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    await manager.openSession(scope, 'C:/sessions/one.jsonl')
    behavior.remainingSessions = [{ path: 'C:/sessions/two.jsonl' }]
    const managerCountBeforeDelete = calls.builtinManagers.length

    await manager.deleteSession(scope, 'C:/sessions/one.jsonl')

    expect(calls.builtinManagers).toHaveLength(managerCountBeforeDelete + 1)
    const fallbackManager = calls.builtinManagers.at(-1)
    expect(fallbackManager?.listed).toBe(1)
    expect(fallbackManager?.opened).toEqual(['C:/sessions/two.jsonl'])
    manager.dispose()
  })
})

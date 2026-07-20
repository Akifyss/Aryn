import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => ({
  builtinManagers: [] as Array<{
    created: number
    deleted: string[]
    discarded: number
    disposed: number
    id: number
    listed: number
    loaded: number
    opened: string[]
    prompts: string[]
    released: number
  }>,
  codexLoads: [] as unknown[][],
  codexOpened: [] as unknown[][],
  codexPrompts: [] as unknown[][],
  piCliPrompts: [] as unknown[][],
  openCodePrompts: [] as unknown[][],
}))

const behavior = vi.hoisted(() => ({
  createGate: null as Promise<void> | null,
  createFailures: 0,
  deleteGates: new Map<string, Promise<void>>(),
  loadGate: null as Promise<void> | null,
  loadFailures: 0,
  openGates: new Map<string, Promise<void>>(),
  openFailures: 0,
  releaseGate: null as Promise<void> | null,
  remainingSessions: [] as Array<{ path: string }>,
}))

vi.mock('../electron/main/agent', () => ({
  PiAgentManager: class {
    private readonly state = {
      created: 0,
      deleted: [] as string[],
      discarded: 0,
      disposed: 0,
      id: calls.builtinManagers.length + 1,
      listed: 0,
      loaded: 0,
      opened: [] as string[],
      prompts: [] as string[],
      released: 0,
    }

    constructor() {
      calls.builtinManagers.push(this.state)
    }

    dispose() {
      this.state.disposed += 1
    }
    async loadWorkspaceState(_cwd: string, sessionPath: string | null = null) {
      this.state.loaded += 1
      await behavior.loadGate
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
      await behavior.createGate
      if (behavior.createFailures > 0) {
        behavior.createFailures -= 1
        throw new Error('create failed')
      }
      return { activeSession: { sessionPath: 'C:/sessions/new.jsonl' }, runtime: {}, sessions: [] }
    }
    async openSession(_cwd: string, sessionPath: string) {
      this.state.opened.push(sessionPath)
      await behavior.openGates.get(sessionPath)
      if (behavior.openFailures > 0) {
        behavior.openFailures -= 1
        throw new Error('open failed')
      }
      return { activeSession: { sessionPath }, runtime: {}, sessions: [] }
    }
    async deleteSession(_cwd: string, sessionPath: string) {
      this.state.deleted.push(sessionPath)
      await behavior.deleteGates.get(sessionPath)
      return { activeSession: null, runtime: {}, sessions: [] }
    }
    async sendPrompt(prompt: string) {
      this.state.prompts.push(prompt)
      return { ok: true }
    }
    async releaseWorkspaceRuntime() {
      this.state.released += 1
      await behavior.releaseGate
    }
    async discardWorkspaceSessions() {
      this.state.discarded += 1
    }
  },
}))

vi.mock('../electron/main/codex-agent', () => ({
  CodexAgentManager: class {
    dispose() {}
    async discardWorkspaceSessions() {}
    async loadWorkspaceState(...args: unknown[]) {
      calls.codexLoads.push(args)
      return { activeSession: null, runtime: {}, sessions: [] }
    }
    async openSession(...args: unknown[]) {
      calls.codexOpened.push(args)
      return { activeSession: { sessionPath: args[1] }, runtime: {}, sessions: [] }
    }
    async releaseWorkspaceRuntime() {}
    async sendPrompt(...args: unknown[]) {
      calls.codexPrompts.push(args)
      return { ok: true }
    }
  },
}))

vi.mock('../electron/main/opencode-agent', () => ({
  OpenCodeAgentManager: class {
    dispose() {}
    async discardWorkspaceSessions() {}
    async releaseWorkspaceRuntime() {}
    async sendPrompt(...args: unknown[]) {
      calls.openCodePrompts.push(args)
      return { ok: true }
    }
  },
}))

vi.mock('../electron/main/pi-cli-agent', () => ({
  PiCliAgentManager: class {
    dispose() {}
    async discardWorkspaceSessions() {}
    async releaseWorkspaceRuntime() {}
    async sendPrompt(...args: unknown[]) {
      calls.piCliPrompts.push(args)
      return { ok: true }
    }
  },
}))

import { AgentManager } from '../electron/main/agent-manager'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('AgentManager native-session routing', () => {
  beforeEach(() => {
    calls.builtinManagers.length = 0
    calls.codexLoads.length = 0
    calls.codexOpened.length = 0
    calls.codexPrompts.length = 0
    calls.piCliPrompts.length = 0
    calls.openCodePrompts.length = 0
    behavior.createGate = null
    behavior.createFailures = 0
    behavior.deleteGates.clear()
    behavior.loadGate = null
    behavior.loadFailures = 0
    behavior.openGates.clear()
    behavior.openFailures = 0
    behavior.releaseGate = null
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

  it('rejects conflicting scoped and explicit native session identities', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = {
      agentId: 'codex' as const,
      sessionPath: 'thread-a',
      workspacePath: 'C:/workspace',
    }

    await expect(manager.openSession(scope, 'thread-b')).rejects.toThrow(
      'scope does not match the requested native session',
    )
    expect(calls.codexOpened).toEqual([])

    await manager.openSession(scope, '  thread-a  ')
    expect(calls.codexOpened).toEqual([['C:/workspace', 'thread-a']])
    manager.dispose()
  })

  it('rejects a preferred workspace session that conflicts with its scope', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = {
      agentId: 'codex' as const,
      sessionPath: 'thread-a',
      workspacePath: 'C:/workspace',
    }

    await expect(manager.loadWorkspaceState(scope, 'thread-b')).rejects.toThrow(
      'scope does not match the requested native session',
    )
    expect(calls.codexLoads).toEqual([])

    await manager.loadWorkspaceState(scope, '  thread-a  ')
    expect(calls.codexLoads).toEqual([['C:/workspace', 'thread-a', {}]])
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

  it('keeps identical native session IDs isolated across external Agents', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const workspacePath = 'C:/workspace'
    const sessionPath = 'shared-native-id'

    await Promise.all([
      manager.sendPrompt({ agentId: 'codex', sessionPath, workspacePath }, 'to codex'),
      manager.sendPrompt({ agentId: 'opencode', sessionPath, workspacePath }, 'to opencode'),
      manager.sendPrompt({ agentId: 'pi', sessionPath, workspacePath }, 'to pi'),
    ])

    expect(calls.codexPrompts).toEqual([[
      workspacePath,
      sessionPath,
      'to codex',
      undefined,
      undefined,
      undefined,
    ]])
    expect(calls.openCodePrompts).toEqual([[
      workspacePath,
      sessionPath,
      'to opencode',
      undefined,
      undefined,
      undefined,
    ]])
    expect(calls.piCliPrompts).toEqual([[
      workspacePath,
      sessionPath,
      'to pi',
      undefined,
      undefined,
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

  it('keeps a superseded embedded PI creation bound for its first background prompt', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const createdSession = 'C:/sessions/new.jsonl'
    const newerSession = 'C:/sessions/newer.jsonl'
    const slowCreate = deferred()
    behavior.createGate = slowCreate.promise

    const createResult = manager.createSession(scope)
    await manager.openSession(scope, newerSession)
    slowCreate.resolve()
    await createResult
    await manager.sendPrompt({ ...scope, sessionPath: createdSession }, 'background first prompt')
    await manager.listSessionItems(scope)

    const createdManager = calls.builtinManagers.find((entry) => entry.created > 0)
    const newerManager = calls.builtinManagers.find((entry) => entry.opened.includes(newerSession))
    expect(createdManager?.disposed).toBe(0)
    expect(createdManager?.prompts).toEqual(['background first prompt'])
    expect(createdManager?.listed).toBe(0)
    expect(newerManager?.listed).toBe(1)
    manager.dispose()
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

  it('keeps a shared embedded PI manager when one concurrent open succeeds', async () => {
    behavior.openFailures = 1
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const sessionPath = 'C:/sessions/shared.jsonl'

    const results = await Promise.allSettled([
      manager.openSession(scope, sessionPath),
      manager.openSession(scope, sessionPath),
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])

    await manager.sendPrompt({ ...scope, sessionPath }, 'after concurrent open')
    const sharedManager = calls.builtinManagers.find((entry) => entry.opened.includes(sessionPath))
    expect(sharedManager?.disposed).toBe(0)
    expect(sharedManager?.opened).toEqual([sessionPath, sessionPath])
    expect(sharedManager?.prompts).toEqual(['after concurrent open'])
    manager.dispose()
  })

  it('evicts a shared embedded PI manager after all concurrent opens fail', async () => {
    behavior.openFailures = 2
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const sessionPath = 'C:/sessions/shared-failure.jsonl'

    const results = await Promise.allSettled([
      manager.openSession(scope, sessionPath),
      manager.openSession(scope, sessionPath),
    ])
    expect(results.every((result) => result.status === 'rejected')).toBe(true)

    await manager.openSession(scope, sessionPath)
    const attemptedManagers = calls.builtinManagers.filter((entry) => entry.opened.includes(sessionPath))
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

  it('does not let a slow embedded PI open replace a newer active session', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const slowSession = 'C:/sessions/slow.jsonl'
    const fastSession = 'C:/sessions/fast.jsonl'
    const slowOpen = deferred()
    behavior.openGates.set(slowSession, slowOpen.promise)

    const slowResult = manager.openSession(scope, slowSession)
    await manager.openSession(scope, fastSession)
    slowOpen.resolve()
    await slowResult
    await manager.listSessionItems(scope)

    const slowManager = calls.builtinManagers.find((entry) => entry.opened.includes(slowSession))
    const fastManager = calls.builtinManagers.find((entry) => entry.opened.includes(fastSession))
    expect(slowManager?.listed).toBe(0)
    expect(fastManager?.listed).toBe(1)
    manager.dispose()
  })

  it('disposes an unbound provisional manager after a newer session becomes active', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const targetSession = 'C:/sessions/target.jsonl'
    const slowOpen = deferred()
    behavior.openGates.set(targetSession, slowOpen.promise)

    const provisionalLoad = manager.loadWorkspaceState(scope)
    const targetOpen = manager.openSession(scope, targetSession)
    await provisionalLoad
    slowOpen.resolve()
    await targetOpen
    await manager.listSessionItems(scope)

    const provisionalManager = calls.builtinManagers.find((entry) => entry.loaded > 0)
    const targetManager = calls.builtinManagers.find((entry) => entry.opened.includes(targetSession))
    expect(provisionalManager?.disposed).toBe(1)
    expect(provisionalManager?.listed).toBe(0)
    expect(targetManager?.listed).toBe(1)
    manager.dispose()
  })

  it('does not let a stale deletion fallback replace a newer active session', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const deletedSession = 'C:/sessions/deleted.jsonl'
    const newerSession = 'C:/sessions/newer.jsonl'
    const fallbackSession = 'C:/sessions/fallback.jsonl'
    await manager.openSession(scope, deletedSession)
    behavior.remainingSessions = [{ path: fallbackSession }]
    const slowDelete = deferred()
    behavior.deleteGates.set(deletedSession, slowDelete.promise)

    const deleteResult = manager.deleteSession(scope, deletedSession)
    await manager.openSession(scope, newerSession)
    slowDelete.resolve()
    await deleteResult
    await manager.listSessionItems(scope)

    const newerManager = calls.builtinManagers.find((entry) => entry.opened.includes(newerSession))
    expect(newerManager?.listed).toBe(1)
    expect(calls.builtinManagers.some((entry) => entry.opened.includes(fallbackSession))).toBe(false)
    manager.dispose()
  })

  it('disposes a late active-session refresh again after a background deletion releases the workspace', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const backgroundSession = 'C:/sessions/background.jsonl'
    const activeSession = 'C:/sessions/active.jsonl'
    await manager.openSession(scope, backgroundSession)
    await manager.openSession(scope, activeSession)
    const slowRefresh = deferred()
    behavior.loadGate = slowRefresh.promise

    const deleteResult = manager.deleteSession(scope, backgroundSession)
    await vi.waitFor(() => {
      const activeManager = calls.builtinManagers.find((entry) => entry.opened.includes(activeSession))
      expect(activeManager?.loaded).toBe(1)
    })
    await manager.releaseWorkspaceRuntime(scope.workspacePath)
    slowRefresh.resolve()
    await deleteResult

    const activeManager = calls.builtinManagers.find((entry) => entry.opened.includes(activeSession))
    expect(activeManager?.disposed).toBe(2)
    manager.dispose()
  })

  it('disposes a late embedded PI deletion fallback again after workspace release', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const deletedSession = 'C:/sessions/deleted.jsonl'
    const fallbackSession = 'C:/sessions/fallback.jsonl'
    await manager.openSession(scope, deletedSession)
    behavior.remainingSessions = [{ path: fallbackSession }]
    const slowFallback = deferred()
    behavior.openGates.set(fallbackSession, slowFallback.promise)

    const deleteResult = manager.deleteSession(scope, deletedSession)
    await vi.waitFor(() => {
      expect(calls.builtinManagers.some((entry) => entry.opened.includes(fallbackSession))).toBe(true)
    })
    await manager.releaseWorkspaceRuntime(scope.workspacePath)
    slowFallback.resolve()
    await deleteResult

    const fallbackManager = calls.builtinManagers.find((entry) => entry.opened.includes(fallbackSession))
    expect(fallbackManager?.disposed).toBe(2)
    manager.dispose()
  })

  it('does not resurrect an embedded PI manager after workspace release', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const sessionPath = 'C:/sessions/slow.jsonl'
    const slowOpen = deferred()
    behavior.openGates.set(sessionPath, slowOpen.promise)

    const staleOpenResult = manager.openSession(scope, sessionPath)
    await manager.releaseWorkspaceRuntime(scope.workspacePath)
    slowOpen.resolve()
    await staleOpenResult
    behavior.openGates.delete(sessionPath)
    await manager.openSession(scope, sessionPath)

    const attemptedManagers = calls.builtinManagers.filter((entry) => entry.opened.includes(sessionPath))
    expect(attemptedManagers).toHaveLength(2)
    expect(attemptedManagers[0]?.disposed).toBe(2)
    expect(attemptedManagers[0]?.opened).toEqual([sessionPath])
    expect(attemptedManagers[1]?.disposed).toBe(0)
    manager.dispose()
  })

  it('disposes a late embedded PI creation again after workspace release', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const createdSession = 'C:/sessions/new.jsonl'
    const slowCreate = deferred()
    behavior.createGate = slowCreate.promise

    const staleCreateResult = manager.createSession(scope)
    await manager.releaseWorkspaceRuntime(scope.workspacePath)
    slowCreate.resolve()
    await staleCreateResult
    await manager.sendPrompt({ ...scope, sessionPath: createdSession }, 'fresh manager prompt')

    const createdManager = calls.builtinManagers.find((entry) => entry.created > 0)
    const promptManager = calls.builtinManagers.find((entry) => entry.prompts.includes('fresh manager prompt'))
    expect(createdManager?.disposed).toBe(2)
    expect(createdManager?.prompts).toEqual([])
    expect(promptManager?.id).not.toBe(createdManager?.id)
    manager.dispose()
  })

  it('disposes a late embedded PI open again after its session is deleted', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const sessionPath = 'C:/sessions/deleted-while-opening.jsonl'
    const slowOpen = deferred()
    behavior.openGates.set(sessionPath, slowOpen.promise)

    const staleOpenResult = manager.openSession(scope, sessionPath)
    await manager.deleteSession(scope, sessionPath)
    slowOpen.resolve()
    await staleOpenResult
    behavior.openGates.delete(sessionPath)
    await manager.openSession(scope, sessionPath)

    const attemptedManagers = calls.builtinManagers.filter((entry) => entry.opened.includes(sessionPath))
    expect(attemptedManagers).toHaveLength(2)
    expect(attemptedManagers[0]?.disposed).toBe(2)
    expect(attemptedManagers[1]?.disposed).toBe(0)
    manager.dispose()
  })

  it('routes a session reopened during workspace release to a fresh embedded PI manager', async () => {
    const manager = new AgentManager(() => undefined, { agentDir: 'C:/agent-data' })
    const scope = { agentId: 'builtin-pi' as const, workspacePath: 'C:/workspace' }
    const sessionPath = 'C:/sessions/reopened.jsonl'
    await manager.openSession(scope, sessionPath)
    const slowRelease = deferred()
    behavior.releaseGate = slowRelease.promise

    const releaseResult = manager.releaseWorkspaceRuntime(scope.workspacePath)
    await manager.openSession(scope, sessionPath)
    slowRelease.resolve()
    await releaseResult
    await manager.listSessionItems(scope)

    const sessionManagers = calls.builtinManagers.filter((entry) => entry.opened.includes(sessionPath))
    expect(sessionManagers).toHaveLength(2)
    expect(sessionManagers[0]?.disposed).toBe(1)
    expect(sessionManagers[0]?.listed).toBe(0)
    expect(sessionManagers[1]?.disposed).toBe(0)
    expect(sessionManagers[1]?.listed).toBe(1)
    manager.dispose()
  })
})

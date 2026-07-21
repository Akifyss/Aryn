import { describe, expect, it, vi } from 'vitest'
import {
  createAgentAvailabilityFromProbe,
  createAgentCatalogDiscovery,
} from '../electron/main/agent-cli-discovery'
import {
  AGENT_DEFINITIONS,
  type AgentAvailability,
  type AgentDefinition,
} from '../src/features/agent/agent-definition'

function getDefinition(agentId: AgentDefinition['id']) {
  return AGENT_DEFINITIONS.find((definition) => definition.id === agentId)!
}

function availability(agentId: AgentDefinition['id'], version: string): AgentAvailability {
  return {
    available: true,
    command: agentId === 'builtin-pi' ? null : agentId,
    definition: getDefinition(agentId),
    guidance: null,
    reason: null,
    version,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('agent CLI discovery diagnostics', () => {
  it('returns an actionable missing-command result', () => {
    const result = createAgentAvailabilityFromProbe(getDefinition('codex'), {
      command: 'codex',
      kind: 'not-found',
    })

    expect(result).toMatchObject({
      available: false,
      command: 'codex',
      reason: '未在 PATH 中找到命令',
      version: null,
    })
    expect(result.guidance).toContain('codex --version')
    expect(result.guidance).toContain('重启 Aryn')
    expect(result.guidance).toContain('重新打开 Agent 菜单')
    expect(result.guidance).not.toContain('重新检测')
  })

  it('keeps version incompatibility separate from its recovery guidance', () => {
    const result = createAgentAvailabilityFromProbe(getDefinition('opencode'), {
      code: 0,
      command: 'opencode',
      kind: 'closed',
      stderr: '',
      stdout: 'opencode version 2.0.0\n',
    })

    expect(result.available).toBe(false)
    expect(result.reason).toContain('2.0.0')
    expect(result.guidance).toContain('>=1.17.18 <2.0.0')
    expect(result.guidance).toContain('重新打开 Agent 菜单')
    expect(result.guidance).not.toContain('重新检测')
    expect(result.version).toBe('opencode version 2.0.0')
  })

  it('sanitizes command diagnostics before presenting them', () => {
    const result = createAgentAvailabilityFromProbe(getDefinition('pi'), {
      code: 1,
      command: 'pi',
      kind: 'closed',
      stderr: '\u001B]8;;https://example.com\u0007\u001B[31mLogin required\u001B[0m\u001B]8;;\u0007\u0000\u0085\nextra detail',
      stdout: '',
    })

    expect(result.reason).toBe('Login required')
    expect(result.reason).not.toContain('\u001B')
    expect(result.guidance).toContain('pi --version')
  })

  it('does not expose arbitrary spawn error messages', () => {
    const result = createAgentAvailabilityFromProbe(getDefinition('codex'), {
      command: 'codex',
      error: new Error('failed near C:\\Users\\someone\\secret'),
      kind: 'error',
    })

    expect(result.reason).toBe('无法启动命令')
    expect(result.reason).not.toContain('secret')
  })

  it('uses stdout diagnostics when a CLI reports failure there', () => {
    const result = createAgentAvailabilityFromProbe(getDefinition('codex'), {
      code: 2,
      command: 'codex',
      kind: 'closed',
      stderr: '',
      stdout: 'Configuration is invalid\n',
    })

    expect(result.reason).toBe('Configuration is invalid')
  })

  it('preserves successful version output without an issue', () => {
    const result = createAgentAvailabilityFromProbe(getDefinition('codex'), {
      code: 0,
      command: 'codex',
      kind: 'closed',
      stderr: '',
      stdout: 'codex-cli 0.144.5\n',
    })

    expect(result).toMatchObject({
      available: true,
      guidance: null,
      reason: null,
      version: 'codex-cli 0.144.5',
    })
  })
})

describe('agent catalog discovery coordination', () => {
  it('shares an active discovery and returns isolated cached values', async () => {
    let now = 1_000
    const pending = deferred<AgentAvailability[]>()
    const loadCatalog = vi.fn(() => pending.promise)
    const discovery = createAgentCatalogDiscovery({
      cacheDurationMs: 100,
      loadCatalog,
      now: () => now,
    })

    const first = discovery.discover()
    const second = discovery.discover()
    await vi.waitFor(() => {
      expect(loadCatalog).toHaveBeenCalledOnce()
    })

    pending.resolve([availability('codex', 'codex-cli 0.144.5')])
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult).toEqual(secondResult)
    expect(firstResult).not.toBe(secondResult)

    firstResult[0]!.version = 'mutated'
    const cached = await discovery.discover()
    expect(cached[0]?.version).toBe('codex-cli 0.144.5')
    expect(loadCatalog).toHaveBeenCalledOnce()

    now += 101
    const expired = deferred<AgentAvailability[]>()
    loadCatalog.mockImplementationOnce(() => expired.promise)
    const reload = discovery.discover()
    await vi.waitFor(() => {
      expect(loadCatalog).toHaveBeenCalledTimes(2)
    })
    expired.resolve([availability('codex', 'codex-cli 0.145.0')])
    await expect(reload).resolves.toMatchObject([{ version: 'codex-cli 0.145.0' }])
  })

  it('queues one fresh environment probe when force arrives during a normal discovery', async () => {
    const initial = deferred<AgentAvailability[]>()
    const forced = deferred<AgentAvailability[]>()
    const loadCatalog = vi.fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => forced.promise)
    const discovery = createAgentCatalogDiscovery({ loadCatalog })

    const normalResult = discovery.discover()
    const forcedResultA = discovery.discover({ force: true })
    const forcedResultB = discovery.discover({ force: true })

    await vi.waitFor(() => {
      expect(loadCatalog).toHaveBeenCalledOnce()
    })
    expect(loadCatalog).toHaveBeenNthCalledWith(1, { refreshEnvironment: false })

    initial.resolve([availability('pi', 'pi 0.80.7')])
    await expect(normalResult).resolves.toMatchObject([{ version: 'pi 0.80.7' }])
    await vi.waitFor(() => {
      expect(loadCatalog).toHaveBeenCalledTimes(2)
    })
    expect(loadCatalog).toHaveBeenNthCalledWith(2, { refreshEnvironment: true })

    forced.resolve([availability('pi', 'pi 0.81.0')])
    await expect(Promise.all([forcedResultA, forcedResultB])).resolves.toEqual([
      [expect.objectContaining({ version: 'pi 0.81.0' })],
      [expect.objectContaining({ version: 'pi 0.81.0' })],
    ])
  })

  it('shares concurrent forced discoveries instead of scheduling another retry', async () => {
    const pending = deferred<AgentAvailability[]>()
    const loadCatalog = vi.fn(() => pending.promise)
    const discovery = createAgentCatalogDiscovery({ loadCatalog })

    const first = discovery.discover({ force: true })
    const second = discovery.discover({ force: true })
    await vi.waitFor(() => {
      expect(loadCatalog).toHaveBeenCalledOnce()
    })
    expect(loadCatalog).toHaveBeenCalledWith({ refreshEnvironment: true })

    pending.resolve([availability('opencode', 'opencode 1.17.18')])
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(loadCatalog).toHaveBeenCalledOnce()
  })

  it('bypasses a valid cache when a fresh discovery is forced', async () => {
    const loadCatalog = vi.fn()
      .mockResolvedValueOnce([availability('pi', 'pi 0.80.7')])
      .mockResolvedValueOnce([availability('pi', 'pi 0.81.0')])
    const discovery = createAgentCatalogDiscovery({ loadCatalog })

    await expect(discovery.discover()).resolves.toMatchObject([{ version: 'pi 0.80.7' }])
    await expect(discovery.discover({ force: true })).resolves.toMatchObject([
      { version: 'pi 0.81.0' },
    ])

    expect(loadCatalog).toHaveBeenNthCalledWith(1, { refreshEnvironment: false })
    expect(loadCatalog).toHaveBeenNthCalledWith(2, { refreshEnvironment: true })
  })

  it('does not let an in-flight result repopulate a cache that was cleared', async () => {
    const initial = deferred<AgentAvailability[]>()
    const reload = deferred<AgentAvailability[]>()
    const loadCatalog = vi.fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => reload.promise)
    const discovery = createAgentCatalogDiscovery({ loadCatalog })

    const first = discovery.discover()
    discovery.clear()
    initial.resolve([availability('pi', 'pi 0.80.7')])
    await first

    const second = discovery.discover()
    await vi.waitFor(() => {
      expect(loadCatalog).toHaveBeenCalledTimes(2)
    })
    reload.resolve([availability('pi', 'pi 0.81.0')])
    await expect(second).resolves.toMatchObject([{ version: 'pi 0.81.0' }])
  })

  it('recovers after a loader throws synchronously', async () => {
    const loadCatalog = vi.fn()
      .mockImplementationOnce(() => {
        throw new Error('load failed')
      })
      .mockResolvedValueOnce([availability('codex', 'codex-cli 0.145.0')])
    const discovery = createAgentCatalogDiscovery({ loadCatalog })

    await expect(discovery.discover()).rejects.toThrow('load failed')
    await expect(discovery.discover()).resolves.toMatchObject([
      { version: 'codex-cli 0.145.0' },
    ])
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })
})

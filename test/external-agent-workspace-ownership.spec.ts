import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexAgentManager } from '../electron/main/codex-agent'
import { OpenCodeAgentManager } from '../electron/main/opencode-agent'
import { PiCliAgentManager } from '../electron/main/pi-cli-agent'
import type { SessionRuntimeLease } from '../electron/main/session-runtime-coordinator'

function workspaceIdentity(cwd: string) {
  const resolved = path.resolve(cwd)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

describe('external Agent workspace ownership', () => {
  it('does not reuse a cached Codex binding from another workspace', async () => {
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const binding = {
      activeTurnId: null,
      isStreaming: false,
      lastError: null,
      queuedPrompts: [],
      record: { cwd: 'C:/workspace-a', id: 'thread-a' },
    }
    const internals = manager as unknown as {
      installBinding: (record: typeof binding.record, isStreaming: boolean) => Promise<unknown>
      withBinding: (cwd: string, threadID: string, operation: (value: typeof binding) => unknown) => Promise<unknown>
    }
    await internals.installBinding(binding.record, false)

    await expect(internals.withBinding('C:/workspace-b', 'thread-a', () => undefined))
      .rejects.toThrow('not found for this workspace')
    manager.dispose()
  })

  it('does not reuse a cached PI CLI runtime from another workspace', async () => {
    const manager = new PiCliAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const internals = manager as unknown as {
      runtimeCoordinator: {
        ensure: (
          key: string,
          start: (lease: SessionRuntimeLease) => Promise<unknown>,
        ) => Promise<unknown>
      }
      withRuntime: (cwd: string, sessionID: string, operation: (runtime: unknown) => unknown) => Promise<unknown>
    }
    await internals.runtimeCoordinator.ensure(
      `${workspaceIdentity('C:/workspace-a')}\0session-a`,
      async (lease) => ({
        isStreaming: false,
        lease,
        models: [],
        process: { stop: () => undefined },
        record: { cwd: 'C:/workspace-a', id: 'session-a' },
        state: {},
      }),
    )

    await expect(internals.withRuntime('C:/workspace-b', 'session-a', () => undefined))
      .rejects.toThrow('not found for this workspace')
    manager.dispose()
  })

  it('rechecks workspace ownership after an OpenCode binding start completes', async () => {
    const manager = new OpenCodeAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const binding = { cwd: 'C:/workspace-a' }
    const internals = manager as unknown as {
      requireBinding: (client: unknown, cwd: string, sessionID: string) => Promise<typeof binding>
      sessionBindingStarts: Map<string, Promise<typeof binding>>
    }
    internals.sessionBindingStarts.set('session-a', Promise.resolve(binding))

    await expect(internals.requireBinding({}, 'C:/workspace-b', 'session-a'))
      .rejects.toThrow('not found for this Aryn workspace')
    manager.dispose()
  })

  it('releases a workspace without waiting for another workspace to finish starting', async () => {
    const otherWorkspace = workspaceIdentity('C:/workspace-b')
    const never = new Promise<never>(() => undefined)
    const codex = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const opencode = new OpenCodeAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const pi = new PiCliAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const codexInternals = codex as unknown as {
      listIndexedRecords: () => Promise<unknown[]>
      runtimeCoordinator: {
        ensure: (key: string, start: (lease: SessionRuntimeLease) => Promise<unknown>) => Promise<unknown>
      }
    }
    const opencodeInternals = opencode as unknown as {
      sessionBindingStarts: Map<string, Promise<never>>
      sessionBindingStartWorkspaces: Map<string, string>
    }
    let resolvePiStart!: (runtime: { process: { stop: () => void } }) => void
    const piStart = new Promise<{ process: { stop: () => void } }>((resolve) => {
      resolvePiStart = resolve
    })
    const piInternals = pi as unknown as {
      runtimeCoordinator: {
        ensure: (key: string, start: (lease: SessionRuntimeLease) => Promise<unknown>) => Promise<unknown>
      }
    }
    let resolveCodexStart!: () => void
    const codexStart = new Promise<void>((resolve) => {
      resolveCodexStart = resolve
    })
    codexInternals.listIndexedRecords = async () => []
    const codexStarting = codexInternals.runtimeCoordinator.ensure(
      `${otherWorkspace}\0thread-b`,
      async (lease) => {
        await codexStart
        return {
          activeTurnId: null,
          isStreaming: false,
          lease,
          queuedPrompts: [],
          record: { cwd: 'C:/workspace-b', id: 'thread-b' },
        }
      },
    )
    opencodeInternals.sessionBindingStarts.set('session-b', never)
    opencodeInternals.sessionBindingStartWorkspaces.set('session-b', otherWorkspace)
    const piStarting = piInternals.runtimeCoordinator.ensure(
      `${otherWorkspace}\0session-b`,
      async (lease) => {
        const runtime = await piStart
        return { ...runtime, lease }
      },
    )

    try {
      await expect(Promise.all([
        codex.releaseWorkspaceRuntime('C:/workspace-a'),
        opencode.releaseWorkspaceRuntime('C:/workspace-a'),
        pi.releaseWorkspaceRuntime('C:/workspace-a'),
      ])).resolves.toEqual([undefined, undefined, undefined])
    } finally {
      resolveCodexStart()
      resolvePiStart({ process: { stop: () => undefined } })
      await codexStarting
      await piStarting
      codex.dispose()
      opencode.dispose()
      pi.dispose()
    }
  })
})

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CodexAgentManager } from '../electron/main/codex-agent'
import { OpenCodeAgentManager } from '../electron/main/opencode-agent'
import { PiCliAgentManager } from '../electron/main/pi-cli-agent'

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
      bindings: Map<string, typeof binding>
      requireBinding: (cwd: string, threadID: string) => Promise<typeof binding>
    }
    internals.bindings.set('thread-a', binding)

    await expect(internals.requireBinding('C:/workspace-b', 'thread-a'))
      .rejects.toThrow('not found for this workspace')
    manager.dispose()
  })

  it('does not reuse a cached PI CLI runtime from another workspace', async () => {
    const manager = new PiCliAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const runtime = {
      process: { stop: () => undefined },
      record: { cwd: 'C:/workspace-a', id: 'session-a' },
    }
    const internals = manager as unknown as {
      requireRuntime: (cwd: string, sessionID: string) => Promise<typeof runtime>
      runtimes: Map<string, typeof runtime>
    }
    internals.runtimes.set('session-a', runtime)

    await expect(internals.requireRuntime('C:/workspace-b', 'session-a'))
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
      bindingStarts: Map<string, Promise<never>>
      bindingStartWorkspaces: Map<string, string>
      listIndexedRecords: () => Promise<unknown[]>
    }
    const opencodeInternals = opencode as unknown as {
      sessionBindingStarts: Map<string, Promise<never>>
      sessionBindingStartWorkspaces: Map<string, string>
    }
    const piInternals = pi as unknown as {
      runtimeStarts: Map<string, Promise<never>>
      runtimeStartWorkspaces: Map<string, string>
    }
    codexInternals.listIndexedRecords = async () => []
    codexInternals.bindingStarts.set('thread-b', never)
    codexInternals.bindingStartWorkspaces.set('thread-b', otherWorkspace)
    opencodeInternals.sessionBindingStarts.set('session-b', never)
    opencodeInternals.sessionBindingStartWorkspaces.set('session-b', otherWorkspace)
    piInternals.runtimeStarts.set('session-b', never)
    piInternals.runtimeStartWorkspaces.set('session-b', otherWorkspace)

    try {
      await expect(Promise.all([
        codex.releaseWorkspaceRuntime('C:/workspace-a'),
        opencode.releaseWorkspaceRuntime('C:/workspace-a'),
        pi.releaseWorkspaceRuntime('C:/workspace-a'),
      ])).resolves.toEqual([undefined, undefined, undefined])
    } finally {
      codex.dispose()
      opencode.dispose()
      pi.dispose()
    }
  })
})

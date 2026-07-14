import { describe, expect, it } from 'vitest'
import { CodexAgentManager } from '../electron/main/codex-agent'
import { OpenCodeAgentManager } from '../electron/main/opencode-agent'
import { PiCliAgentManager } from '../electron/main/pi-cli-agent'

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
})

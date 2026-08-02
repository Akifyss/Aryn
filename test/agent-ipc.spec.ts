import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentApplicationService } from '../electron/main/agent-host/application/agent-application-service'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  openExternal: vi.fn(),
  removedChannels: [] as string[],
  showOpenDialog: vi.fn(),
}))

const discovery = vi.hoisted(() => ({
  discoverAgentCatalog: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electron.showOpenDialog,
  },
  ipcMain: {
    handle(
      channel: string,
      listener: (event: unknown, ...args: unknown[]) => unknown,
    ) {
      if (electron.handlers.has(channel)) throw new Error(`Duplicate handler: ${channel}`)
      electron.handlers.set(channel, listener)
    },
    removeHandler(channel: string) {
      electron.removedChannels.push(channel)
      electron.handlers.delete(channel)
    },
  },
  shell: {
    openExternal: electron.openExternal,
  },
}))

vi.mock('../electron/main/agent-host/infrastructure/cli-discovery', () => ({
  discoverAgentCatalog: discovery.discoverAgentCatalog,
}))

import { registerAgentIpc } from '../electron/main/agent-ipc/register-agent-ipc'

function createHost(
  overrides: Partial<AgentApplicationService> = {},
): AgentApplicationService {
  return {
    ...overrides,
  } as AgentApplicationService
}

function createWindow(
  send: (channel: string, event: unknown) => void = () => undefined,
) {
  return {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send,
    },
  }
}

function invoke(channel: string, ...args: unknown[]) {
  const handler = electron.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler: ${channel}`)
  return handler({}, ...args)
}

describe('registerAgentIpc', () => {
  beforeEach(() => {
    electron.handlers.clear()
    electron.removedChannels.length = 0
    electron.openExternal.mockReset()
    electron.showOpenDialog.mockReset()
    discovery.discoverAgentCatalog.mockReset()
  })

  it('owns and disposes the complete Agent IPC channel set', () => {
    const registration = registerAgentIpc({
      agentHost: createHost(),
      getWindow: () => null,
    })
    const channels = [...electron.handlers.keys()]

    expect(channels).toHaveLength(23)
    expect(channels).toContain('agent:get-catalog')
    expect(channels).toContain('agent:respond-interaction')

    registration.dispose()
    registration.dispose()

    expect(electron.handlers.size).toBe(0)
    expect(electron.removedChannels).toEqual(channels)
  })

  it('preserves legacy embedded PI routing after loading a workspace', async () => {
    const loadWorkspaceState = vi.fn(async () => ({
      activeSession: { sessionPath: 'C:/sessions/active.jsonl' },
      runtime: {},
      sessions: [],
    }))
    const sendPrompt = vi.fn(async () => ({ ok: true }))
    registerAgentIpc({
      agentHost: createHost({ loadWorkspaceState, sendPrompt }),
      getWindow: () => null,
    })

    await invoke('agent:load-workspace', 'C:/workspace')
    await invoke('agent:send-prompt', 'hello', 'followUp', [])

    expect(loadWorkspaceState).toHaveBeenCalledWith(
      {
        agentId: 'builtin-pi',
        sessionPath: null,
        workspacePath: 'C:/workspace',
      },
      null,
      undefined,
    )
    expect(sendPrompt).toHaveBeenCalledWith(
      {
        agentId: 'builtin-pi',
        sessionPath: 'C:/sessions/active.jsonl',
        workspacePath: 'C:/workspace',
      },
      'hello',
      'followUp',
      [],
    )
  })

  it('registers an auth prompt before notifying a synchronously responding renderer', async () => {
    const loginProviderAuth = vi.fn(async (
      _cwd,
      provider,
      callbacks,
    ) => ({
      value: await callbacks.requestInput(provider, { message: 'Token' }),
    }))
    const win = createWindow((channel, event) => {
      if (
        channel === 'agent:provider-auth-ui-event'
        && event
        && typeof event === 'object'
        && 'type' in event
        && event.type === 'prompt'
        && 'requestId' in event
        && typeof event.requestId === 'string'
      ) {
        void invoke('agent:respond-provider-auth-prompt', event.requestId, 'secret')
      }
    })
    registerAgentIpc({
      agentHost: createHost({ loginProviderAuth }),
      getWindow: () => win as never,
    })

    await expect(invoke('agent:login-provider-auth', 'C:/workspace', 'example'))
      .resolves.toEqual({ value: 'secret' })
  })

  it('rejects pending auth input when the IPC boundary is disposed', async () => {
    let promptEmitted = false
    const loginProviderAuth = vi.fn(async (
      _cwd,
      provider,
      callbacks,
    ) => callbacks.requestInput(provider, { message: 'Token' }))
    const registration = registerAgentIpc({
      agentHost: createHost({ loginProviderAuth }),
      getWindow: () => createWindow((_channel, event) => {
        if (
          event
          && typeof event === 'object'
          && 'type' in event
          && event.type === 'prompt'
        ) {
          promptEmitted = true
        }
      }) as never,
    })

    const login = Promise.resolve(
      invoke('agent:login-provider-auth', 'C:/workspace', 'example'),
    )
    await vi.waitFor(() => expect(promptEmitted).toBe(true))
    registration.dispose()

    await expect(login).rejects.toThrow('Application closed.')
  })

  it('drains in-flight handlers before the Agent Host is disposed', async () => {
    let releaseList: (() => void) | null = null
    const listSessionItems = vi.fn(() => new Promise<Array<{ id: string }>>((resolve) => {
      releaseList = () => resolve([{ id: 'session-1' }])
    }))
    const registration = registerAgentIpc({
      agentHost: createHost({ listSessionItems }),
      getWindow: () => null,
    })

    const listRequest = Promise.resolve(invoke('agent:list-sessions', {
      agentId: 'codex',
      sessionPath: null,
      workspacePath: 'C:/workspace',
    }))
    await vi.waitFor(() => expect(listSessionItems).toHaveBeenCalledOnce())

    registration.dispose()
    let drained = false
    const drain = registration.drain().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    releaseList?.()
    await expect(listRequest).resolves.toEqual([{ id: 'session-1' }])
    await drain
    expect(drained).toBe(true)
  })

  it('does not open the attachment picker for a destroyed window', async () => {
    const win = createWindow()
    win.isDestroyed = () => true
    registerAgentIpc({
      agentHost: createHost(),
      getWindow: () => win as never,
    })

    await expect(invoke('agent:pick-attachments')).resolves.toEqual([])
    expect(electron.showOpenDialog).not.toHaveBeenCalled()
  })
})

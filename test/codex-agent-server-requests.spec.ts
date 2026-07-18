import { describe, expect, it, vi } from 'vitest'
import type { ServerRequest } from '../src/features/agent/codex-protocol/generated/ServerRequest'
import { CodexAgentManager } from '../electron/main/codex-agent'

describe('Codex App Server requests', () => {
  it('reports unsupported global requests as missing methods rather than malformed thread requests', () => {
    const errors: Array<{ code: number, id: string | number, message: string }> = []
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const internals = manager as unknown as {
      client: {
        respondError: (id: string | number, code: number, message: string) => void
        stop: () => void
      }
      handleServerRequest: (request: ServerRequest) => void
    }
    internals.client = {
      respondError: (id, code, message) => errors.push({ code, id, message }),
      stop: () => undefined,
    }

    try {
      internals.handleServerRequest({
        id: 3,
        method: 'attestation/generate',
        params: {},
      })
      expect(errors).toEqual([{
        code: -32601,
        id: 3,
        message: 'Unsupported Codex server request: attestation/generate.',
      }])
    } finally {
      manager.dispose()
    }
  })

  it('declines unsupported MCP elicitations with the complete official response shape', () => {
    const responses: Array<{ id: string | number, result: unknown }> = []
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: () => undefined })
    const internals = manager as unknown as {
      client: { respond: (id: string | number, result: unknown) => void, stop: () => void }
      handleServerRequest: (request: ServerRequest) => void
    }
    internals.client = { respond: (id, result) => responses.push({ id, result }), stop: () => undefined }

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      internals.handleServerRequest({
        id: 7,
        method: 'mcpServer/elicitation/request',
        params: {
          _meta: null,
          message: 'Choose a value',
          mode: 'form',
          requestedSchema: { properties: {}, type: 'object' },
          serverName: 'example',
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
      })
    } finally {
      warning.mockRestore()
      manager.dispose()
    }

    expect(responses).toEqual([{
      id: 7,
      result: { _meta: null, action: 'decline', content: null },
    }])
  })

  it('removes an interaction when the App Server resolves it during a turn transition', async () => {
    const events: unknown[] = []
    const manager = new CodexAgentManager({ agentDir: 'C:/agent-data', emitEvent: (event) => events.push(event) })
    const internals = manager as unknown as {
      handleNotification: (notification: {
        method: 'serverRequest/resolved'
        params: { requestId: string | number, threadId: string }
      }) => Promise<void>
      pendingInteractions: Map<string, {
        kind: 'approval'
        originalId: string | number
        requestId: string
        sessionId: string
      }>
    }
    internals.pendingInteractions.set('thread-1\ncodex:7', {
      kind: 'approval',
      originalId: 7,
      requestId: 'codex:7',
      sessionId: 'thread-1',
    })

    await internals.handleNotification({
      method: 'serverRequest/resolved',
      params: { requestId: 7, threadId: 'thread-1' },
    })

    expect(internals.pendingInteractions.size).toBe(0)
    expect(events).toContainEqual({
      requestId: 'codex:7',
      resumeRun: false,
      sessionId: 'thread-1',
      type: 'interaction_resolved',
    })
    manager.dispose()
  })
})

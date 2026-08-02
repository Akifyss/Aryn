import { describe, expect, it } from 'vitest'
import { createOpenCodeSessionSnapshot } from '../electron/main/agent-host/providers/opencode/presentation'
import type { OpenCodeSessionMessageReducer } from '../electron/main/agent-host/providers/opencode/session-reducer'
import type { OpenCodeSessionBinding } from '../electron/main/agent-host/providers/opencode/runtime'

describe('OpenCode unified snapshot history', () => {
  it('exposes the server cursor needed by the bb older-history bridge', () => {
    const lease = { key: 'lease-1' } as OpenCodeSessionBinding['lease']
    const binding: OpenCodeSessionBinding = {
      cwd: 'C:\\workspace',
      executionState: { type: 'idle' },
      historyCursor: 'cursor-older',
      isStreaming: false,
      lastAssistantMessageId: null,
      lease,
      ownerLease: lease,
      parentLease: lease,
      parentSessionId: null,
      rootSessionId: 'session-1',
      selectedModel: null,
      sessionId: 'session-1',
      thinkingLevel: 'off',
      title: 'Session',
    }
    const reducer = {
      records: () => [],
    } as unknown as OpenCodeSessionMessageReducer

    const snapshot = createOpenCodeSessionSnapshot(binding, reducer, { diffs: new Map() })

    expect(snapshot.native).toMatchObject({
      agentId: 'opencode',
      history: { nextCursor: 'cursor-older' },
    })
  })
})

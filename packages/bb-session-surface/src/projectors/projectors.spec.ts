import { describe, expect, it } from 'vitest'
import type { BbAgentId, BbNativeSessionSnapshot } from '../contracts'
import type { TimelineRow } from '../compat/server-contract'
import { projectCodexSnapshot } from './codex'
import { projectNativeSession } from './index'
import { projectOpenCodeSnapshot } from './opencode'
import { projectPiSnapshot } from './pi'

function project(snapshot: BbNativeSessionSnapshot) {
  return projectNativeSession({
    fileChanges: [],
    optimisticMessages: [],
    sessionId: 'session-1',
    snapshot,
  })
}

function flattenRows(rows: readonly TimelineRow[]): TimelineRow[] {
  return rows.flatMap((row) => row.kind === 'turn' && row.children
    ? [row, ...flattenRows(row.children)]
    : [row])
}

describe('vendored bb native session flow', () => {
  it('covers every Aryn agent entry', () => {
    const snapshots: Record<BbAgentId, BbNativeSessionSnapshot> = {
      'builtin-pi': { agentId: 'builtin-pi', messages: [], sessionId: 'builtin-1' },
      pi: { agentId: 'pi', messages: [], sessionId: 'pi-1' },
      opencode: { agentId: 'opencode', messages: [] },
      codex: { agentId: 'codex', thread: { id: 'codex-1', turns: [] } },
    }

    for (const snapshot of Object.values(snapshots)) {
      expect(project(snapshot)).toMatchObject({
        activeThinking: null,
        rows: [],
        runtimeStatus: 'idle',
      })
    }
  })

  it.each([
    ['builtin-pi', {
      agentId: 'builtin-pi' as const,
      entryIds: ['user-1'],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'builtin user' }] }],
      sessionId: 'builtin-1',
    }, 'builtin user'],
    ['pi', {
      agentId: 'pi' as const,
      entryIds: ['user-1'],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'pi user' }] }],
      sessionId: 'pi-1',
    }, 'pi user'],
    ['opencode', {
      agentId: 'opencode' as const,
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: 1 } },
        parts: [{ type: 'text', text: 'opencode user' }],
      }],
    }, 'opencode user'],
    ['codex', {
      agentId: 'codex' as const,
      thread: {
        id: 'codex-1',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          items: [{ id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'codex user' }] }],
        }],
      },
    }, 'codex user'],
  ])('renders a visible user conversation row for %s', (_agentId, snapshot, expectedText) => {
    const userRows = flattenRows(project(snapshot).rows).filter((row) => (
      row.kind === 'conversation' && row.role === 'user'
    ))

    expect(userRows).toHaveLength(1)
    expect(userRows[0]).toMatchObject({ text: expectedText })
  })

  it.each([
    ['builtin-pi', `Review the attachment\n\nAttachments:\n- ${JSON.stringify({
      fileName: 'notes.txt',
      kind: 'file',
      path: 'C:/workspace/notes.txt',
      status: 'referenced',
    })}`],
    ['pi', 'Review the attachment\n\nAttached file: C:/workspace/notes.txt'],
  ] as const)('projects the real %s file-reference encoding as a bb local attachment', (agentId, content) => {
    const rows = flattenRows(project({
      agentId,
      entryIds: ['user-attachment'],
      messages: [{ role: 'user', content, timestamp: 1_000 }],
      sessionId: 'session-1',
    }).rows)
    const serialized = JSON.stringify(rows)

    expect(serialized).toContain('Review the attachment')
    expect(serialized).toContain('C:/workspace/notes.txt')
    expect(serialized).not.toContain('Attached file:')
    expect(serialized).not.toContain('Attachments:')
  })

  it('feeds Codex through bb client requests, item deltas, and lifecycle events', () => {
    const snapshot: BbNativeSessionSnapshot = {
      agentId: 'codex',
      tokenUsage: {
        total: { totalTokens: 120, inputTokens: 80, cachedInputTokens: 20, outputTokens: 40, reasoningOutputTokens: 10 },
        last: { totalTokens: 60, inputTokens: 40, cachedInputTokens: 10, outputTokens: 20, reasoningOutputTokens: 5 },
        modelContextWindow: 200_000,
      },
      thread: {
        id: 'codex-1',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          items: [
            { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'hello' }] },
            { id: 'assistant-1', type: 'agentMessage', text: 'hi' },
            { id: 'thought-1', type: 'reasoning', summary: ['checking'] },
            { id: 'command-1', type: 'commandExecution', command: 'pwd', aggregatedOutput: 'C:/workspace', exitCode: 0 },
            { id: 'file-1', type: 'fileChange', changes: [{ path: 'README.md', kind: 'update', diff: '+hello' }] },
          ],
        }],
      },
    }
    const canonical = projectCodexSnapshot(snapshot, [], 0)
    const eventTypes = canonical.events.map(({ event }) => event.type)

    expect(eventTypes).toEqual(expect.arrayContaining([
      'client/turn/requested',
      'turn/started',
      'turn/input/accepted',
      'item/agentMessage/delta',
      'item/reasoning/summaryTextDelta',
      'item/commandExecution/outputDelta',
      'item/completed',
      'thread/tokenUsage/updated',
      'thread/contextWindowUsage/updated',
      'turn/completed',
    ]))
    expect(canonical.contextWindowEvents).toHaveLength(1)
    expect(eventTypes).not.toContain('item/userMessage/delta')

    const rows = flattenRows(project(snapshot).rows)
    expect(rows.filter((row) => row.kind === 'conversation')).toMatchObject([
      { kind: 'conversation', role: 'user', text: 'hello', turnRequest: { kind: 'message', status: 'accepted' } },
      { kind: 'conversation', role: 'assistant', text: 'hi' },
    ])
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'work', workKind: 'command', command: 'pwd', output: 'C:/workspace' }),
      expect.objectContaining({ kind: 'work', workKind: 'file-change' }),
    ]))
  })

  it('updates a streaming Codex row when the same snapshot object changes', () => {
    const snapshot: BbNativeSessionSnapshot = {
      agentId: 'codex',
      thread: {
        id: 'codex-streaming',
        turns: [{
          id: 'turn-1',
          status: 'inProgress',
          items: [{ id: 'assistant-1', type: 'agentMessage', text: '我' }],
        }],
      },
    }
    const initial = projectNativeSession({
      fileChanges: [],
      optimisticMessages: [],
      projectionRevision: 1,
      sessionId: 'codex-streaming',
      snapshot,
    })

    const thread = snapshot.thread as { turns: Array<{ items: Array<{ text: string }> }> }
    thread.turns[0]!.items[0]!.text = '我会先检索近期 AI 新闻并交叉核对来源。'
    const updated = projectNativeSession({
      fileChanges: [],
      optimisticMessages: [],
      projectionRevision: 2,
      sessionId: 'codex-streaming',
      snapshot,
    })
    const initialAssistant = flattenRows(initial.rows).find((row) => row.kind === 'conversation' && row.role === 'assistant')
    const updatedAssistant = flattenRows(updated.rows).find((row) => row.kind === 'conversation' && row.role === 'assistant')

    expect(updatedAssistant).toMatchObject({ kind: 'conversation', role: 'assistant' })
    expect(updatedAssistant && 'text' in updatedAssistant ? updatedAssistant.text.trimEnd() : '').toBe(
      '我会先检索近期 AI 新闻并交叉核对来源。',
    )
    expect(updatedAssistant!.sourceSeqEnd).toBeGreaterThan(initialAssistant!.sourceSeqEnd)
  })

  it('keeps Codex native metadata that bb has no first-class row for', () => {
    const canonical = projectCodexSnapshot({
      agentId: 'codex',
      thread: {
        id: 'codex-native-details',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          items: [{
            id: 'assistant-1',
            type: 'agentMessage',
            text: 'Answer',
            phase: 'commentary',
            memoryCitation: { entries: [{ label: 'memory' }], threadIds: ['thread-memory'] },
          }, {
            id: 'command-1',
            type: 'commandExecution',
            command: 'dir',
            cwd: 'C:/workspace',
            status: 'completed',
            processId: 'pty-1',
            source: 'userShell',
            commandActions: [{ type: 'listFiles', command: 'dir', path: null }],
          }, {
            id: 'mcp-1',
            type: 'mcpToolCall',
            server: 'server',
            tool: 'lookup',
            status: 'completed',
            arguments: ['native-array-argument'],
            appContext: { connectorId: 'connector-1', resourceUri: 'resource://1' },
            pluginId: 'plugin-1',
          }, {
            id: 'dynamic-1',
            type: 'dynamicToolCall',
            tool: 'dynamic',
            status: 'completed',
            durationMs: 42,
          }, {
            id: 'collab-1',
            type: 'collabAgentToolCall',
            tool: 'spawnAgent',
            status: 'completed',
            senderThreadId: 'sender-1',
            receiverThreadIds: ['receiver-1'],
            agentsStates: { 'receiver-1': { status: 'completed', message: 'done' } },
          }, {
            id: 'subagent-1',
            type: 'subAgentActivity',
            status: 'completed',
            agentPath: '/root/research',
            agentThreadId: 'agent-thread-1',
          }, {
            id: 'search-1',
            type: 'webSearch',
            query: 'query',
            action: { type: 'search', query: 'query' },
          }],
        }],
      },
    }, [], 0)
    const serialized = JSON.stringify(canonical.events)

    expect(serialized).toContain('codex/agentMessage/nativeDetail')
    expect(serialized).toContain('commentary')
    expect(serialized).toContain('thread-memory')
    expect(serialized).toContain('pty-1')
    expect(serialized).toContain('connector-1')
    expect(serialized).toContain('native-array-argument')
    expect(serialized).toContain('"durationMs":42')
    expect(serialized).toContain('sender-1')
    expect(serialized).toContain('agent-thread-1')
    expect(serialized).toContain('codex/webSearch/nativeDetail')
  })

  it.each([{
    completedAt: 1_700_000_002,
    durationMs: 2_000,
    expectedCompletedAt: 1_700_000_002_000,
    expectedStartedAt: 1_700_000_000_000,
    label: 'derives a missing start from completion and duration',
    startedAt: null,
  }, {
    completedAt: null,
    durationMs: 2_500,
    expectedCompletedAt: 1_700_000_002_500,
    expectedStartedAt: 1_700_000_000_000,
    label: 'derives a missing completion from start and duration',
    startedAt: 1_700_000_000,
  }])('uses coupled Codex turn timing when it $label', ({
    completedAt,
    durationMs,
    expectedCompletedAt,
    expectedStartedAt,
    startedAt,
  }) => {
    const projection = projectCodexSnapshot({
      agentId: 'codex',
      thread: {
        id: 'codex-partial-timing',
        turns: [{
          completedAt,
          durationMs,
          id: 'turn-1',
          items: [{ id: 'assistant-1', text: 'Answer', type: 'agentMessage' }],
          startedAt,
          status: 'completed',
        }],
      },
    }, [], 0)
    const turnStarted = projection.events.find(({ event }) => event.type === 'turn/started')
    const turnCompleted = projection.events.find(({ event }) => event.type === 'turn/completed')

    expect(turnStarted?.meta.createdAt).toBe(expectedStartedAt)
    expect(turnCompleted?.meta.createdAt).toBe(expectedCompletedAt)
    expect(turnCompleted!.meta.createdAt).toBeGreaterThanOrEqual(turnStarted!.meta.createdAt)
  })

  it('falls back to Codex updatedAt when a native completion predates the turn start', () => {
    const startedAt = 1_700_000_010
    const updatedAt = 1_700_000_018
    const projection = projectCodexSnapshot({
      agentId: 'codex',
      thread: {
        id: 'codex-invalid-completion',
        turns: [{
          completedAt: 1_700_000_005,
          durationMs: null,
          id: 'turn-1',
          items: [{ id: 'assistant-1', text: 'Answer', type: 'agentMessage' }],
          startedAt,
          status: 'completed',
          updatedAt,
        }],
      },
    }, [], 0)
    const turnCompleted = projection.events.find(({ event }) => event.type === 'turn/completed')

    expect(turnCompleted?.meta.createdAt).toBe(updatedAt * 1_000)
  })

  it('does not expose a negative Codex tool duration to the bb timeline', () => {
    const projection = projectCodexSnapshot({
      agentId: 'codex',
      thread: {
        id: 'codex-invalid-tool-duration',
        turns: [{
          completedAt: 1_700_000_002,
          id: 'turn-1',
          items: [{
            command: 'npm test',
            durationMs: -5_000,
            id: 'command-1',
            status: 'completed',
            type: 'commandExecution',
          }],
          startedAt: 1_700_000_000,
          status: 'completed',
        }],
      },
    }, [], 0)
    const itemCompleted = projection.events.find(({ event }) => (
      event.type === 'item/completed' && event.item.id === 'command-1'
    ))

    expect(itemCompleted?.event).toMatchObject({ item: { id: 'command-1' } })
    expect(itemCompleted?.event.type === 'item/completed' ? itemCompleted.event.item : {})
      .not.toHaveProperty('durationMs')
  })

  it('maps OpenCode user and command activity without mutating its native snapshot', () => {
    const snapshot = {
      agentId: 'opencode' as const,
      messages: [
        { info: { id: 'user-1', role: 'user', time: { created: 1 } }, parts: [{ type: 'text', text: 'run it' }] },
        {
          info: { id: 'assistant-1', role: 'assistant', time: { created: 2 } },
          parts: [{
            id: 'tool-1',
            type: 'tool',
            tool: 'bash',
            state: { status: 'completed', input: { command: 'npm test' }, output: 'ok' },
          }],
        },
      ],
    }
    const before = JSON.stringify(snapshot)
    const rows = flattenRows(project(snapshot).rows)

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'conversation', role: 'user', text: 'run it' }),
      expect.objectContaining({ kind: 'work', workKind: 'command', command: 'npm test', output: 'ok' }),
    ]))
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('freezes OpenCode turn durations at native assistant completion across long idle gaps', () => {
    const firstTurnStartedAt = 1_700_000_000_000
    const firstTurnCompletedAt = firstTurnStartedAt + 24_000
    const secondTurnStartedAt = firstTurnStartedAt + 21 * 60_000
    const secondTurnCompletedAt = secondTurnStartedAt + 7_000
    const firstTurnMessages = [{
      info: { id: 'user-1', role: 'user', time: { created: firstTurnStartedAt } },
      parts: [{ type: 'text', text: 'First prompt' }],
    }, {
      info: {
        id: 'assistant-1',
        role: 'assistant',
        time: { completed: firstTurnCompletedAt, created: firstTurnStartedAt + 1_000 },
      },
      parts: [{ id: 'answer-1', type: 'text', text: 'First answer' }],
    }]
    const firstProjection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: firstTurnMessages,
      status: { type: 'idle' },
    }, [], 'opencode-duration', 0)
    const laterProjection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [...firstTurnMessages, {
        info: { id: 'user-2', role: 'user', time: { created: secondTurnStartedAt } },
        parts: [{ type: 'text', text: 'Second prompt' }],
      }, {
        info: {
          id: 'assistant-2',
          role: 'assistant',
          time: { completed: secondTurnCompletedAt, created: secondTurnStartedAt + 1_000 },
        },
        parts: [{ id: 'answer-2', type: 'text', text: 'Second answer' }],
      }],
      status: { type: 'idle' },
    }, [], 'opencode-duration', 0)
    const completedAt = (projection: typeof firstProjection, turnId: string) => projection.events.find(({ event }) => (
      event.type === 'turn/completed'
      && event.scope.kind === 'turn'
      && event.scope.turnId === turnId
    ))?.meta.createdAt

    expect(completedAt(firstProjection, 'user-1')).toBe(firstTurnCompletedAt)
    expect(completedAt(laterProjection, 'user-1')).toBe(firstTurnCompletedAt)
    expect(completedAt(laterProjection, 'user-2')).toBe(secondTurnCompletedAt)
  })

  it('uses OpenCode assistant activity when an error has no completion timestamp', () => {
    const startedAt = 1_700_000_000_000
    const failedAt = startedAt + 6_000
    const projection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: startedAt } },
        parts: [{ type: 'text', text: 'Prompt' }],
      }, {
        info: {
          error: { data: { message: 'Request failed' }, name: 'APIError' },
          id: 'assistant-1',
          role: 'assistant',
          time: { created: failedAt },
        },
        parts: [],
      }],
      status: { type: 'idle' },
    }, [], 'opencode-error-without-completion', 0)
    const turnCompleted = projection.events.find(({ event }) => event.type === 'turn/completed')

    expect(turnCompleted).toMatchObject({
      event: { status: 'failed' },
      meta: { createdAt: failedAt },
    })
  })

  it('rejects an OpenCode message completion timestamp that predates message creation', () => {
    const startedAt = 1_700_000_000_000
    const assistantStartedAt = startedAt + 5_000
    const projection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: startedAt } },
        parts: [{ type: 'text', text: 'Prompt' }],
      }, {
        info: {
          id: 'assistant-1',
          role: 'assistant',
          time: { completed: startedAt + 1_000, created: assistantStartedAt },
        },
        parts: [],
      }],
      status: { type: 'idle' },
    }, [], 'opencode-invalid-message-completion', 0)
    const turnCompleted = projection.events.find(({ event }) => event.type === 'turn/completed')

    expect(turnCompleted?.meta.createdAt).toBe(assistantStartedAt)
  })

  it('applies a legacy OpenCode runtime error only to the active terminal turn', () => {
    const firstTurnStartedAt = 1_700_000_000_000
    const secondTurnStartedAt = firstTurnStartedAt + 10_000
    const projection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: firstTurnStartedAt } },
        parts: [{ type: 'text', text: 'First prompt' }],
      }, {
        info: {
          id: 'assistant-1',
          role: 'assistant',
          time: { completed: firstTurnStartedAt + 2_000, created: firstTurnStartedAt + 1_000 },
        },
        parts: [{ id: 'answer-1', type: 'text', text: 'First answer' }],
      }, {
        info: { id: 'user-2', role: 'user', time: { created: secondTurnStartedAt } },
        parts: [{ type: 'text', text: 'Second prompt' }],
      }],
      status: { type: 'error' },
    }, [], 'opencode-runtime-error', 0)
    const completedTurns = projection.events.filter(({ event }) => event.type === 'turn/completed')

    expect(completedTurns).toMatchObject([{
      event: { scope: { turnId: 'user-1' }, status: 'completed' },
    }, {
      event: { scope: { turnId: 'user-2' }, status: 'failed' },
    }])
  })

  it('preserves OpenCode native tool timing on item lifecycle events', () => {
    const turnStartedAt = 1_700_000_000_000
    const toolStartedAt = turnStartedAt + 2_000
    const toolCompletedAt = turnStartedAt + 12_000
    const projection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: turnStartedAt } },
        parts: [{ type: 'text', text: 'Run it' }],
      }, {
        info: {
          id: 'assistant-1',
          role: 'assistant',
          time: { completed: toolCompletedAt + 1_000, created: turnStartedAt + 1_000 },
        },
        parts: [{
          id: 'tool-1',
          state: {
            input: { command: 'npm test' },
            output: 'ok',
            status: 'completed',
            time: { end: toolCompletedAt, start: toolStartedAt },
          },
          tool: 'bash',
          type: 'tool',
        }],
      }],
      status: { type: 'idle' },
    }, [], 'opencode-tool-duration', 0)
    const itemStarted = projection.events.find(({ event }) => (
      event.type === 'item/started' && event.item.id === 'tool-1'
    ))
    const itemCompleted = projection.events.find(({ event }) => (
      event.type === 'item/completed' && event.item.id === 'tool-1'
    ))

    expect(itemStarted?.meta.createdAt).toBe(toolStartedAt)
    expect(itemCompleted).toMatchObject({
      event: { item: { durationMs: 10_000, id: 'tool-1' } },
      meta: { createdAt: toolCompletedAt },
    })
  })

  it('clamps malformed OpenCode tool completion time instead of emitting a negative duration', () => {
    const startedAt = 1_700_000_010_000
    const projection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: startedAt - 1_000 } },
        parts: [{ type: 'text', text: 'Run it' }],
      }, {
        info: {
          id: 'assistant-1',
          role: 'assistant',
          time: { completed: startedAt + 1_000, created: startedAt - 500 },
        },
        parts: [{
          id: 'tool-1',
          state: {
            input: { command: 'npm test' },
            output: 'ok',
            status: 'completed',
            time: { end: startedAt - 5_000, start: startedAt },
          },
          tool: 'bash',
          type: 'tool',
        }],
      }],
      status: { type: 'idle' },
    }, [], 'opencode-invalid-tool-duration', 0)
    const itemCompleted = projection.events.find(({ event }) => (
      event.type === 'item/completed' && event.item.id === 'tool-1'
    ))

    expect(itemCompleted?.meta.createdAt).toBe(startedAt)
    expect(itemCompleted?.event.type === 'item/completed' ? itemCompleted.event.item : {})
      .not.toHaveProperty('durationMs')
  })

  it('extracts the official nested OpenCode retry message', () => {
    const projection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: 1_700_000_000_000 } },
        parts: [{ type: 'text', text: 'Prompt' }],
      }, {
        info: { id: 'assistant-1', role: 'assistant', time: { created: 1_700_000_001_000 } },
        parts: [{
          attempt: 2,
          error: { data: { message: 'Rate limited' }, name: 'APIError' },
          id: 'retry-1',
          type: 'retry',
        }],
      }],
      status: { type: 'retry' },
    }, [], 'opencode-retry-message', 0)

    expect(projection.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: expect.objectContaining({ message: 'Rate limited', type: 'provider/error' }),
      }),
    ]))
  })

  it.each([
    ['ContextOverflowError', 'failed'],
    ['MessageAbortedError', 'interrupted'],
  ] as const)('keeps official OpenCode %s details and turn status', (name, status) => {
    const startedAt = 1_700_000_000_000
    const completedAt = startedAt + 5_000
    const projection = projectOpenCodeSnapshot({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: startedAt } },
        parts: [{ type: 'text', text: 'Prompt' }],
      }, {
        info: {
          error: { data: { message: 'Native OpenCode failure' }, name },
          id: 'assistant-1',
          role: 'assistant',
          time: { completed: completedAt, created: startedAt + 1_000 },
        },
        parts: [],
      }],
      status: { type: 'idle' },
    }, [], `opencode-${name}`, 0)

    expect(projection.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: expect.objectContaining({
          message: 'Native OpenCode failure',
          type: 'provider/error',
        }),
      }),
      expect.objectContaining({
        event: expect.objectContaining({
          error: { message: 'Native OpenCode failure' },
          status,
          type: 'turn/completed',
        }),
        meta: expect.objectContaining({ createdAt: completedAt }),
      }),
    ]))
  })

  it('normalizes OpenCode file URLs and excludes synthetic user text', () => {
    const rows = flattenRows(project({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: 1 } },
        parts: [{ type: 'text', text: 'visible prompt' }, {
          type: 'text',
          text: 'internal synthetic prompt',
          synthetic: true,
        }, {
          type: 'file',
          filename: 'notes.txt',
          mime: 'text/plain',
          url: 'file:///C:/workspace/review%20notes.txt',
        }],
      }],
    }).rows)
    const serialized = JSON.stringify(rows)

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'conversation',
        role: 'user',
        text: 'visible prompt',
        attachments: expect.objectContaining({
          localFilePaths: ['C:/workspace/review notes.txt'],
        }),
      }),
    ]))
    expect(serialized).not.toContain('internal synthetic prompt')
    expect(serialized).not.toContain('file:///')
  })

  it('renders OpenCode tool attachments as rich assistant content without dropping native files', () => {
    const rows = flattenRows(project({
      agentId: 'opencode',
      messages: [{
        info: { id: 'user-1', role: 'user', time: { created: 1 } },
        parts: [{ type: 'text', text: 'create the report' }],
      }, {
        info: { id: 'assistant-1', role: 'assistant', time: { created: 2 } },
        parts: [{
          id: 'tool-1',
          type: 'tool',
          tool: 'report',
          state: {
            status: 'completed',
            input: {},
            output: 'created',
            attachments: [{
              type: 'file',
              filename: 'report.txt',
              mime: 'text/plain',
              url: 'file:///C:/workspace/report%20final.txt',
            }, {
              type: 'file',
              filename: 'chart.png',
              mime: 'image/png',
              url: 'https://example.com/chart.png',
            }],
          },
        }],
      }],
    }).rows)
    const serialized = JSON.stringify(rows)

    expect(serialized).toContain('Tool attachments')
    expect(serialized).toContain('report.txt')
    expect(serialized).toContain('file:///C:/workspace/report%20final.txt')
    expect(serialized).toContain('https://example.com/chart.png')
    expect(serialized).not.toContain('opencode/tool/attachment')
  })

  it('merges PI tool results and includes Aryn file changes in bb turn children', () => {
    const result = projectNativeSession({
      fileChanges: [{ path: 'src/app.ts', kind: 'update', diff: '+const ready = true' }],
      optimisticMessages: [],
      sessionId: 'pi-1',
      snapshot: {
        agentId: 'pi',
        sessionId: 'pi-1',
        entryIds: ['assistant-1', 'result-1'],
        messages: [
          { role: 'assistant', content: [{ type: 'toolCall', toolCallId: 'call-1', toolName: 'bash', input: { command: 'pwd' } }] },
          { role: 'toolResult', toolCallId: 'call-1', content: [{ type: 'text', text: 'C:/workspace' }], details: { exitCode: 0 } },
        ],
      },
    })
    const rows = flattenRows(result.rows)

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'work',
        workKind: 'command',
        status: 'completed',
        output: 'C:/workspace',
      }),
      expect.objectContaining({ kind: 'work', workKind: 'file-change' }),
    ]))
  })

  it.each(['pi', 'builtin-pi'] as const)(
    'projects the real modern %s tool-call shape with arguments and result',
    (agentId) => {
      const rows = flattenRows(projectNativeSession({
        fileChanges: [],
        optimisticMessages: [],
        sessionId: `${agentId}-modern-tool`,
        snapshot: {
          agentId,
          entryIds: ['assistant-modern', 'result-modern'],
          isStreaming: false,
          messages: [{
            role: 'assistant',
            content: [{
              type: 'toolCall',
              id: 'write-modern-1',
              name: 'write',
              arguments: {
                path: 'agent-tool-smoke.txt',
                content: 'ARYN_TOOL_SMOKE',
              },
            }],
          }, {
            role: 'toolResult',
            toolCallId: 'write-modern-1',
            toolName: 'write',
            content: [{ type: 'text', text: 'Wrote agent-tool-smoke.txt' }],
            isError: false,
          }],
          sessionId: `${agentId}-modern-tool`,
        },
      }).rows)

      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'work',
          workKind: 'tool',
          status: 'completed',
          toolName: 'write',
          toolArgs: expect.objectContaining({ path: 'agent-tool-smoke.txt' }),
          output: 'Wrote agent-tool-smoke.txt',
        }),
      ]))
    },
  )

  it('renders the exact PI RPC user-message shape even when PI provides no entry ids', () => {
    const rows = flattenRows(project({
      agentId: 'pi',
      entryIds: ['', ''],
      isStreaming: false,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: '你好' }],
        timestamp: 1_785_575_545_229,
      }, {
        role: 'assistant',
        content: [{ type: 'text', text: '你好！我是 PI。' }],
        timestamp: 1_785_575_545_305,
      }],
      modelNames: {},
      sessionId: 'pi-real-shape',
    }).rows)

    expect(rows.filter((row) => row.kind === 'conversation')).toMatchObject([
      {
        kind: 'conversation',
        role: 'user',
        text: '你好',
        turnRequest: { kind: 'message', status: 'accepted' },
      },
      { kind: 'conversation', role: 'assistant', text: '你好！我是 PI。' },
    ])
  })

  it.each(['builtin-pi', 'pi'] as const)(
    'freezes completed %s turn durations at the last native activity instead of the next user prompt',
    (agentId) => {
      const firstTurnStartedAt = 1_700_000_000_000
      const firstTurnCompletedAt = firstTurnStartedAt + 24_000
      const secondTurnStartedAt = firstTurnStartedAt + 21 * 60_000
      const secondTurnCompletedAt = secondTurnStartedAt + 7_000
      const projection = projectPiSnapshot({
        agentId,
        entryIds: ['user-1', 'assistant-1', 'user-2', 'assistant-2'],
        isStreaming: false,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: 'First prompt' }],
          timestamp: firstTurnStartedAt,
        }, {
          role: 'assistant',
          content: [{ type: 'text', text: 'First answer' }],
          timestamp: firstTurnCompletedAt,
        }, {
          role: 'user',
          content: [{ type: 'text', text: 'Second prompt' }],
          timestamp: secondTurnStartedAt,
        }, {
          role: 'assistant',
          content: [{ type: 'text', text: 'Second answer' }],
          timestamp: secondTurnCompletedAt,
        }],
        sessionId: `${agentId}-duration`,
      }, [], [], 0)
      const completedTurns = projection.events.filter(({ event }) => event.type === 'turn/completed')

      expect(completedTurns).toMatchObject([{
        event: { scope: { turnId: 'user-1' } },
        meta: { createdAt: firstTurnCompletedAt },
      }, {
        event: { scope: { turnId: 'user-2' } },
        meta: { createdAt: secondTurnCompletedAt },
      }])
    },
  )

  it('uses an authoritative PI message completion timestamp when the host provides one', () => {
    const startedAt = 1_700_000_000_000
    const completedAt = startedAt + 8_000
    const projection = projectPiSnapshot({
      agentId: 'pi',
      entryIds: ['user-1', 'assistant-1'],
      isStreaming: false,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Prompt' }],
        timestamp: startedAt,
      }, {
        role: 'assistant',
        completedAt,
        content: [{ type: 'text', text: 'Answer' }],
        timestamp: startedAt + 1_000,
      }],
      sessionId: 'pi-authoritative-duration',
    }, [], [], 0)
    const turnCompleted = projection.events.find(({ event }) => event.type === 'turn/completed')

    expect(turnCompleted).toMatchObject({
      event: { scope: { turnId: 'user-1' } },
      meta: { createdAt: completedAt },
    })
  })

  it('preserves PI tool-result completion time on the item lifecycle', () => {
    const startedAt = 1_700_000_000_000
    const toolStartedAt = startedAt + 2_000
    const toolCompletedAt = startedAt + 11_000
    const snapshot = {
      agentId: 'pi' as const,
      entryIds: ['user-1', 'assistant-1', 'tool-result-1', 'assistant-2'],
      isStreaming: false,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Run it' }],
        timestamp: startedAt,
      }, {
        role: 'assistant',
        content: [{
          arguments: { command: 'npm test' },
          id: 'tool-1',
          name: 'bash',
          type: 'toolCall',
        }],
        timestamp: toolStartedAt,
      }, {
        role: 'toolResult',
        completedAt: toolCompletedAt,
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
        timestamp: toolCompletedAt - 1_000,
        toolCallId: 'tool-1',
        toolName: 'bash',
      }, {
        role: 'assistant',
        completedAt: toolCompletedAt + 1_000,
        content: [{ type: 'text', text: 'Done' }],
        stopReason: 'stop',
        timestamp: toolCompletedAt,
      }],
      sessionId: 'pi-tool-duration',
    }
    const projection = projectPiSnapshot(snapshot, [], [], 0)
    const itemStarted = projection.events.find(({ event }) => (
      event.type === 'item/started' && event.item.id === 'tool-1'
    ))
    const itemCompleted = projection.events.find(({ event }) => (
      event.type === 'item/completed' && event.item.id === 'tool-1'
    ))

    expect(itemStarted?.meta.createdAt).toBe(toolStartedAt)
    expect(itemCompleted).toMatchObject({
      event: { item: { durationMs: 9_000, id: 'tool-1' } },
      meta: { createdAt: toolCompletedAt },
    })

    const rows = flattenRows(project(snapshot).rows)
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        completedAt: toolCompletedAt,
        kind: 'work',
        startedAt: toolStartedAt,
        workKind: 'command',
      }),
      expect.objectContaining({
        completedAt: toolCompletedAt + 1_000,
        kind: 'turn',
        startedAt,
        turnId: 'user-1',
      }),
    ]))
  })

  it.each([
    ['error', 'failed'],
    ['aborted', 'interrupted'],
  ] as const)('maps PI assistant stopReason %s to the bb turn terminal state', (stopReason, status) => {
    const startedAt = 1_700_000_000_000
    const completedAt = startedAt + 4_000
    const projection = projectPiSnapshot({
      agentId: 'pi',
      entryIds: ['user-1', 'assistant-1'],
      isStreaming: false,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Prompt' }],
        timestamp: startedAt,
      }, {
        role: 'assistant',
        completedAt,
        content: [],
        errorMessage: 'Native PI failure',
        stopReason,
        timestamp: startedAt + 1_000,
      }],
      sessionId: `pi-${stopReason}`,
    }, [], [], 0)

    expect(projection.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: expect.objectContaining({
          error: { message: 'Native PI failure' },
          status,
          type: 'turn/completed',
        }),
        meta: expect.objectContaining({ createdAt: completedAt }),
      }),
    ]))
  })

  it('lets a legacy successful PI retry without stopReason settle an earlier failure', () => {
    const startedAt = 1_700_000_000_000
    const completedAt = startedAt + 8_000
    const projection = projectPiSnapshot({
      agentId: 'pi',
      entryIds: ['user-1', 'assistant-error', 'assistant-success'],
      isStreaming: false,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Prompt' }],
        timestamp: startedAt,
      }, {
        role: 'assistant',
        completedAt: startedAt + 3_000,
        content: [],
        errorMessage: 'Temporary failure',
        stopReason: 'error',
        timestamp: startedAt + 1_000,
      }, {
        role: 'assistant',
        completedAt,
        content: [{ type: 'text', text: 'Recovered' }],
        timestamp: startedAt + 4_000,
      }],
      sessionId: 'pi-retry-success',
    }, [], [], 0)
    const turnCompleted = projection.events.find(({ event }) => event.type === 'turn/completed')

    expect(turnCompleted).toMatchObject({
      event: { status: 'completed' },
      meta: { createdAt: completedAt },
    })
  })

  it('clamps a PI completion timestamp that predates its message start', () => {
    const startedAt = 1_700_000_000_000
    const assistantStartedAt = startedAt + 2_000
    const projection = projectPiSnapshot({
      agentId: 'pi',
      entryIds: ['user-1', 'assistant-1'],
      isStreaming: false,
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: 'Prompt' }],
        timestamp: startedAt,
      }, {
        role: 'assistant',
        completedAt: startedAt - 5_000,
        content: [{ type: 'text', text: 'Answer' }],
        stopReason: 'stop',
        timestamp: assistantStartedAt,
      }],
      sessionId: 'pi-invalid-completion',
    }, [], [], 0)
    const turnCompleted = projection.events.find(({ event }) => event.type === 'turn/completed')

    expect(turnCompleted?.meta.createdAt).toBe(assistantStartedAt)
  })

  it('renders PI base64 image blocks as user attachments', () => {
    const result = project({
      agentId: 'pi',
      entryIds: ['user-image'],
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: 'iVBORw0KGgo=',
          },
        }],
      }],
      sessionId: 'pi-image',
    })
    const serialized = JSON.stringify(result.rows)

    expect(serialized).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(serialized).not.toContain('provider-unhandled')
  })

  it('deduplicates sent builtin PI images and hides transport metadata', () => {
    const marker = JSON.stringify({
      fileName: 'diagram.png',
      kind: 'image',
      mimeType: 'image/png',
      path: 'C:/workspace/diagram.png',
      status: 'sent',
    })
    const rows = flattenRows(project({
      agentId: 'builtin-pi',
      entryIds: ['user-image'],
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `Inspect this\n\nAttachments:\n- ${marker}\n  [Image: original 2000x1000, displayed at 1000x500. Multiply coordinates by 2.00 to map to original image.]`,
        }, {
          type: 'image',
          data: 'iVBORw0KGgo=',
          mimeType: 'image/png',
        }],
      }],
      sessionId: 'builtin-image',
    }).rows)
    const serialized = JSON.stringify(rows)

    expect(serialized).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(serialized).not.toContain('C:/workspace/diagram.png')
    expect(serialized).not.toContain('Attachments:')
    expect(serialized).not.toContain('original 2000x1000')
  })

  it('shows an honest notice when builtin PI omits an image from the model input', () => {
    const marker = JSON.stringify({
      fileName: 'oversized.png',
      kind: 'image',
      mimeType: 'image/png',
      path: 'C:/workspace/oversized.png',
      status: 'omitted',
    })
    const rows = flattenRows(project({
      agentId: 'builtin-pi',
      entryIds: ['user-image'],
      messages: [{
        role: 'user',
        content: `Inspect this\n\nAttachments:\n- ${marker}`,
      }],
      sessionId: 'builtin-image-omitted',
    }).rows)
    const serialized = JSON.stringify(rows)

    expect(serialized).toContain('Image not sent to the model: oversized.png')
    expect(serialized).not.toContain('C:/workspace/oversized.png')
    expect(serialized).not.toContain('Attachments:')
    expect(serialized).not.toContain('"status":"omitted"')
  })

  it('renders PI tool-result images as assistant attachments instead of raw provider data', () => {
    const rows = flattenRows(project({
      agentId: 'pi',
      entryIds: ['assistant-1', 'result-1'],
      messages: [{
        role: 'assistant',
        content: [{ type: 'toolCall', toolCallId: 'image-tool', toolName: 'render', input: {} }],
      }, {
        role: 'toolResult',
        toolCallId: 'image-tool',
        toolName: 'render',
        content: [{ type: 'text', text: 'Rendered image' }, {
          type: 'image',
          data: 'iVBORw0KGgo=',
          mimeType: 'image/png',
        }],
      }],
      sessionId: 'pi-tool-image',
    }).rows)
    const serialized = JSON.stringify(rows)

    expect(serialized).toContain('Rendered image')
    expect(serialized).toContain('Tool attachments')
    expect(serialized).toContain('data:image/png;base64,iVBORw0KGgo=')
    expect(serialized).not.toContain('pi/tool-result/image')
  })

  it('keeps unsupported provider data visible through bb provider-unhandled rows', () => {
    const rows = flattenRows(project({
      agentId: 'builtin-pi',
      sessionId: 'builtin-1',
      entryIds: ['unknown-1'],
      messages: [{ role: 'future-provider-role', payload: { value: 1 } }],
    }).rows)

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'system', operationKind: 'provider-unhandled' }),
    ]))
  })

  it('renders unaccepted optimistic input as bb pending client requests', () => {
    const result = projectNativeSession({
      fileChanges: [],
      optimisticMessages: [{ id: 'draft-1', text: 'pending prompt', timestamp: 10 }],
      sessionId: 'pi-1',
      snapshot: { agentId: 'pi', sessionId: 'pi-1', messages: [] },
    })
    const pendingUser = flattenRows(result.rows).find((row) => row.kind === 'conversation' && row.role === 'user')

    expect(pendingUser).toMatchObject({
      kind: 'conversation',
      role: 'user',
      text: 'pending prompt',
      turnRequest: { kind: 'message', status: 'pending' },
    })
  })

  it('projects pending and resolved question/permission lifecycles with answers', () => {
    const result = projectNativeSession({
      fileChanges: [],
      interactionRecords: [{
        request: {
          id: 'question-1',
          kind: 'question',
          message: 'Choose a release channel',
          options: [],
          sessionId: 'session-1',
          title: 'Release',
          fields: [{
            id: 'channel',
            label: 'Channel',
            options: [
              { id: 'stable', label: 'Stable' },
              { id: 'preview', label: 'Preview' },
            ],
          }],
        },
        requestedAt: 10,
        resolvedAt: 20,
        response: { optionId: 'submit', answers: { channel: ['preview'] } },
        status: 'resolved',
      }, {
        request: {
          id: 'question-pending',
          kind: 'question',
          message: 'Confirm the next step',
          options: [{ id: 'continue', label: 'Continue' }],
          sessionId: 'session-1',
          title: 'Confirmation',
        },
        requestedAt: 25,
        status: 'pending',
      }, {
        request: {
          id: 'permission-1',
          kind: 'permission',
          message: 'Allow command?',
          options: [{ id: 'deny', label: 'Deny' }],
          sessionId: 'session-1',
          title: 'Run command',
        },
        requestedAt: 30,
        resolvedAt: 40,
        response: { optionId: 'deny' },
        status: 'resolved',
      }, {
        request: {
          id: 'permission-interrupted',
          kind: 'permission',
          message: 'Allow command?',
          options: [{ id: 'allow', label: 'Allow' }],
          sessionId: 'session-1',
          title: 'Run command',
        },
        requestedAt: 45,
        resolvedAt: 50,
        status: 'interrupted',
        statusReason: 'Request ended before Aryn received an answer.',
      }],
      optimisticMessages: [],
      sessionId: 'session-1',
      snapshot: { agentId: 'pi', sessionId: 'session-1', messages: [] },
    })
    const rows = flattenRows(result.rows)

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'work',
        workKind: 'question',
        lifecycle: 'answered',
        answers: { channel: { selected: ['preview'] } },
      }),
      expect.objectContaining({
        kind: 'work',
        workKind: 'approval',
        approvalKind: 'permission-grant',
        lifecycle: 'denied',
      }),
      expect.objectContaining({
        kind: 'work',
        workKind: 'question',
        lifecycle: 'pending',
      }),
      expect.objectContaining({
        kind: 'work',
        workKind: 'approval',
        approvalKind: 'permission-grant',
        lifecycle: 'interrupted',
      }),
    ]))
  })

  it('projects retry, compaction, and host errors as first-class runtime state', () => {
    const result = projectNativeSession({
      fileChanges: [],
      optimisticMessages: [],
      runtimeState: {
        error: 'Network unavailable',
        executionState: { type: 'retry', attempt: 2, message: 'Rate limited', next: 100 },
        isCompacting: true,
        retryMaxAttempts: 4,
      },
      sessionId: 'session-1',
      snapshot: { agentId: 'codex', thread: { id: 'session-1', turns: [] } },
    })
    const rows = flattenRows(result.rows)

    expect(result).toMatchObject({
      runtimeStatus: 'active',
      ongoingIndicatorLabel: 'Compacting context',
    })
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'system', systemKind: 'error', title: 'Network unavailable' }),
      expect.objectContaining({ kind: 'system', operationKind: 'compaction' }),
    ]))
    expect(JSON.stringify(rows)).toContain('Retrying (attempt 2/4): Rate limited')

    expect(projectNativeSession({
      fileChanges: [],
      optimisticMessages: [],
      runtimeState: { isStopping: true, isStreaming: true, stoppingAnchorAt: 42 },
      sessionId: 'session-1',
      snapshot: { agentId: 'pi', sessionId: 'session-1', messages: [] },
    })).toMatchObject({
      isStopping: true,
      runtimeStatus: 'stopping',
      stoppingAnchorAt: 42,
    })
  })

  it('keeps OpenCode detailed diffs, todos, subtasks, retries, and token usage', () => {
    const snapshot: BbNativeSessionSnapshot = {
      agentId: 'opencode',
      todos: [
        { content: 'Inspect renderer', status: 'completed', priority: 'high' },
        { content: 'Run regression', status: 'in_progress', priority: 'high' },
      ],
      diffs: [{ file: 'src/app.ts', status: 'modified', diff: '@@\n-old\n+new' }],
      messages: [{
        info: { id: 'assistant-1', role: 'assistant', time: { created: 1 } },
        parts: [{
          id: 'file-tool',
          type: 'tool',
          tool: 'edit',
          state: { status: 'completed', input: { path: 'src/app.ts' } },
        }, {
          id: 'subtask-1',
          type: 'subtask',
          description: 'Audit mapping',
          prompt: 'Review every part type',
        }, {
          id: 'retry-1',
          type: 'retry',
          attempt: 1,
          error: { message: 'Temporary failure' },
        }, {
          id: 'step-1',
          type: 'step-finish',
          reason: 'stop',
          cost: 0.01,
          tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 0 } },
        }],
      }],
    }
    const rows = flattenRows(project(snapshot).rows)
    const fileRows = rows.filter((row) => row.kind === 'work' && row.workKind === 'file-change')

    expect(fileRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ change: expect.objectContaining({ path: 'src/app.ts', diff: '@@\n-old\n+new' }) }),
    ]))
    expect(JSON.stringify(rows)).toContain('Inspect renderer')
    expect(JSON.stringify(rows)).toContain('Audit mapping')
    expect(JSON.stringify(rows)).toContain('Temporary failure')
    expect(JSON.stringify(rows)).toContain('opencode/todo/nativeDetail')
    expect(JSON.stringify(rows)).toContain('high')
  })

  it('keeps malformed native plan, todo, diff, and notice entries visible', () => {
    const openCodeRows = flattenRows(project({
      agentId: 'opencode',
      messages: [],
      diffs: ['future-diff-shape'],
      todos: [{ status: 'pending', priority: 'urgent' }, 'future-todo-shape'],
    }).rows)
    const openCodeSerialized = JSON.stringify(openCodeRows)
    expect(openCodeSerialized).toContain('opencode/diff')
    expect(openCodeSerialized).toContain('future-diff-shape')
    expect(openCodeSerialized).toContain('opencode/todo')
    expect(openCodeSerialized).toContain('future-todo-shape')

    const codexRows = flattenRows(project({
      agentId: 'codex',
      notices: ['future-notice-shape'],
      thread: {
        id: 'codex-malformed-native-data',
        turns: [{ id: 'turn-1', status: 'completed', items: [] }],
      },
      turnRuntime: {
        'turn-1': { plan: { steps: ['future-plan-step-shape'] } },
      },
    }).rows)
    const codexSerialized = JSON.stringify(codexRows)
    expect(codexSerialized).toContain('codex/notice')
    expect(codexSerialized).toContain('future-notice-shape')
    expect(codexSerialized).toContain('codex/plan/step')
    expect(codexSerialized).toContain('future-plan-step-shape')
  })

  it('never drops Codex terminal input or PI compaction/bash records', () => {
    const codexRows = flattenRows(project({
      agentId: 'codex',
      itemRuntime: {
        command: { output: '', progress: [], terminalInput: 'yes\n' },
      },
      thread: {
        id: 'codex-terminal',
        turns: [{
          id: 'turn-1',
          status: 'completed',
          items: [{ id: 'command', type: 'commandExecution', command: 'deploy', status: 'completed' }],
        }],
      },
    }).rows)
    expect(JSON.stringify(codexRows)).toContain('codex/commandExecution/terminalInput')

    const piRows = flattenRows(project({
      agentId: 'builtin-pi',
      sessionId: 'session-1',
      entryIds: ['bash-1', 'compact-1'],
      messages: [{
        role: 'bashExecution',
        command: 'pwd',
        output: 'C:/workspace',
        exitCode: 0,
      }, {
        role: 'compactionSummary',
        summary: 'Kept the implementation decisions.',
      }],
    }).rows)
    expect(piRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'work', workKind: 'command', command: 'pwd' }),
    ]))
    expect(piRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'system', operationKind: 'compaction' }),
    ]))
    expect(JSON.stringify(piRows)).toContain('Kept the implementation decisions.')
  })

  it('deduplicates an optimistic prompt after the native snapshot accepts it', () => {
    const result = projectNativeSession({
      fileChanges: [],
      optimisticMessages: [{ id: 'user-1', text: 'same prompt', timestamp: 1 }],
      sessionId: 'session-1',
      snapshot: {
        agentId: 'pi',
        sessionId: 'session-1',
        entryIds: ['user-1'],
        messages: [{ role: 'user', content: [{ type: 'text', text: 'same prompt' }], timestamp: 1 }],
      },
    })
    const userRows = flattenRows(result.rows).filter((row) => row.kind === 'conversation' && row.role === 'user')

    expect(userRows).toHaveLength(1)
    expect(userRows[0]).toMatchObject({ text: 'same prompt', turnRequest: { status: 'accepted' } })
  })

  it.each([
    ['codex', {
      agentId: 'codex' as const,
      thread: {
        id: 'session-1',
        turns: [{
          id: 'turn-old',
          status: 'completed',
          startedAt: 1,
          items: [{ id: 'old-user', type: 'userMessage', content: [{ type: 'text', text: 'continue' }] }],
        }],
      },
    }, 'old-user'],
    ['opencode', {
      agentId: 'opencode' as const,
      messages: [{
        info: { id: 'old-user', role: 'user', time: { created: 1_000 } },
        parts: [{ type: 'text', text: 'continue' }],
      }],
    }, 'old-user'],
    ['builtin-pi', {
      agentId: 'builtin-pi' as const,
      entryIds: ['old-user'],
      messages: [{ role: 'user', content: 'continue', timestamp: 1_000 }],
      sessionId: 'session-1',
    }, 'old-user'],
    ['pi', {
      agentId: 'pi' as const,
      entryIds: ['old-user'],
      messages: [{ role: 'user', content: 'continue', timestamp: 1_000 }],
      sessionId: 'session-1',
    }, 'old-user'],
  ])('does not let an older identical %s prompt consume a new optimistic user row', (
    _agentId,
    snapshot,
    baselineUserMessageId,
  ) => {
    const result = projectNativeSession({
      fileChanges: [],
      optimisticMessages: [{
        baselineUserMessageIds: [baselineUserMessageId],
        id: 'new-optimistic-user',
        text: 'continue',
        timestamp: 2_000,
      }],
      sessionId: 'session-1',
      snapshot,
    })
    const userRows = flattenRows(result.rows).filter((row) => (
      row.kind === 'conversation' && row.role === 'user' && row.text === 'continue'
    ))

    expect(userRows).toHaveLength(2)
    expect(userRows).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnRequest: expect.objectContaining({ status: 'accepted' }) }),
      expect.objectContaining({ turnRequest: expect.objectContaining({ status: 'pending' }) }),
    ]))
  })

  it.each(['pi', 'builtin-pi'] as const)(
    'projects live %s assistant, thinking, and tools through bb rows',
    (agentId) => {
      const result = projectNativeSession({
        fileChanges: [],
        optimisticMessages: [],
        runtimeState: {
          isStreaming: true,
          streaming: {
            assistantText: 'Live assistant answer',
            thinkingText: 'Checking the workspace',
            isThinkingStreaming: true,
            startedAt: 100,
            tools: [{
              id: 'tool-1',
              name: 'read',
              status: 'running',
              summary: 'Reading src/app.ts',
              startedAt: 101,
            }],
          },
        },
        sessionId: `${agentId}-live`,
        snapshot: {
          agentId,
          entryIds: ['user-1'],
          messages: [{ role: 'user', content: [{ type: 'text', text: 'Inspect it' }], timestamp: 90 }],
          sessionId: `${agentId}-live`,
        },
      })
      const rows = flattenRows(result.rows)

      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'conversation', role: 'assistant' }),
        expect.objectContaining({ kind: 'work', workKind: 'tool', status: 'pending' }),
      ]))
      expect(JSON.stringify(rows)).toContain('Live assistant answer')
      expect(JSON.stringify(result)).toContain('Checking the workspace')
      expect(JSON.stringify(rows)).toContain('Reading src/app.ts')
    },
  )

  it('keeps projection deterministic when providers omit all timestamps', () => {
    const options = {
      fileChanges: [],
      interactionRecords: [{
        request: {
          id: 'question-1',
          kind: 'question' as const,
          message: 'Continue?',
          options: [],
          sessionId: 'deterministic',
          title: 'Continue',
        },
        requestedAt: 42,
        status: 'pending' as const,
      }],
      optimisticMessages: [],
      runtimeState: { error: 'Stable error' },
      sessionId: 'deterministic',
      snapshot: { agentId: 'pi' as const, messages: [], sessionId: 'deterministic' },
    }

    expect(projectNativeSession(options)).toEqual(projectNativeSession(options))
  })

  it('attaches historical interactions to their originating turn', () => {
    const result = projectNativeSession({
      fileChanges: [],
      interactionRecords: [{
        request: {
          id: 'first-question',
          kind: 'question',
          message: 'Question from turn one',
          options: [],
          sessionId: 'turn-placement',
          title: 'Turn one question',
        },
        requestedAt: 1_700_000_000_150,
        resolvedAt: 1_700_000_000_160,
        response: { optionId: 'submit', values: ['yes'] },
        status: 'resolved',
      }],
      optimisticMessages: [],
      sessionId: 'turn-placement',
      snapshot: {
        agentId: 'pi',
        entryIds: ['user-1', 'assistant-1', 'user-2', 'assistant-2'],
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'First turn' }], timestamp: 1_700_000_000_100 },
          { role: 'assistant', content: [{ type: 'text', text: 'First answer' }], timestamp: 1_700_000_000_120 },
          { role: 'user', content: [{ type: 'text', text: 'Second turn' }], timestamp: 1_700_000_000_200 },
          { role: 'assistant', content: [{ type: 'text', text: 'Second answer' }], timestamp: 1_700_000_000_220 },
        ],
        sessionId: 'turn-placement',
      },
    })
    const questionRow = flattenRows(result.rows).find((row) => (
      row.kind === 'work' && row.workKind === 'question'
    ))

    expect(questionRow).toMatchObject({ turnId: 'user-1' })
  })

  it('keeps every OpenCode question, option, and recorded answer', () => {
    const questions = Array.from({ length: 5 }, (_, questionIndex) => ({
      id: `question-${questionIndex}`,
      question: `Question ${questionIndex}`,
      options: Array.from({ length: 6 }, (_, optionIndex) => ({
        label: `Option ${questionIndex}-${optionIndex}`,
        value: `value-${questionIndex}-${optionIndex}`,
      })),
    }))
    const result = project({
      agentId: 'opencode',
      messages: [{
        info: { id: 'assistant-1', role: 'assistant', time: { created: 100 } },
        parts: [{
          id: 'question-tool',
          type: 'tool',
          tool: 'question',
          state: {
            status: 'completed',
            input: { questions },
            metadata: {
              answers: questions.map((_, index) => [`Option ${index}-5`, `custom-${index}`]),
            },
          },
        }],
      }],
    })
    const serialized = JSON.stringify(result.rows)

    expect(serialized).toContain('Question 4')
    expect(serialized).toContain('Option 4-5')
    expect(serialized).toContain('value-4-5')
    expect(serialized).toContain('custom-4')
  })

  it('merges an OpenCode question tool part with its host lifecycle record', () => {
    const result = projectNativeSession({
      fileChanges: [],
      interactionRecords: [{
        request: {
          id: 'request-1',
          itemId: 'part-question',
          kind: 'question',
          message: 'Pick one',
          options: [{ id: 'reject', label: 'Cancel' }],
          sessionId: 'session-1',
          title: 'Choice',
          fields: [{
            id: 'choice',
            label: 'Choice',
            message: 'Pick one',
            options: [
              { id: 'alpha', label: 'Alpha' },
              { id: 'beta', label: 'Beta' },
            ],
          }],
        },
        requestedAt: 2_100,
        resolvedAt: 2_200,
        response: {
          optionId: 'submit',
          answers: { choice: ['beta'] },
        },
        status: 'resolved',
      }],
      optimisticMessages: [],
      sessionId: 'session-1',
      snapshot: {
        agentId: 'opencode',
        messages: [{
          info: { id: 'user-1', role: 'user', time: { created: 1 } },
          parts: [{ type: 'text', text: 'Ask me' }],
        }, {
          info: { id: 'assistant-1', role: 'assistant', time: { created: 2 } },
          parts: [{
            id: 'part-question',
            type: 'tool',
            tool: 'question',
            state: {
              status: 'pending',
              input: {
                questions: [{
                  id: 'choice',
                  question: 'Pick one',
                  multiple: false,
                  options: [
                    { label: 'Alpha', value: 'alpha' },
                    { label: 'Beta', value: 'beta' },
                  ],
                }],
              },
            },
          }],
        }],
      },
    })
    const questionRows = flattenRows(result.rows).filter((row) => (
      row.kind === 'work' && row.workKind === 'question'
    ))
    const serialized = JSON.stringify(questionRows)

    expect(questionRows).toHaveLength(1)
    expect(serialized).toContain('Pick one')
    expect(serialized).toContain('Beta')
    expect(serialized).toContain('beta')
  })

  it('merges an OpenCode permission tool part with its host lifecycle record', () => {
    const result = projectNativeSession({
      fileChanges: [],
      interactionRecords: [{
        request: {
          id: 'permission-request-1',
          itemId: 'permission-part-1',
          kind: 'permission',
          message: 'Allow shell?',
          options: [{ id: 'deny', label: 'Deny' }],
          sessionId: 'session-1',
          title: 'Run shell',
        },
        requestedAt: 2_100,
        resolvedAt: 2_200,
        response: { optionId: 'deny' },
        status: 'resolved',
      }],
      optimisticMessages: [],
      sessionId: 'session-1',
      snapshot: {
        agentId: 'opencode',
        messages: [{
          info: { id: 'user-1', role: 'user', time: { created: 1 } },
          parts: [{ type: 'text', text: 'Run it' }],
        }, {
          info: { id: 'assistant-1', role: 'assistant', time: { created: 2 } },
          parts: [{
            id: 'permission-part-1',
            type: 'tool',
            tool: 'permission',
            state: { status: 'pending' },
          }],
        }],
      },
    })
    const approvalRows = flattenRows(result.rows).filter((row) => (
      row.kind === 'work' && row.workKind === 'approval'
    ))

    expect(approvalRows).toHaveLength(1)
    expect(approvalRows[0]).toMatchObject({ lifecycle: 'denied' })
  })

  it('removes every native question batch before rebuilding the host lifecycle', () => {
    const questions = Array.from({ length: 5 }, (_, index) => ({
      id: `question-${index}`,
      question: `Question ${index}`,
      options: [{ label: `Option ${index}`, value: `value-${index}` }],
    }))
    const interactionRecord = {
      request: {
        id: 'batched-request',
        itemId: 'batched-part',
        kind: 'question' as const,
        message: 'Five questions',
        options: [],
        sessionId: 'session-1',
        title: 'Questions',
        fields: questions.map((question) => ({
          id: question.id,
          label: question.question,
          message: question.question,
          options: question.options.map((option) => ({ id: option.value, label: option.label })),
        })),
      },
      requestedAt: 2_100,
      status: 'pending' as const,
    }
    const combined = projectNativeSession({
      fileChanges: [],
      interactionRecords: [interactionRecord],
      optimisticMessages: [],
      sessionId: 'session-1',
      snapshot: {
        agentId: 'opencode',
        messages: [{
          info: { id: 'assistant-1', role: 'assistant', time: { created: 2 } },
          parts: [{
            id: 'batched-part',
            type: 'tool',
            tool: 'question',
            state: { status: 'pending', input: { questions } },
          }],
        }],
      },
    })
    const hostOnly = projectNativeSession({
      fileChanges: [],
      interactionRecords: [interactionRecord],
      optimisticMessages: [],
      sessionId: 'session-1',
      snapshot: { agentId: 'opencode', messages: [] },
    })
    const questionRows = (rows: typeof combined.rows) => flattenRows(rows).filter((row) => (
      row.kind === 'work' && row.workKind === 'question'
    ))

    expect(questionRows(combined.rows)).toHaveLength(questionRows(hostOnly.rows).length)
    expect(JSON.stringify(questionRows(combined.rows))).toContain('Question 4')
  })
})

import { describe, expect, it } from 'vitest'
import {
  createPiWebSessionState,
  getPiWebVisibleMessages,
  reducePiWebSessionState,
} from '../packages/pi-web-session-surface/src/session-state'
import type { PiWebNativeSessionSnapshot } from '../packages/pi-web-session-surface/src/contracts'

function snapshot(messages: PiWebNativeSessionSnapshot['messages'] = []): PiWebNativeSessionSnapshot {
  return {
    agentId: 'pi',
    entryIds: messages.map((_, index) => `entry-${index}`),
    isStreaming: false,
    messages,
    modelNames: {},
    sessionId: 'native-session-id',
  }
}

describe('vendored pi-web session state adapter', () => {
  it('reconciles the optimistic prompt with the native user event without a duplicate bubble', () => {
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'set_optimistic',
      messages: [{ content: '你好', timestamp: 10 }],
    })
    expect(getPiWebVisibleMessages(state)).toHaveLength(1)

    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: {
        type: 'message_end',
        message: { role: 'user', content: '你好', timestamp: 12 },
      },
    })

    expect(getPiWebVisibleMessages(state)).toEqual([
      expect.objectContaining({ role: 'user', content: '你好' }),
    ])
    expect(state.optimisticMessages).toEqual([])
  })

  it('keeps native thinking and tool blocks instead of flattening them', () => {
    let state = createPiWebSessionState(snapshot())
    const assistant = {
      role: 'assistant',
      model: 'model-1',
      provider: 'provider-1',
      content: [
        { type: 'thinking', thinking: 'Inspect the repository.' },
        { type: 'toolCall', toolCallId: 'tool-1', toolName: 'read', input: { path: 'package.json' } },
        { type: 'text', text: 'Done.' },
      ],
      timestamp: 20,
    }
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'message_end', message: assistant },
    })

    expect(state.messages[0]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'Inspect the repository.' },
        { type: 'toolCall', toolCallId: 'tool-1', toolName: 'read' },
        { type: 'text', text: 'Done.' },
      ],
    })
  })

  it('renders the current assistant message before message_end', () => {
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: {
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'partial reply' }],
          timestamp: 20,
        },
      },
    })

    expect(state.messages).toEqual([])
    expect(state.streamingMessage).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'partial reply' }],
    })
  })

  it('uses an authoritative snapshot to replace live messages without retaining stale optimistic prompts', () => {
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'set_optimistic',
      messages: [{ content: 'hello', timestamp: 10 }],
    })
    state = reducePiWebSessionState(state, {
      type: 'set_snapshot',
      snapshot: snapshot([{ role: 'user', content: 'hello', timestamp: 11 }]),
    })

    expect(getPiWebVisibleMessages(state)).toHaveLength(1)
    expect(state.optimisticMessages).toEqual([])
  })

  it('does not let an older identical prompt consume the current optimistic prompt', () => {
    let state = createPiWebSessionState(snapshot([
      { role: 'user', content: '你好', timestamp: 5 },
    ]))
    state = reducePiWebSessionState(state, {
      type: 'set_optimistic',
      messages: [{ content: '你好', timestamp: 10 }],
    })

    expect(getPiWebVisibleMessages(state)).toHaveLength(2)

    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: {
        type: 'message_end',
        message: { role: 'user', content: '你好', timestamp: 12 },
      },
    })

    expect(getPiWebVisibleMessages(state)).toHaveLength(2)
    expect(state.optimisticMessages).toEqual([])
  })

  it('reconciles repeated prompts against the matching snapshot delivery only once', () => {
    let state = createPiWebSessionState(snapshot([
      { role: 'user', content: '继续', timestamp: 5 },
    ]))
    state = reducePiWebSessionState(state, {
      type: 'set_optimistic',
      messages: [
        { content: '继续', timestamp: 10 },
        { content: '继续', timestamp: 20 },
      ],
    })
    state = reducePiWebSessionState(state, {
      type: 'set_snapshot',
      snapshot: snapshot([
        { role: 'user', content: '继续', timestamp: 5 },
        { role: 'user', content: '继续', timestamp: 12 },
      ]),
    })

    expect(state.optimisticMessages).toEqual([
      expect.objectContaining({ content: '继续', timestamp: 20 }),
    ])
    expect(getPiWebVisibleMessages(state)).toHaveLength(3)
  })

  it('clears a stale streaming message when an authoritative snapshot is idle', () => {
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: {
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'partial reply' }],
          timestamp: 20,
        },
      },
    })
    state = reducePiWebSessionState(state, {
      type: 'set_snapshot',
      snapshot: snapshot(),
    })

    expect(state.agentRunning).toBe(false)
    expect(state.streamingMessage).toBeNull()
  })

  it('tracks concurrent native tools until the final tool completes', () => {
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'tool_execution_start', toolCallId: 'tool-2', toolName: 'write' },
    })

    expect(state.agentPhase).toEqual({
      kind: 'running_tools',
      tools: [
        { id: 'tool-1', name: 'read' },
        { id: 'tool-2', name: 'write' },
      ],
    })

    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'tool_execution_end', toolCallId: 'tool-1' },
    })
    expect(state.agentPhase).toEqual({
      kind: 'running_tools',
      tools: [{ id: 'tool-2', name: 'write' }],
    })

    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'tool_execution_end', toolCallId: 'tool-2' },
    })
    expect(state.agentPhase).toEqual({ kind: 'waiting_model' })
  })

  it('ignores buffered message events after the native run has ended', () => {
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_end' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: {
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'stale partial' }] },
      },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: {
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text: 'stale final' }] },
      },
    })

    expect(state.messages).toEqual([])
    expect(state.streamingMessage).toBeNull()
    expect(state.agentRunning).toBe(false)
  })

  it('ignores buffered tool events after the native run has ended', () => {
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_end' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'tool_execution_start', toolCallId: 'stale-tool', toolName: 'write' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'tool_execution_end', toolCallId: 'stale-tool' },
    })

    expect(state.agentPhase).toBeNull()
    expect(state.agentRunning).toBe(false)
  })

  it('reconciles an optimistic image prompt with a native delivery lacking a timestamp', () => {
    const content = [
      { type: 'text', text: '描述图片' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
      },
    ]
    let state = createPiWebSessionState(snapshot())
    state = reducePiWebSessionState(state, {
      type: 'set_optimistic',
      messages: [{ content, timestamp: 10 }],
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'agent_start' },
    })
    state = reducePiWebSessionState(state, {
      type: 'native_event',
      event: { type: 'message_end', message: { role: 'user', content } },
    })

    expect(getPiWebVisibleMessages(state)).toHaveLength(1)
    expect(state.optimisticMessages).toEqual([])
  })
})

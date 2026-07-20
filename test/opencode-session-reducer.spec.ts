import type { Event as OpenCodeEvent, Message, Part } from '@opencode-ai/sdk/v2'
import { describe, expect, it } from 'vitest'
import {
  getOpenCodeEventSessionId,
  OpenCodeSessionMessageReducer,
} from '../electron/main/opencode-session-reducer'

function event(value: unknown) {
  return value as OpenCodeEvent
}

function assistantMessage(sessionID = 'session-1'): Message {
  return {
    id: 'message-1',
    role: 'assistant',
    sessionID,
    time: { created: 1 },
    parentID: 'user-1',
    modelID: 'model',
    providerID: 'provider',
    mode: 'build',
    path: { cwd: 'C:\\workspace', root: 'C:\\workspace' },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as Message
}

function textPart(sessionID = 'session-1'): Part {
  return {
    id: 'part-1',
    messageID: 'message-1',
    sessionID,
    type: 'text',
    text: '',
  }
}

describe('OpenCode native session event reduction', () => {
  it('accepts session IDs from both current and adjacent SDK event shapes', () => {
    expect(getOpenCodeEventSessionId(event({
      type: 'message.part.delta',
      properties: { sessionID: 'current-session' },
    }))).toBe('current-session')
    expect(getOpenCodeEventSessionId(event({
      type: 'message.updated',
      properties: { info: assistantMessage('nested-session') },
    }))).toBe('nested-session')
    expect(getOpenCodeEventSessionId(event({
      type: 'message.part.updated',
      properties: { part: textPart('part-session') },
    }))).toBe('part-session')
    expect(getOpenCodeEventSessionId(event({
      type: 'session.deleted',
      properties: { info: { id: 'deleted-session' } },
    }))).toBe('deleted-session')
    expect(getOpenCodeEventSessionId(event({
      type: 'message.updated',
      properties: { info: { id: 'message-is-not-a-session' } },
    }))).toBeNull()
  })

  it('accumulates message.part.delta into the native text part', () => {
    const reducer = new OpenCodeSessionMessageReducer()
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [textPart()] }])

    for (const delta of ['O', 'K']) {
      expect(reducer.apply(event({
        type: 'message.part.delta',
        properties: {
          delta,
          field: 'text',
          messageID: 'message-1',
          partID: 'part-1',
          sessionID: 'session-1',
        },
      }))).toEqual({ awaitingBaseline: false, changed: true, sessionId: 'session-1' })
    }

    expect(reducer.records('session-1')).toEqual([
      expect.objectContaining({
        info: expect.objectContaining({ id: 'message-1' }),
        parts: [expect.objectContaining({ id: 'part-1', text: 'OK', type: 'text' })],
      }),
    ])
  })

  it('marks a delta as waiting for its full Part baseline when it arrives first', () => {
    const reducer = new OpenCodeSessionMessageReducer()
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [] }])

    expect(reducer.apply(event({
      type: 'message.part.delta',
      properties: {
        delta: 'late',
        field: 'text',
        messageID: 'message-1',
        partID: 'missing-part',
        sessionID: 'session-1',
      },
    }))).toEqual({ awaitingBaseline: true, changed: false, sessionId: 'session-1' })
  })

  it('buffers an out-of-order full part until its parent message event arrives', () => {
    const reducer = new OpenCodeSessionMessageReducer()

    expect(reducer.apply(event({
      type: 'message.part.updated',
      properties: { part: { ...textPart(), text: 'buffered' }, sessionID: 'session-1' },
    }))).toEqual({ awaitingBaseline: true, changed: true, sessionId: 'session-1' })
    expect(reducer.records('session-1')).toEqual([])

    expect(reducer.apply(event({
      type: 'message.updated',
      properties: { info: assistantMessage(), sessionID: 'session-1' },
    }))).toEqual({ awaitingBaseline: false, changed: true, sessionId: 'session-1' })
    expect(reducer.records('session-1')[0]?.parts).toEqual([
      expect.objectContaining({ text: 'buffered' }),
    ])
  })

  it('replaces and removes native parts without leaking stale content', () => {
    const reducer = new OpenCodeSessionMessageReducer()
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [textPart()] }])

    reducer.apply(event({
      type: 'message.part.updated',
      properties: { part: { ...textPart(), text: 'complete' }, sessionID: 'session-1' },
    }))
    expect(reducer.records('session-1')[0]?.parts).toEqual([
      expect.objectContaining({ text: 'complete' }),
    ])

    reducer.apply(event({
      type: 'message.part.removed',
      properties: { messageID: 'message-1', partID: 'part-1', sessionID: 'session-1' },
    }))
    expect(reducer.records('session-1')[0]?.parts).toEqual([])
  })

  it('removes both a message and all of its parts without short-circuiting', () => {
    const reducer = new OpenCodeSessionMessageReducer()
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [{ ...textPart(), text: 'stale' }] }])

    reducer.apply(event({
      type: 'message.removed',
      properties: { messageID: 'message-1', sessionID: 'session-1' },
    }))
    reducer.apply(event({
      type: 'message.updated',
      properties: { info: assistantMessage(), sessionID: 'session-1' },
    }))

    expect(reducer.records('session-1')).toEqual([
      expect.objectContaining({ info: expect.objectContaining({ id: 'message-1' }), parts: [] }),
    ])
  })

  it('does not let a stale REST hydration overwrite concurrent native updates', () => {
    const reducer = new OpenCodeSessionMessageReducer()
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [{ ...textPart(), text: 'before' }] }])
    const checkpoint = reducer.beginHydration('session-1')

    reducer.apply(event({
      type: 'message.part.updated',
      properties: { part: { ...textPart(), text: 'live' }, sessionID: 'session-1' },
    }))
    reducer.hydrate('session-1', [{
      info: assistantMessage(),
      parts: [{ ...textPart(), text: 'stale REST response' }],
    }], checkpoint)

    expect(reducer.records('session-1')[0]?.parts).toEqual([
      expect.objectContaining({ text: 'live' }),
    ])
  })

  it('keeps event-only removals tombstoned across later stale REST snapshots', () => {
    const reducer = new OpenCodeSessionMessageReducer()
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [textPart()] }])
    const checkpoint = reducer.beginHydration('session-1')

    reducer.apply(event({
      type: 'message.part.removed',
      properties: { messageID: 'message-1', partID: 'part-1', sessionID: 'session-1' },
    }))
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [textPart()] }], checkpoint)
    reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [textPart()] }])

    expect(reducer.records('session-1')[0]?.parts).toEqual([])
  })

  it('ignores an older hydration generation after a newer request starts', () => {
    const reducer = new OpenCodeSessionMessageReducer()
    const older = reducer.beginHydration('session-1')
    const newer = reducer.beginHydration('session-1')

    expect(reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [] }], older)).toBe(false)
    expect(reducer.hydrate('session-1', [{ info: assistantMessage(), parts: [textPart()] }], newer)).toBe(true)
    expect(reducer.records('session-1')[0]?.parts).toHaveLength(1)
  })
})

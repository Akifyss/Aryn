import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2'
import { describe, expect, it } from 'vitest'
import {
  coalesceOpenCodeEvents,
  enqueueOpenCodeEvent,
} from '../packages/opencode-session-surface/src/adapters/event-queue'

function delta(value: string): OpenCodeEvent {
  return {
    type: 'message.part.delta',
    properties: {
      delta: value,
      field: 'text',
      messageID: 'message',
      partID: 'part',
      sessionID: 'session',
    },
  }
}

describe('OpenCode official event scheduling semantics', () => {
  it('coalesces adjacent text deltas without crossing an intervening event', () => {
    const directory = 'C:\\workspace'
    const status = {
      directory,
      payload: {
        type: 'session.status',
        properties: { sessionID: 'session', status: { type: 'busy' } },
      } as OpenCodeEvent,
    }

    const result = coalesceOpenCodeEvents([
      { directory, payload: delta('hel') },
      { directory, payload: delta('lo') },
      status,
      { directory, payload: delta('!') },
    ])

    expect(result).toHaveLength(3)
    expect(result[0]?.payload).toMatchObject({ properties: { delta: 'hello' } })
    expect(result[1]).toBe(status)
    expect(result[2]?.payload).toMatchObject({ properties: { delta: '!' } })
  })

  it('replaces adjacent full part snapshots for the same part', () => {
    const queue: Array<{ directory: string; payload: OpenCodeEvent }> = []
    const first = {
      type: 'message.part.updated',
      properties: {
        part: { id: 'part', messageID: 'message', sessionID: 'session', text: 'a', type: 'text' },
      },
    } as OpenCodeEvent
    const second = {
      type: 'message.part.updated',
      properties: {
        part: { id: 'part', messageID: 'message', sessionID: 'session', text: 'ab', type: 'text' },
      },
    } as OpenCodeEvent

    expect(enqueueOpenCodeEvent(queue, { directory: 'workspace', payload: first })).toBe(true)
    expect(enqueueOpenCodeEvent(queue, { directory: 'workspace', payload: second })).toBe(false)
    expect(queue).toEqual([{ directory: 'workspace', payload: second }])
  })
})

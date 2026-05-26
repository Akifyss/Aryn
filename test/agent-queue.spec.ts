import { describe, expect, it } from 'vitest'
import { applyAgentQueuedMessageUpdate } from '../electron/main/agent'

describe('agent queued message updates', () => {
  it('edits a follow-up message without touching steering messages', () => {
    expect(applyAgentQueuedMessageUpdate({
      followUp: ['first', 'second'],
      steering: ['now'],
    }, {
      action: 'edit',
      expectedText: 'second',
      index: 1,
      kind: 'followUp',
      text: ' revised second ',
    })).toEqual({
      followUp: ['first', 'revised second'],
      steering: ['now'],
    })
  })

  it('deletes the indexed duplicate only when expected text matches', () => {
    expect(applyAgentQueuedMessageUpdate({
      followUp: ['repeat', 'repeat', 'later'],
      steering: [],
    }, {
      action: 'delete',
      expectedText: 'repeat',
      index: 1,
      kind: 'followUp',
    })).toEqual({
      followUp: ['repeat', 'later'],
      steering: [],
    })
  })

  it('moves a follow-up message into the steering queue', () => {
    expect(applyAgentQueuedMessageUpdate({
      followUp: ['after'],
      steering: ['current'],
    }, {
      action: 'move',
      expectedText: 'after',
      index: 0,
      kind: 'followUp',
      targetKind: 'steer',
    })).toEqual({
      followUp: [],
      steering: ['current', 'after'],
    })
  })

  it('rejects stale queue operations', () => {
    expect(() => applyAgentQueuedMessageUpdate({
      followUp: ['new text'],
      steering: [],
    }, {
      action: 'delete',
      expectedText: 'old text',
      index: 0,
      kind: 'followUp',
    })).toThrow('Queued message changed before this action completed')
  })

  it('rejects empty edited messages', () => {
    expect(() => applyAgentQueuedMessageUpdate({
      followUp: ['keep'],
      steering: [],
    }, {
      action: 'edit',
      expectedText: 'keep',
      index: 0,
      kind: 'followUp',
      text: '   ',
    })).toThrow('Queued message cannot be empty')
  })
})

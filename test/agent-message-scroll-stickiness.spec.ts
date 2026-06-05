import { describe, expect, it } from 'vitest'
import { shouldStickAgentMessagesToBottom } from '../src/features/agent/lib/message-scroll-stickiness'

describe('shouldStickAgentMessagesToBottom', () => {
  it('sticks when content cannot scroll', () => {
    expect(shouldStickAgentMessagesToBottom({
      clientHeight: 600,
      scrollHeight: 580,
      scrollTop: 0,
    })).toBe(true)
  })

  it('sticks when already near the bottom', () => {
    expect(shouldStickAgentMessagesToBottom({
      clientHeight: 600,
      scrollHeight: 1200,
      scrollTop: 578,
    })).toBe(true)
  })

  it('does not stick when the user is reading older messages', () => {
    expect(shouldStickAgentMessagesToBottom({
      clientHeight: 600,
      scrollHeight: 1200,
      scrollTop: 240,
    })).toBe(false)
  })
})

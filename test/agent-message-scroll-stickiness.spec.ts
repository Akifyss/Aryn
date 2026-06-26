import { describe, expect, it } from 'vitest'
import {
  isAgentMessagesScrollIntentKey,
  resolveAgentMessagesScrollStickiness,
  shouldStickAgentMessagesToBottom,
} from '../src/features/agent/lib/message-scroll-stickiness'

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

describe('resolveAgentMessagesScrollStickiness', () => {
  it('keeps sticky enabled across layout reflow scroll changes without user intent', () => {
    expect(resolveAgentMessagesScrollStickiness({
      clientHeight: 600,
      scrollHeight: 1400,
      scrollTop: 600,
    }, {
      currentShouldStick: true,
      hasUserScrollIntent: false,
    })).toBe(true)
  })

  it('keeps sticky without reading scroll metrics when there is no user intent', () => {
    const scrollElement = {
      get clientHeight(): number {
        throw new Error('clientHeight should not be read')
      },
      get scrollHeight(): number {
        throw new Error('scrollHeight should not be read')
      },
      get scrollTop(): number {
        throw new Error('scrollTop should not be read')
      },
    }

    expect(resolveAgentMessagesScrollStickiness(scrollElement, {
      currentShouldStick: true,
      hasUserScrollIntent: false,
    })).toBe(true)
  })

  it('disables sticky when the user intentionally scrolls away from the bottom', () => {
    expect(resolveAgentMessagesScrollStickiness({
      clientHeight: 600,
      scrollHeight: 1400,
      scrollTop: 600,
    }, {
      currentShouldStick: true,
      hasUserScrollIntent: true,
    })).toBe(false)
  })

  it('does not re-enable sticky for non-user scroll movement away from bottom', () => {
    expect(resolveAgentMessagesScrollStickiness({
      clientHeight: 600,
      scrollHeight: 1400,
      scrollTop: 600,
    }, {
      currentShouldStick: false,
      hasUserScrollIntent: false,
    })).toBe(false)
  })

  it('re-enables sticky when the viewport reaches the bottom again', () => {
    expect(resolveAgentMessagesScrollStickiness({
      clientHeight: 600,
      scrollHeight: 1400,
      scrollTop: 790,
    }, {
      currentShouldStick: false,
      hasUserScrollIntent: true,
    })).toBe(true)
  })
})

describe('isAgentMessagesScrollIntentKey', () => {
  it('recognizes keyboard scrolling keys', () => {
    expect(isAgentMessagesScrollIntentKey('ArrowUp')).toBe(true)
    expect(isAgentMessagesScrollIntentKey('PageDown')).toBe(true)
    expect(isAgentMessagesScrollIntentKey('Home')).toBe(true)
    expect(isAgentMessagesScrollIntentKey(' ', 'Space')).toBe(true)
  })

  it('ignores non-scrolling keys', () => {
    expect(isAgentMessagesScrollIntentKey('Enter')).toBe(false)
    expect(isAgentMessagesScrollIntentKey('a')).toBe(false)
  })
})

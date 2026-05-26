import { describe, expect, it } from 'vitest'
import { isAgentKeyboardCompositionEvent } from '../src/features/agent/lib/keyboard'

describe('agent keyboard helpers', () => {
  it('detects React native IME composition events', () => {
    expect(isAgentKeyboardCompositionEvent({
      nativeEvent: {
        isComposing: true,
      },
    })).toBe(true)
  })

  it('detects browser IME process key events', () => {
    expect(isAgentKeyboardCompositionEvent({
      nativeEvent: {
        keyCode: 229,
      },
    })).toBe(true)
  })

  it('ignores ordinary Enter events', () => {
    expect(isAgentKeyboardCompositionEvent({
      nativeEvent: {
        isComposing: false,
        keyCode: 13,
      },
    })).toBe(false)
  })
})

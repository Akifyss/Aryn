import { describe, expect, it } from 'vitest'
import {
  shouldCancelAgentMessagesRestoreForEvent,
  startAgentMessagesBottomRestore,
} from '../src/features/agent/lib/message-scroll-restore'

function createFrameScheduler() {
  let nextId = 1
  const callbacks = new Map<number, FrameRequestCallback>()

  return {
    cancelAnimationFrame: (handle: number) => {
      callbacks.delete(handle)
    },
    flushFrame: () => {
      const [handle, callback] = callbacks.entries().next().value ?? []

      if (typeof handle !== 'number' || !callback) {
        return false
      }

      callbacks.delete(handle)
      callback(0)
      return true
    },
    get pendingFrameCount() {
      return callbacks.size
    },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const handle = nextId
      nextId += 1
      callbacks.set(handle, callback)
      return handle
    },
  }
}

describe('shouldCancelAgentMessagesRestoreForEvent', () => {
  it('recognizes direct user input events', () => {
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('beforeinput'))).toBe(true)
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('keydown'))).toBe(true)
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('mousedown'))).toBe(true)
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('pointerdown'))).toBe(true)
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('touchstart'))).toBe(true)
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('wheel'))).toBe(true)
  })

  it('ignores passive layout and scroll events', () => {
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('scroll'))).toBe(false)
    expect(shouldCancelAgentMessagesRestoreForEvent(new Event('resize'))).toBe(false)
  })
})

describe('startAgentMessagesBottomRestore', () => {
  it('keeps restoring until the bottom anchor is stable', () => {
    const scheduler = createFrameScheduler()
    const scrollTops = [120, 180, 180, 180]
    let readCount = 0
    let scrollCount = 0

    startAgentMessagesBottomRestore({
      getScrollTop: () => scrollTops[Math.min(readCount++, scrollTops.length - 1)],
      scheduler,
      scrollToBottom: () => {
        scrollCount += 1
      },
      stableFrames: 2,
    })

    expect(scrollCount).toBe(1)
    expect(scheduler.pendingFrameCount).toBe(1)

    expect(scheduler.flushFrame()).toBe(true)
    expect(scheduler.flushFrame()).toBe(true)
    expect(scheduler.flushFrame()).toBe(true)
    expect(scheduler.flushFrame()).toBe(true)

    expect(scrollCount).toBe(5)
    expect(scheduler.pendingFrameCount).toBe(0)
  })

  it('cancels pending restore work on user input', () => {
    const scheduler = createFrameScheduler()
    const scrollRootElement = new EventTarget()
    let scrollCount = 0

    startAgentMessagesBottomRestore({
      getScrollTop: () => 0,
      scheduler,
      scrollRootElement,
      scrollToBottom: () => {
        scrollCount += 1
      },
    })

    expect(scrollCount).toBe(1)
    expect(scheduler.pendingFrameCount).toBe(1)

    scrollRootElement.dispatchEvent(new Event('wheel'))

    expect(scheduler.pendingFrameCount).toBe(0)
    expect(scheduler.flushFrame()).toBe(false)
    expect(scrollCount).toBe(1)
  })

  it('stops at the maximum attempt count when the anchor never stabilizes', () => {
    const scheduler = createFrameScheduler()
    let scrollTop = 0
    let scrollCount = 0

    startAgentMessagesBottomRestore({
      getScrollTop: () => {
        scrollTop += 10
        return scrollTop
      },
      maxAttempts: 2,
      scheduler,
      scrollToBottom: () => {
        scrollCount += 1
      },
    })

    expect(scheduler.flushFrame()).toBe(true)
    expect(scheduler.flushFrame()).toBe(true)

    expect(scrollCount).toBe(3)
    expect(scheduler.pendingFrameCount).toBe(0)
  })
})

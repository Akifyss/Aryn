import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDelayedLoadingIndicator,
  SESSION_LOADING_INDICATOR_DELAY_MS,
} from '../src/features/agent/lib/delayed-loading-indicator'

afterEach(() => {
  vi.useRealTimers()
})

describe('delayed loading indicator', () => {
  it('stays hidden for the first 200ms and appears only while work is still pending', () => {
    vi.useFakeTimers()
    const visibilityChanges: boolean[] = []
    const indicator = createDelayedLoadingIndicator({
      onVisibilityChange: (visible) => visibilityChanges.push(visible),
    })

    indicator.begin()
    vi.advanceTimersByTime(SESSION_LOADING_INDICATOR_DELAY_MS - 1)
    expect(indicator.isVisible()).toBe(false)
    expect(visibilityChanges).toEqual([])

    vi.advanceTimersByTime(1)
    expect(indicator.isVisible()).toBe(true)
    expect(visibilityChanges).toEqual([true])
  })

  it('cancels the pending indicator when loading completes quickly', () => {
    vi.useFakeTimers()
    const visibilityChanges: boolean[] = []
    const indicator = createDelayedLoadingIndicator({
      onVisibilityChange: (visible) => visibilityChanges.push(visible),
    })

    indicator.begin()
    vi.advanceTimersByTime(35)
    indicator.finish()
    vi.runAllTimers()

    expect(indicator.isVisible()).toBe(false)
    expect(visibilityChanges).toEqual([])
  })

  it('restarts the grace period when another session is selected before the indicator appears', () => {
    vi.useFakeTimers()
    const indicator = createDelayedLoadingIndicator({
      onVisibilityChange: () => undefined,
    })

    indicator.begin()
    vi.advanceTimersByTime(150)
    indicator.begin()
    vi.advanceTimersByTime(SESSION_LOADING_INDICATOR_DELAY_MS - 1)
    expect(indicator.isVisible()).toBe(false)

    vi.advanceTimersByTime(1)
    expect(indicator.isVisible()).toBe(true)
  })

  it('keeps an already-visible indicator stable across rapid switches and hides it immediately on completion', () => {
    vi.useFakeTimers()
    const visibilityChanges: boolean[] = []
    const indicator = createDelayedLoadingIndicator({
      onVisibilityChange: (visible) => visibilityChanges.push(visible),
    })

    indicator.begin()
    vi.advanceTimersByTime(SESSION_LOADING_INDICATOR_DELAY_MS)
    indicator.begin()
    vi.advanceTimersByTime(10)
    expect(visibilityChanges).toEqual([true])

    indicator.finish()
    expect(indicator.isVisible()).toBe(false)
    expect(visibilityChanges).toEqual([true, false])
  })

  it('does not publish a delayed update after an owner cleanup', () => {
    vi.useFakeTimers()
    const visibilityChanges: boolean[] = []
    const indicator = createDelayedLoadingIndicator({
      onVisibilityChange: (visible) => visibilityChanges.push(visible),
    })

    indicator.begin()
    indicator.cancelPending()
    vi.runAllTimers()

    expect(visibilityChanges).toEqual([])

    // React StrictMode runs effect cleanup and setup again with the same ref.
    indicator.begin()
    vi.advanceTimersByTime(SESSION_LOADING_INDICATOR_DELAY_MS)
    expect(visibilityChanges).toEqual([true])
  })
})

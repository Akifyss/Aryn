import { afterEach, describe, expect, it, vi } from 'vitest'
import { __meoBaseScrollAreaTestHooks } from '../src/features/editor/lib/meo-base-scroll-area'

describe('meo base scroll area teardown', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defers secondary React root unmount until the current task completes', () => {
    vi.useFakeTimers()
    const root = { unmount: vi.fn() }

    __meoBaseScrollAreaTestHooks.scheduleDeferredRootUnmount(root)

    expect(root.unmount).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
    expect(root.unmount).toHaveBeenCalledTimes(1)
  })

  it('keeps the deferred root unmount idempotent', () => {
    vi.useFakeTimers()
    const root = { unmount: vi.fn() }

    const unmount = __meoBaseScrollAreaTestHooks.scheduleDeferredRootUnmount(root)
    unmount()
    unmount()
    vi.runOnlyPendingTimers()

    expect(root.unmount).toHaveBeenCalledTimes(1)
  })
})

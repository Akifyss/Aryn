import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleDeferredReactRootUnmount } from '../src/features/editor/lib/meo-react-root'

describe('MEO secondary React root teardown', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('defers secondary React root unmount until the current task completes', () => {
    vi.useFakeTimers()
    const root = { unmount: vi.fn() }

    scheduleDeferredReactRootUnmount(root)

    expect(root.unmount).not.toHaveBeenCalled()
    vi.runOnlyPendingTimers()
    expect(root.unmount).toHaveBeenCalledTimes(1)
  })

  it('keeps the deferred root unmount idempotent', () => {
    vi.useFakeTimers()
    const root = { unmount: vi.fn() }

    const unmount = scheduleDeferredReactRootUnmount(root)
    unmount()
    unmount()
    vi.runOnlyPendingTimers()

    expect(root.unmount).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { WorkspaceNavigationCoordinator } from '../src/features/workspace/lib/workspace-navigation-coordinator'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('WorkspaceNavigationCoordinator', () => {
  it('makes only the latest accepted navigation current', () => {
    const coordinator = new WorkspaceNavigationCoordinator()
    const first = coordinator.begin('project:first')
    const second = coordinator.begin('project:second')

    expect(coordinator.isCurrent(first)).toBe(false)
    expect(coordinator.isCurrent(second)).toBe(true)
    expect(coordinator.guard(first)()).toBe(false)
    expect(coordinator.guard(second)()).toBe(true)
  })

  it('serializes background effects and marks a late result as superseded', async () => {
    const coordinator = new WorkspaceNavigationCoordinator()
    const firstGate = createDeferred<void>()
    const order: string[] = []
    const firstIntent = coordinator.begin('project:first')
    const firstResult = coordinator.run(firstIntent, async (isCurrent) => {
      order.push('first:start')
      await firstGate.promise
      order.push(`first:current:${isCurrent()}`)
      return 'first'
    })

    await Promise.resolve()
    const secondIntent = coordinator.begin('project:second')
    const secondResult = coordinator.run(secondIntent, async (isCurrent) => {
      order.push(`second:start:${isCurrent()}`)
      return 'second'
    })

    expect(order).toEqual(['first:start'])
    firstGate.resolve()

    await expect(firstResult).resolves.toEqual({ status: 'superseded', value: 'first' })
    await expect(secondResult).resolves.toEqual({ status: 'completed', value: 'second' })
    expect(order).toEqual([
      'first:start',
      'first:current:false',
      'second:start:true',
    ])
  })

  it('skips queued work that is superseded before it starts', async () => {
    const coordinator = new WorkspaceNavigationCoordinator()
    const blocker = createDeferred<void>()
    const firstIntent = coordinator.begin('project:first')
    const firstResult = coordinator.run(firstIntent, async () => blocker.promise)
    await Promise.resolve()

    const skippedEffect = vi.fn(async () => undefined)
    const skippedIntent = coordinator.begin('project:second')
    const skippedResult = coordinator.run(skippedIntent, skippedEffect)
    const latestIntent = coordinator.begin('conversation:latest')
    const latestEffect = vi.fn(async () => undefined)
    const latestResult = coordinator.run(latestIntent, latestEffect)
    blocker.resolve()

    await firstResult
    await expect(skippedResult).resolves.toEqual({ status: 'superseded' })
    await expect(latestResult).resolves.toEqual({ status: 'completed', value: undefined })
    expect(skippedEffect).not.toHaveBeenCalled()
    expect(latestEffect).toHaveBeenCalledOnce()
  })

  it('finishes queued durable work after its navigation is superseded', async () => {
    const coordinator = new WorkspaceNavigationCoordinator()
    const blocker = createDeferred<void>()
    const firstIntent = coordinator.begin('project:first')
    const firstResult = coordinator.run(firstIntent, async () => blocker.promise)
    await Promise.resolve()

    const durableEffect = vi.fn(async (isCurrent: () => boolean) => {
      expect(isCurrent()).toBe(false)
      return 'created'
    })
    const durableIntent = coordinator.begin('conversation:create')
    const durableResult = coordinator.runDurable(durableIntent, durableEffect)
    const latestIntent = coordinator.begin('project:latest')
    const latestEffect = vi.fn(async () => 'latest')
    const latestResult = coordinator.run(latestIntent, latestEffect)
    blocker.resolve()

    await firstResult
    await expect(durableResult).resolves.toEqual({
      status: 'superseded',
      value: 'created',
    })
    await expect(latestResult).resolves.toEqual({
      status: 'completed',
      value: 'latest',
    })
    expect(durableEffect).toHaveBeenCalledOnce()
    expect(latestEffect).toHaveBeenCalledOnce()
  })

  it('continues the queue after a failed background effect', async () => {
    const coordinator = new WorkspaceNavigationCoordinator()
    const firstIntent = coordinator.begin('project:first')
    const firstResult = coordinator.run(firstIntent, async () => {
      throw new Error('failed')
    })
    await expect(firstResult).rejects.toThrow('failed')

    const secondIntent = coordinator.begin('project:second')
    await expect(coordinator.run(secondIntent, async () => 'ready')).resolves.toEqual({
      status: 'completed',
      value: 'ready',
    })
  })
})

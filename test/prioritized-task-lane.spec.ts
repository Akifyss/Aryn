import { describe, expect, it } from 'vitest'
import { PrioritizedTaskLane } from '../electron/main/agent-host/runtime/prioritized-task-lane'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('PrioritizedTaskLane', () => {
  it('admits queued control work before user work', async () => {
    const lane = new PrioritizedTaskLane()
    const firstEntered = deferred()
    const releaseFirst = deferred()
    const order: string[] = []

    const first = lane.enqueue('user', async () => {
      order.push('first-user')
      firstEntered.resolve()
      await releaseFirst.promise
    })
    await firstEntered.promise

    const second = lane.enqueue('user', () => {
      order.push('second-user')
    })
    const control = lane.enqueue('control', () => {
      order.push('control')
    })

    releaseFirst.resolve()
    await Promise.all([first, second, control, lane.drain()])

    expect(order).toEqual(['first-user', 'control', 'second-user'])
    expect(lane.pending).toBe(0)
  })

  it('bounds control bursts so queued user work cannot starve', async () => {
    const lane = new PrioritizedTaskLane()
    const firstEntered = deferred()
    const releaseFirst = deferred()
    const order: string[] = []

    const first = lane.enqueue('user', async () => {
      firstEntered.resolve()
      await releaseFirst.promise
    })
    await firstEntered.promise

    const controls = Array.from({ length: 9 }, (_, index) => (
      lane.enqueue('control', () => {
        order.push(`control-${index}`)
      })
    ))
    const user = lane.enqueue('user', () => {
      order.push('user')
    })

    releaseFirst.resolve()
    await Promise.all([first, ...controls, user, lane.drain()])

    expect(order).toEqual([
      'control-0',
      'control-1',
      'control-2',
      'control-3',
      'control-4',
      'control-5',
      'control-6',
      'control-7',
      'user',
      'control-8',
    ])
  })

  it('continues after a rejected task and drains deterministically', async () => {
    const lane = new PrioritizedTaskLane()
    const failed = lane.enqueue('user', () => {
      throw new Error('task failed')
    })
    const applied: string[] = []
    const next = lane.enqueue('user', () => {
      applied.push('next')
    })

    await expect(failed).rejects.toThrow('task failed')
    await Promise.all([next, lane.drain()])
    expect(applied).toEqual(['next'])
  })
})

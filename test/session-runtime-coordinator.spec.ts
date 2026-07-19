import { describe, expect, it, vi } from 'vitest'
import {
  SessionRuntimeCoordinator,
  type SessionRuntimeLease,
} from '../electron/main/session-runtime-coordinator'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

describe('SessionRuntimeCoordinator', () => {
  it('starts a session once when concurrent callers require the same runtime', async () => {
    const startEntered = deferred()
    const allowStart = deferred()
    const stopRuntime = vi.fn()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime })
    let starts = 0
    const start = async () => {
      starts += 1
      startEntered.resolve()
      await allowStart.promise
      return { id: 'runtime-a' }
    }

    const first = coordinator.ensure('workspace-a\0session-a', start)
    const second = coordinator.ensure('workspace-a\0session-a', start)
    await startEntered.promise
    expect(starts).toBe(1)

    allowStart.resolve()
    const [firstHandle, secondHandle] = await Promise.all([first, second])
    expect(firstHandle).toBe(secondHandle)
    expect(coordinator.current('workspace-a\0session-a')).toBe(firstHandle)
    expect(stopRuntime).not.toHaveBeenCalled()
    await coordinator.dispose()
  })

  it('keeps different session lifecycle lanes concurrent', async () => {
    const firstStarted = deferred()
    const releaseFirst = deferred()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime: () => undefined })

    const first = coordinator.ensure('session-a', async () => {
      firstStarted.resolve()
      await releaseFirst.promise
      return { id: 'runtime-a' }
    })
    await firstStarted.promise
    await expect(coordinator.ensure('session-b', async () => ({ id: 'runtime-b' })))
      .resolves.toMatchObject({ runtime: { id: 'runtime-b' } })

    releaseFirst.resolve()
    await first
    await coordinator.dispose()
  })

  it('holds the lifecycle lane through retirement cleanup', async () => {
    const cleanupEntered = deferred()
    const allowCleanup = deferred()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime: () => undefined })
    let recordExists = true
    let restarts = 0
    await coordinator.ensure('session-a', async () => ({ id: 'runtime-a' }))

    const deletion = coordinator.retireAndRun('session-a', async () => {
      cleanupEntered.resolve()
      await allowCleanup.promise
      recordExists = false
    })
    await cleanupEntered.promise
    const reopening = coordinator.ensure('session-a', async () => {
      restarts += 1
      if (!recordExists) throw new Error('session was deleted')
      return { id: 'runtime-restarted' }
    })

    allowCleanup.resolve()
    await deletion
    await expect(reopening).rejects.toThrow('session was deleted')
    expect(restarts).toBe(1)
    expect(coordinator.current('session-a')).toBeNull()
    await coordinator.dispose()
  })

  it('keeps a runtime current when pre-retirement provider work fails', async () => {
    const stopRuntime = vi.fn()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime })
    const handle = await coordinator.ensure('session-a', async () => ({ id: 'runtime-a' }))

    await expect(coordinator.runAndRetire('session-a', async (current) => {
      expect(current).toBe(handle)
      throw new Error('provider cleanup failed')
    })).rejects.toThrow('provider cleanup failed')

    expect(coordinator.current('session-a')).toBe(handle)
    expect(stopRuntime).not.toHaveBeenCalled()
    await coordinator.dispose()
  })

  it('prevents later users from entering before pre-retirement work completes', async () => {
    const cleanupEntered = deferred()
    const allowCleanup = deferred()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime: () => undefined })
    await coordinator.ensure('session-a', async () => ({ id: 'runtime-a' }))

    const retirement = coordinator.runAndRetire('session-a', async () => {
      cleanupEntered.resolve()
      await allowCleanup.promise
    })
    await cleanupEntered.promise
    let restarted = false
    const laterUse = coordinator.use(
      'session-a',
      async () => {
        restarted = true
        return { id: 'runtime-b' }
      },
      ({ runtime }) => runtime.id,
    )
    await Promise.resolve()
    expect(restarted).toBe(false)

    allowCleanup.resolve()
    await retirement
    await expect(laterUse).resolves.toBe('runtime-b')
    await coordinator.dispose()
  })

  it('invalidates an externally terminated generation without waiting for initialization', async () => {
    const startEntered = deferred()
    const allowStart = deferred()
    const stopRuntime = vi.fn()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime })
    let startingLease!: SessionRuntimeLease
    const starting = coordinator.ensure('session-a', async (lease) => {
      startingLease = lease
      startEntered.resolve()
      await allowStart.promise
      return { id: 'runtime-a' }
    }).then(
      () => null,
      (error: unknown) => error,
    )
    await startEntered.promise

    await coordinator.invalidateWhere((key) => key === 'session-a')
    expect(startingLease.isCurrent()).toBe(false)
    allowStart.resolve()
    await expect(starting).resolves.toMatchObject({
      message: expect.stringContaining('invalidated during initialization'),
    })
    expect(stopRuntime).toHaveBeenCalledWith({ id: 'runtime-a' })
    await coordinator.dispose()
  })

  it('drops queued and newly arriving events from a retired generation', async () => {
    const firstEventEntered = deferred()
    const allowFirstEvent = deferred()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime: () => undefined })
    const oldHandle = await coordinator.ensure('session-a', async () => ({ id: 'old' }))
    const applied: string[] = []

    oldHandle.lease.enqueue(async () => {
      firstEventEntered.resolve()
      await allowFirstEvent.promise
      if (oldHandle.lease.isCurrent()) applied.push('first')
    })
    oldHandle.lease.enqueue(() => {
      applied.push('queued')
    })
    await firstEventEntered.promise

    await coordinator.retire('session-a')
    const nextHandle = await coordinator.ensure('session-a', async () => ({ id: 'new' }))
    oldHandle.lease.enqueue(() => {
      applied.push('late-old')
    })
    nextHandle.lease.enqueue(() => {
      applied.push('new')
    })
    allowFirstEvent.resolve()
    await Promise.all([oldHandle.lease.drain(), nextHandle.lease.drain()])

    expect(applied).toEqual(['new'])
    await coordinator.dispose()
  })

  it('ignores a retired lease without waiting for a replacement that is still starting', async () => {
    const replacementStarted = deferred()
    const allowReplacement = deferred()
    const stopRuntime = vi.fn()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime })
    const retiredHandle = await coordinator.ensure('session-a', async () => ({ id: 'retired' }))

    await coordinator.retire('session-a')
    const replacement = coordinator.ensure('session-a', async () => {
      replacementStarted.resolve()
      await allowReplacement.promise
      return { id: 'replacement' }
    })
    await replacementStarted.promise

    await expect(coordinator.retireLease(retiredHandle.lease)).resolves.toBeNull()
    allowReplacement.resolve()

    await expect(replacement).resolves.toMatchObject({ runtime: { id: 'replacement' } })
    expect(coordinator.current('session-a')?.runtime).toEqual({ id: 'replacement' })
    expect(stopRuntime).toHaveBeenCalledTimes(1)
    expect(stopRuntime).toHaveBeenCalledWith({ id: 'retired' })
    await coordinator.dispose()
  })

  it('reports event failures without poisoning the ordered lane', async () => {
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime: () => undefined })
    const handle = await coordinator.ensure('session-a', async () => ({ id: 'runtime-a' }))
    const failures: string[] = []
    const applied: string[] = []

    handle.lease.enqueue(() => {
      throw new Error('first event failed')
    }, (error) => failures.push(error.message))
    handle.lease.enqueue(() => {
      applied.push('second')
    })
    await handle.lease.drain()

    expect(failures).toEqual(['first event failed'])
    expect(applied).toEqual(['second'])
    await coordinator.dispose()
  })

  it('retires every matching session before reporting cleanup failures', async () => {
    const stopped: string[] = []
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({
      stopRuntime: ({ id }) => {
        stopped.push(id)
        if (id === 'runtime-a') throw new Error('A could not stop')
      },
    })
    await coordinator.ensure('workspace\0session-a', async () => ({ id: 'runtime-a' }))
    await coordinator.ensure('workspace\0session-b', async () => ({ id: 'runtime-b' }))
    await coordinator.ensure('other\0session-c', async () => ({ id: 'runtime-c' }))

    await expect(coordinator.retireWhere((key) => key.startsWith('workspace\0')))
      .rejects.toThrow('One or more session runtimes could not be retired')
    expect(stopped).toEqual(expect.arrayContaining(['runtime-a', 'runtime-b']))
    expect(coordinator.current('workspace\0session-a')).toBeNull()
    expect(coordinator.current('workspace\0session-b')).toBeNull()
    expect(coordinator.current('other\0session-c')).not.toBeNull()
    await coordinator.dispose()
  })

  it('waits for a start invalidated by disposal and stops its late runtime', async () => {
    const startEntered = deferred()
    const allowStart = deferred()
    const stopRuntime = vi.fn()
    const coordinator = new SessionRuntimeCoordinator<{ id: string }>({ stopRuntime })
    let lease: SessionRuntimeLease | null = null
    const starting = coordinator.ensure('session-a', async (nextLease) => {
      lease = nextLease
      startEntered.resolve()
      await allowStart.promise
      return { id: 'late-runtime' }
    })
    await startEntered.promise

    const disposal = coordinator.dispose()
    expect(lease?.isCurrent()).toBe(false)
    allowStart.resolve()

    await expect(starting).rejects.toThrow('invalidated during initialization')
    await disposal
    expect(stopRuntime).toHaveBeenCalledOnce()
    expect(stopRuntime).toHaveBeenCalledWith({ id: 'late-runtime' })
  })
})

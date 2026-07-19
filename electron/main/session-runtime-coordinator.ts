type MaybePromise<T> = T | Promise<T>

type EventDrainWaiter = () => void

type RuntimeEntry<TRuntime> = {
  current: SessionRuntimeHandle<TRuntime> | null
  eventDrainWaiters: Set<EventDrainWaiter>
  eventPending: number
  eventTail: Promise<void>
  generation: number
  key: string
  lifecyclePending: number
  lifecycleTail: Promise<void>
  startingGeneration: number | null
}

export type SessionRuntimeLease = {
  readonly generation: number
  readonly key: string
  drain: () => Promise<void>
  /**
   * Preserves event arrival order and checks the generation before execution.
   * Operations that await external work must call `isCurrent()` again before
   * committing a side effect because lifecycle retirement remains concurrent.
   */
  enqueue: (
    operation: () => MaybePromise<void>,
    onError?: (error: Error) => void,
  ) => void
  isCurrent: () => boolean
}

export type SessionRuntimeHandle<TRuntime> = {
  lease: SessionRuntimeLease
  runtime: TRuntime
}

export type SessionRuntimeCoordinatorOptions<TRuntime> = {
  stopRuntime: (runtime: TRuntime) => MaybePromise<void>
}

/**
 * Coordinates runtime ownership without imposing a shared provider protocol.
 *
 * Lifecycle operations are serialized per session key while different keys
 * remain concurrent. Every started runtime receives a generation-bound lease;
 * callbacks from retired runtimes can therefore be ignored deterministically.
 * Native provider events use a separate ordered lane so they do not hold the
 * lifecycle lock, and `drain()` gives tests a precise quiescence milestone.
 */
export class SessionRuntimeCoordinator<TRuntime> {
  private disposed = false
  private disposePromise: Promise<void> | null = null
  private readonly entries = new Map<string, RuntimeEntry<TRuntime>>()

  constructor(private readonly options: SessionRuntimeCoordinatorOptions<TRuntime>) {}

  current(key: string) {
    return this.entries.get(key)?.current ?? null
  }

  keys() {
    return [...this.entries.keys()]
  }

  async ensure(
    key: string,
    startRuntime: (lease: SessionRuntimeLease) => Promise<TRuntime>,
  ): Promise<SessionRuntimeHandle<TRuntime>> {
    this.assertUsable()
    const entry = this.getOrCreateEntry(key)
    if (entry.lifecyclePending === 0 && entry.current) return entry.current
    return this.runLifecycle(entry, () => this.ensureInsideLifecycle(key, entry, startRuntime))
  }

  /**
   * Runs an operation while holding this key's lifecycle lane. The operation
   * must not recursively call `ensure`, `use`, or `retire*` for the same key.
   * Provider event work belongs in the lease's independent event lane.
   */
  async use<TResult>(
    key: string,
    startRuntime: (lease: SessionRuntimeLease) => Promise<TRuntime>,
    operation: (handle: SessionRuntimeHandle<TRuntime>) => MaybePromise<TResult>,
  ): Promise<TResult> {
    this.assertUsable()
    const entry = this.getOrCreateEntry(key)
    return this.runLifecycle(entry, async () => {
      const handle = await this.ensureInsideLifecycle(key, entry, startRuntime)
      return operation(handle)
    })
  }

  async retire(key: string) {
    return this.retireAndRun(key, () => undefined)
  }

  /** Keeps provider cleanup in the same critical section as retirement. */
  async retireAndRun<TResult>(
    key: string,
    operation: (retired: SessionRuntimeHandle<TRuntime> | null) => MaybePromise<TResult>,
  ): Promise<TResult> {
    this.assertUsable()
    const entry = this.getOrCreateEntry(key)
    return this.runLifecycle(entry, async () => {
      const retired = this.invalidateCurrent(entry)
      if (retired) await this.options.stopRuntime(retired.runtime)
      return operation(retired)
    })
  }

  async retireLease(lease: SessionRuntimeLease) {
    const entry = this.entries.get(lease.key)
    if (!entry || this.disposed || !lease.isCurrent()) return null
    return this.runLifecycle(entry, async () => {
      if (!this.isLeaseCurrent(entry, lease)) return null
      const retired = this.invalidateCurrent(entry)
      if (retired) await this.options.stopRuntime(retired.runtime)
      return retired
    })
  }

  async retireWhere(predicate: (key: string) => boolean) {
    this.assertUsable()
    const keys = this.keys().filter(predicate)
    const results = await Promise.allSettled(keys.map((key) => this.retire(key)))
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length > 0) {
      throw new AggregateError(failures, 'One or more session runtimes could not be retired.')
    }
  }

  drain(key: string) {
    const entry = this.entries.get(key)
    if (!entry || entry.eventPending === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      entry.eventDrainWaiters.add(resolve)
    })
  }

  dispose() {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    const entries = [...this.entries.values()]
    const retired = entries.flatMap((entry) => {
      const handle = this.invalidateCurrent(entry)
      return handle ? [handle] : []
    })
    const stops = retired.map((handle) => {
      try {
        return Promise.resolve(this.options.stopRuntime(handle.runtime))
      } catch (error) {
        return Promise.reject(error)
      }
    })
    this.disposePromise = Promise.allSettled([
      ...stops,
      ...entries.map((entry) => entry.lifecycleTail),
      ...entries.map((entry) => this.drainEntry(entry)),
    ]).then(() => {
      this.entries.clear()
    })
    return this.disposePromise
  }

  private async ensureInsideLifecycle(
    key: string,
    entry: RuntimeEntry<TRuntime>,
    startRuntime: (lease: SessionRuntimeLease) => Promise<TRuntime>,
  ) {
    this.assertUsable()
    if (entry.current) return entry.current

    entry.generation += 1
    entry.startingGeneration = entry.generation
    const lease = this.createLease(key, entry, entry.generation)
    let runtime: TRuntime
    try {
      runtime = await startRuntime(lease)
    } catch (error) {
      this.invalidateStartingLease(entry, lease)
      throw error
    }

    if (!this.isLeaseCurrent(entry, lease)) {
      await this.options.stopRuntime(runtime)
      throw new Error(`Session runtime "${key}" was invalidated during initialization.`)
    }

    const handle = { lease, runtime }
    entry.startingGeneration = null
    entry.current = handle
    return handle
  }

  private createLease(
    key: string,
    entry: RuntimeEntry<TRuntime>,
    generation: number,
  ): SessionRuntimeLease {
    let lease: SessionRuntimeLease
    lease = {
      generation,
      key,
      drain: () => this.drainEntry(entry),
      enqueue: (operation, onError) => this.enqueueEvent(entry, lease, operation, onError),
      isCurrent: () => this.isLeaseCurrent(entry, lease),
    }
    return lease
  }

  private enqueueEvent(
    entry: RuntimeEntry<TRuntime>,
    lease: SessionRuntimeLease,
    operation: () => MaybePromise<void>,
    onError?: (error: Error) => void,
  ) {
    if (!this.isLeaseCurrent(entry, lease)) return
    entry.eventPending += 1
    const execution = entry.eventTail.then(async () => {
      if (!this.isLeaseCurrent(entry, lease)) return
      await operation()
    })
    entry.eventTail = execution
      .catch((error) => {
        if (!onError || !this.isLeaseCurrent(entry, lease)) return
        try {
          onError(error instanceof Error ? error : new Error(String(error)))
        } catch {
          // Reporting an adapter error must not poison the ordered event lane.
        }
      })
      .then(() => {
        entry.eventPending -= 1
        if (entry.eventPending === 0) {
          for (const resolve of entry.eventDrainWaiters) resolve()
          entry.eventDrainWaiters.clear()
        }
        this.cleanupEntry(entry)
      })
  }

  private runLifecycle<TResult>(
    entry: RuntimeEntry<TRuntime>,
    operation: () => MaybePromise<TResult>,
  ): Promise<TResult> {
    entry.lifecyclePending += 1
    const execution = entry.lifecycleTail.then(operation)
    const settled = execution.then(
      (result) => {
        this.finishLifecycle(entry)
        return result
      },
      (error) => {
        this.finishLifecycle(entry)
        throw error
      },
    )
    entry.lifecycleTail = settled.then(() => undefined, () => undefined)
    return settled
  }

  private finishLifecycle(entry: RuntimeEntry<TRuntime>) {
    entry.lifecyclePending -= 1
    this.cleanupEntry(entry)
  }

  private invalidateCurrent(entry: RuntimeEntry<TRuntime>) {
    const current = entry.current
    entry.current = null
    entry.startingGeneration = null
    entry.generation += 1
    return current
  }

  private invalidateStartingLease(entry: RuntimeEntry<TRuntime>, lease: SessionRuntimeLease) {
    if (!this.isLeaseCurrent(entry, lease)) return
    entry.startingGeneration = null
    entry.generation += 1
  }

  private isLeaseCurrent(entry: RuntimeEntry<TRuntime>, lease: SessionRuntimeLease) {
    if (
      this.disposed
      || entry.key !== lease.key
      || this.entries.get(entry.key) !== entry
      || entry.generation !== lease.generation
    ) {
      return false
    }
    return entry.startingGeneration === lease.generation || entry.current?.lease === lease
  }

  private drainEntry(entry: RuntimeEntry<TRuntime>) {
    if (entry.eventPending === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      entry.eventDrainWaiters.add(resolve)
    })
  }

  private getOrCreateEntry(key: string) {
    const existing = this.entries.get(key)
    if (existing) return existing
    const entry: RuntimeEntry<TRuntime> = {
      current: null,
      eventDrainWaiters: new Set(),
      eventPending: 0,
      eventTail: Promise.resolve(),
      generation: 0,
      key,
      lifecyclePending: 0,
      lifecycleTail: Promise.resolve(),
      startingGeneration: null,
    }
    this.entries.set(key, entry)
    return entry
  }

  private cleanupEntry(entry: RuntimeEntry<TRuntime>) {
    if (
      entry.current
      || entry.startingGeneration !== null
      || entry.lifecyclePending > 0
      || entry.eventPending > 0
    ) return
    if (this.entries.get(entry.key) === entry) this.entries.delete(entry.key)
  }

  private assertUsable() {
    if (this.disposed) throw new Error('Session runtime coordinator has been disposed.')
  }
}

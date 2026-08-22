export type WorkspaceNavigationIntent = Readonly<{
  revision: number
  target: string
}>

export type WorkspaceNavigationEffectResult<T> = {
  status: 'completed'
  value: T
} | {
  status: 'superseded'
  value?: T
}

/**
 * Owns renderer workspace navigation ordering.
 *
 * The visible target is committed by the caller before background effects run.
 * Effects are serialized so process-global resources such as the workspace
 * watcher cannot finish out of order, and every effect receives a guard that
 * prevents stale work from publishing renderer state.
 */
export class WorkspaceNavigationCoordinator {
  private effectQueue: Promise<void> = Promise.resolve()
  private revision = 0

  begin(target: string): WorkspaceNavigationIntent {
    this.revision += 1
    return { revision: this.revision, target }
  }

  isCurrent(intent: WorkspaceNavigationIntent) {
    return intent.revision === this.revision
  }

  guard(intent: WorkspaceNavigationIntent) {
    return () => this.isCurrent(intent)
  }

  private enqueue<T>(
    execute: () => Promise<WorkspaceNavigationEffectResult<T>>,
  ): Promise<WorkspaceNavigationEffectResult<T>> {
    const result = this.effectQueue.then(execute, execute)
    this.effectQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  run<T>(
    intent: WorkspaceNavigationIntent,
    effect: (isCurrent: () => boolean) => Promise<T>,
  ): Promise<WorkspaceNavigationEffectResult<T>> {
    const execute = async (): Promise<WorkspaceNavigationEffectResult<T>> => {
      if (!this.isCurrent(intent)) {
        return { status: 'superseded' }
      }

      const value = await effect(this.guard(intent))
      return this.isCurrent(intent)
        ? { status: 'completed', value }
        : { status: 'superseded', value }
    }
    return this.enqueue(execute)
  }

  /**
   * Serializes a durable operation without cancelling it when navigation moves
   * on. The operation must still use the supplied guard before publishing any
   * target-specific renderer state.
   */
  runDurable<T>(
    intent: WorkspaceNavigationIntent,
    effect: (isCurrent: () => boolean) => Promise<T>,
  ): Promise<WorkspaceNavigationEffectResult<T>> {
    const execute = async (): Promise<WorkspaceNavigationEffectResult<T>> => {
      const value = await effect(this.guard(intent))
      return this.isCurrent(intent)
        ? { status: 'completed', value }
        : { status: 'superseded', value }
    }
    return this.enqueue(execute)
  }
}

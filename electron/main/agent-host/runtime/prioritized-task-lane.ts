type MaybePromise<T> = T | Promise<T>

export type TaskPriority = 'control' | 'user'

type QueuedTask = {
  operation: () => MaybePromise<unknown>
  reject: (error: unknown) => void
  resolve: (value: unknown) => void
}

const MAX_CONSECUTIVE_CONTROL_TASKS = 8

/**
 * A small in-process admission lane.
 *
 * Control work (stop/delete/release) may pass already queued user work, but it
 * never preempts an operation that is currently executing. A bounded control
 * burst prevents a stream of cleanup requests from starving normal work.
 */
export class PrioritizedTaskLane {
  private consecutiveControlTasks = 0
  private readonly drainWaiters = new Set<() => void>()
  private readonly queues: Record<TaskPriority, QueuedTask[]> = {
    control: [],
    user: [],
  }
  private running = false
  private taskCount = 0

  get pending() {
    return this.taskCount
  }

  enqueue<TResult>(
    priority: TaskPriority,
    operation: () => MaybePromise<TResult>,
  ): Promise<TResult> {
    this.taskCount += 1
    const result = new Promise<TResult>((resolve, reject) => {
      this.queues[priority].push({
        operation,
        reject,
        resolve: (value) => resolve(value as TResult),
      })
    })
    this.schedule()
    return result
  }

  drain() {
    if (this.taskCount === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.drainWaiters.add(resolve)
    })
  }

  private nextTask() {
    const canRunControl = this.queues.control.length > 0
      && (
        this.consecutiveControlTasks < MAX_CONSECUTIVE_CONTROL_TASKS
        || this.queues.user.length === 0
      )
    if (canRunControl) {
      this.consecutiveControlTasks += 1
      return this.queues.control.shift()
    }

    const userTask = this.queues.user.shift()
    if (userTask) {
      this.consecutiveControlTasks = 0
      return userTask
    }

    const controlTask = this.queues.control.shift()
    if (controlTask) this.consecutiveControlTasks += 1
    return controlTask
  }

  private schedule() {
    if (this.running) return
    const task = this.nextTask()
    if (!task) {
      this.notifyDrained()
      return
    }

    this.running = true
    queueMicrotask(() => {
      void this.execute(task)
    })
  }

  private async execute(task: QueuedTask) {
    try {
      task.resolve(await task.operation())
    } catch (error) {
      task.reject(error)
    } finally {
      this.taskCount -= 1
      this.running = false
      this.schedule()
    }
  }

  private notifyDrained() {
    if (this.taskCount !== 0) return
    for (const resolve of this.drainWaiters) resolve()
    this.drainWaiters.clear()
  }
}

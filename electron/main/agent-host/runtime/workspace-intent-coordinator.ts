export type WorkspaceActivation = {
  identity: string
  previousActiveId: string | null
  revision: number
}

export type WorkspaceOperation = {
  identity: string
  revision: number
}

type WorkspaceActivationState = {
  revision: number
  targetId?: string | null
}

type WorkspaceIntentCoordinatorOptions = {
  canOperate?: (identity: string) => boolean
  reuseActivationForSameTarget?: boolean
}

/**
 * Preserves latest-user-intent semantics around asynchronous workspace work.
 *
 * Activation revisions protect foreground selection, while operation revisions
 * invalidate all outstanding work during release/discard. Provider managers
 * retain their native session lifecycle; this coordinator only owns the small,
 * duplicated concurrency protocol around workspace intent.
 */
export class WorkspaceIntentCoordinator {
  private readonly activations = new Map<string, WorkspaceActivationState>()
  private readonly activeIds = new Map<string, string>()
  private readonly operationRevisions = new Map<string, number>()

  constructor(private readonly options: WorkspaceIntentCoordinatorOptions = {}) {}

  active(identity: string) {
    return this.activeIds.get(identity) ?? null
  }

  setActive(identity: string, activeId: string | null) {
    if (activeId) this.activeIds.set(identity, activeId)
    else this.activeIds.delete(identity)
  }

  replaceActive(identity: string, expectedId: string, nextId: string | null) {
    if (this.active(identity) !== expectedId) return false
    this.setActive(identity, nextId)
    return true
  }

  beginActivation(
    identity: string,
    targetId?: string | null,
  ): WorkspaceActivation {
    const current = this.activations.get(identity)
    const reuseCurrent = this.options.reuseActivationForSameTarget === true
      && targetId !== undefined
      && current !== undefined
      && current.targetId === targetId
    const revision = reuseCurrent ? current.revision : (current?.revision ?? 0) + 1
    if (!reuseCurrent) this.activations.set(identity, { revision, targetId })
    return {
      identity,
      previousActiveId: this.active(identity),
      revision,
    }
  }

  setActivationTarget(activation: WorkspaceActivation, targetId: string | null) {
    if (!this.isActivationCurrent(activation)) return false
    this.activations.set(activation.identity, {
      revision: activation.revision,
      targetId,
    })
    return true
  }

  commitActivation(activation: WorkspaceActivation, activeId: string | null) {
    if (!this.isActivationCurrent(activation)) return false
    this.setActive(activation.identity, activeId)
    return true
  }

  rollbackActivation(activation: WorkspaceActivation, committedId: string) {
    if (
      !this.isActivationCurrent(activation)
      || this.active(activation.identity) !== committedId
    ) return false
    this.setActive(activation.identity, activation.previousActiveId)
    return true
  }

  isActivationCurrent(activation: WorkspaceActivation) {
    return this.activations.get(activation.identity)?.revision === activation.revision
  }

  invalidateActivation(identity: string) {
    this.activations.set(identity, {
      revision: (this.activations.get(identity)?.revision ?? 0) + 1,
    })
  }

  invalidateActivationForTarget(identity: string, targetId: string) {
    const activation = this.activations.get(identity)
    if (activation?.targetId !== targetId && this.active(identity) !== targetId) return false
    this.invalidateActivation(identity)
    return true
  }

  captureOperation(identity: string): WorkspaceOperation {
    return {
      identity,
      revision: this.operationRevision(identity),
    }
  }

  operationRevision(identity: string) {
    return this.operationRevisions.get(identity) ?? 0
  }

  isOperationCurrent(operation: WorkspaceOperation) {
    return (this.options.canOperate?.(operation.identity) ?? true)
      && this.operationRevision(operation.identity) === operation.revision
  }

  requireOperationCurrent(operation: WorkspaceOperation, message: string) {
    if (!this.isOperationCurrent(operation)) throw new Error(message)
  }

  invalidateOperations(identity: string) {
    this.operationRevisions.set(identity, this.operationRevision(identity) + 1)
  }

  clear() {
    this.activations.clear()
    this.activeIds.clear()
    this.operationRevisions.clear()
  }
}

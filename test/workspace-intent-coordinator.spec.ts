import { describe, expect, it } from 'vitest'
import {
  WorkspaceIntentCoordinator,
} from '../electron/main/agent-host/runtime/workspace-intent-coordinator'

describe('WorkspaceIntentCoordinator', () => {
  it('lets only the newest activation commit foreground selection', () => {
    const coordinator = new WorkspaceIntentCoordinator()
    const older = coordinator.beginActivation('workspace')
    const newer = coordinator.beginActivation('workspace')

    expect(coordinator.commitActivation(older, 'session-a')).toBe(false)
    expect(coordinator.commitActivation(newer, 'session-b')).toBe(true)
    expect(coordinator.active('workspace')).toBe('session-b')
  })

  it('can reuse concurrent activation intent for the same explicit target', () => {
    const coordinator = new WorkspaceIntentCoordinator({
      reuseActivationForSameTarget: true,
    })
    const first = coordinator.beginActivation('workspace', 'session-a')
    const second = coordinator.beginActivation('workspace', 'session-a')

    expect(second.revision).toBe(first.revision)
    expect(coordinator.commitActivation(first, 'session-a')).toBe(true)
    expect(coordinator.commitActivation(second, 'session-a')).toBe(true)
  })

  it('rolls a failed activation back only while it still owns the committed target', () => {
    const coordinator = new WorkspaceIntentCoordinator({
      reuseActivationForSameTarget: true,
    })
    coordinator.setActive('workspace', 'previous')
    const activation = coordinator.beginActivation('workspace', 'created')
    coordinator.commitActivation(activation, 'created')

    expect(coordinator.rollbackActivation(activation, 'created')).toBe(true)
    expect(coordinator.active('workspace')).toBe('previous')

    coordinator.commitActivation(activation, 'created')
    coordinator.setActive('workspace', 'newer')
    expect(coordinator.rollbackActivation(activation, 'created')).toBe(false)
    expect(coordinator.active('workspace')).toBe('newer')
  })

  it('invalidates operations independently from activation selection', () => {
    let available = true
    const coordinator = new WorkspaceIntentCoordinator({
      canOperate: () => available,
    })
    const operation = coordinator.captureOperation('workspace')
    const activation = coordinator.beginActivation('workspace', 'session-a')

    coordinator.invalidateOperations('workspace')
    expect(coordinator.isOperationCurrent(operation)).toBe(false)
    expect(coordinator.isActivationCurrent(activation)).toBe(true)

    const nextOperation = coordinator.captureOperation('workspace')
    available = false
    expect(() => coordinator.requireOperationCurrent(nextOperation, 'superseded'))
      .toThrow('superseded')
  })

  it('invalidates a selection only when the target is pending or active', () => {
    const coordinator = new WorkspaceIntentCoordinator()
    const activation = coordinator.beginActivation('workspace', 'session-a')

    expect(coordinator.invalidateActivationForTarget('workspace', 'session-b')).toBe(false)
    expect(coordinator.isActivationCurrent(activation)).toBe(true)
    expect(coordinator.invalidateActivationForTarget('workspace', 'session-a')).toBe(true)
    expect(coordinator.isActivationCurrent(activation)).toBe(false)
  })
})

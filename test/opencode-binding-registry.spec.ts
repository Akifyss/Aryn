import type { Session } from '@opencode-ai/sdk/v2'
import { describe, expect, it } from 'vitest'
import { OpenCodeBindingRegistry } from '../electron/main/agent-host/providers/opencode/binding-registry'
import type { SessionRuntimeLease } from '../electron/main/agent-host/runtime/session-runtime-coordinator'

function createLease(key: string) {
  let current = true
  return {
    invalidate: () => { current = false },
    lease: {
      generation: 1,
      isCurrent: () => current,
      key,
    } as SessionRuntimeLease,
  }
}

function session(id: string, parentID?: string): Session {
  return {
    id,
    parentID,
    title: id,
  } as Session
}

describe('OpenCodeBindingRegistry', () => {
  it('owns current binding identity and transitive session hierarchy', () => {
    const registry = new OpenCodeBindingRegistry()
    const rootLease = createLease('workspace\0root')
    const childLease = createLease('workspace\0child')
    const grandchildLease = createLease('workspace\0grandchild')
    const root = registry.create('C:/workspace', session('root'), rootLease.lease)
    const child = registry.create(
      'C:/workspace',
      session('child', 'root'),
      childLease.lease,
      undefined,
      'root',
      rootLease.lease,
      rootLease.lease,
    )
    const grandchild = registry.create(
      'C:/workspace',
      session('grandchild', 'child'),
      grandchildLease.lease,
      undefined,
      'root',
      rootLease.lease,
      childLease.lease,
    )
    registry.install(root)
    registry.install(child)
    registry.install(grandchild)

    expect(registry.current('C:/workspace', 'root')).toBe(root)
    expect(registry.find('child', 'c:/WORKSPACE')).toBe(child)
    expect(registry.descendants('C:/workspace', 'root')).toEqual([child, grandchild])

    rootLease.invalidate()
    expect(registry.current('C:/workspace', 'root')).toBeNull()
    expect(registry.find('child', 'C:/workspace')).toBeNull()
    expect(registry.remove(root)).toBe(true)
    expect(registry.remove(root)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { shouldRunAgentModelCascaderDelayedActivation } from '../src/features/agent/lib/model-cascader-pointer-intent'

describe('agent model cascader pointer intent', () => {
  it('keeps a delayed hover pending while the latest pointer is still inside the safe triangle', () => {
    expect(shouldRunAgentModelCascaderDelayedActivation(
      { x: 10, y: 20 },
      'thinking',
      () => true,
    )).toBe(false)
  })

  it('runs a delayed hover once the pointer has left the safe triangle', () => {
    expect(shouldRunAgentModelCascaderDelayedActivation(
      { x: 10, y: 20 },
      'thinking',
      () => false,
    )).toBe(true)
  })

  it('runs a delayed hover when no pointer sample is available', () => {
    expect(shouldRunAgentModelCascaderDelayedActivation(
      null,
      'thinking',
      () => true,
    )).toBe(true)
  })
})

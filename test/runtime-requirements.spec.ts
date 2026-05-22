import { describe, expect, it } from 'vitest'
import { assertPiAgentRuntimeCompatible, isNodeVersionAtLeast } from '../electron/main/runtime-requirements'

describe('Electron runtime requirements', () => {
  it('accepts runtimes that satisfy the Pi agent Node requirement', () => {
    expect(isNodeVersionAtLeast('22.19.0')).toBe(true)
    expect(isNodeVersionAtLeast('22.20.0')).toBe(true)
    expect(isNodeVersionAtLeast('24.15.0')).toBe(true)
  })

  it('rejects runtimes older than the Pi agent Node requirement', () => {
    expect(isNodeVersionAtLeast('20.18.3')).toBe(false)
    expect(isNodeVersionAtLeast('22.18.0')).toBe(false)
  })

  it('reports an actionable startup error for unsupported Electron runtimes', () => {
    expect(() => assertPiAgentRuntimeCompatible('20.18.3')).toThrow(
      /requires Electron's embedded Node\.js runtime to be >= 22\.19\.0/,
    )
  })
})

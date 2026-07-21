import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { terminateChildProcessTree } from '../electron/main/child-process-lifecycle'

function createChildProcessStub(overrides: Partial<ChildProcess> = {}) {
  return {
    exitCode: null,
    kill: vi.fn(),
    pid: undefined,
    signalCode: null,
    ...overrides,
  } as unknown as ChildProcess
}

describe('child process lifecycle', () => {
  it('keeps exited children inert by default', () => {
    const child = createChildProcessStub({ exitCode: 0, pid: undefined })

    terminateChildProcessTree(child, { detachedProcessGroup: true, signal: 'SIGKILL' })

    expect(child.kill).not.toHaveBeenCalled()
  })

  it('forwards an explicit signal to a live direct child', () => {
    const child = createChildProcessStub()

    terminateChildProcessTree(child, { signal: 'SIGKILL' })

    expect(child.kill).toHaveBeenCalledOnce()
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceRefreshCoordinator,
  mergeWorkspaceRefreshRequests,
} from '../src/features/workspace/lib/workspace-refresh-coordinator'

afterEach(() => {
  vi.useRealTimers()
})

describe('workspace refresh coordinator', () => {
  it('merges requests for the same workspace conservatively', () => {
    expect(mergeWorkspaceRefreshRequests(
      {
        gitSilent: true,
        refreshGit: false,
        refreshTree: true,
        rootPath: '/workspace',
      },
      {
        gitSilent: false,
        refreshGit: true,
        refreshTree: false,
        rootPath: '/workspace',
      },
    )).toEqual({
      gitSilent: false,
      refreshGit: true,
      refreshTree: true,
      rootPath: '/workspace',
    })
  })

  it('coalesces debounced requests into a single flush', async () => {
    vi.useFakeTimers()
    const onFlush = vi.fn<Parameters<typeof createWorkspaceRefreshCoordinator>[0]['onFlush']>()
      .mockResolvedValue(undefined)
    const coordinator = createWorkspaceRefreshCoordinator({
      debounceMs: 120,
      onFlush,
    })

    const firstRequest = coordinator.request({
      refreshTree: true,
      rootPath: '/workspace',
    }, 'debounced')
    const secondRequest = coordinator.request({
      gitSilent: false,
      refreshGit: true,
      rootPath: '/workspace',
    }, 'debounced')

    await vi.advanceTimersByTimeAsync(119)
    expect(onFlush).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    await Promise.all([firstRequest, secondRequest])

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith({
      gitSilent: false,
      refreshGit: true,
      refreshTree: true,
      rootPath: '/workspace',
    })
  })

  it('drops a pending request when a different workspace supersedes it', async () => {
    vi.useFakeTimers()
    const onFlush = vi.fn<Parameters<typeof createWorkspaceRefreshCoordinator>[0]['onFlush']>()
      .mockResolvedValue(undefined)
    const coordinator = createWorkspaceRefreshCoordinator({
      debounceMs: 120,
      onFlush,
    })

    const supersededRequest = coordinator.request({
      refreshTree: true,
      rootPath: '/workspace-a',
    }, 'debounced')
    const nextRequest = coordinator.request({
      refreshGit: true,
      rootPath: '/workspace-b',
    }, 'debounced')

    await expect(supersededRequest).rejects.toMatchObject({
      name: 'WorkspaceRefreshCanceledError',
    })

    await vi.runAllTimersAsync()
    await nextRequest

    expect(onFlush).toHaveBeenCalledTimes(1)
    expect(onFlush).toHaveBeenCalledWith({
      gitSilent: true,
      refreshGit: true,
      refreshTree: false,
      rootPath: '/workspace-b',
    })
  })
})

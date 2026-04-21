import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ChokidarWatchEventName = 'add' | 'addDir' | 'change' | 'error' | 'unlink' | 'unlinkDir'

type FakeChokidarWatcher = {
  close: ReturnType<typeof vi.fn>
  emit: (event: ChokidarWatchEventName, payload: unknown) => void
  on: ReturnType<typeof vi.fn>
}

const chokidarWatchMock = vi.fn()

vi.mock('chokidar', () => ({
  default: {
    watch: chokidarWatchMock,
  },
}))

function createFakeChokidarWatcher(closeImplementation?: () => Promise<void>): FakeChokidarWatcher {
  const listeners = new Map<ChokidarWatchEventName, Array<(payload: unknown) => void>>()
  const watcher = {
    close: vi.fn(closeImplementation ?? (async () => {})),
    emit(event: ChokidarWatchEventName, payload: unknown) {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload)
      }
    },
    on: vi.fn((event: ChokidarWatchEventName, listener: (payload: unknown) => void) => {
      const nextListeners = listeners.get(event) ?? []
      nextListeners.push(listener)
      listeners.set(event, nextListeners)
      return watcher
    }),
  }

  return watcher
}

describe('workspace watcher lifecycle', () => {
  beforeEach(() => {
    chokidarWatchMock.mockReset()
  })

  afterEach(async () => {
    const workspace = await import('../electron/main/workspace')
    await workspace.unwatchWorkspace()
    vi.resetModules()
  })

  it('uses polling on platforms where native watcher limits can block workspace updates', async () => {
    const firstWorkspaceWatcher = createFakeChokidarWatcher()
    const firstGitIndexWatcher = createFakeChokidarWatcher()
    const secondWorkspaceWatcher = createFakeChokidarWatcher()
    const secondGitIndexWatcher = createFakeChokidarWatcher()
    const workspace = await import('../electron/main/workspace')

    chokidarWatchMock
      .mockReturnValueOnce(firstWorkspaceWatcher)
      .mockReturnValueOnce(firstGitIndexWatcher)
      .mockReturnValueOnce(secondWorkspaceWatcher)
      .mockReturnValueOnce(secondGitIndexWatcher)

    await workspace.watchWorkspace('/tmp/workspace-a', vi.fn())
    await workspace.watchWorkspace('/tmp/workspace-b', vi.fn())

    expect(chokidarWatchMock).toHaveBeenNthCalledWith(1, '/tmp/workspace-a', expect.objectContaining({
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(chokidarWatchMock).toHaveBeenNthCalledWith(2, '/tmp/workspace-a/.git/index', expect.objectContaining({
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(chokidarWatchMock).toHaveBeenNthCalledWith(3, '/tmp/workspace-b', expect.objectContaining({
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(chokidarWatchMock).toHaveBeenNthCalledWith(4, '/tmp/workspace-b/.git/index', expect.objectContaining({
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(firstWorkspaceWatcher.close).toHaveBeenCalledTimes(1)
    expect(firstGitIndexWatcher.close).toHaveBeenCalledTimes(1)
    expect(secondWorkspaceWatcher.close).not.toHaveBeenCalled()
    expect(secondGitIndexWatcher.close).not.toHaveBeenCalled()
  })

  it('ignores events emitted by a stale watcher after switching workspaces', async () => {
    const firstWorkspaceWatcher = createFakeChokidarWatcher()
    const firstGitIndexWatcher = createFakeChokidarWatcher()
    const secondWorkspaceWatcher = createFakeChokidarWatcher()
    const secondGitIndexWatcher = createFakeChokidarWatcher()
    const onChange = vi.fn()
    const workspace = await import('../electron/main/workspace')

    chokidarWatchMock
      .mockReturnValueOnce(firstWorkspaceWatcher)
      .mockReturnValueOnce(firstGitIndexWatcher)
      .mockReturnValueOnce(secondWorkspaceWatcher)
      .mockReturnValueOnce(secondGitIndexWatcher)

    await workspace.watchWorkspace('/tmp/workspace-a', onChange)
    await workspace.watchWorkspace('/tmp/workspace-b', onChange)

    firstWorkspaceWatcher.emit('change', '/tmp/workspace-a/notes-a.md')
    secondWorkspaceWatcher.emit('change', '/tmp/workspace-b/notes-b.md')
    secondGitIndexWatcher.emit('change', '/tmp/workspace-b/.git/index')
    await Promise.resolve()

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenNthCalledWith(1, {
      path: '/tmp/workspace-b/notes-b.md',
      rootPath: '/tmp/workspace-b',
      type: 'change',
    })
    expect(onChange).toHaveBeenNthCalledWith(2, {
      path: '/tmp/workspace-b/.git/index',
      rootPath: '/tmp/workspace-b',
      type: 'change',
    })
  })
})

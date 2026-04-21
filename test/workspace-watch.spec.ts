import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ChokidarWatchEventName = 'add' | 'addDir' | 'change' | 'error' | 'unlink' | 'unlinkDir'
type NativeWatchEventName = 'change' | 'rename'
type NativeWatcherEventName = 'error'

type FakeChokidarWatcher = {
  close: ReturnType<typeof vi.fn>
  emit: (event: ChokidarWatchEventName, payload: unknown) => void
  on: ReturnType<typeof vi.fn>
}

type FakeNativeWatcher = {
  close: ReturnType<typeof vi.fn>
  emitFsEvent: (event: NativeWatchEventName, payload: unknown) => void
  emitWatcherEvent: (event: NativeWatcherEventName, payload: unknown) => void
  on: ReturnType<typeof vi.fn>
}

const chokidarWatchMock = vi.fn()
const nativeWatchMock = vi.fn()

vi.mock('chokidar', () => ({
  default: {
    watch: chokidarWatchMock,
  },
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    watch: nativeWatchMock,
  }
})

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

function createFakeNativeWatcher(): FakeNativeWatcher {
  const watcherListeners = new Map<NativeWatcherEventName, Array<(payload: unknown) => void>>()
  let fsListener: ((event: NativeWatchEventName, payload: unknown) => void) | null = null
  const watcher = {
    close: vi.fn(),
    emitFsEvent(event: NativeWatchEventName, payload: unknown) {
      fsListener?.(event, payload)
    },
    emitWatcherEvent(event: NativeWatcherEventName, payload: unknown) {
      for (const listener of watcherListeners.get(event) ?? []) {
        listener(payload)
      }
    },
    on: vi.fn((event: NativeWatcherEventName, listener: (payload: unknown) => void) => {
      const nextListeners = watcherListeners.get(event) ?? []
      nextListeners.push(listener)
      watcherListeners.set(event, nextListeners)
      return watcher
    }),
  }

  nativeWatchMock.mockImplementationOnce((_path, _options, listener) => {
    fsListener = listener
    return watcher
  })

  return watcher
}

describe('workspace watcher lifecycle', () => {
  beforeEach(() => {
    chokidarWatchMock.mockReset()
    nativeWatchMock.mockReset()
  })

  afterEach(async () => {
    const workspace = await import('../electron/main/workspace')
    await workspace.unwatchWorkspace()
    vi.resetModules()
  })

  it('uses the native recursive watcher on platforms that support it', async () => {
    const firstWatcher = createFakeNativeWatcher()
    const secondWatcher = createFakeNativeWatcher()
    const workspace = await import('../electron/main/workspace')

    await workspace.watchWorkspace('/tmp/workspace-a', vi.fn())
    await workspace.watchWorkspace('/tmp/workspace-b', vi.fn())

    expect(nativeWatchMock).toHaveBeenNthCalledWith(1, '/tmp/workspace-a', { recursive: true }, expect.any(Function))
    expect(nativeWatchMock).toHaveBeenNthCalledWith(2, '/tmp/workspace-b', { recursive: true }, expect.any(Function))
    expect(firstWatcher.close).toHaveBeenCalledTimes(1)
    expect(chokidarWatchMock).not.toHaveBeenCalled()
    expect(secondWatcher.close).not.toHaveBeenCalled()
  })

  it('ignores events emitted by a stale watcher after switching workspaces', async () => {
    const firstWatcher = createFakeNativeWatcher()
    const secondWatcher = createFakeNativeWatcher()
    const onChange = vi.fn()
    const workspace = await import('../electron/main/workspace')

    await workspace.watchWorkspace('/tmp/workspace-a', onChange)
    await workspace.watchWorkspace('/tmp/workspace-b', onChange)

    firstWatcher.emitFsEvent('change', 'notes-a.md')
    secondWatcher.emitFsEvent('change', 'notes-b.md')
    await Promise.resolve()

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({
      path: '/tmp/workspace-b/notes-b.md',
      rootPath: '/tmp/workspace-b',
      type: 'change',
    })
  })
})

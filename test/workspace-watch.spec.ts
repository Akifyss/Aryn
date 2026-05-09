import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ChokidarWatchEventName = 'add' | 'addDir' | 'change' | 'error' | 'unlink' | 'unlinkDir'

type FakeChokidarWatcher = {
  close: ReturnType<typeof vi.fn>
  emit: (event: ChokidarWatchEventName, payload: unknown) => void
  on: ReturnType<typeof vi.fn>
}

const chokidarWatchMock = vi.fn()
const tempRoots: string[] = []

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

async function createTempWorkspace() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'workspace-watch-'))
  tempRoots.push(rootPath)
  return rootPath
}

describe('workspace watcher lifecycle', () => {
  beforeEach(() => {
    chokidarWatchMock.mockReset()
  })

  afterEach(async () => {
    const workspace = await import('../electron/main/workspace')
    await workspace.unwatchWorkspace()
    vi.resetModules()
    await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
  })

  it('uses polling on platforms where native watcher limits can block workspace updates', async () => {
    const firstWorkspaceWatcher = createFakeChokidarWatcher()
    const firstGitBoundaryWatcher = createFakeChokidarWatcher()
    const secondWorkspaceWatcher = createFakeChokidarWatcher()
    const secondGitBoundaryWatcher = createFakeChokidarWatcher()
    const workspace = await import('../electron/main/workspace')

    chokidarWatchMock
      .mockReturnValueOnce(firstWorkspaceWatcher)
      .mockReturnValueOnce(firstGitBoundaryWatcher)
      .mockReturnValueOnce(secondWorkspaceWatcher)
      .mockReturnValueOnce(secondGitBoundaryWatcher)

    await workspace.watchWorkspace('/tmp/workspace-a', vi.fn())
    await workspace.watchWorkspace('/tmp/workspace-b', vi.fn())

    expect(chokidarWatchMock).toHaveBeenNthCalledWith(1, '/tmp/workspace-a', expect.objectContaining({
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(chokidarWatchMock).toHaveBeenNthCalledWith(2, path.join('/tmp/workspace-a', '.git'), expect.objectContaining({
      depth: 0,
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(chokidarWatchMock).toHaveBeenNthCalledWith(3, '/tmp/workspace-b', expect.objectContaining({
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(chokidarWatchMock).toHaveBeenNthCalledWith(4, path.join('/tmp/workspace-b', '.git'), expect.objectContaining({
      depth: 0,
      ignoreInitial: true,
      interval: 500,
      usePolling: process.platform === 'darwin' || process.platform === 'win32',
    }))
    expect(firstWorkspaceWatcher.close).toHaveBeenCalledTimes(1)
    expect(firstGitBoundaryWatcher.close).toHaveBeenCalledTimes(1)
    expect(secondWorkspaceWatcher.close).not.toHaveBeenCalled()
    expect(secondGitBoundaryWatcher.close).not.toHaveBeenCalled()
  })

  it('ignores events emitted by a stale watcher after switching workspaces', async () => {
    const firstWorkspaceWatcher = createFakeChokidarWatcher()
    const firstGitBoundaryWatcher = createFakeChokidarWatcher()
    const secondWorkspaceWatcher = createFakeChokidarWatcher()
    const secondGitBoundaryWatcher = createFakeChokidarWatcher()
    const onChange = vi.fn()
    const workspace = await import('../electron/main/workspace')

    chokidarWatchMock
      .mockReturnValueOnce(firstWorkspaceWatcher)
      .mockReturnValueOnce(firstGitBoundaryWatcher)
      .mockReturnValueOnce(secondWorkspaceWatcher)
      .mockReturnValueOnce(secondGitBoundaryWatcher)

    await workspace.watchWorkspace('/tmp/workspace-a', onChange)
    await workspace.watchWorkspace('/tmp/workspace-b', onChange)

    firstWorkspaceWatcher.emit('change', '/tmp/workspace-a/notes-a.md')
    secondWorkspaceWatcher.emit('change', '/tmp/workspace-b/notes-b.md')
    secondGitBoundaryWatcher.emit('change', '/tmp/workspace-b/.git')
    await Promise.resolve()

    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenNthCalledWith(1, {
      path: '/tmp/workspace-b/notes-b.md',
      rootPath: '/tmp/workspace-b',
      type: 'change',
    })
    expect(onChange).toHaveBeenNthCalledWith(2, {
      path: path.join('/tmp/workspace-b', '.git', 'index'),
      rootPath: '/tmp/workspace-b',
      type: 'change',
    })
  })

  it('keeps the app alive when a watcher emits a non-ignorable error', async () => {
    const workspaceWatcher = createFakeChokidarWatcher()
    const gitBoundaryWatcher = createFakeChokidarWatcher()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const workspace = await import('../electron/main/workspace')

    chokidarWatchMock
      .mockReturnValueOnce(workspaceWatcher)
      .mockReturnValueOnce(gitBoundaryWatcher)

    try {
      await workspace.watchWorkspace('/tmp/workspace-a', vi.fn())

      expect(() => {
        workspaceWatcher.emit('error', new Error('watch failed'))
      }).not.toThrow()
      expect(warnSpy).toHaveBeenCalledWith('Workspace watcher error:', expect.any(Error))
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('watches resolved git metadata paths without watching the whole git directory', async () => {
    const rootPath = await createTempWorkspace()
    const gitDirPath = path.join(rootPath, '.git')
    const workspaceWatcher = createFakeChokidarWatcher()
    const gitBoundaryWatcher = createFakeChokidarWatcher()
    const gitMetadataWatcher = createFakeChokidarWatcher()
    const onChange = vi.fn()
    const workspace = await import('../electron/main/workspace')

    await mkdir(path.join(gitDirPath, 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(gitDirPath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')

    chokidarWatchMock
      .mockReturnValueOnce(workspaceWatcher)
      .mockReturnValueOnce(gitBoundaryWatcher)
      .mockReturnValueOnce(gitMetadataWatcher)

    await workspace.watchWorkspace(rootPath, onChange)
    await vi.waitFor(() => {
      expect(chokidarWatchMock).toHaveBeenCalledTimes(3)
    })

    expect(chokidarWatchMock).toHaveBeenNthCalledWith(2, path.join(rootPath, '.git'), expect.objectContaining({
      depth: 0,
    }))
    expect(chokidarWatchMock).toHaveBeenNthCalledWith(3, expect.arrayContaining([
      path.join(gitDirPath, 'index'),
      path.join(gitDirPath, 'HEAD'),
      path.join(gitDirPath, 'refs'),
      path.join(gitDirPath, 'packed-refs'),
    ]), expect.objectContaining({
      ignoreInitial: true,
      interval: 500,
    }))

    gitMetadataWatcher.emit('change', path.join(gitDirPath, 'refs', 'heads', 'main'))
    await Promise.resolve()

    expect(onChange).toHaveBeenCalledWith({
      path: path.join(rootPath, '.git', 'index'),
      rootPath,
      type: 'change',
    })
  })

  it('reconfigures git metadata watching when a repository is created after opening', async () => {
    const rootPath = await createTempWorkspace()
    const gitDirPath = path.join(rootPath, '.git')
    const workspaceWatcher = createFakeChokidarWatcher()
    const gitBoundaryWatcher = createFakeChokidarWatcher()
    const gitMetadataWatcher = createFakeChokidarWatcher()
    const onChange = vi.fn()
    const workspace = await import('../electron/main/workspace')

    chokidarWatchMock
      .mockReturnValueOnce(workspaceWatcher)
      .mockReturnValueOnce(gitBoundaryWatcher)
      .mockReturnValueOnce(gitMetadataWatcher)

    await workspace.watchWorkspace(rootPath, onChange)
    expect(chokidarWatchMock).toHaveBeenCalledTimes(2)

    await mkdir(path.join(gitDirPath, 'refs', 'heads'), { recursive: true })
    await writeFile(path.join(gitDirPath, 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    gitBoundaryWatcher.emit('addDir', gitDirPath)
    await vi.waitFor(() => {
      expect(chokidarWatchMock).toHaveBeenCalledTimes(3)
    })

    expect(chokidarWatchMock).toHaveBeenNthCalledWith(3, expect.arrayContaining([
      path.join(gitDirPath, 'index'),
      path.join(gitDirPath, 'HEAD'),
      path.join(gitDirPath, 'refs'),
      path.join(gitDirPath, 'packed-refs'),
    ]), expect.anything())
    expect(onChange).toHaveBeenCalledWith({
      path: path.join(rootPath, '.git', 'index'),
      rootPath,
      type: 'change',
    })
  })
})

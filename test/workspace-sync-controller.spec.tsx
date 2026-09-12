import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { GitChangeItem, GitFileDiffResult } from '../src/features/git/types'
import { useWorkspaceSyncController } from '../src/features/workspace/hooks/use-workspace-sync-controller'
import { createDiffTab } from '../src/features/workspace/lib/workspace-tabs'
import {
  useWorkspaceStore,
  type WorkspaceFileTab,
} from '../src/features/workspace/store/use-workspace-store'
import type { WorkspaceNode } from '../src/features/workspace/types'

type WorkspaceSyncController = ReturnType<typeof useWorkspaceSyncController>

function ControllerProbe({
  currentPath,
  onController,
}: {
  currentPath: string | null
  onController: (controller: WorkspaceSyncController) => void
}) {
  onController(useWorkspaceSyncController(currentPath))
  return null
}

function renderController(currentPath: string | null) {
  let controller: WorkspaceSyncController | null = null
  renderToStaticMarkup(
    <ControllerProbe
      currentPath={currentPath}
      onController={(nextController) => {
        controller = nextController
      }}
    />,
  )

  if (!controller) {
    throw new Error('Workspace sync controller did not render.')
  }

  return controller
}

function stubWorkspaceApi() {
  const appApi = {
    getGitFileDiff: vi.fn(),
    loadWorkspaceDirectory: vi.fn(),
    loadWorkspaceTree: vi.fn(),
    readWorkspaceFile: vi.fn(),
  }
  vi.stubGlobal('window', { appApi })
  return appApi
}

const change: GitChangeItem = {
  kind: 'modified',
  originalPath: null,
  path: 'C:\\workspace\\notes.md',
  relativePath: 'notes.md',
  scope: 'unstaged',
  statusCode: ' M',
}

function createDiff(modifiedContent = 'updated content'): GitFileDiffResult {
  return {
    change,
    editorKind: 'prose',
    modifiedContent,
    modifiedExists: true,
    modifiedLabel: 'Working tree',
    originalContent: 'saved content',
    originalExists: true,
    originalLabel: 'Revision',
    repositoryRootPath: 'C:\\workspace',
    selections: [],
    source: { kind: 'working-tree' },
  }
}

function createFileTab(): WorkspaceFileTab {
  return {
    content: 'local content',
    editorKind: 'prose',
    exists: true,
    filePath: change.path,
    id: 'file://meo/notes',
    isDirty: true,
    kind: 'file',
    savedContent: 'saved content',
    viewMode: 'meo',
  }
}

afterEach(() => {
  useWorkspaceStore.setState({
    activeTabId: null,
    currentPath: null,
    openTabs: [],
    tree: [],
  })
  vi.unstubAllGlobals()
})

describe('useWorkspaceSyncController', () => {
  it('loads explicitly requested root nodes and hydrates descendants on demand', async () => {
    const appApi = stubWorkspaceApi()
    const rootTree: WorkspaceNode[] = [{
      hasChildren: true,
      kind: 'directory',
      name: 'src',
      path: 'C:\\workspace\\src',
    }]
    const recursiveTree: WorkspaceNode[] = [{
      children: [{
        kind: 'file',
        name: 'App.tsx',
        path: 'C:\\workspace\\src\\App.tsx',
      }],
      kind: 'directory',
      name: 'src',
      path: 'C:\\workspace\\src',
    }]
    appApi.loadWorkspaceDirectory.mockResolvedValue(rootTree)
    appApi.loadWorkspaceTree.mockResolvedValue(recursiveTree)
    const controller = renderController('C:\\workspace')

    await controller.loadTree('C:\\workspace', { scope: 'root' })
    expect(appApi.loadWorkspaceDirectory).toHaveBeenCalledWith('C:\\workspace')
    expect(appApi.loadWorkspaceTree).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().tree).toEqual(rootTree)

    await controller.ensureFullyLoadedWorkspaceTree('c:/workspace')
    await controller.ensureFullyLoadedWorkspaceTree('C:\\workspace')
    expect(appApi.loadWorkspaceTree).toHaveBeenCalledOnce()
    expect(useWorkspaceStore.getState().tree).toEqual(recursiveTree)

    await controller.reloadActiveWorkspaceTree('C:\\workspace', { scope: 'root' })
    expect(appApi.loadWorkspaceDirectory).toHaveBeenCalledTimes(2)
    expect(useWorkspaceStore.getState().tree).toEqual(rootTree)
  })

  it('loads the complete workspace by default', async () => {
    const appApi = stubWorkspaceApi()
    const rootTree: WorkspaceNode[] = [{
      hasChildren: true,
      kind: 'directory',
      name: 'src',
      path: 'C:\\workspace\\src',
    }]
    const recursiveTree: WorkspaceNode[] = [{
      children: [{
        kind: 'file',
        name: 'App.tsx',
        path: 'C:\\workspace\\src\\App.tsx',
      }],
      kind: 'directory',
      name: 'src',
      path: 'C:\\workspace\\src',
    }]
    appApi.loadWorkspaceDirectory.mockResolvedValue(rootTree)
    appApi.loadWorkspaceTree.mockResolvedValue(recursiveTree)
    const controller = renderController('C:\\workspace')

    await controller.loadTree('C:\\workspace')

    expect(appApi.loadWorkspaceDirectory).not.toHaveBeenCalled()
    expect(appApi.loadWorkspaceTree).toHaveBeenCalledOnce()
    expect(useWorkspaceStore.getState().tree).toEqual(recursiveTree)
  })

  it('deduplicates concurrent recursive workspace tree loads', async () => {
    const appApi = stubWorkspaceApi()
    const recursiveTree: WorkspaceNode[] = [{
      kind: 'file',
      name: 'App.tsx',
      path: 'C:\\workspace\\App.tsx',
    }]
    let resolveTree: ((tree: WorkspaceNode[]) => void) | null = null
    appApi.loadWorkspaceTree.mockImplementation(() => new Promise<WorkspaceNode[]>((resolve) => {
      resolveTree = resolve
    }))
    const controller = renderController('C:\\workspace')

    const firstLoad = controller.ensureFullyLoadedWorkspaceTree('C:\\workspace')
    const secondLoad = controller.ensureFullyLoadedWorkspaceTree('c:/workspace')
    expect(appApi.loadWorkspaceTree).toHaveBeenCalledOnce()

    resolveTree?.(recursiveTree)
    await Promise.all([firstLoad, secondLoad])
    expect(useWorkspaceStore.getState().tree).toEqual(recursiveTree)
  })

  it('publishes tree results only for the active workspace when requested', async () => {
    const appApi = stubWorkspaceApi()
    const initialTree: WorkspaceNode[] = [{
      kind: 'file',
      name: 'initial.md',
      path: 'C:\\workspace\\initial.md',
    }]
    const loadedTree: WorkspaceNode[] = [{
      kind: 'file',
      name: 'loaded.md',
      path: 'C:\\workspace\\loaded.md',
    }]
    useWorkspaceStore.setState({ tree: initialTree })
    let resolveTreeLoad: ((tree: WorkspaceNode[]) => void) | null = null
    appApi.loadWorkspaceTree.mockImplementation(() => (
      new Promise<WorkspaceNode[]>((resolve) => {
        resolveTreeLoad = resolve
      })
    ))
    const controller = renderController('C:\\workspace')

    const staleLoad = controller.reloadActiveWorkspaceTree('C:\\workspace')
    controller.currentPathRef.current = 'C:\\other-workspace'
    resolveTreeLoad?.(loadedTree)
    await staleLoad
    expect(useWorkspaceStore.getState().tree).toEqual(initialTree)

    controller.currentPathRef.current = 'C:\\workspace'
    appApi.loadWorkspaceTree.mockResolvedValue(loadedTree)
    await controller.reloadActiveWorkspaceTree('c:/workspace')
    expect(useWorkspaceStore.getState().tree).toEqual(loadedTree)
  })

  it('refreshes working-tree diff tabs and preserves dirty tabs on refresh failure', async () => {
    const appApi = stubWorkspaceApi()
    const diffTab = createDiffTab(createDiff('first version'))
    useWorkspaceStore.setState({
      activeTabId: diffTab.id,
      openTabs: [diffTab],
    })
    appApi.getGitFileDiff.mockResolvedValue(createDiff('second version'))
    const controller = renderController('C:\\workspace')

    await controller.syncOpenDiffTabs('c:/workspace')
    const refreshedTab = useWorkspaceStore.getState().openTabs[0]
    expect(refreshedTab?.kind).toBe('diff')
    expect(refreshedTab?.kind === 'diff' && refreshedTab.diff.modifiedContent).toBe('second version')

    useWorkspaceStore.getState().updateDiffTabDraft(diffTab.id, 'local draft')
    appApi.getGitFileDiff.mockRejectedValue(new Error('refresh failed'))
    await controller.syncOpenDiffTabs('C:\\workspace')
    expect(useWorkspaceStore.getState().openTabs).toHaveLength(1)

    useWorkspaceStore.getState().updateDiffTabDraft(diffTab.id, null)
    await controller.syncOpenDiffTabs('C:\\workspace')
    expect(useWorkspaceStore.getState().openTabs).toEqual([])
  })

  it('does not refresh or close another project\'s retained diff tabs', async () => {
    const appApi = stubWorkspaceApi()
    const current = createDiffTab(createDiff())
    const other = createDiffTab({ ...createDiff(), repositoryRootPath: 'D:/other',
      change: { ...change, path: 'D:/other/notes.md' } })
    useWorkspaceStore.setState({ openTabs: [current, other], activeTabId: current.id })
    appApi.getGitFileDiff.mockRejectedValue(new Error('No longer changed'))
    await renderController('C:/workspace').syncOpenDiffTabs('C:/workspace')
    expect(appApi.getGitFileDiff).toHaveBeenCalledTimes(1)
    expect(useWorkspaceStore.getState().openTabs).toEqual([other])
  })

  it('refreshes from the owning repository when the project is a subdirectory', async () => {
    const appApi = stubWorkspaceApi()
    const tab = createDiffTab(createDiff())
    useWorkspaceStore.setState({ openTabs: [tab], activeTabId: tab.id })
    appApi.getGitFileDiff.mockResolvedValue(createDiff('refreshed'))
    await renderController('c:/workspace/subdir').syncOpenDiffTabs('c:/workspace/subdir')
    expect(appApi.getGitFileDiff).toHaveBeenCalledWith(tab.diff.repositoryRootPath, change.path, change.scope)
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({ diff: { modifiedContent: 'refreshed' } })
  })

  it('uses live tab state when a diff refresh settles', async () => {
    const appApi = stubWorkspaceApi()
    const diffTab = createDiffTab(createDiff('first version'))
    useWorkspaceStore.setState({
      activeTabId: diffTab.id,
      openTabs: [diffTab],
    })
    let rejectRefresh: ((error: Error) => void) | null = null
    appApi.getGitFileDiff.mockImplementation(() => (
      new Promise<GitFileDiffResult>((_resolve, reject) => {
        rejectRefresh = reject
      })
    ))
    const controller = renderController('C:\\workspace')

    const failedRefresh = controller.syncOpenDiffTabs('C:\\workspace')
    useWorkspaceStore.getState().updateDiffTabDraft(diffTab.id, 'draft created during refresh')
    rejectRefresh?.(new Error('refresh failed'))
    await failedRefresh
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      draftContent: 'draft created during refresh',
      id: diffTab.id,
      isDirty: true,
    })

    let resolveRefresh: ((diff: GitFileDiffResult) => void) | null = null
    appApi.getGitFileDiff.mockImplementation(() => (
      new Promise<GitFileDiffResult>((resolve) => {
        resolveRefresh = resolve
      })
    ))
    useWorkspaceStore.getState().updateDiffTabDraft(diffTab.id, null)
    const closedTabRefresh = controller.syncOpenDiffTabs('C:\\workspace')
    useWorkspaceStore.getState().closeTab(diffTab.id)
    resolveRefresh?.(createDiff('second version'))
    await closedTabRefresh
    expect(useWorkspaceStore.getState().openTabs).toEqual([])
  })

  it('ignores an older diff refresh that settles after a newer request', async () => {
    const appApi = stubWorkspaceApi()
    const diffTab = createDiffTab(createDiff('first version'))
    useWorkspaceStore.setState({
      activeTabId: diffTab.id,
      openTabs: [diffTab],
    })
    let resolveOlderRefresh: ((diff: GitFileDiffResult) => void) | null = null
    appApi.getGitFileDiff
      .mockImplementationOnce(() => (
        new Promise<GitFileDiffResult>((resolve) => {
          resolveOlderRefresh = resolve
        })
      ))
      .mockResolvedValueOnce(createDiff('newest version'))
    const controller = renderController('C:\\workspace')

    const olderRefresh = controller.syncOpenDiffTabs('C:\\workspace')
    await controller.syncOpenDiffTabs('C:\\workspace')
    resolveOlderRefresh?.(createDiff('stale version'))
    await olderRefresh

    const refreshedTab = useWorkspaceStore.getState().openTabs[0]
    expect(refreshedTab?.kind === 'diff' && refreshedTab.diff.modifiedContent).toBe('newest version')
  })

  it('syncs discarded files from disk and closes their tabs when the file is gone', async () => {
    const appApi = stubWorkspaceApi()
    const fileTab = createFileTab()
    useWorkspaceStore.setState({
      activeTabId: fileTab.id,
      openTabs: [fileTab],
    })
    appApi.readWorkspaceFile.mockResolvedValue('disk content')
    const controller = renderController('C:\\workspace')

    await controller.reconcileWorkspaceFileAfterGitDiscard('c:/workspace', fileTab.filePath)
    const syncedTab = useWorkspaceStore.getState().openTabs[0]
    expect(syncedTab?.kind === 'file' && syncedTab.content).toBe('disk content')
    expect(syncedTab?.isDirty).toBe(false)

    appApi.readWorkspaceFile.mockRejectedValue(new Error('file missing'))
    await controller.reconcileWorkspaceFileAfterGitDiscard('C:\\workspace', fileTab.filePath)
    expect(useWorkspaceStore.getState().openTabs).toEqual([])
  })
})

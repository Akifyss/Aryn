import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useWorkspaceDocumentNavigation } from '../src/features/workspace/hooks/use-workspace-document-navigation'
import { useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'
import { captureDuoDocumentTarget, createDuoDocumentNavigation } from '../src/features/duo/duo-document-navigation'
import { createDuoPane, DUO_FILES_ID, useDuoStore } from '../src/features/duo/duo-state'
import type { GitChangeItem, GitRepositoryState } from '../src/features/git/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function createNavigation() {
  let navigation!: ReturnType<typeof useWorkspaceDocumentNavigation>
  function Probe() {
    navigation = useWorkspaceDocumentNavigation({
      captureDocumentTarget: captureDuoDocumentTarget,
      captureActiveMeoViewPosition: vi.fn(), closeLeftDrawer: vi.fn(), closeRightDrawer: vi.fn(),
      currentPath: '/workspace', displayActiveTabId: null, displayTabs: [], expandAgentEditorSurface: vi.fn(),
      flushWorkspaceAutosave: async () => true, isActiveEditorComposing: false,
      isLeftSidebarDrawer: false, isRightSidebarDrawer: false,
      setActiveAgentLayoutFixedTab: vi.fn(), setIsAgentLayoutFixedTabActive: vi.fn(), setStatusMessage: vi.fn(),
    })
    return null
  }
  renderToStaticMarkup(<Probe />)
  return navigation
}

beforeEach(() => {
  useWorkspaceStore.setState({ currentPath: '/workspace', openTabs: [], activeTabId: null })
  useDuoStore.setState({ panes: { left: createDuoPane(), right: createDuoPane() }, focusedPane: 'left' })
})
afterEach(() => vi.unstubAllGlobals())

describe('Duo document loading integration', () => {
  it.each(['activate', 'open-panel', 'move', 'close', 'reselect'])('cancels a pending read after %s changes the pane navigation', async action => {
    const read = deferred<string>()
    const readWorkspaceFile = vi.fn(() => read.promise)
    vi.stubGlobal('window', { appApi: {
      resolveWorkspaceEditorKind: async () => 'prose', readWorkspaceFile, updateWorkspaceState: async () => {},
    } })
    const store = useDuoStore.getState()
    store.open('left', { kind: 'document', id: 'existing' })
    store.open('left', { kind: 'panel', id: DUO_FILES_ID })
    const opening = createNavigation().openFile('/workspace/slow.md')
    await vi.waitFor(() => expect(readWorkspaceFile).toHaveBeenCalled())
    if (action === 'activate' || action === 'reselect') store.activate('left', 'existing')
    if (action === 'reselect') store.activate('left', DUO_FILES_ID)
    if (action === 'open-panel') store.open('left', { kind: 'panel', id: DUO_FILES_ID })
    if (action === 'move') store.moveTab('left', DUO_FILES_ID)
    if (action === 'close') store.close('left', DUO_FILES_ID)
    const activeTabId = useDuoStore.getState().panes.left.activeTabId
    read.resolve('Late result')
    await opening
    expect(useWorkspaceStore.getState().openTabs).toEqual([])
    expect(useDuoStore.getState().panes.left.activeTabId).toBe(activeTabId)
  })

  it.each(['left', 'right'] as const)('opens files in their %s source pane even if focus moved before the callback', async (pane) => {
    vi.stubGlobal('window', { appApi: {
      resolveWorkspaceEditorKind: async () => 'prose',
      readWorkspaceFile: async () => 'File content',
      updateWorkspaceState: async () => {},
    } })
    const navigation = createDuoDocumentNavigation(pane, createNavigation(), '/workspace', vi.fn())
    const other = pane === 'left' ? 'right' : 'left'
    useDuoStore.getState().focus(other)
    await navigation.openFile('/workspace/a.md')
    expect(useDuoStore.getState().panes[pane].activeTabId).toContain('a.md')
    expect(useDuoStore.getState().panes[other].tabs).toEqual([])
    expect(useDuoStore.getState().focusedPane).toBe(other)

    // An existing shared document also gets a reference in its invoking pane.
    const peer = createDuoDocumentNavigation(other, createNavigation(), '/workspace', vi.fn())
    useDuoStore.getState().focus(pane)
    await peer.openFile('/workspace/a.md')
    expect(useDuoStore.getState().panes[other].activeTabId).toBe(useDuoStore.getState().panes[pane].activeTabId)
    expect(useWorkspaceStore.getState().openTabs).toHaveLength(1)
  })

  it('captures the pane and request before refreshing Git, and rejects superseded refreshes', async () => {
    const change: GitChangeItem = { path: '/workspace/a.md', relativePath: 'a.md', scope: 'unstaged', kind: 'modified', originalPath: null, statusCode: 'M' }
    const repository: GitRepositoryState = {
      isRepository: true, workspacePath: '/workspace', repositoryRootPath: '/workspace',
      unstagedChanges: [change], stagedChanges: [], recentlyPulledChanges: [],
      ahead: 0, behind: 0, branch: 'main', hasCommits: true, hasChanges: true,
      hasRemote: false, remoteCount: 0, unpushedCommits: 0,
    }
    const first = deferred<GitRepositoryState>()
    const second = deferred<GitRepositoryState>()
    const refresh = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const openGitDiff = vi.fn()
    const navigation = createDuoDocumentNavigation('left', { ...createNavigation(), openGitDiff }, '/workspace', refresh)
    const stale = navigation.openFileDiff(change.path)
    const latest = navigation.openFileDiff(change.path)
    useDuoStore.getState().focus('right')
    second.resolve(repository)
    await latest
    expect(openGitDiff).toHaveBeenCalledTimes(1)
    const target = openGitDiff.mock.calls[0][2]
    target('diff-result')
    expect(useDuoStore.getState().panes.left.activeTabId).toBe('diff-result')
    expect(useDuoStore.getState().panes.right.tabs).toEqual([])
    first.resolve(repository)
    await stale
    expect(openGitDiff).toHaveBeenCalledTimes(1)
  })

  it('rejects stale file reads before mutating the shared document store', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    vi.stubGlobal('window', { appApi: {
      resolveWorkspaceEditorKind: async () => 'prose',
      readWorkspaceFile: (path: string) => path.endsWith('a.md') ? first.promise : second.promise,
      updateWorkspaceState: async () => {},
    } })
    const navigation = createNavigation()
    const firstOpen = navigation.openFile('/workspace/a.md')
    const secondOpen = navigation.openFile('/workspace/b.md')
    second.resolve('B')
    await secondOpen
    first.resolve('A')
    await firstOpen
    expect(useWorkspaceStore.getState().openTabs.map((tab) => tab.filePath)).toEqual(['/workspace/b.md'])
    expect(useDuoStore.getState().panes.left.tabs).toHaveLength(1)
  })

  it('keeps concurrent reads in their original panes', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    vi.stubGlobal('window', { appApi: {
      resolveWorkspaceEditorKind: async () => 'prose',
      readWorkspaceFile: (path: string) => path.endsWith('a.md') ? first.promise : second.promise,
      updateWorkspaceState: async () => {},
    } })
    const navigation = createNavigation()
    const firstOpen = navigation.openFile('/workspace/a.md')
    useDuoStore.getState().focus('right')
    const secondOpen = navigation.openFile('/workspace/b.md')
    second.resolve('B')
    await secondOpen
    first.resolve('A')
    await firstOpen
    const state = useDuoStore.getState()
    expect(state.panes.left.tabs[0].id).toContain('a.md')
    expect(state.panes.right.tabs[0].id).toContain('b.md')
    expect(state.focusedPane).toBe('right')
    expect(useWorkspaceStore.getState().activeTabId).toBe(state.panes.right.activeTabId)
  })

  it('does not insert a stale document after the workspace changes during I/O', async () => {
    const read = deferred<string>()
    const readWorkspaceFile = vi.fn(() => read.promise)
    vi.stubGlobal('window', { appApi: {
      resolveWorkspaceEditorKind: async () => 'prose', readWorkspaceFile, updateWorkspaceState: async () => {},
    } })
    const opening = createNavigation().openFile('/workspace/a.md')
    await vi.waitFor(() => expect(readWorkspaceFile).toHaveBeenCalled())
    useWorkspaceStore.getState().setCurrentPath('/other')
    read.resolve('A')
    await opening
    expect(useWorkspaceStore.getState().openTabs).toHaveLength(0)
  })
})

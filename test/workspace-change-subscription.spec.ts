import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleWorkspaceChangeEvent } from '../src/features/workspace/lib/workspace-change-handler'
import {
  createWorkspaceFileTabId,
  useWorkspaceStore,
  type WorkspaceFileTab,
} from '../src/features/workspace/store/use-workspace-store'

const workspacePath = 'C:/workspace'
const filePath = 'C:/workspace/readme.md'

function createFileTab(
  viewMode: WorkspaceFileTab['viewMode'],
  overrides: Partial<WorkspaceFileTab> = {},
): WorkspaceFileTab {
  return {
    content: '# Readme',
    editorKind: 'prose',
    exists: true,
    filePath,
    id: createWorkspaceFileTabId(filePath, viewMode),
    isDirty: false,
    kind: 'file',
    savedContent: '# Readme',
    viewMode,
    ...overrides,
  }
}

describe('workspace change subscription', () => {
  const readWorkspaceFile = vi.fn(() => Promise.resolve('# Updated'))
  const updateWorkspaceState = vi.fn(() => Promise.resolve({ ok: true }))
  const requestWorkspaceRefresh = vi.fn(() => Promise.resolve())
  const consumeInternalWorkspaceSave = vi.fn(() => false)
  const setStatusMessage = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('window', {
      appApi: {
        readWorkspaceFile,
        updateWorkspaceState,
      },
    })
    useWorkspaceStore.setState({
      activeTabId: null,
      currentPath: workspacePath,
      openTabs: [],
      tree: [],
    })
    readWorkspaceFile.mockClear()
    updateWorkspaceState.mockClear()
    requestWorkspaceRefresh.mockClear()
    consumeInternalWorkspaceSave.mockClear()
    setStatusMessage.mockClear()
  })

  afterEach(() => {
    useWorkspaceStore.setState({
      activeTabId: null,
      currentPath: null,
      openTabs: [],
      tree: [],
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function handleChange(type: 'add' | 'change' | 'unlink' = 'change') {
    return handleWorkspaceChangeEvent({
      path: filePath,
      rootPath: workspacePath,
      type,
    }, {
      consumeInternalWorkspaceSave,
      currentPath: workspacePath,
      requestWorkspaceRefresh,
      setStatusMessage,
    })
  }

  it('ignores watcher events emitted by an internal save', async () => {
    consumeInternalWorkspaceSave.mockReturnValueOnce(true)
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({ activeTabId: codeTab.id, openTabs: [codeTab] })

    await handleChange()

    expect(requestWorkspaceRefresh).not.toHaveBeenCalled()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(setStatusMessage).not.toHaveBeenCalled()
  })

  it('ignores an old subscription after the store has switched workspaces', async () => {
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({
      activeTabId: codeTab.id,
      currentPath: 'C:/another-workspace',
      openTabs: [codeTab],
    })

    await handleChange()

    expect(consumeInternalWorkspaceSave).not.toHaveBeenCalled()
    expect(requestWorkspaceRefresh).not.toHaveBeenCalled()
    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(setStatusMessage).not.toHaveBeenCalled()
  })

  it('refreshes Git without reloading the tree for Git index events', async () => {
    await handleWorkspaceChangeEvent({
      path: 'C:/workspace/.git/index',
      rootPath: workspacePath,
      type: 'change',
    }, {
      consumeInternalWorkspaceSave,
      currentPath: workspacePath,
      requestWorkspaceRefresh,
      setStatusMessage,
    })

    expect(requestWorkspaceRefresh).toHaveBeenCalledWith({
      refreshGit: true,
      refreshTree: false,
      rootPath: workspacePath,
    }, 'debounced')
  })

  it('keeps unsaved content when any view of the changed file is dirty', async () => {
    const previewTab = createFileTab('file')
    const dirtyCodeTab = createFileTab('code', {
      content: '# Local edit',
      isDirty: true,
    })
    useWorkspaceStore.setState({
      activeTabId: previewTab.id,
      openTabs: [previewTab, dirtyCodeTab],
    })

    await handleChange()

    expect(readWorkspaceFile).not.toHaveBeenCalled()
    expect(useWorkspaceStore.getState().openTabs).toEqual([previewTab, dirtyCodeTab])
    expect(setStatusMessage).toHaveBeenLastCalledWith('readme.md changed on disk. Kept your unsaved version.')
  })

  it('does not overwrite edits made while an external file read is pending', async () => {
    let resolveRead: ((content: string) => void) | null = null
    readWorkspaceFile.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveRead = resolve
    }))
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({ activeTabId: codeTab.id, openTabs: [codeTab] })

    const handlingChange = handleChange()
    await vi.waitFor(() => expect(readWorkspaceFile).toHaveBeenCalledWith(filePath))
    useWorkspaceStore.getState().updateFileTabsContent(filePath, '# Local edit')
    resolveRead?.('# External edit')
    await handlingChange

    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      content: '# Local edit',
      isDirty: true,
    })
    expect(setStatusMessage).toHaveBeenLastCalledWith('readme.md changed on disk. Kept your unsaved version.')
  })

  it('does not apply an external read superseded by a newer event for the same file', async () => {
    let isEventCurrent = true
    let resolveRead: ((content: string) => void) | null = null
    readWorkspaceFile.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveRead = resolve
    }))
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({ activeTabId: codeTab.id, openTabs: [codeTab] })

    const handlingChange = handleWorkspaceChangeEvent({
      path: filePath,
      rootPath: workspacePath,
      type: 'change',
    }, {
      consumeInternalWorkspaceSave,
      currentPath: workspacePath,
      isEventCurrent: () => isEventCurrent,
      requestWorkspaceRefresh,
      setStatusMessage,
    })
    await vi.waitFor(() => expect(readWorkspaceFile).toHaveBeenCalledWith(filePath))
    isEventCurrent = false
    resolveRead?.('# Stale external edit')
    await handlingChange

    expect(useWorkspaceStore.getState().openTabs).toEqual([codeTab])
    expect(setStatusMessage).not.toHaveBeenCalled()
  })

  it('does not apply a pending text read after only a file-surface tab remains', async () => {
    let resolveRead: ((content: string) => void) | null = null
    readWorkspaceFile.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveRead = resolve
    }))
    const previewTab = createFileTab('file', { content: '' })
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({
      activeTabId: codeTab.id,
      openTabs: [previewTab, codeTab],
    })

    const handlingChange = handleChange()
    await vi.waitFor(() => expect(readWorkspaceFile).toHaveBeenCalledWith(filePath))
    useWorkspaceStore.getState().closeTab(codeTab.id)
    resolveRead?.('# External edit')
    await handlingChange

    expect(useWorkspaceStore.getState().openTabs).toEqual([previewTab])
    expect(setStatusMessage).toHaveBeenLastCalledWith('readme.md changed on disk')
  })

  it('does not apply or announce a pending read after switching workspaces', async () => {
    let resolveRead: ((content: string) => void) | null = null
    readWorkspaceFile.mockImplementationOnce(() => new Promise<string>((resolve) => {
      resolveRead = resolve
    }))
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({ activeTabId: codeTab.id, openTabs: [codeTab] })

    const handlingChange = handleChange()
    await vi.waitFor(() => expect(readWorkspaceFile).toHaveBeenCalledWith(filePath))
    useWorkspaceStore.setState({ currentPath: 'C:/another-workspace' })
    resolveRead?.('# External edit')
    await handlingChange

    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      content: '# Readme',
      isDirty: false,
    })
    expect(setStatusMessage).not.toHaveBeenCalled()
  })

  it('closes every clean view after deletion and persists the next active file', async () => {
    const previewTab = createFileTab('preview')
    const codeTab = createFileTab('code')
    const remainingTab = createFileTab('meo', {
      filePath: 'C:/workspace/guide.md',
      id: createWorkspaceFileTabId('C:/workspace/guide.md', 'meo'),
    })
    useWorkspaceStore.setState({
      activeTabId: previewTab.id,
      openTabs: [previewTab, codeTab, remainingTab],
    })

    await handleChange('unlink')

    expect(useWorkspaceStore.getState().openTabs).toEqual([remainingTab])
    expect(updateWorkspaceState).toHaveBeenCalledWith(workspacePath, {
      lastFilePath: remainingTab.filePath,
    })
    expect(setStatusMessage).toHaveBeenLastCalledWith('readme.md was removed')
  })

  it('still completes deletion when active-file metadata cannot be persisted', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    updateWorkspaceState.mockRejectedValueOnce(new Error('write failed'))
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({ activeTabId: codeTab.id, openTabs: [codeTab] })

    await expect(handleChange('unlink')).resolves.toBeUndefined()

    expect(useWorkspaceStore.getState().openTabs).toEqual([])
    expect(setStatusMessage).toHaveBeenLastCalledWith('readme.md was removed')
    expect(consoleError).toHaveBeenCalledWith(
      '[workspace] Failed to persist the active file after an external deletion.',
      expect.any(Error),
    )
  })

  it('reports read failures without replacing the current tab content', async () => {
    readWorkspaceFile.mockRejectedValueOnce(new Error('read failed'))
    const codeTab = createFileTab('code')
    useWorkspaceStore.setState({ activeTabId: codeTab.id, openTabs: [codeTab] })

    await handleChange('add')

    expect(useWorkspaceStore.getState().openTabs).toEqual([codeTab])
    expect(setStatusMessage).toHaveBeenLastCalledWith('readme.md could not be reloaded')
  })
})

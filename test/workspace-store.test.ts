import { beforeEach, describe, expect, it } from 'vitest'
import {
  createWorkspaceFileTabId,
  reorderWorkspaceTabs,
  useWorkspaceStore,
} from '../src/features/workspace/store/use-workspace-store'

function createDiffTabId(filePath: string, scope: 'staged' | 'unstaged') {
  return `git-diff://${scope}/${encodeURIComponent(filePath)}`
}

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeTabId: null,
      currentPath: null,
      openTabs: [],
      tree: [],
    })
  })

  it('opens default rich-text tabs without duplicating them and activates the requested file', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: 'alpha',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/a.md',
    })
    store.openTab({
      content: 'beta',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/b.md',
    })
    store.openTab({
      content: 'ignored',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/a.md',
    })

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs).toHaveLength(2)
    expect(nextState.activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/a.md', 'meo'))
    expect(nextState.openTabs[0]).toMatchObject({
      content: 'alpha',
      kind: 'file',
      viewMode: 'meo',
    })
  })

  it('keeps html preview and code tabs as separate tabs', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: '<h1>Hello</h1>',
      editorKind: 'code',
      filePath: 'C:/workspace/index.html',
    })
    store.openTab({
      content: '<h1>Hello</h1>',
      editorKind: 'code',
      filePath: 'C:/workspace/index.html',
      viewMode: 'code',
    })

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs).toHaveLength(2)
    expect(nextState.openTabs.map((tab) => tab.id)).toEqual([
      createWorkspaceFileTabId('C:/workspace/index.html', 'preview'),
      createWorkspaceFileTabId('C:/workspace/index.html', 'code'),
    ])
    expect(nextState.activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/index.html', 'code'))
  })

  it('allows markdown tabs to open in both MEO and code views by default', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
    })
    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
      viewMode: 'code',
    })

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs).toHaveLength(2)
    expect(nextState.openTabs.map((tab) => tab.id)).toEqual([
      createWorkspaceFileTabId('C:/workspace/draft.md', 'meo'),
      createWorkspaceFileTabId('C:/workspace/draft.md', 'code'),
    ])
    expect(nextState.activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/draft.md', 'code'))
  })

  it('allows markdown tabs to open in both writing and MEO views', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
      viewMode: 'default',
    })
    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
      viewMode: 'meo',
    })

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs).toHaveLength(2)
    expect(nextState.openTabs.map((tab) => tab.id)).toEqual([
      createWorkspaceFileTabId('C:/workspace/draft.md', 'default'),
      createWorkspaceFileTabId('C:/workspace/draft.md', 'meo'),
    ])
    expect(nextState.activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/draft.md', 'meo'))
  })

  it('falls back to default mode when a preview tab is renamed to a non-html file', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: '<h1>Hello</h1>',
      editorKind: 'code',
      filePath: 'C:/workspace/index.html',
    })
    store.renameTab('C:/workspace/index.html', 'C:/workspace/index.ts')

    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      editorKind: 'code',
      filePath: 'C:/workspace/index.ts',
      viewMode: 'default',
    })
  })

  it('collapses unsupported alternate views when renaming to a single-view file type', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
    })
    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
      viewMode: 'code',
    })
    store.renameTab('C:/workspace/draft.md', 'C:/workspace/draft.ts')

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs).toHaveLength(1)
    expect(nextState.openTabs[0]).toMatchObject({
      editorKind: 'code',
      filePath: 'C:/workspace/draft.ts',
      viewMode: 'default',
    })
    expect(nextState.activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/draft.ts', 'default'))
  })

  it('marks tabs dirty only when their content diverges from the saved content', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: 'draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
    })
    store.updateTabContent('C:/workspace/draft.md', 'draft updated')
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      isDirty: true,
      kind: 'file',
    })

    store.markTabSaved('C:/workspace/draft.md', 'draft updated')
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      isDirty: false,
      kind: 'file',
    })

    store.updateTabContent('C:/workspace/draft.md', 'draft updated')
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      isDirty: false,
      kind: 'file',
    })
  })

  it('propagates content changes across multiple tabs for the same file', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
      viewMode: 'default',
    })
    store.openTab({
      content: '# Draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
      viewMode: 'code',
    })
    store.updateTabContent('C:/workspace/draft.md', '# Draft updated')

    expect(useWorkspaceStore.getState().openTabs).toMatchObject([
      { content: '# Draft updated', isDirty: true, viewMode: 'default' },
      { content: '# Draft updated', isDirty: true, viewMode: 'code' },
    ])
  })

  it('closes the active tab and falls back to the nearest tab on the right first', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })
    store.activateTab(createWorkspaceFileTabId('C:/workspace/b.md', 'meo'))
    store.closeTab(createWorkspaceFileTabId('C:/workspace/b.md', 'meo'))

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/a.md',
      'C:/workspace/c.md',
    ])
    expect(nextState.activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/c.md', 'meo'))
  })

  it('renames an open active tab without losing its content or selection', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: 'content',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/old-name.md',
    })
    store.updateTabContent('C:/workspace/old-name.md', 'content updated')
    store.renameTab('C:/workspace/old-name.md', 'C:/workspace/new-name.md')

    const nextState = useWorkspaceStore.getState()
    expect(nextState.activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/new-name.md', 'meo'))
    expect(nextState.openTabs[0]).toMatchObject({
      content: 'content updated',
      filePath: 'C:/workspace/new-name.md',
      isDirty: true,
      kind: 'file',
    })
  })

  it('upserts diff tabs without disturbing other open tabs', () => {
    const store = useWorkspaceStore.getState()
    const diffTabId = createDiffTabId('C:/workspace/file.md', 'unstaged')

    store.openTab({
      content: 'content',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/file.md',
    })

    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/file.md',
          relativePath: 'file.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'new',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'old',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      title: 'file.md',
    })

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs).toHaveLength(2)
    expect(nextState.activeTabId).toBe(diffTabId)
    expect(nextState.openTabs[1]).toMatchObject({
      id: diffTabId,
      kind: 'diff',
      title: 'file.md',
    })
  })

  it('reorders tabs before and after the hovered target without disturbing the active tab', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })
    store.activateTab(createWorkspaceFileTabId('C:/workspace/b.md', 'meo'))

    store.moveTab(
      createWorkspaceFileTabId('C:/workspace/c.md', 'meo'),
      createWorkspaceFileTabId('C:/workspace/a.md', 'meo'),
      'before',
    )
    expect(useWorkspaceStore.getState().openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/c.md',
      'C:/workspace/a.md',
      'C:/workspace/b.md',
    ])
    expect(useWorkspaceStore.getState().activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/b.md', 'meo'))

    store.moveTab(
      createWorkspaceFileTabId('C:/workspace/c.md', 'meo'),
      createWorkspaceFileTabId('C:/workspace/b.md', 'meo'),
      'after',
    )
    expect(useWorkspaceStore.getState().openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/a.md',
      'C:/workspace/b.md',
      'C:/workspace/c.md',
    ])
    expect(useWorkspaceStore.getState().activeTabId).toBe(createWorkspaceFileTabId('C:/workspace/b.md', 'meo'))
  })

  it('treats self-drops and adjacent no-op drops as stable reorder operations', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })

    const currentTabs = useWorkspaceStore.getState().openTabs

    expect(
      reorderWorkspaceTabs(
        currentTabs,
        createWorkspaceFileTabId('C:/workspace/b.md', 'meo'),
        createWorkspaceFileTabId('C:/workspace/b.md', 'meo'),
        'before',
      ),
    ).toBe(currentTabs)
    expect(
      reorderWorkspaceTabs(
        currentTabs,
        createWorkspaceFileTabId('C:/workspace/b.md', 'meo'),
        createWorkspaceFileTabId('C:/workspace/c.md', 'meo'),
        'before',
      ),
    ).toBe(currentTabs)
    expect(
      reorderWorkspaceTabs(
        currentTabs,
        createWorkspaceFileTabId('C:/workspace/b.md', 'meo'),
        createWorkspaceFileTabId('C:/workspace/a.md', 'meo'),
        'after',
      ),
    ).toBe(currentTabs)
    expect(
      reorderWorkspaceTabs(
        currentTabs,
        createWorkspaceFileTabId('C:/workspace/missing.md', 'meo'),
        createWorkspaceFileTabId('C:/workspace/a.md', 'meo'),
        'before',
      ),
    ).toBe(currentTabs)
  })

  it('moves a leading tab to the very end when dropped after the last tab', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })

    store.moveTab(
      createWorkspaceFileTabId('C:/workspace/a.md', 'meo'),
      createWorkspaceFileTabId('C:/workspace/c.md', 'meo'),
      'after',
    )

    expect(useWorkspaceStore.getState().openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/b.md',
      'C:/workspace/c.md',
      'C:/workspace/a.md',
    ])
  })

  it('reorders diff tabs alongside file tabs without changing their payloads', () => {
    const store = useWorkspaceStore.getState()
    const diffTabId = createDiffTabId('C:/workspace/draft.md', 'unstaged')

    store.openTab({ content: 'draft', editorKind: 'rich-text', filePath: 'C:/workspace/draft.md' })
    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/draft.md',
          relativePath: 'draft.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'new',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'old',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      title: 'draft.md',
    })
    store.openTab({ content: 'notes', editorKind: 'rich-text', filePath: 'C:/workspace/notes.md' })

    store.moveTab(
      diffTabId,
      createWorkspaceFileTabId('C:/workspace/notes.md', 'meo'),
      'after',
    )

    const nextTabs = useWorkspaceStore.getState().openTabs
    expect(nextTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/draft.md',
      'C:/workspace/notes.md',
      diffTabId,
    ])
    expect(nextTabs[2]).toMatchObject({
      draftContent: null,
      id: diffTabId,
      kind: 'diff',
      title: 'draft.md',
    })
  })

  it('tracks diff tab draft content as a dirty state', () => {
    const store = useWorkspaceStore.getState()
    const diffTabId = createDiffTabId('C:/workspace/file.md', 'unstaged')

    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/file.md',
          relativePath: 'file.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'saved',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'base',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      title: 'file.md',
    })

    store.updateDiffTabDraft(diffTabId, 'saved + local')
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      draftContent: 'saved + local',
      isDirty: true,
      kind: 'diff',
    })

    store.markDiffTabSaved(diffTabId, 'saved + local')
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      draftContent: null,
      isDirty: false,
      kind: 'diff',
    })
  })

  it('stores diff navigation requests when opening a diff tab', () => {
    const store = useWorkspaceStore.getState()
    const diffTabId = createDiffTabId('C:/workspace/file.md', 'unstaged')

    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/file.md',
          relativePath: 'file.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'saved',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'base',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      navigationRequest: {
        lineNumber: 18,
        requestKey: 'request-1',
        source: 'worktree',
      },
      title: 'file.md',
    })

    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      kind: 'diff',
      navigationRequest: {
        lineNumber: 18,
        requestKey: 'request-1',
        source: 'worktree',
      },
    })
  })

  it('preserves a dirty diff draft when refreshed from Git state', () => {
    const store = useWorkspaceStore.getState()
    const diffTabId = createDiffTabId('C:/workspace/file.md', 'unstaged')

    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/file.md',
          relativePath: 'file.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'saved',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'base',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      title: 'file.md',
    })

    store.updateDiffTabDraft(diffTabId, 'saved + local')
    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/file.md',
          relativePath: 'file.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'saved from disk',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'base',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      title: 'file.md',
    }, false)

    const nextTab = useWorkspaceStore.getState().openTabs[0]
    expect(nextTab).toMatchObject({
      draftContent: 'saved + local',
      isDirty: true,
      kind: 'diff',
    })
    if (nextTab.kind !== 'diff') {
      throw new Error('Expected a diff tab')
    }
    expect(nextTab.diff.modifiedContent).toBe('saved from disk')
  })

  it('preserves an existing diff navigation request across Git refreshes when the refresh has no new request', () => {
    const store = useWorkspaceStore.getState()
    const diffTabId = createDiffTabId('C:/workspace/file.md', 'unstaged')

    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/file.md',
          relativePath: 'file.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'saved',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'base',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      navigationRequest: {
        lineNumber: 12,
        requestKey: 'request-2',
        source: 'revision',
      },
      title: 'file.md',
    })

    store.openDiffTab({
      draftContent: null,
      diff: {
        change: {
          kind: 'modified',
          originalPath: null,
          path: 'C:/workspace/file.md',
          relativePath: 'file.md',
          scope: 'unstaged',
          statusCode: 'M',
        },
        editorKind: 'rich-text',
        modifiedContent: 'saved from disk',
        modifiedExists: true,
        modifiedLabel: 'Working tree',
        originalContent: 'base',
        originalExists: true,
        originalLabel: 'Index',
        repositoryRootPath: 'C:/workspace',
      },
      exists: true,
      filePath: diffTabId,
      id: diffTabId,
      isDirty: false,
      kind: 'diff',
      title: 'file.md',
    }, false)

    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({
      diff: {
        modifiedContent: 'saved from disk',
      },
      kind: 'diff',
      navigationRequest: {
        lineNumber: 12,
        requestKey: 'request-2',
        source: 'revision',
      },
    })
  })
})

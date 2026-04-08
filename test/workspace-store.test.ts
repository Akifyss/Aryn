import { beforeEach, describe, expect, it } from 'vitest'
import {
  reorderWorkspaceTabs,
  useWorkspaceStore,
} from '../src/features/workspace/store/use-workspace-store'

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      activeTabPath: null,
      currentPath: null,
      openTabs: [],
      tree: [],
    })
  })

  it('opens tabs without duplicating them and activates the requested file', () => {
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
    expect(nextState.activeTabPath).toBe('C:/workspace/a.md')
    expect(nextState.openTabs[0]).toMatchObject({
      content: 'alpha',
      kind: 'file',
    })
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

  it('closes the active tab and falls back to the nearest tab on the right first', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })
    store.activateTab('C:/workspace/b.md')
    store.closeTab('C:/workspace/b.md')

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/a.md',
      'C:/workspace/c.md',
    ])
    expect(nextState.activeTabPath).toBe('C:/workspace/c.md')
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
    expect(nextState.activeTabPath).toBe('C:/workspace/new-name.md')
    expect(nextState.openTabs[0]).toMatchObject({
      content: 'content updated',
      filePath: 'C:/workspace/new-name.md',
      isDirty: true,
      kind: 'file',
    })
  })

  it('upserts diff tabs without disturbing other open tabs', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: 'content',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/file.md',
    })

    store.openDiffTab({
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
      filePath: 'git-diff://unstaged/C%3A%2Fworkspace%2Ffile.md',
      isDirty: false,
      kind: 'diff',
      title: 'file.md',
    })

    const nextState = useWorkspaceStore.getState()
    expect(nextState.openTabs).toHaveLength(2)
    expect(nextState.activeTabPath).toBe('git-diff://unstaged/C%3A%2Fworkspace%2Ffile.md')
    expect(nextState.openTabs[1]).toMatchObject({
      kind: 'diff',
      title: 'file.md',
    })
  })

  it('reorders tabs before and after the hovered target without disturbing the active tab', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })
    store.activateTab('C:/workspace/b.md')

    store.moveTab('C:/workspace/c.md', 'C:/workspace/a.md', 'before')
    expect(useWorkspaceStore.getState().openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/c.md',
      'C:/workspace/a.md',
      'C:/workspace/b.md',
    ])
    expect(useWorkspaceStore.getState().activeTabPath).toBe('C:/workspace/b.md')

    store.moveTab('C:/workspace/c.md', 'C:/workspace/b.md', 'after')
    expect(useWorkspaceStore.getState().openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/a.md',
      'C:/workspace/b.md',
      'C:/workspace/c.md',
    ])
    expect(useWorkspaceStore.getState().activeTabPath).toBe('C:/workspace/b.md')
  })

  it('treats self-drops and adjacent no-op drops as stable reorder operations', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })

    const currentTabs = useWorkspaceStore.getState().openTabs

    expect(reorderWorkspaceTabs(currentTabs, 'C:/workspace/b.md', 'C:/workspace/b.md', 'before')).toBe(currentTabs)
    expect(reorderWorkspaceTabs(currentTabs, 'C:/workspace/b.md', 'C:/workspace/c.md', 'before')).toBe(currentTabs)
    expect(reorderWorkspaceTabs(currentTabs, 'C:/workspace/b.md', 'C:/workspace/a.md', 'after')).toBe(currentTabs)
    expect(reorderWorkspaceTabs(currentTabs, 'C:/workspace/missing.md', 'C:/workspace/a.md', 'before')).toBe(currentTabs)
  })

  it('moves a leading tab to the very end when dropped after the last tab', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'a', editorKind: 'rich-text', filePath: 'C:/workspace/a.md' })
    store.openTab({ content: 'b', editorKind: 'rich-text', filePath: 'C:/workspace/b.md' })
    store.openTab({ content: 'c', editorKind: 'rich-text', filePath: 'C:/workspace/c.md' })

    store.moveTab('C:/workspace/a.md', 'C:/workspace/c.md', 'after')

    expect(useWorkspaceStore.getState().openTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/b.md',
      'C:/workspace/c.md',
      'C:/workspace/a.md',
    ])
  })

  it('reorders diff tabs alongside file tabs without changing their payloads', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({ content: 'draft', editorKind: 'rich-text', filePath: 'C:/workspace/draft.md' })
    store.openDiffTab({
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
      filePath: 'git-diff://unstaged/C%3A%2Fworkspace%2Fdraft.md',
      isDirty: false,
      kind: 'diff',
      title: 'draft.md',
    })
    store.openTab({ content: 'notes', editorKind: 'rich-text', filePath: 'C:/workspace/notes.md' })

    store.moveTab('git-diff://unstaged/C%3A%2Fworkspace%2Fdraft.md', 'C:/workspace/notes.md', 'after')

    const nextTabs = useWorkspaceStore.getState().openTabs
    expect(nextTabs.map((tab) => tab.filePath)).toEqual([
      'C:/workspace/draft.md',
      'C:/workspace/notes.md',
      'git-diff://unstaged/C%3A%2Fworkspace%2Fdraft.md',
    ])
    expect(nextTabs[2]).toMatchObject({
      kind: 'diff',
      title: 'draft.md',
    })
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'

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
    expect(nextState.openTabs[0].content).toBe('alpha')
  })

  it('marks tabs dirty only when their content diverges from the saved content', () => {
    const store = useWorkspaceStore.getState()

    store.openTab({
      content: 'draft',
      editorKind: 'rich-text',
      filePath: 'C:/workspace/draft.md',
    })
    store.updateTabContent('C:/workspace/draft.md', 'draft updated')
    expect(useWorkspaceStore.getState().openTabs[0].isDirty).toBe(true)

    store.markTabSaved('C:/workspace/draft.md', 'draft updated')
    expect(useWorkspaceStore.getState().openTabs[0].isDirty).toBe(false)

    store.updateTabContent('C:/workspace/draft.md', 'draft updated')
    expect(useWorkspaceStore.getState().openTabs[0].isDirty).toBe(false)
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
    expect(nextState.openTabs[0].filePath).toBe('C:/workspace/new-name.md')
    expect(nextState.openTabs[0].content).toBe('content updated')
    expect(nextState.openTabs[0].isDirty).toBe(true)
  })
})

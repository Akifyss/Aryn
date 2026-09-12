import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultDuoLayout, createDuoPane, DUO_FILES_ID, DUO_GIT_ID, useDuoStore } from '../src/features/duo/duo-state'
import { createDuoProjectsSnapshot, loadDuoLayout } from '../src/features/duo/duo-persistence'
import { cancelDuoDocumentNavigation, captureDuoDocumentTarget } from '../src/features/duo/duo-document-navigation'
import { useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'
import type { ProjectRecord } from '../src/features/workspace/types'

const project: ProjectRecord = { id: 'a', name: 'A', path: '/a', addedAt: '', lastOpenedAt: '', lastFilePath: null }
beforeEach(() => {
  useDuoStore.setState(useDuoStore.getInitialState())
  useWorkspaceStore.setState({ openTabs: [], activeTabId: null, currentPath: '/a' })
})

describe('moving an open document between panes', () => {
  it.each(['left', 'right'] as const)('transfers %s atomically without closing the shared dirty buffer', from => {
    const to = from === 'left' ? 'right' : 'left'
    const workspace = useWorkspaceStore.getState()
    workspace.openTab({ filePath: '/a/note.md', editorKind: 'prose', content: 'saved' })
    workspace.updateFileTabsContent('/a/note.md', 'unsaved')
    const document = useWorkspaceStore.getState().openTabs[0]
    const store = useDuoStore.getState()
    store.open(from, { kind: 'panel', id: DUO_FILES_ID })
    store.open(from, { kind: 'document', id: document.id })
    store.open(from, { kind: 'panel', id: DUO_GIT_ID })
    store.activate(from, document.id)
    store.open(to, { kind: 'panel', id: DUO_FILES_ID })
    store.setDirectoryTab(from, 'conversation')
    store.toggleDirectory(to)
    const observed: unknown[] = []
    const stop = useDuoStore.subscribe(state => observed.push(state.panes))
    store.moveTab(from, document.id)
    stop()
    expect(observed).toHaveLength(1)
    expect(useDuoStore.getState().panes[from]).toMatchObject({
      activeTabId: DUO_GIT_ID, directoryTab: 'conversation',
      tabs: [{ id: DUO_FILES_ID }, { id: DUO_GIT_ID }],
    })
    expect(useDuoStore.getState().panes[to]).toMatchObject({
      activeTabId: document.id, directoryOpen: false, tabs: [{ id: DUO_FILES_ID }, { id: document.id }],
    })
    expect(useDuoStore.getState().focusedPane).toBe(to)
    expect(useWorkspaceStore.getState().openTabs[0]).toBe(document)
    expect(document).toMatchObject({ content: 'unsaved', savedContent: 'saved', isDirty: true })
  })

  it('reuses the target reference in place, falls back to empty, and ignores repeated or unsupported moves', () => {
    const store = useDuoStore.getState()
    store.open('left', { kind: 'document', id: 'doc' })
    store.open('right', { kind: 'document', id: 'doc' })
    store.open('right', { kind: 'panel', id: DUO_FILES_ID })
    const targetTabs = useDuoStore.getState().panes.right.tabs
    store.moveTab('left', 'doc')
    expect(useDuoStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '' })
    expect(useDuoStore.getState().panes.right.tabs).toBe(targetTabs)
    const moved = useDuoStore.getState()
    store.moveTab('left', 'doc')
    store.moveTab('right', 'app://duo/start')
    expect(useDuoStore.getState()).toBe(moved)
    useDuoStore.setState({ restoring: true })
    store.moveTab('right', 'doc')
    expect(useDuoStore.getState().panes).toBe(moved.panes)
  })

  it('persists ownership per project and restores only the destination reference', async () => {
    const store = useDuoStore.getState()
    store.switchProject(project, createDefaultDuoLayout(project))
    useWorkspaceStore.getState().openTab({ filePath: '/a/note.md', workspacePath: '/a', editorKind: 'prose', content: 'saved' })
    const doc = useWorkspaceStore.getState().openTabs[0]
    store.open('left', { id: doc.id, kind: 'document' })
    store.moveTab('left', doc.id)
    const other = { ...project, id: 'b', name: 'B', path: '/b' }
    store.switchProject(other, { panes: { left: createDuoPane(), right: createDuoPane() }, focusedPane: 'left', ratio: .5 })
    store.open('left', { id: doc.id, kind: 'document' })
    const saved = JSON.parse(JSON.stringify(createDuoProjectsSnapshot(useDuoStore.getState(), [doc])))
    expect(saved.layouts.a.panes.left.tabs.some((tab: { id: string }) => tab.id === doc.id)).toBe(false)
    expect(saved.layouts.a.panes.right.activeTabId).toBe(doc.id)
    expect(saved.layouts.b.panes.left.tabs).toHaveLength(1)
    const restored = await loadDuoLayout(saved.layouts.a, {
      resolveWorkspaceEditorKind: async () => 'prose', readWorkspaceFile: async () => 'saved',
    } as unknown as Window['appApi'], [project, other], [])
    expect(restored.panes.left.tabs.some(tab => tab.kind === 'document')).toBe(false)
    expect(restored.panes.right.tabs.filter(tab => tab.kind === 'document')).toHaveLength(1)
    expect(restored.focusedPane).toBe('right')
    expect(restored.panes.right.activeTabId).toBe(doc.id)
  })

  it('invalidates pending reads in both panes while allowing later navigation', () => {
    const source = captureDuoDocumentTarget('left')
    const target = captureDuoDocumentTarget('right')
    cancelDuoDocumentNavigation('left')
    cancelDuoDocumentNavigation('right')
    source('late-source'); target('late-target')
    expect(useDuoStore.getState().panes.left.tabs).toEqual([])
    expect(useDuoStore.getState().panes.right.tabs).toEqual([])
    captureDuoDocumentTarget('right')('new')
    expect(useDuoStore.getState().panes.right.activeTabId).toBe('new')
  })
})

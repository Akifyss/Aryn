import { beforeEach, describe, expect, it } from 'vitest'
import { createDefaultWorkbenchLayout, createWorkbenchPane, WORKBENCH_FILES_ID, WORKBENCH_GIT_ID, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { createProjectWorkspacesSnapshot, loadWorkbenchLayout } from '../src/features/workbench/workbench-persistence'
import { cancelWorkbenchDocumentNavigation, captureWorkbenchDocumentTarget } from '../src/features/workbench/workbench-document-navigation'
import { useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'
import type { ProjectRecord } from '../src/features/workspace/types'

const project: ProjectRecord = { id: 'a', name: 'A', path: '/a', addedAt: '', lastOpenedAt: '', lastFilePath: null }
beforeEach(() => {
  useWorkbenchStore.setState(useWorkbenchStore.getInitialState())
  useWorkspaceStore.setState({ openTabs: [], activeTabId: null, currentPath: '/a' })
})

describe('moving an open document between panes', () => {
  it.each(['left', 'right'] as const)('transfers %s atomically without closing the shared dirty buffer', from => {
    const to = from === 'left' ? 'right' : 'left'
    const workspace = useWorkspaceStore.getState()
    workspace.openTab({ filePath: '/a/note.md', editorKind: 'prose', content: 'saved' })
    workspace.updateFileTabsContent('/a/note.md', 'unsaved')
    const document = useWorkspaceStore.getState().openTabs[0]
    const store = useWorkbenchStore.getState()
    store.open(from, { kind: 'panel', id: WORKBENCH_FILES_ID, panel: 'files' })
    store.open(from, { kind: 'document', id: document.id })
    store.open(from, { kind: 'panel', id: WORKBENCH_GIT_ID, panel: 'git' })
    store.activate(from, document.id)
    store.open(to, { kind: 'panel', id: 'peer-files', panel: 'files' })
    store.setDirectoryTab(from, 'conversation')
    store.toggleDirectory(to)
    const observed: unknown[] = []
    const stop = useWorkbenchStore.subscribe(state => observed.push(state.panes))
    store.moveTab(from, document.id)
    stop()
    expect(observed).toHaveLength(1)
    expect(useWorkbenchStore.getState().panes[from]).toMatchObject({
      activeTabId: WORKBENCH_GIT_ID, directoryTab: 'conversation',
      tabs: [{ id: WORKBENCH_FILES_ID }, { id: WORKBENCH_GIT_ID }],
    })
    expect(useWorkbenchStore.getState().panes[to]).toMatchObject({
      activeTabId: document.id, directoryOpen: false, tabs: [{ id: 'peer-files' }, { id: document.id }],
    })
    expect(useWorkbenchStore.getState().focusedPane).toBe(to)
    expect(useWorkspaceStore.getState().openTabs[0]).toBe(document)
    expect(document).toMatchObject({ content: 'unsaved', savedContent: 'saved', isDirty: true })
  })

  it('reuses the target reference in place, falls back to empty, and ignores repeated or unsupported moves', () => {
    const store = useWorkbenchStore.getState()
    store.open('left', { kind: 'document', id: 'doc' })
    store.open('right', { kind: 'document', id: 'doc' })
    store.open('right', { kind: 'panel', id: WORKBENCH_FILES_ID, panel: 'files' })
    const targetTabs = useWorkbenchStore.getState().panes.right.tabs
    store.moveTab('left', 'doc')
    expect(useWorkbenchStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '' })
    expect(useWorkbenchStore.getState().panes.right.tabs).toBe(targetTabs)
    const moved = useWorkbenchStore.getState()
    store.moveTab('left', 'doc')
    store.moveTab('right', 'app://workbench/start')
    expect(useWorkbenchStore.getState()).toBe(moved)
    useWorkbenchStore.setState({ restoring: true })
    store.moveTab('right', 'doc')
    expect(useWorkbenchStore.getState().panes).toBe(moved.panes)
  })

  it('persists ownership per project and restores only the destination reference', async () => {
    const store = useWorkbenchStore.getState()
    store.switchProject(project, createDefaultWorkbenchLayout(project))
    useWorkspaceStore.getState().openTab({ filePath: '/a/note.md', workspacePath: '/a', editorKind: 'prose', content: 'saved' })
    const doc = useWorkspaceStore.getState().openTabs[0]
    store.open('left', { id: doc.id, kind: 'document' })
    store.moveTab('left', doc.id)
    const other = { ...project, id: 'b', name: 'B', path: '/b' }
    store.switchProject(other, { panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, focusedPane: 'left', ratio: .5 })
    store.open('left', { id: doc.id, kind: 'document' })
    const saved = JSON.parse(JSON.stringify(createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [doc])))
    expect(saved.layouts.a.panes.left.tabs.some((tab: { id: string }) => tab.id === doc.id)).toBe(false)
    expect(saved.layouts.a.panes.right.activeTabId).toBe(doc.id)
    expect(saved.layouts.b.panes.left.tabs).toHaveLength(1)
    const restored = await loadWorkbenchLayout(saved.layouts.a, {
      resolveWorkspaceEditorKind: async () => 'prose', readWorkspaceFile: async () => 'saved',
    } as unknown as Window['appApi'], [project, other], [])
    expect(restored.panes.left.tabs.some(tab => tab.kind === 'document')).toBe(false)
    expect(restored.panes.right.tabs.filter(tab => tab.kind === 'document')).toHaveLength(1)
    expect(restored.focusedPane).toBe('right')
    expect(restored.panes.right.activeTabId).toBe(doc.id)
  })

  it('invalidates pending reads in both panes while allowing later navigation', () => {
    const source = captureWorkbenchDocumentTarget('left')
    const target = captureWorkbenchDocumentTarget('right')
    cancelWorkbenchDocumentNavigation('left')
    cancelWorkbenchDocumentNavigation('right')
    source('late-source'); target('late-target')
    expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([])
    expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([])
    captureWorkbenchDocumentTarget('right')('new')
    expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('new')
  })
})

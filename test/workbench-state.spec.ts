import { beforeEach, describe, expect, it } from 'vitest'
import { clampWorkbenchRatio, createDefaultWorkbenchLayout, createWorkbenchPane, WORKBENCH_CONVERSATIONS_ID, WORKBENCH_FILES_ID, WORKBENCH_GIT_ID, openWorkbenchProjectSession, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { captureWorkbenchDocumentTarget } from '../src/features/workbench/workbench-document-navigation'
import { createWorkspaceFileTabId, useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'

beforeEach(() => {
  useWorkbenchStore.setState({ panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, focusedPane: 'left', initialized: false, ratio: 0.5 })
  useWorkspaceStore.setState({ activeTabId: null, currentPath: '/project', openTabs: [], tabRenames: [] })
})

describe('Workbench pane navigation', () => {
  it('defaults to one fresh chat on the left and files then changes on the right', () => {
    const store = useWorkbenchStore.getState()
    store.switchProject(null, createDefaultWorkbenchLayout())
    const initialized = useWorkbenchStore.getState()
    const draftId = initialized.panes.left.activeTabId
    expect(draftId).toMatch(/^conversation-draft:\/\//)
    expect(initialized.panes.left).toMatchObject({ directoryOpen: true, directoryTab: 'conversation', tabs: [{ id: draftId, kind: 'conversation', conversationId: null }] })
    expect(initialized.panes.left.tabs).toHaveLength(1)
    expect(initialized.panes.right).toMatchObject({ directoryOpen: false, directoryTab: 'git', activeTabId: WORKBENCH_FILES_ID, tabs: [{ id: WORKBENCH_FILES_ID, kind: 'panel', panel: 'files' }, { id: WORKBENCH_GIT_ID, kind: 'panel', panel: 'git' }] })
    expect(initialized.panes.right.tabs).toHaveLength(2)
    store.close('left', draftId)
    store.close('right', WORKBENCH_FILES_ID)
    store.close('right', WORKBENCH_GIT_ID)
    expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([])
    expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([])
  })

  it('keeps file selections, ordering and directory visibility independent', () => {
    const store = useWorkbenchStore.getState()
    store.open('left', { kind: 'document', id: 'a' })
    store.open('left', { kind: 'document', id: 'b' })
    store.open('right', { kind: 'document', id: 'a' })
    store.reorder('left', 'b', 'a', 'before')
    store.toggleDirectory('left')
    expect(useWorkbenchStore.getState().panes.left).toMatchObject({ activeTabId: 'b', directoryOpen: false, tabs: [{ id: 'b' }, { id: 'a' }] })
    expect(useWorkbenchStore.getState().panes.right).toMatchObject({ activeTabId: 'a', directoryOpen: true, tabs: [{ id: 'a' }] })
  })

  it('closing a shared document reference leaves the other pane selected', () => {
    const store = useWorkbenchStore.getState()
    store.open('left', { kind: 'document', id: 'a' })
    store.open('right', { kind: 'document', id: 'a' })
    store.close('left', 'a')
    expect(useWorkbenchStore.getState().panes.left.activeTabId).toBe('')
    expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('a')
  })

  it('focuses the single live view of a conversation even after a draft materializes', () => {
    const store = useWorkbenchStore.getState()
    const project = { id: 'project', path: '/project', name: 'Project', addedAt: '', lastOpenedAt: '', lastFilePath: null }
    openWorkbenchProjectSession('left', project)
    const draftId = useWorkbenchStore.getState().panes.left.activeTabId
    store.setProjectSession('left', draftId, { agentId: 'pi', sessionPath: 'one' })
    openWorkbenchProjectSession('right', project, { agentId: 'pi', sessionPath: 'one', sessionLabel: 'One' })
    expect(useWorkbenchStore.getState().focusedPane).toBe('left')
    expect(useWorkbenchStore.getState().panes.left.tabs).toHaveLength(1)
    expect(useWorkbenchStore.getState().panes.left.tabs[0]).toMatchObject({ id: draftId, projectSession: { request: { kind: 'session', sessionPath: 'one' } } })
    expect(useWorkbenchStore.getState().panes.right.tabs).toHaveLength(0)
  })

  it('permits different conversations and multiple independent new drafts', () => {
    const store = useWorkbenchStore.getState()
    store.open('left', { kind: 'conversation', id: 'draft-1', conversationId: null })
    store.open('right', { kind: 'conversation', id: 'draft-2', conversationId: null })
    store.open('right', { kind: 'conversation', id: 'other', conversationId: 'two' })
    expect(useWorkbenchStore.getState().panes.left.tabs).toHaveLength(1)
    expect(useWorkbenchStore.getState().panes.right.tabs).toHaveLength(2)
  })

  it('reconciles removed documents without losing conversation tabs or fixed selections', () => {
    const store = useWorkbenchStore.getState()
    store.open('left', { kind: 'conversation', id: 'one', conversationId: 'one' })
    store.open('left', { kind: 'document', id: 'a' })
    store.open('right', { kind: 'panel', id: WORKBENCH_CONVERSATIONS_ID, panel: 'conversations' })
    store.reconcileDocuments(new Set())
    expect(useWorkbenchStore.getState().panes.left.activeTabId).toBe('one')
    expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe(WORKBENCH_CONVERSATIONS_ID)
  })

  it('preserves both pane references through a file rename and deduplicates collisions', () => {
    const store = useWorkbenchStore.getState()
    store.open('left', { kind: 'document', id: 'old' })
    store.open('left', { kind: 'document', id: 'new' })
    store.open('right', { kind: 'document', id: 'old' })
    store.renameDocument('old', 'new')
    expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([{ kind: 'document', id: 'new' }])
    expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('new')
  })

  it('adopts asynchronously restored files without duplicating pane references', () => {
    const store = useWorkbenchStore.getState()
    useWorkbenchStore.setState({ initialized: true })
    store.open('left', { kind: 'document', id: 'a' })
    store.adoptDocuments(['a', 'b'], 'b')
    store.adoptDocuments(['a', 'b'], 'a')
    expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([{ kind: 'document', id: 'b' }])
    expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('b')
  })

  it('ignores activating and closing pages that are not open', () => {
    const store = useWorkbenchStore.getState()
    store.activate('left', 'missing')
    store.close('left', WORKBENCH_FILES_ID)
    expect(useWorkbenchStore.getState().panes.left.activeTabId).toBe('')
  })

  it('independently opens, reorders and closes panel pages from an empty pane', () => {
    const store = useWorkbenchStore.getState()
    useWorkbenchStore.setState({ initialized: true })
    expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([])
    expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([])
    store.open('left', { kind: 'panel', id: WORKBENCH_FILES_ID, panel: 'files' })
    store.open('left', { kind: 'panel', id: WORKBENCH_CONVERSATIONS_ID, panel: 'conversations' })
    store.open('left', { kind: 'panel', id: WORKBENCH_FILES_ID, panel: 'files' })
    expect(useWorkbenchStore.getState().panes.left.tabs).toHaveLength(2)
    store.open('right', { kind: 'panel', id: 'peer-files', panel: 'files' })
    store.reorder('left', WORKBENCH_CONVERSATIONS_ID, WORKBENCH_FILES_ID, 'before')
    expect(useWorkbenchStore.getState().panes.left.tabs[0].id).toBe(WORKBENCH_CONVERSATIONS_ID)
    store.close('left', WORKBENCH_FILES_ID)
    expect(useWorkbenchStore.getState().panes.left.activeTabId).toBe(WORKBENCH_CONVERSATIONS_ID)
    store.close('left', WORKBENCH_CONVERSATIONS_ID)
    expect(useWorkbenchStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '' })
    expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('peer-files')
  })
})

describe('Workbench asynchronous document destinations', () => {
  it('keeps the captured pane without stealing focus after a read resolves', () => {
    const opened = captureWorkbenchDocumentTarget()
    useWorkbenchStore.getState().focus('right')
    opened('a')
    expect(useWorkbenchStore.getState().panes.left.activeTabId).toBe('a')
    expect(useWorkbenchStore.getState().focusedPane).toBe('right')
  })

  it('rejects stale requests in a pane while allowing the peer to finish independently', () => {
    const first = captureWorkbenchDocumentTarget()
    const second = captureWorkbenchDocumentTarget()
    useWorkbenchStore.getState().focus('right')
    const peer = captureWorkbenchDocumentTarget()
    expect(first.isCurrent()).toBe(false)
    expect(second.isCurrent()).toBe(true)
    expect(peer.isCurrent()).toBe(true)
    first('stale')
    second('left')
    peer('right')
    expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([{ kind: 'document', id: 'left' }])
    expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('right')
  })

  it('rejects pending reads after changing the file workspace', () => {
    const opened = captureWorkbenchDocumentTarget()
    useWorkspaceStore.getState().setCurrentPath('/another-project')
    expect(opened.isCurrent()).toBe(false)
    opened('old-file')
    expect(useWorkbenchStore.getState().panes.left.tabs).toHaveLength(0)
  })
})

describe('Workbench shared drafts and resizing', () => {
  it('does not overwrite a newer edit when an earlier save finishes', () => {
    const store = useWorkspaceStore.getState()
    store.openTab({ filePath: '/project/a.md', editorKind: 'prose', content: 'initial' })
    store.updateFileTabsContent('/project/a.md', 'saving')
    store.updateFileTabsContent('/project/a.md', 'newer edit')
    store.markFileTabsSaved('/project/a.md', 'saving')
    expect(useWorkspaceStore.getState().openTabs[0]).toMatchObject({ content: 'newer edit', savedContent: 'saving', isDirty: true })
    store.markFileTabsSaved('/project/a.md', 'newer edit')
    expect(useWorkspaceStore.getState().openTabs[0].isDirty).toBe(false)
  })

  it('shares the draft across file views and reports identities after a rename', () => {
    const store = useWorkspaceStore.getState()
    store.openTab({ filePath: '/project/a.md', editorKind: 'prose', content: 'initial' })
    store.openTab({ filePath: '/project/a.md', editorKind: 'prose', content: 'initial', viewMode: 'code' })
    store.updateFileTabsContent('/project/a.md', 'shared edit')
    expect(useWorkspaceStore.getState().openTabs.every((tab) => tab.kind === 'file' && tab.content === 'shared edit')).toBe(true)
    store.renameTab('/project/a.md', '/project/b.md')
    expect(useWorkspaceStore.getState().tabRenames).toContainEqual({ from: createWorkspaceFileTabId('/project/a.md', 'meo'), to: createWorkspaceFileTabId('/project/b.md', 'meo') })
  })

  it.each([0, 300, 640, 800, 1440, 2560])('keeps both panes in bounds at %i pixels', (width) => {
    for (const ratio of [-1, 0, 0.25, 0.5, 1, 2, NaN, Infinity]) {
      const value = clampWorkbenchRatio(ratio, width)
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
      if (width >= 640) {
        expect(value * width).toBeGreaterThanOrEqual(320 - 0.001)
        expect((1 - value) * width).toBeGreaterThanOrEqual(320 - 0.001)
      } else expect(value).toBe(0.5)
    }
  })
})

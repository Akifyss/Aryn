import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultWorkbenchLayout, createWorkbenchPane, WORKBENCH_CONVERSATIONS_ID, WORKBENCH_FILES_ID, getWorkbenchProjectTabs, openWorkbenchProjectSession, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { scopeWorkbenchLayout } from '../src/features/workbench/workbench-project-layouts'
import { WORKBENCH_OPEN_ACTIONS } from '../src/features/workbench/workbench-open-actions'
import { createWorkbenchLayoutSnapshot, loadWorkbenchLayout } from '../src/features/workbench/workbench-persistence'
import type { ProjectRecord } from '../src/features/workspace/types'

const a: ProjectRecord = { id: 'a', name: 'A', path: '/a', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const b: ProjectRecord = { ...a, id: 'b', name: 'B', path: '/b' }
beforeEach(() => useWorkbenchStore.setState({ panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, initialized: false }))

describe('project-only Workbench conversations', () => {
  it.each(['left', 'right'] as const)('binds every new-chat action to the selected project in the %s pane', (pane) => {
    const action = WORKBENCH_OPEN_ACTIONS.find((action) => action.id === 'conversation')!
    const choose = vi.fn()
    action.open(pane, null, choose)
    expect(choose).toHaveBeenCalledOnce()
    expect(useWorkbenchStore.getState().panes[pane].tabs).toEqual([])
    action.open(pane, a, choose)
    expect(useWorkbenchStore.getState().panes[pane].tabs[0]).toMatchObject({ projectSession: { project: a, request: { kind: 'new' } } })
    expect(useWorkbenchStore.getState().panes[pane === 'left' ? 'right' : 'left'].tabs).toEqual([])
  })

  it('binds legacy unassigned drafts through the same project restore path used at startup', async () => {
    useWorkbenchStore.setState(createDefaultWorkbenchLayout())
    const snapshot = createWorkbenchLayoutSnapshot(useWorkbenchStore.getState(), [], a.path)
    const restored = await loadWorkbenchLayout(scopeWorkbenchLayout(snapshot, a), {} as Parameters<typeof loadWorkbenchLayout>[1], [a, b], [])
    expect(restored.panes.left.tabs[0]).toMatchObject({ projectSession: { project: a, request: { kind: 'new' } } })
    expect(getWorkbenchProjectTabs(restored.panes.left.tabs, b)).toEqual([])
  })

  it('filters both panes without removing other project tabs and restores project ownership from disk', async () => {
    const store = useWorkbenchStore.getState()
    for (const pane of ['left', 'right'] as const) {
      openWorkbenchProjectSession(pane, a)
      openWorkbenchProjectSession(pane, b, { agentId: 'pi', sessionPath: `/b/history-${pane}`, sessionLabel: 'B history' })
      store.open(pane, { kind: 'conversation', id: `legacy-${pane}`, conversationId: `standalone-${pane}` })
      store.open(pane, { kind: 'panel', id: WORKBENCH_CONVERSATIONS_ID })
      store.open(pane, { kind: 'panel', id: WORKBENCH_FILES_ID })
      const all = useWorkbenchStore.getState().panes[pane].tabs
      expect(getWorkbenchProjectTabs(all, a).map((tab) => tab.kind)).toEqual(['conversation', 'panel'])
      expect(getWorkbenchProjectTabs(all, b)[0]).toMatchObject({ projectSession: { project: b } })
      expect(getWorkbenchProjectTabs(all, null)).toEqual([{ kind: 'panel', id: WORKBENCH_FILES_ID }])
      expect(all).toHaveLength(5)
    }
    const saved = createWorkbenchLayoutSnapshot(useWorkbenchStore.getState(), [], a.path)
    const restored = await loadWorkbenchLayout(saved, {} as Parameters<typeof loadWorkbenchLayout>[1], [a, b], [])
    for (const pane of ['left', 'right'] as const) {
      expect(getWorkbenchProjectTabs(restored.panes[pane].tabs, a)[0]).toMatchObject({ projectSession: { project: a, request: { kind: 'new' } } })
      expect(getWorkbenchProjectTabs(restored.panes[pane].tabs, b)[0]).toMatchObject({ projectSession: { project: b, request: { sessionPath: `/b/history-${pane}` } } })
    }
  })
})

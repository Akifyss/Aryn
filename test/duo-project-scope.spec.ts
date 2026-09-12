import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultDuoLayout, createDuoPane, DUO_CONVERSATIONS_ID, DUO_FILES_ID, getDuoProjectTabs, openDuoProjectSession, useDuoStore } from '../src/features/duo/duo-state'
import { scopeDuoLayout } from '../src/features/duo/duo-project-layouts'
import { DUO_OPEN_ACTIONS } from '../src/features/duo/duo-open-actions'
import { createDuoLayoutSnapshot, loadDuoLayout } from '../src/features/duo/duo-persistence'
import type { ProjectRecord } from '../src/features/workspace/types'

const a: ProjectRecord = { id: 'a', name: 'A', path: '/a', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const b: ProjectRecord = { ...a, id: 'b', name: 'B', path: '/b' }
beforeEach(() => useDuoStore.setState({ panes: { left: createDuoPane(), right: createDuoPane() }, initialized: false }))

describe('project-only Duo conversations', () => {
  it.each(['left', 'right'] as const)('binds every new-chat action to the selected project in the %s pane', (pane) => {
    const action = DUO_OPEN_ACTIONS.find((action) => action.id === 'conversation')!
    const choose = vi.fn()
    action.open(pane, null, choose)
    expect(choose).toHaveBeenCalledOnce()
    expect(useDuoStore.getState().panes[pane].tabs).toEqual([])
    action.open(pane, a, choose)
    expect(useDuoStore.getState().panes[pane].tabs[0]).toMatchObject({ projectSession: { project: a, request: { kind: 'new' } } })
    expect(useDuoStore.getState().panes[pane === 'left' ? 'right' : 'left'].tabs).toEqual([])
  })

  it('binds legacy unassigned drafts through the same project restore path used at startup', async () => {
    useDuoStore.setState(createDefaultDuoLayout())
    const snapshot = createDuoLayoutSnapshot(useDuoStore.getState(), [], a.path)
    const restored = await loadDuoLayout(scopeDuoLayout(snapshot, a), {} as Parameters<typeof loadDuoLayout>[1], [a, b], [])
    expect(restored.panes.left.tabs[0]).toMatchObject({ projectSession: { project: a, request: { kind: 'new' } } })
    expect(getDuoProjectTabs(restored.panes.left.tabs, b)).toEqual([])
  })

  it('filters both panes without removing other project tabs and restores project ownership from disk', async () => {
    const store = useDuoStore.getState()
    for (const pane of ['left', 'right'] as const) {
      openDuoProjectSession(pane, a)
      openDuoProjectSession(pane, b, { agentId: 'pi', sessionPath: `/b/history-${pane}`, sessionLabel: 'B history' })
      store.open(pane, { kind: 'conversation', id: `legacy-${pane}`, conversationId: `standalone-${pane}` })
      store.open(pane, { kind: 'panel', id: DUO_CONVERSATIONS_ID })
      store.open(pane, { kind: 'panel', id: DUO_FILES_ID })
      const all = useDuoStore.getState().panes[pane].tabs
      expect(getDuoProjectTabs(all, a).map((tab) => tab.kind)).toEqual(['conversation', 'panel'])
      expect(getDuoProjectTabs(all, b)[0]).toMatchObject({ projectSession: { project: b } })
      expect(getDuoProjectTabs(all, null)).toEqual([{ kind: 'panel', id: DUO_FILES_ID }])
      expect(all).toHaveLength(5)
    }
    const saved = createDuoLayoutSnapshot(useDuoStore.getState(), [], a.path)
    const restored = await loadDuoLayout(saved, {} as Parameters<typeof loadDuoLayout>[1], [a, b], [])
    for (const pane of ['left', 'right'] as const) {
      expect(getDuoProjectTabs(restored.panes[pane].tabs, a)[0]).toMatchObject({ projectSession: { project: a, request: { kind: 'new' } } })
      expect(getDuoProjectTabs(restored.panes[pane].tabs, b)[0]).toMatchObject({ projectSession: { project: b, request: { sessionPath: `/b/history-${pane}` } } })
    }
  })
})

import { beforeEach, expect, it, vi } from 'vitest'
import { createWorkbenchPane, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { openWorkbenchTerminal, WORKBENCH_OPEN_ACTIONS } from '../src/features/workbench/workbench-open-actions'
import { createProjectWorkspacesSnapshot, loadWorkbenchLayout } from '../src/features/workbench/workbench-persistence'
import { scopeWorkbenchLayout } from '../src/features/workbench/workbench-project-layouts'
import { normalizeWorkbenchLayout } from '../electron/shared/contracts/workbench-layout'
const a = { id: 'a', path: '/a', name: 'A', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const b = { ...a, id: 'b', path: '/b' }
const empty = () => ({ panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, focusedPane: 'left' as const, ratio: 0.5 })
beforeEach(() => { useWorkbenchStore.setState(useWorkbenchStore.getInitialState()); useWorkbenchStore.getState().switchProject(a, empty()) })

it('adds terminal to the shared plus/start menu and creates independent tabs', () => {
  expect(WORKBENCH_OPEN_ACTIONS.find(action => action.id === 'terminal')?.label).toBe('终端')
  openWorkbenchTerminal('left', a); openWorkbenchTerminal('right', a)
  const state = useWorkbenchStore.getState()
  expect(state.panes.left.tabs[0]).toMatchObject({ kind: 'terminal', title: '终端', projectId: 'a' })
  expect(state.panes.right.tabs[0]).toMatchObject({ kind: 'terminal', title: '终端 2', projectId: 'a' })
  expect(state.panes.left.activeTabId).not.toBe(state.panes.right.activeTabId)
})
it('moves a terminal without changing its identity and deduplicates reopen', () => {
  openWorkbenchTerminal('left', a)
  const tab = useWorkbenchStore.getState().panes.left.tabs[0]
  useWorkbenchStore.getState().moveTab('left', tab.id)
  useWorkbenchStore.getState().open('left', tab)
  expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([])
  expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([tab])
  expect(useWorkbenchStore.getState().focusedPane).toBe('right')
})
it('preserves per-project layout without persisting PID, output or spawning on restore', async () => {
  openWorkbenchTerminal('left', a)
  const original = useWorkbenchStore.getState().panes.left.tabs[0]
  useWorkbenchStore.getState().switchProject(b, empty())
  openWorkbenchTerminal('right', b)
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  expect(saved.layouts.a.panes.left.tabs).toEqual([original])
  const api = { terminal: { open: vi.fn() } } as unknown as Window['appApi']
  const restored = await loadWorkbenchLayout(saved.layouts.a, api, [a, b], [])
  expect(restored.panes.left.tabs).toEqual([original])
  expect(api.terminal.open).not.toHaveBeenCalled()
  expect(scopeWorkbenchLayout(saved.layouts.a, b).panes.left.tabs).toEqual([])
})
it('deduplicates persisted terminal identities across panes and rejects deleted projects', async () => {
  openWorkbenchTerminal('left', a)
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), []).layouts.a
  saved.panes.right = { ...saved.panes.left }
  const clean = normalizeWorkbenchLayout(saved)!
  expect(clean.panes.right.tabs).toEqual([])
  expect((await loadWorkbenchLayout(clean, {} as Window['appApi'], [], [])).panes.left.tabs).toEqual([])
})
it('blocks missing/wrong projects and restoration races', () => {
  const choose = vi.fn()
  openWorkbenchTerminal('left', null, choose)
  openWorkbenchTerminal('left', b)
  useWorkbenchStore.setState({ restoring: true })
  openWorkbenchTerminal('left', a)
  expect(choose).toHaveBeenCalledOnce()
  expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([])
})
it('applies a completed terminal close to its current owner after a move and project switch', () => {
  openWorkbenchTerminal('left', a)
  const original = useWorkbenchStore.getState().panes.left.tabs[0]
  useWorkbenchStore.getState().moveTab('left', original.id)
  useWorkbenchStore.getState().switchProject(b, empty())
  openWorkbenchTerminal('left', b)
  const peer = useWorkbenchStore.getState().panes.left.tabs[0]
  useWorkbenchStore.getState().removeTerminal(a.id, original.id)
  expect(useWorkbenchStore.getState().projectLayouts.a.panes.right.tabs).toEqual([])
  expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([peer])
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  expect(saved.layouts.a.panes.right.tabs).toEqual([])
})
it('removes a moved active terminal with a valid adjacent selection and preserves unrelated documents', () => {
  openWorkbenchTerminal('left', a)
  const original = useWorkbenchStore.getState().panes.left.tabs[0]
  useWorkbenchStore.getState().open('right', { id: 'document', kind: 'document' })
  useWorkbenchStore.getState().moveTab('left', original.id)
  useWorkbenchStore.getState().removeTerminal(b.id, original.id)
  expect(useWorkbenchStore.getState().panes.right.tabs).toHaveLength(2)
  useWorkbenchStore.getState().removeTerminal(a.id, original.id)
  expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([{ id: 'document', kind: 'document' }])
  expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('document')
})

import { beforeEach, expect, it } from 'vitest'
import { createWorkbenchPane, createWorkbenchPanel, WORKBENCH_FILES_ID, WORKBENCH_GIT_ID, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { createWorkbenchLayoutSnapshot, createProjectWorkspacesSnapshot, loadWorkbenchLayout } from '../src/features/workbench/workbench-persistence'
import { WORKBENCH_OPEN_ACTIONS } from '../src/features/workbench/workbench-open-actions'
import type { ProjectRecord } from '../src/features/workspace/types'

beforeEach(() => useWorkbenchStore.setState(useWorkbenchStore.getInitialState()))

it.each(['files', 'git'] as const)('migrates legacy duplicate %s IDs without merging their views', async panel => {
  const id = `app://fixed/${panel}`
  const project: ProjectRecord = { id: 'a', path: '/a', name: 'A', addedAt: '', lastOpenedAt: '', lastFilePath: null }
  const store = useWorkbenchStore.getState()
  store.switchProject(project, { panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, ratio: .5, focusedPane: 'left' })
  store.open('left', { id, kind: 'panel', panel })
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  saved.layouts.a.panes.right = { ...saved.layouts.a.panes.left }
  const restored = await loadWorkbenchLayout(saved.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs[0]).toEqual({ id, kind: 'panel', panel })
  expect(restored.panes.right.tabs[0]).toMatchObject({ kind: 'panel', panel })
  expect(restored.panes.right.activeTabId).toBe(restored.panes.right.tabs[0].id)
  expect(restored.panes.right.activeTabId).not.toBe(id)
  expect(restored.panes.left.tabs[0]).not.toBe(restored.panes.right.tabs[0])
  const next = createWorkbenchLayoutSnapshot(restored, [], project.path)
  expect((await loadWorkbenchLayout(next, {} as Window['appApi'], [project], [])).panes).toEqual(restored.panes)
})

it.each(['files', 'git'] as const)('moves %s without replacing same-type neighbors in either pane', panel => {
  const store = useWorkbenchStore.getState()
  const source = createWorkbenchPanel(panel)
  const peer = createWorkbenchPanel(panel)
  const id = source.id
  store.open('left', source)
  store.open('right', peer)
  store.open('right', { id: 'peer', kind: 'document' })
  store.toggleDirectory('right')
  store.setDirectoryTab('left', 'conversation')
  store.setDirectoryTab('right', 'git')
  const states: unknown[] = []
  const stop = useWorkbenchStore.subscribe(state => states.push(state.panes))
  store.moveTab('left', id)
  stop()
  expect(states).toHaveLength(1)
  expect(useWorkbenchStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '', directoryOpen: true, directoryTab: 'conversation' })
  expect(useWorkbenchStore.getState().panes.right).toMatchObject({ activeTabId: id, directoryOpen: false, directoryTab: 'git' })
  expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([peer, { id: 'peer', kind: 'document' }, source])
  expect(useWorkbenchStore.getState().panes.right.tabs[0]).toBe(peer)
  expect(useWorkbenchStore.getState().panes.right.tabs[2]).toBe(source)
  store.moveTab('right', id)
  expect(useWorkbenchStore.getState().panes.left.tabs[0]).toBe(source)
  expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('peer')
  const moved = useWorkbenchStore.getState()
  store.moveTab('right', id)
  store.moveTab('left', 'app://workbench/start')
  expect(useWorkbenchStore.getState()).toBe(moved)
})

it.each(['files', 'git'] as const)('creates, reorders, closes and restores multiple %s tabs per project', async panel => {
  const project: ProjectRecord = { id: 'a', path: '/a', name: 'A', addedAt: '', lastOpenedAt: '', lastFilePath: null }
  const store = useWorkbenchStore.getState()
  store.switchProject(project, { panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, ratio: .5, focusedPane: 'left' })
  const action = WORKBENCH_OPEN_ACTIONS.find(action => action.id === panel)!
  action.open('left', project)
  action.open('left', project)
  action.open('left', project)
  const [first, second, third] = useWorkbenchStore.getState().panes.left.tabs
  expect(new Set([first.id, second.id, third.id]).size).toBe(3)
  expect(useWorkbenchStore.getState().panes.left.activeTabId).toBe(third.id)
  store.reorder('left', third.id, first.id, 'before')
  store.close('left', second.id)
  store.moveTab('left', first.id)
  // An existing instance is focused, never copied by the low-level open path.
  store.open('left', first)
  expect(useWorkbenchStore.getState().focusedPane).toBe('right')
  expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([third])
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  const restored = await loadWorkbenchLayout(saved.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs).toEqual([third])
  expect(restored.panes.right.tabs).toEqual([first])
  expect(restored.panes.left.activeTabId).toBe(third.id)
  expect(restored.panes.right.activeTabId).toBe(first.id)
  const other = { ...project, id: 'b', path: '/b' }
  store.switchProject(other, { panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, ratio: .5, focusedPane: 'left' })
  action.open('left', other)
  store.switchProject(project, useWorkbenchStore.getState().projectLayouts.a)
  expect(useWorkbenchStore.getState().panes.left.tabs[0]).toBe(third)
  expect(useWorkbenchStore.getState().panes.right.tabs[0]).toBe(first)
})

it('moves an inactive panel without changing the source active tab and guards restoration', () => {
  const store = useWorkbenchStore.getState()
  store.open('left', { id: WORKBENCH_FILES_ID, kind: 'panel', panel: 'files' })
  store.open('left', { id: WORKBENCH_GIT_ID, kind: 'panel', panel: 'git' })
  store.moveTab('left', WORKBENCH_FILES_ID)
  expect(useWorkbenchStore.getState().panes.left.activeTabId).toBe(WORKBENCH_GIT_ID)
  expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe(WORKBENCH_FILES_ID)
  useWorkbenchStore.setState({ restoring: true })
  const restoring = useWorkbenchStore.getState()
  store.moveTab('left', WORKBENCH_GIT_ID)
  expect(useWorkbenchStore.getState()).toBe(restoring)
})

it('persists panel ownership per project after a move', async () => {
  const project: ProjectRecord = { id: 'a', path: '/a', name: 'A', addedAt: '', lastOpenedAt: '', lastFilePath: null }
  const store = useWorkbenchStore.getState()
  store.switchProject(project, { panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, ratio: .5, focusedPane: 'left' })
  store.open('left', { id: WORKBENCH_GIT_ID, kind: 'panel', panel: 'git' })
  store.moveTab('left', WORKBENCH_GIT_ID)
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  const restored = await loadWorkbenchLayout(saved.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs).toEqual([])
  expect(restored.panes.right.tabs).toEqual([{ id: WORKBENCH_GIT_ID, kind: 'panel', panel: 'git' }])
  expect(restored.panes.right.activeTabId).toBe(WORKBENCH_GIT_ID)
  expect(restored.focusedPane).toBe('right')
})

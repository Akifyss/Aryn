import { beforeEach, expect, it } from 'vitest'
import { createWorkbenchPane, WORKBENCH_FILES_ID, WORKBENCH_GIT_ID, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { createProjectWorkspacesSnapshot, loadWorkbenchLayout } from '../src/features/workbench/workbench-persistence'
import type { ProjectRecord } from '../src/features/workspace/types'

beforeEach(() => useWorkbenchStore.setState(useWorkbenchStore.getInitialState()))

it.each([WORKBENCH_FILES_ID, WORKBENCH_GIT_ID])('restores independent instances of %s in both panes', async id => {
  const project: ProjectRecord = { id: 'a', path: '/a', name: 'A', addedAt: '', lastOpenedAt: '', lastFilePath: null }
  const store = useWorkbenchStore.getState()
  store.switchProject(project, { panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, ratio: .5, focusedPane: 'left' })
  store.open('left', { id, kind: 'panel' })
  store.open('right', { id, kind: 'panel' })
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  const restored = await loadWorkbenchLayout(saved.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs[0]).toEqual(restored.panes.right.tabs[0])
  expect(restored.panes.left.tabs[0]).not.toBe(restored.panes.right.tabs[0])
})

it.each([WORKBENCH_FILES_ID, WORKBENCH_GIT_ID])('moves %s in both directions, keeping source identity and pane preferences', id => {
  const store = useWorkbenchStore.getState()
  store.open('left', { id, kind: 'panel' })
  store.open('right', { id, kind: 'panel' })
  store.open('right', { id: 'peer', kind: 'document' })
  store.toggleDirectory('right')
  store.setDirectoryTab('left', 'conversation')
  store.setDirectoryTab('right', 'git')
  const source = useWorkbenchStore.getState().panes.left.tabs[0]
  const states: unknown[] = []
  const stop = useWorkbenchStore.subscribe(state => states.push(state.panes))
  store.moveTab('left', id)
  stop()
  expect(states).toHaveLength(1)
  expect(useWorkbenchStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '', directoryOpen: true, directoryTab: 'conversation' })
  expect(useWorkbenchStore.getState().panes.right).toMatchObject({ activeTabId: id, directoryOpen: false, directoryTab: 'git' })
  expect(useWorkbenchStore.getState().panes.right.tabs.map(tab => tab.id)).toEqual([id, 'peer'])
  expect(useWorkbenchStore.getState().panes.right.tabs[0]).toBe(source)
  store.moveTab('right', id)
  expect(useWorkbenchStore.getState().panes.left.tabs[0]).toBe(source)
  expect(useWorkbenchStore.getState().panes.right.activeTabId).toBe('peer')
  const moved = useWorkbenchStore.getState()
  store.moveTab('right', id)
  store.moveTab('left', 'app://workbench/start')
  expect(useWorkbenchStore.getState()).toBe(moved)
})

it('moves an inactive panel without changing the source active tab and guards restoration', () => {
  const store = useWorkbenchStore.getState()
  store.open('left', { id: WORKBENCH_FILES_ID, kind: 'panel' })
  store.open('left', { id: WORKBENCH_GIT_ID, kind: 'panel' })
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
  store.open('left', { id: WORKBENCH_GIT_ID, kind: 'panel' })
  store.moveTab('left', WORKBENCH_GIT_ID)
  const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  const restored = await loadWorkbenchLayout(saved.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs).toEqual([])
  expect(restored.panes.right.tabs).toEqual([{ id: WORKBENCH_GIT_ID, kind: 'panel' }])
  expect(restored.panes.right.activeTabId).toBe(WORKBENCH_GIT_ID)
  expect(restored.focusedPane).toBe('right')
})

import { beforeEach, expect, it } from 'vitest'
import { createDuoPane, DUO_FILES_ID, DUO_GIT_ID, useDuoStore } from '../src/features/duo/duo-state'
import { createDuoProjectsSnapshot, loadDuoLayout } from '../src/features/duo/duo-persistence'
import type { ProjectRecord } from '../src/features/workspace/types'

beforeEach(() => useDuoStore.setState(useDuoStore.getInitialState()))

it.each([DUO_FILES_ID, DUO_GIT_ID])('restores independent instances of %s in both panes', async id => {
  const project: ProjectRecord = { id: 'a', path: '/a', name: 'A', addedAt: '', lastOpenedAt: '', lastFilePath: null }
  const store = useDuoStore.getState()
  store.switchProject(project, { panes: { left: createDuoPane(), right: createDuoPane() }, ratio: .5, focusedPane: 'left' })
  store.open('left', { id, kind: 'panel' })
  store.open('right', { id, kind: 'panel' })
  const saved = createDuoProjectsSnapshot(useDuoStore.getState(), [])
  const restored = await loadDuoLayout(saved.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs[0]).toEqual(restored.panes.right.tabs[0])
  expect(restored.panes.left.tabs[0]).not.toBe(restored.panes.right.tabs[0])
})

it.each([DUO_FILES_ID, DUO_GIT_ID])('moves %s in both directions, keeping source identity and pane preferences', id => {
  const store = useDuoStore.getState()
  store.open('left', { id, kind: 'panel' })
  store.open('right', { id, kind: 'panel' })
  store.open('right', { id: 'peer', kind: 'document' })
  store.toggleDirectory('right')
  store.setDirectoryTab('left', 'conversation')
  store.setDirectoryTab('right', 'git')
  const source = useDuoStore.getState().panes.left.tabs[0]
  const states: unknown[] = []
  const stop = useDuoStore.subscribe(state => states.push(state.panes))
  store.moveTab('left', id)
  stop()
  expect(states).toHaveLength(1)
  expect(useDuoStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '', directoryOpen: true, directoryTab: 'conversation' })
  expect(useDuoStore.getState().panes.right).toMatchObject({ activeTabId: id, directoryOpen: false, directoryTab: 'git' })
  expect(useDuoStore.getState().panes.right.tabs.map(tab => tab.id)).toEqual([id, 'peer'])
  expect(useDuoStore.getState().panes.right.tabs[0]).toBe(source)
  store.moveTab('right', id)
  expect(useDuoStore.getState().panes.left.tabs[0]).toBe(source)
  expect(useDuoStore.getState().panes.right.activeTabId).toBe('peer')
  const moved = useDuoStore.getState()
  store.moveTab('right', id)
  store.moveTab('left', 'app://duo/start')
  expect(useDuoStore.getState()).toBe(moved)
})

it('moves an inactive panel without changing the source active tab and guards restoration', () => {
  const store = useDuoStore.getState()
  store.open('left', { id: DUO_FILES_ID, kind: 'panel' })
  store.open('left', { id: DUO_GIT_ID, kind: 'panel' })
  store.moveTab('left', DUO_FILES_ID)
  expect(useDuoStore.getState().panes.left.activeTabId).toBe(DUO_GIT_ID)
  expect(useDuoStore.getState().panes.right.activeTabId).toBe(DUO_FILES_ID)
  useDuoStore.setState({ restoring: true })
  const restoring = useDuoStore.getState()
  store.moveTab('left', DUO_GIT_ID)
  expect(useDuoStore.getState()).toBe(restoring)
})

it('persists panel ownership per project after a move', async () => {
  const project: ProjectRecord = { id: 'a', path: '/a', name: 'A', addedAt: '', lastOpenedAt: '', lastFilePath: null }
  const store = useDuoStore.getState()
  store.switchProject(project, { panes: { left: createDuoPane(), right: createDuoPane() }, ratio: .5, focusedPane: 'left' })
  store.open('left', { id: DUO_GIT_ID, kind: 'panel' })
  store.moveTab('left', DUO_GIT_ID)
  const saved = createDuoProjectsSnapshot(useDuoStore.getState(), [])
  const restored = await loadDuoLayout(saved.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs).toEqual([])
  expect(restored.panes.right.tabs).toEqual([{ id: DUO_GIT_ID, kind: 'panel' }])
  expect(restored.panes.right.activeTabId).toBe(DUO_GIT_ID)
  expect(restored.focusedPane).toBe('right')
})

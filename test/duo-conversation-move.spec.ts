import { beforeEach, expect, it } from 'vitest'
import { createDefaultDuoLayout, createDuoPane, DUO_FILES_ID, openDuoProjectSession, useDuoStore } from '../src/features/duo/duo-state'
import { createDuoProjectsSnapshot, loadDuoLayout } from '../src/features/duo/duo-persistence'
import type { ProjectRecord } from '../src/features/workspace/types'

const project: ProjectRecord = { id: 'a', name: 'A', path: '/a', addedAt: '', lastOpenedAt: '', lastFilePath: null }
beforeEach(() => {
  useDuoStore.setState({ ...useDuoStore.getInitialState(), project, initialized: true })
})

it.each(['left', 'right'] as const)('moves the same conversation from %s in one update, keeping adjacent tabs and the peer draft', from => {
  const to = from === 'left' ? 'right' : 'left'
  const store = useDuoStore.getState()
  store.open(from, { kind: 'panel', id: DUO_FILES_ID })
  openDuoProjectSession(from, project)
  const tab = useDuoStore.getState().panes[from].tabs[1]
  openDuoProjectSession(to, project)
  const peer = useDuoStore.getState().panes[to].tabs[0]
  const updates: unknown[] = []
  const stop = useDuoStore.subscribe(state => updates.push(state.panes))
  store.moveTab(from, tab.id)
  stop()
  const moved = useDuoStore.getState()
  expect(updates).toHaveLength(1)
  expect(moved.panes[from].activeTabId).toBe(DUO_FILES_ID)
  expect(moved.panes[to].tabs).toEqual([peer, tab])
  expect(moved.panes[to].tabs[1]).toBe(tab)
  expect(moved.focusedPane).toBe(to)
  expect(moved.panes[to].activeTabId).toBe(tab.id)
  store.moveTab(from, tab.id)
  expect(useDuoStore.getState()).toBe(moved)
  store.moveTab(to, tab.id)
  expect(useDuoStore.getState().panes[to].activeTabId).toBe(peer.id)
})

it('keeps the destination owner through delayed session creation, project switching and persistence', async () => {
  const store = useDuoStore.getState()
  openDuoProjectSession('left', project)
  const tab = useDuoStore.getState().panes.left.tabs[0]
  store.moveTab('left', tab.id)
  expect(useDuoStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '', directoryOpen: true, directoryTab: 'file' })
  const other = { ...project, id: 'b', path: '/b' }
  store.switchProject(other, createDefaultDuoLayout(other))
  // The completion retained the original pane hint before its async work began.
  store.setProjectSession('left', tab.id, { agentId: 'pi', sessionPath: '/a/session.jsonl' })
  const background = useDuoStore.getState().projectLayouts.a
  expect(background.panes.left.tabs).toEqual([])
  expect(background.panes.right.tabs[0]).toMatchObject({ id: tab.id, projectSession: { request: { kind: 'session', sessionPath: '/a/session.jsonl' } } })
  const snapshot = createDuoProjectsSnapshot(useDuoStore.getState(), [])
  const restored = await loadDuoLayout(snapshot.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs).toEqual([])
  expect(restored.panes.right.tabs).toHaveLength(1)
  expect(restored.panes.right.tabs[0]).toMatchObject({ id: tab.id, projectSession: { request: { sessionPath: '/a/session.jsonl' } } })
})

it('reopening a moved, materialized draft focuses its existing view without replaying the session request', () => {
  const store = useDuoStore.getState()
  openDuoProjectSession('left', project)
  const id = useDuoStore.getState().panes.left.activeTabId
  store.moveTab('left', id)
  store.setProjectSession('left', id, { agentId: 'pi', sessionPath: 'session' })
  const tab = useDuoStore.getState().panes.right.tabs[0]
  openDuoProjectSession('left', project, { agentId: 'pi', sessionPath: 'session', sessionLabel: 'History' })
  expect(useDuoStore.getState().panes.left.tabs).toEqual([])
  expect(useDuoStore.getState().panes.right.tabs).toEqual([tab])
  expect(useDuoStore.getState().panes.right.tabs[0]).toBe(tab)
  expect(useDuoStore.getState().focusedPane).toBe('right')
  openDuoProjectSession('left', project, { agentId: 'codex', sessionPath: 'session', sessionLabel: 'Different agent' })
  expect(useDuoStore.getState().panes.left.tabs).toHaveLength(1)
})

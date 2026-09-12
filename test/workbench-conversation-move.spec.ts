import { beforeEach, expect, it } from 'vitest'
import { createDefaultWorkbenchLayout, createWorkbenchPane, WORKBENCH_FILES_ID, openWorkbenchProjectSession, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { createProjectWorkspacesSnapshot, loadWorkbenchLayout } from '../src/features/workbench/workbench-persistence'
import type { ProjectRecord } from '../src/features/workspace/types'

const project: ProjectRecord = { id: 'a', name: 'A', path: '/a', addedAt: '', lastOpenedAt: '', lastFilePath: null }
beforeEach(() => {
  useWorkbenchStore.setState({ ...useWorkbenchStore.getInitialState(), project, initialized: true })
})

it.each(['left', 'right'] as const)('moves the same conversation from %s in one update, keeping adjacent tabs and the peer draft', from => {
  const to = from === 'left' ? 'right' : 'left'
  const store = useWorkbenchStore.getState()
  store.open(from, { kind: 'panel', id: WORKBENCH_FILES_ID })
  openWorkbenchProjectSession(from, project)
  const tab = useWorkbenchStore.getState().panes[from].tabs[1]
  openWorkbenchProjectSession(to, project)
  const peer = useWorkbenchStore.getState().panes[to].tabs[0]
  const updates: unknown[] = []
  const stop = useWorkbenchStore.subscribe(state => updates.push(state.panes))
  store.moveTab(from, tab.id)
  stop()
  const moved = useWorkbenchStore.getState()
  expect(updates).toHaveLength(1)
  expect(moved.panes[from].activeTabId).toBe(WORKBENCH_FILES_ID)
  expect(moved.panes[to].tabs).toEqual([peer, tab])
  expect(moved.panes[to].tabs[1]).toBe(tab)
  expect(moved.focusedPane).toBe(to)
  expect(moved.panes[to].activeTabId).toBe(tab.id)
  store.moveTab(from, tab.id)
  expect(useWorkbenchStore.getState()).toBe(moved)
  store.moveTab(to, tab.id)
  expect(useWorkbenchStore.getState().panes[to].activeTabId).toBe(peer.id)
})

it('keeps the destination owner through delayed session creation, project switching and persistence', async () => {
  const store = useWorkbenchStore.getState()
  openWorkbenchProjectSession('left', project)
  const tab = useWorkbenchStore.getState().panes.left.tabs[0]
  store.moveTab('left', tab.id)
  expect(useWorkbenchStore.getState().panes.left).toMatchObject({ tabs: [], activeTabId: '', directoryOpen: true, directoryTab: 'file' })
  const other = { ...project, id: 'b', path: '/b' }
  store.switchProject(other, createDefaultWorkbenchLayout(other))
  // The completion retained the original pane hint before its async work began.
  store.setProjectSession('left', tab.id, { agentId: 'pi', sessionPath: '/a/session.jsonl' })
  const background = useWorkbenchStore.getState().projectLayouts.a
  expect(background.panes.left.tabs).toEqual([])
  expect(background.panes.right.tabs[0]).toMatchObject({ id: tab.id, projectSession: { request: { kind: 'session', sessionPath: '/a/session.jsonl' } } })
  const snapshot = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
  const restored = await loadWorkbenchLayout(snapshot.layouts.a, {} as Window['appApi'], [project], [])
  expect(restored.panes.left.tabs).toEqual([])
  expect(restored.panes.right.tabs).toHaveLength(1)
  expect(restored.panes.right.tabs[0]).toMatchObject({ id: tab.id, projectSession: { request: { sessionPath: '/a/session.jsonl' } } })
})

it('reopening a moved, materialized draft focuses its existing view without replaying the session request', () => {
  const store = useWorkbenchStore.getState()
  openWorkbenchProjectSession('left', project)
  const id = useWorkbenchStore.getState().panes.left.activeTabId
  store.moveTab('left', id)
  store.setProjectSession('left', id, { agentId: 'pi', sessionPath: 'session' })
  const tab = useWorkbenchStore.getState().panes.right.tabs[0]
  openWorkbenchProjectSession('left', project, { agentId: 'pi', sessionPath: 'session', sessionLabel: 'History' })
  expect(useWorkbenchStore.getState().panes.left.tabs).toEqual([])
  expect(useWorkbenchStore.getState().panes.right.tabs).toEqual([tab])
  expect(useWorkbenchStore.getState().panes.right.tabs[0]).toBe(tab)
  expect(useWorkbenchStore.getState().focusedPane).toBe('right')
  openWorkbenchProjectSession('left', project, { agentId: 'codex', sessionPath: 'session', sessionLabel: 'Different agent' })
  expect(useWorkbenchStore.getState().panes.left.tabs).toHaveLength(1)
})

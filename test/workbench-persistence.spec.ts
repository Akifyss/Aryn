import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateStore, normalizeLayoutState } from '../electron/main/app-state'
import { normalizeWorkbenchLayout, type PersistedWorkbenchLayout, type PersistedWorkbenchTab } from '../electron/shared/contracts/workbench-layout'
import { createWorkbenchLayoutSnapshot, flushWorkbenchPersistence, loadWorkbenchLayout, startWorkbenchPersistence } from '../src/features/workbench/workbench-persistence'
import { createWorkbenchPane, createWorkbenchPanel, WORKBENCH_FILES_ID, WORKBENCH_GIT_ID, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'
import type { ProjectRecord } from '../src/features/workspace/types'
import type { ConversationRecord } from '../src/features/conversations/types'
import type { GitFileDiffResult } from '../src/features/git/types'

const project: ProjectRecord = { id: 'project', path: '/project', name: 'Project', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const conversation: ConversationRecord = { id: 'history', title: 'Hello', titleSource: 'user', createdAt: '', updatedAt: '', agentId: 'pi', status: 'active', workspacePath: '/history', agentSessionPath: '/history/session', lastMessagePreview: 'private message' }
const file: PersistedWorkbenchTab = { kind: 'file', id: 'old-file-id', path: '/other/readme.md', workspacePath: '/other', viewMode: 'meo' }
const roots: string[] = []
function snapshot(): PersistedWorkbenchLayout {
  return { version: 1, focusedPane: 'right', ratio: 0.63, panes: {
    left: { directoryOpen: false, directoryTab: 'git', activeTabId: 'history-tab', tabs: [file,
      { kind: 'conversation', id: 'history-tab', conversationId: 'history', projectId: null, session: null }] },
    right: { directoryOpen: true, directoryTab: 'conversation', activeTabId: 'project-tab', tabs: [
      { kind: 'panel', id: WORKBENCH_FILES_ID, panel: 'files' }, file,
      { kind: 'conversation', id: 'project-tab', conversationId: null, projectId: 'project', session: { agentId: 'pi', path: '/project/session', label: 'Work' } },
      { kind: 'conversation', id: 'draft-tab', conversationId: null, projectId: null, session: null }] },
  } }
}
function api() {
  return {
    resolveWorkspaceEditorKind: vi.fn<Window['appApi']['resolveWorkspaceEditorKind']>(async () => 'prose'),
    readWorkspaceFile: vi.fn(async () => 'fresh file content'),
    getWorkspaceFileUrl: vi.fn(async () => ({ url: 'file:///image.png' })),
    getGitFileDiff: vi.fn<Window['appApi']['getGitFileDiff']>(),
    getGitCommitFileDiff: vi.fn<Window['appApi']['getGitCommitFileDiff']>(),
  }
}
beforeEach(() => {
  useWorkbenchStore.setState({ initialized: false, project: null, projectLayouts: {}, savedProjects: {}, restoring: false, panes: { left: createWorkbenchPane(), right: createWorkbenchPane() }, focusedPane: 'left', ratio: 0.5 })
  useWorkspaceStore.getState().replaceTabs([], null)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Workbench durable layout', () => {
  it('retains every same-type panel ID, order and selection through disk and repeated restores', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-panel-instances-'))
    roots.push(root)
    const statePath = path.join(root, 'app-state.json')
    const store = useWorkbenchStore.getState()
    const panels = (['files', 'git', 'files', 'git'] as const).map(createWorkbenchPanel)
    panels.forEach(tab => store.open('left', tab))
    store.reorder('left', panels[3].id, panels[0].id, 'before')
    store.activate('left', panels[2].id)
    const saved = createWorkbenchLayoutSnapshot(useWorkbenchStore.getState(), [], project.path)
    await new AppStateStore(statePath).update(state => ({ ...state, layout: {
      ...state.layout, projectWorkspaces: { version: 1, layouts: { [project.id]: saved } },
    } }))
    const restarted = (await new AppStateStore(statePath).read()).layout.projectWorkspaces!.layouts[project.id]
    const bridge = api()
    const restored = await loadWorkbenchLayout(restarted, bridge, [project], [])
    expect(restored.panes.left.tabs).toEqual([panels[3], panels[0], panels[1], panels[2]])
    expect(restored.panes.left.activeTabId).toBe(panels[2].id)
    expect(restored.panes.right.tabs).toEqual([])
    const next = createWorkbenchLayoutSnapshot(restored, [], project.path)
    expect(next).toEqual(saved)
    expect((await loadWorkbenchLayout(next, bridge, [project], [])).panes).toEqual(restored.panes)
    expect(bridge.readWorkspaceFile).not.toHaveBeenCalled()
    expect(bridge.getGitFileDiff).not.toHaveBeenCalled()
  })

  it('migrates legacy project maps on disk and writes only the current schema', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-workspace-migration-'))
    roots.push(root)
    const statePath = path.join(root, 'app-state.json')
    const projects = { version: 1, layouts: { a: snapshot(), b: { ...snapshot(), ratio: 0.4 } } }
    await writeFile(statePath, JSON.stringify({
      settings: { layoutPreference: 'duo', theme: 'dark' },
      layout: { duoProjects: projects, duo: snapshot(), leftSidebarCollapsed: true, gitPanelLayout: 'tree' },
    }))
    const store = new AppStateStore(statePath)
    const migrated = await store.read()
    expect(migrated.layout.projectWorkspaces).toEqual(projects)
    expect(migrated.layout.legacyWorkspaceLayout).toEqual(snapshot())
    expect(migrated.layout.gitPanelLayout).toBe('tree')
    await store.update(state => ({ ...state, settings: { ...state.settings, theme: 'light' } }))
    const written = JSON.parse(await readFile(statePath, 'utf8'))
    expect(written.layout).not.toHaveProperty('duoProjects')
    expect(written.layout).not.toHaveProperty('duo')
    expect(written.layout).not.toHaveProperty('leftSidebarCollapsed')
    expect(written.settings).not.toHaveProperty('layoutPreference')
    expect((await new AppStateStore(statePath).read()).layout.projectWorkspaces).toEqual(projects)
  })

  it('prioritizes current project data including an empty map over legacy tabs', () => {
    const legacy = { version: 1, layouts: { old: snapshot() } }
    const empty = { version: 1, layouts: {} }
    expect(normalizeLayoutState({ projectWorkspaces: empty, duoProjects: legacy }).projectWorkspaces).toEqual(empty)
    const current = { version: 1, layouts: { current: { ...snapshot(), ratio: 0.4 } } }
    expect(normalizeLayoutState({ projectWorkspaces: current, duoProjects: legacy }).projectWorkspaces).toEqual(current)
    expect(normalizeLayoutState({ projectWorkspaces: { version: -1 }, duoProjects: legacy }).projectWorkspaces).toEqual(legacy)
  })

  it.each(['agent', 'editor', 'duo'])('ignores an old %s preference while preserving the legacy layout', async (layoutPreference) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-workbench-persistence-'))
    roots.push(root)
    const statePath = path.join(root, 'app-state.json')
    const saved = snapshot()
    await writeFile(statePath, JSON.stringify({ settings: { layoutPreference, theme: 'dark' }, layout: { duo: saved } }))
    const state = await new AppStateStore(statePath).read()
    expect(state.settings).not.toHaveProperty('layoutPreference')
    expect(state.settings.theme).toBe('dark')
    expect(state.layout.legacyWorkspaceLayout).toEqual(saved)
  })

  it('round trips both panes through the real atomic JSON store and a fresh store instance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-workbench-persistence-'))
    roots.push(root)
    const statePath = path.join(root, 'app-state.json')
    const store = new AppStateStore(statePath)
    const saved = snapshot()
    await store.update((state) => ({ ...state, layout: normalizeLayoutState({ ...state.layout, legacyWorkspaceLayout: saved }) }))
    await store.update((state) => ({ ...state, layout: normalizeLayoutState({ ...state.layout, gitPanelLayout: 'tree' }) }))
    const restarted = await new AppStateStore(statePath).read()
    expect(restarted.layout.legacyWorkspaceLayout).toEqual(saved)
    expect(restarted.layout.gitPanelLayout).toBe('tree')
    expect(JSON.parse(await readFile(statePath, 'utf8')).layout.legacyWorkspaceLayout).toEqual(saved)
    expect(normalizeLayoutState({}).legacyWorkspaceLayout).toBeUndefined()
  })

  it('restores tab order, active selections, shared files and session identities without changing pane ownership', async () => {
    const bridge = api()
    const saved = snapshot()
    const restored = await loadWorkbenchLayout(saved, bridge, [project], [conversation])
    const fileId = restored.documents[0].id
    expect(restored.panes.left).toMatchObject({ directoryOpen: false, directoryTab: 'git', activeTabId: 'history-tab', tabs: [{ id: fileId }, { id: 'history-tab' }] })
    expect(restored.panes.right).toMatchObject({ directoryOpen: true, directoryTab: 'conversation', activeTabId: 'project-tab', tabs: [
      { id: WORKBENCH_FILES_ID }, { id: fileId }, { id: 'project-tab', projectSession: { project, request: { kind: 'session', sessionPath: '/project/session' } } }, { id: 'draft-tab', conversationId: null },
    ] })
    expect(restored.focusedPane).toBe('right')
    expect(restored.ratio).toBe(0.63)
    expect(bridge.readWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(restored.documents).toHaveLength(1)
    expect(restored.documents[0]).toMatchObject({ content: 'fresh file content', isDirty: false, workspacePath: '/other', viewMode: 'meo' })
    const next = createWorkbenchLayoutSnapshot(restored, restored.documents, '/unrelated')
    expect(next.panes.left.tabs[0]).toMatchObject({ path: '/other/readme.md', workspacePath: '/other' })
    expect(JSON.stringify(next)).not.toContain('fresh file content')
    expect(JSON.stringify(next)).not.toContain('private message')
  })

  it('keeps explicit empty panes and rejects malformed or duplicate identities', () => {
    const saved = snapshot()
    saved.panes.left.tabs = []
    saved.panes.right.tabs = []
    expect(normalizeWorkbenchLayout(saved)?.panes).toEqual({
      left: { ...saved.panes.left, activeTabId: '' }, right: { ...saved.panes.right, activeTabId: '' },
    })
    const history = snapshot().panes.left.tabs[1]
    const dirty = { ...snapshot(), ratio: Infinity, panes: {
      left: { tabs: [history, history, { id: 'bad', kind: 'conversation', conversationId: 42 }, { id: 'start', kind: 'fallback' }], activeTabId: 'bad' },
      right: { tabs: [{ ...history, id: 'duplicate-on-right' }], activeTabId: 'duplicate-on-right' },
    } }
    expect(normalizeWorkbenchLayout(dirty)).toMatchObject({ ratio: 0.5, panes: { left: { tabs: [history], activeTabId: history.id }, right: { tabs: [], activeTabId: '' } } })
    expect(normalizeWorkbenchLayout({ version: 900 })).toBeUndefined()
  })

  it('drops removed files, conversation records and projects, then selects a surviving neighbor', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bridge = api()
    bridge.readWorkspaceFile.mockRejectedValue(new Error('ENOENT'))
    const restored = await loadWorkbenchLayout(snapshot(), bridge, [], [])
    expect(restored.documents).toEqual([])
    expect(restored.panes.left.tabs).toEqual([])
    expect(restored.panes.left.activeTabId).toBe('')
    expect(restored.panes.right.tabs.map((tab) => tab.id)).toEqual([WORKBENCH_FILES_ID, 'draft-tab'])
    expect(restored.panes.right.activeTabId).toBe('draft-tab')
  })

  it('checks binary existence and restores Meo diff mode and historical Git revisions', async () => {
    const bridge = api()
    bridge.resolveWorkspaceEditorKind.mockImplementation(async (filePath) => filePath.endsWith('.png') ? 'file' : 'prose')
    const diff = { source: { kind: 'commit', commit: { hash: 'abc', shortHash: 'abc' } }, change: { path: '/project/a.ts', scope: 'unstaged', relativePath: 'a.ts' }, repositoryRootPath: '/project' } as GitFileDiffResult
    bridge.getGitCommitFileDiff.mockResolvedValue(diff)
    const saved = snapshot()
    saved.panes.left.tabs = [
      { ...file, gitDiff: { scope: 'staged', mode: 'unified' } } as PersistedWorkbenchTab,
      { ...file, id: 'image', path: '/other/image.png', viewMode: 'file' } as PersistedWorkbenchTab,
      { kind: 'diff', id: 'revision', path: '/project/a.ts', workspacePath: '/project', scope: 'unstaged', commitHash: 'abc' },
    ]
    saved.panes.right.tabs = []
    const restored = await loadWorkbenchLayout(saved, bridge, [], [])
    expect(bridge.getWorkspaceFileUrl).toHaveBeenCalledWith('/other', '/other/image.png')
    expect(bridge.readWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(bridge.getGitCommitFileDiff).toHaveBeenCalledWith('/project', 'abc', '/project/a.ts')
    expect(restored.documents.find((tab) => tab.kind === 'file' && tab.viewMode === 'meo')).toMatchObject({ gitDiffRequest: { scope: 'staged', mode: 'unified' } })
    expect(restored.documents.some((tab) => tab.kind === 'diff')).toBe(true)
  })

  it('records a project draft becoming a session without changing its view key or request acknowledgement', () => {
    const store = useWorkbenchStore.getState()
    store.open('right', { kind: 'conversation', id: 'project-draft', conversationId: null, projectSession: { project, request: { kind: 'new', projectId: project.id, requestId: 42 } } })
    store.setProjectSession('right', 'project-draft', { agentId: 'pi', sessionPath: '/project/new-session' })
    const tab = useWorkbenchStore.getState().panes.right.tabs[0]
    expect(tab).toMatchObject({ id: 'project-draft', projectSession: { request: { requestId: 42, kind: 'session', sessionPath: '/project/new-session' } } })
    expect(createWorkbenchLayoutSnapshot(useWorkbenchStore.getState(), [], null).panes.right.tabs[0]).toMatchObject({ session: { agentId: 'pi', path: '/project/new-session' } })
  })

  it('does not write before hydration; flushes the latest close state and deduplicates unchanged snapshots', async () => {
    const write = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { appApi: { updateLayoutState: write }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    await flushWorkbenchPersistence()
    expect(write).not.toHaveBeenCalled()
    useWorkbenchStore.setState({ initialized: true, project })
    const stop = startWorkbenchPersistence()
    try {
      useWorkbenchStore.getState().open('left', { kind: 'panel', id: WORKBENCH_GIT_ID, panel: 'git' })
      await flushWorkbenchPersistence()
      useWorkbenchStore.getState().close('left', WORKBENCH_GIT_ID)
      useWorkbenchStore.getState().toggleDirectory('right')
      await flushWorkbenchPersistence() // Window close must not wait for the debounce timer.
      expect(write).toHaveBeenLastCalledWith({ projectWorkspaces: { version: 1, layouts: { project: expect.objectContaining({ panes: {
        left: expect.objectContaining({ tabs: [], activeTabId: '' }), right: expect.objectContaining({ directoryOpen: false }),
      } }) } } })
      const count = write.mock.calls.length
      await flushWorkbenchPersistence()
      expect(write).toHaveBeenCalledTimes(count)
    } finally { stop(); await flushWorkbenchPersistence() }
  })

  it('retries a failed write instead of considering the snapshot saved', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue({ ok: true })
    vi.stubGlobal('window', { appApi: { updateLayoutState: write } })
    useWorkbenchStore.setState({ initialized: true, project, ratio: 0.71 })
    await expect(flushWorkbenchPersistence()).rejects.toThrow('disk unavailable')
    await flushWorkbenchPersistence()
    expect(write).toHaveBeenCalledTimes(2)
  })
})

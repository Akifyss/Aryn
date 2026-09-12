import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppStateStore, normalizeLayoutState } from '../electron/main/app-state'
import { normalizeDuoLayout, type PersistedDuoLayout, type PersistedDuoTab } from '../electron/shared/contracts/duo-layout'
import { createDuoLayoutSnapshot, flushDuoPersistence, loadDuoLayout, startDuoPersistence } from '../src/features/duo/duo-persistence'
import { createDuoPane, DUO_FILES_ID, DUO_GIT_ID, useDuoStore } from '../src/features/duo/duo-state'
import { useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'
import type { ProjectRecord } from '../src/features/workspace/types'
import type { ConversationRecord } from '../src/features/conversations/types'
import type { GitFileDiffResult } from '../src/features/git/types'

const project: ProjectRecord = { id: 'project', path: '/project', name: 'Project', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const conversation: ConversationRecord = { id: 'history', title: 'Hello', titleSource: 'user', createdAt: '', updatedAt: '', agentId: 'pi', status: 'active', workspacePath: '/history', agentSessionPath: '/history/session', lastMessagePreview: 'private message' }
const file: PersistedDuoTab = { kind: 'file', id: 'old-file-id', path: '/other/readme.md', workspacePath: '/other', viewMode: 'meo' }
const roots: string[] = []
function snapshot(): PersistedDuoLayout {
  return { version: 1, focusedPane: 'right', ratio: 0.63, panes: {
    left: { directoryOpen: false, directoryTab: 'git', activeTabId: 'history-tab', tabs: [file,
      { kind: 'conversation', id: 'history-tab', conversationId: 'history', projectId: null, session: null }] },
    right: { directoryOpen: true, directoryTab: 'conversation', activeTabId: 'project-tab', tabs: [
      { kind: 'panel', id: DUO_FILES_ID, panel: 'files' }, file,
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
  useDuoStore.setState({ initialized: false, project: null, projectLayouts: {}, savedProjects: {}, restoring: false, panes: { left: createDuoPane(), right: createDuoPane() }, focusedPane: 'left', ratio: 0.5 })
  useWorkspaceStore.getState().replaceTabs([], null)
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('Duo durable layout', () => {
  it.each(['agent', 'editor'])('restores an old %s preference as Duo without resetting either pane', async (layoutPreference) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-duo-persistence-'))
    roots.push(root)
    const statePath = path.join(root, 'app-state.json')
    const saved = snapshot()
    await writeFile(statePath, JSON.stringify({ settings: { layoutPreference, theme: 'dark' }, layout: { duo: saved } }))
    const state = await new AppStateStore(statePath).read()
    expect(state.settings.layoutPreference).toBe('duo')
    expect(state.settings.theme).toBe('dark')
    expect(state.layout.duo).toEqual(saved)
  })

  it('round trips both panes through the real atomic JSON store and a fresh store instance', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-duo-persistence-'))
    roots.push(root)
    const statePath = path.join(root, 'app-state.json')
    const store = new AppStateStore(statePath)
    const saved = snapshot()
    await store.update((state) => ({ ...state, layout: normalizeLayoutState({ ...state.layout, duo: saved }) }))
    await store.update((state) => ({ ...state, layout: normalizeLayoutState({ ...state.layout, leftSidebarWidth: 350 }) }))
    const restarted = await new AppStateStore(statePath).read()
    expect(restarted.layout.duo).toEqual(saved)
    expect(restarted.layout.leftSidebarWidth).toBe(350)
    expect(JSON.parse(await readFile(statePath, 'utf8')).layout.duo).toEqual(saved)
    expect(normalizeLayoutState({}).duo).toBeUndefined()
  })

  it('restores tab order, active selections, shared files and session identities without changing pane ownership', async () => {
    const bridge = api()
    const saved = snapshot()
    const restored = await loadDuoLayout(saved, bridge, [project], [conversation])
    const fileId = restored.documents[0].id
    expect(restored.panes.left).toMatchObject({ directoryOpen: false, directoryTab: 'git', activeTabId: 'history-tab', tabs: [{ id: fileId }, { id: 'history-tab' }] })
    expect(restored.panes.right).toMatchObject({ directoryOpen: true, directoryTab: 'conversation', activeTabId: 'project-tab', tabs: [
      { id: DUO_FILES_ID }, { id: fileId }, { id: 'project-tab', projectSession: { project, request: { kind: 'session', sessionPath: '/project/session' } } }, { id: 'draft-tab', conversationId: null },
    ] })
    expect(restored.focusedPane).toBe('right')
    expect(restored.ratio).toBe(0.63)
    expect(bridge.readWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(restored.documents).toHaveLength(1)
    expect(restored.documents[0]).toMatchObject({ content: 'fresh file content', isDirty: false, workspacePath: '/other', viewMode: 'meo' })
    const next = createDuoLayoutSnapshot(restored, restored.documents, '/unrelated')
    expect(next.panes.left.tabs[0]).toMatchObject({ path: '/other/readme.md', workspacePath: '/other' })
    expect(JSON.stringify(next)).not.toContain('fresh file content')
    expect(JSON.stringify(next)).not.toContain('private message')
  })

  it('keeps explicit empty panes and rejects malformed or duplicate identities', () => {
    const saved = snapshot()
    saved.panes.left.tabs = []
    saved.panes.right.tabs = []
    expect(normalizeDuoLayout(saved)?.panes).toEqual({
      left: { ...saved.panes.left, activeTabId: '' }, right: { ...saved.panes.right, activeTabId: '' },
    })
    const history = snapshot().panes.left.tabs[1]
    const dirty = { ...snapshot(), ratio: Infinity, panes: {
      left: { tabs: [history, history, { id: 'bad', kind: 'conversation', conversationId: 42 }, { id: 'start', kind: 'fallback' }], activeTabId: 'bad' },
      right: { tabs: [{ ...history, id: 'duplicate-on-right' }], activeTabId: 'duplicate-on-right' },
    } }
    expect(normalizeDuoLayout(dirty)).toMatchObject({ ratio: 0.5, panes: { left: { tabs: [history], activeTabId: history.id }, right: { tabs: [], activeTabId: '' } } })
    expect(normalizeDuoLayout({ version: 900 })).toBeUndefined()
  })

  it('drops removed files, conversation records and projects, then selects a surviving neighbor', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bridge = api()
    bridge.readWorkspaceFile.mockRejectedValue(new Error('ENOENT'))
    const restored = await loadDuoLayout(snapshot(), bridge, [], [])
    expect(restored.documents).toEqual([])
    expect(restored.panes.left.tabs).toEqual([])
    expect(restored.panes.left.activeTabId).toBe('')
    expect(restored.panes.right.tabs.map((tab) => tab.id)).toEqual([DUO_FILES_ID, 'draft-tab'])
    expect(restored.panes.right.activeTabId).toBe('draft-tab')
  })

  it('checks binary existence and restores Meo diff mode and historical Git revisions', async () => {
    const bridge = api()
    bridge.resolveWorkspaceEditorKind.mockImplementation(async (filePath) => filePath.endsWith('.png') ? 'file' : 'prose')
    const diff = { source: { kind: 'commit', commit: { hash: 'abc', shortHash: 'abc' } }, change: { path: '/project/a.ts', scope: 'unstaged', relativePath: 'a.ts' }, repositoryRootPath: '/project' } as GitFileDiffResult
    bridge.getGitCommitFileDiff.mockResolvedValue(diff)
    const saved = snapshot()
    saved.panes.left.tabs = [
      { ...file, gitDiff: { scope: 'staged', mode: 'unified' } } as PersistedDuoTab,
      { ...file, id: 'image', path: '/other/image.png', viewMode: 'file' } as PersistedDuoTab,
      { kind: 'diff', id: 'revision', path: '/project/a.ts', workspacePath: '/project', scope: 'unstaged', commitHash: 'abc' },
    ]
    saved.panes.right.tabs = []
    const restored = await loadDuoLayout(saved, bridge, [], [])
    expect(bridge.getWorkspaceFileUrl).toHaveBeenCalledWith('/other', '/other/image.png')
    expect(bridge.readWorkspaceFile).toHaveBeenCalledTimes(1)
    expect(bridge.getGitCommitFileDiff).toHaveBeenCalledWith('/project', 'abc', '/project/a.ts')
    expect(restored.documents.find((tab) => tab.kind === 'file' && tab.viewMode === 'meo')).toMatchObject({ gitDiffRequest: { scope: 'staged', mode: 'unified' } })
    expect(restored.documents.some((tab) => tab.kind === 'diff')).toBe(true)
  })

  it('records a project draft becoming a session without changing its view key or request acknowledgement', () => {
    const store = useDuoStore.getState()
    store.open('right', { kind: 'conversation', id: 'project-draft', conversationId: null, projectSession: { project, request: { kind: 'new', projectId: project.id, requestId: 42 } } })
    store.setProjectSession('right', 'project-draft', { agentId: 'pi', sessionPath: '/project/new-session' })
    const tab = useDuoStore.getState().panes.right.tabs[0]
    expect(tab).toMatchObject({ id: 'project-draft', projectSession: { request: { requestId: 42, kind: 'session', sessionPath: '/project/new-session' } } })
    expect(createDuoLayoutSnapshot(useDuoStore.getState(), [], null).panes.right.tabs[0]).toMatchObject({ session: { agentId: 'pi', path: '/project/new-session' } })
  })

  it('does not write before hydration; flushes the latest close state and deduplicates unchanged snapshots', async () => {
    const write = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('window', { appApi: { updateLayoutState: write }, addEventListener: vi.fn(), removeEventListener: vi.fn() })
    await flushDuoPersistence()
    expect(write).not.toHaveBeenCalled()
    useDuoStore.setState({ initialized: true, project })
    const stop = startDuoPersistence()
    try {
      useDuoStore.getState().open('left', { kind: 'panel', id: DUO_GIT_ID })
      await flushDuoPersistence()
      useDuoStore.getState().close('left', DUO_GIT_ID)
      useDuoStore.getState().toggleDirectory('right')
      await flushDuoPersistence() // Window close must not wait for the debounce timer.
      expect(write).toHaveBeenLastCalledWith({ duoProjects: { version: 1, layouts: { project: expect.objectContaining({ panes: {
        left: expect.objectContaining({ tabs: [], activeTabId: '' }), right: expect.objectContaining({ directoryOpen: false }),
      } }) } } })
      const count = write.mock.calls.length
      await flushDuoPersistence()
      expect(write).toHaveBeenCalledTimes(count)
    } finally { stop(); await flushDuoPersistence() }
  })

  it('retries a failed write instead of considering the snapshot saved', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('disk unavailable')).mockResolvedValue({ ok: true })
    vi.stubGlobal('window', { appApi: { updateLayoutState: write } })
    useDuoStore.setState({ initialized: true, project, ratio: 0.71 })
    await expect(flushDuoPersistence()).rejects.toThrow('disk unavailable')
    await flushDuoPersistence()
    expect(write).toHaveBeenCalledTimes(2)
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { toast } from '@heroui/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeProjectWorkspaces, type PersistedWorkbenchLayout } from '../electron/shared/contracts/workbench-layout'
import { createDefaultWorkbenchLayout, hasOtherWorkbenchDocumentOwner, useWorkbenchStore } from '../src/features/workbench/workbench-state'
import { createProjectWorkspacesSnapshot } from '../src/features/workbench/workbench-persistence'
import { migrateWorkbenchProjectLayouts, scopeWorkbenchLayout } from '../src/features/workbench/workbench-project-layouts'
import { useWorkspaceProjectController } from '../src/features/workspace/hooks/use-workspace-project-controller'
import { WorkspaceNavigationCoordinator } from '../src/features/workspace/lib/workspace-navigation-coordinator'
import { useWorkspaceStore } from '../src/features/workspace/store/use-workspace-store'
import { toStoredWorkspaceTab } from '../src/features/workspace/lib/workspace-tab-persistence'
import type { ProjectRecord } from '../src/features/workspace/types'

const a: ProjectRecord = { id: 'a', name: 'Same name', path: '/a', addedAt: '', lastOpenedAt: '', lastFilePath: null }
const b: ProjectRecord = { ...a, id: 'b', path: '/b' }
beforeEach(() => {
  vi.spyOn(toast, 'danger').mockReturnValue('test-toast')
  useWorkbenchStore.setState({ ...useWorkbenchStore.getInitialState() })
  useWorkspaceStore.setState({ currentPath: '/a', openTabs: [], activeTabId: null })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('project-owned workspaces', () => {
  it('removes closed shared documents from inactive project layouts as well', () => {
    const store = useWorkbenchStore.getState()
    store.switchProject(a, createDefaultWorkbenchLayout(a))
    store.open('left', { kind: 'document', id: 'deleted' })
    store.switchProject(b, createDefaultWorkbenchLayout(b))
    store.open('right', { kind: 'document', id: 'deleted' })
    store.reconcileDocuments(new Set())
    expect(useWorkbenchStore.getState().projectLayouts.a.panes.left.tabs.some(tab => tab.id === 'deleted')).toBe(false)
    expect(useWorkbenchStore.getState().panes.right.tabs.some(tab => tab.id === 'deleted')).toBe(false)
    store.open('right', { kind: 'document', id: 'deleted' })
    expect(hasOtherWorkbenchDocumentOwner(useWorkbenchStore.getState(), 'right', 'deleted')).toBe(false)
  })

  it('separates identical project names and retains shared file ownership and renames', () => {
    const store = useWorkbenchStore.getState()
    store.switchProject(a, createDefaultWorkbenchLayout(a))
    store.open('left', { kind: 'document', id: 'old' })
    store.setRatio(.62)
    store.switchProject(b, createDefaultWorkbenchLayout(b))
    store.open('right', { kind: 'document', id: 'old' })
    expect(hasOtherWorkbenchDocumentOwner(useWorkbenchStore.getState(), 'right', 'old')).toBe(true)
    store.renameDocument('old', 'new')
    store.close('right', 'new')
    const state = useWorkbenchStore.getState()
    expect(state.projectLayouts.a.panes.left.activeTabId).toBe('new')
    expect(state.projectLayouts.a.ratio).toBe(.62)
    expect(state.ratio).toBe(.5)
    store.switchProject(a, state.projectLayouts.a)
    expect(hasOtherWorkbenchDocumentOwner(useWorkbenchStore.getState(), 'left', 'new')).toBe(false)
    expect(useWorkbenchStore.getState().panes.left.tabs.at(-1)).toEqual({ kind: 'document', id: 'new' })
  })

  it('saves a background session into its original project, without replacing its draft view key', () => {
    const store = useWorkbenchStore.getState()
    store.switchProject(a, createDefaultWorkbenchLayout(a))
    const draftId = useWorkbenchStore.getState().panes.left.activeTabId
    store.switchProject(b, createDefaultWorkbenchLayout(b))
    store.setProjectSession('left', draftId, { agentId: 'pi', sessionPath: '/a/session' })
    const saved = createProjectWorkspacesSnapshot(useWorkbenchStore.getState(), [])
    expect(saved.layouts.a.panes.left.tabs[0]).toMatchObject({ id: draftId, projectId: 'a', session: { path: '/a/session' } })
    expect(saved.layouts.b.panes.left.tabs[0]).toMatchObject({ projectId: 'b', session: null })
  })

  it('migrates by durable ownership and Windows paths, retaining the legacy archive', () => {
    const projectA = { ...a, path: 'C:/Work/A' }
    const projectB = { ...b, path: 'D:/Work/B' }
    const pane = { directoryOpen: true, directoryTab: 'file' as const, activeTabId: '', tabs: [] }
    const legacy: PersistedWorkbenchLayout = { version: 1, ratio: .6, focusedPane: 'right', panes: {
      left: { ...pane, tabs: [
        { id: 'a', kind: 'file', path: 'c:\\work\\a\\note.md', workspacePath: null, viewMode: 'code' },
        { id: 'b', kind: 'conversation', conversationId: null, projectId: 'b', session: null },
        { id: 'standalone', kind: 'conversation', conversationId: 'old', projectId: null, session: null },
      ] }, right: pane,
    } }
    const saved = migrateWorkbenchProjectLayouts(legacy, [projectA, projectB], projectA)
    expect(saved.a.panes.left.tabs.map(tab => tab.id)).toEqual(['a'])
    expect(saved.b.panes.left.tabs.map(tab => tab.id)).toEqual(['b'])
    expect(legacy.panes.left.tabs).toHaveLength(3)
    expect(scopeWorkbenchLayout(legacy, projectA).panes.left.tabs.map(tab => tab.id)).toEqual(['a'])
    expect(normalizeProjectWorkspaces({ version: 1, layouts: { a: saved.a, invalid: { version: 5 } } })?.layouts).toEqual({ a: saved.a })
    expect(normalizeProjectWorkspaces({ version: 1, layouts: [] })).toBeUndefined()
  })
})

function projectController(failRoot?: string) {
  const document = toStoredWorkspaceTab('/a/note.md', 'unsaved', 'prose', 'meo')
  document.isDirty = true
  useWorkspaceStore.getState().replaceTabs([document], document.id)
  const api = {
    setActiveProject: vi.fn(async (id: string) => id === 'a' ? a : b),
    stopWorkspaceWatch: vi.fn(async () => {}), startWorkspaceWatch: vi.fn(async () => {}),
    updateWorkspaceState: vi.fn(async () => {}),
    addExistingProject: vi.fn(async () => ({ projects: [a, b], lastProjectId: b.id })),
    createEmptyProject: vi.fn(async () => ({ projects: [a, b], lastProjectId: b.id })),
  }
  vi.stubGlobal('window', { appApi: api })
  const options = {
    activeWorkspaceContext: { kind: 'project' as const, projectId: a.id },
    preserveProjectTabs: true,
    confirmDiscardDirtyTabs: vi.fn(async () => false), currentPathRef: { current: '/a' as string | null },
    flushWorkspaceAutosave: vi.fn(async () => false), flushDiffAutosave: vi.fn(async () => false),
    loadTree: vi.fn(async (root: string) => { if (root === failRoot) throw new Error('unavailable'); return true }),
    navigationCoordinator: new WorkspaceNavigationCoordinator(),
    prepareGitWorkspace: vi.fn(), refreshGitState: vi.fn(async () => {}), requestConfirmation: vi.fn(async () => true),
    resetExpandedPaths: vi.fn(), resetGitWorkspaceState: vi.fn(), restoreWorkspaceTabs: vi.fn(async () => {}),
    setActiveWorkspaceContext: vi.fn(), setAgentWorkspaceState: vi.fn(), setStatusMessage: vi.fn(),
  }
  let controller!: ReturnType<typeof useWorkspaceProjectController>
  function Probe() { controller = useWorkspaceProjectController(options); return null }
  renderToStaticMarkup(<Probe />)
  return { controller, options, document, api }
}

describe('project navigation integration', () => {
  it.each(['select', 'add', 'create'])('%s connects the root without discarding buffers or running the old Tab restore', async action => {
    const { controller, options, document } = projectController()
    if (action === 'select') await controller.selectProject(b)
    if (action === 'add') await controller.addExistingProject()
    if (action === 'create') await controller.createEmptyProject('B')
    expect(useWorkspaceStore.getState().currentPath).toBe('/b')
    expect(useWorkspaceStore.getState().openTabs).toEqual([document])
    expect(options.confirmDiscardDirtyTabs).not.toHaveBeenCalled()
    expect(options.restoreWorkspaceTabs).not.toHaveBeenCalled()
  })

  it('rolls back failed project selection and keeps the previous files', async () => {
    const { controller, options, document, api } = projectController('/b')
    await controller.selectProject(b)
    expect(options.setActiveWorkspaceContext).toHaveBeenLastCalledWith({ kind: 'project', projectId: 'a' })
    expect(api.setActiveProject).toHaveBeenLastCalledWith('a')
    expect(useWorkspaceStore.getState().currentPath).toBe('/a')
    expect(useWorkspaceStore.getState().openTabs).toEqual([document])
  })
})

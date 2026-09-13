import { normalizeWorkbenchLayout, type PersistedWorkbenchLayout, type PersistedProjectWorkspaces, type PersistedWorkbenchTab } from '../../../electron/shared/contracts/workbench-layout'
import type { ConversationRecord } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'
import { normalizeWorkspaceFileViewMode } from '@/features/workspace/lib/file-types'
import { toStoredWorkspaceTab } from '@/features/workspace/lib/workspace-tab-persistence'
import { createDiffTab } from '@/features/workspace/lib/workspace-tabs'
import { useWorkspaceStore, type WorkspaceTab } from '@/features/workspace/store/use-workspace-store'
import { createWorkbenchPane, createWorkbenchPanel, WORKBENCH_PANE_IDS, getWorkbenchProjectLayouts, useWorkbenchStore, type WorkbenchState, type WorkbenchTab } from './workbench-state'

export function createWorkbenchLayoutSnapshot(state: Pick<WorkbenchState, 'panes' | 'ratio' | 'focusedPane'>, documents: WorkspaceTab[], workspacePath: string | null): PersistedWorkbenchLayout {
  const byId = new Map(documents.map((tab) => [tab.id, tab]))
  const serialize = (tab: WorkbenchTab): PersistedWorkbenchTab | null => {
    if (tab.kind === 'panel') return { id: tab.id, kind: 'panel', panel: tab.panel }
    if (tab.kind === 'conversation') {
      const request = tab.projectSession?.request
      return { id: tab.id, kind: 'conversation', conversationId: tab.conversationId,
        projectId: tab.projectSession?.project.id ?? null,
        session: request?.kind === 'session' ? { agentId: request.agentId, path: request.sessionPath, label: request.sessionLabel } : null }
    }
    const document = byId.get(tab.id)
    if (!document) return null
    if (document.kind === 'file') return { id: tab.id, kind: 'file', path: document.filePath, workspacePath: document.workspacePath ?? workspacePath, viewMode: document.viewMode,
      ...(document.gitDiffRequest ? { gitDiff: { scope: document.gitDiffRequest.scope, mode: document.gitDiffRequest.mode } } : {}) }
    return { id: tab.id, kind: 'diff', path: document.diff.change.path, workspacePath: document.diff.repositoryRootPath,
      scope: document.diff.change.scope, commitHash: document.diff.source.kind === 'commit' ? document.diff.source.commit.hash : null }
  }
  const pane = (id: 'left' | 'right') => ({ ...state.panes[id], tabs: state.panes[id].tabs.flatMap((tab) => {
    const saved = serialize(tab)
    return saved ? [saved] : []
  }) })
  return normalizeWorkbenchLayout({ version: 1, focusedPane: state.focusedPane, ratio: state.ratio, panes: { left: pane('left'), right: pane('right') } })!
}

type RestoreApi = Pick<Window['appApi'], 'resolveWorkspaceEditorKind' | 'readWorkspaceFile' | 'getGitFileDiff' | 'getGitCommitFileDiff' | 'getWorkspaceFileUrl'>

// Build a complete restore result before publishing anything to either store.
// Bootstrap and StrictMode cancellation can discard it without partial tabs.
export async function loadWorkbenchLayout(snapshot: PersistedWorkbenchLayout, api: RestoreApi, projects: ProjectRecord[], conversations: ConversationRecord[]) {
  const documents = new Map<string, WorkspaceTab>()
  const loads = new Map<string, Promise<WorkbenchTab | null>>()
  const panelIds = new Set<string>()
  const loadTab = (tab: PersistedWorkbenchTab): Promise<WorkbenchTab | null> => {
    if (tab.kind === 'panel') {
      if (tab.panel === 'conversations') return Promise.resolve(null)
      // Old layouts could use one fixed ID in both panes. Preserve both views,
      // assigning the second a unique identity that subsequent saves retain.
      const panel = panelIds.has(tab.id) ? createWorkbenchPanel(tab.panel) : { ...tab }
      panelIds.add(panel.id)
      return Promise.resolve(panel)
    }
    const key = JSON.stringify(tab)
    if (loads.has(key)) return loads.get(key)!
    const pending = (async (): Promise<WorkbenchTab | null> => {
      if (tab.kind === 'conversation') {
        if (tab.conversationId) return conversations.some((item) => item.id === tab.conversationId)
          ? { kind: 'conversation', id: tab.id, conversationId: tab.conversationId } : null
        if (!tab.projectId) return { kind: 'conversation', id: tab.id, conversationId: null }
        const project = projects.find((item) => item.id === tab.projectId)
        if (!project) return null
        return { kind: 'conversation', id: tab.id, conversationId: null, projectSession: { project,
          request: tab.session ? { kind: 'session', projectId: project.id, requestId: 0,
            agentId: tab.session.agentId, sessionPath: tab.session.path, sessionLabel: tab.session.label }
            : { kind: 'new', projectId: project.id, requestId: 0 } } }
      }
      try {
        let document: WorkspaceTab
        if (tab.kind === 'file') {
          const editorKind = await api.resolveWorkspaceEditorKind(tab.path)
          if (!editorKind) return null
          // Binary viewers do not read text; resolve their URL to check existence.
          if (editorKind === 'file') await api.getWorkspaceFileUrl(tab.workspacePath ?? tab.path, tab.path)
          const content = editorKind === 'file' ? '' : await api.readWorkspaceFile(tab.path)
          document = { ...toStoredWorkspaceTab(tab.path, content, editorKind, normalizeWorkspaceFileViewMode(tab.path, editorKind, tab.viewMode)), workspacePath: tab.workspacePath }
          if (tab.gitDiff) document.gitDiffRequest = { ...tab.gitDiff, source: 'worktree', requestKey: `restore:${tab.id}:${Date.now()}` }
        } else {
          const diff = tab.commitHash
            ? await api.getGitCommitFileDiff(tab.workspacePath, tab.commitHash, tab.path)
            : await api.getGitFileDiff(tab.workspacePath, tab.path, tab.scope)
          document = createDiffTab(diff)
        }
        documents.set(document.id, document)
        return { kind: 'document', id: document.id }
      } catch (error) {
        console.warn('[workbench] Skipped an unavailable tab during restore.', tab.id, error)
        return null
      }
    })()
    loads.set(key, pending)
    return pending
  }
  const restorePane = async (id: 'left' | 'right') => {
    const saved = snapshot.panes[id]
    const loaded = await Promise.all(saved.tabs.map(loadTab))
    const tabs = loaded.filter((tab): tab is WorkbenchTab => tab !== null)
      .filter((tab, index, all) => all.findIndex((item) => item.id === tab.id) === index)
    const activeIndex = saved.tabs.findIndex((tab) => tab.id === saved.activeTabId)
    const activeTabId = loaded[activeIndex]?.id ?? loaded.slice(activeIndex + 1).find(Boolean)?.id
      ?? loaded.slice(0, Math.max(0, activeIndex)).reverse().find(Boolean)?.id ?? tabs[0]?.id ?? ''
    return { ...createWorkbenchPane(), directoryOpen: saved.directoryOpen, directoryTab: saved.directoryTab, tabs, activeTabId }
  }
  const [left, right] = await Promise.all(WORKBENCH_PANE_IDS.map(restorePane))
  return { panes: { left, right }, documents: [...documents.values()], ratio: snapshot.ratio, focusedPane: snapshot.focusedPane }
}

let timer: ReturnType<typeof setTimeout> | undefined
let lastSerialized = ''
let lastWrite: Promise<unknown> = Promise.resolve()

export function createProjectWorkspacesSnapshot(state: WorkbenchState, documents: WorkspaceTab[]): PersistedProjectWorkspaces {
  const layouts = { ...state.savedProjects }
  for (const [id, layout] of Object.entries(getWorkbenchProjectLayouts(state))) {
    layouts[id] = createWorkbenchLayoutSnapshot(layout, documents, layout.project.path)
  }
  return { version: 1, layouts }
}

export async function flushWorkbenchPersistence() {
  clearTimeout(timer)
  timer = undefined
  const state = useWorkbenchStore.getState()
  if (!state.initialized || typeof window === 'undefined' || !window.appApi?.updateLayoutState) return
  const workspace = useWorkspaceStore.getState()
  const snapshot = createProjectWorkspacesSnapshot(state, workspace.openTabs)
  const serialized = JSON.stringify(snapshot)
  if (serialized === lastSerialized) { await lastWrite; return }
  lastSerialized = serialized
  const previous = lastWrite
  lastWrite = previous.catch(() => {}).then(() => window.appApi.updateLayoutState({ projectWorkspaces: snapshot })).catch((error) => {
    if (lastSerialized === serialized) lastSerialized = '' // Permit a later retry.
    throw error
  })
  await lastWrite
}

export function startWorkbenchPersistence() {
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { void flushWorkbenchPersistence().catch((error) => console.error('[workbench] Failed to save layout.', error)) }, 150)
  }
  const unsubscribeWorkbench = useWorkbenchStore.subscribe(save)
  const unsubscribeDocuments = useWorkspaceStore.subscribe((next, previous) => {
    if (next.openTabs !== previous.openTabs || next.currentPath !== previous.currentPath) save()
  })
  const flush = () => { void flushWorkbenchPersistence().catch((error) => console.error('[workbench] Failed to save layout.', error)) }
  window.addEventListener('pagehide', flush)
  save()
  return () => { unsubscribeWorkbench(); unsubscribeDocuments(); window.removeEventListener('pagehide', flush); flush() }
}

import { normalizeDuoLayout, type PersistedDuoLayout, type PersistedDuoProjects, type PersistedDuoTab } from '../../../electron/shared/contracts/duo-layout'
import type { ConversationRecord } from '@/features/conversations/types'
import type { ProjectRecord } from '@/features/workspace/types'
import { normalizeWorkspaceFileViewMode } from '@/features/workspace/lib/file-types'
import { toStoredWorkspaceTab } from '@/features/workspace/lib/workspace-tab-persistence'
import { createDiffTab } from '@/features/workspace/lib/workspace-tabs'
import { useWorkspaceStore, type WorkspaceTab } from '@/features/workspace/store/use-workspace-store'
import { createDuoPane, DUO_PANE_IDS, getDuoProjectLayouts, useDuoStore, type DuoState, type DuoTab } from './duo-state'

export function createDuoLayoutSnapshot(state: Pick<DuoState, 'panes' | 'ratio' | 'focusedPane'>, documents: WorkspaceTab[], workspacePath: string | null): PersistedDuoLayout {
  const byId = new Map(documents.map((tab) => [tab.id, tab]))
  const serialize = (tab: DuoTab): PersistedDuoTab | null => {
    if (tab.kind === 'panel') return { id: tab.id, kind: 'panel', panel: tab.id === 'app://fixed/git' ? 'git' : tab.id === 'app://fixed/files' ? 'files' : 'conversations' }
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
  return normalizeDuoLayout({ version: 1, focusedPane: state.focusedPane, ratio: state.ratio, panes: { left: pane('left'), right: pane('right') } })!
}

type RestoreApi = Pick<Window['appApi'], 'resolveWorkspaceEditorKind' | 'readWorkspaceFile' | 'getGitFileDiff' | 'getGitCommitFileDiff' | 'getWorkspaceFileUrl'>

// Build a complete restore result before publishing anything to either store.
// Bootstrap and StrictMode cancellation can discard it without partial tabs.
export async function loadDuoLayout(snapshot: PersistedDuoLayout, api: RestoreApi, projects: ProjectRecord[], conversations: ConversationRecord[]) {
  const documents = new Map<string, WorkspaceTab>()
  const loads = new Map<string, Promise<DuoTab | null>>()
  const loadTab = (tab: PersistedDuoTab): Promise<DuoTab | null> => {
    // Equal panel resource IDs still own independent live views in each pane.
    // Only file/session loading may share a result across pane references.
    if (tab.kind === 'panel') return Promise.resolve({ kind: 'panel', id: `app://fixed/${tab.panel}` })
    const key = JSON.stringify(tab)
    if (loads.has(key)) return loads.get(key)!
    const pending = (async (): Promise<DuoTab | null> => {
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
        console.warn('[duo] Skipped an unavailable tab during restore.', tab.id, error)
        return null
      }
    })()
    loads.set(key, pending)
    return pending
  }
  const restorePane = async (id: 'left' | 'right') => {
    const saved = snapshot.panes[id]
    const loaded = await Promise.all(saved.tabs.map(loadTab))
    const tabs = loaded.filter((tab): tab is DuoTab => tab !== null)
      .filter((tab, index, all) => all.findIndex((item) => item.id === tab.id) === index)
    const activeIndex = saved.tabs.findIndex((tab) => tab.id === saved.activeTabId)
    const activeTabId = loaded[activeIndex]?.id ?? loaded.slice(activeIndex + 1).find(Boolean)?.id
      ?? loaded.slice(0, Math.max(0, activeIndex)).reverse().find(Boolean)?.id ?? tabs[0]?.id ?? ''
    return { ...createDuoPane(), directoryOpen: saved.directoryOpen, directoryTab: saved.directoryTab, tabs, activeTabId }
  }
  const [left, right] = await Promise.all(DUO_PANE_IDS.map(restorePane))
  return { panes: { left, right }, documents: [...documents.values()], ratio: snapshot.ratio, focusedPane: snapshot.focusedPane }
}

let timer: ReturnType<typeof setTimeout> | undefined
let lastSerialized = ''
let lastWrite: Promise<unknown> = Promise.resolve()

export function createDuoProjectsSnapshot(state: DuoState, documents: WorkspaceTab[]): PersistedDuoProjects {
  const layouts = { ...state.savedProjects }
  for (const [id, layout] of Object.entries(getDuoProjectLayouts(state))) {
    layouts[id] = createDuoLayoutSnapshot(layout, documents, layout.project.path)
  }
  return { version: 1, layouts }
}

export async function flushDuoPersistence() {
  clearTimeout(timer)
  timer = undefined
  const state = useDuoStore.getState()
  if (!state.initialized || typeof window === 'undefined' || !window.appApi?.updateLayoutState) return
  const workspace = useWorkspaceStore.getState()
  const snapshot = createDuoProjectsSnapshot(state, workspace.openTabs)
  const serialized = JSON.stringify(snapshot)
  if (serialized === lastSerialized) { await lastWrite; return }
  lastSerialized = serialized
  const previous = lastWrite
  lastWrite = previous.catch(() => {}).then(() => window.appApi.updateLayoutState({ duoProjects: snapshot })).catch((error) => {
    if (lastSerialized === serialized) lastSerialized = '' // Permit a later retry.
    throw error
  })
  await lastWrite
}

export function startDuoPersistence() {
  const save = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { void flushDuoPersistence().catch((error) => console.error('[duo] Failed to save layout.', error)) }, 150)
  }
  const unsubscribeDuo = useDuoStore.subscribe(save)
  const unsubscribeDocuments = useWorkspaceStore.subscribe((next, previous) => {
    if (next.openTabs !== previous.openTabs || next.currentPath !== previous.currentPath) save()
  })
  const flush = () => { void flushDuoPersistence().catch((error) => console.error('[duo] Failed to save layout.', error)) }
  window.addEventListener('pagehide', flush)
  save()
  return () => { unsubscribeDuo(); unsubscribeDocuments(); window.removeEventListener('pagehide', flush); flush() }
}

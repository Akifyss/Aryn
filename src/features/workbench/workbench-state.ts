import { create } from 'zustand'
import type { AgentProjectSessionRequest } from '@/features/agent/lib/project-session-request'
import type { AgentId } from '@/features/agent/agent-definition'
import type { ProjectRecord } from '@/features/workspace/types'
import { reorderWorkspaceTabs, type TabDropPosition } from '@/features/workspace/store/use-workspace-store'
import type { WorkbenchDirectoryTab, PersistedWorkbenchLayout } from '../../../electron/shared/contracts/workbench-layout'

export type WorkbenchPaneId = 'left' | 'right'
export const WORKBENCH_PANE_IDS: WorkbenchPaneId[] = ['left', 'right']
// Default/legacy identities only. A panel's type is independent of its tab ID.
export const WORKBENCH_CONVERSATIONS_ID = 'app://fixed/conversations'
export const WORKBENCH_FILES_ID = 'app://fixed/files'
export const WORKBENCH_GIT_ID = 'app://fixed/git'
export type WorkbenchPanelType = 'files' | 'git'

export type WorkbenchTab = { id: string } & (
  | { kind: 'document' }
  | { kind: 'panel'; panel: WorkbenchPanelType | 'conversations' }
  | { kind: 'conversation'; conversationId: string | null; projectSession?: { project: ProjectRecord; request: AgentProjectSessionRequest } }
)

export function createWorkbenchPanel(panel: WorkbenchPanelType): Extract<WorkbenchTab, { kind: 'panel' }> {
  return { kind: 'panel', panel, id: `panel://${crypto.randomUUID()}` }
}

function isSameConversation(a: WorkbenchTab, b: WorkbenchTab) {
  if (a.kind !== 'conversation' || b.kind !== 'conversation') return false
  if (a.id === b.id || (a.conversationId && a.conversationId === b.conversationId)) return true
  const first = a.projectSession
  const second = b.projectSession
  return Boolean(first && second && first.project.id === second.project.id
    && first.request.kind === 'session' && second.request.kind === 'session'
    && first.request.agentId === second.request.agentId && first.request.sessionPath === second.request.sessionPath)
}
export type WorkbenchPaneState = {
  // In-memory navigation generation, deliberately omitted from persistence.
  navigationRevision: number
  tabs: WorkbenchTab[]
  activeTabId: string
  directoryOpen: boolean
  directoryTab: WorkbenchDirectoryTab
}

export type WorkbenchLayout = Pick<WorkbenchState, 'panes' | 'ratio' | 'focusedPane'>
export type WorkbenchProjectLayout = WorkbenchLayout & { project: ProjectRecord }

export function createDefaultWorkbenchLayout(project?: ProjectRecord | null): WorkbenchLayout {
  const draftId = `conversation-draft://${crypto.randomUUID()}`
  const draft: WorkbenchTab = { id: draftId, kind: 'conversation', conversationId: null,
    ...(project ? { projectSession: { project, request: {
      kind: 'new' as const, projectId: project.id, requestId: ++projectRequestId,
    } } } : {}) }
  return {
    focusedPane: 'left', ratio: 0.5,
    panes: {
      left: { ...createWorkbenchPane(draftId), directoryTab: 'conversation', tabs: [draft] },
      right: { ...createWorkbenchPane(WORKBENCH_FILES_ID), directoryOpen: false, directoryTab: 'git',
        tabs: [{ id: WORKBENCH_FILES_ID, kind: 'panel', panel: 'files' }, { id: WORKBENCH_GIT_ID, kind: 'panel', panel: 'git' }] },
    },
  }
}

export function getWorkbenchProjectLayouts(state: WorkbenchState): Record<string, WorkbenchProjectLayout> {
  return state.project ? { ...state.projectLayouts, [state.project.id]: {
    project: state.project, panes: state.panes, ratio: state.ratio, focusedPane: state.focusedPane,
  } } : state.projectLayouts
}

export function hasOtherWorkbenchDocumentOwner(state: WorkbenchState, pane: WorkbenchPaneId, id: string) {
  return WORKBENCH_PANE_IDS.some((side) => side !== pane && state.panes[side].tabs.some((tab) => tab.kind === 'document' && tab.id === id))
    || Object.values(state.projectLayouts).some((layout) => layout.project.id !== state.project?.id
      && WORKBENCH_PANE_IDS.some((side) => layout.panes[side].tabs.some((tab) => tab.kind === 'document' && tab.id === id)))
}

function mapWorkbenchPanes(state: WorkbenchState, update: (pane: WorkbenchPaneState) => WorkbenchPaneState) {
  const map = (panes: WorkbenchState['panes']) => ({ left: update(panes.left), right: update(panes.right) })
  return { panes: map(state.panes), projectLayouts: Object.fromEntries(Object.entries(state.projectLayouts)
    .map(([id, layout]) => [id, { ...layout, panes: map(layout.panes) }])) }
}

export function getWorkbenchProjectTabs(tabs: WorkbenchTab[], project?: ProjectRecord | null) {
  return tabs.filter((tab) => tab.kind === 'conversation'
    ? Boolean(project && tab.projectSession?.project.id === project.id)
    : tab.kind !== 'panel' || tab.panel !== 'conversations')
}

export function createWorkbenchPane(activeTabId = ''): WorkbenchPaneState {
  return { tabs: [], activeTabId, directoryOpen: true, directoryTab: 'file', navigationRevision: 0 }
}

export function clampWorkbenchRatio(ratio: number, width: number) {
  const min = Math.min(0.5, 320 / Math.max(1, width))
  return Math.max(min, Math.min(1 - min, Number.isFinite(ratio) ? ratio : 0.5))
}

export function removeWorkbenchTab(pane: WorkbenchPaneState, id: string): WorkbenchPaneState {
  const index = pane.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return pane
  const tabs = pane.tabs.filter((tab) => tab.id !== id)
  return {
    ...pane,
    navigationRevision: pane.navigationRevision + 1,
    tabs,
    activeTabId: pane.activeTabId === id
      ? tabs[index]?.id ?? tabs[index - 1]?.id ?? ''
      : pane.activeTabId,
  }
}

export type WorkbenchState = {
  // UI state only. Document contents and dirty flags stay in WorkspaceStore.
  panes: Record<WorkbenchPaneId, WorkbenchPaneState>
  focusedPane: WorkbenchPaneId
  ratio: number
  initialized: boolean
  project: ProjectRecord | null
  projectLayouts: Record<string, WorkbenchProjectLayout>
  savedProjects: Record<string, PersistedWorkbenchLayout>
  restoring: boolean
  restoreError: string | null
  scopeRevision: number
  switchProject: (project: ProjectRecord | null, layout: WorkbenchLayout) => void
  focus: (pane: WorkbenchPaneId) => void
  activate: (pane: WorkbenchPaneId, id: string) => void
  open: (pane: WorkbenchPaneId, tab: WorkbenchTab, focus?: boolean) => void
  moveTab: (from: WorkbenchPaneId, id: string) => void
  close: (pane: WorkbenchPaneId, id: string) => void
  reorder: (pane: WorkbenchPaneId, moving: string, target: string, position: TabDropPosition) => void
  toggleDirectory: (pane: WorkbenchPaneId) => void
  setDirectoryTab: (pane: WorkbenchPaneId, tab: WorkbenchDirectoryTab) => void
  setProjectSession: (pane: WorkbenchPaneId, tabId: string, session: { agentId: AgentId; sessionPath: string }) => void
  setRatio: (ratio: number) => void
  reconcileDocuments: (ids: Set<string>) => void
  adoptDocuments: (ids: string[], activeId: string | null) => void
  renameDocument: (previousId: string, nextId: string) => void
}

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  panes: { left: createWorkbenchPane(), right: createWorkbenchPane() },
  focusedPane: 'left',
  ratio: 0.5,
  initialized: false,
  project: null,
  projectLayouts: {},
  savedProjects: {},
  restoring: false,
  restoreError: null,
  scopeRevision: 0,
  switchProject: (project, layout) => set((state) => ({
    panes: layout.panes, ratio: layout.ratio, focusedPane: layout.focusedPane,
    project, projectLayouts: getWorkbenchProjectLayouts(state),
    scopeRevision: state.scopeRevision + ((state.project?.id ?? null) === (project?.id ?? null) ? 0 : 1),
    initialized: true, restoring: false, restoreError: null,
  })),
  setDirectoryTab: (pane, directoryTab) => set((state) => ({
    panes: { ...state.panes, [pane]: { ...state.panes[pane], directoryTab } },
  })),
  setProjectSession: (pane, tabId, session) => set((state) => {
    // Resolve the current owner by stable tab ID: an async completion may arrive
    // after the conversation moved to another pane or its project went backstage.
    const inactive = Object.values(state.projectLayouts).find((layout) => layout.project.id !== state.project?.id
      && WORKBENCH_PANE_IDS.some((side) => layout.panes[side].tabs.some((tab) => tab.id === tabId)))
    const owner = inactive ?? state
    pane = WORKBENCH_PANE_IDS.find((side) => owner.panes[side].tabs.some((tab) => tab.id === tabId)) ?? pane
    const tab = owner.panes[pane].tabs.find((tab) => tab.id === tabId)
    if (tab?.kind !== 'conversation' || !tab.projectSession || tab.conversationId) return state
    const previous = tab.projectSession.request
    if (previous.kind === 'session' && previous.agentId === session.agentId && previous.sessionPath === session.sessionPath) return state
    const next = { ...tab, projectSession: { ...tab.projectSession, request: {
      ...session, kind: 'session' as const, projectId: tab.projectSession.project.id,
      requestId: previous.requestId, sessionLabel: previous.kind === 'session' ? previous.sessionLabel : '对话',
    } } }
    const panes = { ...owner.panes, [pane]: { ...owner.panes[pane], tabs: owner.panes[pane].tabs.map((item) => item.id === tabId ? next : item) } }
    return inactive ? { projectLayouts: { ...state.projectLayouts, [inactive.project.id]: { ...inactive, panes } } } : { panes }
  }),
  adoptDocuments: (ids, activeId) => set((state) => {
    const assigned = new Set(WORKBENCH_PANE_IDS.flatMap((pane) => state.panes[pane].tabs.map((tab) => tab.id)))
    const missing = ids.filter((id) => !assigned.has(id))
    if (!missing.length) return state
    return { panes: { ...state.panes, right: {
      ...state.panes.right,
      tabs: [...state.panes.right.tabs, ...missing.map((id): WorkbenchTab => ({ kind: 'document', id }))],
      activeTabId: activeId && missing.includes(activeId) ? activeId : state.panes.right.activeTabId,
    } } }
  }),
  renameDocument: (previousId, nextId) => set((state) => mapWorkbenchPanes(state, (pane) => ({
      ...pane,
      activeTabId: pane.activeTabId === previousId ? nextId : pane.activeTabId,
      tabs: pane.tabs.map((tab) => tab.kind === 'document' && tab.id === previousId ? { ...tab, id: nextId } : tab)
        .filter((tab, index, tabs) => tabs.findIndex((item) => item.id === tab.id) === index),
  }))),
  focus: (focusedPane) => set({ focusedPane }),
  activate: (pane, id) => set((state) => {
    if (!state.panes[pane].tabs.some((tab) => tab.id === id)) return state
    return { focusedPane: pane, panes: { ...state.panes, [pane]: {
      ...state.panes[pane], activeTabId: id, navigationRevision: state.panes[pane].navigationRevision + 1,
    } } }
  }),
  open: (pane, tab, focus = true) => set((state) => {
    if (state.restoring) return state
    // Reopening an existing panel instance or conversation focuses its owner.
    // New panel actions allocate another ID, even for the same content type.
    const owner = tab.kind !== 'document'
      ? WORKBENCH_PANE_IDS.find((id) => state.panes[id].tabs.some((item) =>
        tab.kind === 'panel' ? item.kind === 'panel' && item.id === tab.id : isSameConversation(item, tab)))
      : undefined
    const target = owner ?? pane
    const existing = state.panes[target].tabs.find((item) => item.id === tab.id || isSameConversation(item, tab))
    return {
      focusedPane: focus ? target : state.focusedPane,
      panes: {
        ...state.panes,
        [target]: {
          ...state.panes[target],
          navigationRevision: state.panes[target].navigationRevision + 1,
          tabs: existing ? state.panes[target].tabs : [...state.panes[target].tabs, tab],
          activeTabId: existing?.id ?? tab.id,
        },
      },
    }
  }),
  moveTab: (from, id) => set((state) => {
    if (state.restoring) return state
    const source = state.panes[from]
    const tab = source.tabs.find((item) => item.id === id)
    if (!tab) return state
    const to = from === 'left' ? 'right' : 'left'
    const target = state.panes[to]
    // Only the exact same identity is deduplicated. Same-type panels coexist.
    const targetTabs = target.tabs.some((item) => item.id === id)
      ? target.tabs
      : [...target.tabs, tab]
    return {
      focusedPane: to,
      panes: {
        ...state.panes,
        [from]: removeWorkbenchTab(source, id),
        [to]: { ...target, activeTabId: id,
          navigationRevision: target.navigationRevision + 1,
          tabs: targetTabs },
      },
    }
  }),
  close: (pane, id) => set((state) => ({ panes: { ...state.panes, [pane]: removeWorkbenchTab(state.panes[pane], id) } })),
  reorder: (pane, moving, target, position) => set((state) => ({
    panes: { ...state.panes, [pane]: { ...state.panes[pane], tabs: reorderWorkspaceTabs(state.panes[pane].tabs, moving, target, position) } },
  })),
  toggleDirectory: (pane) => set((state) => ({
    panes: { ...state.panes, [pane]: { ...state.panes[pane], directoryOpen: !state.panes[pane].directoryOpen } },
  })),
  setRatio: (ratio) => set({ ratio: clampWorkbenchRatio(ratio, 1600) }),
  reconcileDocuments: (ids) => set((state) => {
    let changed = false
    const layouts = mapWorkbenchPanes(state, (pane) => {
      let next = pane
      for (const tab of pane.tabs) {
        if (tab.kind === 'document' && !ids.has(tab.id)) {
          next = removeWorkbenchTab(next, tab.id)
          changed = true
        }
      }
      return next
    })
    return changed ? layouts : state
  }),
}))

let projectRequestId = 0

export function openWorkbenchProjectSession(
  pane: WorkbenchPaneId,
  project: ProjectRecord,
  session?: Pick<Extract<AgentProjectSessionRequest, { kind: 'session' }>, 'agentId' | 'sessionPath' | 'sessionLabel'>,
  placement: 'existing' | 'target' = 'existing',
) {
  const state = useWorkbenchStore.getState()
  if (state.restoring || (state.project && state.project.id !== project.id)) return
  const requestId = ++projectRequestId
  const request: AgentProjectSessionRequest = session
    ? { ...session, kind: 'session', projectId: project.id, requestId }
    : { kind: 'new', projectId: project.id, requestId }
  const tab: WorkbenchTab = {
    kind: 'conversation', conversationId: null,
    id: session ? `project-session://${encodeURIComponent(project.id)}/${session.agentId}/${encodeURIComponent(session.sessionPath)}`
      : `project-draft://${crypto.randomUUID()}`,
    projectSession: { project, request },
  }
  // A list row normally focuses the existing view. Its explicit direction
  // action instead moves that same view to the requested side.
  if (placement === 'target') {
    const other = pane === 'left' ? 'right' : 'left'
    const existing = state.panes[other].tabs.find(item => isSameConversation(item, tab))
    if (existing) { state.moveTab(other, existing.id); return }
  }
  state.open(pane, tab)
}

import { create } from 'zustand'
import type { AgentProjectSessionRequest } from '@/features/agent/lib/project-session-request'
import type { AgentId } from '@/features/agent/agent-definition'
import type { ProjectRecord } from '@/features/workspace/types'
import { reorderWorkspaceTabs, type TabDropPosition } from '@/features/workspace/store/use-workspace-store'
import type { DuoDirectoryTab, PersistedDuoLayout } from '../../../electron/shared/contracts/duo-layout'

export type DuoPaneId = 'left' | 'right'
export const DUO_PANE_IDS: DuoPaneId[] = ['left', 'right']
export const DUO_CONVERSATIONS_ID = 'app://fixed/conversations'
export const DUO_FILES_ID = 'app://fixed/files'
export const DUO_GIT_ID = 'app://fixed/git'
export const DUO_PANEL_IDS = [DUO_GIT_ID, DUO_FILES_ID, DUO_CONVERSATIONS_ID] as const
export type DuoPanelId = typeof DUO_PANEL_IDS[number]

export type DuoTab = { id: string } & (
  | { kind: 'document' }
  | { kind: 'panel'; id: DuoPanelId }
  | { kind: 'conversation'; conversationId: string | null; projectSession?: { project: ProjectRecord; request: AgentProjectSessionRequest } }
)

function isSameConversation(a: DuoTab, b: DuoTab) {
  if (a.kind !== 'conversation' || b.kind !== 'conversation') return false
  if (a.id === b.id || (a.conversationId && a.conversationId === b.conversationId)) return true
  const first = a.projectSession
  const second = b.projectSession
  return Boolean(first && second && first.project.id === second.project.id
    && first.request.kind === 'session' && second.request.kind === 'session'
    && first.request.agentId === second.request.agentId && first.request.sessionPath === second.request.sessionPath)
}
export type DuoPaneState = {
  // In-memory navigation generation, deliberately omitted from persistence.
  navigationRevision: number
  tabs: DuoTab[]
  activeTabId: string
  directoryOpen: boolean
  directoryTab: DuoDirectoryTab
}

export type DuoLayout = Pick<DuoState, 'panes' | 'ratio' | 'focusedPane'>
export type DuoProjectLayout = DuoLayout & { project: ProjectRecord }

export function createDefaultDuoLayout(project?: ProjectRecord | null): DuoLayout {
  const draftId = `conversation-draft://${crypto.randomUUID()}`
  const draft: DuoTab = { id: draftId, kind: 'conversation', conversationId: null,
    ...(project ? { projectSession: { project, request: {
      kind: 'new' as const, projectId: project.id, requestId: ++projectRequestId,
    } } } : {}) }
  return {
    focusedPane: 'left', ratio: 0.5,
    panes: {
      left: { ...createDuoPane(draftId), directoryTab: 'conversation', tabs: [draft] },
      right: { ...createDuoPane(DUO_FILES_ID), directoryOpen: false, directoryTab: 'git',
        tabs: [{ id: DUO_FILES_ID, kind: 'panel' }, { id: DUO_GIT_ID, kind: 'panel' }] },
    },
  }
}

export function getDuoProjectLayouts(state: DuoState): Record<string, DuoProjectLayout> {
  return state.project ? { ...state.projectLayouts, [state.project.id]: {
    project: state.project, panes: state.panes, ratio: state.ratio, focusedPane: state.focusedPane,
  } } : state.projectLayouts
}

export function hasOtherDuoDocumentOwner(state: DuoState, pane: DuoPaneId, id: string) {
  return DUO_PANE_IDS.some((side) => side !== pane && state.panes[side].tabs.some((tab) => tab.kind === 'document' && tab.id === id))
    || Object.values(state.projectLayouts).some((layout) => layout.project.id !== state.project?.id
      && DUO_PANE_IDS.some((side) => layout.panes[side].tabs.some((tab) => tab.kind === 'document' && tab.id === id)))
}

function mapDuoPanes(state: DuoState, update: (pane: DuoPaneState) => DuoPaneState) {
  const map = (panes: DuoState['panes']) => ({ left: update(panes.left), right: update(panes.right) })
  return { panes: map(state.panes), projectLayouts: Object.fromEntries(Object.entries(state.projectLayouts)
    .map(([id, layout]) => [id, { ...layout, panes: map(layout.panes) }])) }
}

export function getDuoProjectTabs(tabs: DuoTab[], project?: ProjectRecord | null) {
  return tabs.filter((tab) => tab.kind === 'conversation'
    ? Boolean(project && tab.projectSession?.project.id === project.id)
    : tab.id !== DUO_CONVERSATIONS_ID)
}

export function createDuoPane(activeTabId = ''): DuoPaneState {
  return { tabs: [], activeTabId, directoryOpen: true, directoryTab: 'file', navigationRevision: 0 }
}

export function clampDuoRatio(ratio: number, width: number) {
  const min = Math.min(0.5, 320 / Math.max(1, width))
  return Math.max(min, Math.min(1 - min, Number.isFinite(ratio) ? ratio : 0.5))
}

export function removeDuoTab(pane: DuoPaneState, id: string): DuoPaneState {
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

export type DuoState = {
  // UI state only. Document contents and dirty flags stay in WorkspaceStore.
  panes: Record<DuoPaneId, DuoPaneState>
  focusedPane: DuoPaneId
  ratio: number
  initialized: boolean
  project: ProjectRecord | null
  projectLayouts: Record<string, DuoProjectLayout>
  savedProjects: Record<string, PersistedDuoLayout>
  restoring: boolean
  restoreError: string | null
  scopeRevision: number
  switchProject: (project: ProjectRecord | null, layout: DuoLayout) => void
  focus: (pane: DuoPaneId) => void
  activate: (pane: DuoPaneId, id: string) => void
  open: (pane: DuoPaneId, tab: DuoTab, focus?: boolean) => void
  moveTab: (from: DuoPaneId, id: string) => void
  close: (pane: DuoPaneId, id: string) => void
  reorder: (pane: DuoPaneId, moving: string, target: string, position: TabDropPosition) => void
  toggleDirectory: (pane: DuoPaneId) => void
  setDirectoryTab: (pane: DuoPaneId, tab: DuoDirectoryTab) => void
  setProjectSession: (pane: DuoPaneId, tabId: string, session: { agentId: AgentId; sessionPath: string }) => void
  setRatio: (ratio: number) => void
  reconcileDocuments: (ids: Set<string>) => void
  adoptDocuments: (ids: string[], activeId: string | null) => void
  renameDocument: (previousId: string, nextId: string) => void
}

export const useDuoStore = create<DuoState>((set) => ({
  panes: { left: createDuoPane(), right: createDuoPane() },
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
    project, projectLayouts: getDuoProjectLayouts(state),
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
      && DUO_PANE_IDS.some((side) => layout.panes[side].tabs.some((tab) => tab.id === tabId)))
    const owner = inactive ?? state
    pane = DUO_PANE_IDS.find((side) => owner.panes[side].tabs.some((tab) => tab.id === tabId)) ?? pane
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
    const assigned = new Set(DUO_PANE_IDS.flatMap((pane) => state.panes[pane].tabs.map((tab) => tab.id)))
    const missing = ids.filter((id) => !assigned.has(id))
    if (!missing.length) return state
    return { panes: { ...state.panes, right: {
      ...state.panes.right,
      tabs: [...state.panes.right.tabs, ...missing.map((id): DuoTab => ({ kind: 'document', id }))],
      activeTabId: activeId && missing.includes(activeId) ? activeId : state.panes.right.activeTabId,
    } } }
  }),
  renameDocument: (previousId, nextId) => set((state) => mapDuoPanes(state, (pane) => ({
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
    // A conversation has one live composer. Reopening focuses its existing view.
    const owner = tab.kind === 'conversation'
      ? DUO_PANE_IDS.find((id) => state.panes[id].tabs.some((item) => isSameConversation(item, tab)))
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
    // Panels can have independent instances in both panes. Keep the target's
    // tab position but adopt the source object, so its live view moves with it.
    const targetTabs = target.tabs.some((item) => item.id === id)
      ? tab.kind === 'panel' ? target.tabs.map(item => item.id === id ? tab : item) : target.tabs
      : [...target.tabs, tab]
    return {
      focusedPane: to,
      panes: {
        ...state.panes,
        [from]: removeDuoTab(source, id),
        [to]: { ...target, activeTabId: id,
          navigationRevision: target.navigationRevision + 1,
          tabs: targetTabs },
      },
    }
  }),
  close: (pane, id) => set((state) => ({ panes: { ...state.panes, [pane]: removeDuoTab(state.panes[pane], id) } })),
  reorder: (pane, moving, target, position) => set((state) => ({
    panes: { ...state.panes, [pane]: { ...state.panes[pane], tabs: reorderWorkspaceTabs(state.panes[pane].tabs, moving, target, position) } },
  })),
  toggleDirectory: (pane) => set((state) => ({
    panes: { ...state.panes, [pane]: { ...state.panes[pane], directoryOpen: !state.panes[pane].directoryOpen } },
  })),
  setRatio: (ratio) => set({ ratio: clampDuoRatio(ratio, 1600) }),
  reconcileDocuments: (ids) => set((state) => {
    let changed = false
    const layouts = mapDuoPanes(state, (pane) => {
      let next = pane
      for (const tab of pane.tabs) {
        if (tab.kind === 'document' && !ids.has(tab.id)) {
          next = removeDuoTab(next, tab.id)
          changed = true
        }
      }
      return next
    })
    return changed ? layouts : state
  }),
}))

let projectRequestId = 0

export function openDuoProjectSession(
  pane: DuoPaneId,
  project: ProjectRecord,
  session?: Pick<Extract<AgentProjectSessionRequest, { kind: 'session' }>, 'agentId' | 'sessionPath' | 'sessionLabel'>,
  placement: 'existing' | 'target' = 'existing',
) {
  const state = useDuoStore.getState()
  if (state.restoring || (state.project && state.project.id !== project.id)) return
  const requestId = ++projectRequestId
  const request: AgentProjectSessionRequest = session
    ? { ...session, kind: 'session', projectId: project.id, requestId }
    : { kind: 'new', projectId: project.id, requestId }
  const tab: DuoTab = {
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

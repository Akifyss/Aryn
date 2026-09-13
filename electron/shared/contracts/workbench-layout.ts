import { AGENT_IDS, type AgentId } from '../agent-contracts/definition'
import type { GitChangeScope } from './git'
import type { WorkspaceFileViewMode } from './workspace-files'

export type WorkbenchDirectoryTab = 'file' | 'git' | 'conversation'
export type PersistedWorkbenchFileDiff = { scope: GitChangeScope; mode: 'split' | 'unified' }
export type PersistedWorkbenchTab = { id: string } & (
  | { kind: 'file'; path: string; workspacePath: string | null; viewMode: WorkspaceFileViewMode; gitDiff?: PersistedWorkbenchFileDiff }
  | { kind: 'diff'; path: string; workspacePath: string; scope: GitChangeScope; commitHash: string | null }
  | { kind: 'panel'; panel: 'files' | 'git' | 'conversations' }
  | { kind: 'terminal'; projectId: string; title: string }
  | { kind: 'conversation'; conversationId: string | null; projectId: string | null;
      session: { agentId: AgentId; path: string; label: string } | null }
)
export type PersistedWorkbenchPane = {
  directoryOpen: boolean
  directoryTab: WorkbenchDirectoryTab
  activeTabId: string
  tabs: PersistedWorkbenchTab[]
}
export type PersistedWorkbenchLayout = {
  version: 1
  focusedPane: 'left' | 'right'
  ratio: number
  panes: Record<'left' | 'right', PersistedWorkbenchPane>
}

// Project IDs, rather than names or the last selected CWD, own workspace state.
export type PersistedProjectWorkspaces = {
  version: 1
  layouts: Record<string, PersistedWorkbenchLayout>
}

export function normalizeProjectWorkspaces(value: unknown): PersistedProjectWorkspaces | undefined {
  const state = record(value)
  if (state.version !== 1 || !state.layouts || typeof state.layouts !== 'object' || Array.isArray(state.layouts)) return undefined
  return { version: 1, layouts: Object.fromEntries(Object.entries(record(state.layouts)).flatMap(([id, value]) => {
    const layout = normalizeWorkbenchLayout(value)
    return text(id) && layout ? [[id, layout]] : []
  })) }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() && !value.includes('\0') ? value : null
}
function normalizeTab(value: unknown): PersistedWorkbenchTab | null {
  const tab = record(value)
  const id = text(tab.id)
  if (!id) return null
  if (tab.kind === 'terminal' && id.startsWith('terminal://') && id.length <= 256 && text(tab.projectId)) {
    return { id, kind: 'terminal', projectId: text(tab.projectId)!, title: (text(tab.title) ?? '终端').slice(0, 80) }
  }
  if (tab.kind === 'panel' && (tab.panel === 'files' || tab.panel === 'git' || tab.panel === 'conversations')) {
    return { id, kind: 'panel', panel: tab.panel }
  }
  if (tab.kind === 'file' && text(tab.path)) {
    const viewMode = ['code', 'file', 'meo', 'preview'].includes(String(tab.viewMode)) ? tab.viewMode as WorkspaceFileViewMode : 'meo'
    const diff = record(tab.gitDiff)
    const gitDiff: PersistedWorkbenchFileDiff | undefined = (diff.scope === 'staged' || diff.scope === 'unstaged')
      && (diff.mode === 'split' || diff.mode === 'unified') ? { scope: diff.scope, mode: diff.mode } : undefined
    return { id, kind: 'file', path: text(tab.path)!, workspacePath: text(tab.workspacePath), viewMode, ...(gitDiff ? { gitDiff } : {}) }
  }
  if (tab.kind === 'diff' && text(tab.path) && text(tab.workspacePath) && (tab.scope === 'staged' || tab.scope === 'unstaged')) {
    return { id, kind: 'diff', path: text(tab.path)!, workspacePath: text(tab.workspacePath)!, scope: tab.scope, commitHash: text(tab.commitHash) }
  }
  if (tab.kind === 'conversation') {
    if (tab.conversationId != null && !text(tab.conversationId)) return null
    if (tab.projectId != null && !text(tab.projectId)) return null
    const conversationId = text(tab.conversationId)
    const projectId = conversationId ? null : text(tab.projectId)
    const session = record(tab.session)
    if (projectId && tab.session != null && (!AGENT_IDS.includes(session.agentId as AgentId) || !text(session.path))) return null
    return { id, kind: 'conversation', conversationId, projectId, session: projectId && text(session.path) ? {
      agentId: session.agentId as AgentId, path: text(session.path)!, label: text(session.label) ?? '对话',
    } : null }
  }
  return null
}

// Shared by the main-process disk boundary and renderer restore. Copy only
// durable identities; message bodies, file contents and transient requests do not belong here.
export function normalizeWorkbenchLayout(value: unknown): PersistedWorkbenchLayout | undefined {
  const state = record(value)
  const panes = record(state.panes)
  if (state.version !== 1 || !panes.left || !panes.right) return undefined
  const conversations = new Set<string>()
  const terminals = new Set<string>()
  const normalizePane = (value: unknown): PersistedWorkbenchPane => {
    const pane = record(value)
    const ids = new Set<string>()
    const tabs = (Array.isArray(pane.tabs) ? pane.tabs : []).flatMap((value) => {
      const tab = normalizeTab(value)
      if (!tab || ids.has(tab.id)) return []
      if (tab.kind === 'terminal') {
        if (terminals.has(tab.id)) return []
        terminals.add(tab.id)
      }
      const identity = tab.kind === 'conversation' ? tab.conversationId
        ? `conversation:${tab.conversationId}` : tab.projectId && tab.session
        ? `project:${tab.projectId}:${tab.session.agentId}:${tab.session.path}` : null : null
      if (identity && conversations.has(identity)) return []
      if (identity) conversations.add(identity)
      ids.add(tab.id)
      return [tab]
    })
    return {
      directoryOpen: typeof pane.directoryOpen === 'boolean' ? pane.directoryOpen : true,
      directoryTab: pane.directoryTab === 'git' || pane.directoryTab === 'conversation' ? pane.directoryTab : 'file',
      tabs, activeTabId: tabs.some((tab) => tab.id === pane.activeTabId) ? pane.activeTabId as string : tabs[0]?.id ?? '',
    }
  }
  return {
    version: 1, focusedPane: state.focusedPane === 'right' ? 'right' : 'left',
    ratio: typeof state.ratio === 'number' && Number.isFinite(state.ratio) ? Math.max(0.2, Math.min(0.8, state.ratio)) : 0.5,
    panes: { left: normalizePane(panes.left), right: normalizePane(panes.right) },
  }
}

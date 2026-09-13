import { Chat3Line, FolderLine, GitBranchLine, TerminalBoxLine } from '@mingcute/react'
import type { ProjectRecord } from '@/features/workspace/types'
import { createWorkbenchPanel, openWorkbenchProjectSession, useWorkbenchStore, type WorkbenchPaneId } from './workbench-state'

export function startWorkbenchProjectConversation(pane: WorkbenchPaneId, project?: ProjectRecord | null, chooseProject?: () => void) {
  if (project) openWorkbenchProjectSession(pane, project)
  else chooseProject?.()
}

export function openWorkbenchTerminal(pane: WorkbenchPaneId, project?: ProjectRecord | null, chooseProject?: () => void) {
  if (!project) { chooseProject?.(); return }
  const state = useWorkbenchStore.getState()
  if (state.restoring || state.project?.id !== project.id) return
  const titles = new Set([...state.panes.left.tabs, ...state.panes.right.tabs].flatMap(tab => tab.kind === 'terminal' ? [tab.title] : []))
  let number = 1
  while (titles.has(number === 1 ? '终端' : `终端 ${number}`)) number++
  state.open(pane, { kind: 'terminal', id: `terminal://${crypto.randomUUID()}`, projectId: project.id,
    title: number === 1 ? '终端' : `终端 ${number}` })
}

// The start page and plus menu share the same pane-scoped entry points.
export const WORKBENCH_OPEN_ACTIONS = [
  { id: 'git', label: '更改', Icon: GitBranchLine, open: (pane: WorkbenchPaneId) => useWorkbenchStore.getState().open(pane, createWorkbenchPanel('git')) },
  { id: 'files', label: '文件', Icon: FolderLine, open: (pane: WorkbenchPaneId) => useWorkbenchStore.getState().open(pane, createWorkbenchPanel('files')) },
  { id: 'terminal', label: '终端', Icon: TerminalBoxLine, open: openWorkbenchTerminal },
  { id: 'conversation', label: '新对话', Icon: Chat3Line, open: startWorkbenchProjectConversation },
] as const

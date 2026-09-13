import { Chat3Line, FolderLine, GitBranchLine } from '@mingcute/react'
import type { ProjectRecord } from '@/features/workspace/types'
import { createWorkbenchPanel, openWorkbenchProjectSession, useWorkbenchStore, type WorkbenchPaneId } from './workbench-state'

export function startWorkbenchProjectConversation(pane: WorkbenchPaneId, project?: ProjectRecord | null, chooseProject?: () => void) {
  if (project) openWorkbenchProjectSession(pane, project)
  else chooseProject?.()
}

// The start page and plus menu share the same pane-scoped entry points.
export const WORKBENCH_OPEN_ACTIONS = [
  { id: 'git', label: '更改', Icon: GitBranchLine, open: (pane: WorkbenchPaneId) => useWorkbenchStore.getState().open(pane, createWorkbenchPanel('git')) },
  { id: 'files', label: '文件', Icon: FolderLine, open: (pane: WorkbenchPaneId) => useWorkbenchStore.getState().open(pane, createWorkbenchPanel('files')) },
  { id: 'conversation', label: '新对话', Icon: Chat3Line, open: startWorkbenchProjectConversation },
] as const

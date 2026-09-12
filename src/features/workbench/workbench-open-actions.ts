import { Chat3Line, FolderLine, GitBranchLine } from '@mingcute/react'
import type { ProjectRecord } from '@/features/workspace/types'
import { WORKBENCH_FILES_ID, WORKBENCH_GIT_ID, openWorkbenchProjectSession, useWorkbenchStore, type WorkbenchPaneId } from './workbench-state'

export function startWorkbenchProjectConversation(pane: WorkbenchPaneId, project?: ProjectRecord | null, chooseProject?: () => void) {
  if (project) openWorkbenchProjectSession(pane, project)
  else chooseProject?.()
}

// The start page and plus menu share the same pane-scoped entry points.
export const WORKBENCH_OPEN_ACTIONS = [
  { id: 'git', label: '更改', Icon: GitBranchLine, open: (pane: WorkbenchPaneId) => useWorkbenchStore.getState().open(pane, { kind: 'panel', id: WORKBENCH_GIT_ID }) },
  { id: 'files', label: '文件', Icon: FolderLine, open: (pane: WorkbenchPaneId) => useWorkbenchStore.getState().open(pane, { kind: 'panel', id: WORKBENCH_FILES_ID }) },
  { id: 'conversation', label: '新对话', Icon: Chat3Line, open: startWorkbenchProjectConversation },
] as const

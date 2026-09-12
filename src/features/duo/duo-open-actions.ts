import { Chat3Line, FolderLine, GitBranchLine } from '@mingcute/react'
import type { ProjectRecord } from '@/features/workspace/types'
import { DUO_FILES_ID, DUO_GIT_ID, openDuoProjectSession, useDuoStore, type DuoPaneId } from './duo-state'

export function startDuoProjectConversation(pane: DuoPaneId, project?: ProjectRecord | null, chooseProject?: () => void) {
  if (project) openDuoProjectSession(pane, project)
  else chooseProject?.()
}

// The start page and plus menu share the same pane-scoped entry points.
export const DUO_OPEN_ACTIONS = [
  { id: 'git', label: '更改', Icon: GitBranchLine, open: (pane: DuoPaneId) => useDuoStore.getState().open(pane, { kind: 'panel', id: DUO_GIT_ID }) },
  { id: 'files', label: '文件', Icon: FolderLine, open: (pane: DuoPaneId) => useDuoStore.getState().open(pane, { kind: 'panel', id: DUO_FILES_ID }) },
  { id: 'conversation', label: '新对话', Icon: Chat3Line, open: startDuoProjectConversation },
] as const

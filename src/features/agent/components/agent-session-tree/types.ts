import type { AgentId } from '@/features/agent/agent-definition'
import type { AgentSessionSelection } from '@/features/agent/lib/project-session-request'
import type { AgentProjectSessionBucket } from '@/features/agent/lib/session-tree'
import type { AgentWorkspaceState } from '@/features/agent/types'
import type {
  ActiveWorkspaceContext,
  ConversationRecord,
  ConversationState,
} from '@/features/conversations/types'
import type { ProjectRecord, ProjectState } from '@/features/workspace/types'

export type AgentMenuAnchorRect = Pick<
  DOMRect,
  'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'
>

export type AgentProjectSwitchMenuOptions = {
  startNewSession?: boolean
}

export type AgentSessionTreeProps = {
  className?: string
  onRequestClose?: () => void
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  id?: string
  isFloating?: boolean
  isProjectAddMenuOpen?: boolean
  menuPortalTarget?: HTMLElement | null
}

export type AgentSessionTreeController = {
  activeWorkspaceContext: ActiveWorkspaceContext
  activeSessionPath: string | null
  activeSessionSelection: AgentSessionSelection
  agentState: AgentWorkspaceState
  conversationState: ConversationState
  deletingSessionPath: string | null
  handleDeleteSession: (rootPath: string, agentId: AgentId, sessionPath: string) => Promise<void>
  handleOpenSession: (agentId: AgentId, sessionPath: string) => Promise<void>
  handleRenameSession: (rootPath: string, agentId: AgentId, sessionPath: string, name: string) => Promise<void>
  handleStartNewSession: () => void
  isProjectAddMenuOpen: boolean
  loadProjectSessions: (project: ProjectRecord) => Promise<void>
  onOpenProjectAddMenu?: (anchorRect?: AgentMenuAnchorRect) => void
  onOpenConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onRenameConversation?: (conversation: ConversationRecord, title: string) => Promise<void> | void
  onRemoveConversation?: (conversation: ConversationRecord) => Promise<void> | void
  onOpenProjectFolder?: (project: ProjectRecord) => Promise<void> | void
  onOpenProjectSession?: (project: ProjectRecord, agentId: AgentId, sessionPath: string) => Promise<void> | void
  onRemoveProject?: (project: ProjectRecord) => Promise<void> | void
  onStartStandaloneConversation?: () => Promise<void> | void
  onStartProjectSession?: (project: ProjectRecord) => Promise<void> | void
  projectSessions: Record<string, AgentProjectSessionBucket>
  projectState: ProjectState
  selectedAgentId: AgentId
  sessionActivityById: Record<string, 'running' | 'waiting'>
  sessionTreeAgentIds: readonly AgentId[]
  workspacePath: string | null
}

export type AgentSessionTreeViewProps = AgentSessionTreeProps & {
  controller: AgentSessionTreeController
}

export type EnvironmentId = string
export type MessageId = string
export type TurnId = string
export type ThreadId = string
export type ScopedThreadRef = { provider: string; threadId: string }
export type TimestampFormat = 'relative' | 'absolute'

export type ServerProviderSkill = {
  name: string
  displayName: string
}

export type OrchestrationLatestTurn = {
  turnId: TurnId
  state: 'running' | 'completed' | 'interrupted' | 'failed'
  startedAt: string
  completedAt: string | null
}

export type OrchestrationMessage = {
  id: MessageId
  role: 'user' | 'assistant' | 'system'
  text: string
  turnId: TurnId | null
  streaming: boolean
  createdAt: string
  updatedAt: string
  attachments?: ReadonlyArray<unknown>
}

export type OrchestrationProposedPlan = {
  id: string
  turnId: TurnId | null
  planMarkdown: string
  implementedAt: string | null
  implementationThreadId: ThreadId | null
  createdAt: string
  updatedAt: string
}

export type OrchestrationCheckpointFile = {
  path: string
  additions: number
  deletions: number
  patch?: string
}

export type OrchestrationCheckpointSummary = {
  turnId: TurnId
  completedAt: string
  files: ReadonlyArray<OrchestrationCheckpointFile>
}

export type ToolLifecycleItemType =
  | 'command_execution'
  | 'file_change'
  | 'mcp_tool_call'
  | 'dynamic_tool_call'
  | 'collab_agent_tool_call'
  | 'web_search'
  | 'image_view'
  | 'image_generation'
  | 'sleep'
  | 'hook_prompt'
  | 'review'
  | 'context_compaction'

export type OrchestrationThreadActivity = {
  kind: string
}

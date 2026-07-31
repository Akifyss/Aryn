import type {
  AgentPromptAttachment,
  AgentPromptSendOptions,
} from '../../../../shared/agent-contracts/types'
import type { SessionRuntimeLease } from '../../runtime/session-runtime-coordinator'
import type { CodexThreadRecord } from './session-model'

export type QueuedCodexPrompt = {
  attachments: AgentPromptAttachment[]
  options?: AgentPromptSendOptions
  prompt: string
}

/** Mutable state attached to one subscribed native Codex thread. */
export type CodexBinding = {
  activeTurnId: string | null
  isStreaming: boolean
  lease: SessionRuntimeLease
  queuedPrompts: QueuedCodexPrompt[]
  record: CodexThreadRecord
}

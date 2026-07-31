import type { SnapshotFileDiff } from '@opencode-ai/sdk/v2'
import type {
  AgentSessionExecutionState,
  AgentThinkingLevel,
} from '../../../../shared/agent-contracts/types'
import type { SessionRuntimeLease } from '../../runtime/session-runtime-coordinator'

/** Mutable runtime projection for one OpenCode session or nested sub-session. */
export type OpenCodeSessionBinding = {
  cwd: string
  executionState: AgentSessionExecutionState
  isStreaming: boolean
  lastAssistantMessageId: string | null
  lease: SessionRuntimeLease
  ownerLease: SessionRuntimeLease
  parentLease: SessionRuntimeLease
  parentSessionId: string | null
  rootSessionId: string
  sessionId: string
  selectedModel: string | null
  thinkingLevel: AgentThinkingLevel
  title: string | null
}

export type OpenCodeSessionProjection = {
  diffs: Map<string, SnapshotFileDiff[]>
}

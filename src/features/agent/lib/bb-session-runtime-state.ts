import type { BbSessionRuntimeState } from '@aryn/bb-session-surface'
import type { AgentId } from '@/features/agent/agent-definition'
import type { AgentStoppingPromptState } from '@/features/agent/composer/use-agent-composer-actions'
import type { AgentLiveToolState } from '@/features/agent/runtime/use-agent-runtime-events'
import type { AgentRuntimeState } from '@/features/agent/types'

type BuildBbSessionRuntimeStateOptions = {
  activeSessionPath: string | null
  agentId: AgentId | null
  assistantText: string
  isThinkingStreaming: boolean
  isViewingActiveRuntime: boolean
  liveTools: AgentLiveToolState[]
  panelError: string | null
  runtime: AgentRuntimeState
  startedAt: number | null
  stoppingPrompt: AgentStoppingPromptState | null
  thinkingText: string
}

/**
 * Runtime state is intentionally scoped to the active host run. Persisted
 * snapshots from another session may use the same provider, but must never
 * inherit its streaming draft, tools, stop state, retry state, or errors.
 */
export function buildBbSessionRuntimeState({
  activeSessionPath,
  agentId,
  assistantText,
  isThinkingStreaming,
  isViewingActiveRuntime,
  liveTools,
  panelError,
  runtime,
  startedAt,
  stoppingPrompt,
  thinkingText,
}: BuildBbSessionRuntimeStateOptions): BbSessionRuntimeState {
  if (!agentId || !isViewingActiveRuntime || runtime.agentId !== agentId) return {}

  const isStopping = stoppingPrompt?.agentId === agentId
    && stoppingPrompt.sessionPath === activeSessionPath

  return {
    compactionReason: runtime.compactionReason,
    error: panelError,
    executionState: runtime.executionState,
    isCompacting: runtime.isCompacting,
    isStopping,
    isStreaming: runtime.isStreaming,
    ...(agentId === 'pi' || agentId === 'builtin-pi'
      ? {
          streaming: {
            assistantText,
            isThinkingStreaming,
            startedAt,
            thinkingText,
            tools: liveTools,
          },
        }
      : {}),
    retryAttempt: runtime.retryAttempt,
    retryMaxAttempts: runtime.retryMaxAttempts,
    stoppingAnchorAt: isStopping ? stoppingPrompt.anchorAt : undefined,
  }
}

import { describe, expect, it } from 'vitest'
import type { AgentClientEvent } from '../electron/shared/agent-contracts/types'
import {
  EMPTY_AGENT_LIVE_STREAM_STATE,
  reduceAgentLiveStreamState,
} from '../src/features/agent/runtime/agent-live-stream-state'
import { projectNativeSession } from '../packages/bb-session-surface/src/projectors'

describe('agent live events to vendored bb timeline', () => {
  it.each(['pi', 'builtin-pi'] as const)(
    'carries real %s client deltas across the renderer/projector boundary',
    (agentId) => {
      const events: AgentClientEvent[] = [{
        agentId,
        sessionId: 'session-1',
        type: 'assistant_message_started',
      }, {
        agentId,
        delta: 'Inspecting carefully',
        sessionId: 'session-1',
        type: 'assistant_thinking_delta',
      }, {
        agentId,
        sessionId: 'session-1',
        summary: 'Reading package.json',
        toolCallId: 'read-1',
        toolName: 'read',
        type: 'tool_execution_started',
      }, {
        agentId,
        delta: 'The live answer is visible.',
        sessionId: 'session-1',
        type: 'assistant_message_delta',
      }]
      const live = events.reduce(
        (state, event, index) => reduceAgentLiveStreamState(state, event, 1_700_000_000_000 + index),
        EMPTY_AGENT_LIVE_STREAM_STATE,
      )
      const projection = projectNativeSession({
        fileChanges: [],
        optimisticMessages: [],
        runtimeState: {
          isStreaming: true,
          streaming: {
            assistantText: live.assistantText,
            isThinkingStreaming: live.isThinkingStreaming,
            startedAt: live.startedAt,
            thinkingText: live.thinkingText,
            tools: live.tools,
          },
        },
        sessionId: 'session-1',
        snapshot: {
          agentId,
          entryIds: ['user-1'],
          messages: [{
            role: 'user',
            content: [{ type: 'text', text: 'Show live progress' }],
            timestamp: 1_699_999_999_000,
          }],
          sessionId: 'session-1',
        },
      })
      const serialized = JSON.stringify(projection)

      expect(serialized).toContain('The live answer is visible.')
      expect(serialized).toContain('Inspecting carefully')
      expect(serialized).toContain('Reading package.json')
    },
  )
})

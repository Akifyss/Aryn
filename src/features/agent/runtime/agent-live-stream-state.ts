import type {
  AgentClientEvent,
  AgentSidebarMessageStatus,
} from '@/features/agent/types'

export type AgentLiveToolState = {
  id: string
  name: string
  status: AgentSidebarMessageStatus
  summary: string
  isError?: boolean
  startedAt: number
}

export type AgentLiveStreamState = {
  assistantText: string
  thinkingText: string
  isThinkingStreaming: boolean
  startedAt: number | null
  tools: AgentLiveToolState[]
}

export const EMPTY_AGENT_LIVE_STREAM_STATE: AgentLiveStreamState = {
  assistantText: '',
  thinkingText: '',
  isThinkingStreaming: false,
  startedAt: null,
  tools: [],
}

type AgentLiveStreamEvent = Extract<
  AgentClientEvent,
  {
    type:
      | 'assistant_message_started'
      | 'assistant_thinking_delta'
      | 'assistant_thinking_finished'
      | 'assistant_message_delta'
      | 'tool_execution_started'
      | 'tool_execution_updated'
      | 'tool_execution_finished'
  }
>

function streamStartedAt(state: AgentLiveStreamState, observedAt: number) {
  return state.startedAt ?? observedAt
}

export function reduceAgentLiveStreamState(
  state: AgentLiveStreamState,
  event: AgentLiveStreamEvent,
  observedAt = Date.now(),
): AgentLiveStreamState {
  switch (event.type) {
    case 'assistant_message_started':
      return {
        assistantText: '',
        thinkingText: '',
        isThinkingStreaming: false,
        startedAt: observedAt,
        tools: state.tools,
      }
    case 'assistant_thinking_delta':
      return {
        ...state,
        isThinkingStreaming: true,
        thinkingText: state.thinkingText + event.delta,
        startedAt: streamStartedAt(state, observedAt),
      }
    case 'assistant_thinking_finished':
      return {
        ...state,
        isThinkingStreaming: false,
        startedAt: streamStartedAt(state, observedAt),
      }
    case 'assistant_message_delta':
      return {
        ...state,
        assistantText: state.assistantText + event.delta,
        startedAt: streamStartedAt(state, observedAt),
      }
    case 'tool_execution_started':
      return {
        ...state,
        startedAt: streamStartedAt(state, observedAt),
        tools: [
          ...state.tools.filter((tool) => tool.id !== event.toolCallId),
          {
            id: event.toolCallId,
            name: event.toolName,
            status: 'running',
            summary: event.summary,
            startedAt: observedAt,
          },
        ],
      }
    case 'tool_execution_updated': {
      const existing = state.tools.find((tool) => tool.id === event.toolCallId)
      return {
        ...state,
        startedAt: streamStartedAt(state, observedAt),
        tools: existing
          ? state.tools.map((tool) => tool.id === event.toolCallId
              ? { ...tool, name: event.toolName, status: 'running', summary: event.summary }
              : tool)
          : [...state.tools, {
              id: event.toolCallId,
              name: event.toolName,
              status: 'running',
              summary: event.summary,
              startedAt: observedAt,
            }],
      }
    }
    case 'tool_execution_finished': {
      const existing = state.tools.find((tool) => tool.id === event.toolCallId)
      const completed = {
        id: event.toolCallId,
        isError: event.isError,
        name: event.toolName,
        status: event.isError ? 'error' as const : 'done' as const,
        summary: event.summary,
        startedAt: existing?.startedAt ?? observedAt,
      }
      return {
        ...state,
        startedAt: streamStartedAt(state, observedAt),
        tools: existing
          ? state.tools.map((tool) => tool.id === event.toolCallId ? completed : tool)
          : [...state.tools, completed],
      }
    }
  }
}

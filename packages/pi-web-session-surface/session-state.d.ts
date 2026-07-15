import type {
  PiWebAgentMessage,
  PiWebNativeSessionSnapshot,
  PiWebOptimisticUserMessage,
} from './index.js'

export type PiWebAgentPhase =
  | { kind: 'waiting_model' }
  | { kind: 'running_command' }
  | { kind: 'running_tools'; tools: Array<{ id: string; name: string }> }
  | null

export type PiWebSessionState = {
  agentPhase: PiWebAgentPhase
  agentRunning: boolean
  entryIds: string[]
  messages: PiWebAgentMessage[]
  optimisticMessages: PiWebAgentMessage[]
  streamingMessage: Partial<PiWebAgentMessage> | null
}

export type PiWebSessionAction =
  | { type: 'native_event'; event: { type: string; [key: string]: unknown } }
  | { type: 'set_optimistic'; messages: PiWebOptimisticUserMessage[] }
  | { type: 'set_snapshot'; snapshot: PiWebNativeSessionSnapshot }

export function createPiWebSessionState(snapshot: PiWebNativeSessionSnapshot): PiWebSessionState
export function getPiWebVisibleMessages(state: PiWebSessionState): PiWebAgentMessage[]
export function piWebUserMessageKey(message: Partial<PiWebAgentMessage>): string
export function reducePiWebSessionState(
  state: PiWebSessionState,
  action: PiWebSessionAction,
): PiWebSessionState

export type PiWebAgentId = 'builtin-pi' | 'pi'

export type PiWebAgentMessage = {
  role: string
  content?: unknown
  timestamp?: number
  [key: string]: unknown
}

export type PiWebNativeSessionSnapshot = {
  agentId: PiWebAgentId
  entryIds: string[]
  isStreaming: boolean
  messages: PiWebAgentMessage[]
  modelNames: Record<string, string>
  sessionId: string
}

export type PiWebOptimisticUserMessage = {
  content: unknown
  timestamp: number
}

export type PiWebSurfaceEvent = {
  agentId: PiWebAgentId
  event: { type: string; [key: string]: unknown }
  sessionId: string
}

export type PiWebSessionSurfaceOptions = {
  bridge: {
    openWorkspaceFile?: (filePath: string) => Promise<unknown> | unknown
    subscribe: (listener: (event: PiWebSurfaceEvent) => void) => () => void
  }
  sessionId: string
  snapshot: PiWebNativeSessionSnapshot
  workspacePath: string
}

export type PiWebSessionSurface = {
  dispose: () => void
  setOptimisticUserMessages: (messages: PiWebOptimisticUserMessage[]) => void
  setSnapshot: (snapshot: PiWebNativeSessionSnapshot) => void
}

export function mountPiWebSessionSurface(
  container: HTMLElement,
  options: PiWebSessionSurfaceOptions,
): PiWebSessionSurface

export type {
  PiWebAgentPhase,
  PiWebSessionAction,
  PiWebSessionState,
} from './session-state.js'

export function createPiWebSessionState(
  snapshot: PiWebNativeSessionSnapshot,
): import('./session-state.js').PiWebSessionState
export function getPiWebVisibleMessages(
  state: import('./session-state.js').PiWebSessionState,
): PiWebAgentMessage[]
export function piWebUserMessageKey(message: Partial<PiWebAgentMessage>): string
export function reducePiWebSessionState(
  state: import('./session-state.js').PiWebSessionState,
  action: import('./session-state.js').PiWebSessionAction,
): import('./session-state.js').PiWebSessionState

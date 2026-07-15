import type { AgentMessage } from '@/lib/types'

export type PiWebAgentId = 'builtin-pi' | 'pi'

export type PiWebNativeSessionSnapshot = {
  agentId: PiWebAgentId
  entryIds: string[]
  isStreaming: boolean
  messages: AgentMessage[]
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

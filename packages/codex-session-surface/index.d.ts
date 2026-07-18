export type CodexSessionExecutionState =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; message: string; attempt: number; next: number }

export type CodexOptimisticUserMessage = {
  id: string
  text: string
  timestamp: number
  attachments?: ReadonlyArray<{
    id?: string
    name?: string
    path?: string
    url?: string
    mimeType?: string
  }>
}

export type CodexNativeSessionSnapshot = {
  agentId: 'codex'
  itemRuntime: Record<string, { output: string; progress: string[]; terminalInput: string }>
  notices: Array<{ id: string; kind: 'error' | 'warning'; message: string; turnId: string | null; willRetry?: boolean }>
  sequence: number
  status: CodexSessionExecutionState
  thread: {
    id: string
    createdAt: number
    updatedAt: number
    cwd: string
    turns: Array<{
      id: string
      status: string
      error: { message: string } | null
      startedAt: number | null
      completedAt: number | null
      durationMs: number | null
      items: Array<{ type: string; id: string; [key: string]: unknown }>
    }>
  }
  tokenUsage: unknown
  turnRuntime: Record<string, { diff: string | null; plan: { explanation: string | null; steps: Array<{ step: string; status: string }> } | null }>
}

export type CodexSessionSurfaceOptions = {
  bridge?: { openWorkspaceFile?: (filePath: string) => void }
  optimisticUserMessages?: CodexOptimisticUserMessage[]
  snapshot: CodexNativeSessionSnapshot
  workspacePath: string
}

export type CodexSessionSurface = {
  dispose: () => void
  setOptimisticUserMessages: (messages: CodexOptimisticUserMessage[]) => void
  setSnapshot: (snapshot: CodexNativeSessionSnapshot) => void
}

export declare function mountCodexSessionSurface(container: HTMLElement, options: CodexSessionSurfaceOptions): CodexSessionSurface

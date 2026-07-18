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

export type CodexItemRuntime = {
  output: string
  progress: string[]
  terminalInput: string
}

export type CodexNativeThreadItem = {
  type: string
  id: string
  aggregatedOutput?: unknown
  arguments?: unknown
  agentPath?: unknown
  changes?: unknown
  clientId?: unknown
  command?: unknown
  content?: unknown
  contentItems?: unknown
  cwd?: unknown
  durationMs?: unknown
  error?: unknown
  exitCode?: unknown
  fragments?: unknown
  kind?: unknown
  path?: unknown
  phase?: unknown
  prompt?: unknown
  query?: unknown
  result?: unknown
  revisedPrompt?: unknown
  review?: unknown
  savedPath?: unknown
  server?: unknown
  status?: unknown
  success?: unknown
  summary?: unknown
  text?: unknown
  tool?: unknown
  url?: unknown
}

export type CodexNativeSessionSnapshot = {
  agentId: 'codex'
  itemRuntime: Record<string, CodexItemRuntime>
  notices: Array<{
    id: string
    kind: 'error' | 'warning'
    message: string
    turnId: string | null
    willRetry?: boolean
  }>
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
      items: CodexNativeThreadItem[]
    }>
  }
  tokenUsage: unknown
  turnRuntime: Record<string, {
    diff: string | null
    plan: { explanation: string | null; steps: Array<{ step: string; status: string }> } | null
  }>
}

export type CodexSessionSurfaceBridge = {
  openWorkspaceFile?: (filePath: string) => void
}

export type CodexSessionSurfaceOptions = {
  bridge?: CodexSessionSurfaceBridge
  optimisticUserMessages?: CodexOptimisticUserMessage[]
  snapshot: CodexNativeSessionSnapshot
  workspacePath: string
}

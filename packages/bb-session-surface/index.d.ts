export type BbAgentId = 'builtin-pi' | 'pi' | 'opencode' | 'codex'

export type BbTheme = 'dark' | 'light'

export type BbNativeSessionSnapshot = {
  agentId: BbAgentId
  [key: string]: unknown
}

export type BbOptimisticUserMessage = {
  id?: string
  text?: string
  content?: unknown
  timestamp?: number
  attachments?: ReadonlyArray<Record<string, unknown>>
  baselineUserMessageIds?: ReadonlyArray<string>
  [key: string]: unknown
}

export type BbNativeFileChange = {
  kind?: string
  path: string
  diff?: string | null
  movePath?: string | null
}

export type BbInteractionOption = {
  description?: string
  id: string
  label: string
}

export type BbInteractionField = {
  allowsCustomAnswer?: boolean
  id: string
  isSecret?: boolean
  label: string
  message?: string
  multiSelect?: boolean
  options?: BbInteractionOption[]
}

export type BbInteractionTimelineRecord = {
  request: {
    fields?: BbInteractionField[]
    id: string
    itemId?: string
    kind: 'permission' | 'question'
    message: string
    options: BbInteractionOption[]
    sessionId: string
    title: string
    turnId?: string
  }
  requestedAt: number
  resolvedAt?: number
  response?: {
    answers?: Record<string, string[]>
    optionId: string
    values?: string[]
  }
  status: 'pending' | 'resolved' | 'interrupted'
  statusReason?: string
}

export type BbSessionRuntimeState = {
  compactionReason?: string | null
  error?: string | null
  executionState?: {
    action?: {
      label?: string
      link?: string
      message?: string
      provider?: string
      reason?: string
      title?: string
    }
    attempt?: number
    message?: string
    next?: number
    type: 'idle' | 'busy' | 'retry'
  }
  isCompacting?: boolean
  isStopping?: boolean
  isStreaming?: boolean
  streaming?: {
    assistantText?: string
    isThinkingStreaming?: boolean
    startedAt?: number | null
    thinkingText?: string
    tools?: Array<{
      id: string
      isError?: boolean
      name: string
      startedAt?: number
      status: 'idle' | 'running' | 'done' | 'error'
      summary: string
    }>
  }
  retryAttempt?: number
  retryMaxAttempts?: number | null
  stoppingAnchorAt?: number
}

export type BbSessionPaginationState = {
  hasOlderTimelineRows: boolean
  isLoadingOlderTimelineRows: boolean
}

export type BbSessionSurfaceOptions = {
  bridge?: {
    loadOlderTimelineRows?: () => Promise<void> | void
    openExternal?: (href: string) => Promise<unknown> | unknown
    openWorkspaceFile?: (filePath: string) => Promise<unknown> | unknown
    requestNativeView?: () => void
  }
  fileChanges?: BbNativeFileChange[]
  interactionRecords?: BbInteractionTimelineRecord[]
  optimisticUserMessages?: BbOptimisticUserMessage[]
  paginationState?: BbSessionPaginationState
  runtimeState?: BbSessionRuntimeState
  sessionId: string
  snapshot: BbNativeSessionSnapshot
  theme: BbTheme
  workspacePath: string
}

export type BbSessionSurface = {
  dispose: () => void
  setFileChanges: (fileChanges: BbNativeFileChange[]) => void
  setInteractionRecords: (records: BbInteractionTimelineRecord[]) => void
  setOptimisticUserMessages: (messages: BbOptimisticUserMessage[]) => void
  setPaginationState: (state: BbSessionPaginationState) => void
  setRuntimeState: (state: BbSessionRuntimeState) => void
  setSnapshot: (snapshot: BbNativeSessionSnapshot) => void
  setTheme: (theme: BbTheme) => void
}

export declare function mountBbSessionSurface(
  container: HTMLElement,
  options: BbSessionSurfaceOptions,
): BbSessionSurface

import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AgentMessageFileChange } from '../../../../shared/agent-contracts/types'

export type BuiltinPiSessionRuntime = {
  activity: {
    pendingAssistantEntryId: string | null
    runningToolCalls: Map<string, {
      existedBeforeWrite: boolean | null
      filePath: string | null
      ownerEntryId: string | null
      parsedFileChanges: AgentMessageFileChange[]
      toolName: string
    }>
  }
  cwd: string
  session: AgentSession
  status: {
    compactionReason: 'manual' | 'overflow' | 'threshold' | null
    retryMaxAttempts: number | null
  }
  unsubscribe: () => void
}

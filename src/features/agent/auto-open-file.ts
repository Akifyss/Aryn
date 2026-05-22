import type {
  AgentMessageFileChange,
  AgentSidebarMessage,
} from './types'

export type LatestAgentAutoOpenFileChange = {
  change: AgentMessageFileChange
  key: string
}

export type AgentFileAutoOpenState = {
  initialized: boolean
  lastFileChangeKey: string
  sessionPath: string | null
}

export const initialAgentFileAutoOpenState: AgentFileAutoOpenState = {
  initialized: false,
  lastFileChangeKey: '',
  sessionPath: null,
}

export function findLatestOpenableAgentFileChange(
  messages: AgentSidebarMessage[],
  fileChangesByMessageId: Map<string, AgentMessageFileChange[]>,
): LatestAgentAutoOpenFileChange | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    const fileChanges = fileChangesByMessageId.get(message.id)

    if (!fileChanges || fileChanges.length === 0) {
      continue
    }

    const nextChange = fileChanges.find((change) => change.kind !== 'deleted')
    if (nextChange) {
      return {
        change: nextChange,
        key: `${message.id}:${nextChange.kind}:${nextChange.filePath}`,
      }
    }
  }

  return null
}

export function resolveNextAgentFileAutoOpen(
  currentState: AgentFileAutoOpenState,
  {
    activeSessionPath,
    isViewingActiveRuntime,
    latestFileChange,
  }: {
    activeSessionPath: string | null
    isViewingActiveRuntime: boolean
    latestFileChange: LatestAgentAutoOpenFileChange | null
  },
): { fileChange: AgentMessageFileChange | null, state: AgentFileAutoOpenState } {
  if (!activeSessionPath || !isViewingActiveRuntime) {
    return {
      fileChange: null,
      state: initialAgentFileAutoOpenState,
    }
  }

  const nextBaselineKey = latestFileChange?.key ?? ''
  const isSessionChanged = currentState.sessionPath !== activeSessionPath

  if (isSessionChanged || !currentState.initialized) {
    return {
      fileChange: null,
      state: {
        initialized: true,
        lastFileChangeKey: nextBaselineKey,
        sessionPath: activeSessionPath,
      },
    }
  }

  if (!latestFileChange || latestFileChange.key === currentState.lastFileChangeKey) {
    return {
      fileChange: null,
      state: currentState,
    }
  }

  return {
    fileChange: latestFileChange.change,
    state: {
      ...currentState,
      lastFileChangeKey: latestFileChange.key,
    },
  }
}

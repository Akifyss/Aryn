import type {
  AgentMessageFileChange,
  AgentSessionAnnotations,
  AgentSidebarMessage,
} from './types'
import { mergeFileChangesByPath } from './file-change-utils'

type BuildRoundFileChangesByMessageIdOptions = {
  annotations: AgentSessionAnnotations
  hasInFlightRound: boolean
  messages: AgentSidebarMessage[]
}

export function buildRoundFileChangesByMessageId({
  annotations,
  hasInFlightRound,
  messages,
}: BuildRoundFileChangesByMessageIdOptions) {
  const roundFileChangesByMessageId = new Map<string, AgentMessageFileChange[]>()
  let currentRoundMessageIds: string[] = []
  let currentRoundFileChanges: AgentMessageFileChange[] = []

  const flushRound = (shouldRender: boolean) => {
    if (!shouldRender || currentRoundMessageIds.length === 0 || currentRoundFileChanges.length === 0) {
      currentRoundMessageIds = []
      currentRoundFileChanges = []
      return
    }

    const targetMessageId = currentRoundMessageIds[currentRoundMessageIds.length - 1]
    const mergedFileChanges = mergeFileChangesByPath(currentRoundFileChanges)

    if (targetMessageId && mergedFileChanges.length > 0) {
      roundFileChangesByMessageId.set(targetMessageId, mergedFileChanges)
    }

    currentRoundMessageIds = []
    currentRoundFileChanges = []
  }

  for (const message of messages) {
    if (message.kind === 'user') {
      flushRound(true)
      continue
    }

    currentRoundMessageIds.push(message.id)

    if (message.sessionEntryId) {
      currentRoundFileChanges.push(...(annotations.fileChangesByEntryId[message.sessionEntryId] ?? []))
    }
  }

  flushRound(!hasInFlightRound)
  return roundFileChangesByMessageId
}

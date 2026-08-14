import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import type { PiWebAgentMessage } from '../../../shared/agent-contracts/types'

function parseValidEntryTimestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Preserve PI's full native branch for the vendored pi-web renderer. */
export function serializePiWebSessionEntries(entries: SessionEntry[]) {
  const messages: PiWebAgentMessage[] = []
  const entryIds: string[] = []
  for (const entry of entries) {
    let message: PiWebAgentMessage | null = null
    if (entry.type === 'message') {
      const completedAt = parseValidEntryTimestamp(entry.timestamp)
      message = {
        ...(entry.message as unknown as PiWebAgentMessage),
        ...(completedAt === null ? {} : { completedAt }),
      }
    } else if (entry.type === 'compaction') {
      const timestamp = parseValidEntryTimestamp(entry.timestamp)
      message = {
        role: 'custom',
        customType: 'compaction',
        content: entry.summary,
        display: true,
        details: { tokensBefore: entry.tokensBefore, firstKeptEntryId: entry.firstKeptEntryId },
        ...(timestamp === null ? {} : { completedAt: timestamp, timestamp }),
      }
    } else if (entry.type === 'branch_summary' && entry.summary) {
      const timestamp = parseValidEntryTimestamp(entry.timestamp)
      message = {
        role: 'user',
        content: `*The conversation briefly explored another branch and returned with this summary:*\n\n${entry.summary}`,
        ...(timestamp === null ? {} : { completedAt: timestamp, timestamp }),
      }
    } else if (entry.type === 'custom_message') {
      const timestamp = parseValidEntryTimestamp(entry.timestamp)
      message = {
        role: 'custom',
        customType: entry.customType,
        content: entry.content,
        display: entry.display,
        details: entry.details,
        ...(timestamp === null ? {} : { completedAt: timestamp, timestamp }),
      }
    }
    if (message) {
      messages.push(message)
      entryIds.push(entry.id)
    }
  }
  return { entryIds, messages }
}

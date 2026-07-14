import type {
  Event as OpenCodeEvent,
  Message,
  Part,
} from '@opencode-ai/sdk/v2'

type JsonRecord = Record<string, unknown>

type OpenCodeSessionMessageState = {
  messages: Map<string, Message>
  messageRevisions: Map<string, number>
  partsByMessageId: Map<string, Map<string, Part>>
  partRevisions: Map<string, number>
  removedMessageIds: Set<string>
  removedPartIdsByMessageId: Map<string, Set<string>>
  clearedMessagePartIds: Set<string>
  revision: number
  hydrationGeneration: number
}

export type OpenCodeSessionHydrationCheckpoint = {
  generation: number
  revision: number
  sessionId: string
}

export type OpenCodeSessionEventReduction = {
  awaitingBaseline: boolean
  changed: boolean
  sessionId: string | null
}

function eventProperties(event: OpenCodeEvent) {
  return ('properties' in event ? event.properties : {}) as JsonRecord
}

function nestedString(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return null
  const candidate = (value as JsonRecord)[key]
  return typeof candidate === 'string' && candidate ? candidate : null
}

/**
 * OpenCode has used both top-level event session IDs and IDs nested in the
 * message/part payload. Supporting both keeps Aryn compatible with adjacent
 * CLI/SDK releases instead of silently dropping otherwise valid events.
 */
export function getOpenCodeEventSessionId(event: OpenCodeEvent) {
  const properties = eventProperties(event)
  const direct = properties.sessionID
  if (typeof direct === 'string' && direct) return direct
  return nestedString(properties.info, 'sessionID')
    ?? nestedString(properties.part, 'sessionID')
}

function compareMessages(left: Message, right: Message) {
  return left.id.localeCompare(right.id)
}

function compareParts(left: Part, right: Part) {
  return left.id.localeCompare(right.id)
}

export class OpenCodeSessionMessageReducer {
  private readonly sessions = new Map<string, OpenCodeSessionMessageState>()

  beginHydration(sessionId: string): OpenCodeSessionHydrationCheckpoint {
    const state = this.getOrCreate(sessionId)
    state.hydrationGeneration += 1
    return {
      generation: state.hydrationGeneration,
      revision: state.revision,
      sessionId,
    }
  }

  cancelHydration(checkpoint: OpenCodeSessionHydrationCheckpoint) {
    const state = this.sessions.get(checkpoint.sessionId)
    if (!state || state.hydrationGeneration !== checkpoint.generation) return
    state.hydrationGeneration += 1
  }

  /**
   * Reconciles a REST baseline with native events that arrived while it was in
   * flight. This is the same invariant OpenCode Desktop protects with its
   * touched-message/part sets: a stale fetch must never overwrite a newer SSE
   * update or resurrect an event-only removal.
   */
  hydrate(
    sessionId: string,
    records: Array<{ info: Message, parts: Part[] }>,
    checkpoint?: OpenCodeSessionHydrationCheckpoint,
  ) {
    const state = this.getOrCreate(sessionId)
    if (
      checkpoint
      && (checkpoint.sessionId !== sessionId || checkpoint.generation !== state.hydrationGeneration)
    ) return false

    const messages = new Map<string, Message>()
    const partsByMessageId = new Map<string, Map<string, Part>>()
    for (const record of records) {
      if (state.removedMessageIds.has(record.info.id)) continue
      messages.set(record.info.id, record.info)
      if (state.clearedMessagePartIds.has(record.info.id)) {
        const current = state.partsByMessageId.get(record.info.id)
        if (current?.size) partsByMessageId.set(record.info.id, new Map(current))
        continue
      }
      const removedParts = state.removedPartIdsByMessageId.get(record.info.id)
      const parts = new Map(record.parts
        .filter((part) => !removedParts?.has(part.id))
        .map((part) => [part.id, part]))
      if (parts.size > 0) partsByMessageId.set(record.info.id, parts)
    }

    if (checkpoint) {
      for (const [messageId, revision] of state.messageRevisions) {
        if (revision <= checkpoint.revision) continue
        const current = state.messages.get(messageId)
        if (current) messages.set(messageId, current)
        else {
          messages.delete(messageId)
          partsByMessageId.delete(messageId)
        }
      }
      for (const [key, revision] of state.partRevisions) {
        if (revision <= checkpoint.revision) continue
        const separator = key.indexOf('\0')
        const messageId = key.slice(0, separator)
        const partId = key.slice(separator + 1)
        if (!messages.has(messageId)) continue
        const current = state.partsByMessageId.get(messageId)?.get(partId)
        if (current) {
          const parts = partsByMessageId.get(messageId) ?? new Map<string, Part>()
          parts.set(partId, current)
          partsByMessageId.set(messageId, parts)
        } else {
          const parts = partsByMessageId.get(messageId)
          parts?.delete(partId)
          if (parts?.size === 0) partsByMessageId.delete(messageId)
        }
      }
    }

    state.messages = messages
    state.partsByMessageId = partsByMessageId
    if (checkpoint) state.hydrationGeneration += 1
    return true
  }

  clear(sessionId: string) {
    this.sessions.delete(sessionId)
  }

  clearAll() {
    this.sessions.clear()
  }

  hasBufferedState(sessionId: string) {
    const state = this.sessions.get(sessionId)
    return Boolean(state && (state.messages.size > 0 || state.partsByMessageId.size > 0))
  }

  records(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (!state) return []
    return [...state.messages.values()]
      .sort(compareMessages)
      .map((info) => ({
        info,
        parts: [...(state.partsByMessageId.get(info.id)?.values() ?? [])].sort(compareParts),
      }))
  }

  apply(event: OpenCodeEvent): OpenCodeSessionEventReduction {
    const properties = eventProperties(event)
    const sessionId = getOpenCodeEventSessionId(event)
    if (!sessionId) return { awaitingBaseline: false, changed: false, sessionId: null }
    const state = this.getOrCreate(sessionId)

    if (event.type === 'message.updated') {
      const info = properties.info as Message | undefined
      if (!info?.id) return { awaitingBaseline: true, changed: false, sessionId }
      state.removedMessageIds.delete(info.id)
      state.messages.set(info.id, info)
      state.messageRevisions.set(info.id, this.nextRevision(state))
      return { awaitingBaseline: false, changed: true, sessionId }
    }

    if (event.type === 'message.removed') {
      const messageId = typeof properties.messageID === 'string' ? properties.messageID : null
      if (!messageId) return { awaitingBaseline: false, changed: false, sessionId }
      const removedMessage = state.messages.delete(messageId)
      const removedParts = state.partsByMessageId.delete(messageId)
      state.removedMessageIds.add(messageId)
      state.removedPartIdsByMessageId.delete(messageId)
      state.clearedMessagePartIds.add(messageId)
      state.messageRevisions.set(messageId, this.nextRevision(state))
      const changed = removedMessage || removedParts
      return { awaitingBaseline: false, changed, sessionId }
    }

    if (event.type === 'message.part.updated') {
      const part = properties.part as Part | undefined
      if (!part?.id || !part.messageID) return { awaitingBaseline: true, changed: false, sessionId }
      if (state.removedMessageIds.has(part.messageID)) {
        return { awaitingBaseline: false, changed: false, sessionId }
      }
      const parts = state.partsByMessageId.get(part.messageID) ?? new Map<string, Part>()
      parts.set(part.id, part)
      state.partsByMessageId.set(part.messageID, parts)
      const removedParts = state.removedPartIdsByMessageId.get(part.messageID)
      removedParts?.delete(part.id)
      if (removedParts?.size === 0) state.removedPartIdsByMessageId.delete(part.messageID)
      state.partRevisions.set(this.partKey(part.messageID, part.id), this.nextRevision(state))
      return {
        changed: true,
        awaitingBaseline: !state.messages.has(part.messageID),
        sessionId,
      }
    }

    if (event.type === 'message.part.removed') {
      const messageId = typeof properties.messageID === 'string' ? properties.messageID : null
      const partId = typeof properties.partID === 'string' ? properties.partID : null
      if (!messageId || !partId) return { awaitingBaseline: false, changed: false, sessionId }
      const removedParts = state.removedPartIdsByMessageId.get(messageId) ?? new Set<string>()
      removedParts.add(partId)
      state.removedPartIdsByMessageId.set(messageId, removedParts)
      state.partRevisions.set(this.partKey(messageId, partId), this.nextRevision(state))
      const parts = state.partsByMessageId.get(messageId)
      if (!parts) return { awaitingBaseline: false, changed: false, sessionId }
      const changed = parts.delete(partId)
      if (parts.size === 0) state.partsByMessageId.delete(messageId)
      return { awaitingBaseline: false, changed, sessionId }
    }

    if (event.type === 'message.part.delta') {
      const messageId = typeof properties.messageID === 'string' ? properties.messageID : null
      const partId = typeof properties.partID === 'string' ? properties.partID : null
      const field = typeof properties.field === 'string' ? properties.field : null
      const delta = typeof properties.delta === 'string' ? properties.delta : null
      if (!messageId || !partId || !field || delta === null) {
        return { awaitingBaseline: true, changed: false, sessionId }
      }
      const parts = state.partsByMessageId.get(messageId)
      const part = parts?.get(partId)
      if (!part) return { awaitingBaseline: true, changed: false, sessionId }
      const currentValue = (part as unknown as JsonRecord)[field]
      if (currentValue !== undefined && typeof currentValue !== 'string') {
        return { awaitingBaseline: true, changed: false, sessionId }
      }
      parts!.set(partId, {
        ...part,
        [field]: `${currentValue ?? ''}${delta}`,
      } as Part)
      state.partRevisions.set(this.partKey(messageId, partId), this.nextRevision(state))
      return { awaitingBaseline: false, changed: true, sessionId }
    }

    return { awaitingBaseline: false, changed: false, sessionId }
  }

  private getOrCreate(sessionId: string) {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing
    const state: OpenCodeSessionMessageState = {
      hydrationGeneration: 0,
      clearedMessagePartIds: new Set(),
      messageRevisions: new Map(),
      messages: new Map(),
      partRevisions: new Map(),
      partsByMessageId: new Map(),
      removedMessageIds: new Set(),
      removedPartIdsByMessageId: new Map(),
      revision: 0,
    }
    this.sessions.set(sessionId, state)
    return state
  }

  private nextRevision(state: OpenCodeSessionMessageState) {
    state.revision += 1
    return state.revision
  }

  private partKey(messageId: string, partId: string) {
    return `${messageId}\0${partId}`
  }
}

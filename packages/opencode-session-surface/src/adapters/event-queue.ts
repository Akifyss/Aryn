import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2/client'

export type QueuedOpenCodeEvent = {
  directory: string
  payload: OpenCodeEvent
}

// Copied from OpenCode packages/app/src/context/server-sdk.tsx. Keeping the
// frame coalescing semantics here prevents IPC delivery from changing the
// official ordering and delta accumulation behavior.
const coalescedKey = (event: QueuedOpenCodeEvent) => {
  if (event.payload.type === 'lsp.updated') return `lsp.updated:${event.directory}`
  if (event.payload.type === 'message.part.updated') {
    const part = event.payload.properties.part
    return `message.part.updated:${event.directory}:${part.messageID}:${part.id}`
  }
  return undefined
}

export function enqueueOpenCodeEvent(queue: QueuedOpenCodeEvent[], event: QueuedOpenCodeEvent) {
  const key = coalescedKey(event)
  const previous = queue[queue.length - 1]
  if (key && previous && coalescedKey(previous) === key) {
    queue[queue.length - 1] = event
    return false
  }
  queue.push(event)
  return true
}

export function coalesceOpenCodeEvents(events: QueuedOpenCodeEvent[]) {
  const output: QueuedOpenCodeEvent[] = []
  events.forEach((event) => {
    if (event.payload.type !== 'message.part.delta') {
      output.push(event)
      return
    }
    const props = event.payload.properties
    const previous = output[output.length - 1]
    if (
      !previous
      || previous.payload.type !== 'message.part.delta'
      || previous.directory !== event.directory
      || previous.payload.properties.messageID !== props.messageID
      || previous.payload.properties.partID !== props.partID
      || previous.payload.properties.field !== props.field
    ) {
      output.push({
        directory: event.directory,
        payload: { ...event.payload, properties: { ...props } },
      })
      return
    }
    output[output.length - 1] = {
      directory: event.directory,
      payload: {
        ...event.payload,
        properties: { ...props, delta: previous.payload.properties.delta + props.delta },
      },
    }
  })
  return output
}

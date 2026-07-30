import { describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '@opencode-ai/sdk/v2'
import { OpenCodeEventStream } from '../electron/main/agent-host/providers/opencode/event-stream'

async function* streamUntilAborted(
  signal: AbortSignal,
  envelope: unknown,
) {
  yield envelope
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

describe('OpenCodeEventStream', () => {
  it('dispatches global envelopes and stops through the subscription signal', async () => {
    let subscriptionSignal!: AbortSignal
    const event = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      subscriptionSignal = signal
      return {
        stream: streamUntilAborted(signal, {
          directory: 'C:/workspace',
          payload: { type: 'session.idle', properties: { sessionID: 'session-a' } },
        }),
      }
    })
    const onEvent = vi.fn(async () => undefined)
    const eventStream = new OpenCodeEventStream()

    await eventStream.start({
      global: { event },
    } as unknown as OpencodeClient, {
      isCurrent: () => true,
      onEvent,
      onEventError: vi.fn(),
      onReconnect: vi.fn(),
    })
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())

    eventStream.stop()
    expect(subscriptionSignal.aborted).toBe(true)
  })

  it('propagates an initial subscription failure to server startup', async () => {
    const eventStream = new OpenCodeEventStream()
    const client = {
      global: {
        event: vi.fn(async () => {
          throw new Error('subscription failed')
        }),
      },
    } as unknown as OpencodeClient

    await expect(eventStream.start(client, {
      isCurrent: () => true,
      onEvent: vi.fn(),
      onEventError: vi.fn(),
      onReconnect: vi.fn(),
    })).rejects.toThrow('subscription failed')
  })
})

import type {
  GlobalEvent as OpenCodeGlobalEvent,
  OpencodeClient,
} from '@opencode-ai/sdk/v2'

type OpenCodeEventSubscription = Awaited<ReturnType<OpencodeClient['global']['event']>>

type OpenCodeEventStreamOptions = {
  isCurrent: () => boolean
  onEvent: (envelope: OpenCodeGlobalEvent) => Promise<void>
  onEventError: (error: unknown, envelope: OpenCodeGlobalEvent) => void
  onReconnect: () => Promise<void>
}

const RECONNECT_MAX_MS = 3_000
const RECONNECT_MIN_MS = 250

function waitForAbortableDelay(delay: number, signal: AbortSignal) {
  if (signal.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, delay)
    signal.addEventListener('abort', finish, { once: true })
  })
}

/**
 * Supervises OpenCode's non-durable global event stream.
 *
 * The manager remains responsible for native event projection and recovery;
 * this transport component owns subscription, reconnect backoff and shutdown.
 */
export class OpenCodeEventStream {
  private abortController: AbortController | null = null
  private loop: Promise<void> | null = null

  async start(client: OpencodeClient, options: OpenCodeEventStreamOptions) {
    this.stop()
    const controller = new AbortController()
    this.abortController = controller
    let subscription: OpenCodeEventSubscription
    try {
      subscription = await client.global.event({ signal: controller.signal })
    } catch (error) {
      if (this.abortController === controller) this.stop()
      throw error
    }
    if (controller.signal.aborted || !options.isCurrent()) {
      if (this.abortController === controller) this.stop()
      return
    }
    this.loop = this.run(client, subscription, controller, options)
  }

  stop() {
    this.abortController?.abort()
    this.abortController = null
    this.loop = null
  }

  private async run(
    client: OpencodeClient,
    initialSubscription: OpenCodeEventSubscription,
    controller: AbortController,
    options: OpenCodeEventStreamOptions,
  ) {
    const signal = controller.signal
    let currentSubscription: OpenCodeEventSubscription | null = initialSubscription
    let reconnectAttempt = 0

    while (!signal.aborted && options.isCurrent()) {
      try {
        if (!currentSubscription) {
          currentSubscription = await client.global.event({ signal })
          await options.onReconnect()
          reconnectAttempt = 0
        }
        for await (const envelope of currentSubscription.stream) {
          if (signal.aborted || !options.isCurrent()) return
          reconnectAttempt = 0
          try {
            await options.onEvent(envelope as OpenCodeGlobalEvent)
          } catch (error) {
            options.onEventError(error, envelope as OpenCodeGlobalEvent)
          }
        }
        if (signal.aborted || !options.isCurrent()) return
        throw new Error('OpenCode event stream ended unexpectedly.')
      } catch {
        if (signal.aborted || !options.isCurrent()) return
        currentSubscription = null
        reconnectAttempt += 1
        const delay = Math.min(
          RECONNECT_MIN_MS * (2 ** Math.min(reconnectAttempt - 1, 4)),
          RECONNECT_MAX_MS,
        )
        await waitForAbortableDelay(delay, signal)
      }
    }
  }
}

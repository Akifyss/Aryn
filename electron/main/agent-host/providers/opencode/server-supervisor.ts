import { randomBytes } from 'node:crypto'
import {
  createOpencodeClient,
  type Event as OpenCodeEvent,
  type OpencodeClient,
} from '@opencode-ai/sdk/v2'
import {
  formatOpenCodeVersionCompatibilityError,
  isCompatibleOpenCodeVersion,
} from '../../../../shared/agent-contracts/providers/opencode/version'
import {
  createExternalCliEnvironment,
  prepareExternalCliEnvironment,
  resolveExternalCliCommand,
} from '../../../external-cli-environment'
import { OpenCodeEventStream } from './event-stream'
import {
  launchOpenCodeServer,
  type OpenCodeServer,
  type OpenCodeServerLaunchOptions,
} from './server-process'
import { unwrapOpenCodeSdkResult as unwrapSdkResult } from './session-model'

const OPEN_CODE_START_TIMEOUT_MS = 15_000

type OpenCodeServerSupervisorOptions = {
  onDisconnected: (error: unknown) => void
  onEvent: (
    client: OpencodeClient,
    generation: number,
    event: OpenCodeEvent,
    directory?: string,
  ) => Promise<void>
  onEventError: (error: unknown, event: OpenCodeEvent) => void
  onReconnect: (client: OpencodeClient, generation: number) => Promise<void>
  onRestartFailure: (error: unknown) => void
  startServer?: (options: OpenCodeServerLaunchOptions) => Promise<OpenCodeServer>
}

/** Owns OpenCode server credentials, health validation and SSE reconnection. */
export class OpenCodeServerSupervisor {
  private clientValue: OpencodeClient | null = null
  private disposed = false
  private readonly eventStream = new OpenCodeEventStream()
  private generationValue = 0
  private server: OpenCodeServer | null = null
  private serverExitUnsubscribe: (() => void) | null = null
  private serverPromise: Promise<void> | null = null

  constructor(private readonly options: OpenCodeServerSupervisorOptions) {}

  get client() {
    return this.clientValue
  }

  get generation() {
    return this.generationValue
  }

  isCurrent(client: OpencodeClient, generation: number) {
    return !this.disposed
      && this.clientValue === client
      && this.generationValue === generation
  }

  async ensureClient() {
    if (this.disposed) throw new Error('OpenCode server supervisor has been disposed.')
    if (!this.serverPromise) {
      if (this.clientValue) return this.clientValue
      this.serverPromise = this.startServer()
    }
    try {
      await this.serverPromise
    } catch (error) {
      this.serverPromise = null
      throw error
    }
    return this.clientValue!
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.invalidateConnection()
  }

  private async startServer() {
    await prepareExternalCliEnvironment()
    if (this.disposed) throw new Error('OpenCode server supervisor has been disposed.')
    const password = randomBytes(24).toString('base64url')
    const environment = createExternalCliEnvironment({
      OPENCODE_SERVER_PASSWORD: password,
      OPENCODE_SERVER_USERNAME: 'aryn',
    })
    const command = resolveExternalCliCommand('opencode', environment)
    if (!command) throw new Error('OpenCode CLI was not found in PATH.')
    const server = await (this.options.startServer ?? launchOpenCodeServer)({
      command,
      environment,
      hostname: '127.0.0.1',
      port: 0,
      timeout: OPEN_CODE_START_TIMEOUT_MS,
    })
    if (this.disposed) {
      server.close()
      throw new Error('OpenCode server supervisor was disposed during initialization.')
    }
    this.server = server

    const authorization = `Basic ${Buffer.from(`aryn:${password}`).toString('base64')}`
    const client = createOpencodeClient({
      baseUrl: server.url,
      headers: { Authorization: authorization },
    })
    const generation = this.generationValue + 1
    this.generationValue = generation
    this.clientValue = client
    let eventStreamStarted = false
    try {
      const health = unwrapSdkResult<{ healthy: true, version: string }>(
        await client.global.health({ throwOnError: true }),
        'health check',
      )
      if (!health.healthy || !isCompatibleOpenCodeVersion(health.version)) {
        throw new Error(formatOpenCodeVersionCompatibilityError(health.version))
      }

      eventStreamStarted = true
      await this.eventStream.start(client, {
        isCurrent: () => this.isCurrent(client, generation),
        onEvent: (envelope) => this.options.onEvent(
          client,
          generation,
          envelope.payload as OpenCodeEvent,
          envelope.directory,
        ),
        onEventError: (error, envelope) => {
          this.options.onEventError(error, envelope.payload as OpenCodeEvent)
        },
        onReconnect: () => this.options.onReconnect(client, generation),
      })
      this.serverExitUnsubscribe = server.onExit?.((error) => {
        if (this.disposed || this.server !== server || !this.isCurrent(client, generation)) return
        this.handleConnectionFailure(error)
        void this.ensureClient()
          .then((restartedClient) => (
            this.options.onReconnect(restartedClient, this.generationValue)
          ))
          .catch((cause) => {
            if (!this.disposed) this.options.onRestartFailure(cause)
          })
      }) ?? null
    } catch (error) {
      if (this.isCurrent(client, generation)) {
        if (eventStreamStarted) this.handleConnectionFailure(error)
        else this.invalidateConnection()
      }
      else if (this.server === server) {
        this.server = null
        server.close()
      }
      throw error
    }
  }

  private handleConnectionFailure(error: unknown) {
    this.invalidateConnection()
    if (!this.disposed) this.options.onDisconnected(error)
  }

  private invalidateConnection() {
    this.generationValue += 1
    this.eventStream.stop()
    this.serverExitUnsubscribe?.()
    this.serverExitUnsubscribe = null
    this.server?.close()
    this.server = null
    this.serverPromise = null
    this.clientValue = null
  }
}

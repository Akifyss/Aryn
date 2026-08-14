import { copyFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { ServerNotification } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/ServerNotification'
import type { ServerRequest } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/ServerRequest'
import type { Model } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/Model'
import type { ModelListResponse } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/ModelListResponse'
import { prepareExternalCliEnvironment } from '../../../external-cli-environment'
import {
  isCodexServiceTierCompatibilityError as isServiceTierCompatibilityError,
  isRecoverableCodexModelsCacheError as isRecoverableModelsCacheError,
} from './protocol-compatibility'
import { CodexRpcClient } from './rpc-client'

type CodexClientSupervisorOptions = {
  onExit: (client: CodexRpcClient, error: Error) => void
  onNotification: (client: CodexRpcClient, notification: ServerNotification) => void
  onRequest: (client: CodexRpcClient, request: ServerRequest) => void
}

type CodexClientInitializationBarrier = {
  promise: Promise<CodexRpcClient>
  reject: (error: Error) => void
  resolve: (client: CodexRpcClient) => void
  revision: number
  settled: boolean
}

function createInitializationBarrier(revision: number): CodexClientInitializationBarrier {
  let rejectPromise!: (error: Error) => void
  let resolvePromise!: (client: CodexRpcClient) => void
  const barrier: CodexClientInitializationBarrier = {
    promise: new Promise<CodexRpcClient>((resolve, reject) => {
      rejectPromise = reject
      resolvePromise = resolve
    }),
    reject: (error) => {
      if (barrier.settled) return
      barrier.settled = true
      rejectPromise(error)
    },
    resolve: (client) => {
      if (barrier.settled) return
      barrier.settled = true
      resolvePromise(client)
    },
    revision,
    settled: false,
  }
  void barrier.promise.catch(() => undefined)
  return barrier
}

/** Owns the single Codex App Server process, startup recovery and model cache. */
export class CodexClientSupervisor {
  private client: CodexRpcClient | null = null
  private clientPromise: Promise<CodexRpcClient> | null = null
  private disposed = false
  private initializationBarrier: CodexClientInitializationBarrier | null = null
  private initializedClient: CodexRpcClient | null = null
  private modelsValue: Model[] = []
  private serviceTierCompatibilityOverrideValue = false
  private startRevision = 0

  constructor(private readonly options: CodexClientSupervisorOptions) {}

  get currentClient() {
    return this.client
  }

  get models() {
    return this.modelsValue
  }

  get serviceTierCompatibilityOverride() {
    return this.serviceTierCompatibilityOverrideValue
  }

  isCurrent(client: CodexRpcClient) {
    return !this.disposed && this.client === client
  }

  async ensureClient() {
    if (this.disposed) throw new Error('Codex client supervisor has been disposed.')
    this.startIfNeeded()
    const clientPromise = this.clientPromise
    if (!clientPromise) throw new Error('Codex App Server failed to start.')
    try {
      return await clientPromise
    } catch (error) {
      if (this.clientPromise === clientPromise) {
        this.initializationBarrier?.reject(
          error instanceof Error ? error : new Error(String(error)),
        )
        this.client = null
        this.clientPromise = null
        this.initializedClient = null
      }
      throw error
    }
  }

  async ensureInitializedClient() {
    if (this.disposed) throw new Error('Codex client supervisor has been disposed.')
    this.startIfNeeded()
    if (this.initializedClient) return this.initializedClient
    const barrier = this.initializationBarrier
    if (!barrier) throw new Error('Codex App Server failed to initialize.')
    return barrier.promise
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.startRevision += 1
    this.initializationBarrier?.reject(new Error('Codex client supervisor was disposed during App Server initialization.'))
    this.client?.stop()
    this.client = null
    this.clientPromise = null
    this.initializationBarrier = null
    this.initializedClient = null
    this.modelsValue = []
  }

  private startIfNeeded() {
    if (this.clientPromise) return
    if (this.client) {
      this.initializedClient = this.client
      this.initializationBarrier = createInitializationBarrier(this.startRevision)
      this.initializationBarrier.resolve(this.client)
      this.clientPromise = Promise.resolve(this.client)
      return
    }
    this.startRevision += 1
    const startRevision = this.startRevision
    this.initializationBarrier = createInitializationBarrier(startRevision)
    const startup = this.startClient(startRevision)
    this.clientPromise = startup
    void startup.catch((error) => {
      if (this.clientPromise !== startup) return
      this.initializationBarrier?.reject(error instanceof Error ? error : new Error(String(error)))
      this.client = null
      this.clientPromise = null
      this.initializedClient = null
    })
  }

  private async startClient(startRevision: number) {
    let cacheRecoveryAttempted = false
    for (;;) {
      if (startRevision !== this.startRevision) {
        throw new Error('Codex App Server startup was superseded.')
      }
      if (
        !this.initializationBarrier
        || this.initializationBarrier.revision !== startRevision
        || (this.initializationBarrier.settled && !this.initializedClient)
      ) {
        this.initializationBarrier = createInitializationBarrier(startRevision)
      }
      const args = this.serviceTierCompatibilityOverrideValue
        ? ['app-server', '-c', 'service_tier=fast']
        : ['app-server']
      try {
        return await this.initializeClient(args)
      } catch (error) {
        if (this.disposed || startRevision !== this.startRevision) throw error
        if (!cacheRecoveryAttempted && isRecoverableModelsCacheError(error)) {
          cacheRecoveryAttempted = true
          if (await this.recoverModelsCache()) continue
        }
        if (
          !this.serviceTierCompatibilityOverrideValue
          && isServiceTierCompatibilityError(error)
        ) {
          this.serviceTierCompatibilityOverrideValue = true
          continue
        }
        throw error
      }
    }
  }

  private async recoverModelsCache() {
    const configuredHome = process.env.CODEX_HOME?.trim()
    const codexHome = configuredHome ? path.resolve(configuredHome) : path.join(os.homedir(), '.codex')
    const cachePath = path.join(codexHome, 'models_cache.json')
    const backupPath = path.join(codexHome, 'models_cache.aryn-incompatible.json')
    try {
      await copyFile(cachePath, backupPath)
      await rm(cachePath, { force: true })
      console.warn(`[codex app-server] Rebuilt an incompatible models cache. The previous cache is preserved at ${backupPath}.`)
      return true
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String((error as NodeJS.ErrnoException).code)
        : null
      if (code !== 'ENOENT') {
        console.warn(`[codex app-server] Could not preserve and rebuild the incompatible models cache: ${error instanceof Error ? error.message : String(error)}`)
      }
      return false
    }
  }

  private async initializeClient(args: string[]) {
    await prepareExternalCliEnvironment()
    if (this.disposed) throw new Error('Codex client supervisor has been disposed.')
    let client!: CodexRpcClient
    client = new CodexRpcClient({
      args,
      onExit: (error) => this.handleExit(client, error),
      onNotification: (notification) => {
        if (this.isCurrent(client)) this.options.onNotification(client, notification)
      },
      onProtocolWarning: (message) => console.warn(`[codex app-server] ${message}`),
      onRequest: (request) => {
        if (this.isCurrent(client)) this.options.onRequest(client, request)
      },
    })
    this.client = client
    client.start()
    try {
      await client.request('initialize', {
        capabilities: {
          experimentalApi: false,
          requestAttestation: false,
        },
        clientInfo: { name: 'aryn', title: 'Aryn', version: '0.1.0' },
      })
      client.notifyInitialized()
      if (this.disposed || this.client !== client) {
        throw new Error('Codex App Server initialization was superseded.')
      }
      this.initializedClient = client
      this.initializationBarrier?.resolve(client)
      const [models] = await Promise.all([
        this.loadModels(client),
        client.request('account/read', { refreshToken: false }).catch(() => null),
      ])
      if (this.disposed) {
        throw new Error('Codex client supervisor was disposed during App Server initialization.')
      }
      if (this.client !== client) throw new Error('Codex App Server initialization was superseded.')
      this.modelsValue = models
      return client
    } catch (error) {
      if (this.initializedClient === client) this.initializedClient = null
      if (this.client === client) this.client = null
      client.stop()
      throw error
    }
  }

  private handleExit(client: CodexRpcClient, error: Error) {
    if (this.client !== client) return
    this.startRevision += 1
    this.initializationBarrier?.reject(error)
    this.client = null
    this.clientPromise = null
    this.initializationBarrier = null
    this.initializedClient = null
    this.modelsValue = []
    if (!this.disposed) this.options.onExit(client, error)
  }

  private async loadModels(client: CodexRpcClient) {
    const models: Model[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null = null
    do {
      const response: ModelListResponse = await client.request('model/list', {
        cursor,
        includeHidden: false,
        limit: 100,
      })
      models.push(...response.data)
      const nextCursor = response.nextCursor ?? null
      if (nextCursor && seenCursors.has(nextCursor)) {
        throw new Error(`Codex model/list returned the repeated cursor "${nextCursor}".`)
      }
      if (nextCursor) seenCursors.add(nextCursor)
      cursor = nextCursor
    } while (cursor)
    return models
  }
}

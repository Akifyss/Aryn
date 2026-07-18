import type { ClientRequest } from '../../src/features/agent/codex-protocol/generated/ClientRequest'
import type { ServerNotification } from '../../src/features/agent/codex-protocol/generated/ServerNotification'
import type { ServerRequest } from '../../src/features/agent/codex-protocol/generated/ServerRequest'
import type { InitializeResponse } from '../../src/features/agent/codex-protocol/generated/InitializeResponse'
import type { GetAccountResponse } from '../../src/features/agent/codex-protocol/generated/v2/GetAccountResponse'
import type { ModelListResponse } from '../../src/features/agent/codex-protocol/generated/v2/ModelListResponse'
import type { ThreadArchiveResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadArchiveResponse'
import type { ThreadDeleteResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadDeleteResponse'
import type { ThreadReadResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadReadResponse'
import type { ThreadResumeResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadResumeResponse'
import type { ThreadSetNameResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadSetNameResponse'
import type { ThreadStartResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadStartResponse'
import type { ThreadUnsubscribeResponse } from '../../src/features/agent/codex-protocol/generated/v2/ThreadUnsubscribeResponse'
import type { TurnInterruptResponse } from '../../src/features/agent/codex-protocol/generated/v2/TurnInterruptResponse'
import type { TurnStartResponse } from '../../src/features/agent/codex-protocol/generated/v2/TurnStartResponse'
import type { TurnSteerResponse } from '../../src/features/agent/codex-protocol/generated/v2/TurnSteerResponse'
import { JsonLineProcess, JsonRpcRequestError } from './json-line-process'

type JsonRecord = Record<string, unknown>
type RequestMethod = ClientRequest['method']
type RequestFor<Method extends RequestMethod> = Extract<ClientRequest, { method: Method }>
export type CodexRequestParams<Method extends RequestMethod> = RequestFor<Method>['params']

type CodexResponseMap = {
  initialize: InitializeResponse
  'account/read': GetAccountResponse
  'model/list': ModelListResponse
  'thread/archive': ThreadArchiveResponse
  'thread/delete': ThreadDeleteResponse
  'thread/name/set': ThreadSetNameResponse
  'thread/read': ThreadReadResponse
  'thread/resume': ThreadResumeResponse
  'thread/start': ThreadStartResponse
  'thread/unsubscribe': ThreadUnsubscribeResponse
  'turn/interrupt': TurnInterruptResponse
  'turn/start': TurnStartResponse
  'turn/steer': TurnSteerResponse
}

export type CodexRequestMethod = keyof CodexResponseMap & RequestMethod

type CodexRpcClientOptions = {
  args?: string[]
  onExit: (error: Error) => void
  onNotification: (notification: ServerNotification) => void
  onProtocolWarning: (message: string) => void
  onRequest: (request: ServerRequest) => void
}

const DEFAULT_TIMEOUT_MS = 30_000
const BACKPRESSURE_ERROR_CODE = -32001
const MAX_BACKPRESSURE_RETRIES = 5

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isServerRequest(message: JsonRecord): message is ServerRequest & JsonRecord {
  return 'id' in message && typeof message.method === 'string' && isJsonRecord(message.params)
}

function isServerNotification(message: JsonRecord): message is ServerNotification & JsonRecord {
  return !('id' in message) && typeof message.method === 'string' && isJsonRecord(message.params)
}

function retryDelayMs(attempt: number) {
  const exponential = Math.min(1_000, 50 * 2 ** attempt)
  return exponential + Math.floor(Math.random() * Math.max(1, exponential / 2))
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

export class CodexRpcClient {
  private readonly process: JsonLineProcess

  constructor(private readonly options: CodexRpcClientOptions) {
    this.process = new JsonLineProcess({
      args: options.args ?? ['app-server'],
      command: 'codex',
      onEvent: (message) => this.handleMessage(message),
      onExit: options.onExit,
    })
  }

  start() {
    this.process.start()
  }

  stop() {
    this.process.stop()
  }

  notifyInitialized() {
    this.process.notify({ method: 'initialized', params: {} })
  }

  respond(id: ServerRequest['id'], result: unknown) {
    this.process.notify({ id, result })
  }

  respondError(id: ServerRequest['id'], code: number, message: string, data?: unknown) {
    this.process.notify({
      error: { code, message, ...(data === undefined ? {} : { data }) },
      id,
    })
  }

  async request<Method extends CodexRequestMethod>(
    method: Method,
    params: CodexRequestParams<Method>,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<CodexResponseMap[Method]> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await this.process.request<{ result?: CodexResponseMap[Method] }>({
          method,
          params,
        }, timeoutMs)
        if (response.result === undefined) {
          throw new Error(`Codex App Server request "${method}" returned no result.`)
        }
        return response.result
      } catch (error) {
        if (
          !(error instanceof JsonRpcRequestError)
          || error.code !== BACKPRESSURE_ERROR_CODE
          || attempt >= MAX_BACKPRESSURE_RETRIES
        ) {
          throw error
        }
        await delay(retryDelayMs(attempt))
      }
    }
  }

  private handleMessage(message: JsonRecord) {
    if (message.type === 'protocol_error') {
      this.options.onProtocolWarning(String(message.message ?? 'Unknown Codex protocol warning.'))
      return
    }
    if (isServerRequest(message)) {
      this.options.onRequest(message)
      return
    }
    if (isServerNotification(message)) {
      this.options.onNotification(message)
      return
    }
    this.options.onProtocolWarning('Codex App Server emitted an unknown JSON message.')
  }
}

import path from 'node:path'
import type {
  AgentClientEvent,
  AgentInteractionRequest,
  AgentInteractionResponse,
  AgentInteractionTimelineRecord,
} from '../../../shared/agent-contracts/types'
import { getAgentInteractionResolution } from '../../../shared/agent-contracts/types'
import { isAgentId, type AgentId } from '../../../shared/agent-contracts/definition'
import { AtomicJsonStore } from '../../json-file-store'

const STORE_VERSION = 2
const MAX_RECORDS_PER_SESSION = 200
const RESTART_REASON = 'Application restarted before the request completed.'

type StoredInteractionHistory = {
  recordsBySession: Record<string, AgentInteractionTimelineRecord[]>
  sessionAliasesByPath: Record<string, {
    sessionId: string
    workspacePath: string
  }>
  version: typeof STORE_VERSION
}

function sessionKey(agentId: AgentId, sessionId: string) {
  return `${agentId}\n${sessionId}`
}

function normalizeFileSystemPath(value: string) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function sessionPathKey(agentId: AgentId, sessionPath: string) {
  return `${agentId}\n${normalizeFileSystemPath(sessionPath)}`
}

function isRecord(value: unknown): value is AgentInteractionTimelineRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<AgentInteractionTimelineRecord>
  return Boolean(
    record.request
    && typeof record.request.id === 'string'
    && typeof record.request.sessionId === 'string'
    && isAgentId(record.request.agentId)
    && typeof record.request.workspacePath === 'string'
    && typeof record.requestedAt === 'number'
    && Number.isFinite(record.requestedAt)
    && (record.resolvedAt === undefined || (
      typeof record.resolvedAt === 'number' && Number.isFinite(record.resolvedAt)
    ))
    && ['pending', 'resolved', 'interrupted'].includes(record.status ?? ''),
  )
}

function normalizeStore(value: unknown): StoredInteractionHistory {
  const stored = value && typeof value === 'object'
    ? value as Partial<StoredInteractionHistory>
    : null
  const source = stored?.recordsBySession
  const recordsBySession = source && typeof source === 'object'
    ? Object.fromEntries(Object.entries(source).flatMap(([key, records]) => {
        if (!Array.isArray(records)) return []
        return [[key, records
          .filter(isRecord)
          .filter((record) => sessionKey(record.request.agentId, record.request.sessionId) === key)
          .map(sanitizeRecord)
          .slice(-MAX_RECORDS_PER_SESSION)]]
      }))
    : {}
  const aliasSource = stored?.sessionAliasesByPath
  const sessionAliasesByPath = aliasSource && typeof aliasSource === 'object'
    ? Object.fromEntries(Object.entries(aliasSource).flatMap(([key, value]) => {
        const separator = key.indexOf('\n')
        const agentId = separator > 0 ? key.slice(0, separator) : ''
        const alias = value && typeof value === 'object'
          ? value as { sessionId?: unknown; workspacePath?: unknown }
          : null
        if (
          !isAgentId(agentId)
          || typeof alias?.sessionId !== 'string'
          || !alias.sessionId.trim()
          || typeof alias.workspacePath !== 'string'
          || !alias.workspacePath.trim()
        ) return []
        return [[key, {
          sessionId: alias.sessionId,
          workspacePath: alias.workspacePath,
        }]]
      }))
    : {}
  return { recordsBySession, sessionAliasesByPath, version: STORE_VERSION }
}

function requestKey(request: AgentInteractionRequest) {
  return `${request.agentId}\n${request.sessionId}\n${request.id}`
}

function sanitizeResponse(
  request: AgentInteractionRequest,
  response: AgentInteractionResponse | undefined,
) {
  if (!response) return undefined
  const secretFieldIds = new Set(
    (request.fields ?? []).filter((field) => field.isSecret).map((field) => field.id),
  )
  const answers = response.answers
    ? Object.fromEntries(Object.entries(response.answers).filter(([fieldId]) => !secretFieldIds.has(fieldId)))
    : undefined
  const hasSecretField = request.fields?.some((field) => field.isSecret) === true
  return {
    ...response,
    ...(answers ? { answers } : { answers: undefined }),
    ...(hasSecretField ? { values: undefined } : {}),
  }
}

function sanitizeRecord(record: AgentInteractionTimelineRecord): AgentInteractionTimelineRecord {
  const response = sanitizeResponse(record.request, record.response)
  return {
    ...record,
    ...(response ? { response } : { response: undefined }),
  }
}

export class AgentInteractionHistoryStore {
  private readonly store: AtomicJsonStore<StoredInteractionHistory>
  private initializePromise: Promise<void> | null = null

  constructor(agentDir: string) {
    this.store = new AtomicJsonStore({
      defaultState: () => ({
        recordsBySession: {},
        sessionAliasesByPath: {},
        version: STORE_VERSION,
      }),
      filePath: path.join(agentDir, 'interaction-history.json'),
      normalize: normalizeStore,
    })
  }

  enrichEvent(event: AgentClientEvent, observedAt = Date.now()): AgentClientEvent {
    if (event.type === 'interaction_requested' && event.requestedAt === undefined) {
      return { ...event, requestedAt: observedAt }
    }
    if (event.type === 'interaction_resolved' && event.resolvedAt === undefined) {
      return { ...event, resolvedAt: observedAt }
    }
    return event
  }

  async observeEvent(event: AgentClientEvent) {
    if (event.type !== 'interaction_requested' && event.type !== 'interaction_resolved') return
    await this.initialize()
    await this.store.update((state) => {
      if (event.type === 'interaction_requested') {
        const key = sessionKey(event.agentId, event.request.sessionId)
        const records = state.recordsBySession[key] ?? []
        const identity = requestKey(event.request)
        const existing = records.find((record) => requestKey(record.request) === identity)
        const next: AgentInteractionTimelineRecord = sanitizeRecord({
          request: event.request,
          requestedAt: existing?.requestedAt ?? event.requestedAt ?? Date.now(),
          status: 'pending',
        })
        return {
          ...state,
          recordsBySession: {
            ...state.recordsBySession,
            [key]: [
              ...records.filter((record) => requestKey(record.request) !== identity),
              next,
            ].slice(-MAX_RECORDS_PER_SESSION),
          },
        }
      }

      const key = sessionKey(event.agentId, event.sessionId)
      const records = state.recordsBySession[key] ?? []
      return {
        ...state,
        recordsBySession: {
          ...state.recordsBySession,
          [key]: records.map((record) => {
            if (record.request.id !== event.requestId) return record
            const response = sanitizeResponse(record.request, event.response ?? record.response)
            const resolution = getAgentInteractionResolution(record.request, response, event.resumeRun)
            return sanitizeRecord({
              ...record,
              ...(response ? { response } : {}),
              resolvedAt: record.resolvedAt ?? event.resolvedAt ?? Date.now(),
              ...resolution,
            })
          }),
        },
      }
    })
  }

  async read(agentId: AgentId, sessionId: string) {
    await this.initialize()
    const state = await this.store.read()
    return (state.recordsBySession[sessionKey(agentId, sessionId)] ?? []).map(sanitizeRecord)
  }

  async associateSession(
    agentId: AgentId,
    sessionId: string,
    sessionPath: string,
    workspacePath: string,
  ) {
    if (!path.isAbsolute(sessionPath)) return
    await this.initialize()
    const key = sessionPathKey(agentId, sessionPath)
    await this.store.update((state) => ({
      ...state,
      sessionAliasesByPath: {
        ...state.sessionAliasesByPath,
        [key]: { sessionId, workspacePath },
      },
    }))
  }

  async clearSession(agentId: AgentId, sessionIdOrPath: string) {
    await this.initialize()
    await this.store.update((state) => {
      const recordsBySession = { ...state.recordsBySession }
      const aliasKey = path.isAbsolute(sessionIdOrPath)
        ? sessionPathKey(agentId, sessionIdOrPath)
        : null
      const aliasedSessionId = aliasKey
        ? state.sessionAliasesByPath[aliasKey]?.sessionId
        : undefined
      const sessionIds = new Set(
        [sessionIdOrPath, aliasedSessionId].filter((value): value is string => Boolean(value)),
      )
      for (const sessionId of sessionIds) delete recordsBySession[sessionKey(agentId, sessionId)]
      const sessionAliasesByPath = Object.fromEntries(
        Object.entries(state.sessionAliasesByPath).filter(([key, alias]) => (
          key !== aliasKey && !sessionIds.has(alias.sessionId)
        )),
      )
      return { ...state, recordsBySession, sessionAliasesByPath }
    })
  }

  async clearWorkspace(workspacePath: string) {
    await this.initialize()
    const normalizedWorkspacePath = normalizeFileSystemPath(workspacePath)
    await this.store.update((state) => ({
      ...state,
      recordsBySession: Object.fromEntries(Object.entries(state.recordsBySession).flatMap(([key, records]) => {
        const remaining = records.filter((record) => (
          normalizeFileSystemPath(record.request.workspacePath) !== normalizedWorkspacePath
        ))
        return remaining.length ? [[key, remaining]] : []
      })),
      sessionAliasesByPath: Object.fromEntries(
        Object.entries(state.sessionAliasesByPath).filter(([, alias]) => (
          normalizeFileSystemPath(alias.workspacePath) !== normalizedWorkspacePath
        )),
      ),
    }))
  }

  async drain() {
    await this.store.read()
  }

  private initialize() {
    this.initializePromise ??= this.store.update((state) => ({
      ...state,
      recordsBySession: Object.fromEntries(Object.entries(state.recordsBySession).map(([key, records]) => [
        key,
        records.map((record) => record.status === 'pending'
          ? {
              ...record,
              resolvedAt: record.resolvedAt ?? Date.now(),
              status: 'interrupted' as const,
              statusReason: RESTART_REASON,
            }
          : record),
      ])),
    })).then(() => undefined)
    return this.initializePromise
  }
}

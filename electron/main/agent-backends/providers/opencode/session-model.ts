import type { Provider, Session } from '@opencode-ai/sdk/v2'
import type {
  AgentSessionExecutionState,
  AgentSessionListItem,
  AgentThinkingLevel,
} from '../../../../../src/features/agent/types'

type JsonRecord = Record<string, unknown>

export type OpenCodeSessionRecord = {
  createdAt: string
  cwd: string
  id: string
  modelKey: string | null
  thinkingLevel: AgentThinkingLevel
}

export type OpenCodeSessionIndex = {
  sessions: OpenCodeSessionRecord[]
  version: 1
}

export const DEFAULT_OPEN_CODE_THINKING_LEVEL: AgentThinkingLevel = 'medium'
export const DEFAULT_OPEN_CODE_SESSION_INDEX: OpenCodeSessionIndex = { sessions: [], version: 1 }
export const ARYN_SESSION_METADATA_KEY = 'aryn'

export function unwrapOpenCodeSdkResult<T>(
  result: T | { data?: T, error?: unknown },
  action: string,
): T {
  if (result && typeof result === 'object' && 'error' in result && result.error) {
    const error = result.error
    const message = error && typeof error === 'object' && 'message' in error
      ? String(error.message)
      : JSON.stringify(error)
    throw new Error(`OpenCode ${action} failed: ${message}`)
  }
  if (result && typeof result === 'object' && 'data' in result) {
    const data = result.data
    if (data === undefined) throw new Error(`OpenCode ${action} returned no data.`)
    return data as T
  }
  return result as T
}

export function parseOpenCodeModelKey(modelKey: string | null | undefined) {
  const normalizedKey = modelKey?.trim() ?? ''
  const separatorIndex = normalizedKey.indexOf('/')
  if (separatorIndex <= 0 || separatorIndex === normalizedKey.length - 1) return null
  return {
    modelID: normalizedKey.slice(separatorIndex + 1),
    providerID: normalizedKey.slice(0, separatorIndex),
  }
}

export function mapOpenCodeThinkingVariant(level: AgentThinkingLevel) {
  return level === 'off' ? undefined : level
}

export function getOpenCodeThinkingLevels(provider: Provider, modelID: string): AgentThinkingLevel[] {
  const model = provider.models[modelID]
  if (!model?.capabilities.reasoning) return ['off']
  const variantNames = Object.keys(model.variants ?? {})
  const knownLevels = (['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as AgentThinkingLevel[])
    .filter((level) => variantNames.some((variant) => variant.toLowerCase() === level))
  return knownLevels.length > 0 ? knownLevels : ['low', 'medium', 'high']
}

export function formatOpenCodeError(error: unknown) {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object') {
    if ('data' in error && error.data && typeof error.data === 'object' && 'message' in error.data) {
      return String(error.data.message)
    }
    if ('message' in error) return String(error.message)
  }
  return String(error)
}

export function normalizeNullableText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function normalizeOpenCodeExecutionState(value: unknown): AgentSessionExecutionState {
  const status = value && typeof value === 'object' ? value as JsonRecord : {}
  if (status.type === 'busy') return { type: 'busy' }
  if (status.type === 'retry') {
    const actionRecord = status.action && typeof status.action === 'object'
      ? status.action as JsonRecord
      : null
    const action = actionRecord
      && typeof actionRecord.label === 'string'
      && typeof actionRecord.message === 'string'
      && typeof actionRecord.provider === 'string'
      && typeof actionRecord.reason === 'string'
      && typeof actionRecord.title === 'string'
      ? {
          label: actionRecord.label,
          ...(typeof actionRecord.link === 'string' ? { link: actionRecord.link } : {}),
          message: actionRecord.message,
          provider: actionRecord.provider,
          reason: actionRecord.reason,
          title: actionRecord.title,
        }
      : undefined
    return {
      type: 'retry',
      ...(action ? { action } : {}),
      attempt: typeof status.attempt === 'number' ? status.attempt : 0,
      message: typeof status.message === 'string' ? status.message : 'OpenCode 正在重试',
      next: typeof status.next === 'number' ? status.next : Date.now(),
    }
  }
  return { type: 'idle' }
}

export function normalizeOpenCodeSessionIndex(value: unknown): OpenCodeSessionIndex {
  const candidate = value && typeof value === 'object' ? value as JsonRecord : {}
  const sessions = Array.isArray(candidate.sessions)
    ? candidate.sessions.flatMap((entry): OpenCodeSessionRecord[] => {
        const record = entry && typeof entry === 'object' ? entry as JsonRecord : {}
        const id = normalizeNullableText(record.id)
        const cwd = normalizeNullableText(record.cwd)
        if (!id || !cwd) return []
        return [{
          createdAt: normalizeNullableText(record.createdAt) ?? new Date(0).toISOString(),
          cwd,
          id,
          modelKey: normalizeNullableText(record.modelKey) ?? null,
          thinkingLevel: typeof record.thinkingLevel === 'string'
            && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(record.thinkingLevel)
            ? record.thinkingLevel as AgentThinkingLevel
            : DEFAULT_OPEN_CODE_THINKING_LEVEL,
        }]
      })
    : []
  return { sessions, version: 1 }
}

export function getSessionConfigurationFromMetadata(session: Session) {
  const metadata = session.metadata?.[ARYN_SESSION_METADATA_KEY]
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as JsonRecord
  const modelKey = normalizeNullableText(record.modelKey) ?? null
  const thinkingLevel = typeof record.thinkingLevel === 'string'
    && ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(record.thinkingLevel)
    ? record.thinkingLevel as AgentThinkingLevel
    : null
  if (!modelKey && !thinkingLevel) return null
  return { modelKey, thinkingLevel }
}

export function withSessionConfigurationMetadata(
  session: Session,
  modelKey: string | null,
  thinkingLevel: AgentThinkingLevel,
) {
  return {
    ...(session.metadata ?? {}),
    [ARYN_SESSION_METADATA_KEY]: { modelKey, thinkingLevel },
  }
}

export function createOpenCodeSessionListItem(session: Session): AgentSessionListItem {
  const title = session.title?.trim() || null
  return {
    createdAt: new Date(session.time.created).toISOString(),
    id: session.id,
    messageCount: 0,
    modifiedAt: new Date(session.time.updated).toISOString(),
    name: title,
    path: session.id,
    preview: title ?? 'OpenCode session',
  }
}

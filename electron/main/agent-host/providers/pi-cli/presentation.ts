import path from 'node:path'
import {
  SessionManager,
  type SessionEntry,
} from '@earendil-works/pi-coding-agent'
import type {
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentWorkspaceState,
  PiWebAgentMessage,
} from '../../../../shared/agent-contracts/types'
import {
  normalizePiThinkingLevel as normalizeThinkingLevel,
  PI_CLI_THINKING_LEVELS as THINKING_LEVELS,
  projectPiFileAnnotations,
  readPiResponseData as readResponseData,
  type JsonRecord,
  type PiCliSessionRecord,
} from './session-model'
import type { PiCliRuntime } from './runtime'
import { serializePiWebSessionEntries } from '../../sessions/pi-session-presentation'
import type { PiSessionFileSnapshot } from '../../sessions/pi-session-file-reader'

function piMessageIdentity(message: PiWebAgentMessage) {
  const toolCallId = typeof message.toolCallId === 'string' ? message.toolCallId : ''
  return `${message.role}\u0000${String(message.timestamp ?? '')}\u0000${toolCallId}`
}

function attachPiMessageCompletionTimestamps(
  messages: PiWebAgentMessage[],
  entries: SessionEntry[],
) {
  const completionQueues = new Map<string, number[]>()
  for (const entry of entries) {
    if (entry.type !== 'message') continue
    const message = entry.message as unknown as PiWebAgentMessage
    const completedAt = Date.parse(entry.timestamp)
    if (!Number.isFinite(completedAt)) continue
    const key = piMessageIdentity(message)
    const queue = completionQueues.get(key)
    if (queue) queue.push(completedAt)
    else completionQueues.set(key, [completedAt])
  }

  return messages.map((message) => {
    const completions = completionQueues.get(piMessageIdentity(message))
    const completedAt = completions?.shift()
    return completedAt === undefined ? message : { ...message, completedAt }
  })
}

function readOfficialPiBranch(runtime: PiCliRuntime) {
  const sessionPath = runtime.record.sessionPath
  if (!sessionPath) return []
  try {
    return SessionManager.open(
      sessionPath,
      path.dirname(sessionPath),
      runtime.record.cwd,
    ).getBranch()
  } catch {
    // The RPC snapshot remains usable if PI is still flushing its session file.
    return []
  }
}

export async function serializePiCliSession(runtime: PiCliRuntime): Promise<AgentSessionSnapshot> {
  const response = await runtime.process.request({ type: 'get_messages' })
  const data = readResponseData(response)
  const rpcMessages = Array.isArray(data.messages)
    ? data.messages.filter((message): message is PiWebAgentMessage => (
        Boolean(message)
        && typeof message === 'object'
        && typeof (message as { role?: unknown }).role === 'string'
      ))
    : []
  const nativeMessages = attachPiMessageCompletionTimestamps(
    rpcMessages,
    readOfficialPiBranch(runtime),
  )
  return {
    annotations: projectPiFileAnnotations(data.messages),
    messages: [],
    native: {
      agentId: 'pi',
      entryIds: nativeMessages.map((message) => typeof message.id === 'string' ? message.id : ''),
      isStreaming: runtime.isStreaming,
      messages: nativeMessages,
      modelNames: Object.fromEntries(runtime.models.flatMap((model) => {
        if (!model.id || !model.provider) return []
        const label = model.name?.trim() || model.id
        return [
          [`${model.provider}:${model.id}`, label],
          [model.id, label],
        ]
      })),
      sessionId: runtime.record.id,
    },
    name: runtime.record.name,
    sessionId: runtime.record.id,
    sessionPath: runtime.record.id,
    workspacePath: runtime.record.cwd,
  }
}

export function serializePiCliSessionFile(
  record: PiCliSessionRecord,
  sessionFile: PiSessionFileSnapshot,
): AgentSessionSnapshot {
  const nativeMessages = serializePiWebSessionEntries(sessionFile.branchEntries)
  return {
    annotations: projectPiFileAnnotations(nativeMessages.messages),
    messages: [],
    native: {
      agentId: 'pi',
      entryIds: nativeMessages.entryIds,
      isStreaming: false,
      messages: nativeMessages.messages,
      modelNames: {},
      sessionId: record.id,
    },
    name: record.name ?? sessionFile.name,
    sessionId: record.id,
    sessionPath: record.id,
    workspacePath: record.cwd,
  }
}

export function serializePiCliRuntime(
  cwd: string | null,
  runtime: PiCliRuntime,
): AgentWorkspaceState['runtime'] {
  const models = runtime.models.filter((model) => model?.id && model?.provider)
  const availableModels = models.map((model) => `${model.provider}/${model.id}`)
  const levelsByModel: Record<string, AgentThinkingLevel[]> = Object.fromEntries(models.map((model) => {
    const mapped: AgentThinkingLevel[] = model.reasoning === false
      ? ['off']
      : model.thinkingLevelMap
        ? THINKING_LEVELS.filter((level) => (
            level === 'off' || Object.prototype.hasOwnProperty.call(model.thinkingLevelMap, level)
          ))
        : THINKING_LEVELS
    return [`${model.provider}/${model.id}`, mapped]
  }))
  const stateModel = runtime.state.model && typeof runtime.state.model === 'object'
    ? runtime.state.model as JsonRecord
    : null
  const selectedModel = stateModel?.provider && stateModel.id
    ? `${stateModel.provider}/${stateModel.id}`
    : runtime.record.modelKey
  const selectedLevels: AgentThinkingLevel[] = selectedModel
    ? levelsByModel[selectedModel] ?? ['off']
    : ['off']
  const preferredModelByProvider: Record<string, string> = {}
  const steeringMessages = Array.isArray(runtime.state.steering)
    ? runtime.state.steering.map(String)
    : []
  const followUpMessages = Array.isArray(runtime.state.followUp)
    ? runtime.state.followUp.map(String)
    : []
  for (const model of models) preferredModelByProvider[model.provider] ??= model.id

  return {
    agentId: 'pi',
    auth: {},
    availableModelInputs: Object.fromEntries(models.map((model) => [
      `${model.provider}/${model.id}`,
      model.input?.includes('image') ? ['text', 'image'] : ['text'],
    ])),
    availableModels,
    availableThinkingLevels: selectedLevels,
    availableThinkingLevelsByModel: levelsByModel,
    compactionReason: runtime.state.compactionReason === 'manual'
      || runtime.state.compactionReason === 'overflow'
      || runtime.state.compactionReason === 'threshold'
      ? runtime.state.compactionReason
      : null,
    defaultModel: selectedModel ?? availableModels[0] ?? null,
    defaultThinkingLevel: normalizeThinkingLevel(runtime.state.thinkingLevel ?? runtime.record.thinkingLevel),
    followUpMessageCount: followUpMessages.length,
    followUpMessages,
    followUpMode: runtime.state.followUpMode === 'all' ? 'all' : 'one-at-a-time',
    hasConfiguredModels: availableModels.length > 0,
    isCompacting: runtime.state.isCompacting === true,
    isStreaming: runtime.isStreaming,
    pendingMessageCount: typeof runtime.state.pendingMessageCount === 'number'
      ? runtime.state.pendingMessageCount
      : 0,
    preferredModelByProvider,
    retryAttempt: typeof runtime.state.retryAttempt === 'number' ? runtime.state.retryAttempt : 0,
    retryMaxAttempts: typeof runtime.state.retryMaxAttempts === 'number'
      ? runtime.state.retryMaxAttempts
      : null,
    selectedModel,
    setupHint: availableModels.length > 0
      ? null
      : 'PI CLI 当前没有可用模型，请先通过 PI 配置 Provider。',
    supportedRunningPromptBehaviors: ['steer', 'followUp'],
    supportsQueuedMessageEditing: false,
    steeringMessageCount: steeringMessages.length,
    steeringMessages,
    steeringMode: runtime.state.steeringMode === 'all' ? 'all' : 'one-at-a-time',
    supportsThinking: selectedLevels.some((level) => level !== 'off'),
    thinkingLevel: normalizeThinkingLevel(runtime.state.thinkingLevel ?? runtime.record.thinkingLevel),
    workspacePath: cwd,
  }
}

export function createPiCliSessionListItem(record: PiCliSessionRecord) {
  return {
    createdAt: record.createdAt,
    id: record.id,
    messageCount: record.messageCount ?? 0,
    modifiedAt: record.updatedAt,
    name: record.name,
    path: record.id,
    preview: record.name ?? record.preview ?? 'PI CLI session',
  }
}

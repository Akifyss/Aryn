import type { Model } from '../../../../shared/agent-contracts/providers/codex/protocol/generated/v2/Model'
import type {
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentWorkspaceState,
  CodexNativeSessionSnapshot,
} from '../../../../shared/agent-contracts/types'
import {
  countCodexThreadMessages as countThreadMessages,
  getCodexFileChanges as fileChangesFromThread,
  getCodexModelThinkingLevels as codexModelThinkingLevels,
  normalizeCodexReasoningEffort as reasoningEffort,
  type CodexThreadRecord,
} from './session-model'
import type { CodexBinding } from './runtime'

export function getDefaultCodexModel(models: Model[]) {
  return models.find((model) => model.isDefault) ?? models[0] ?? null
}

export function requireCodexModel(models: Model[], modelKey: string) {
  const normalized = modelKey.trim()
  const match = models.find((model) => `openai/${model.model}` === normalized)
  if (!match) throw new Error(`Codex model "${modelKey}" is not available.`)
  return match
}

export function serializeCodexRuntime(
  cwd: string | null,
  binding: CodexBinding | null,
  allModels: Model[],
  getNative: (threadId: string) => CodexNativeSessionSnapshot | null,
): AgentWorkspaceState['runtime'] {
  const models = allModels.filter((model) => !model.hidden)
  const availableModels = models.map((model) => `openai/${model.model}`)
  const levelsByModel: Record<string, AgentThinkingLevel[]> = Object.fromEntries(models.map((model) => [
    `openai/${model.model}`,
    codexModelThinkingLevels(model),
  ]))
  const defaultModel = getDefaultCodexModel(models)
  const defaultModelKey = defaultModel ? `openai/${defaultModel.model}` : null
  const selectedModel = binding?.record.model ? `openai/${binding.record.model}` : defaultModelKey
  const levels: AgentThinkingLevel[] = selectedModel
    ? levelsByModel[selectedModel] ?? ['low', 'medium', 'high']
    : ['low', 'medium', 'high']
  const native = binding ? getNative(binding.record.id) : null
  const executionState = native?.status
    ?? (binding?.isStreaming ? { type: 'busy' as const } : { type: 'idle' as const })

  return {
    agentId: 'codex',
    auth: {},
    availableModelInputs: Object.fromEntries(models.map((model) => [
      `openai/${model.model}`,
      model.inputModalities.includes('image') ? ['text', 'image'] : ['text'],
    ])),
    availableModels,
    availableThinkingLevels: levels,
    availableThinkingLevelsByModel: levelsByModel,
    compactionReason: null,
    defaultModel: defaultModelKey,
    defaultThinkingLevel: reasoningEffort(defaultModel?.defaultReasoningEffort),
    executionState,
    followUpMessageCount: binding?.queuedPrompts.length ?? 0,
    followUpMessages: binding?.queuedPrompts.map((queued) => queued.prompt) ?? [],
    followUpMode: 'one-at-a-time',
    hasConfiguredModels: availableModels.length > 0,
    isCompacting: false,
    isStreaming: binding?.isStreaming ?? false,
    pendingMessageCount: binding?.queuedPrompts.length ?? 0,
    preferredModelByProvider: defaultModelKey ? { openai: defaultModelKey } : {},
    retryAttempt: executionState.type === 'retry' ? executionState.attempt : 0,
    retryMaxAttempts: null,
    selectedModel,
    setupHint: availableModels.length > 0
      ? null
      : 'Codex 当前没有可用模型，请先通过 Codex CLI 完成登录。',
    supportedRunningPromptBehaviors: ['steer', 'followUp'],
    supportsQueuedMessageEditing: false,
    supportsThinking: levels.some((level) => level !== 'off'),
    steeringMessageCount: 0,
    steeringMessages: [],
    steeringMode: 'one-at-a-time',
    thinkingLevel: binding?.record.reasoningEffort
      ?? reasoningEffort(defaultModel?.defaultReasoningEffort),
    workspacePath: cwd,
  }
}

export function createCodexSessionSnapshot(
  record: CodexThreadRecord,
  native: CodexNativeSessionSnapshot,
): AgentSessionSnapshot {
  return {
    annotations: { fileChangesByEntryId: fileChangesFromThread(native.thread) },
    messages: [],
    name: record.name ?? native.thread.name,
    native,
    sessionId: record.id,
    sessionPath: record.id,
    workspacePath: record.cwd,
  }
}

export function createCodexSessionListItem(
  record: CodexThreadRecord,
  native: CodexNativeSessionSnapshot | null,
) {
  return {
    createdAt: record.createdAt,
    id: record.id,
    messageCount: native ? countThreadMessages(native.thread) : 0,
    modifiedAt: record.updatedAt,
    name: record.name ?? native?.thread.name ?? null,
    path: record.id,
    preview: record.name ?? native?.thread.preview ?? record.preview ?? 'Codex thread',
  }
}

import type { OpencodeClient, Provider } from '@opencode-ai/sdk/v2'
import type {
  AgentSessionSnapshot,
  AgentThinkingLevel,
  AgentWorkspaceState,
} from '../../../../shared/agent-contracts/types'
import type { OpenCodeSessionMessageReducer } from './session-reducer'
import {
  DEFAULT_OPEN_CODE_THINKING_LEVEL as DEFAULT_THINKING_LEVEL,
  getOpenCodeThinkingLevels as supportedThinkingLevels,
  parseOpenCodeModelKey as parseModelKey,
  unwrapOpenCodeSdkResult as unwrapSdkResult,
} from './session-model'
import type { OpenCodeSessionBinding, OpenCodeSessionProjection } from './runtime'

export function createOpenCodeSessionSnapshot(
  binding: OpenCodeSessionBinding,
  reducer: OpenCodeSessionMessageReducer,
  projection: OpenCodeSessionProjection,
): AgentSessionSnapshot {
  const { cwd, sessionId } = binding
  const records = reducer.records(sessionId)
  const lastAssistantMessage = [...records]
    .reverse()
    .find((record) => record.info.role === 'assistant')
    ?.info ?? null
  binding.lastAssistantMessageId = lastAssistantMessage?.id ?? null
  return {
    annotations: { fileChangesByEntryId: {} },
    messages: [],
    name: binding.title,
    native: {
      agentId: 'opencode',
      diffs: projection.diffs.get(sessionId) ?? [],
      messages: records,
      parentSessionId: binding.parentSessionId,
      status: binding.executionState,
    },
    sessionId,
    sessionPath: sessionId,
    workspacePath: cwd,
  }
}

export async function buildOpenCodeRuntime(
  client: OpencodeClient,
  cwd: string | null,
  binding: OpenCodeSessionBinding | null,
): Promise<AgentWorkspaceState['runtime']> {
  const response = await client.config.providers(
    cwd ? { directory: cwd } : undefined,
    { throwOnError: true },
  )
  const providerConfig = unwrapSdkResult<{
    default: Record<string, string>
    providers: Provider[]
  }>(response, 'list providers')
  const models = providerConfig.providers.flatMap((provider) => (
    Object.values(provider.models).map((model) => ({
      key: `${provider.id}/${model.id}`,
      model,
      provider,
    }))
  ))
  const defaultModel = Object.entries(providerConfig.default)
    .map(([providerID, modelID]) => `${providerID}/${modelID}`)
    .find((key) => models.some((model) => model.key === key))
    ?? models[0]?.key
    ?? null
  const selectedModel = binding?.selectedModel ?? defaultModel
  const selected = parseModelKey(selectedModel)
  const selectedProvider = selected
    ? providerConfig.providers.find((provider) => provider.id === selected.providerID) ?? null
    : null
  const levels = selectedProvider && selected
    ? supportedThinkingLevels(selectedProvider, selected.modelID)
    : ['off'] as AgentThinkingLevel[]
  const availableThinkingLevelsByModel = Object.fromEntries(models.map(({ key, model, provider }) => (
    [key, supportedThinkingLevels(provider, model.id)]
  )))

  return {
    agentId: 'opencode',
    auth: {},
    availableModelInputs: Object.fromEntries(models.map(({ key, model }) => (
      [key, model.capabilities.input.image ? ['text', 'image'] : ['text']]
    ))),
    availableModels: models.map((model) => model.key),
    availableThinkingLevels: levels,
    availableThinkingLevelsByModel,
    compactionReason: null,
    defaultModel,
    defaultThinkingLevel: DEFAULT_THINKING_LEVEL,
    executionState: binding?.executionState ?? { type: 'idle' },
    followUpMessageCount: 0,
    followUpMessages: [],
    followUpMode: 'all',
    hasConfiguredModels: models.length > 0,
    isCompacting: false,
    isStreaming: binding?.isStreaming ?? false,
    pendingMessageCount: 0,
    preferredModelByProvider: providerConfig.default,
    retryAttempt: 0,
    retryMaxAttempts: null,
    selectedModel,
    setupHint: models.length > 0
      ? null
      : 'OpenCode 当前没有可用模型，请先在 OpenCode 中配置 Provider。',
    supportedRunningPromptBehaviors: ['steer'],
    supportsQueuedMessageEditing: false,
    steeringMessageCount: 0,
    steeringMessages: [],
    steeringMode: 'all',
    supportsThinking: levels.some((level) => level !== 'off'),
    thinkingLevel: binding?.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
    workspacePath: cwd,
  }
}

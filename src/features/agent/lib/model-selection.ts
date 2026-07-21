import { getAgentProviderOrder } from '@/features/agent/provider-auth'
import type { AgentThinkingLevel, AgentWorkspaceState } from '@/features/agent/types'

export type AgentModelDraft = {
  modelId: string
  provider: string
  thinkingLevel: AgentThinkingLevel
}

const THINKING_LEVEL_LABELS: Record<AgentThinkingLevel, string> = {
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
}

const THINKING_LEVEL_ORDER: AgentThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]

function formatModelLabel(modelKey: string | null) {
  if (!modelKey) {
    return ''
  }

  const parts = modelKey.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelKey
}

export function parseModelSelection(modelKey: string | null): { modelId: string, provider: string } {
  if (!modelKey) {
    return {
      modelId: '',
      provider: '',
    }
  }

  const [providerCandidate, ...modelIdParts] = modelKey.split('/')

  return {
    modelId: modelIdParts.length > 0 ? modelIdParts.join('/') : formatModelLabel(modelKey),
    provider: modelIdParts.length > 0 ? providerCandidate : '',
  }
}

export function createAgentModelDraft(
  modelKey: string | null,
  thinkingLevel: AgentThinkingLevel,
): AgentModelDraft {
  return {
    ...parseModelSelection(modelKey),
    thinkingLevel,
  }
}

export function getRuntimeSelectedModelDraft(runtime: AgentWorkspaceState['runtime']) {
  return createAgentModelDraft(runtime.selectedModel, runtime.thinkingLevel)
}

export function getRuntimeDefaultModelDraft(runtime: AgentWorkspaceState['runtime']) {
  return createAgentModelDraft(runtime.defaultModel ?? runtime.selectedModel, runtime.defaultThinkingLevel)
}

export function getAgentModelKey(provider: string, modelId: string) {
  return `${provider}/${modelId}`
}

export function getAgentModelDraftKey(draft: AgentModelDraft) {
  return draft.provider && draft.modelId ? getAgentModelKey(draft.provider, draft.modelId) : null
}

export function normalizeAgentModelDraft(
  draft: AgentModelDraft,
  runtime: AgentWorkspaceState['runtime'],
  fallbackDraft: AgentModelDraft,
) {
  const configuredProviders = Array.from(new Set(
    runtime.availableModels
      .map((model) => model.split('/')[0])
      .filter(Boolean),
  )).sort((left, right) => {
    const orderDelta = getAgentProviderOrder(left) - getAgentProviderOrder(right)
    return orderDelta !== 0 ? orderDelta : left.localeCompare(right)
  })
  const fallbackProvider = fallbackDraft.provider || configuredProviders[0] || draft.provider
  const provider = configuredProviders.includes(draft.provider) ? draft.provider : fallbackProvider
  const modelIds = Array.from(new Set(
    runtime.availableModels
      .filter((model) => model.startsWith(`${provider}/`))
      .map((model) => model.split('/').slice(1).join('/')),
  ))
  const preferredModelKey = runtime.preferredModelByProvider[provider]
  const preferredModel = parseModelSelection(preferredModelKey ?? null)
  const fallbackModelId = fallbackDraft.provider === provider && fallbackDraft.modelId
    ? fallbackDraft.modelId
    : preferredModel.provider === provider
      ? preferredModel.modelId
      : modelIds[0] ?? draft.modelId
  const modelId = modelIds.includes(draft.modelId) ? draft.modelId : fallbackModelId
  const modelKey = provider && modelId ? getAgentModelKey(provider, modelId) : null
  const availableThinkingLevels = modelKey
    ? runtime.availableThinkingLevelsByModel[modelKey] ?? runtime.availableThinkingLevels
    : runtime.availableThinkingLevels

  return {
    modelId,
    provider,
    thinkingLevel: clampAgentThinkingLevel(draft.thinkingLevel, availableThinkingLevels),
  }
}

export function formatThinkingLevelLabel(level: AgentThinkingLevel) {
  return THINKING_LEVEL_LABELS[level] ?? level
}

export function clampAgentThinkingLevel(
  level: AgentThinkingLevel,
  availableLevels: AgentThinkingLevel[],
) {
  if (availableLevels.includes(level)) {
    return level
  }

  if (availableLevels.length === 0) {
    return level
  }

  const requestedIndex = THINKING_LEVEL_ORDER.indexOf(level)

  if (requestedIndex === -1) {
    return availableLevels[0]
  }

  for (let index = requestedIndex; index < THINKING_LEVEL_ORDER.length; index += 1) {
    const candidate = THINKING_LEVEL_ORDER[index]

    if (availableLevels.includes(candidate)) {
      return candidate
    }
  }

  for (let index = requestedIndex - 1; index >= 0; index -= 1) {
    const candidate = THINKING_LEVEL_ORDER[index]

    if (availableLevels.includes(candidate)) {
      return candidate
    }
  }

  return availableLevels[0]
}

export function hasConfigurableAgentThinkingLevel(availableLevels: AgentThinkingLevel[]) {
  return availableLevels.some((level) => level !== 'off')
}

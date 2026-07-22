import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  clampAgentThinkingLevel,
  formatThinkingLevelLabel,
  getAgentModelKey,
  getAgentProviderModelIds,
  getConfiguredAgentProviders,
  getRuntimeDefaultModelDraft,
  parseModelSelection,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import type { AgentThinkingLevel, AgentWorkspaceState } from '@/features/agent/types'

const INITIAL_MODEL_SELECTION = parseModelSelection(null)

export function useAgentModelDraftState(initialRuntime: AgentWorkspaceState['runtime']) {
  const [modelInputValue, setModelInputValue] = useState(INITIAL_MODEL_SELECTION.modelId)
  const [selectedProviderValue, setSelectedProviderValue] = useState(INITIAL_MODEL_SELECTION.provider)
  const [selectedThinkingLevel, setSelectedThinkingLevel] = useState<AgentThinkingLevel>(
    initialRuntime.defaultThinkingLevel,
  )
  const [modelDrafts, setModelDrafts] = useState<Record<string, string>>({
    [INITIAL_MODEL_SELECTION.provider]: INITIAL_MODEL_SELECTION.modelId,
  })
  const newSessionModelDraftRef = useRef<AgentModelDraft>(getRuntimeDefaultModelDraft(initialRuntime))

  function syncModelDraft(draft: AgentModelDraft) {
    setSelectedProviderValue(draft.provider)
    setModelInputValue(draft.modelId)
    setSelectedThinkingLevel(draft.thinkingLevel)
    setModelDrafts((currentValue) => ({
      ...currentValue,
      [draft.provider]: draft.modelId,
    }))
  }

  function syncNewSessionModelDraft(draft: AgentModelDraft) {
    newSessionModelDraftRef.current = draft
  }

  return {
    modelDrafts,
    modelInputValue,
    newSessionModelDraftRef,
    selectedProviderValue,
    selectedThinkingLevel,
    setModelDrafts,
    setModelInputValue,
    setSelectedProviderValue,
    syncModelDraft,
    syncNewSessionModelDraft,
  }
}

type UseAgentModelSelectionStateOptions = {
  modelInputValue: string
  runtime: AgentWorkspaceState['runtime']
  selectedProviderValue: string
  selectedThinkingLevel: AgentThinkingLevel
}

export function useAgentModelSelectionState({
  modelInputValue,
  runtime,
  selectedProviderValue,
  selectedThinkingLevel,
}: UseAgentModelSelectionStateOptions) {
  const configuredProviders = useMemo(
    () => getConfiguredAgentProviders(runtime.availableModels),
    [runtime.availableModels],
  )
  const hasConfiguredProviders = configuredProviders.length > 0
  const resolvedSelectedProviderValue = configuredProviders.includes(selectedProviderValue)
    ? selectedProviderValue
    : configuredProviders[0] ?? selectedProviderValue
  const providerModelIds = useMemo(
    () => getAgentProviderModelIds(runtime.availableModels, resolvedSelectedProviderValue),
    [resolvedSelectedProviderValue, runtime.availableModels],
  )
  const trimmedModelInputValue = modelInputValue.trim()
  const composerModelKey = trimmedModelInputValue
    ? getAgentModelKey(resolvedSelectedProviderValue, trimmedModelInputValue)
    : null
  const hasAvailableComposerModel = composerModelKey
    ? runtime.availableModels.includes(composerModelKey)
    : false
  const composerThinkingLevels = composerModelKey && hasAvailableComposerModel
    ? (runtime.availableThinkingLevelsByModel[composerModelKey] ?? runtime.availableThinkingLevels)
    : []
  const thinkingLevel = clampAgentThinkingLevel(selectedThinkingLevel, composerThinkingLevels)
  const selectedModelInputs = composerModelKey && hasAvailableComposerModel
    ? runtime.availableModelInputs[composerModelKey] ?? ['text']
    : []

  return {
    configuredProviders,
    hasConfiguredProviders,
    providerModelIds,
    resolvedSelectedProviderValue,
    selectedModelSupportsImages: selectedModelInputs.includes('image'),
    thinkingLevel,
    thinkingLevelLabel: formatThinkingLevelLabel(thinkingLevel),
  }
}

type UseAgentModelSelectionSyncOptions = {
  closeModelMenu: () => void
  hasConfiguredProviders: boolean
  isModelMenuOpen: boolean
  modelDrafts: Record<string, string>
  preferredModelByProvider: AgentWorkspaceState['runtime']['preferredModelByProvider']
  providerModelIds: string[]
  resolvedSelectedProviderValue: string
  selectedProviderValue: string
  setModelInputValue: Dispatch<SetStateAction<string>>
  setSelectedProviderValue: Dispatch<SetStateAction<string>>
}

export function useAgentModelSelectionSync({
  closeModelMenu,
  hasConfiguredProviders,
  isModelMenuOpen,
  modelDrafts,
  preferredModelByProvider,
  providerModelIds,
  resolvedSelectedProviderValue,
  selectedProviderValue,
  setModelInputValue,
  setSelectedProviderValue,
}: UseAgentModelSelectionSyncOptions) {
  useEffect(() => {
    if (!hasConfiguredProviders && isModelMenuOpen) {
      closeModelMenu()
    }

    if (!hasConfiguredProviders || resolvedSelectedProviderValue === selectedProviderValue) {
      return
    }

    const preferredModelSelection = parseModelSelection(
      preferredModelByProvider[resolvedSelectedProviderValue] ?? null,
    )
    const preferredModelId = preferredModelSelection.provider === resolvedSelectedProviderValue
      ? preferredModelSelection.modelId
      : null

    setSelectedProviderValue(resolvedSelectedProviderValue)
    setModelInputValue(
      modelDrafts[resolvedSelectedProviderValue]
        ?? preferredModelId
        ?? providerModelIds[0]
        ?? '',
    )
  }, [
    closeModelMenu,
    hasConfiguredProviders,
    isModelMenuOpen,
    modelDrafts,
    preferredModelByProvider,
    providerModelIds,
    resolvedSelectedProviderValue,
    selectedProviderValue,
    setModelInputValue,
    setSelectedProviderValue,
  ])
}

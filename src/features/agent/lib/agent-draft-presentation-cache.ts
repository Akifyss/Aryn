import { AGENT_IDS, type AgentId } from '@/features/agent/agent-definition'
import {
  getRuntimeDefaultModelDraft,
  type AgentModelDraft,
} from '@/features/agent/lib/model-selection'
import type {
  AgentRunningPromptBehavior,
  AgentThinkingLevel,
  AgentWorkspaceState,
} from '@/features/agent/types'

const PERSISTED_CACHE_PREFIX = 'aryn:agent-draft-presentations:v2:'
const LEGACY_CACHE_PREFIX = 'aryn:agent-draft-presentations:v1:'
const draftPresentationStates = new Map<AgentId, AgentWorkspaceState>()

function rendererCacheStorage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function persistedCacheKey(agentId: AgentId) {
  return `${PERSISTED_CACHE_PREFIX}${agentId}`
}

function legacyCacheKey(agentId: AgentId) {
  return `${LEGACY_CACHE_PREFIX}${agentId}`
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === 'string')
}

function isModelInputRecord(
  value: unknown,
): value is AgentWorkspaceState['runtime']['availableModelInputs'] {
  return isRecord(value) && Object.values(value).every((inputs) => (
    Array.isArray(inputs)
    && inputs.every((input) => input === 'text' || input === 'image')
  ))
}

function isThinkingLevel(value: unknown): value is AgentThinkingLevel {
  return value === 'off'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh'
}

function isThinkingLevelArray(value: unknown): value is AgentThinkingLevel[] {
  return Array.isArray(value) && value.every(isThinkingLevel)
}

function isThinkingLevelsByModel(
  value: unknown,
): value is AgentWorkspaceState['runtime']['availableThinkingLevelsByModel'] {
  return isRecord(value) && Object.values(value).every(isThinkingLevelArray)
}

function isRunningPromptBehavior(value: unknown): value is AgentRunningPromptBehavior {
  return value === 'steer' || value === 'followUp'
}

function isRunningPromptBehaviorArray(value: unknown): value is AgentRunningPromptBehavior[] {
  return Array.isArray(value) && value.every(isRunningPromptBehavior)
}

function isPersistedAgentDraftPresentationState(
  value: unknown,
  agentId: AgentId,
): value is AgentWorkspaceState {
  if (
    !isRecord(value)
    || value.activeSession !== null
    || !Array.isArray(value.sessions)
    || value.sessions.length > 0
  ) {
    return false
  }

  const runtime = value.runtime
  return isRecord(runtime)
    && runtime.agentId === agentId
    && isRecord(runtime.auth)
    && Object.keys(runtime.auth).length === 0
    && runtime.workspacePath === null
    && typeof runtime.hasConfiguredModels === 'boolean'
    && isStringArray(runtime.availableModels)
    && runtime.hasConfiguredModels === (runtime.availableModels.length > 0)
    && isModelInputRecord(runtime.availableModelInputs)
    && isThinkingLevelArray(runtime.availableThinkingLevels)
    && isThinkingLevelsByModel(runtime.availableThinkingLevelsByModel)
    && runtime.compactionReason === null
    && runtime.followUpMessageCount === 0
    && Array.isArray(runtime.followUpMessages)
    && runtime.followUpMessages.length === 0
    && (runtime.followUpMode === 'all' || runtime.followUpMode === 'one-at-a-time')
    && runtime.isCompacting === false
    && isNullableString(runtime.defaultModel)
    && isThinkingLevel(runtime.defaultThinkingLevel)
    && runtime.executionState === undefined
    && isStringRecord(runtime.preferredModelByProvider)
    && isNullableString(runtime.selectedModel)
    && runtime.isStreaming === false
    && runtime.pendingMessageCount === 0
    && runtime.retryAttempt === 0
    && runtime.retryMaxAttempts === null
    && isNullableString(runtime.setupHint)
    && isRunningPromptBehaviorArray(runtime.supportedRunningPromptBehaviors)
    && typeof runtime.supportsQueuedMessageEditing === 'boolean'
    && typeof runtime.supportsThinking === 'boolean'
    && runtime.steeringMessageCount === 0
    && Array.isArray(runtime.steeringMessages)
    && runtime.steeringMessages.length === 0
    && (runtime.steeringMode === 'all' || runtime.steeringMode === 'one-at-a-time')
    && isThinkingLevel(runtime.thinkingLevel)
}

function createAgentDraftPresentationState(state: AgentWorkspaceState): AgentWorkspaceState {
  const runtime = state.runtime

  return {
    activeSession: null,
    runtime: {
      agentId: runtime.agentId,
      // Provider auth status is unrelated to the composer model presentation
      // and must not be persisted in this renderer cache.
      auth: {},
      availableModelInputs: Object.fromEntries(
        Object.entries(runtime.availableModelInputs).map(([model, inputs]) => [model, [...inputs]]),
      ),
      availableModels: [...runtime.availableModels],
      availableThinkingLevels: [...runtime.availableThinkingLevels],
      availableThinkingLevelsByModel: Object.fromEntries(
        Object.entries(runtime.availableThinkingLevelsByModel)
          .map(([model, levels]) => [model, [...levels]]),
      ),
      compactionReason: null,
      defaultModel: runtime.defaultModel,
      defaultThinkingLevel: runtime.defaultThinkingLevel,
      executionState: undefined,
      followUpMessageCount: 0,
      followUpMessages: [],
      followUpMode: runtime.followUpMode,
      hasConfiguredModels: runtime.hasConfiguredModels,
      isCompacting: false,
      isStreaming: false,
      pendingMessageCount: 0,
      preferredModelByProvider: { ...runtime.preferredModelByProvider },
      retryAttempt: 0,
      retryMaxAttempts: null,
      selectedModel: runtime.defaultModel ?? runtime.selectedModel,
      setupHint: runtime.setupHint,
      steeringMessageCount: 0,
      steeringMessages: [],
      steeringMode: runtime.steeringMode,
      supportedRunningPromptBehaviors: [...runtime.supportedRunningPromptBehaviors],
      supportsQueuedMessageEditing: runtime.supportsQueuedMessageEditing,
      supportsThinking: runtime.supportsThinking,
      thinkingLevel: runtime.defaultThinkingLevel,
      workspacePath: null,
    },
    sessions: [],
  }
}

export function cacheAgentDraftPresentationState(state: AgentWorkspaceState) {
  const presentationState = createAgentDraftPresentationState(state)
  draftPresentationStates.set(state.runtime.agentId, presentationState)
  try {
    const storage = rendererCacheStorage()
    storage?.setItem(persistedCacheKey(state.runtime.agentId), JSON.stringify(presentationState))
    storage?.removeItem(legacyCacheKey(state.runtime.agentId))
  } catch {
    // Best-effort presentation caching must never block the live runtime state.
  }
  return presentationState
}

export function getCachedAgentDraftPresentationState(agentId: AgentId) {
  const memoryState = draftPresentationStates.get(agentId)
  if (memoryState) return memoryState

  const storage = rendererCacheStorage()
  if (!storage) return null
  const storageKey = persistedCacheKey(agentId)

  try {
    const serialized = storage.getItem(storageKey)
    if (!serialized) return null
    const parsed = JSON.parse(serialized) as unknown
    if (!isPersistedAgentDraftPresentationState(parsed, agentId)) {
      storage.removeItem(storageKey)
      return null
    }
    const presentationState = createAgentDraftPresentationState(parsed)
    draftPresentationStates.set(agentId, presentationState)
    return presentationState
  } catch {
    try {
      storage.removeItem(storageKey)
    } catch {
      // Corrupt best-effort cache cleanup must not block the live state load.
    }
    return null
  }
}

export function resolveAgentModelPresentation({
  currentDraft,
  currentState,
  hasLoadedCurrentState,
  selectedAgentId,
}: {
  currentDraft: AgentModelDraft
  currentState: AgentWorkspaceState
  hasLoadedCurrentState: boolean
  selectedAgentId: AgentId
}) {
  const currentStateOwnsPresentation = currentState.runtime.agentId === selectedAgentId
    && (hasLoadedCurrentState || currentState.runtime.hasConfiguredModels)
  const state = currentStateOwnsPresentation
    ? currentState
    : getCachedAgentDraftPresentationState(selectedAgentId)

  if (!state) return null
  return {
    draft: state === currentState ? currentDraft : getRuntimeDefaultModelDraft(state.runtime),
    state,
  }
}

export function resolveAgentDraftPresentationState({
  currentState,
  hasLoadedCurrentState,
  initialState,
  selectedAgentId,
}: {
  currentState: AgentWorkspaceState
  hasLoadedCurrentState: boolean
  initialState: AgentWorkspaceState
  selectedAgentId: AgentId
}) {
  if (hasLoadedCurrentState && currentState.runtime.agentId === selectedAgentId) {
    return cacheAgentDraftPresentationState(currentState)
  }

  return getCachedAgentDraftPresentationState(selectedAgentId)
    ?? resolveInitialAgentDraftPresentationState(selectedAgentId, initialState)
}

export function isAgentDraftWorkspaceState(
  state: AgentWorkspaceState,
  selectedAgentId: AgentId,
) {
  return state.runtime.agentId === selectedAgentId
    && state.runtime.workspacePath === null
    && state.activeSession === null
    && state.sessions.length === 0
}

export function resolveInitialAgentDraftPresentationState(
  selectedAgentId: AgentId,
  initialState: AgentWorkspaceState,
) {
  return getCachedAgentDraftPresentationState(selectedAgentId) ?? {
    ...initialState,
    runtime: {
      ...initialState.runtime,
      agentId: selectedAgentId,
    },
  }
}

export function clearAgentDraftPresentationMemoryCache() {
  draftPresentationStates.clear()
}

export function clearAgentDraftPresentationCache() {
  clearAgentDraftPresentationMemoryCache()
  const storage = rendererCacheStorage()
  if (!storage) return
  for (const agentId of AGENT_IDS) {
    try {
      storage.removeItem(persistedCacheKey(agentId))
      storage.removeItem(legacyCacheKey(agentId))
    } catch {
      // Test and privacy cleanup remains best effort when storage is restricted.
    }
  }
}

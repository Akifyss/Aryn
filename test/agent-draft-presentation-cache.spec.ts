import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cacheAgentDraftPresentationState,
  clearAgentDraftPresentationCache,
  clearAgentDraftPresentationMemoryCache,
  getCachedAgentDraftPresentationState,
  isAgentDraftWorkspaceState,
  resolveAgentDraftPresentationState,
  resolveInitialAgentDraftPresentationState,
  resolveAgentModelPresentation,
} from '../src/features/agent/lib/agent-draft-presentation-cache'
import type { AgentId } from '../src/features/agent/agent-definition'
import type { AgentWorkspaceState } from '../src/features/agent/types'

function state(agentId: AgentId, workspacePath: string | null, model: string): AgentWorkspaceState {
  return {
    activeSession: workspacePath ? {
      annotations: {},
      messages: [],
      name: 'Session',
      sessionId: 'session-1',
      sessionPath: 'session-1',
      workspacePath,
    } : null,
    runtime: {
      agentId,
      auth: {},
      availableModelInputs: { [model]: ['text'] },
      availableModels: [model],
      availableThinkingLevels: ['off', 'medium'],
      availableThinkingLevelsByModel: { [model]: ['off', 'medium'] },
      compactionReason: 'threshold',
      defaultModel: model,
      defaultThinkingLevel: 'medium',
      followUpMessageCount: 1,
      followUpMessages: ['queued'],
      followUpMode: 'one-at-a-time',
      hasConfiguredModels: true,
      isCompacting: true,
      isStreaming: true,
      pendingMessageCount: 1,
      preferredModelByProvider: {},
      retryAttempt: 1,
      retryMaxAttempts: 3,
      selectedModel: model,
      setupHint: null,
      steeringMessageCount: 1,
      steeringMessages: ['steer'],
      steeringMode: 'one-at-a-time',
      supportedRunningPromptBehaviors: ['steer', 'followUp'],
      supportsQueuedMessageEditing: true,
      supportsThinking: true,
      thinkingLevel: 'medium',
      workspacePath,
    },
    sessions: [],
  }
}

function emptyState(agentId: AgentId = 'builtin-pi') {
  const result = state(agentId, null, '')
  result.runtime.availableModelInputs = {}
  result.runtime.availableModels = []
  result.runtime.availableThinkingLevelsByModel = {}
  result.runtime.defaultModel = null
  result.runtime.hasConfiguredModels = false
  result.runtime.selectedModel = null
  result.runtime.supportsThinking = false
  result.runtime.thinkingLevel = 'off'
  return result
}

afterEach(() => {
  clearAgentDraftPresentationCache()
  vi.unstubAllGlobals()
})

describe('agent draft presentation cache', () => {
  it('keeps the last confirmed model configuration without session execution state', () => {
    const confirmedState = state('builtin-pi', 'C:/workspace', 'openai/gpt-5')
    confirmedState.runtime.auth = {
      openai: {
        category: 'api_key',
        environmentCredentialLabel: null,
        envVarName: 'OPENAI_API_KEY',
        envVarNames: ['OPENAI_API_KEY'],
        hasStoredCredential: true,
        label: 'OpenAI',
        source: 'stored',
        storedCredentialType: 'api_key',
        supportsApiKey: true,
        supportsOAuth: false,
        usesEnvironmentCredential: false,
      },
    }
    cacheAgentDraftPresentationState(confirmedState)

    expect(getCachedAgentDraftPresentationState('builtin-pi')).toMatchObject({
      activeSession: null,
      runtime: {
        auth: {},
        availableModels: ['openai/gpt-5'],
        compactionReason: null,
        followUpMessages: [],
        isCompacting: false,
        isStreaming: false,
        pendingMessageCount: 0,
        steeringMessages: [],
        workspacePath: null,
      },
      sessions: [],
    })
  })

  it('isolates cached model presentations by Agent', () => {
    cacheAgentDraftPresentationState(state('builtin-pi', null, 'openai/gpt-5'))
    cacheAgentDraftPresentationState(state('codex', null, 'openai/gpt-5.6-sol'))

    expect(getCachedAgentDraftPresentationState('builtin-pi')?.runtime.availableModels)
      .toEqual(['openai/gpt-5'])
    expect(getCachedAgentDraftPresentationState('codex')?.runtime.availableModels)
      .toEqual(['openai/gpt-5.6-sol'])
    expect(getCachedAgentDraftPresentationState('opencode')).toBeNull()
  })

  it('restores the last confirmed presentation after a renderer reload', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
    cacheAgentDraftPresentationState(state('builtin-pi', null, 'openai/gpt-5'))
    clearAgentDraftPresentationMemoryCache()

    expect(getCachedAgentDraftPresentationState('builtin-pi')?.runtime.availableModels)
      .toEqual(['openai/gpt-5'])
  })

  it('hydrates the initial renderer state synchronously from the persisted Agent cache', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })
    const initialState = emptyState()
    cacheAgentDraftPresentationState(state('pi', null, 'anthropic/claude-sonnet-4'))
    clearAgentDraftPresentationMemoryCache()

    const hydratedState = resolveInitialAgentDraftPresentationState('pi', initialState)

    expect(hydratedState.runtime.agentId).toBe('pi')
    expect(hydratedState.runtime.defaultModel).toBe('anthropic/claude-sonnet-4')
    expect(hydratedState.runtime.availableModels).toEqual(['anthropic/claude-sonnet-4'])
  })

  it('uses a confirmed current runtime first and later reuses it during new-conversation loading', () => {
    const initialState = emptyState()
    const confirmedState = state('builtin-pi', 'C:/workspace', 'openai/gpt-5')

    const firstPresentation = resolveAgentDraftPresentationState({
      currentState: confirmedState,
      hasLoadedCurrentState: true,
      initialState,
      selectedAgentId: 'builtin-pi',
    })
    const cachedPresentation = resolveAgentDraftPresentationState({
      currentState: state('codex', 'C:/other', 'openai/gpt-5.6-sol'),
      hasLoadedCurrentState: false,
      initialState,
      selectedAgentId: 'builtin-pi',
    })

    expect(firstPresentation.runtime.availableModels).toEqual(['openai/gpt-5'])
    expect(cachedPresentation).toBe(firstPresentation)
  })

  it('resolves a cached model presentation instead of exposing an empty current fallback', () => {
    const initialState = emptyState()
    cacheAgentDraftPresentationState(state('builtin-pi', null, 'openai/gpt-5'))

    const presentation = resolveAgentModelPresentation({
      currentDraft: { modelId: '', provider: '', thinkingLevel: 'off' },
      currentState: initialState,
      hasLoadedCurrentState: false,
      selectedAgentId: 'builtin-pi',
    })

    expect(presentation?.draft).toEqual({
      modelId: 'gpt-5',
      provider: 'openai',
      thinkingLevel: 'medium',
    })
    expect(presentation?.state.runtime.availableModels).toEqual(['openai/gpt-5'])
  })

  it('keeps a confirmed Agent model visible while a session workspace is still loading', () => {
    const confirmedState = state('builtin-pi', 'C:/source', 'openai/gpt-5')
    cacheAgentDraftPresentationState(confirmedState)

    const presentation = resolveAgentModelPresentation({
      currentDraft: { modelId: 'gpt-5', provider: 'openai', thinkingLevel: 'medium' },
      currentState: confirmedState,
      hasLoadedCurrentState: false,
      selectedAgentId: 'builtin-pi',
    })

    expect(presentation?.state).toBe(confirmedState)
  })

  it('keeps a confirmed no-provider action visible while a session workspace is still loading', () => {
    const confirmedState = emptyState()
    confirmedState.runtime.workspacePath = 'C:/source'
    cacheAgentDraftPresentationState(confirmedState)

    const presentation = resolveAgentModelPresentation({
      currentDraft: { modelId: '', provider: '', thinkingLevel: 'off' },
      currentState: confirmedState,
      hasLoadedCurrentState: false,
      selectedAgentId: 'builtin-pi',
    })

    expect(presentation?.state.runtime.hasConfiguredModels).toBe(false)
  })

  it('uses the target Agent cache while a cross-Agent session runtime is loading', () => {
    const currentState = state('builtin-pi', 'C:/source', 'openai/gpt-5')
    cacheAgentDraftPresentationState(state('codex', 'C:/target', 'openai/gpt-5.6-sol'))

    const presentation = resolveAgentModelPresentation({
      currentDraft: { modelId: 'gpt-5', provider: 'openai', thinkingLevel: 'medium' },
      currentState,
      hasLoadedCurrentState: false,
      selectedAgentId: 'codex',
    })

    expect(presentation?.state.runtime.agentId).toBe('codex')
    expect(presentation?.draft.modelId).toBe('gpt-5.6-sol')
  })

  it('does not reuse another Agent runtime when the selected Agent has no cache', () => {
    const fallback = resolveAgentDraftPresentationState({
      currentState: state('builtin-pi', 'C:/source', 'openai/gpt-5'),
      hasLoadedCurrentState: false,
      initialState: emptyState(),
      selectedAgentId: 'codex',
    })

    expect(fallback.runtime.agentId).toBe('codex')
    expect(fallback.runtime.availableModels).toEqual([])
    expect(resolveAgentModelPresentation({
      currentDraft: { modelId: 'gpt-5', provider: 'openai', thinkingLevel: 'medium' },
      currentState: fallback,
      hasLoadedCurrentState: false,
      selectedAgentId: 'codex',
    })).toBeNull()
  })

  it('accepts only matching Agent draft states from external provider settings', () => {
    expect(isAgentDraftWorkspaceState(emptyState('builtin-pi'), 'builtin-pi')).toBe(true)
    expect(isAgentDraftWorkspaceState(emptyState('builtin-pi'), 'codex')).toBe(false)
    expect(isAgentDraftWorkspaceState(state('builtin-pi', 'C:/workspace', 'openai/gpt-5'), 'builtin-pi'))
      .toBe(false)
  })

  it('removes corrupt persisted presentations instead of hydrating partial runtime state', () => {
    const values = new Map<string, string>([[
      'aryn:agent-draft-presentations:v2:builtin-pi',
      JSON.stringify({
        activeSession: null,
        runtime: {
          agentId: 'builtin-pi',
          availableModels: ['openai/gpt-5'],
          hasConfiguredModels: true,
          workspacePath: null,
        },
        sessions: [],
      }),
    ]])
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    })

    expect(getCachedAgentDraftPresentationState('builtin-pi')).toBeNull()
    expect(values.size).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { buildBbSessionRuntimeState } from '@/features/agent/lib/bb-session-runtime-state'
import type { AgentRuntimeState } from '@/features/agent/types'

function createRuntime(overrides: Partial<AgentRuntimeState> = {}): AgentRuntimeState {
  return {
    agentId: 'pi',
    auth: {},
    workspacePath: 'C:/workspace',
    hasConfiguredModels: true,
    availableModels: [],
    availableModelInputs: {},
    availableThinkingLevels: [],
    availableThinkingLevelsByModel: {},
    compactionReason: null,
    followUpMessageCount: 0,
    followUpMessages: [],
    followUpMode: 'all',
    isCompacting: false,
    defaultModel: null,
    defaultThinkingLevel: 'medium',
    preferredModelByProvider: {},
    selectedModel: null,
    isStreaming: true,
    pendingMessageCount: 0,
    retryAttempt: 1,
    retryMaxAttempts: 3,
    setupHint: null,
    supportedRunningPromptBehaviors: [],
    supportsQueuedMessageEditing: false,
    supportsThinking: true,
    steeringMessageCount: 0,
    steeringMessages: [],
    steeringMode: 'all',
    thinkingLevel: 'medium',
    ...overrides,
  }
}

const liveOptions = {
  activeSessionPath: 'session-active',
  agentId: 'pi' as const,
  assistantText: 'live assistant',
  isThinkingStreaming: true,
  isViewingActiveRuntime: true,
  liveTools: [{
    id: 'tool-1',
    name: 'search',
    status: 'running' as const,
    summary: 'Searching',
  }],
  panelError: 'temporary error',
  runtime: createRuntime(),
  startedAt: 123,
  stoppingPrompt: null,
  thinkingText: 'live thinking',
}

describe('bb session runtime state', () => {
  it('projects drafts and lifecycle only for the active runtime session', () => {
    expect(buildBbSessionRuntimeState(liveOptions)).toMatchObject({
      error: 'temporary error',
      isStreaming: true,
      retryAttempt: 1,
      streaming: {
        assistantText: 'live assistant',
        thinkingText: 'live thinking',
        tools: [{ id: 'tool-1' }],
      },
    })
  })

  it('does not leak a same-agent live runtime into a historical session', () => {
    expect(buildBbSessionRuntimeState({
      ...liveOptions,
      isViewingActiveRuntime: false,
    })).toEqual({})
  })

  it('does not leak a different provider runtime into the visible session', () => {
    expect(buildBbSessionRuntimeState({
      ...liveOptions,
      agentId: 'codex',
    })).toEqual({})
  })
})

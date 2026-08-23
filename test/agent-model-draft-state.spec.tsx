import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLastNewConversationAgentId } from '../src/features/agent/hooks/use-agent-catalog'
import { useAgentModelDraftState } from '../src/features/agent/model/use-agent-model-state'
import type { AgentWorkspaceState } from '../src/features/agent/types'

const runtime = {
  agentId: 'pi',
  auth: {},
  availableModelInputs: { 'anthropic/claude-sonnet-4': ['text'] },
  availableModels: ['anthropic/claude-sonnet-4'],
  availableThinkingLevels: ['off', 'medium'],
  availableThinkingLevelsByModel: { 'anthropic/claude-sonnet-4': ['off', 'medium'] },
  compactionReason: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  defaultThinkingLevel: 'medium',
  followUpMessageCount: 0,
  followUpMessages: [],
  followUpMode: 'one-at-a-time',
  hasConfiguredModels: true,
  isCompacting: false,
  isStreaming: false,
  pendingMessageCount: 0,
  preferredModelByProvider: {},
  retryAttempt: 0,
  retryMaxAttempts: null,
  selectedModel: 'anthropic/claude-sonnet-4',
  setupHint: null,
  steeringMessageCount: 0,
  steeringMessages: [],
  steeringMode: 'one-at-a-time',
  supportedRunningPromptBehaviors: ['steer', 'followUp'],
  supportsQueuedMessageEditing: true,
  supportsThinking: true,
  thinkingLevel: 'medium',
  workspacePath: null,
} as AgentWorkspaceState['runtime']

function ModelDraftProbe() {
  const state = useAgentModelDraftState(runtime)
  return (
    <span>
      {state.selectedProviderValue}/{state.modelInputValue}/{state.selectedThinkingLevel}
    </span>
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Agent model draft initial state', () => {
  it('renders the cached default model on the first render', () => {
    expect(renderToStaticMarkup(<ModelDraftProbe />))
      .toContain('anthropic/claude-sonnet-4/medium')
  })

  it('reads the last new-conversation Agent synchronously', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'pi',
    })

    expect(readLastNewConversationAgentId()).toBe('pi')
  })
})

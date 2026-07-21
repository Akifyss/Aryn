import { describe, expect, it } from 'vitest'
import {
  deriveAgentSessionPhase,
  formatAgentSessionStatus,
} from '@/features/agent/components/agent-session-status/agent-session-status'

type PhaseInput = Parameters<typeof deriveAgentSessionPhase>[0]
type PhaseInputOverrides = Partial<Omit<PhaseInput, 'runtime'>> & {
  runtime?: Partial<PhaseInput['runtime']>
}

function phaseInput(overrides: PhaseInputOverrides = {}): PhaseInput {
  return {
    draftAssistant: '',
    hasRunningTools: false,
    hasVisibleRunningContent: false,
    isStreaming: false,
    isThinkingStreaming: false,
    panelError: null,
    pendingMessageCount: 0,
    retryAttempt: 0,
    workspacePath: 'C:/workspace',
    ...overrides,
    runtime: {
      agentId: 'builtin-pi',
      executionState: undefined,
      hasConfiguredModels: true,
      isCompacting: false,
      ...overrides.runtime,
    },
  }
}

describe('Agent session status', () => {
  it('hides status without a workspace and gives panel errors highest priority', () => {
    expect(deriveAgentSessionPhase(phaseInput({ workspacePath: null }))).toBeNull()
    expect(deriveAgentSessionPhase(phaseInput({
      hasRunningTools: true,
      panelError: 'Agent failed',
    }))).toEqual({
      message: 'Agent failed',
      type: 'error',
    })
  })

  it('derives built-in Agent phases in execution priority order', () => {
    expect(deriveAgentSessionPhase(phaseInput({
      hasRunningTools: true,
      retryAttempt: 1,
      runtime: { isCompacting: true },
    }))).toEqual({ type: 'tool_execution' })
    expect(deriveAgentSessionPhase(phaseInput({
      retryAttempt: 1,
      runtime: { isCompacting: true },
    }))).toEqual({ type: 'compaction' })
    expect(deriveAgentSessionPhase(phaseInput({ retryAttempt: 1 }))).toEqual({ type: 'auto_retry' })
    expect(deriveAgentSessionPhase(phaseInput({
      isStreaming: true,
      isThinkingStreaming: true,
    }))).toEqual({ type: 'thinking' })
    expect(deriveAgentSessionPhase(phaseInput({
      draftAssistant: 'partial response',
      isStreaming: true,
    }))).toEqual({ type: 'streaming' })
    expect(deriveAgentSessionPhase(phaseInput({ isStreaming: true }))).toEqual({ type: 'working' })
    expect(deriveAgentSessionPhase(phaseInput({ pendingMessageCount: 1 }))).toEqual({ type: 'queued' })
    expect(deriveAgentSessionPhase(phaseInput())).toEqual({ type: 'idle' })
  })

  it('uses external Agent execution state and suppresses duplicate streaming status', () => {
    expect(deriveAgentSessionPhase(phaseInput({
      runtime: {
        agentId: 'codex',
        executionState: {
          attempt: 1,
          message: 'Retrying',
          next: 0,
          type: 'retry',
        },
      },
    }))).toEqual({ type: 'auto_retry' })
    expect(deriveAgentSessionPhase(phaseInput({
      isStreaming: true,
      runtime: { agentId: 'codex' },
    }))).toEqual({ type: 'thinking' })
    expect(deriveAgentSessionPhase(phaseInput({
      hasVisibleRunningContent: true,
      isStreaming: true,
      runtime: { agentId: 'codex' },
    }))).toBeNull()
    expect(deriveAgentSessionPhase(phaseInput({
      pendingMessageCount: 1,
      runtime: { agentId: 'codex' },
    }))).toEqual({ type: 'queued' })
  })

  it('formats queue labels and preserves unresolved pending counts', () => {
    const status = formatAgentSessionStatus({ type: 'queued' }, {
      followUpMessageCount: 1,
      pendingMessageCount: 5,
      steeringMessageCount: 2,
    })

    expect(status?.label).toBe('等待处理')
    expect(status?.badges?.map((badge) => badge.label)).toEqual([
      '引导 2',
      '排队 1',
      '等待 2',
    ])
    expect(formatAgentSessionStatus({ type: 'queued' }, {
      followUpMessageCount: 0,
      pendingMessageCount: 2,
      steeringMessageCount: 2,
    })?.label).toBe('引导等待中')
    expect(formatAgentSessionStatus({ type: 'queued' }, {
      followUpMessageCount: 2,
      pendingMessageCount: 2,
      steeringMessageCount: 0,
    })?.label).toBe('排队等待中')
  })

  it('omits queue badges for errors and renders no idle status', () => {
    expect(formatAgentSessionStatus({ message: 'Failed', type: 'error' }, {
      followUpMessageCount: 1,
      pendingMessageCount: 2,
      steeringMessageCount: 1,
    })).toEqual({
      indicator: {
        kind: 'symbol',
        value: '•',
      },
      label: 'Error',
      tone: 'error',
    })
    expect(formatAgentSessionStatus({ type: 'idle' }, {
      followUpMessageCount: 0,
      pendingMessageCount: 0,
      steeringMessageCount: 0,
    })).toBeNull()
  })
})

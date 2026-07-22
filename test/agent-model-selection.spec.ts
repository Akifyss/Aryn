import { describe, expect, it } from 'vitest'
import {
  clampAgentThinkingLevel,
  formatThinkingLevelLabel,
  getAgentModelKey,
  getAgentProviderModelIds,
  getConfiguredAgentProviders,
  hasConfigurableAgentThinkingLevel,
  parseModelSelection,
} from '@/features/agent/lib/model-selection'

describe('agent model selection', () => {
  it('preserves model identifiers that contain path separators', () => {
    expect(parseModelSelection('provider/model/family')).toEqual({
      modelId: 'model/family',
      provider: 'provider',
    })
    expect(getAgentModelKey('provider', 'model/family')).toBe('provider/model/family')
  })

  it('returns an empty selection when no model is configured', () => {
    expect(parseModelSelection(null)).toEqual({
      modelId: '',
      provider: '',
    })
  })

  it('derives ordered providers and deduplicated provider model identifiers', () => {
    const availableModels = [
      'custom/zeta',
      'openai/gpt-5',
      'anthropic/claude/sonnet',
      'openai/gpt-5',
      'custom/alpha',
    ]

    expect(getConfiguredAgentProviders(availableModels)).toEqual([
      'anthropic',
      'openai',
      'custom',
    ])
    expect(getAgentProviderModelIds(availableModels, 'custom')).toEqual(['zeta', 'alpha'])
    expect(getAgentProviderModelIds(availableModels, 'anthropic')).toEqual(['claude/sonnet'])
  })

  it('clamps unsupported thinking levels to the nearest available level', () => {
    expect(clampAgentThinkingLevel('medium', ['off', 'high'])).toBe('high')
    expect(clampAgentThinkingLevel('xhigh', ['low', 'medium'])).toBe('medium')
    expect(clampAgentThinkingLevel('low', [])).toBe('low')
  })

  it('formats and detects configurable thinking levels', () => {
    expect(formatThinkingLevelLabel('xhigh')).toBe('XHigh')
    expect(hasConfigurableAgentThinkingLevel(['off'])).toBe(false)
    expect(hasConfigurableAgentThinkingLevel(['off', 'medium'])).toBe(true)
  })
})

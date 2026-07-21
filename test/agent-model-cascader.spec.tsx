import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AgentModelCascader } from '@/features/agent/components/agent-model-cascader/agent-model-cascader'

describe('AgentModelCascader', () => {
  it('renders the selected model trigger with the thinking level', () => {
    const markup = renderToStaticMarkup(
      <AgentModelCascader
        availableModels={['openai/gpt-5']}
        availableThinkingLevels={['off', 'low']}
        availableThinkingLevelsByModel={{ 'openai/gpt-5': ['off', 'low'] }}
        configuredProviders={['openai']}
        currentModelId='gpt-5'
        currentProvider='openai'
        currentThinkingLevel='low'
        currentThinkingLevelLabel='Low'
        disabled={false}
        isOpen={false}
        onOpenChange={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinkingLevel={vi.fn()}
      />,
    )

    expect(markup).toContain('agent-model-cascader-trigger')
    expect(markup).toContain('gpt-5')
    expect(markup).toContain('Low')
    expect(markup).not.toContain('class="agent-model-cascader"')
  })

  it('renders the provider setup action when no providers are configured', () => {
    const markup = renderToStaticMarkup(
      <AgentModelCascader
        availableModels={[]}
        availableThinkingLevels={['off']}
        availableThinkingLevelsByModel={{}}
        configuredProviders={[]}
        currentModelId=''
        currentProvider=''
        currentThinkingLevel='off'
        currentThinkingLevelLabel='Off'
        disabled={false}
        isOpen={false}
        onOpenChange={vi.fn()}
        onOpenProviderSettings={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinkingLevel={vi.fn()}
      />,
    )

    expect(markup).toContain('agent-provider-setup-button')
    expect(markup).not.toContain('agent-model-cascader-trigger')
  })
})

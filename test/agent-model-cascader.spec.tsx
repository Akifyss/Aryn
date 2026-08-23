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
        hasProviderStatePresentation
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
        hasProviderStatePresentation
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

  it('does not present provider setup before provider state or a cached presentation is available', () => {
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
        disabled
        hasProviderStatePresentation={false}
        isOpen={false}
        onOpenChange={vi.fn()}
        onOpenProviderSettings={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinkingLevel={vi.fn()}
      />,
    )

    expect(markup).toContain('agent-model-field')
    expect(markup).not.toContain('agent-model-loading-placeholder')
    expect(markup).not.toContain('正在加载模型')
    expect(markup).not.toContain('agent-provider-setup-button')
    expect(markup).not.toContain('agent-model-cascader-trigger')
  })
})

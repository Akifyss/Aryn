import { describe, expect, it } from 'vitest'
import {
  buildAuthProviderGroups,
  buildAuthProviderViewModels,
  filterAuthProviders,
  getProviderStatus,
} from '../src/features/settings/components/settings-dialog/provider-settings-section/provider-settings-model'

describe('settings provider model', () => {
  it('builds fallback state for every configured provider', () => {
    const providers = buildAuthProviderViewModels(null)
    const openAi = providers.find((provider) => provider.provider === 'openai')

    expect(openAi).toBeDefined()
    expect(openAi?.key).toBe('openai')
    expect(openAi?.state.source).toBe('none')
    expect(openAi?.state.storedCredentialType).toBeNull()
    expect(openAi?.state.envVarNames).toEqual(openAi?.envVarNames)
  })

  it('places multi-category providers in each declared group and filters credentials', () => {
    const groups = buildAuthProviderGroups(buildAuthProviderViewModels(null))
    const subscriptionGroup = groups.find((group) => group.category === 'subscription')
    const apiKeyGroup = groups.find((group) => group.category === 'api_key')

    expect(subscriptionGroup?.providers.some(
      (provider) => provider.provider === 'anthropic',
    )).toBe(true)
    expect(apiKeyGroup?.providers.some(
      (provider) => provider.provider === 'anthropic',
    )).toBe(true)

    const matches = filterAuthProviders(
      apiKeyGroup?.providers ?? [],
      'OPENAI_API_KEY',
    )

    expect(matches.some((provider) => provider.provider === 'openai')).toBe(true)
  })

  it('derives the subscription status from stored OAuth credentials', () => {
    const subscriptionGroup = buildAuthProviderGroups(
      buildAuthProviderViewModels(null),
    ).find((group) => group.category === 'subscription')
    const provider = subscriptionGroup?.providers.find(
      (candidate) => candidate.provider === 'anthropic',
    )

    expect(provider).toBeDefined()
    if (!provider) {
      return
    }

    expect(getProviderStatus({
      ...provider,
      state: {
        ...provider.state,
        hasStoredCredential: true,
        source: 'stored',
        storedCredentialType: 'oauth',
      },
    }, 'subscription')).toEqual({
      color: 'emerald',
      label: '订阅已登录',
      type: 'stored',
    })
  })
})

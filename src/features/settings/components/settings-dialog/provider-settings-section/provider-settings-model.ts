import {
  AGENT_PROVIDER_AUTH_CONFIGS,
  type AgentProviderAuthConfig,
  type AgentProviderCategory,
} from '@/features/agent/provider-auth'
import type {
  AgentProviderAuthState,
  AgentProviderAuthUiEvent,
  AgentWorkspaceState,
} from '@/features/agent/types'

export type ProviderAuthFlowState = {
  authUrl: string | null
  instructions: string | null
  progress: string[]
  prompt: Extract<AgentProviderAuthUiEvent, { type: 'prompt' }> | null
  promptDraft: string
  provider: string
}

export type AuthProviderViewModel = AgentProviderAuthConfig & {
  key: string
  state: AgentProviderAuthState
}

export type AuthProviderGroupViewModel = AuthProviderViewModel & {
  groupCategory: AgentProviderCategory
}

export type ProviderStatus = {
  color: 'amber' | 'blue' | 'emerald' | 'gray'
  label: string
  type: 'env' | 'none' | 'stored'
}

export const AUTH_PROVIDER_GROUPS: Array<{
  category: AgentProviderCategory
  description: string
  label: string
}> = [
  {
    category: 'subscription',
    description: '通过浏览器完成 OAuth 登录，凭据会保存到 Agent auth.json 并由 Pi 自动刷新。',
    label: 'Subscriptions',
  },
  {
    category: 'api_key',
    description: '保存 API key，或通过对应环境变量让 Pi 自动读取。',
    label: 'API Keys',
  },
  {
    category: 'cloud',
    description: '云厂商通常还需要项目、区域、账号或网关等环境变量。',
    label: 'Cloud Providers',
  },
]

function getFallbackProviderAuthState(
  config: AgentProviderAuthConfig,
): AgentProviderAuthState {
  return {
    category: config.category,
    environmentCredentialLabel: null,
    envVarName: config.envVarNames[0] ?? '',
    envVarNames: config.envVarNames,
    hasStoredCredential: false,
    label: config.label,
    source: 'none',
    storedCredentialType: null,
    supportsApiKey: config.supportsApiKey,
    supportsOAuth: config.supportsOAuth,
    usesEnvironmentCredential: false,
  }
}

export function buildAuthProviderViewModels(
  agentState: AgentWorkspaceState | null,
): AuthProviderViewModel[] {
  const runtimeAuth = agentState?.runtime.auth ?? {}

  return AGENT_PROVIDER_AUTH_CONFIGS.map((config) => ({
    ...config,
    key: config.provider,
    state: runtimeAuth[config.provider] ?? getFallbackProviderAuthState(config),
  }))
}

export function buildAuthProviderGroups(
  providers: AuthProviderViewModel[],
) {
  return AUTH_PROVIDER_GROUPS
    .map((group) => ({
      ...group,
      providers: providers
        .filter((provider) => (
          provider.groupCategories ?? [provider.category]
        ).includes(group.category))
        .map((provider): AuthProviderGroupViewModel => ({
          ...provider,
          groupCategory: group.category,
        })),
    }))
    .filter((group) => group.providers.length > 0)
}

export function filterAuthProviders(
  providers: AuthProviderGroupViewModel[],
  searchQuery: string,
) {
  const query = searchQuery.trim().toLowerCase()

  if (!query) {
    return providers
  }

  return providers.filter((provider) => (
    provider.label.toLowerCase().includes(query)
    || provider.provider.toLowerCase().includes(query)
    || provider.state.envVarNames.some((name) => name.toLowerCase().includes(query))
  ))
}

export function getProviderLabel(provider: string) {
  return AGENT_PROVIDER_AUTH_CONFIGS
    .find((config) => config.provider === provider)?.label ?? provider
}

export function isProviderAuthCancelError(error: unknown) {
  return error instanceof Error && /cancelled|aborted/i.test(error.message)
}

export function getProviderMeta(provider: AuthProviderGroupViewModel) {
  const { state } = provider

  if (provider.groupCategory === 'subscription' && provider.supportsOAuth) {
    if (state.storedCredentialType === 'oauth') {
      return '正在使用已保存的订阅登录。'
    }

    if (state.storedCredentialType === 'api_key') {
      return '已保存 API key；订阅登录尚未配置。'
    }

    if (state.source === 'env') {
      const environmentLabel = state.environmentCredentialLabel
        ?? state.envVarNames.join(', ')
      return environmentLabel.includes('API_KEY') && !environmentLabel.includes('OAUTH')
        ? `正在使用 API key 环境凭据：${environmentLabel}`
        : `正在使用环境凭据：${environmentLabel}`
    }

    return '尚未配置订阅登录。'
  }

  if (provider.groupCategory === 'api_key' && provider.supportsApiKey) {
    if (state.storedCredentialType === 'api_key') {
      return '正在使用已保存的 API 密钥。'
    }

    if (state.storedCredentialType === 'oauth') {
      return '已保存订阅登录；API key 尚未配置。'
    }

    if (state.source === 'env') {
      const environmentLabel = state.environmentCredentialLabel
        ?? state.envVarNames.join(', ')
      return environmentLabel.includes('OAUTH')
        ? `正在使用 OAuth 环境凭据：${environmentLabel}`
        : `正在使用环境凭据：${environmentLabel}`
    }
  }

  if (state.source === 'stored') {
    return state.storedCredentialType === 'oauth'
      ? '正在使用已保存的订阅登录。'
      : '正在使用已保存的 API 密钥。'
  }

  if (state.source === 'env') {
    return `正在使用环境凭据：${state.environmentCredentialLabel ?? state.envVarNames.join(', ')}`
  }

  if (state.envVarNames.length > 0) {
    return `尚未配置。环境变量：${state.envVarNames.join(', ')}`
  }

  return '尚未配置。'
}

export function getProviderStatus(
  provider: AuthProviderGroupViewModel,
  category: AgentProviderCategory,
): ProviderStatus {
  const { state } = provider
  const hasStoredOAuth = state.storedCredentialType === 'oauth'
  const hasStoredApiKey = state.storedCredentialType === 'api_key'

  if (category === 'subscription') {
    if (hasStoredOAuth) {
      return { type: 'stored', label: '订阅已登录', color: 'emerald' }
    }
    if (state.source === 'env') {
      return { type: 'env', label: '来自环境变量', color: 'amber' }
    }
    if (hasStoredApiKey) {
      return { type: 'stored', label: 'API 密钥已配置', color: 'blue' }
    }
    return { type: 'none', label: '未配置订阅', color: 'gray' }
  }

  if (category === 'api_key') {
    if (hasStoredApiKey) {
      return { type: 'stored', label: '已保存密钥', color: 'emerald' }
    }
    if (state.source === 'env') {
      return { type: 'env', label: '来自环境变量', color: 'amber' }
    }
    if (hasStoredOAuth) {
      return { type: 'stored', label: '订阅已配置', color: 'blue' }
    }
    return { type: 'none', label: '未配置密钥', color: 'gray' }
  }

  if (state.source === 'stored' || hasStoredApiKey || hasStoredOAuth) {
    return { type: 'stored', label: '已配置凭据', color: 'emerald' }
  }
  if (state.source === 'env') {
    return { type: 'env', label: '来自环境变量', color: 'amber' }
  }
  return { type: 'none', label: '未配置', color: 'gray' }
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, ListBox, Select, Switch, Tabs } from '@heroui/react'
import { Icon } from '@iconify/react'
import {
  OpenAI,
  Claude,
  Gemini,
  DeepSeek,
  Mistral,
  Groq,
  Cerebras,
  OpenRouter,
  Together,
  HuggingFace,
  Fireworks,
  Vercel,
  Azure,
  Cloudflare,
  Aws,
  GithubCopilot,
  XAI,
  Minimax,
  Moonshot,
  XiaomiMiMo,
  Bedrock,
  ZAI,
  OpenCode
} from '@lobehub/icons'
import { AppScrollArea } from '@/components/app-scroll-area'
import {
  AGENT_PROVIDER_AUTH_CONFIGS,
  type AgentProviderCategory,
  type AgentProviderAuthConfig,
} from '@/features/agent/provider-auth'
import type { AgentProviderAuthState, AgentProviderAuthUiEvent, AgentWorkspaceState } from '@/features/agent/types'
import { resolveActiveWorkspaceIconThemeKey } from '@/features/settings/lib/icon-theme-selection'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '@/features/workspace/types'
import {
  AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS,
  getAlternateRunningPromptBehavior,
  isAgentRunningPromptEnterBehavior,
  useSettingsStore,
} from '@/hooks/use-settings-store'

export type SettingsSectionId = 'appearance' | 'conversation' | 'editor' | 'providers'

type SettingsViewProps = {
  activeSection: SettingsSectionId
  agentState: AgentWorkspaceState | null
  iconTheme: WorkspaceIconTheme | null
  iconThemeOptions: WorkspaceIconThemeCatalogOption[]
  isIconThemeBusy: boolean
  onAgentStateChange: (state: AgentWorkspaceState) => void
  onSectionChange: (section: SettingsSectionId) => void
  onSelectIconTheme: (selection: { sourceVsixPath: string, themeId: string }) => Promise<void>
  onStatusMessage: (message: string) => void
  resolvedTheme: 'light' | 'dark'
  workspacePath: string | null
}

const SETTINGS_SECTIONS: Array<{ description: string, id: SettingsSectionId, label: string }> = [
  {
    description: '主题、图标与界面外观设置。',
    id: 'appearance',
    label: '外观',
  },
  {
    description: '配置 Agent 对话输入与运行中快捷键行为。',
    id: 'conversation',
    label: '对话',
  },
  {
    description: '编辑器行为与 Markdown 工作流设置。',
    id: 'editor',
    label: '编辑器',
  },
  {
    description: 'AI 服务商与 API 密钥配置。',
    id: 'providers',
    label: '服务提供商',
  },
]

type ProviderAuthFlowState = {
  authUrl: string | null
  instructions: string | null
  progress: string[]
  prompt: Extract<AgentProviderAuthUiEvent, { type: 'prompt' }> | null
  promptDraft: string
  provider: string
}

type AuthProviderViewModel = AgentProviderAuthConfig & {
  key: string
  state: AgentProviderAuthState
}

type AuthProviderGroupViewModel = AuthProviderViewModel & {
  groupCategory: AgentProviderCategory
}

const AUTH_PROVIDER_GROUPS: Array<{
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

function getProviderLabel(provider: string) {
  return AGENT_PROVIDER_AUTH_CONFIGS.find((config) => config.provider === provider)?.label ?? provider
}

function isProviderAuthCancelError(error: unknown) {
  return error instanceof Error && /cancelled|aborted/i.test(error.message)
}

function getSectionTitle(section: SettingsSectionId) {
  switch (section) {
    case 'appearance':
      return '外观'
    case 'conversation':
      return '对话'
    case 'editor':
      return '编辑器'
    case 'providers':
      return '服务提供商'
    default:
      return '设置'
  }
}

function getFallbackProviderAuthState(config: AgentProviderAuthConfig): AgentProviderAuthState {
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

function getProviderMeta(provider: AuthProviderGroupViewModel) {
  const { state } = provider

  if (provider.groupCategory === 'subscription' && provider.supportsOAuth) {
    if (state.storedCredentialType === 'oauth') {
      return '正在使用已保存的订阅登录。'
    }

    if (state.storedCredentialType === 'api_key') {
      return '已保存 API key；订阅登录尚未配置。'
    }

    if (state.source === 'env') {
      const environmentLabel = state.environmentCredentialLabel ?? state.envVarNames.join(', ')
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
      const environmentLabel = state.environmentCredentialLabel ?? state.envVarNames.join(', ')
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

function renderProviderLobeIcon(provider: string, size = 18) {
  const renderIcon = (IconComponent: any) => {
    if (IconComponent.Color) {
      const Comp = IconComponent.Color;
      return <Comp size={size} />;
    }
    const Comp = IconComponent;
    return <Comp size={size} className="text-foreground" />;
  }

  const iconWrapper = (child: React.ReactNode) => (
    <div className="flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      {child}
    </div>
  );

  switch (provider) {
    case 'openai-codex':
    case 'openai':
      return iconWrapper(renderIcon(OpenAI));
    case 'zai':
      return iconWrapper(renderIcon(ZAI));
    case 'opencode':
    case 'opencode-go':
      return iconWrapper(renderIcon(OpenCode));
    case 'anthropic':
      return iconWrapper(renderIcon(Claude));
    case 'github-copilot':
      return iconWrapper(renderIcon(GithubCopilot));
    case 'openrouter':
      return iconWrapper(renderIcon(OpenRouter));
    case 'google':
    case 'google-vertex':
      return iconWrapper(renderIcon(Gemini));
    case 'deepseek':
      return iconWrapper(renderIcon(DeepSeek));
    case 'mistral':
      return iconWrapper(renderIcon(Mistral));
    case 'groq':
      return iconWrapper(renderIcon(Groq));
    case 'cerebras':
      return iconWrapper(renderIcon(Cerebras));
    case 'xai':
      return iconWrapper(renderIcon(XAI));
    case 'vercel-ai-gateway':
      return iconWrapper(renderIcon(Vercel));
    case 'huggingface':
      return iconWrapper(renderIcon(HuggingFace));
    case 'fireworks':
      return iconWrapper(renderIcon(Fireworks));
    case 'together':
      return iconWrapper(renderIcon(Together));
    case 'kimi-coding':
      return iconWrapper(renderIcon(Moonshot));
    case 'minimax':
    case 'minimax-cn':
      return iconWrapper(renderIcon(Minimax));
    case 'moonshotai':
    case 'moonshotai-cn':
      return iconWrapper(renderIcon(Moonshot));
    case 'xiaomi':
    case 'xiaomi-token-plan-cn':
    case 'xiaomi-token-plan-ams':
    case 'xiaomi-token-plan-sgp':
      return iconWrapper(renderIcon(XiaomiMiMo));
    case 'azure-openai-responses':
      return iconWrapper(renderIcon(Azure));
    case 'cloudflare-ai-gateway':
    case 'cloudflare-workers-ai':
      return iconWrapper(renderIcon(Cloudflare));
    case 'amazon-bedrock':
      return iconWrapper(renderIcon(Bedrock));
    default:
      return iconWrapper(
        <Icon icon="mingcute:key-2-line" className="text-muted" style={{ fontSize: size * 0.7 }} />
      );
  }
}

function getProviderStatus(
  provider: AuthProviderGroupViewModel,
  category: AgentProviderCategory
) {
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
  } else if (category === 'api_key') {
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
  } else {
    // cloud
    if (state.source === 'stored' || hasStoredApiKey || hasStoredOAuth) {
      return { type: 'stored', label: '已配置凭据', color: 'emerald' }
    }
    if (state.source === 'env') {
      return { type: 'env', label: '来自环境变量', color: 'amber' }
    }
    return { type: 'none', label: '未配置', color: 'gray' }
  }
}

export function SettingsDialog({
  activeSection,
  agentState,
  iconTheme,
  iconThemeOptions,
  isIconThemeBusy,
  onAgentStateChange,
  onSectionChange,
  onSelectIconTheme,
  onStatusMessage,
  resolvedTheme,
  workspacePath,
}: SettingsViewProps) {
  const { agent, meo, theme, setTheme, updateAgentSettings, updateMeoSettings } = useSettingsStore()
  const [authDrafts, setAuthDrafts] = useState<Record<string, string>>({})
  const [authFlow, setAuthFlow] = useState<ProviderAuthFlowState | null>(null)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [meoImageFolderDraft, setMeoImageFolderDraft] = useState(meo.imageFolder)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<AgentProviderCategory>('subscription')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
  const activeAuthProviderRef = useRef<string | null>(null)
  const isAuthCancelingRef = useRef(false)
  const pendingAuthPromptIdRef = useRef<string | null>(null)

  useEffect(() => {
    setMeoImageFolderDraft(meo.imageFolder)
  }, [meo.imageFolder])

  useEffect(() => {
    if (activeSection !== 'providers' || workspacePath) {
      return
    }

    let isDisposed = false

    void window.appApi.loadAgentDraftState()
      .then((nextState) => {
        if (!isDisposed) {
          onAgentStateChange(nextState)
        }
      })
      .catch((error) => {
        if (!isDisposed) {
          setPanelError(error instanceof Error ? error.message : 'Unable to load provider settings.')
        }
      })

    return () => {
      isDisposed = true
    }
  }, [activeSection, onAgentStateChange, workspacePath])

  const authProviders = useMemo<AuthProviderViewModel[]>(() => {
    const runtimeAuth = agentState?.runtime.auth ?? {}

    return AGENT_PROVIDER_AUTH_CONFIGS.map((config) => ({
      ...config,
      key: config.provider,
      state: runtimeAuth[config.provider] ?? getFallbackProviderAuthState(config),
    }))
  }, [agentState?.runtime.auth])

  const authProviderGroups = useMemo(() => (
    AUTH_PROVIDER_GROUPS
      .map((group) => ({
        ...group,
        providers: authProviders
          .filter((provider) => (provider.groupCategories ?? [provider.category]).includes(group.category))
          .map((provider): AuthProviderGroupViewModel => ({
            ...provider,
            groupCategory: group.category,
          })),
      }))
      .filter((group) => group.providers.length > 0)
  ), [authProviders])

  const filteredProviders = useMemo(() => {
    const group = authProviderGroups.find((g) => g.category === activeCategory)
    if (!group) return []
    
    const query = searchQuery.trim().toLowerCase()
    if (!query) return group.providers
    
    return group.providers.filter((p) => 
      p.label.toLowerCase().includes(query) ||
      p.provider.toLowerCase().includes(query) ||
      (p.state.envVarNames && p.state.envVarNames.some(name => name.toLowerCase().includes(query)))
    )
  }, [authProviderGroups, activeCategory, searchQuery])

  const activeIconThemeKey = useMemo(
    () => resolveActiveWorkspaceIconThemeKey(iconTheme, iconThemeOptions),
    [iconTheme, iconThemeOptions],
  )

  useEffect(() => {
    activeAuthProviderRef.current = authFlow?.provider ?? null
    pendingAuthPromptIdRef.current = authFlow?.prompt?.requestId ?? null
  }, [authFlow?.prompt?.requestId, authFlow?.provider])

  useEffect(() => () => {
    const provider = activeAuthProviderRef.current
    const requestId = pendingAuthPromptIdRef.current

    if (provider) {
      void window.appApi.cancelAgentProviderAuth(provider)
    } else if (requestId) {
      void window.appApi.respondAgentProviderAuthPrompt(requestId, null)
    }
  }, [])

  useEffect(() => {
    return window.appApi.onAgentProviderAuthUiEvent((event) => {
      setAuthFlow((currentValue) => {
        if (event.type === 'complete') {
          return currentValue?.provider === event.provider
            ? {
                ...currentValue,
                progress: event.message
                  ? [...currentValue.progress, event.message]
                  : currentValue.progress,
                prompt: null,
                promptDraft: '',
              }
            : currentValue
        }

        if (event.type === 'auth') {
          return {
            authUrl: event.url,
            instructions: event.instructions ?? null,
            progress: currentValue?.provider === event.provider ? currentValue.progress : [],
            prompt: currentValue?.provider === event.provider ? currentValue.prompt : null,
            promptDraft: currentValue?.provider === event.provider ? currentValue.promptDraft : '',
            provider: event.provider,
          }
        }

        if (event.type === 'progress') {
          return {
            authUrl: currentValue?.provider === event.provider ? currentValue.authUrl : null,
            instructions: currentValue?.provider === event.provider ? currentValue.instructions : null,
            progress: [
              ...(currentValue?.provider === event.provider ? currentValue.progress : []),
              event.message,
            ],
            prompt: currentValue?.provider === event.provider ? currentValue.prompt : null,
            promptDraft: currentValue?.provider === event.provider ? currentValue.promptDraft : '',
            provider: event.provider,
          }
        }

        return {
          authUrl: currentValue?.provider === event.provider ? currentValue.authUrl : null,
          instructions: currentValue?.provider === event.provider ? currentValue.instructions : null,
          progress: currentValue?.provider === event.provider ? currentValue.progress : [],
          prompt: event,
          promptDraft: '',
          provider: event.provider,
        }
      })
    })
  }, [])

  async function handleSaveProviderAuth(provider: string, apiKey: string | null) {
    const providerLabel = getProviderLabel(provider)

    try {
      setIsSavingAuth(true)
      setPanelError(null)
      const nextState = await window.appApi.updateAgentProviderAuth(workspacePath, provider, apiKey)
      onAgentStateChange(nextState)
      setAuthDrafts((currentValue) => ({
        ...currentValue,
        [provider]: '',
      }))
      onStatusMessage(apiKey?.trim()
        ? `${providerLabel} 密钥已更新`
        : `${providerLabel} 密钥已移除`)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '无法更新服务提供商认证信息。')
    } finally {
      setIsSavingAuth(false)
    }
  }

  async function handleLoginProviderAuth(provider: string) {
    const providerLabel = getProviderLabel(provider)

    try {
      isAuthCancelingRef.current = false
      setIsSavingAuth(true)
      setPanelError(null)
      setAuthFlow({
        authUrl: null,
        instructions: null,
        progress: [],
        prompt: null,
        promptDraft: '',
        provider,
      })
      const nextState = await window.appApi.loginAgentProviderAuth(workspacePath, provider)
      onAgentStateChange(nextState)
      setAuthFlow(null)
      onStatusMessage(`${providerLabel} 登录已完成`)
    } catch (error) {
      if (isAuthCancelingRef.current || isProviderAuthCancelError(error)) {
        setAuthFlow(null)
        return
      }

      setPanelError(error instanceof Error ? error.message : '无法完成订阅登录。')
    } finally {
      isAuthCancelingRef.current = false
      setIsSavingAuth(false)
    }
  }

  async function handleLogoutProviderAuth(provider: string) {
    const providerLabel = getProviderLabel(provider)

    try {
      setIsSavingAuth(true)
      setPanelError(null)
      const nextState = await window.appApi.logoutAgentProviderAuth(workspacePath, provider)
      onAgentStateChange(nextState)
      onStatusMessage(`${providerLabel} 登录已退出`)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '无法退出订阅登录。')
    } finally {
      setIsSavingAuth(false)
    }
  }

  async function handleSubmitAuthPrompt() {
    if (!authFlow?.prompt) {
      return
    }

    const prompt = authFlow.prompt
    const value = prompt.allowEmpty ? authFlow.promptDraft : authFlow.promptDraft.trim()
    if (!prompt.allowEmpty && !value) {
      return
    }

    try {
      await window.appApi.respondAgentProviderAuthPrompt(prompt.requestId, value)
      setAuthFlow((currentValue) => currentValue?.prompt?.requestId === prompt.requestId
        ? {
            ...currentValue,
            prompt: null,
            promptDraft: '',
          }
        : currentValue)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '无法提交登录信息。')
    }
  }

  async function handleCancelAuthFlow() {
    if (!authFlow?.provider) {
      return
    }

    isAuthCancelingRef.current = true
    try {
      await window.appApi.cancelAgentProviderAuth(authFlow.provider)
      setAuthFlow(null)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '无法取消登录。')
    } finally {
      setIsSavingAuth(false)
    }
  }

  function commitMeoImageFolderDraft() {
    updateMeoSettings({ imageFolder: meoImageFolderDraft })
  }

  function renderAppearanceSection() {
    return (
      <div className='settings-card'>
        <div className='settings-theme-switcher'>
          <div className='settings-field'>
            <span className='settings-field-label'>主题模式</span>
            <div className='settings-tabs-wrapper heroui-tabs-fix'>
              <Tabs
                selectedKey={theme}
                onSelectionChange={(key) => setTheme(key as 'light' | 'dark' | 'auto')}
                variant='primary'
                className='w-full'
              >
                <Tabs.ListContainer className='w-full'>
                  <Tabs.List aria-label='主题模式' className='w-full'>
                    <Tabs.Tab id='light' className='flex-1'>
                      浅色
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id='dark' className='flex-1'>
                      深色
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id='auto' className='flex-1'>
                      跟随系统
                      <Tabs.Indicator />
                    </Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>
            </div>
          </div>

          <div className='settings-field' style={{ marginTop: '24px' }}>
            <div className='settings-copy-block'>
              <h4>文件图标主题</h4>
              <p>控制文件树与工作区中的图标显示样式。</p>
            </div>
            <div className='settings-inline-form' style={{ display: 'flex', alignItems: 'center' }}>
              <Select
                aria-label='文件图标主题'
                className='flex-1 heroui-select-fix'
                selectedKey={activeIconThemeKey}
                onSelectionChange={(value) => {
                  if (value === null) {
                    return
                  }

                  const selectedOption = iconThemeOptions.find((option) => option.key === String(value))

                  if (selectedOption) {
                    void onSelectIconTheme({
                      sourceVsixPath: selectedOption.sourceVsixPath,
                      themeId: selectedOption.themeId,
                    })
                  }
                }}
                placeholder='选择文件图标主题'
                isDisabled={isIconThemeBusy || iconThemeOptions.length === 0}
              >
                <Select.Trigger className='settings-select-trigger'>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover className='settings-select-popover'>
                  <ListBox>
                    {iconThemeOptions.map((option) => (
                      <ListBox.Item key={option.key} id={option.key} textValue={option.label}>
                        {option.label}
                        <ListBox.ItemIndicator />
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
          </div>

        </div>
      </div>
    )
  }

  function renderEditorSection() {
    return (
      <div className='settings-card'>
        <div className='settings-field'>
          <div className='settings-copy-block'>
            <h4>Markdown 编辑器</h4>
            <p>配置默认 Markdown 编辑器的侧栏、Git 高亮与资源目录行为。</p>
          </div>

          <div className='settings-inline-form' style={{ marginTop: '12px' }}>
            <div className='settings-field settings-field-grow'>
              <span className='settings-field-label'>大纲位置</span>
              <Select
                aria-label='大纲位置'
                className='settings-field-grow heroui-select-fix'
                selectedKey={meo.outlinePosition}
                onSelectionChange={(value) => {
                  const nextValue = String(value)
                  if (nextValue === 'left' || nextValue === 'right') {
                    updateMeoSettings({ outlinePosition: nextValue })
                  }
                }}
              >
                <Select.Trigger className='settings-select-trigger'>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover className='settings-select-popover'>
                  <ListBox>
                    <ListBox.Item key='right' id='right' textValue='右侧'>
                      右侧
                    </ListBox.Item>
                    <ListBox.Item key='left' id='left' textValue='左侧'>
                      左侧
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>

            <div className='settings-field settings-field-grow settings-switch-row'>
              <span className='settings-field-label'>Git 行级高亮（Source 专用）</span>
              <Switch
                aria-label='Git 行级高亮'
                className='settings-switch-control'
                isSelected={meo.gitDiffLineHighlights}
                onChange={(isSelected) => {
                  updateMeoSettings({ gitDiffLineHighlights: isSelected })
                }}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>

            <div className='settings-field settings-field-grow settings-switch-row'>
              <span className='settings-field-label'>聚焦行高亮</span>
              <Switch
                aria-label='聚焦行高亮'
                className='settings-switch-control'
                isSelected={meo.focusedLineHighlight}
                onChange={(isSelected) => {
                  updateMeoSettings({ focusedLineHighlight: isSelected })
                }}
              >
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
              </Switch>
            </div>
          </div>

          <div className='settings-inline-form' style={{ marginTop: '12px' }}>
            <div className='settings-field settings-field-grow'>
              <span className='settings-field-label'>图片保存目录</span>
              <Input
                aria-label='编辑器图片保存目录'
                className='settings-field-grow'
                onChange={(event) => {
                  setMeoImageFolderDraft(event.target.value)
                }}
                onBlur={commitMeoImageFolderDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitMeoImageFolderDraft()
                  }
                }}
                placeholder='assets'
                value={meoImageFolderDraft}
                variant='secondary'
              />
              <p className='settings-inline-hint'>
                相对于工作区根目录。留空或无效值会回退到 <code>assets</code>。
              </p>
            </div>

          </div>
        </div>
      </div>
    )
  }

  function renderConversationSection() {
    const defaultBehavior = agent.runningPromptEnterBehavior
    const alternateBehavior = getAlternateRunningPromptBehavior(defaultBehavior)
    const modifierKey = window.appApi.platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter'

    return (
      <div className='settings-card'>
        <div className='settings-field'>
          <div className='settings-copy-block'>
            <h4>跟进行为</h4>
            <p>
              Agent 运行中发送后续消息时，可以加入队列，或引导当前运行。{modifierKey} 会执行与 Enter 相反的操作。
            </p>
          </div>

          <div className='settings-tabs-wrapper heroui-tabs-fix settings-running-behavior-tabs'>
            <Tabs
              selectedKey={defaultBehavior}
              onSelectionChange={(key) => {
                const nextBehavior = String(key)
                if (isAgentRunningPromptEnterBehavior(nextBehavior)) {
                  updateAgentSettings({ runningPromptEnterBehavior: nextBehavior })
                }
              }}
              variant='primary'
              className='w-full'
            >
              <Tabs.ListContainer className='w-full'>
                <Tabs.List aria-label='运行中 Enter 默认行为' className='w-full'>
                  <Tabs.Tab id='followUp' className='flex-1'>
                    排队
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id='steer' className='flex-1'>
                    引导
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </div>

          <p className='settings-inline-hint'>
            运行中按 Enter 将执行{AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[defaultBehavior]}，按 {modifierKey} 将执行{AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS[alternateBehavior]}。输入框为空时发送按钮会变为停止按钮。
          </p>
        </div>
      </div>
    )
  }

  function renderProvidersSection() {
    const activeAuthProviderLabel = authFlow ? getProviderLabel(authFlow.provider) : ''
    const activeGroupMeta = AUTH_PROVIDER_GROUPS.find(g => g.category === activeCategory)

    return (
      <div className='settings-providers-section flex flex-col gap-3 flex-1 min-h-0 overflow-hidden'>
        {authFlow && (
          <section className='settings-provider-auth-flow p-5 rounded-2xl border border-blue-500/20 bg-blue-500/5 flex flex-col gap-4 relative overflow-hidden'>
            <div className='absolute top-0 right-0 w-24 h-24 bg-blue-500/10 rounded-full blur-2xl -mr-8 -mt-8' />
            
            <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
              <div className='flex items-center gap-3'>
                <div className='flex items-center justify-center w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 flex-shrink-0'>
                  <Icon icon='mingcute:loading-3-line' className='w-5 h-5 animate-spin' />
                </div>
                <div className='flex flex-col min-w-0'>
                  <span className='text-sm font-semibold text-foreground truncate'>{activeAuthProviderLabel} 登录中</span>
                  {authFlow.instructions && (
                    <span className='text-xs text-muted mt-1 leading-relaxed'>{authFlow.instructions}</span>
                  )}
                </div>
              </div>
              
              <div className='flex gap-2 flex-shrink-0'>
                {authFlow.authUrl && (
                  <Button
                    size='sm'
                    variant='primary'
                    className='settings-action-button gap-2'
                    onPress={() => void window.appApi.openExternalLink(authFlow.authUrl!)}
                  >
                    <Icon icon='mingcute:external-link-line' className='w-3.5 h-3.5' />
                    打开登录页
                  </Button>
                )}
                <Button
                  size='sm'
                  variant='ghost'
                  className='settings-action-button gap-2'
                  onPress={() => void handleCancelAuthFlow()}
                >
                  <Icon icon='mingcute:close-circle-line' className='w-3.5 h-3.5' />
                  取消登录
                </Button>
              </div>
            </div>

            {authFlow.prompt && (
              <form
                className='settings-provider-prompt-form flex flex-col gap-3 p-4 rounded-xl bg-surface/60 border border-border/40 mt-2'
                onSubmit={(event) => {
                  event.preventDefault()
                  void handleSubmitAuthPrompt()
                }}
              >
                <label className='text-xs font-semibold text-foreground/80'>{authFlow.prompt.message}</label>
                <div className='flex items-center gap-2'>
                  <Input
                    aria-label={authFlow.prompt.message}
                    className='settings-provider-input flex-1'
                    autoFocus
                    onChange={(event) => {
                      setAuthFlow((currentValue) => currentValue
                        ? { ...currentValue, promptDraft: event.target.value }
                        : currentValue)
                    }}
                    placeholder={authFlow.prompt.placeholder || '输入凭据'}
                    value={authFlow.promptDraft}
                    variant='secondary'
                  />
                  <Button
                    isDisabled={!authFlow.prompt.allowEmpty && !authFlow.promptDraft.trim()}
                    size='sm'
                    type='submit'
                    variant='primary'
                    className='settings-action-button'
                  >
                    提交
                  </Button>
                </div>
              </form>
            )}

            {authFlow.progress.length > 0 && (
              <div className='settings-provider-progress flex flex-col gap-1.5 p-3 rounded-xl bg-surface/30 border border-border/20 text-xs text-muted font-mono mt-1'>
                <div className='text-[10px] text-muted-foreground uppercase font-sans font-semibold tracking-wider border-b border-border/20 pb-1 mb-1'>连接日志</div>
                {authFlow.progress.slice(-4).map((message, index) => (
                  <div key={`${message}-${index}`} className='flex items-center gap-1.5'>
                    <span className='w-1 h-1 rounded-full bg-blue-500/70' />
                    <span>{message}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <div className='settings-providers-toolbar flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
          <div className='settings-tabs-wrapper heroui-tabs-fix flex-1 max-w-sm'>
            <Tabs
              selectedKey={activeCategory}
              onSelectionChange={(key) => {
                setActiveCategory(key as AgentProviderCategory)
                setExpandedProvider(null)
              }}
              variant='primary'
              className='w-full'
            >
              <Tabs.ListContainer className='w-full'>
                <Tabs.List aria-label='AI服务提供商类别' className='w-full'>
                  <Tabs.Tab id='subscription' className='flex-1'>
                    订阅服务
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id='api_key' className='flex-1'>
                    API 密钥
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id='cloud' className='flex-1'>
                    云厂商
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>
          </div>
          
          <div className='settings-search-wrapper relative w-full sm:w-56 flex items-center'>
            <span className='absolute left-3 text-muted flex items-center justify-center pointer-events-none z-10'>
              <Icon icon="mingcute:search-line" className="w-4 h-4" />
            </span>
            <Input
              aria-label="搜索提供商"
              placeholder="搜索提供商..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              variant="secondary"
              className="w-full"
            />
          </div>
        </div>

        <AppScrollArea className='flex-1 min-h-0' contentClassName='pr-2 pb-6'>
          <div className='flex flex-col gap-3'>
            {activeGroupMeta && (
              <div className='settings-providers-group-desc p-3.5 rounded-xl border border-border/40 bg-surface-secondary/40'>
                <p className='text-xs text-muted leading-relaxed'>{activeGroupMeta.description}</p>
              </div>
            )}

            {filteredProviders.length > 0 ? (
              <div className='provider-card-list'>
                {filteredProviders.map((provider) => {
                  const status = getProviderStatus(provider, activeCategory)
                  const isExpanded = expandedProvider === provider.key
                  const draftValue = authDrafts[provider.key] ?? ''
                  const hasStoredApiKey = provider.state.storedCredentialType === 'api_key'
                  const hasStoredOAuth = provider.state.storedCredentialType === 'oauth'
                  const isBusy = isSavingAuth || authFlow?.provider === provider.key
                  const showsOAuthActions = provider.groupCategory === 'subscription' && provider.supportsOAuth
                  const showsApiKeyActions = provider.groupCategory !== 'subscription' && provider.supportsApiKey
                  const canClearStoredCredential = (
                    (showsOAuthActions && hasStoredOAuth)
                    || (showsApiKeyActions && hasStoredApiKey)
                  )
                  const showPassword = showPasswords[provider.key] ?? false

                  return (
                    <div
                      key={provider.key}
                      className={`provider-card flex flex-col rounded-2xl border transition-all duration-200 bg-surface-secondary/30 ${
                        isExpanded 
                          ? 'border-accent shadow-lg shadow-accent/5 ring-1 ring-accent/10' 
                          : 'border-border/60 hover:border-border-hover hover:bg-surface-secondary/60 hover:shadow-md'
                      }`}
                    >
                      <button
                        type='button'
                        onClick={() => setExpandedProvider(isExpanded ? null : provider.key)}
                        className='provider-card-header flex items-center justify-between p-4 w-full text-left font-inherit outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-t-2xl'
                      >
                        <div className='flex items-center gap-3 min-w-0'>
                          <div className='flex-shrink-0'>
                            {renderProviderLobeIcon(provider.key, 18)}
                          </div>
                          
                          <div className='flex flex-col min-w-0'>
                            <span className='provider-title text-sm font-semibold text-foreground truncate'>
                              {provider.label}
                            </span>
                          </div>
                        </div>
                        
                        <div className='flex items-center gap-2 flex-shrink-0'>
                          <span className={`provider-status-badge text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1.5 ${
                            status.color === 'emerald' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                            status.color === 'amber' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20' :
                            status.color === 'blue' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                            'bg-muted-foreground/15 text-muted border border-border/40'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              status.color === 'emerald' ? 'bg-emerald-500' :
                              status.color === 'amber' ? 'bg-amber-500' :
                              status.color === 'blue' ? 'bg-blue-500' :
                              'bg-current opacity-60'
                            }`} />
                            {status.label}
                          </span>
                          
                          <Icon
                            icon='mingcute:down-line'
                            className={`w-4 h-4 text-muted transition-transform duration-200 ${
                              isExpanded ? 'rotate-180 text-foreground' : ''
                            }`}
                          />
                        </div>
                      </button>

                      <div className={`provider-card-details-wrapper ${isExpanded ? 'is-expanded' : ''}`}>
                        <div className='provider-card-details-inner'>
                          <div className='p-4 pt-0 border-t border-border/40 bg-surface-secondary/10 flex flex-col gap-4'>
                            <div className='provider-meta-info flex flex-col gap-2 mt-3'>
                              <div className='text-xs text-foreground/80 leading-relaxed bg-surface/50 p-3 rounded-xl border border-border/30'>
                                <p className='font-medium text-foreground mb-1'>当前配置状态：</p>
                                <p className='text-muted'>{getProviderMeta(provider)}</p>
                              </div>
                              
                              {provider.setupHint && (
                                <div className='provider-setup-hint flex gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-500/5 p-3 rounded-xl border border-blue-500/15'>
                                  <Icon icon='mingcute:information-line' className='w-4 h-4 flex-shrink-0 mt-0.5' />
                                  <span>{provider.setupHint}</span>
                                </div>
                              )}
                            </div>

                            {showsApiKeyActions && (
                              <div className='provider-apikey-form flex flex-col gap-2'>
                                <label className='text-xs font-semibold text-foreground/80'>配置 API 密钥</label>
                                <div className='relative flex items-center w-full provider-apikey-input-container'>
                                  <span className='absolute left-3 text-muted pointer-events-none flex items-center justify-center z-20'>
                                    <Icon icon='mingcute:key-2-line' className='w-4 h-4' />
                                  </span>
                                  <Input
                                    aria-label={`${provider.label} API key`}
                                    className='settings-provider-input w-full'
                                    disabled={isBusy}
                                    onChange={(event) => setAuthDrafts((prev) => ({ ...prev, [provider.key]: event.target.value }))}
                                    placeholder={provider.placeholder || '输入 API 密钥'}
                                    type={showPassword ? 'text' : 'password'}
                                    value={draftValue}
                                    variant='secondary'
                                  />
                                  <button
                                    type='button'
                                    disabled={isBusy}
                                    onClick={() => setShowPasswords(prev => ({ ...prev, [provider.key]: !showPassword }))}
                                    className='absolute right-3 text-muted hover:text-foreground cursor-pointer transition-colors focus:outline-none flex items-center justify-center z-10'
                                  >
                                    <Icon
                                      icon={showPassword ? 'mingcute:eye-line' : 'mingcute:eye-close-line'}
                                      className='w-4 h-4'
                                    />
                                  </button>
                                </div>
                              </div>
                            )}

                            <div className='provider-actions flex flex-wrap gap-2 mt-1 justify-end'>
                              {showsOAuthActions && (
                                <Button
                                  isDisabled={isBusy}
                                  size='sm'
                                  variant='primary'
                                  className='settings-action-button font-medium gap-2'
                                  onPress={() => void handleLoginProviderAuth(provider.key)}
                                >
                                  <Icon icon='mingcute:entrance-line' className='w-4 h-4' />
                                  {hasStoredOAuth ? '重新登录' : '订阅登录'}
                                </Button>
                              )}
                              
                              {showsApiKeyActions && (
                                <Button
                                  isDisabled={isBusy || !draftValue.trim()}
                                  size='sm'
                                  variant='primary'
                                  className='settings-action-button font-medium gap-2'
                                  onPress={() => void handleSaveProviderAuth(provider.key, draftValue)}
                                >
                                  <Icon icon='mingcute:check-line' className='w-4 h-4' />
                                  保存密钥
                                </Button>
                              )}

                              {(showsOAuthActions || showsApiKeyActions) && (
                                <Button
                                  isDisabled={isBusy || !canClearStoredCredential}
                                  size='sm'
                                  variant='ghost'
                                  className='settings-action-button font-medium text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 gap-2'
                                  onPress={() => void (showsOAuthActions
                                    ? handleLogoutProviderAuth(provider.key)
                                    : handleSaveProviderAuth(provider.key, null))}
                                >
                                  <Icon icon={showsOAuthActions ? 'mingcute:exit-line' : 'mingcute:delete-2-line'} className='w-4 h-4' />
                                  {showsOAuthActions ? '退出登录' : '清除密钥'}
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className='settings-empty-state flex flex-col items-center justify-center p-12 text-center border border-dashed border-border rounded-xl bg-surface-secondary/20'>
                <Icon icon="mingcute:empty-box-line" className="w-12 h-12 text-muted mb-3" />
                <p className="text-sm text-muted">未找到匹配的AI服务提供商</p>
              </div>
            )}
          </div>
        </AppScrollArea>
      </div>
    )
  }

  return (
    <div className={`settings-page ${resolvedTheme === 'dark' ? 'dark theme-dark' : 'theme-light'}`}>
      <aside className='settings-sidebar'>
        <div className='settings-sidebar-header'>
          <h2 className='settings-sidebar-title'>设置</h2>
        </div>

        <nav className='settings-nav' aria-label='设置分区'>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type='button'
              className={`settings-nav-item ${section.id === activeSection ? 'is-active' : ''}`}
              onClick={() => onSectionChange(section.id)}
            >
              <span className='settings-nav-label'>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className='settings-panel'>
        <div className='settings-panel-header'>
          <h3 className='settings-panel-title'>{getSectionTitle(activeSection)}</h3>
        </div>

        <div className='flex-1 min-h-0 flex flex-col overflow-hidden'>
          {panelError && <div className='settings-alert settings-alert-error mx-8 mt-4'>{panelError}</div>}

          {activeSection === 'appearance' ? (
            <AppScrollArea className='settings-panel-content' contentClassName='settings-panel-content-inner'>
              {renderAppearanceSection()}
            </AppScrollArea>
          ) : null}
          {activeSection === 'conversation' ? (
            <AppScrollArea className='settings-panel-content' contentClassName='settings-panel-content-inner'>
              {renderConversationSection()}
            </AppScrollArea>
          ) : null}
          {activeSection === 'editor' ? (
            <AppScrollArea className='settings-panel-content' contentClassName='settings-panel-content-inner'>
              {renderEditorSection()}
            </AppScrollArea>
          ) : null}
          {activeSection === 'providers' ? (
            <div className='settings-panel-content flex-1 min-h-0' style={{ padding: '20px 32px 0px', gap: '0' }}>
              {renderProvidersSection()}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

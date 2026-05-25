import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, ListBox, Select, Switch, Tabs } from '@heroui/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import {
  AGENT_PROVIDER_AUTH_CONFIGS,
  type AgentProviderCategory,
  type AgentProviderAuthConfig,
} from '@/features/agent/provider-auth'
import type { AgentProviderAuthState, AgentProviderAuthUiEvent, AgentWorkspaceState } from '@/features/agent/types'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '@/features/workspace/types'
import { useSettingsStore } from '@/hooks/use-settings-store'

export type SettingsSectionId = 'appearance' | 'editor' | 'providers'

type SettingsViewProps = {
  activeSection: SettingsSectionId
  agentState: AgentWorkspaceState | null
  iconTheme: WorkspaceIconTheme | null
  iconThemeOptions: WorkspaceIconThemeCatalogOption[]
  isIconThemeBusy: boolean
  onAgentStateChange: (state: AgentWorkspaceState) => void
  onImportIconTheme: () => Promise<void>
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

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function getSectionTitle(section: SettingsSectionId) {
  switch (section) {
    case 'appearance':
      return '外观'
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

export function SettingsDialog({
  activeSection,
  agentState,
  iconTheme,
  iconThemeOptions,
  isIconThemeBusy,
  onAgentStateChange,
  onImportIconTheme,
  onSectionChange,
  onSelectIconTheme,
  onStatusMessage,
  resolvedTheme,
  workspacePath,
}: SettingsViewProps) {
  const { layoutPreference, meo, theme, setLayoutPreference, setTheme, updateMeoSettings } = useSettingsStore()
  const [authDrafts, setAuthDrafts] = useState<Record<string, string>>({})
  const [authFlow, setAuthFlow] = useState<ProviderAuthFlowState | null>(null)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [meoImageFolderDraft, setMeoImageFolderDraft] = useState(meo.imageFolder)
  const [panelError, setPanelError] = useState<string | null>(null)
  const activeAuthProviderRef = useRef<string | null>(null)
  const isAuthCancelingRef = useRef(false)
  const pendingAuthPromptIdRef = useRef<string | null>(null)

  useEffect(() => {
    setMeoImageFolderDraft(meo.imageFolder)
  }, [meo.imageFolder])

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

  const activeIconThemeKey = iconTheme
    ? `${iconTheme.sourceVsixPath}::${iconTheme.activeThemeId}`
    : ''

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
    if (!workspacePath) {
      return
    }

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
    if (!workspacePath) {
      return
    }

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
    if (!workspacePath) {
      return
    }

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
              <h4>布局模式</h4>
              <p>选择主界面以编辑器为中心，或以 Agent 会话为中心。</p>
            </div>
            <div className='settings-tabs-wrapper heroui-tabs-fix' style={{ marginTop: '12px' }}>
              <Tabs
                selectedKey={layoutPreference}
                onSelectionChange={(key) => setLayoutPreference(key as 'editor' | 'agent')}
                variant='primary'
                className='w-full'
              >
                <Tabs.ListContainer className='w-full'>
                  <Tabs.List aria-label='布局模式' className='w-full'>
                    <Tabs.Tab id='agent' className='flex-1'>
                      Agent
                      <Tabs.Indicator />
                    </Tabs.Tab>
                    <Tabs.Tab id='editor' className='flex-1'>
                      Editor
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
            <div className='settings-inline-form' style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <Select
                className='flex-1 heroui-select-fix'
                selectedKey={activeIconThemeKey}
                onSelectionChange={(value) => {
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
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
              <Button
                isDisabled={isIconThemeBusy}
                variant='primary'
                className='settings-action-button h-10'
                onPress={() => void onImportIconTheme()}
              >
                导入 VSIX
              </Button>
            </div>
            {iconTheme && (
              <p className='settings-inline-hint' style={{ marginTop: '8px' }}>
                当前使用：{iconTheme.activeThemeLabel} / {getBaseName(iconTheme.sourceVsixPath)}
              </p>
            )}
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

  function renderProvidersSection() {
    const activeAuthProviderLabel = authFlow ? getProviderLabel(authFlow.provider) : ''

    return (
      <div className='settings-card'>
        {workspacePath ? (
          <>
            {authFlow && (
              <section className='settings-provider-auth-flow'>
                <div>
                  <span className='settings-provider-label'>{activeAuthProviderLabel} 登录</span>
                  {authFlow.instructions && (
                    <span className='settings-provider-meta'>{authFlow.instructions}</span>
                  )}
                </div>
                <div className='settings-provider-actions'>
                  {authFlow.authUrl && (
                    <Button
                      size='sm'
                      variant='ghost'
                      className='settings-action-button'
                      onPress={() => void window.appApi.openExternalLink(authFlow.authUrl!)}
                    >
                      打开登录页
                    </Button>
                  )}
                  <Button
                    size='sm'
                    variant='ghost'
                    className='settings-action-button'
                    onPress={() => void handleCancelAuthFlow()}
                  >
                    取消登录
                  </Button>
                </div>
                {authFlow.prompt && (
                  <form
                    className='settings-provider-prompt-form'
                    onSubmit={(event) => {
                      event.preventDefault()
                      void handleSubmitAuthPrompt()
                    }}
                  >
                    <Input
                      aria-label={authFlow.prompt.message}
                      className='settings-provider-input'
                      autoFocus
                      onChange={(event) => {
                        setAuthFlow((currentValue) => currentValue
                          ? { ...currentValue, promptDraft: event.target.value }
                          : currentValue)
                      }}
                      placeholder={authFlow.prompt.placeholder}
                      value={authFlow.promptDraft}
                      variant='secondary'
                    />
                    <div className='settings-provider-actions'>
                      <Button
                        isDisabled={!authFlow.prompt.allowEmpty && !authFlow.promptDraft.trim()}
                        size='sm'
                        type='submit'
                        variant='ghost'
                        className='settings-action-button'
                      >
                        提交
                      </Button>
                    </div>
                    <span className='settings-provider-meta'>{authFlow.prompt.message}</span>
                  </form>
                )}
                {authFlow.progress.length > 0 && (
                  <div className='settings-provider-progress'>
                    {authFlow.progress.slice(-4).map((message, index) => (
                      <span key={`${message}-${index}`}>{message}</span>
                    ))}
                  </div>
                )}
              </section>
            )}

            <div className='settings-provider-groups'>
              {authProviderGroups.map((group) => (
                <section key={group.category} className='settings-provider-group'>
                  <div className='settings-provider-group-header'>
                    <span className='settings-provider-group-label'>{group.label}</span>
                    <span className='settings-provider-meta'>{group.description}</span>
                  </div>
                  <div className='settings-provider-list'>
                    {group.providers.map((provider) => {
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

                      return (
                        <section key={provider.key} className='settings-provider-card'>
                          <div>
                            <span className='settings-provider-label'>{provider.label}</span>
                            <span className='settings-provider-meta'>{getProviderMeta(provider)}</span>
                            {provider.setupHint && (
                              <span className='settings-provider-meta'>{provider.setupHint}</span>
                            )}
                          </div>
                          {showsApiKeyActions && (
                            <Input
                              aria-label={`${provider.label} API key`}
                              className='settings-provider-input'
                              disabled={isBusy}
                              onChange={(event) => setAuthDrafts((prev) => ({ ...prev, [provider.key]: event.target.value }))}
                              placeholder={provider.placeholder}
                              type='password'
                              value={draftValue}
                              variant='secondary'
                            />
                          )}
                          <div className='settings-provider-actions'>
                            {showsOAuthActions && (
                              <Button
                                isDisabled={isBusy}
                                size='sm'
                                variant='ghost'
                                className='settings-action-button'
                                onPress={() => void handleLoginProviderAuth(provider.key)}
                              >
                                {hasStoredOAuth ? '重新登录订阅' : '登录订阅'}
                              </Button>
                            )}
                            {showsApiKeyActions && (
                              <Button
                                isDisabled={isBusy || !draftValue.trim()}
                                size='sm'
                                variant='ghost'
                                className='settings-action-button'
                                onPress={() => void handleSaveProviderAuth(provider.key, draftValue)}
                              >
                                保存密钥
                              </Button>
                            )}
                            {(showsOAuthActions || showsApiKeyActions) && (
                              <Button
                                isDisabled={isBusy || !canClearStoredCredential}
                                size='sm'
                                variant='ghost'
                                className='settings-action-button'
                                onPress={() => void (showsOAuthActions
                                  ? handleLogoutProviderAuth(provider.key)
                                  : handleSaveProviderAuth(provider.key, null))}
                              >
                                {showsOAuthActions ? '退出订阅登录' : '移除已保存密钥'}
                              </Button>
                            )}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        ) : (
          <div className='settings-empty-state'>
            请先打开一个工作区。服务提供商配置依赖当前活动工作区上下文。
          </div>
        )}
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

        <AppScrollArea
          className='settings-panel-content'
          contentClassName='settings-panel-content-inner'
        >
          {panelError && <div className='settings-alert settings-alert-error'>{panelError}</div>}

          {activeSection === 'appearance' ? renderAppearanceSection() : null}
          {activeSection === 'editor' ? renderEditorSection() : null}
          {activeSection === 'providers' ? renderProvidersSection() : null}
        </AppScrollArea>
      </section>
    </div>
  )
}

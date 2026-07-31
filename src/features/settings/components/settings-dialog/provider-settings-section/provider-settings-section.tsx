import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Tabs } from '@heroui/react'
import { Icon } from '@iconify/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import type { AgentProviderCategory } from '@/features/agent/provider-auth'
import type { AgentWorkspaceState } from '@/features/agent/types'
import { ProviderAuthFlowPanel } from './provider-auth-flow-panel'
import { ProviderCard } from './provider-card'
import {
  AUTH_PROVIDER_GROUPS,
  buildAuthProviderGroups,
  buildAuthProviderViewModels,
  filterAuthProviders,
  getProviderLabel,
  isProviderAuthCancelError,
  type ProviderAuthFlowState,
} from './provider-settings-model'
import './styles.css'

type ProviderSettingsSectionProps = {
  agentState: AgentWorkspaceState | null
  isActive: boolean
  onAgentStateChange: (state: AgentWorkspaceState) => void
  onStatusMessage: (message: string) => void
  workspacePath: string | null
}

export function ProviderSettingsSection({
  agentState,
  isActive,
  onAgentStateChange,
  onStatusMessage,
  workspacePath,
}: ProviderSettingsSectionProps) {
  const [activeCategory, setActiveCategory] = useState<AgentProviderCategory>('subscription')
  const [authDrafts, setAuthDrafts] = useState<Record<string, string>>({})
  const [authFlow, setAuthFlow] = useState<ProviderAuthFlowState | null>(null)
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({})
  const activeAuthProviderRef = useRef<string | null>(null)
  const isAuthCancelingRef = useRef(false)
  const pendingAuthPromptIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!isActive || workspacePath) {
      return
    }

    let isDisposed = false

    void window.appApi.loadAgentDraftState('builtin-pi')
      .then((nextState) => {
        if (!isDisposed) {
          onAgentStateChange(nextState)
        }
      })
      .catch((error) => {
        if (!isDisposed) {
          setPanelError(error instanceof Error
            ? error.message
            : 'Unable to load provider settings.')
        }
      })

    return () => {
      isDisposed = true
    }
  }, [isActive, onAgentStateChange, workspacePath])

  const authProviders = useMemo(
    () => buildAuthProviderViewModels(agentState),
    [agentState],
  )
  const authProviderGroups = useMemo(
    () => buildAuthProviderGroups(authProviders),
    [authProviders],
  )
  const activeProviderGroup = authProviderGroups.find(
    (group) => group.category === activeCategory,
  )
  const filteredProviders = useMemo(
    () => filterAuthProviders(activeProviderGroup?.providers ?? [], searchQuery),
    [activeProviderGroup?.providers, searchQuery],
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

  useEffect(() => (
    window.appApi.onAgentProviderAuthUiEvent((event) => {
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
            progress: currentValue?.provider === event.provider
              ? currentValue.progress
              : [],
            prompt: currentValue?.provider === event.provider
              ? currentValue.prompt
              : null,
            promptDraft: currentValue?.provider === event.provider
              ? currentValue.promptDraft
              : '',
            provider: event.provider,
          }
        }

        if (event.type === 'progress') {
          return {
            authUrl: currentValue?.provider === event.provider
              ? currentValue.authUrl
              : null,
            instructions: currentValue?.provider === event.provider
              ? currentValue.instructions
              : null,
            progress: [
              ...(currentValue?.provider === event.provider
                ? currentValue.progress
                : []),
              event.message,
            ],
            prompt: currentValue?.provider === event.provider
              ? currentValue.prompt
              : null,
            promptDraft: currentValue?.provider === event.provider
              ? currentValue.promptDraft
              : '',
            provider: event.provider,
          }
        }

        return {
          authUrl: currentValue?.provider === event.provider
            ? currentValue.authUrl
            : null,
          instructions: currentValue?.provider === event.provider
            ? currentValue.instructions
            : null,
          progress: currentValue?.provider === event.provider
            ? currentValue.progress
            : [],
          prompt: event,
          promptDraft: '',
          provider: event.provider,
        }
      })
    })
  ), [])

  async function handleSaveProviderAuth(
    provider: string,
    apiKey: string | null,
  ) {
    const providerLabel = getProviderLabel(provider)

    try {
      setIsSavingAuth(true)
      setPanelError(null)
      const nextState = await window.appApi.updateAgentProviderAuth(
        workspacePath,
        provider,
        apiKey,
      )
      onAgentStateChange(nextState)
      setAuthDrafts((currentValue) => ({
        ...currentValue,
        [provider]: '',
      }))
      onStatusMessage(apiKey?.trim()
        ? `${providerLabel} 密钥已更新`
        : `${providerLabel} 密钥已移除`)
    } catch (error) {
      setPanelError(error instanceof Error
        ? error.message
        : '无法更新服务提供商认证信息。')
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
      const nextState = await window.appApi.loginAgentProviderAuth(
        workspacePath,
        provider,
      )
      onAgentStateChange(nextState)
      setAuthFlow(null)
      onStatusMessage(`${providerLabel} 登录已完成`)
    } catch (error) {
      if (isAuthCancelingRef.current || isProviderAuthCancelError(error)) {
        setAuthFlow(null)
        return
      }

      setPanelError(error instanceof Error
        ? error.message
        : '无法完成订阅登录。')
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
      const nextState = await window.appApi.logoutAgentProviderAuth(
        workspacePath,
        provider,
      )
      onAgentStateChange(nextState)
      onStatusMessage(`${providerLabel} 登录已退出`)
    } catch (error) {
      setPanelError(error instanceof Error
        ? error.message
        : '无法退出订阅登录。')
    } finally {
      setIsSavingAuth(false)
    }
  }

  async function handleSubmitAuthPrompt() {
    if (!authFlow?.prompt) {
      return
    }

    const prompt = authFlow.prompt
    const value = prompt.allowEmpty
      ? authFlow.promptDraft
      : authFlow.promptDraft.trim()

    if (!prompt.allowEmpty && !value) {
      return
    }

    try {
      await window.appApi.respondAgentProviderAuthPrompt(prompt.requestId, value)
      setAuthFlow((currentValue) => (
        currentValue?.prompt?.requestId === prompt.requestId
          ? {
              ...currentValue,
              prompt: null,
              promptDraft: '',
            }
          : currentValue
      ))
    } catch (error) {
      setPanelError(error instanceof Error
        ? error.message
        : '无法提交登录信息。')
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
      setPanelError(error instanceof Error
        ? error.message
        : '无法取消登录。')
    } finally {
      setIsSavingAuth(false)
    }
  }

  return (
    <>
      {panelError ? (
        <div className='settings-alert settings-alert-error mx-8 mt-4'>
          {panelError}
        </div>
      ) : null}

      {isActive ? (
        <div className='settings-panel-content settings-providers-panel-content flex-1 min-h-0'>
          <div className='settings-providers-section flex flex-col gap-3 flex-1 min-h-0 overflow-hidden'>
            {authFlow ? (
              <ProviderAuthFlowPanel
                authFlow={authFlow}
                providerLabel={getProviderLabel(authFlow.provider)}
                onCancel={() => {
                  void handleCancelAuthFlow()
                }}
                onPromptDraftChange={(value) => {
                  setAuthFlow((currentValue) => (
                    currentValue
                      ? { ...currentValue, promptDraft: value }
                      : currentValue
                  ))
                }}
                onSubmitPrompt={() => {
                  void handleSubmitAuthPrompt()
                }}
              />
            ) : null}

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
                <span className='settings-secondary-icon absolute left-3 flex items-center justify-center pointer-events-none z-10'>
                  <Icon icon='mingcute:search-line' className='size-[var(--icon-size-md)]' />
                </span>
                <Input
                  aria-label='搜索提供商'
                  placeholder='搜索提供商…'
                  value={searchQuery}
                  onChange={(event) => {
                    setSearchQuery(event.target.value)
                  }}
                  variant='secondary'
                  className='w-full'
                />
              </div>
            </div>

            <AppScrollArea
              className='flex-1 min-h-0'
              contentClassName='pr-2 pb-6'
            >
              <div className='flex flex-col gap-3'>
                {activeProviderGroup ? (
                  <div className='settings-providers-group-desc'>
                    <p className='settings-group-desc-text'>
                      {activeProviderGroup.description}
                    </p>
                  </div>
                ) : null}

                {filteredProviders.length > 0 ? (
                  <div className='provider-card-list'>
                    {filteredProviders.map((provider) => (
                      <ProviderCard
                        key={provider.key}
                        activeCategory={activeCategory}
                        draftValue={authDrafts[provider.key] ?? ''}
                        isBusy={
                          isSavingAuth
                          || authFlow?.provider === provider.key
                        }
                        isExpanded={expandedProvider === provider.key}
                        provider={provider}
                        showPassword={showPasswords[provider.key] ?? false}
                        onDraftChange={(value) => {
                          setAuthDrafts((currentValue) => ({
                            ...currentValue,
                            [provider.key]: value,
                          }))
                        }}
                        onLogin={() => {
                          void handleLoginProviderAuth(provider.key)
                        }}
                        onLogout={() => {
                          void handleLogoutProviderAuth(provider.key)
                        }}
                        onSave={(apiKey) => {
                          void handleSaveProviderAuth(provider.key, apiKey)
                        }}
                        onShowPasswordChange={(showPassword) => {
                          setShowPasswords((currentValue) => ({
                            ...currentValue,
                            [provider.key]: showPassword,
                          }))
                        }}
                        onToggle={() => {
                          setExpandedProvider((currentValue) => (
                            currentValue === provider.key ? null : provider.key
                          ))
                        }}
                      />
                    ))}
                  </div>
                ) : (
                  <div className='settings-empty-state'>
                    <Icon
                      icon='mingcute:empty-box-line'
                      className='settings-secondary-icon size-[var(--icon-size-xl)] mb-3'
                    />
                    <p className='settings-secondary-text'>
                      未找到匹配的AI服务提供商
                    </p>
                  </div>
                )}
              </div>
            </AppScrollArea>
          </div>
        </div>
      ) : null}
    </>
  )
}

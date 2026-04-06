import { useEffect, useMemo, useState, useRef } from 'react'
import { Button, Input, Tabs, Select, ListBox } from '@heroui/react'
import { useSettingsStore } from '@/hooks/use-settings-store'
import type { AgentProviderAuthState, AgentWorkspaceState } from '@/features/agent/types'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '@/features/workspace/types'

export type SettingsSectionId = 'general' | 'providers'

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
  workspacePath: string | null
}

type AuthProviderKey = 'google' | 'openai' | 'openrouter'

const SETTINGS_SECTIONS: Array<{ description: string, id: SettingsSectionId, label: string }> = [
  {
    description: '应用的界面外观和行为。',
    id: 'general',
    label: '外观',
  },
  {
    description: '管理 Pi Agent 提供商的 API 密钥。',
    id: 'providers',
    label: '服务提供商',
  },
]

const EMPTY_AUTH_DRAFTS: Record<AuthProviderKey, string> = {
  google: '',
  openai: '',
  openrouter: '',
}

function getBaseName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function getProviderMeta(state: AgentProviderAuthState) {
  if (state.source === 'stored') {
    return '正在使用已保存的密钥'
  }

  if (state.source === 'env') {
    return `正在使用环境变量 ${state.envVarName}`
  }

  return `未保存密钥。环境变量 ${state.envVarName} 也可生效。`
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
  workspacePath,
}: SettingsViewProps) {
  const { theme, setTheme } = useSettingsStore()
  const [authDrafts, setAuthDrafts] = useState<Record<AuthProviderKey, string>>(EMPTY_AUTH_DRAFTS)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  // Resolve theme for portal context
  const resolvedTheme = useMemo(() => {
    if (theme === 'auto') {
      return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return theme
  }, [theme])

  // Track previous theme to prevent overriding manual selection
  const prevThemeRef = useRef(resolvedTheme);

  // Automatically switch icon theme ONLY when theme itself changes
  useEffect(() => {
    if (!workspacePath || isIconThemeBusy || iconThemeOptions.length === 0) return;

    // Only trigger if theme changed laterally
    if (prevThemeRef.current !== resolvedTheme) {
      const targetLabel = resolvedTheme === 'dark' ? 'flow dawn' : 'flow deep';
      const targetOption = iconThemeOptions.find(opt => 
        opt.label.toLowerCase().includes(targetLabel)
      );

      // DELAY THE HEAVY ICON WORK to let the main theme transition finish first
      const timer = setTimeout(() => {
        if (targetOption && (
          !iconTheme || 
          iconTheme.activeThemeId !== targetOption.themeId || 
          iconTheme.sourceVsixPath !== targetOption.sourceVsixPath
        )) {
          void onSelectIconTheme({
            sourceVsixPath: targetOption.sourceVsixPath,
            themeId: targetOption.themeId,
          });
        }
      }, 300);
      
      // Update ref immediately to prevent multiple triggers
      prevThemeRef.current = resolvedTheme;
      return () => clearTimeout(timer);
    }
  }, [resolvedTheme, iconThemeOptions, workspacePath, iconTheme, isIconThemeBusy, onSelectIconTheme]);

  const authProviders = useMemo(() => {
    const runtimeAuth = agentState?.runtime.auth

    return [
      {
        key: 'openrouter' as const,
        label: 'OpenRouter',
        placeholder: 'sk-or-v1-...',
        state: runtimeAuth?.openrouter ?? {
          envVarName: 'OPENROUTER_API_KEY',
          hasStoredCredential: false,
          source: 'none',
          usesEnvironmentCredential: false,
        },
      },
      {
        key: 'openai' as const,
        label: 'OpenAI',
        placeholder: 'sk-...',
        state: runtimeAuth?.openai ?? {
          envVarName: 'OPENAI_API_KEY',
          hasStoredCredential: false,
          source: 'none',
          usesEnvironmentCredential: false,
        },
      },
      {
        key: 'google' as const,
        label: 'Google Gemini',
        placeholder: 'API key',
        state: runtimeAuth?.google ?? {
          envVarName: 'GEMINI_API_KEY',
          hasStoredCredential: false,
          source: 'none',
          usesEnvironmentCredential: false,
        },
      },
    ]
  }, [agentState?.runtime.auth])

  const activeIconThemeKey = iconTheme
    ? `${iconTheme.sourceVsixPath}::${iconTheme.activeThemeId}`
    : ''

  async function handleSaveProviderAuth(provider: AuthProviderKey, apiKey: string | null) {
    if (!workspacePath) return

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
        ? `${provider} 密钥已更新`
        : `${provider} 密钥已移除`)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : '无法更新提供商身份验证。')
    } finally {
      setIsSavingAuth(false)
    }
  }

  return (
    <div className={`settings-page ${resolvedTheme === 'dark' ? 'dark theme-dark' : 'theme-light'}`}>
      <aside className='settings-sidebar'>
        <div className='settings-sidebar-header'>
          <h2 className='settings-sidebar-title'>设置</h2>
        </div>

        <nav className='settings-nav' aria-label='Settings sections'>
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type='button'
              className={`settings-nav-item ${section.id === activeSection ? 'is-active' : ''}`}
              onClick={() => onSectionChange(section.id as SettingsSectionId)}
            >
              <span className='settings-nav-label'>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className='settings-panel'>
        <div className='settings-panel-header'>
          <h3 className='settings-panel-title'>
            {activeSection === 'general' ? '外观' : '服务提供商'}
          </h3>
        </div>

        <div className='settings-panel-content'>
          {panelError && <div className='settings-alert settings-alert-error'>{panelError}</div>}

          {activeSection === 'general' ? (
            <div className='settings-card'>
              <div className='settings-theme-switcher'>
                <div className='settings-field'>
                  <span className='settings-field-label'>模式</span>
                  <div className='settings-tabs-wrapper heroui-tabs-fix'>
                    <Tabs 
                      selectedKey={theme} 
                      onSelectionChange={(key) => setTheme(key as 'light' | 'dark' | 'auto')}
                      variant="primary"
                      className="w-full"
                    >
                      <Tabs.ListContainer className="w-full">
                        <Tabs.List aria-label="主题配色" className="w-full">
                          <Tabs.Tab id="light" className="flex-1">
                            浅色
                            <Tabs.Indicator />
                          </Tabs.Tab>
                          <Tabs.Tab id="dark" className="flex-1">
                            深色
                            <Tabs.Indicator />
                          </Tabs.Tab>
                          <Tabs.Tab id="auto" className="flex-1">
                            跟随系统
                            <Tabs.Indicator />
                          </Tabs.Tab>
                        </Tabs.List>
                      </Tabs.ListContainer>
                    </Tabs>
                  </div>
                </div>

                <div className='settings-field' style={{ marginTop: '24px' }}>
                  <span className='settings-field-label'>图标主题</span>
                  <div className='settings-inline-form' style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <Select
                      className='flex-1 heroui-select-fix'
                      selectedKey={activeIconThemeKey}
                      onSelectionChange={(val) => {
                        const valStr = String(val)
                        const selectedOption = iconThemeOptions.find((o) => o.key === valStr)
                        if (selectedOption) {
                          void onSelectIconTheme({
                            sourceVsixPath: selectedOption.sourceVsixPath,
                            themeId: selectedOption.themeId,
                          })
                        }
                      }}
                      placeholder="选择图标主题"
                      isDisabled={isIconThemeBusy || iconThemeOptions.length === 0}
                    >
                      <Select.Trigger className='settings-select-trigger'>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
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
                      当前: {iconTheme.activeThemeLabel} / {getBaseName(iconTheme.sourceVsixPath)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className='settings-card'>
              {workspacePath ? (
                <div className='settings-provider-list'>
                  {authProviders.map((provider) => {
                    const draftValue = authDrafts[provider.key]
                    return (
                      <section key={provider.key} className='settings-provider-card'>
                        <div>
                          <span className='settings-provider-label'>{provider.label}</span>
                          <span className='settings-provider-meta'>{getProviderMeta(provider.state)}</span>
                        </div>
                        <Input
                          aria-label={`${provider.label} API key`}
                          className='settings-provider-input'
                          disabled={isSavingAuth}
                          onChange={(e) => setAuthDrafts(prev => ({ ...prev, [provider.key]: e.target.value }))}
                          placeholder={provider.placeholder}
                          type='password'
                          value={draftValue}
                          variant='secondary'
                        />
                        <div className='settings-provider-actions'>
                          <Button
                            isDisabled={isSavingAuth || !draftValue.trim()}
                            size='sm'
                            variant='ghost'
                            className='settings-action-button'
                            onPress={() => void handleSaveProviderAuth(provider.key, draftValue)}
                          >
                            保存密钥
                          </Button>
                          <Button
                            isDisabled={isSavingAuth || !provider.state.hasStoredCredential}
                            size='sm'
                            variant='ghost'
                            className='settings-action-button'
                            onPress={() => void handleSaveProviderAuth(provider.key, null)}
                          >
                            移除已保存
                          </Button>
                        </div>
                      </section>
                    )
                  })}
                </div>
              ) : (
                <div className='settings-empty-state'>
                  请先打开一个工作区。服务提供商配置将遵循当前活动的工作区上下文。
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

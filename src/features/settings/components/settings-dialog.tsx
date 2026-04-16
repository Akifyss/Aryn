import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, ListBox, Select, Tabs } from '@heroui/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import type { AgentProviderAuthState, AgentWorkspaceState } from '@/features/agent/types'
import {
  DIFF_ENGINE_OPTIONS,
  EDITOR_RUNTIME_OPTIONS,
  resolveDiffEngineChoice,
  resolveEditorRuntimeChoice,
} from '@/features/editor/lib/editor-platform'
import type { AppIconCatalogOption } from '@/features/settings/types'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '@/features/workspace/types'
import { useSettingsStore } from '@/hooks/use-settings-store'

export type SettingsSectionId = 'general' | 'editor' | 'providers'

type SettingsViewProps = {
  activeSection: SettingsSectionId
  appIconId: string | null
  appIconOptions: AppIconCatalogOption[]
  agentState: AgentWorkspaceState | null
  iconTheme: WorkspaceIconTheme | null
  iconThemeOptions: WorkspaceIconThemeCatalogOption[]
  isAppIconBusy: boolean
  isIconThemeBusy: boolean
  onAgentStateChange: (state: AgentWorkspaceState) => void
  onImportIconTheme: () => Promise<void>
  onSectionChange: (section: SettingsSectionId) => void
  onSelectAppIcon: (appIconId: string) => Promise<void>
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
    description: '代码编辑运行时与 diff 引擎的路线图和稳定选项。',
    id: 'editor',
    label: '编辑器',
  },
  {
    description: '管理 Pi Agent 提供商的 API 密钥。',
    id: 'providers',
    label: '服务提供商',
  },
]

const SETTINGS_SECTION_TITLES: Record<SettingsSectionId, string> = {
  editor: '编辑器',
  general: '外观',
  providers: '服务提供商',
}

const OPTION_STABILITY_LABELS = {
  experimental: '实验中',
  planned: '规划中',
  stable: '稳定',
} as const

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
  appIconId,
  appIconOptions,
  agentState,
  iconTheme,
  iconThemeOptions,
  isAppIconBusy,
  isIconThemeBusy,
  onAgentStateChange,
  onImportIconTheme,
  onSectionChange,
  onSelectAppIcon,
  onSelectIconTheme,
  onStatusMessage,
  workspacePath,
}: SettingsViewProps) {
  const {
    diffEngine,
    editorRuntime,
    setDiffEngine,
    setEditorRuntime,
    theme,
    setTheme,
  } = useSettingsStore()
  const [authDrafts, setAuthDrafts] = useState<Record<AuthProviderKey, string>>(EMPTY_AUTH_DRAFTS)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  const resolvedEditorRuntime = useMemo(
    () => resolveEditorRuntimeChoice(editorRuntime),
    [editorRuntime],
  )
  const resolvedDiffEngine = useMemo(
    () => resolveDiffEngineChoice(diffEngine),
    [diffEngine],
  )

  const resolvedTheme = useMemo(() => {
    if (theme === 'auto') {
      return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
    }

    return theme
  }, [theme])

  const prevThemeRef = useRef(resolvedTheme)

  useEffect(() => {
    if (!workspacePath || isIconThemeBusy || iconThemeOptions.length === 0) {
      return
    }

    if (prevThemeRef.current === resolvedTheme) {
      return
    }

    const targetLabel = resolvedTheme === 'dark' ? 'flow dawn' : 'flow deep'
    const targetOption = iconThemeOptions.find((option) => option.label.toLowerCase().includes(targetLabel))
    const timer = setTimeout(() => {
      if (targetOption && (
        !iconTheme
        || iconTheme.activeThemeId !== targetOption.themeId
        || iconTheme.sourceVsixPath !== targetOption.sourceVsixPath
      )) {
        void onSelectIconTheme({
          sourceVsixPath: targetOption.sourceVsixPath,
          themeId: targetOption.themeId,
        })
      }
    }, 300)

    prevThemeRef.current = resolvedTheme

    return () => clearTimeout(timer)
  }, [resolvedTheme, iconTheme, iconThemeOptions, isIconThemeBusy, onSelectIconTheme, workspacePath])

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
  const selectedAppIcon = appIconOptions.find((option) => option.id === appIconId) ?? appIconOptions[0] ?? null

  async function handleSaveProviderAuth(provider: AuthProviderKey, apiKey: string | null) {
    if (!workspacePath) {
      return
    }

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
              onClick={() => onSectionChange(section.id)}
            >
              <span className='settings-nav-label'>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className='settings-panel'>
        <div className='settings-panel-header'>
          <h3 className='settings-panel-title'>
            {SETTINGS_SECTION_TITLES[activeSection]}
          </h3>
        </div>

        <AppScrollArea
          className='settings-panel-content'
          contentClassName='settings-panel-content-inner'
        >
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
                      variant='primary'
                      className='w-full'
                    >
                      <Tabs.ListContainer className='w-full'>
                        <Tabs.List aria-label='主题配色' className='w-full'>
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
                  <span className='settings-field-label'>图标主题</span>
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
                      placeholder='选择图标主题'
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

                <div className='settings-field' style={{ marginTop: '24px' }}>
                  <div className='settings-copy-block'>
                    <h4>应用图标</h4>
                  </div>
                  <Select
                    className='settings-field-grow heroui-select-fix'
                    selectedKey={selectedAppIcon?.id ?? ''}
                    onSelectionChange={(value) => {
                      if (value == null) {
                        return
                      }

                      const nextAppIconId = String(value)
                      if (nextAppIconId) {
                        void onSelectAppIcon(nextAppIconId)
                      }
                    }}
                    placeholder='选择应用图标'
                    isDisabled={isAppIconBusy || appIconOptions.length === 0}
                  >
                    <Select.Trigger className='settings-select-trigger settings-app-icon-select-trigger'>
                      {selectedAppIcon ? (
                        <>
                          <span className='settings-app-icon-preview is-compact'>
                            <img src={selectedAppIcon.previewSrc} alt={`${selectedAppIcon.label} app icon`} />
                          </span>
                          <span className='settings-app-icon-name'>{selectedAppIcon.label}</span>
                          <Select.Indicator />
                        </>
                      ) : (
                        <>
                          <span className='settings-app-icon-placeholder'>选择应用图标</span>
                          <Select.Indicator />
                        </>
                      )}
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {appIconOptions.map((option) => (
                          <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                            <span className='settings-app-icon-item'>
                              <span className='settings-app-icon-preview is-compact'>
                                <img src={option.previewSrc} alt={`${option.label} app icon`} />
                              </span>
                              <span className='settings-app-icon-name'>{option.label}</span>
                            </span>
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
              </div>
            </div>
          ) : activeSection === 'editor' ? (
            <>
              {(resolvedEditorRuntime.fallbackReason || resolvedDiffEngine.fallbackReason) ? (
                <div className='settings-alert settings-alert-warning'>
                  {resolvedEditorRuntime.fallbackReason ?? resolvedDiffEngine.fallbackReason}
                </div>
              ) : null}

              <div className='settings-card'>
                <div className='settings-copy-block'>
                  <h4>代码编辑运行时</h4>
                  <p>
                    先把运行时入口稳定地收束成一层抽象，再在隔离边界里逐步接 VS Code 兼容能力。
                  </p>
                </div>

                <div className='settings-option-list'>
                  {EDITOR_RUNTIME_OPTIONS.map((option) => {
                    const isActive = resolvedEditorRuntime.resolvedId === option.id
                    const isRequested = editorRuntime === option.id

                    return (
                      <section
                        key={option.id}
                        className={`settings-option-card${isActive ? ' is-active' : ''}`}
                      >
                        <div className='settings-option-header'>
                          <div className='settings-copy-block'>
                            <h4>{option.label}</h4>
                            <p>{option.description}</p>
                          </div>
                          <span className={`settings-option-badge is-${option.stability}`}>
                            {isActive ? '当前使用' : OPTION_STABILITY_LABELS[option.stability]}
                          </span>
                        </div>
                        <p className='settings-inline-hint'>{option.detail}</p>
                        <div className='settings-option-capability-list'>
                          {option.capabilities.map((capability) => (
                            <span key={capability} className='settings-option-capability'>
                              {capability}
                            </span>
                          ))}
                        </div>
                        <div className='settings-inline-actions'>
                          <Button
                            variant={isActive ? 'primary' : 'outline'}
                            isDisabled={isActive || !option.isSelectable}
                            className='settings-action-button'
                            onPress={() => setEditorRuntime(option.id)}
                          >
                            {isActive ? '当前使用中' : option.isSelectable ? '切换到此方案' : '尚未开放'}
                          </Button>
                        </div>
                        {!option.isSelectable && isRequested ? (
                          <p className='settings-inline-hint'>
                            已保存的选择不会直接启用未开放方案，宿主层会继续回退到稳定运行时。
                          </p>
                        ) : null}
                      </section>
                    )
                  })}
                </div>
              </div>

              <div className='settings-card'>
                <div className='settings-copy-block'>
                  <h4>Git Diff 引擎</h4>
                  <p>
                    现阶段优先保住块级操作和编辑体验，再逐步评估更强的 diff / merge 能力是否值得替换当前实现。
                  </p>
                </div>

                <div className='settings-option-list'>
                  {DIFF_ENGINE_OPTIONS.map((option) => {
                    const isActive = resolvedDiffEngine.resolvedId === option.id
                    const isRequested = diffEngine === option.id

                    return (
                      <section
                        key={option.id}
                        className={`settings-option-card${isActive ? ' is-active' : ''}`}
                      >
                        <div className='settings-option-header'>
                          <div className='settings-copy-block'>
                            <h4>{option.label}</h4>
                            <p>{option.description}</p>
                          </div>
                          <span className={`settings-option-badge is-${option.stability}`}>
                            {isActive ? '当前使用' : OPTION_STABILITY_LABELS[option.stability]}
                          </span>
                        </div>
                        <p className='settings-inline-hint'>{option.detail}</p>
                        <div className='settings-option-capability-list'>
                          {option.capabilities.map((capability) => (
                            <span key={capability} className='settings-option-capability'>
                              {capability}
                            </span>
                          ))}
                        </div>
                        <div className='settings-inline-actions'>
                          <Button
                            variant={isActive ? 'primary' : 'outline'}
                            isDisabled={isActive || !option.isSelectable}
                            className='settings-action-button'
                            onPress={() => setDiffEngine(option.id)}
                          >
                            {isActive ? '当前使用中' : option.isSelectable ? '切换到此方案' : '尚未开放'}
                          </Button>
                        </div>
                        {!option.isSelectable && isRequested ? (
                          <p className='settings-inline-hint'>
                            已保存的选择不会直接启用未开放方案，宿主层会继续回退到稳定 diff 引擎。
                          </p>
                        ) : null}
                      </section>
                    )
                  })}
                </div>
              </div>
            </>
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
                          onChange={(event) => setAuthDrafts((prev) => ({ ...prev, [provider.key]: event.target.value }))}
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
                  请先打开一个工作区。服务提供商配置将遵循当前活动工作区上下文。
                </div>
              )}
            </div>
          )}
        </AppScrollArea>
      </section>
    </div>
  )
}

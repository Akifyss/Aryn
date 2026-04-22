import { useEffect, useMemo, useState } from 'react'
import { Button, Input, ListBox, Select, Tabs } from '@heroui/react'
import { AppScrollArea } from '@/components/app-scroll-area'
import type { AgentProviderAuthState, AgentWorkspaceState } from '@/features/agent/types'
import type { AppIconCatalogOption } from '@/features/settings/types'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '@/features/workspace/types'
import { useSettingsStore } from '@/hooks/use-settings-store'

export type SettingsSectionId = 'appearance' | 'editor' | 'providers'

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
  resolvedTheme: 'light' | 'dark'
  workspacePath: string | null
}

type AuthProviderKey = 'google' | 'openai' | 'openrouter'

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

const EMPTY_AUTH_DRAFTS: Record<AuthProviderKey, string> = {
  google: '',
  openai: '',
  openrouter: '',
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

function getProviderMeta(state: AgentProviderAuthState) {
  if (state.source === 'stored') {
    return '当前正在使用已保存的密钥'
  }

  if (state.source === 'env') {
    return `当前正在使用环境变量 ${state.envVarName}`
  }

  return `尚未保存密钥，也未检测到环境变量 ${state.envVarName}`
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
  resolvedTheme,
  workspacePath,
}: SettingsViewProps) {
  const { meo, theme, setTheme, updateMeoSettings } = useSettingsStore()
  const [authDrafts, setAuthDrafts] = useState<Record<AuthProviderKey, string>>(EMPTY_AUTH_DRAFTS)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [meoImageFolderDraft, setMeoImageFolderDraft] = useState(meo.imageFolder)
  const [meoRememberPositionDraft, setMeoRememberPositionDraft] = useState(String(meo.rememberPositionLines))
  const [panelError, setPanelError] = useState<string | null>(null)

  useEffect(() => {
    setMeoImageFolderDraft(meo.imageFolder)
  }, [meo.imageFolder])

  useEffect(() => {
    setMeoRememberPositionDraft(String(meo.rememberPositionLines))
  }, [meo.rememberPositionLines])

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
      setPanelError(error instanceof Error ? error.message : '无法更新服务提供商认证信息。')
    } finally {
      setIsSavingAuth(false)
    }
  }

  function commitMeoImageFolderDraft() {
    updateMeoSettings({ imageFolder: meoImageFolderDraft })
  }

  function commitMeoRememberPositionDraft() {
    updateMeoSettings({
      rememberPositionLines: Number.parseInt(meoRememberPositionDraft, 10),
    })
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
                当前使用：{iconTheme.activeThemeLabel} / {getBaseName(iconTheme.sourceVsixPath)}
              </p>
            )}
          </div>

          <div className='settings-field' style={{ marginTop: '24px' }}>
            <div className='settings-copy-block'>
              <h4>应用图标</h4>
              <p>选择桌面应用窗口和任务栏使用的图标。</p>
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
                <Select.Popover>
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

            <div className='settings-field settings-field-grow'>
              <span className='settings-field-label'>Git 行级高亮</span>
              <Select
                className='settings-field-grow heroui-select-fix'
                selectedKey={meo.gitDiffLineHighlights ? 'enabled' : 'disabled'}
                onSelectionChange={(value) => {
                  updateMeoSettings({ gitDiffLineHighlights: String(value) === 'enabled' })
                }}
              >
                <Select.Trigger className='settings-select-trigger'>
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    <ListBox.Item key='enabled' id='enabled' textValue='开启'>
                      开启
                    </ListBox.Item>
                    <ListBox.Item key='disabled' id='disabled' textValue='关闭'>
                      关闭
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
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

            <div className='settings-field settings-field-grow'>
              <span className='settings-field-label'>滚动位置记忆阈值</span>
              <Input
                aria-label='编辑器滚动位置记忆阈值'
                className='settings-field-grow'
                min={0}
                onChange={(event) => {
                  setMeoRememberPositionDraft(event.target.value)
                }}
                onBlur={commitMeoRememberPositionDraft}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitMeoRememberPositionDraft()
                  }
                }}
                placeholder='100'
                type='number'
                value={meoRememberPositionDraft}
                variant='secondary'
              />
              <p className='settings-inline-hint'>
                文件行数达到该值后，会记住上次可见位置。设为 <code>0</code> 表示始终记住。
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderProvidersSection() {
    return (
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
                      移除已保存密钥
                    </Button>
                  </div>
                </section>
              )
            })}
          </div>
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

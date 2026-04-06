import { useEffect, useMemo, useState, useRef } from 'react'
import { Button, Input } from '@heroui/react'
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
    description: 'Application appearance and behavior.',
    id: 'general',
    label: 'Appearance',
  },
  {
    description: 'Manage API keys for Pi Agent providers.',
    id: 'providers',
    label: 'Providers',
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
    return 'Using saved key'
  }

  if (state.source === 'env') {
    return `Using ${state.envVarName}`
  }

  return `No key saved. ${state.envVarName} also works.`
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
        ? `${provider} key updated`
        : `${provider} key removed`)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to update provider authentication.')
    } finally {
      setIsSavingAuth(false)
    }
  }

  return (
    <div className={`settings-page ${resolvedTheme === 'dark' ? 'dark theme-dark' : 'theme-light'}`}>
      <aside className='settings-sidebar'>
        <div className='settings-sidebar-header'>
          <h2 className='settings-sidebar-title'>Settings</h2>
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
            {activeSection === 'general' ? 'Appearance' : 'Providers'}
          </h3>
        </div>

        <div className='settings-panel-content'>
          {panelError && <div className='settings-alert settings-alert-error'>{panelError}</div>}

          {activeSection === 'general' ? (
            <div className='settings-card'>
              <div className='settings-theme-switcher'>
                <div className='settings-field'>
                  <span className='settings-field-label'>Mode</span>
                  <div className='settings-radio-group'>
                    {(['light', 'dark', 'auto'] as const).map((mode) => (
                      <button
                        key={mode}
                        type='button'
                        className={`settings-radio-item ${theme === mode ? 'is-active' : ''}`}
                        onClick={() => setTheme(mode)}
                      >
                        <span className='settings-radio-label'>
                          {mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Sync with system'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className='settings-field' style={{ marginTop: '24px' }}>
                  <span className='settings-field-label'>Icon theme</span>
                  <div className='settings-inline-form'>
                    <select
                      className='settings-select'
                      style={{ flex: 1 }}
                      disabled={isIconThemeBusy || iconThemeOptions.length === 0}
                      value={activeIconThemeKey}
                      onChange={(event) => {
                        const selectedOption = iconThemeOptions.find((o) => o.key === event.target.value)
                        if (selectedOption) {
                          void onSelectIconTheme({
                            sourceVsixPath: selectedOption.sourceVsixPath,
                            themeId: selectedOption.themeId,
                          })
                        }
                      }}
                    >
                      {iconThemeOptions.map((option) => (
                        <option key={option.key} value={option.key}>{option.label}</option>
                      ))}
                    </select>
                    <Button
                      isDisabled={isIconThemeBusy}
                      variant='primary'
                      className='settings-action-button'
                      onPress={() => void onImportIconTheme()}
                    >
                      Import VSIX
                    </Button>
                  </div>
                  {iconTheme && (
                    <p className='settings-inline-hint' style={{ marginTop: '8px' }}>
                      Current: {iconTheme.activeThemeLabel} / {getBaseName(iconTheme.sourceVsixPath)}
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
                            Save Key
                          </Button>
                          <Button
                            isDisabled={isSavingAuth || !provider.state.hasStoredCredential}
                            size='sm'
                            variant='ghost'
                            className='settings-action-button'
                            onPress={() => void handleSaveProviderAuth(provider.key, null)}
                          >
                            Remove Saved
                          </Button>
                        </div>
                      </section>
                    )
                  })}
                </div>
              ) : (
                <div className='settings-empty-state'>
                  Open a workspace first. Provider configuration follows the active workspace context.
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

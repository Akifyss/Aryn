import { useMemo, useState } from 'react'
import { Button, Input } from '@heroui/react'
import type { AgentProviderAuthState, AgentWorkspaceState } from '@/features/agent/types'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '@/features/workspace/types'

export type SettingsSectionId = 'file-icons' | 'providers'

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
    description: 'Manage API keys for Pi Agent providers.',
    id: 'providers',
    label: 'Providers',
  },
  {
    description: 'Switch workspace file icon themes.',
    id: 'file-icons',
    label: 'File Icons',
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
  const [authDrafts, setAuthDrafts] = useState<Record<AuthProviderKey, string>>(EMPTY_AUTH_DRAFTS)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  const authProviders: Array<{
    key: AuthProviderKey
    label: string
    placeholder: string
    state: AgentProviderAuthState
  }> = useMemo(() => {
    const runtimeAuth = agentState?.runtime.auth

    return [
      {
        key: 'openrouter',
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
        key: 'openai',
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
        key: 'google',
        label: 'Google Gemini',
        placeholder: 'GEMINI_API_KEY / API key',
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
        ? `${provider} key updated`
        : `${provider} key removed`)
    } catch (error) {
      setPanelError(error instanceof Error ? error.message : 'Unable to update provider authentication.')
    } finally {
      setIsSavingAuth(false)
    }
  }

  return (
    <div className='settings-page'>
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
              onClick={() => {
                onSectionChange(section.id)
              }}
            >
              <span className='settings-nav-label'>{section.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className='settings-panel'>
        <div className='settings-panel-header'>
          <div>
            <h3 className='settings-panel-title'>
              {activeSection === 'providers' ? 'Providers' : 'File Icons'}
            </h3>
          </div>
        </div>

        <div className='settings-panel-content'>
          {panelError ? (
            <div className='settings-alert settings-alert-error'>{panelError}</div>
          ) : null}

          {activeSection === 'providers' ? (
            <section className='settings-card'>
              <div className='settings-copy-block'>
                <h4>Provider Keys</h4>
                <p>Saved keys are stored locally and reused by the Agent panel.</p>
              </div>

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
                          onChange={(event) => {
                            setAuthDrafts((currentValue) => ({
                              ...currentValue,
                              [provider.key]: event.target.value,
                            }))
                          }}
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
                            onPress={() => {
                              void handleSaveProviderAuth(provider.key, draftValue)
                            }}
                          >
                            Save Key
                          </Button>

                          <Button
                            isDisabled={isSavingAuth || !provider.state.hasStoredCredential}
                            size='sm'
                            variant='ghost'
                            className='settings-action-button'
                            onPress={() => {
                              void handleSaveProviderAuth(provider.key, null)
                            }}
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
            </section>
          ) : (
            <section className='settings-card settings-card-compact'>
              <div className='settings-copy-block'>
                <h4>Theme</h4>
                <p>Choose a file icon theme variant, or import another VSIX package.</p>
              </div>

              <div className='settings-inline-form'>
                <label className='settings-field settings-field-grow'>
                  <span className='settings-field-label'>Icon theme</span>
                  <select
                    className='settings-select'
                    disabled={isIconThemeBusy || iconThemeOptions.length === 0}
                    value={activeIconThemeKey}
                    onChange={(event) => {
                      const selectedOption = iconThemeOptions.find((option) => option.key === event.target.value)
                      if (!selectedOption) {
                        return
                      }

                      void onSelectIconTheme({
                        sourceVsixPath: selectedOption.sourceVsixPath,
                        themeId: selectedOption.themeId,
                      })
                    }}
                  >
                    {iconThemeOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className='settings-inline-actions'>
                  <Button
                    isDisabled={isIconThemeBusy}
                    variant='primary'
                    className='settings-action-button'
                    onPress={() => {
                      void onImportIconTheme()
                    }}
                  >
                    Import VSIX
                  </Button>
                </div>
              </div>

              {iconTheme ? (
                <p className='settings-inline-hint'>
                  Current: {iconTheme.activeThemeLabel} / {getBaseName(iconTheme.sourceVsixPath)}
                </p>
              ) : (
                <p className='settings-inline-hint'>No icon theme is active.</p>
              )}
            </section>
          )}
        </div>
      </section>
    </div>
  )
}

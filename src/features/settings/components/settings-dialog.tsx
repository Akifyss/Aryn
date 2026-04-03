import { useEffect, useMemo, useState } from 'react'
import { Button, Input, ScrollShadow } from '@heroui/react'
import { CloseLine } from '@mingcute/react'
import type { AgentProviderAuthState, AgentWorkspaceState } from '@/features/agent/types'
import type { WorkspaceIconTheme } from '@/features/workspace/types'

export type SettingsSectionId = 'file-icons' | 'providers'

type SettingsDialogProps = {
  activeSection: SettingsSectionId
  agentState: AgentWorkspaceState | null
  iconTheme: WorkspaceIconTheme | null
  isIconThemeBusy: boolean
  isOpen: boolean
  onAgentStateChange: (state: AgentWorkspaceState) => void
  onClose: () => void
  onImportIconTheme: () => Promise<void>
  onSectionChange: (section: SettingsSectionId) => void
  onSelectIconTheme: (themeId: string) => Promise<void>
  onUseBundledIconTheme: () => Promise<void>
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
    description: 'Import and switch VS Code file icon themes.',
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
  isIconThemeBusy,
  isOpen,
  onAgentStateChange,
  onClose,
  onImportIconTheme,
  onSectionChange,
  onSelectIconTheme,
  onStatusMessage,
  onUseBundledIconTheme,
  workspacePath,
}: SettingsDialogProps) {
  const [authDrafts, setAuthDrafts] = useState<Record<AuthProviderKey, string>>(EMPTY_AUTH_DRAFTS)
  const [isSavingAuth, setIsSavingAuth] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setPanelError(null)
    setAuthDrafts(EMPTY_AUTH_DRAFTS)
  }, [agentState?.runtime.auth, isOpen])

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

  if (!isOpen) {
    return null
  }

  return (
    <div
      className='settings-overlay'
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className='settings-dialog' role='dialog' aria-modal='true' aria-labelledby='settings-dialog-title'>
        <aside className='settings-sidebar'>
          <div className='settings-sidebar-header'>
            <p className='settings-sidebar-eyebrow'>Workspace</p>
            <h2 id='settings-dialog-title' className='settings-sidebar-title'>Settings</h2>
          </div>

          <nav className='settings-nav' aria-label='Settings sections'>
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type='button'
                className={`settings-nav-item${section.id === activeSection ? ' is-active' : ''}`}
                onClick={() => {
                  onSectionChange(section.id)
                }}
              >
                <span className='settings-nav-label'>{section.label}</span>
                <span className='settings-nav-description'>{section.description}</span>
              </button>
            ))}
          </nav>
        </aside>

        <section className='settings-panel'>
          <div className='settings-panel-header'>
            <div>
              <p className='settings-panel-eyebrow'>
                {activeSection === 'providers' ? 'Configure providers' : 'Workspace file icons'}
              </p>
              <h3 className='settings-panel-title'>
                {activeSection === 'providers' ? 'Providers' : 'File Icons'}
              </h3>
            </div>

            <button
              type='button'
              className='settings-close-button'
              aria-label='Close settings'
              onClick={onClose}
            >
              <CloseLine size={18} />
            </button>
          </div>

          <ScrollShadow className='settings-panel-scroll' hideScrollBar>
            <div className='settings-panel-content'>
              {panelError ? (
                <div className='settings-alert settings-alert-error'>{panelError}</div>
              ) : null}

              {activeSection === 'providers' ? (
                <div className='settings-section-stack'>
                  <section className='settings-card'>
                    <div className='settings-copy-block'>
                      <h4>Provider Keys</h4>
                      <p>
                        Configure model providers for the current workspace. Saved keys are stored locally and
                        immediately reused by the Agent panel.
                      </p>
                    </div>

                    {workspacePath ? (
                      <div className='settings-provider-list'>
                        {authProviders.map((provider) => {
                          const draftValue = authDrafts[provider.key]

                          return (
                            <section key={provider.key} className='settings-provider-card'>
                              <div className='settings-provider-copy'>
                                <div>
                                  <span className='settings-provider-label'>{provider.label}</span>
                                  <span className='settings-provider-meta'>{getProviderMeta(provider.state)}</span>
                                </div>
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
                        Open a workspace first. Provider configuration currently follows the active workspace context.
                      </div>
                    )}
                  </section>
                </div>
              ) : (
                <div className='settings-section-stack'>
                  <section className='settings-card'>
                    <div className='settings-copy-block'>
                      <h4>Current Theme</h4>
                      <p>
                        Import a VS Code icon theme from a `.vsix` package, or switch between the built-in Flow Icons
                        variants bundled with the app.
                      </p>
                    </div>

                    {iconTheme ? (
                      <div className='settings-theme-summary'>
                        <div className='settings-theme-badges'>
                          <span className='settings-chip'>{iconTheme.extensionLabel}</span>
                          <span className='settings-chip settings-chip-accent'>{iconTheme.activeThemeLabel}</span>
                          <span className='settings-chip'>
                            {iconTheme.sourceKind === 'bundled' ? 'Built-in default' : 'Imported VSIX'}
                          </span>
                        </div>

                        <div className='settings-theme-meta-grid'>
                          <div className='settings-theme-meta'>
                            <span className='settings-theme-meta-label'>Source</span>
                            <span className='settings-theme-meta-value'>{getBaseName(iconTheme.sourceVsixPath)}</span>
                          </div>
                          <div className='settings-theme-meta'>
                            <span className='settings-theme-meta-label'>Theme</span>
                            <span className='settings-theme-meta-value'>{iconTheme.activeThemeLabel}</span>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className='settings-empty-state'>
                        No icon theme is active. Import a VSIX package or switch back to the built-in Flow Icons pack.
                      </div>
                    )}

                    <div className='settings-theme-actions'>
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

                      <Button
                        isDisabled={isIconThemeBusy}
                        variant='ghost'
                        className='settings-action-button'
                        onPress={() => {
                          void onUseBundledIconTheme()
                        }}
                      >
                        Use Built-in Flow Icons
                      </Button>
                    </div>
                  </section>

                  {iconTheme?.themes.length ? (
                    <section className='settings-card'>
                      <div className='settings-copy-block'>
                        <h4>Theme Variant</h4>
                        <p>
                          Switch between the icon themes exposed by the current VSIX package.
                        </p>
                      </div>

                      <label className='settings-field'>
                        <span className='settings-field-label'>Available themes</span>
                        <select
                          className='settings-select'
                          disabled={isIconThemeBusy}
                          value={iconTheme.activeThemeId}
                          onChange={(event) => {
                            void onSelectIconTheme(event.target.value)
                          }}
                        >
                          {iconTheme.themes.map((themeOption) => (
                            <option key={themeOption.id} value={themeOption.id}>
                              {themeOption.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </section>
                  ) : null}
                </div>
              )}
            </div>
          </ScrollShadow>
        </section>
      </div>
    </div>
  )
}

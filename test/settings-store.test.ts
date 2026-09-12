import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('defaults new installs to the Duo layout', async () => {
    const {
      DEFAULT_AGENT_SETTINGS,
      DEFAULT_APP_LAYOUT_PREFERENCE,
      useSettingsStore,
    } = await import('../src/hooks/use-settings-store')

    expect(DEFAULT_APP_LAYOUT_PREFERENCE).toBe('duo')
    expect(DEFAULT_AGENT_SETTINGS.runningPromptEnterBehavior).toBe('followUp')
    expect(useSettingsStore.getState().layoutPreference).toBe('duo')
    expect(useSettingsStore.getState().agent.runningPromptEnterBehavior).toBe('followUp')
  })

  it.each(['agent', 'editor', 'duo', 'invalid', undefined])('migrates %s to the only supported layout in both processes', async (layoutPreference) => {
    const { initializeSettingsStore, useSettingsStore } = await import('../src/hooks/use-settings-store')
    const { normalizeAppSettings } = await import('../electron/main/app-state')
    const settings = normalizeAppSettings({ layoutPreference, theme: 'dark' })
    expect(settings.layoutPreference).toBe('duo')
    initializeSettingsStore(settings)
    expect(useSettingsStore.getState().layoutPreference).toBe('duo')
    expect(useSettingsStore.getState().theme).toBe('dark')
  })

  it('initializes from persisted settings loaded by the main process', async () => {
    const { initializeSettingsStore, useSettingsStore } = await import('../src/hooks/use-settings-store')

    initializeSettingsStore({
      agent: {
        runningPromptEnterBehavior: 'steer',
      },
      layoutPreference: 'editor',
      meo: {
        focusedLineHighlight: true,
        gitDiffLineHighlights: false,
        imageFolder: 'images',
        outlinePosition: 'left',
      },
      theme: 'dark',
    })

    expect(useSettingsStore.getState().layoutPreference).toBe('duo')
    expect(useSettingsStore.getState().theme).toBe('dark')
    expect(useSettingsStore.getState().agent.runningPromptEnterBehavior).toBe('steer')
    expect(useSettingsStore.getState().meo.outlinePosition).toBe('left')
  })

  it('persists setting updates through the main process API', async () => {
    const updateSettingsState = vi.fn(() => Promise.resolve({ ok: true }))

    vi.stubGlobal('window', {
      appApi: {
        updateSettingsState,
      },
    })

    const { useSettingsStore } = await import('../src/hooks/use-settings-store')

    useSettingsStore.getState().setTheme('dark')
    useSettingsStore.getState().updateAgentSettings({ runningPromptEnterBehavior: 'steer' })

    expect(updateSettingsState).toHaveBeenCalledWith({ theme: 'dark' })
    expect(updateSettingsState).toHaveBeenCalledWith({
      agent: {
        runningPromptEnterBehavior: 'steer',
      },
    })
  })
})

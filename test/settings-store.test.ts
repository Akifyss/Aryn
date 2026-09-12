import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('defaults settings without a layout mode', async () => {
    const {
      DEFAULT_AGENT_SETTINGS,
      useSettingsStore,
    } = await import('../src/hooks/use-settings-store')

    expect(DEFAULT_AGENT_SETTINGS.runningPromptEnterBehavior).toBe('followUp')
    expect(useSettingsStore.getState()).not.toHaveProperty('layoutPreference')
    expect(useSettingsStore.getState().agent.runningPromptEnterBehavior).toBe('followUp')
  })

  it.each(['agent', 'editor', 'duo', 'invalid', undefined])('ignores retired %s mode in both processes', async (layoutPreference) => {
    const { initializeSettingsStore, useSettingsStore } = await import('../src/hooks/use-settings-store')
    const { normalizeAppSettings } = await import('../electron/main/app-state')
    const settings = normalizeAppSettings({ layoutPreference, theme: 'dark' })
    expect(settings).not.toHaveProperty('layoutPreference')
    initializeSettingsStore(settings)
    expect(useSettingsStore.getState()).not.toHaveProperty('layoutPreference')
    expect(useSettingsStore.getState().theme).toBe('dark')
  })

  it('initializes from persisted settings loaded by the main process', async () => {
    const { initializeSettingsStore, useSettingsStore } = await import('../src/hooks/use-settings-store')

    initializeSettingsStore({
      agent: {
        runningPromptEnterBehavior: 'steer',
      },
      meo: {
        focusedLineHighlight: true,
        gitDiffLineHighlights: false,
        imageFolder: 'images',
        outlinePosition: 'left',
      },
      theme: 'dark',
    })

    expect(useSettingsStore.getState()).not.toHaveProperty('layoutPreference')
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

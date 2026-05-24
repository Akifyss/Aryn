import { beforeEach, describe, expect, it, vi } from 'vitest'

function createLocalStorage(initialValues: Record<string, string> = {}) {
  const values = new Map(Object.entries(initialValues))

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
}

describe('useSettingsStore', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('defaults new installs to the Agent layout', async () => {
    const { DEFAULT_APP_LAYOUT_PREFERENCE, useSettingsStore } = await import('../src/hooks/use-settings-store')

    expect(DEFAULT_APP_LAYOUT_PREFERENCE).toBe('agent')
    expect(useSettingsStore.getState().layoutPreference).toBe('agent')
  })

  it('preserves an explicitly persisted Editor layout preference', async () => {
    vi.stubGlobal('window', {
      localStorage: createLocalStorage({
        'aryn:settings': JSON.stringify({
          state: {
            layoutPreference: 'editor',
            theme: 'dark',
          },
          version: 0,
        }),
      }),
    })

    const { useSettingsStore } = await import('../src/hooks/use-settings-store')

    expect(useSettingsStore.getState().layoutPreference).toBe('editor')
  })
})

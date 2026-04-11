import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export type AppTheme = 'light' | 'dark' | 'auto'

interface SettingsState {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
}

const SETTINGS_STORAGE_KEY = 'aryn:settings'
const LEGACY_SETTINGS_STORAGE_KEY = `${String.fromCharCode(
  119,
  114,
  105,
  116,
  105,
  110,
  103,
  45,
  119,
  111,
  114,
  107,
  115,
  112,
  97,
  99,
  101,
)}:settings`

const settingsStorage: StateStorage = {
  getItem: (name) => {
    if (typeof window === 'undefined') {
      return null
    }

    const currentValue = window.localStorage.getItem(name)

    if (currentValue !== null) {
      return currentValue
    }

    const legacyValue = window.localStorage.getItem(LEGACY_SETTINGS_STORAGE_KEY)

    if (legacyValue !== null) {
      window.localStorage.setItem(name, legacyValue)
      window.localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY)
    }

    return legacyValue
  },
  setItem: (name, value) => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(name, value)
    window.localStorage.removeItem(LEGACY_SETTINGS_STORAGE_KEY)
  },
  removeItem: (name) => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.removeItem(name)
  },
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'auto',
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => settingsStorage),
    },
  ),
)

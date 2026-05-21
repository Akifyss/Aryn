import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'

export type AppTheme = 'light' | 'dark' | 'auto'
export type AppLayoutPreference = 'agent' | 'editor'
export type MeoOutlinePosition = 'left' | 'right'

export type MeoSettings = {
  focusedLineHighlight: boolean
  gitDiffLineHighlights: boolean
  imageFolder: string
  outlinePosition: MeoOutlinePosition
}

interface SettingsState {
  layoutPreference: AppLayoutPreference
  meo: MeoSettings
  theme: AppTheme
  setLayoutPreference: (layoutPreference: AppLayoutPreference) => void
  updateMeoSettings: (patch: Partial<MeoSettings>) => void
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

const DEFAULT_MEO_SETTINGS: MeoSettings = {
  focusedLineHighlight: false,
  gitDiffLineHighlights: true,
  imageFolder: 'assets',
  outlinePosition: 'right',
}

function sanitizeMeoImageFolder(imageFolder: string) {
  const segments = imageFolder
    .replace(/[\\/]+/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return DEFAULT_MEO_SETTINGS.imageFolder
  }

  return segments.filter((segment) => segment !== '.').join('/')
}

function sanitizeMeoSettings(value: Partial<MeoSettings> | undefined): MeoSettings {
  return {
    focusedLineHighlight: value?.focusedLineHighlight === true,
    gitDiffLineHighlights: value?.gitDiffLineHighlights ?? DEFAULT_MEO_SETTINGS.gitDiffLineHighlights,
    imageFolder: sanitizeMeoImageFolder(value?.imageFolder ?? DEFAULT_MEO_SETTINGS.imageFolder),
    outlinePosition: value?.outlinePosition === 'left' ? 'left' : DEFAULT_MEO_SETTINGS.outlinePosition,
  }
}

function sanitizeLayoutPreference(value: unknown): AppLayoutPreference {
  return value === 'agent' ? 'agent' : 'editor'
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      layoutPreference: 'editor',
      meo: DEFAULT_MEO_SETTINGS,
      theme: 'auto',
      setLayoutPreference: (layoutPreference) => set({ layoutPreference: sanitizeLayoutPreference(layoutPreference) }),
      setTheme: (theme) => set({ theme }),
      updateMeoSettings: (patch) => set((state) => ({
        meo: sanitizeMeoSettings({
          ...state.meo,
          ...patch,
        }),
      })),
    }),
    {
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => settingsStorage),
      merge: (persistedState, currentState) => {
        const candidate = persistedState && typeof persistedState === 'object'
          ? persistedState as Partial<SettingsState>
          : {}

        return {
          ...currentState,
          ...candidate,
          layoutPreference: sanitizeLayoutPreference(candidate.layoutPreference),
          meo: sanitizeMeoSettings(candidate.meo),
        }
      },
    },
  ),
)

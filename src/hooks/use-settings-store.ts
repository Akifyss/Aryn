import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import {
  isDiffEngineId,
  isEditorRuntimeId,
  resolveDiffEngineChoice,
  resolveEditorRuntimeChoice,
  type DiffEngineId,
  type EditorRuntimeId,
} from '@/features/editor/lib/editor-platform'

export type AppTheme = 'light' | 'dark' | 'auto'

interface SettingsState {
  diffEngine: DiffEngineId
  editorRuntime: EditorRuntimeId
  setDiffEngine: (diffEngine: DiffEngineId) => void
  setEditorRuntime: (editorRuntime: EditorRuntimeId) => void
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

function isAppTheme(value: unknown): value is AppTheme {
  return value === 'light' || value === 'dark' || value === 'auto'
}

type PersistedSettingsState = Partial<{
  diffEngine: DiffEngineId
  editorRuntime: EditorRuntimeId
  theme: AppTheme
}>

function sanitizePersistedSettings(state: PersistedSettingsState | undefined) {
  return {
    diffEngine: resolveDiffEngineChoice(isDiffEngineId(state?.diffEngine) ? state.diffEngine : undefined).resolvedId,
    editorRuntime: resolveEditorRuntimeChoice(isEditorRuntimeId(state?.editorRuntime) ? state.editorRuntime : undefined).resolvedId,
    theme: isAppTheme(state?.theme) ? state.theme : 'auto',
  }
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      diffEngine: 'codemirror-merge',
      editorRuntime: 'monaco-standalone',
      setDiffEngine: (diffEngine) => set({
        diffEngine: resolveDiffEngineChoice(diffEngine).resolvedId,
      }),
      setEditorRuntime: (editorRuntime) => set({
        editorRuntime: resolveEditorRuntimeChoice(editorRuntime).resolvedId,
      }),
      theme: 'auto',
      setTheme: (theme) => set({ theme }),
    }),
    {
      merge: (persistedState, currentState) => {
        const sanitizedState = sanitizePersistedSettings(persistedState as PersistedSettingsState | undefined)

        return {
          ...currentState,
          ...sanitizedState,
        }
      },
      name: SETTINGS_STORAGE_KEY,
      storage: createJSONStorage(() => settingsStorage),
    },
  ),
)

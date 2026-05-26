import { create } from 'zustand'
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware'
import type { AgentRunningPromptBehavior } from '@/features/agent/types'

export type AppTheme = 'light' | 'dark' | 'auto'
export type AppLayoutPreference = 'agent' | 'editor'
export type AgentRunningPromptEnterBehavior = AgentRunningPromptBehavior
export type MeoOutlinePosition = 'left' | 'right'

export type AgentSettings = {
  runningPromptEnterBehavior: AgentRunningPromptEnterBehavior
}

export const AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS: Record<AgentRunningPromptEnterBehavior, string> = {
  followUp: '排队',
  steer: '引导',
}

export type MeoSettings = {
  focusedLineHighlight: boolean
  gitDiffLineHighlights: boolean
  imageFolder: string
  outlinePosition: MeoOutlinePosition
}

interface SettingsState {
  agent: AgentSettings
  layoutPreference: AppLayoutPreference
  meo: MeoSettings
  theme: AppTheme
  setLayoutPreference: (layoutPreference: AppLayoutPreference) => void
  updateAgentSettings: (patch: Partial<AgentSettings>) => void
  updateMeoSettings: (patch: Partial<MeoSettings>) => void
  setTheme: (theme: AppTheme) => void
}

const SETTINGS_STORAGE_KEY = 'aryn:settings'
export const DEFAULT_APP_LAYOUT_PREFERENCE: AppLayoutPreference = 'agent'
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

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  runningPromptEnterBehavior: 'followUp',
}

export function isAgentRunningPromptEnterBehavior(value: unknown): value is AgentRunningPromptEnterBehavior {
  return value === 'followUp' || value === 'steer'
}

export function getAlternateRunningPromptBehavior(
  behavior: AgentRunningPromptEnterBehavior,
): AgentRunningPromptEnterBehavior {
  return behavior === 'steer' ? 'followUp' : 'steer'
}

function sanitizeRunningPromptEnterBehavior(value: unknown): AgentRunningPromptEnterBehavior {
  return isAgentRunningPromptEnterBehavior(value)
    ? value
    : DEFAULT_AGENT_SETTINGS.runningPromptEnterBehavior
}

function sanitizeAgentSettings(value: Partial<AgentSettings> | undefined): AgentSettings {
  return {
    runningPromptEnterBehavior: sanitizeRunningPromptEnterBehavior(value?.runningPromptEnterBehavior),
  }
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
  return value === 'editor' || value === 'agent' ? value : DEFAULT_APP_LAYOUT_PREFERENCE
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      agent: DEFAULT_AGENT_SETTINGS,
      layoutPreference: DEFAULT_APP_LAYOUT_PREFERENCE,
      meo: DEFAULT_MEO_SETTINGS,
      theme: 'auto',
      setLayoutPreference: (layoutPreference) => set({ layoutPreference: sanitizeLayoutPreference(layoutPreference) }),
      setTheme: (theme) => set({ theme }),
      updateAgentSettings: (patch) => set((state) => ({
        agent: sanitizeAgentSettings({
          ...state.agent,
          ...patch,
        }),
      })),
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
          agent: sanitizeAgentSettings(candidate.agent),
          layoutPreference: sanitizeLayoutPreference(candidate.layoutPreference),
          meo: sanitizeMeoSettings(candidate.meo),
        }
      },
    },
  ),
)

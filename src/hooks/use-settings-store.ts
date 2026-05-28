import { create } from 'zustand'
import type {
  AgentRunningPromptEnterBehavior,
  AppLayoutPreference,
  AppTheme,
  PersistedAgentSettings,
  PersistedAppSettings,
  PersistedMeoSettings,
  MeoOutlinePosition,
} from '@/features/persistence/types'

export type {
  AgentRunningPromptEnterBehavior,
  AppLayoutPreference,
  AppTheme,
  MeoOutlinePosition,
}

export type AgentSettings = PersistedAgentSettings
export type MeoSettings = PersistedMeoSettings

export const AGENT_RUNNING_PROMPT_BEHAVIOR_LABELS: Record<AgentRunningPromptEnterBehavior, string> = {
  followUp: '排队',
  steer: '引导',
}

interface SettingsState extends PersistedAppSettings {
  setLayoutPreference: (layoutPreference: AppLayoutPreference) => void
  updateAgentSettings: (patch: Partial<AgentSettings>) => void
  updateMeoSettings: (patch: Partial<MeoSettings>) => void
  setTheme: (theme: AppTheme) => void
}

export const DEFAULT_APP_LAYOUT_PREFERENCE: AppLayoutPreference = 'agent'

const DEFAULT_MEO_SETTINGS: MeoSettings = {
  focusedLineHighlight: false,
  gitDiffLineHighlights: true,
  imageFolder: 'assets',
  outlinePosition: 'right',
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  runningPromptEnterBehavior: 'followUp',
}

const DEFAULT_APP_SETTINGS: PersistedAppSettings = {
  agent: DEFAULT_AGENT_SETTINGS,
  layoutPreference: DEFAULT_APP_LAYOUT_PREFERENCE,
  meo: DEFAULT_MEO_SETTINGS,
  theme: 'auto',
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

function sanitizeTheme(value: unknown): AppTheme {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : DEFAULT_APP_SETTINGS.theme
}

function persistSettingsPatch(patch: Partial<PersistedAppSettings>) {
  if (typeof window === 'undefined') {
    return
  }

  void window.appApi?.updateSettingsState(patch).catch(() => undefined)
}

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  ...DEFAULT_APP_SETTINGS,
  setLayoutPreference: (layoutPreference) => {
    const nextLayoutPreference = sanitizeLayoutPreference(layoutPreference)
    set({ layoutPreference: nextLayoutPreference })
    persistSettingsPatch({ layoutPreference: nextLayoutPreference })
  },
  setTheme: (theme) => {
    const nextTheme = sanitizeTheme(theme)
    set({ theme: nextTheme })
    persistSettingsPatch({ theme: nextTheme })
  },
  updateAgentSettings: (patch) => {
    const agent = sanitizeAgentSettings({
      ...get().agent,
      ...patch,
    })
    set({ agent })
    persistSettingsPatch({ agent })
  },
  updateMeoSettings: (patch) => {
    const meo = sanitizeMeoSettings({
      ...get().meo,
      ...patch,
    })
    set({ meo })
    persistSettingsPatch({ meo })
  },
}))

export function initializeSettingsStore(settings: PersistedAppSettings) {
  useSettingsStore.setState({
    agent: sanitizeAgentSettings(settings.agent),
    layoutPreference: sanitizeLayoutPreference(settings.layoutPreference),
    meo: sanitizeMeoSettings(settings.meo),
    theme: sanitizeTheme(settings.theme),
  })
}

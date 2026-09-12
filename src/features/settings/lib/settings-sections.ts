export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: '外观' },
  { id: 'conversation', label: '对话' },
  { id: 'editor', label: '编辑器' },
  { id: 'providers', label: '服务提供商' },
] as const

export type SettingsSectionId = typeof SETTINGS_SECTIONS[number]['id']

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'appearance'

export function isSettingsSectionId(value: unknown): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((section) => section.id === value)
}

export function normalizeSettingsSection(value: unknown): SettingsSectionId {
  return isSettingsSectionId(value) ? value : DEFAULT_SETTINGS_SECTION
}

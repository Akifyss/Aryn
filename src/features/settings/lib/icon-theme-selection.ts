import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '@/features/workspace/types'

export function resolveActiveWorkspaceIconThemeKey(
  iconTheme: WorkspaceIconTheme | null,
  iconThemeOptions: WorkspaceIconThemeCatalogOption[],
) {
  if (!iconTheme) {
    return null
  }

  const exactKey = `${iconTheme.sourceVsixPath}::${iconTheme.activeThemeId}`
  const exactOption = iconThemeOptions.find((option) => option.key === exactKey)

  if (exactOption) {
    return exactOption.key
  }

  if (iconTheme.sourceKind !== 'bundled') {
    return null
  }

  return iconThemeOptions.find((option) => (
    option.sourceKind === 'bundled'
    && option.themeId === iconTheme.activeThemeId
  ))?.key ?? null
}

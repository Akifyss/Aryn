import { describe, expect, it } from 'vitest'
import { resolveActiveWorkspaceIconThemeKey } from '../src/features/settings/lib/icon-theme-selection'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '../src/features/workspace/types'

function createIconTheme(overrides: Partial<WorkspaceIconTheme> = {}): WorkspaceIconTheme {
  return {
    activeThemeId: 'catppuccin-latte',
    activeThemeLabel: 'Catppuccin Latte',
    defaultFileIcon: null,
    defaultFolderExpandedIcon: null,
    defaultFolderIcon: null,
    defaultRootFolderExpandedIcon: null,
    defaultRootFolderIcon: null,
    extensionLabel: 'Catppuccin Icons for VSCode',
    fileExtensions: {},
    fileNames: {},
    folderNames: {},
    folderNamesExpanded: {},
    sourceKind: 'bundled',
    sourceVsixPath: '/Applications/Aryn.app/Contents/Resources/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix',
    themes: [],
    ...overrides,
  }
}

const options: WorkspaceIconThemeCatalogOption[] = [
  {
    key: '/Users/new-machine/Aryn/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix::catppuccin-latte',
    label: 'Catppuccin Latte',
    sourceKind: 'bundled',
    sourceVsixPath: '/Users/new-machine/Aryn/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix',
    themeId: 'catppuccin-latte',
  },
  {
    key: '/Users/new-machine/Aryn/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix::catppuccin-mocha',
    label: 'Catppuccin Mocha',
    sourceKind: 'bundled',
    sourceVsixPath: '/Users/new-machine/Aryn/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix',
    themeId: 'catppuccin-mocha',
  },
]

describe('workspace icon theme selection display', () => {
  it('does not synthesize a selected key before the active icon theme is loaded', () => {
    expect(resolveActiveWorkspaceIconThemeKey(null, options)).toBeNull()
  })

  it('matches bundled icon themes by theme id when the VSIX path changes across machines', () => {
    const iconTheme = createIconTheme({
      sourceVsixPath: '/Users/old-machine/Aryn/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix',
    })

    expect(resolveActiveWorkspaceIconThemeKey(iconTheme, options))
      .toBe('/Users/new-machine/Aryn/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix::catppuccin-latte')
  })

  it('does not match external icon themes when their VSIX path is unavailable', () => {
    const iconTheme = createIconTheme({
      sourceKind: 'external',
      sourceVsixPath: '/Users/old-machine/Downloads/custom-icons.vsix',
    })

    expect(resolveActiveWorkspaceIconThemeKey(iconTheme, options)).toBeNull()
  })
})

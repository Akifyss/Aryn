import { describe, expect, it } from 'vitest'
import { resolveActiveWorkspaceIconThemeKey } from '../src/features/settings/lib/icon-theme-selection'
import type { WorkspaceIconTheme, WorkspaceIconThemeCatalogOption } from '../src/features/workspace/types'

function createIconTheme(overrides: Partial<WorkspaceIconTheme> = {}): WorkspaceIconTheme {
  return {
    activeThemeId: 'flow-deep',
    activeThemeLabel: 'Flow Deep',
    defaultFileIcon: null,
    defaultFolderExpandedIcon: null,
    defaultFolderIcon: null,
    defaultRootFolderExpandedIcon: null,
    defaultRootFolderIcon: null,
    extensionLabel: 'Flow Icons',
    fileExtensions: {},
    fileNames: {},
    folderNames: {},
    folderNamesExpanded: {},
    sourceKind: 'bundled',
    sourceVsixPath: '/Applications/Aryn.app/Contents/Resources/icon-themes/thang-nm.flow-icons-2.0.2.vsix',
    themes: [],
    ...overrides,
  }
}

const options: WorkspaceIconThemeCatalogOption[] = [
  {
    key: '/Users/new-machine/Aryn/icon-themes/thang-nm.flow-icons-2.0.2.vsix::flow-deep',
    label: 'Flow Deep',
    sourceKind: 'bundled',
    sourceVsixPath: '/Users/new-machine/Aryn/icon-themes/thang-nm.flow-icons-2.0.2.vsix',
    themeId: 'flow-deep',
  },
  {
    key: '/Users/new-machine/Aryn/icon-themes/thang-nm.flow-icons-2.0.2.vsix::flow-dawn',
    label: 'Flow Dawn',
    sourceKind: 'bundled',
    sourceVsixPath: '/Users/new-machine/Aryn/icon-themes/thang-nm.flow-icons-2.0.2.vsix',
    themeId: 'flow-dawn',
  },
]

describe('workspace icon theme selection display', () => {
  it('does not synthesize a selected key before the active icon theme is loaded', () => {
    expect(resolveActiveWorkspaceIconThemeKey(null, options)).toBeNull()
  })

  it('matches bundled icon themes by theme id when the VSIX path changes across machines', () => {
    const iconTheme = createIconTheme({
      sourceVsixPath: '/Users/old-machine/Aryn/icon-themes/thang-nm.flow-icons-2.0.2.vsix',
    })

    expect(resolveActiveWorkspaceIconThemeKey(iconTheme, options))
      .toBe('/Users/new-machine/Aryn/icon-themes/thang-nm.flow-icons-2.0.2.vsix::flow-deep')
  })

  it('does not match external icon themes when their VSIX path is unavailable', () => {
    const iconTheme = createIconTheme({
      sourceKind: 'external',
      sourceVsixPath: '/Users/old-machine/Downloads/custom-icons.vsix',
    })

    expect(resolveActiveWorkspaceIconThemeKey(iconTheme, options)).toBeNull()
  })
})

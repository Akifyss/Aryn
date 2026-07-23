import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  deriveWorkspaceDirectorySidebarState,
  shouldResetAgentLayoutFixedTabState,
} from '../src/features/workspace/hooks/use-workspace-editor-surface-controller'
import {
  FIXED_FILE_TAB_ID,
  FIXED_GIT_TAB_ID,
} from '../src/features/workspace/lib/workspace-tabs'
import { deriveAppOverlayState } from '../src/hooks/use-app-overlay-controller'

describe('application overlay state', () => {
  const closedOverlayState = {
    hasConfirmation: false,
    isCommandPaletteOpen: false,
    isGlobalProjectMenuOpen: false,
    isNewProjectDialogOpen: false,
    isProjectMenuOpen: false,
    isSettingsOpen: false,
  }

  it('keeps the shell and shortcuts unblocked with no overlays', () => {
    expect(deriveAppOverlayState(closedOverlayState)).toEqual({
      isAppModalLayerOpen: false,
      isShortcutBlockingLayerOpen: false,
    })
  })

  it.each([
    'hasConfirmation',
    'isCommandPaletteOpen',
    'isGlobalProjectMenuOpen',
    'isNewProjectDialogOpen',
    'isSettingsOpen',
  ] as const)('treats %s as an application modal layer', (openState) => {
    expect(deriveAppOverlayState({
      ...closedOverlayState,
      [openState]: true,
    })).toEqual({
      isAppModalLayerOpen: true,
      isShortcutBlockingLayerOpen: true,
    })
  })

  it('blocks shortcuts for a drawer-local project menu without elevating the global modal layer', () => {
    expect(deriveAppOverlayState({
      ...closedOverlayState,
      isProjectMenuOpen: true,
    })).toEqual({
      isAppModalLayerOpen: false,
      isShortcutBlockingLayerOpen: true,
    })
  })
})

describe('workspace editor directory sidebar state', () => {
  const availableSidebarState = {
    currentPath: 'C:\\workspace',
    hasActiveDocument: true,
    isAgentLayout: true,
    isDirectorySidebarOpen: true,
    shouldRenderWorkspaceEditor: true,
  }

  it('shows an available open directory sidebar without a duplicate toggle slot', () => {
    expect(deriveWorkspaceDirectorySidebarState(availableSidebarState)).toEqual({
      isDirectorySidebarAvailable: true,
      isDirectorySidebarVisible: true,
      isDirectoryToggleSlotVisible: false,
    })
  })

  it('keeps the toggle slot available when the directory sidebar is closed', () => {
    expect(deriveWorkspaceDirectorySidebarState({
      ...availableSidebarState,
      isDirectorySidebarOpen: false,
    })).toEqual({
      isDirectorySidebarAvailable: true,
      isDirectorySidebarVisible: false,
      isDirectoryToggleSlotVisible: true,
    })
  })

  it.each([
    { currentPath: null },
    { hasActiveDocument: false },
    { isAgentLayout: false },
    { shouldRenderWorkspaceEditor: false },
  ])('disables the directory sidebar when its workspace conditions are not met', (override) => {
    expect(deriveWorkspaceDirectorySidebarState({
      ...availableSidebarState,
      ...override,
    })).toEqual({
      isDirectorySidebarAvailable: false,
      isDirectorySidebarVisible: false,
      isDirectoryToggleSlotVisible: false,
    })
  })
})

describe('workspace editor fixed panel state', () => {
  it.each([
    FIXED_FILE_TAB_ID,
    FIXED_GIT_TAB_ID,
  ])('resets fixed panel state after leaving Agent layout with %s active', (tabId) => {
    expect(shouldResetAgentLayoutFixedTabState(tabId, false)).toBe(true)
  })

  it('preserves fixed panel state while Agent layout is active', () => {
    expect(shouldResetAgentLayoutFixedTabState(FIXED_FILE_TAB_ID, true)).toBe(false)
  })

  it.each([
    null,
    'file:C:\\workspace\\notes.md',
  ])('does not reset fixed panel state for a regular workspace tab', (tabId) => {
    expect(shouldResetAgentLayoutFixedTabState(tabId, false)).toBe(false)
  })
})

describe('application surface controller ownership', () => {
  it('keeps surface state outside App without creating large controller files', async () => {
    const [appSource, editorSurfaceSource, overlaySource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../src/features/workspace/hooks/use-workspace-editor-surface-controller.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../src/hooks/use-app-overlay-controller.ts', import.meta.url),
        'utf8',
      ),
    ])

    expect(appSource).toContain('useWorkspaceEditorSurfaceController({')
    expect(appSource).toContain('useAppOverlayController({')
    expect(appSource).not.toContain('useWorkspaceTabViewState({')
    expect(appSource).not.toContain('useState<SettingsSectionId>')
    expect(appSource).not.toContain('useState<AgentLayoutFixedTab>')
    expect(editorSurfaceSource).toContain('useWorkspaceTabViewState({')

    for (const source of [editorSurfaceSource, overlaySource]) {
      expect(source.split(/\r?\n/).length).toBeLessThan(150)
    }
  })
})

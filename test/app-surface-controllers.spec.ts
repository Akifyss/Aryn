import { describe, expect, it } from 'vitest'
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

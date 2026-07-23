import { useCallback, useState } from 'react'
import type { SettingsSectionId } from '@/features/settings/components/settings-dialog/settings-dialog'

type AppOverlayStateOptions = {
  hasConfirmation: boolean
  isGlobalProjectMenuOpen: boolean
  isNewProjectDialogOpen: boolean
  isProjectMenuOpen: boolean
  isCommandPaletteOpen: boolean
  isSettingsOpen: boolean
}

export function deriveAppOverlayState({
  hasConfirmation,
  isGlobalProjectMenuOpen,
  isNewProjectDialogOpen,
  isProjectMenuOpen,
  isCommandPaletteOpen,
  isSettingsOpen,
}: AppOverlayStateOptions) {
  const isAppModalLayerOpen = (
    isSettingsOpen
    || isCommandPaletteOpen
    || isNewProjectDialogOpen
    || hasConfirmation
    || isGlobalProjectMenuOpen
  )

  return {
    isAppModalLayerOpen,
    isShortcutBlockingLayerOpen: isAppModalLayerOpen || isProjectMenuOpen,
  }
}

type UseAppOverlayControllerOptions = Pick<
  AppOverlayStateOptions,
  | 'hasConfirmation'
  | 'isGlobalProjectMenuOpen'
  | 'isNewProjectDialogOpen'
  | 'isProjectMenuOpen'
> & {
  closeDrawers: () => void
}

export function useAppOverlayController({
  closeDrawers,
  hasConfirmation,
  isGlobalProjectMenuOpen,
  isNewProjectDialogOpen,
  isProjectMenuOpen,
}: UseAppOverlayControllerOptions) {
  const [settingsSection, setSettingsSection] =
    useState<SettingsSectionId>('appearance')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const overlayState = deriveAppOverlayState({
    hasConfirmation,
    isCommandPaletteOpen,
    isGlobalProjectMenuOpen,
    isNewProjectDialogOpen,
    isProjectMenuOpen,
    isSettingsOpen,
  })
  const closeCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(false)
  }, [])
  const openCommandPaletteFromChrome = useCallback(() => {
    closeDrawers()
    setIsCommandPaletteOpen(true)
  }, [closeDrawers])
  const openSettings = useCallback((section?: SettingsSectionId) => {
    if (section !== undefined) {
      setSettingsSection(section)
    }

    setIsSettingsOpen(true)
  }, [])
  const toggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen((currentValue) => !currentValue)
  }, [])

  return {
    ...overlayState,
    closeCommandPalette,
    isCommandPaletteOpen,
    isSettingsOpen,
    openCommandPaletteFromChrome,
    openSettings,
    setIsSettingsOpen,
    setSettingsSection,
    settingsSection,
    toggleCommandPalette,
  }
}

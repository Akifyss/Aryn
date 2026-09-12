import { useCallback, useState } from 'react'
import {
  DEFAULT_SETTINGS_SECTION,
  normalizeSettingsSection,
  type SettingsSectionId,
} from '@/features/settings/lib/settings-sections'

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
    useState<SettingsSectionId>(DEFAULT_SETTINGS_SECTION)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const validSettingsSection = normalizeSettingsSection(settingsSection)
  // Keep selection validity with its owner, including state retained across code updates.
  // Adjust our own state before children render; the view never repairs its parent's state.
  if (settingsSection !== validSettingsSection) {
    setSettingsSection(validSettingsSection)
  }
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
  // Opening is a no-argument UI action; navigation requires a section explicitly.
  // An optional section would survive () => void props and receive DOM click events.
  const openSettings = useCallback(() => {
    setIsSettingsOpen(true)
  }, [])
  const openSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section)
    setIsSettingsOpen(true)
  }, [])
  const selectSettingsSection = useCallback((section: SettingsSectionId) => {
    setSettingsSection(section)
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
    openSettingsSection,
    selectSettingsSection,
    setIsSettingsOpen,
    settingsSection: validSettingsSection,
    toggleCommandPalette,
  }
}

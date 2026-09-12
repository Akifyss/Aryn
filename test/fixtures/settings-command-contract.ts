import type { MouseEventHandler } from 'react'
import type { useAppOverlayController } from '../../src/hooks/use-app-overlay-controller'

declare const actions: ReturnType<typeof useAppOverlayController>

const buttonAction: MouseEventHandler<HTMLButtonElement> = actions.openSettings
const shellAction: () => void = actions.openSettings
void buttonAction
void shellAction
actions.openSettingsSection('providers')
actions.selectSettingsSection('editor')

// @ts-expect-error Opening without navigation must not accept a section or UI event.
actions.openSettings('providers')
// @ts-expect-error Section navigation requires an explicit section.
actions.openSettingsSection()
// @ts-expect-error A section command cannot be erased into a no-argument shell callback.
const erasedSectionCommand: () => void = actions.openSettingsSection
// @ts-expect-error A DOM click cannot be used as a section identifier.
const eventSectionCommand: MouseEventHandler<HTMLButtonElement> = actions.openSettingsSection
// @ts-expect-error Section selection also requires an explicit identifier.
const erasedSelectionCommand: () => void = actions.selectSettingsSection
// @ts-expect-error Only the shared settings catalogue defines valid section identifiers.
actions.openSettingsSection('missing-section')
void erasedSectionCommand
void eventSectionCommand
void erasedSelectionCommand

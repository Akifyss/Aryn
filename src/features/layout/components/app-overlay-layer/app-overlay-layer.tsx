import type { ComponentProps } from 'react'
import { Toast } from '@heroui/react'
import { AppConfirmDialog } from '@/components/app-confirm-dialog/app-confirm-dialog'
import { CommandPalette } from '@/features/command-palette/components/command-palette/command-palette'
import { SettingsDialog } from '@/features/settings/components/settings-dialog/settings-dialog'
import { NewProjectDialog } from '@/features/workspace/components/new-project-dialog/new-project-dialog'
import {
  ProjectMenuLayer,
  type ProjectMenuLayerConfiguration,
} from '@/features/workspace/components/project-menu/project-menu-layer'

type AppOverlayLayerProps = {
  commandPalette: ComponentProps<typeof CommandPalette>
  confirmationDialog: ComponentProps<typeof AppConfirmDialog>
  newProjectDialog: ComponentProps<typeof NewProjectDialog>
  projectMenu: ProjectMenuLayerConfiguration
  settingsDialog: ComponentProps<typeof SettingsDialog>
}

export function AppOverlayLayer({
  commandPalette,
  confirmationDialog,
  newProjectDialog,
  projectMenu,
  settingsDialog,
}: AppOverlayLayerProps) {
  return (
    <>
      <Toast.Provider placement='bottom end' />
      <ProjectMenuLayer
        configuration={projectMenu}
        surface='global'
      />
      <NewProjectDialog {...newProjectDialog} />
      <SettingsDialog {...settingsDialog} />
      <AppConfirmDialog {...confirmationDialog} />
      <CommandPalette {...commandPalette} />
    </>
  )
}

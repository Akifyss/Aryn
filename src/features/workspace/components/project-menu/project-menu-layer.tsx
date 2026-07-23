import type { ComponentProps } from 'react'
import {
  ProjectMenu,
  type ProjectMenuFrameRect,
  type ProjectMenuMode,
  type ProjectMenuSurface,
} from './project-menu'

type ProjectMenuProps = ComponentProps<typeof ProjectMenu>

export type ProjectMenuLayerConfiguration = Omit<
  ProjectMenuProps,
  'frameRect' | 'mode' | 'portalContainer' | 'surface'
> & {
  activeSurface: ProjectMenuSurface
  leftDrawerPortal: HTMLElement | null
  mode: ProjectMenuMode | null
  rightDrawerPortal: HTMLElement | null
}

type ProjectMenuLayerProps = {
  configuration: ProjectMenuLayerConfiguration
  frameRect?: ProjectMenuFrameRect | null
  surface: ProjectMenuSurface
}

export function ProjectMenuLayer({
  configuration,
  frameRect = null,
  surface,
}: ProjectMenuLayerProps) {
  const {
    activeSurface,
    leftDrawerPortal,
    mode,
    rightDrawerPortal,
    ...menuProps
  } = configuration

  if (!mode || activeSurface !== surface) {
    return null
  }

  const portalContainer = surface === 'left-drawer'
    ? leftDrawerPortal
    : surface === 'right-drawer'
      ? rightDrawerPortal
      : null

  if (surface !== 'global' && (!frameRect || !portalContainer)) {
    return null
  }

  return (
    <ProjectMenu
      {...menuProps}
      frameRect={frameRect}
      mode={mode}
      portalContainer={portalContainer}
      surface={surface}
    />
  )
}

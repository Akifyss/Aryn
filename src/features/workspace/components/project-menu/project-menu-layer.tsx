import type { ComponentProps } from 'react'
import { ProjectMenu, type ProjectMenuMode } from './project-menu'

export type ProjectMenuLayerConfiguration = Omit<ComponentProps<typeof ProjectMenu>,
  'frameRect' | 'mode' | 'portalContainer' | 'surface'
> & { mode: ProjectMenuMode | null }

export function ProjectMenuLayer({ configuration }: { configuration: ProjectMenuLayerConfiguration }) {
  const { mode, ...props } = configuration
  return mode ? <ProjectMenu {...props} mode={mode} surface='global' /> : null
}

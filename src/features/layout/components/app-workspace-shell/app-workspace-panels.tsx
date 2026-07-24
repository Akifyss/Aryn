import type { ComponentProps } from 'react'
import { AgentChatSurface } from '@/features/agent/components/agent-sidebar/agent-sidebar'
import type { useShellLayoutController } from '@/features/layout/hooks/use-shell-layout-controller'
import { ProjectBootstrap } from '@/features/workspace/components/project-bootstrap/project-bootstrap'
import type {
  ProjectMenuLayerConfiguration,
} from '@/features/workspace/components/project-menu/project-menu-layer'
import type { ProjectMenuSurface } from '@/features/workspace/components/project-menu/project-menu'
import { WorkspaceEditorWorkbench } from '@/features/workspace/components/workspace-workbench/workspace-editor-workbench'
import type {
  WorkspaceNavigationPanelConfiguration,
} from '@/features/workspace/components/workspace-workbench/workspace-navigation-panels'
import { WorkspaceNavigationSurface } from '@/features/workspace/components/workspace-workbench/workspace-navigation-surface'
import type {
  WorkspaceSidebarSurfaceMode,
} from '@/features/workspace/components/workspace-sidebar/workspace-sidebar'

type WorkspaceNavigationSurfaceProps = ComponentProps<
  typeof WorkspaceNavigationSurface
>

type WorkspacePanelLayout = Pick<
  ReturnType<typeof useShellLayoutController>,
  | 'handleLeftDrawerOpenChange'
  | 'isLeftDrawerOpen'
  | 'isLeftSidebarDrawer'
  | 'isLeftSidebarVisible'
  | 'leftDrawerOverlayRoot'
  | 'leftDrawerSurfaceRef'
  | 'setLeftDrawerOverlayRoot'
  | 'shellChromeVars'
  | 'shellPlatform'
  | 'toggleWorkspaceSidebar'
>

export type AppWorkspacePanelConfiguration = {
  editor: ComponentProps<typeof WorkspaceEditorWorkbench>
  isAgentLayout: boolean
  navigation: {
    configuration: WorkspaceNavigationPanelConfiguration
    isPickingWorkspace: boolean
    isProjectAddMenuOpenForSurface: (surface: ProjectMenuSurface) => boolean
    onOpenCommandPalette: WorkspaceNavigationSurfaceProps['onOpenCommandPalette']
    onOpenProjectMenu: WorkspaceNavigationSurfaceProps['onOpenProjectMenu']
    onOpenSettings: WorkspaceNavigationSurfaceProps['onOpenSettings']
  }
  projectBootstrap: {
    isVisible: boolean
    props: ComponentProps<typeof ProjectBootstrap>
  }
}

type AppWorkspaceNavigationPanelProps = {
  configuration: AppWorkspacePanelConfiguration
  layout: WorkspacePanelLayout
  projectMenu: ProjectMenuLayerConfiguration
  surfaceMode: WorkspaceSidebarSurfaceMode
}

export function AppWorkspaceNavigationPanel({
  configuration,
  layout,
  projectMenu,
  surfaceMode,
}: AppWorkspaceNavigationPanelProps) {
  const projectMenuSurface = surfaceMode === 'drawer'
    ? 'left-drawer'
    : 'global'

  return (
    <WorkspaceNavigationSurface
      configuration={configuration.navigation.configuration}
      isAgentLayout={configuration.isAgentLayout}
      isDrawerOpen={layout.isLeftDrawerOpen}
      isPickingWorkspace={configuration.navigation.isPickingWorkspace}
      isProjectAddMenuOpen={configuration.navigation.isProjectAddMenuOpenForSurface(
        projectMenuSurface,
      )}
      isSidebarDrawer={layout.isLeftSidebarDrawer}
      isSidebarVisible={layout.isLeftSidebarVisible}
      overlayRoot={layout.leftDrawerOverlayRoot}
      overlayRootRef={layout.setLeftDrawerOverlayRoot}
      projectMenu={projectMenu}
      shellChromeStyle={layout.shellChromeVars}
      shellPlatform={layout.shellPlatform}
      surfaceMode={surfaceMode}
      surfaceRef={layout.leftDrawerSurfaceRef}
      onOpenCommandPalette={configuration.navigation.onOpenCommandPalette}
      onOpenProjectMenu={configuration.navigation.onOpenProjectMenu}
      onOpenSettings={configuration.navigation.onOpenSettings}
      onRequestDrawerClose={() => layout.handleLeftDrawerOpenChange(false)}
      onToggleSidebar={layout.toggleWorkspaceSidebar}
    />
  )
}

export function AppWorkspaceCenterPanel({
  configuration,
}: {
  configuration: AppWorkspacePanelConfiguration
}) {
  if (configuration.projectBootstrap.isVisible) {
    return <ProjectBootstrap {...configuration.projectBootstrap.props} />
  }

  return configuration.isAgentLayout
    ? <AgentChatSurface />
    : <WorkspaceEditorWorkbench {...configuration.editor} />
}

export function AppWorkspaceRightPanel({
  configuration,
  surfaceMode,
}: {
  configuration: AppWorkspacePanelConfiguration
  surfaceMode: WorkspaceSidebarSurfaceMode
}) {
  if (surfaceMode === 'docked' && configuration.projectBootstrap.isVisible) {
    return null
  }

  return configuration.isAgentLayout
    ? <WorkspaceEditorWorkbench {...configuration.editor} />
    : <AgentChatSurface />
}

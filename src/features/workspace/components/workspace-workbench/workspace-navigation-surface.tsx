import type { ComponentProps } from 'react'
import {
  AgentSessionTree,
} from '@/features/agent/components/agent-sidebar/agent-sidebar'
import {
  AppChromeSearchButton,
  AppChromeSidebarToggleButton,
} from '@/features/layout/components/app-chrome-controls/app-chrome-controls'
import {
  ProjectMenuLayer,
  type ProjectMenuLayerConfiguration,
} from '@/features/workspace/components/project-menu/project-menu-layer'
import type {
  ProjectMenuAnchorRect,
  ProjectMenuMode,
  ProjectMenuSurface,
} from '@/features/workspace/components/project-menu/project-menu'
import {
  WorkspaceSidebar,
  type WorkspaceSidebarSurfaceMode,
} from '@/features/workspace/components/workspace-sidebar/workspace-sidebar'
import {
  WorkspaceNavigationPanels,
  type WorkspaceNavigationPanelConfiguration,
} from './workspace-navigation-panels'

type WorkspaceSidebarProps = ComponentProps<typeof WorkspaceSidebar>

type WorkspaceNavigationSurfaceProps = {
  configuration: WorkspaceNavigationPanelConfiguration
  isAgentLayout: boolean
  isDrawerOpen: boolean
  isPickingWorkspace: boolean
  isProjectAddMenuOpen: boolean
  isSidebarDrawer: boolean
  isSidebarVisible: boolean
  overlayRoot: HTMLElement | null
  overlayRootRef: WorkspaceSidebarProps['overlayRootRef']
  projectMenu: ProjectMenuLayerConfiguration
  shellChromeStyle: WorkspaceSidebarProps['chromeStyle']
  shellPlatform: WorkspaceSidebarProps['platform']
  surfaceMode: WorkspaceSidebarSurfaceMode
  surfaceRef: WorkspaceSidebarProps['surfaceRef']
  onOpenCommandPalette: () => void
  onOpenProjectMenu: (
    mode: ProjectMenuMode,
    surface: ProjectMenuSurface,
    anchorRect: ProjectMenuAnchorRect | undefined,
  ) => void
  onOpenSettings: () => void
  onRequestDrawerClose: () => void
  onToggleSidebar: () => void
}

export function WorkspaceNavigationSurface({
  configuration,
  isAgentLayout,
  isDrawerOpen,
  isPickingWorkspace,
  isProjectAddMenuOpen,
  isSidebarDrawer,
  isSidebarVisible,
  overlayRoot,
  overlayRootRef,
  projectMenu,
  shellChromeStyle,
  shellPlatform,
  surfaceMode,
  surfaceRef,
  onOpenCommandPalette,
  onOpenProjectMenu,
  onOpenSettings,
  onRequestDrawerClose,
  onToggleSidebar,
}: WorkspaceNavigationSurfaceProps) {
  const isDrawerSurface = surfaceMode === 'drawer'
  const projectMenuSurface: ProjectMenuSurface = isDrawerSurface
    ? 'left-drawer'
    : 'global'

  return (
    <WorkspaceSidebar
      chromeStyle={shellChromeStyle}
      drawerHeaderActions={isDrawerSurface ? (
        <>
          <AppChromeSearchButton onClick={onOpenCommandPalette} />
          <AppChromeSidebarToggleButton
            isDrawer={isSidebarDrawer}
            isDrawerOpen={isDrawerOpen}
            isSidebarVisible={isSidebarVisible}
            onClick={onToggleSidebar}
          />
        </>
      ) : undefined}
      hasWorkspace={Boolean(configuration.treePanel.workspacePath)}
      isPickingWorkspace={isPickingWorkspace}
      overlay={isDrawerSurface ? (
        <ProjectMenuLayer
          configuration={projectMenu}
          frameRect={overlayRoot?.getBoundingClientRect() ?? null}
          surface='left-drawer'
        />
      ) : undefined}
      overlayRootRef={isDrawerSurface ? overlayRootRef : undefined}
      platform={shellPlatform}
      showWorkspaceSwitch={!isAgentLayout}
      surfaceMode={surfaceMode}
      surfaceRef={isDrawerSurface ? surfaceRef : undefined}
      workspaceLabel={configuration.workspaceLabel}
      onOpenSettings={() => {
        onOpenSettings()

        if (isDrawerSurface) {
          onRequestDrawerClose()
        }
      }}
      onOpenWorkspaceSwitch={(anchorRect) => {
        onOpenProjectMenu('editor-switch', projectMenuSurface, anchorRect)
      }}
    >
      {isAgentLayout ? (
        <AgentSessionTree
          isProjectAddMenuOpen={isProjectAddMenuOpen}
          menuPortalTarget={isDrawerSurface ? overlayRoot : null}
          onOpenProjectAddMenu={isDrawerSurface
            ? (anchorRect) => onOpenProjectMenu('agent-add', 'left-drawer', anchorRect)
            : undefined}
          onRequestClose={isDrawerSurface ? onRequestDrawerClose : undefined}
        />
      ) : (
        <WorkspaceNavigationPanels
          configuration={configuration}
          menuPortalTarget={overlayRoot}
          surfaceMode={surfaceMode}
        />
      )}
    </WorkspaceSidebar>
  )
}

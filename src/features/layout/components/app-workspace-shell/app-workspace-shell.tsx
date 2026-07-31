import type { ReactNode } from 'react'
import { FolderLine, GitBranchLine } from '@mingcute/react'
import { AppIconButton } from '@/components/app-icon-button'
import {
  AppChromeSearchButton,
  AppChromeSidebarToggleButton,
  AppLayoutModeSwitch,
} from '@/features/layout/components/app-chrome-controls/app-chrome-controls'
import { AppShell } from '@/features/layout/components/app-shell/app-shell'
import type { useShellLayoutController } from '@/features/layout/hooks/use-shell-layout-controller'
import type { AppLayoutPreference } from '@/hooks/use-settings-store'
import {
  ProjectMenuLayer,
  type ProjectMenuLayerConfiguration,
} from '@/features/workspace/components/project-menu/project-menu-layer'
import {
  FIXED_FILE_TAB_ID,
  FIXED_GIT_TAB_ID,
  type AgentLayoutFixedTab,
} from '@/features/workspace/lib/workspace-tabs'
import {
  AppWorkspaceCenterPanel,
  AppWorkspaceNavigationPanel,
  AppWorkspaceRightPanel,
  type AppWorkspacePanelConfiguration,
} from './app-workspace-panels'

type AppWorkspaceShellProps = {
  appLayout: AppLayoutPreference
  children?: ReactNode
  isDarkTheme: boolean
  isEditorLayoutSwitchDisabled: boolean
  isModalLayerOpen: boolean
  layout: ReturnType<typeof useShellLayoutController>
  panels: AppWorkspacePanelConfiguration
  projectMenu: ProjectMenuLayerConfiguration
  shouldExposeRightPanelTools: boolean
  onActivateFileTab: (tabId: string) => void
  onLayoutChange: (layout: AppLayoutPreference) => void
  onRequestWindowClose: () => void
}

export function AppWorkspaceShell({
  appLayout,
  children,
  isDarkTheme,
  isEditorLayoutSwitchDisabled,
  isModalLayerOpen,
  layout,
  panels,
  projectMenu,
  shouldExposeRightPanelTools,
  onActivateFileTab,
  onLayoutChange,
  onRequestWindowClose,
}: AppWorkspaceShellProps) {
  const handleCollapsedFixedTabClick = (tab: AgentLayoutFixedTab) => {
    layout.expandCollapsedAssistantSurface()
    onActivateFileTab(tab === 'git' ? FIXED_GIT_TAB_ID : FIXED_FILE_TAB_ID)
  }

  return (
    <AppShell
      appLayout={appLayout}
      isDarkTheme={isDarkTheme}
      isModalLayerOpen={isModalLayerOpen}
      layout={layout}
      layoutModeSwitch={(
        <AppLayoutModeSwitch
          isEditorDisabled={isEditorLayoutSwitchDisabled}
          value={appLayout}
          onValueChange={onLayoutChange}
        />
      )}
      leftChromeSearchAction={(
        <AppChromeSearchButton
          onClick={panels.navigation.onOpenCommandPalette}
        />
      )}
      leftChromeSidebarAction={(
        <AppChromeSidebarToggleButton
          isDrawer={layout.isLeftSidebarDrawer}
          isDrawerOpen={layout.isLeftDrawerOpen}
          isSidebarVisible={layout.isLeftSidebarVisible}
          onClick={layout.toggleWorkspaceSidebar}
        />
      )}
      onRequestWindowClose={onRequestWindowClose}
      renderCenterPanel={() => (
        <AppWorkspaceCenterPanel configuration={panels} />
      )}
      renderLeftSidebar={(surfaceMode) => (
        <AppWorkspaceNavigationPanel
          configuration={panels}
          layout={layout}
          projectMenu={projectMenu}
          surfaceMode={surfaceMode}
        />
      )}
      renderRightDrawerOverlay={(frameRect) => (
        <ProjectMenuLayer
          configuration={projectMenu}
          frameRect={frameRect}
          surface='right-drawer'
        />
      )}
      renderRightPanel={(surfaceMode) => (
        <AppWorkspaceRightPanel
          configuration={panels}
          surfaceMode={surfaceMode}
        />
      )}
      rightCollapsedActions={(
        <>
          <AppIconButton
            type='button'
            data-window-chrome-button='true'
            aria-label='Expand right sidebar and open Git'
            tooltip='更改'
            preventFocusOnPress
            onClick={() => handleCollapsedFixedTabClick('git')}
          >
            <GitBranchLine size={16} />
          </AppIconButton>
          <AppIconButton
            type='button'
            data-window-chrome-button='true'
            aria-label='Expand right sidebar and open files'
            tooltip='文件'
            preventFocusOnPress
            onClick={() => handleCollapsedFixedTabClick('file')}
          >
            <FolderLine size={16} />
          </AppIconButton>
        </>
      )}
      shouldExposeRightPanelTools={shouldExposeRightPanelTools}
    >
      {children}
    </AppShell>
  )
}

import type { CSSProperties, ReactNode, Ref } from 'react'
import { Icon } from '@iconify/react'
import { DownLine } from '@mingcute/react'
import { ProjectIcon } from '@/components/project-icon'
import type { ShellPlatform } from '@/features/layout/shell-layout'
import './styles.css'

export type WorkspaceSidebarSurfaceMode = 'docked' | 'drawer'

type WorkspaceSidebarProps = {
  bodyRef?: Ref<HTMLDivElement>
  children: ReactNode
  chromeStyle?: CSSProperties
  drawerHeaderActions?: ReactNode
  hasWorkspace: boolean
  isPickingWorkspace: boolean
  overlay?: ReactNode
  overlayRootRef?: Ref<HTMLDivElement>
  platform: ShellPlatform
  showWorkspaceSwitch: boolean
  surfaceMode: WorkspaceSidebarSurfaceMode
  surfaceRef?: Ref<HTMLDivElement>
  workspaceLabel: string
  onOpenSettings: () => void
  onOpenWorkspaceSwitch: (anchorRect: DOMRect) => void
}

export function WorkspaceSidebar({
  bodyRef,
  children,
  chromeStyle,
  drawerHeaderActions,
  hasWorkspace,
  isPickingWorkspace,
  overlay,
  overlayRootRef,
  platform,
  showWorkspaceSwitch,
  surfaceMode,
  surfaceRef,
  workspaceLabel,
  onOpenSettings,
  onOpenWorkspaceSwitch,
}: WorkspaceSidebarProps) {
  const isDrawer = surfaceMode === 'drawer'

  return (
    <div
      ref={surfaceRef}
      className={`workspace-sidebar-surface${isDrawer ? ' is-drawer' : ''}`}
      data-platform={platform}
      style={isDrawer ? chromeStyle : undefined}
    >
      <div className='section-title workspace-section-title'>
        <div className='section-title-drag-spacer' aria-hidden='true' />
        {isDrawer ? drawerHeaderActions : null}
      </div>

      {showWorkspaceSwitch ? (
        <div className='editor-workspace-switch-row'>
          <button
            type='button'
            onClick={(event) => onOpenWorkspaceSwitch(event.currentTarget.getBoundingClientRect())}
            disabled={isPickingWorkspace}
            className={`section-title-text editor-workspace-switch-button${hasWorkspace ? '' : ' is-empty'}`}
            aria-label={isPickingWorkspace ? 'Opening workspace' : '选择或切换工作目录'}
          >
            <ProjectIcon />
            <span className='section-title-label'>{workspaceLabel}</span>
            <DownLine className='editor-workspace-switch-chevron' size={16} aria-hidden='true' />
          </button>
        </div>
      ) : null}

      <div ref={bodyRef} className='sidebar-stack'>
        {children}
      </div>

      <div className='sidebar-footer'>
        <button type='button' className='sidebar-footer-item' onClick={onOpenSettings}>
          <Icon aria-hidden='true' icon='lucide:settings' width={16} height={16} />
          <span>设置</span>
        </button>
      </div>

      {isDrawer ? (
        <div ref={overlayRootRef} className='drawer-local-overlay-root'>
          {overlay}
        </div>
      ) : null}
    </div>
  )
}

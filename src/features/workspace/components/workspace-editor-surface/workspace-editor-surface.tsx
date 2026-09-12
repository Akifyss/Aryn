import type { ReactNode } from 'react'
import { useEffect } from 'react'
import menuFoldIcon from '@iconify-icons/ri/menu-fold-line'
import menuUnfoldIcon from '@iconify-icons/ri/menu-unfold-line'
import { Icon as OfflineIcon } from '@iconify/react/offline'
import { AppIconButton } from '@/components/app-icon-button'
import { AppLoadingState } from '@/components/app-loading-state'
import {
  ViewerToolbar,
  ViewerToolbarGroup,
} from '@/components/ui/document-viewer-controls'
import { recordOpenFileProfile } from '@/lib/open-file-profile'
import './styles.css'

type WorkspaceEditorSurfaceProps = {
  contentPanelId?: string
  children: ReactNode
  tabs: ReactNode
}

type WorkspaceEditorDirectoryToggleProps = {
  side?: 'left' | 'right'
  controls?: string
  isVisible: boolean
  onToggle: () => void
}

type WorkspaceEditorViewProps = {
  children: ReactNode
  leadingToolbarAction?: ReactNode
}

export function WorkspaceEditorSurface({ children, tabs, contentPanelId = 'editor-content-panel' }: WorkspaceEditorSurfaceProps) {
  return (
    <div className='editor-frame'>
      {tabs}
      <div
        aria-label='Editor content'
        className='editor-content-shell'
        id={contentPanelId}
        role='tabpanel'
      >
        {children}
      </div>
    </div>
  )
}

export function WorkspaceEditorDirectorySidebar({ children, side = 'left', id }: { children: ReactNode; side?: 'left' | 'right'; id?: string }) {
  return <aside id={id} className='editor-directory-sidebar' data-side={side}>{children}</aside>
}

export function WorkspaceEditorDirectoryToggle({
  side,
  controls,
  isVisible,
  onToggle,
}: WorkspaceEditorDirectoryToggleProps) {
  return (
    <AppIconButton
      type='button'
      className='editor-directory-toggle'
      aria-label={`${isVisible ? '隐藏' : '显示'}${side === 'left' ? '左侧' : side === 'right' ? '右侧' : ''}目录侧边栏`}
      aria-controls={controls}
      aria-expanded={isVisible}
      data-side={side}
      aria-pressed={isVisible}
      onClick={onToggle}
      tooltip={isVisible ? '隐藏目录' : '显示目录'}
    >
      <OfflineIcon
        aria-hidden='true'
        icon={isVisible ? menuFoldIcon : menuUnfoldIcon}
      />
    </AppIconButton>
  )
}

export function WorkspaceEditorView({
  children,
  leadingToolbarAction,
}: WorkspaceEditorViewProps) {
  return (
    <div className='editor-view-shell'>
      {leadingToolbarAction ? (
        <ViewerToolbar aria-label='编辑器工具栏'>
          <ViewerToolbarGroup>{leadingToolbarAction}</ViewerToolbarGroup>
        </ViewerToolbar>
      ) : null}
      {children}
    </div>
  )
}

export function WorkspaceEditorLoadingState({ label = '正在加载编辑器…' }: { label?: string }) {
  useEffect(() => {
    recordOpenFileProfile('editor:fallback:mounted', { label })

    return () => {
      recordOpenFileProfile('editor:fallback:unmounted', { label })
    }
  }, [label])

  return <AppLoadingState className='editor-lazy-fallback' label={label} />
}

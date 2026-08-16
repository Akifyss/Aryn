import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import {
  FolderOpenLine,
  LayoutLeftbarCloseLine,
  LayoutLeftbarOpenLine,
} from '@mingcute/react'
import { AppButton } from '@/components/app-button'
import { AppIconButton } from '@/components/app-icon-button'
import { AppLoadingState } from '@/components/app-loading-state'
import { EMPTY_STATE_ICONS, EmptyState } from '@/components/empty-state'
import { recordOpenFileProfile } from '@/lib/open-file-profile'
import './styles.css'

type WorkspaceEditorSurfaceProps = {
  children: ReactNode
  tabs: ReactNode
}

type WorkspaceEditorDirectoryToggleProps = {
  isVisible: boolean
  onToggle: () => void
}

type WorkspaceEditorEmptyStateProps = {
  hasWorkspace: boolean
  isPickingWorkspace: boolean
  onOpenWorkspaceSwitch: (anchorRect?: DOMRect) => void
}

type WorkspaceEditorViewProps = {
  children: ReactNode
  leadingToolbarAction?: ReactNode
}

export function WorkspaceEditorSurface({ children, tabs }: WorkspaceEditorSurfaceProps) {
  return (
    <div className='editor-frame'>
      {tabs}
      <div
        aria-label='Editor content'
        className='editor-content-shell'
        id='editor-content-panel'
        role='tabpanel'
      >
        {children}
      </div>
    </div>
  )
}

export function WorkspaceEditorDirectorySidebar({ children }: { children: ReactNode }) {
  return <aside className='editor-directory-sidebar'>{children}</aside>
}

export function WorkspaceEditorDirectoryToggle({
  isVisible,
  onToggle,
}: WorkspaceEditorDirectoryToggleProps) {
  return (
    <AppIconButton
      type='button'
      className='editor-directory-toggle'
      aria-label={isVisible ? '隐藏目录侧边栏' : '显示目录侧边栏'}
      aria-pressed={isVisible}
      onClick={onToggle}
      tooltip={isVisible ? '隐藏目录' : '显示目录'}
    >
      {isVisible
        ? <LayoutLeftbarCloseLine aria-hidden='true' />
        : <LayoutLeftbarOpenLine aria-hidden='true' />}
    </AppIconButton>
  )
}

export function WorkspaceEditorDirectoryToggleSlot({ children }: { children: ReactNode }) {
  return <div className='editor-directory-toggle-slot'>{children}</div>
}

export function WorkspaceEditorDirectoryToggleSpacer() {
  return <span className='editor-directory-toggle-spacer' aria-hidden='true' />
}

export function WorkspaceEditorEmptyState({
  hasWorkspace,
  isPickingWorkspace,
  onOpenWorkspaceSwitch,
}: WorkspaceEditorEmptyStateProps) {
  const workspaceTriggerRef = useRef<HTMLButtonElement | null>(null)

  if (hasWorkspace) {
    return <EmptyState fill title='未打开文件' />
  }

  return (
    <EmptyState
      fill
      className='editor-workspace-empty-state'
      description='当前对话会保留在右侧。连接一个文件夹后，可以在这里浏览、搜索和编辑文件。'
      icon={EMPTY_STATE_ICONS.newFolder}
      title='选择工作目录'
      actions={(
        <AppButton
          ref={workspaceTriggerRef}
          variant='primary'
          onClick={() => {
            onOpenWorkspaceSwitch(workspaceTriggerRef.current?.getBoundingClientRect())
          }}
          disabled={isPickingWorkspace}
        >
          <FolderOpenLine aria-hidden='true' />
          选择工作目录
        </AppButton>
      )}
    />
  )
}

export function WorkspaceEditorView({
  children,
  leadingToolbarAction,
}: WorkspaceEditorViewProps) {
  return (
    <div className='editor-view-shell'>
      {leadingToolbarAction ? (
        <div className='editor-plain-toolbar'>
          {leadingToolbarAction}
        </div>
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

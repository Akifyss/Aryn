import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { Button } from '@heroui/react'
import { Icon } from '@iconify/react'
import { FolderOpenLine } from '@mingcute/react'
import { AppTooltipButton } from '@/components/app-tooltip'
import { EmptyState } from '@/components/empty-state'
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
      <div className='editor-content-shell' id='editor-content-panel'>
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
    <AppTooltipButton
      type='button'
      className={`editor-directory-toggle${isVisible ? ' is-active' : ''}`}
      aria-label={isVisible ? '隐藏目录侧边栏' : '显示目录侧边栏'}
      aria-pressed={isVisible}
      onClick={onToggle}
      tooltip={isVisible ? '隐藏目录' : '显示目录'}
    >
      <Icon
        icon={isVisible ? 'ri:menu-fold-line' : 'ri:menu-fold-2-line'}
        width={16}
        height={16}
        aria-hidden='true'
      />
    </AppTooltipButton>
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
    <div className='editor-empty-state is-workspace-missing'>
      <div className='editor-empty-content'>
        <div className='editor-empty-logo-shell' aria-hidden='true'>
          <FolderOpenLine className='editor-empty-folder-icon' size={30} />
        </div>
        <div className='editor-empty-copy'>
          <h3>选择工作目录</h3>
          <p>当前对话会保留在右侧。连接一个文件夹后，可以在这里浏览、搜索和编辑文件。</p>
        </div>
        <div className='editor-empty-actions'>
          <Button
            ref={workspaceTriggerRef}
            variant='primary'
            onPress={() => {
              onOpenWorkspaceSwitch(workspaceTriggerRef.current?.getBoundingClientRect())
            }}
            isDisabled={isPickingWorkspace}
          >
            <FolderOpenLine className='mr-2' size={16} aria-hidden='true' />
            选择工作目录
          </Button>
        </div>
      </div>
    </div>
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

export function WorkspaceEditorLoadingState({ label = 'Loading editor...' }: { label?: string }) {
  useEffect(() => {
    recordOpenFileProfile('editor:fallback:mounted', { label })

    return () => {
      recordOpenFileProfile('editor:fallback:unmounted', { label })
    }
  }, [label])

  return (
    <div className='editor-lazy-fallback' role='status' aria-live='polite'>
      <span className='editor-lazy-spinner' aria-hidden='true' />
      <span>{label}</span>
    </div>
  )
}

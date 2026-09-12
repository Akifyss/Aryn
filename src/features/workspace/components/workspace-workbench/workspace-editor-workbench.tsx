import { useId, type ComponentProps, type ReactNode } from 'react'
import { FileTabs } from '@/features/workspace/components/file-tabs/file-tabs'
import { WorkspaceEditorContent } from '@/features/workspace/components/workspace-editor-content/workspace-editor-content'
import { WorkspaceEditorDirectorySidebar, WorkspaceEditorSurface } from '@/features/workspace/components/workspace-editor-surface/workspace-editor-surface'

type WorkspaceEditorWorkbenchProps = {
  directorySidebarContent?: ReactNode
  directorySidebarSide?: 'left' | 'right'
  directorySidebarId?: string
  auxiliaryContent?: ReactNode
  fixedPanelContent?: ReactNode
  editorContent: Omit<ComponentProps<typeof WorkspaceEditorContent>, 'leadingToolbarAction'>
  fileTabs: ComponentProps<typeof FileTabs>
  isDirectorySidebarVisible: boolean
}

export function WorkspaceEditorWorkbench({
  directorySidebarContent, directorySidebarSide = 'left', directorySidebarId,
  auxiliaryContent, fixedPanelContent, editorContent, fileTabs, isDirectorySidebarVisible,
}: WorkspaceEditorWorkbenchProps) {
  const contentPanelId = useId()
  const directorySidebar = isDirectorySidebarVisible ? (
    <WorkspaceEditorDirectorySidebar side={directorySidebarSide} id={directorySidebarId}>
      {directorySidebarContent}
    </WorkspaceEditorDirectorySidebar>
  ) : null

  return (
    <WorkspaceEditorSurface contentPanelId={contentPanelId} tabs={<FileTabs {...fileTabs} contentPanelId={contentPanelId} />}>
      {directorySidebarSide === 'left' ? directorySidebar : null}
      {fixedPanelContent}
      {auxiliaryContent}
      <WorkspaceEditorContent {...editorContent} />
      {directorySidebarSide === 'right' ? directorySidebar : null}
    </WorkspaceEditorSurface>
  )
}

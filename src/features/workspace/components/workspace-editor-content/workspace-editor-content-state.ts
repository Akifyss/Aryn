import type {
  WorkspaceDiffTab,
  WorkspaceFileTab,
} from '@/features/workspace/store/use-workspace-store'

export type WorkspaceEditorContentKind =
  | 'code'
  | 'diff'
  | 'file'
  | 'html-preview'
  | 'meo'

type WorkspaceEditorContentState = {
  activeDiffTab: WorkspaceDiffTab | null
  activeFileTab: WorkspaceFileTab | null
  isVisible: boolean
}

export function resolveWorkspaceEditorContentKind({
  activeDiffTab,
  activeFileTab,
  isVisible,
}: WorkspaceEditorContentState): WorkspaceEditorContentKind | null {
  if (!isVisible) {
    return null
  }

  if (activeDiffTab) {
    return 'diff'
  }

  if (!activeFileTab) {
    return null
  }

  if (activeFileTab.editorKind === 'prose' && activeFileTab.viewMode === 'meo') {
    return 'meo'
  }

  if (
    activeFileTab.viewMode === 'code'
    && (activeFileTab.editorKind === 'code' || activeFileTab.editorKind === 'prose')
  ) {
    return 'code'
  }

  if (activeFileTab.editorKind === 'code' && activeFileTab.viewMode === 'preview') {
    return 'html-preview'
  }

  if (activeFileTab.editorKind === 'file' && activeFileTab.viewMode === 'file') {
    return 'file'
  }

  return null
}

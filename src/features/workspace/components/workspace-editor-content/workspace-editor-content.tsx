import { Suspense, type ReactNode, type Ref } from 'react'
import type { MeoEditorHostHandle } from '@/features/editor/components/meo-editor-host/meo-editor-host'
import {
  CodeEditor,
  GitDiffEditor,
  MeoEditorHost,
} from '@/features/editor/components/lazy-editor-surfaces/lazy-editor-surfaces'
import { HtmlPreview } from '@/features/editor/components/html-preview/html-preview'
import type { MeoOpenGitDiffHandler } from '@/features/editor/lib/meo-native-editor-types'
import type {
  GitChangeItem,
  GitDiffBlockAction,
  GitDiffSelection,
  GitRepositoryState,
} from '@/features/git/types'
import { WorkspaceFilePreview } from '@/features/workspace/components/workspace-file-preview/workspace-file-preview'
import {
  WorkspaceEditorLoadingState,
  WorkspaceEditorView,
} from '@/features/workspace/components/workspace-editor-surface/workspace-editor-surface'
import {
  useWorkspaceStore,
  type WorkspaceDiffTab,
  type WorkspaceFileTab,
} from '@/features/workspace/store/use-workspace-store'
import type { WorkspaceIconTheme } from '@/features/workspace/types'
import type { AppTheme, MeoSettings } from '@/hooks/use-settings-store'
import { resolveWorkspaceEditorContentKind } from './workspace-editor-content-state'

type WorkspaceDiffEditorActions = {
  discardChange: (change: GitChangeItem) => void
  saveEditedFile: (filePath: string, content: string) => Promise<void>
  stagePaths: (filePaths: string[]) => void
  unstagePaths: (filePaths: string[]) => void
}

type WorkspaceFileEditorActions = {
  applyGitDiffSelection: (
    change: GitChangeItem,
    selection: GitDiffSelection,
    action: GitDiffBlockAction,
  ) => Promise<void>
  compositionChange: (isComposing: boolean) => void
  openFile: (filePath: string) => void
  openGitDiff: MeoOpenGitDiffHandler
  saveFile: (filePath: string, content: string) => void
}

type WorkspaceEditorContentProps = {
  activeDiffTab: WorkspaceDiffTab | null
  activeFileTab: WorkspaceFileTab | null
  diffActions: WorkspaceDiffEditorActions
  diffDraftContent: string
  diffHasDirtyRelatedFileTab: boolean
  fileActions: WorkspaceFileEditorActions
  gitRepositoryState: GitRepositoryState | null
  iconTheme: WorkspaceIconTheme | null
  isVisible: boolean
  leadingToolbarAction?: ReactNode
  meoEditorHostRef: Ref<MeoEditorHostHandle>
  meoSettings: MeoSettings
  theme: AppTheme
  workspacePath: string | null
}

export function WorkspaceEditorContent({
  activeDiffTab,
  activeFileTab,
  diffActions,
  diffDraftContent,
  diffHasDirtyRelatedFileTab,
  fileActions,
  gitRepositoryState,
  iconTheme,
  isVisible,
  leadingToolbarAction = null,
  meoEditorHostRef,
  meoSettings,
  theme,
  workspacePath,
}: WorkspaceEditorContentProps) {
  const updateDiffTabDraft = useWorkspaceStore((state) => state.updateDiffTabDraft)
  const updateFileTabsContent = useWorkspaceStore((state) => state.updateFileTabsContent)
  const contentKind = resolveWorkspaceEditorContentKind({
    activeDiffTab,
    activeFileTab,
    isVisible,
  })

  if (contentKind === 'diff' && activeDiffTab) {
    return (
      <Suspense fallback={<WorkspaceEditorLoadingState label='Loading diff editor...' />}>
        <GitDiffEditor
          key={activeDiffTab.id}
          diff={activeDiffTab.diff}
          draftContent={diffDraftContent}
          navigationRequest={activeDiffTab.navigationRequest ?? null}
          hasDirtyRelatedFileTab={diffHasDirtyRelatedFileTab}
          leadingToolbarAction={leadingToolbarAction}
          theme={theme}
          onDiscardChange={diffActions.discardChange}
          onDraftChange={(nextValue) => {
            updateDiffTabDraft(activeDiffTab.id, nextValue)
          }}
          onSaveEditedFile={diffActions.saveEditedFile}
          onStageChange={(change) => {
            diffActions.stagePaths([change.path])
          }}
          onUnstageChange={(change) => {
            diffActions.unstagePaths([change.path])
          }}
        />
      </Suspense>
    )
  }

  if (!activeFileTab) {
    return null
  }

  if (contentKind === 'meo') {
    return (
      <Suspense fallback={<WorkspaceEditorLoadingState />}>
        <MeoEditorHost
          key={activeFileTab.id}
          ref={meoEditorHostRef}
          filePath={activeFileTab.filePath}
          gitDiffRequest={activeFileTab.gitDiffRequest ?? null}
          gitRepositoryState={gitRepositoryState}
          hasLeadingToolbarInset={leadingToolbarAction !== null}
          meoSettings={meoSettings}
          savedValue={activeFileTab.savedContent}
          theme={theme}
          value={activeFileTab.content}
          workspacePath={workspacePath}
          onApplyGitDiffSelection={fileActions.applyGitDiffSelection}
          onChange={(nextValue) => {
            updateFileTabsContent(activeFileTab.filePath, nextValue)
          }}
          onCompositionChange={fileActions.compositionChange}
          onOpenFile={fileActions.openFile}
          onOpenGitDiff={fileActions.openGitDiff}
          onSave={(content) => {
            fileActions.saveFile(activeFileTab.filePath, content)
          }}
        />
      </Suspense>
    )
  }

  if (contentKind === 'code') {
    return (
      <WorkspaceEditorView leadingToolbarAction={leadingToolbarAction}>
        <Suspense fallback={<WorkspaceEditorLoadingState />}>
          <CodeEditor
            key={activeFileTab.id}
            disabled={false}
            filePath={activeFileTab.filePath}
            theme={theme}
            value={activeFileTab.content}
            onChange={(nextValue) => {
              updateFileTabsContent(activeFileTab.filePath, nextValue)
            }}
            onCompositionChange={fileActions.compositionChange}
            onSave={(content) => {
              fileActions.saveFile(activeFileTab.filePath, content)
            }}
          />
        </Suspense>
      </WorkspaceEditorView>
    )
  }

  if (contentKind === 'html-preview') {
    return (
      <WorkspaceEditorView leadingToolbarAction={leadingToolbarAction}>
        <HtmlPreview
          content={activeFileTab.content}
          filePath={activeFileTab.filePath}
        />
      </WorkspaceEditorView>
    )
  }

  if (contentKind === 'file') {
    return (
      <WorkspaceEditorView>
        <Suspense fallback={<WorkspaceEditorLoadingState label='正在加载文件...' />}>
          <WorkspaceFilePreview
            key={activeFileTab.id}
            filePath={activeFileTab.filePath}
            gitRepositoryState={gitRepositoryState}
            iconTheme={iconTheme}
            leadingToolbarActions={leadingToolbarAction}
            meoSettings={meoSettings}
            theme={theme}
            workspacePath={workspacePath}
          />
        </Suspense>
      </WorkspaceEditorView>
    )
  }

  return null
}

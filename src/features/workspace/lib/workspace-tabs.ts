import { isLineWithinVisualDiff } from '@/features/editor/lib/git-diff-navigation'
import type { GitChangeItem, GitFileDiffResult } from '@/features/git/types'
import { getBaseName, normalizeFilePath } from '@/features/workspace/lib/workspace-paths'
import type {
  WorkspaceDiffNavigationRequest,
  WorkspaceDiffTab,
  WorkspaceDisplayTab,
  WorkspaceFileGitDiffRequest,
  WorkspaceFileTab,
  WorkspaceFixedPanelTab,
  WorkspaceTab,
} from '@/features/workspace/store/use-workspace-store'

export const FIXED_FILE_TAB_ID = 'app://fixed/files'
export const FIXED_GIT_TAB_ID = 'app://fixed/git'

export type AgentLayoutFixedTab = 'file' | 'git'

export type WorkspaceTabViewStateOptions = {
  activeAgentLayoutFixedTab: AgentLayoutFixedTab
  activeTabId: string | null
  isAgentLayout: boolean
  isAgentLayoutFixedTabActive: boolean
  openTabs: WorkspaceTab[]
}

export function isWorkspaceFileTab(tab: WorkspaceDisplayTab | null | undefined): tab is WorkspaceFileTab {
  return tab?.kind === 'file'
}

export function isWorkspaceDiffTab(tab: WorkspaceDisplayTab | null | undefined): tab is WorkspaceDiffTab {
  return tab?.kind === 'diff'
}

export function isWorkspaceFixedPanelTab(
  tab: WorkspaceDisplayTab | null | undefined,
): tab is WorkspaceFixedPanelTab {
  return tab?.kind === 'fixed-panel'
}

export function isWorkspaceAutosaveTab(
  tab: WorkspaceDisplayTab | null | undefined,
): tab is WorkspaceFileTab {
  return tab?.kind === 'file' && (tab.viewMode === 'code' || tab.viewMode === 'meo')
}

export function createDiffTabId(diff: GitFileDiffResult) {
  if (diff.source.kind === 'commit') {
    return `git-commit-diff://${diff.source.commit.hash}/${encodeURIComponent(diff.change.path)}`
  }

  const { path: filePath, scope } = diff.change
  return `git-diff://${scope}/${encodeURIComponent(filePath)}`
}

export function getWorkspaceTabSourcePath(
  tab: WorkspaceDisplayTab,
) {
  return tab.kind === 'diff' ? tab.diff.change.path : tab.filePath
}

export function shouldOpenGitDiffForLine(
  diff: GitFileDiffResult,
  source: 'revision' | 'worktree',
  lineNumber?: number,
) {
  if (typeof lineNumber !== 'number') {
    return true
  }

  return isLineWithinVisualDiff(diff.originalContent, diff.modifiedContent, source, lineNumber)
}

export function createWorkspaceFileGitDiffRequest(
  change: GitChangeItem,
  source: 'revision' | 'worktree',
  lineNumber?: number,
  mode: WorkspaceFileGitDiffRequest['mode'] = 'split',
): WorkspaceFileGitDiffRequest {
  return {
    ...(typeof lineNumber === 'number' ? { lineNumber: Math.max(1, Math.floor(lineNumber)) } : null),
    mode,
    requestKey: `${change.scope}:${change.path}:${source}:${lineNumber ?? 'open'}:${Date.now()}`,
    scope: change.scope,
    source,
  }
}

export function getFixedPanelTab(tab: AgentLayoutFixedTab): WorkspaceFixedPanelTab {
  if (tab === 'git') {
    return {
      content: '',
      editorKind: 'prose',
      exists: true,
      filePath: FIXED_GIT_TAB_ID,
      fixedTabKind: 'git-panel',
      id: FIXED_GIT_TAB_ID,
      isDirty: false,
      kind: 'fixed-panel',
      savedContent: '',
    }
  }

  return {
    content: '',
    editorKind: 'prose',
    exists: true,
    filePath: FIXED_FILE_TAB_ID,
    fixedTabKind: 'file-panel',
    id: FIXED_FILE_TAB_ID,
    isDirty: false,
    kind: 'fixed-panel',
    savedContent: '',
  }
}

export function getActiveWorkspaceFilePath(
  openTabs: WorkspaceTab[],
  activeTabId: string | null,
) {
  const activeTab = openTabs.find((tab) => tab.id === activeTabId)
  return activeTab?.kind === 'file' ? activeTab.filePath : null
}

export function deriveWorkspaceTabViewState({
  activeAgentLayoutFixedTab,
  activeTabId,
  isAgentLayout,
  isAgentLayoutFixedTabActive,
  openTabs,
}: WorkspaceTabViewStateOptions) {
  const activeTab = openTabs.find((tab) => tab.id === activeTabId) ?? null
  const activeFileTab = isWorkspaceFileTab(activeTab) ? activeTab : null
  const activeDiffTab = isWorkspaceDiffTab(activeTab) ? activeTab : null
  const activeDiffDraftContent = activeDiffTab?.draftContent ?? activeDiffTab?.diff.modifiedContent ?? ''
  const activeDiffPath = activeDiffTab ? normalizeFilePath(activeDiffTab.diff.change.path) : null
  const activeDiffHasDirtyRelatedFileTab = activeDiffPath !== null && openTabs.some((tab) => (
    isWorkspaceAutosaveTab(tab)
    && tab.isDirty
    && normalizeFilePath(tab.filePath) === activeDiffPath
  ))
  const fixedTabs: WorkspaceDisplayTab[] = isAgentLayout
    ? [getFixedPanelTab('git'), getFixedPanelTab('file')]
    : []
  const displayTabs: WorkspaceDisplayTab[] = [...fixedTabs, ...openTabs]
  const displayActiveTabId = isAgentLayout && (isAgentLayoutFixedTabActive || !activeTabId)
    ? (activeAgentLayoutFixedTab === 'git' ? FIXED_GIT_TAB_ID : FIXED_FILE_TAB_ID)
    : activeTabId
  const displayActiveTab = displayTabs.find((tab) => tab.id === displayActiveTabId) ?? null
  const activeFixedPanelTab = isWorkspaceFixedPanelTab(displayActiveTab) ? displayActiveTab : null

  return {
    activeDiffDraftContent,
    activeDiffHasDirtyRelatedFileTab,
    activeDiffTab,
    activeFileTab,
    activeFixedPanelTab,
    activeWorkspaceAutosaveTab: isWorkspaceAutosaveTab(activeFileTab) ? activeFileTab : null,
    currentEditorKind: activeFileTab?.editorKind ?? null,
    currentFileContent: activeFileTab?.content ?? '',
    currentFilePath: activeFileTab?.filePath ?? null,
    currentFileViewMode: activeFileTab?.viewMode ?? null,
    displayActiveTabId,
    displayTabs,
    shouldRenderWorkspaceEditor: !activeFixedPanelTab,
  }
}

export function createDiffTab(
  diff: GitFileDiffResult,
  navigationRequest?: WorkspaceDiffNavigationRequest | null,
): WorkspaceDiffTab {
  const id = createDiffTabId(diff)

  return {
    draftContent: null,
    diff,
    exists: true,
    filePath: id,
    id,
    isDirty: false,
    kind: 'diff',
    navigationRequest: navigationRequest ?? null,
    title: diff.source.kind === 'commit'
      ? `${getBaseName(diff.change.path)} @ ${diff.source.commit.shortHash}`
      : getBaseName(diff.change.path),
  }
}

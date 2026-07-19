import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GitChangeItem, GitFileDiffResult } from '../src/features/git/types'
import {
  createDiffTab,
  createDiffTabId,
  createWorkspaceFileGitDiffRequest,
  deriveWorkspaceTabViewState,
  FIXED_FILE_TAB_ID,
  FIXED_GIT_TAB_ID,
  getActiveWorkspaceFilePath,
  getFixedPanelTab,
  getWorkspaceTabSourcePath,
  isWorkspaceAutosaveTab,
  isWorkspaceDiffTab,
  isWorkspaceFileTab,
  isWorkspaceFixedPanelTab,
  shouldOpenGitDiffForLine,
} from '../src/features/workspace/lib/workspace-tabs'
import type { WorkspaceFileTab } from '../src/features/workspace/store/use-workspace-store'

const change: GitChangeItem = {
  kind: 'modified',
  originalPath: null,
  path: 'C:/workspace/docs/readme.md',
  relativePath: 'docs/readme.md',
  scope: 'unstaged',
  statusCode: ' M',
}

function createDiff(source: GitFileDiffResult['source'] = { kind: 'working-tree' }): GitFileDiffResult {
  return {
    change,
    editorKind: 'prose',
    modifiedContent: 'first\nchanged\nthird',
    modifiedExists: true,
    modifiedLabel: 'Working tree',
    originalContent: 'first\nsecond\nthird',
    originalExists: true,
    originalLabel: 'Revision',
    repositoryRootPath: 'C:/workspace',
    selections: [{
      modifiedLineCount: 1,
      modifiedStartLine: 2,
      originalLineCount: 1,
      originalStartLine: 2,
    }],
    source,
  }
}

function createFileTab(
  viewMode: WorkspaceFileTab['viewMode'],
  overrides: Partial<WorkspaceFileTab> = {},
): WorkspaceFileTab {
  return {
    content: '# Readme',
    editorKind: 'prose',
    exists: true,
    filePath: change.path,
    id: `file://${viewMode}`,
    isDirty: false,
    kind: 'file',
    savedContent: '# Readme',
    viewMode,
    ...overrides,
  }
}

describe('workspace tab helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('builds stable diff ids for working tree and commit sources', () => {
    expect(createDiffTabId(createDiff())).toBe(`git-diff://unstaged/${encodeURIComponent(change.path)}`)

    const commitDiff = createDiff({
      commit: {
        authorEmail: 'author@example.com',
        authorName: 'Author',
        authorTimeUnix: 1_700_000_000,
        hash: '1234567890abcdef',
        shortHash: '1234567',
        subject: 'Update readme',
      },
      kind: 'commit',
      parentHash: 'abcdef1234567890',
      parentShortHash: 'abcdef1',
    })

    expect(createDiffTabId(commitDiff))
      .toBe(`git-commit-diff://1234567890abcdef/${encodeURIComponent(change.path)}`)
    expect(createDiffTab(commitDiff).title).toBe('readme.md @ 1234567')
  })

  it('creates fixed panel tabs with the expected discriminants', () => {
    const filePanel = getFixedPanelTab('file')
    const gitPanel = getFixedPanelTab('git')

    expect(filePanel).toMatchObject({
      filePath: FIXED_FILE_TAB_ID,
      fixedTabKind: 'file-panel',
      id: FIXED_FILE_TAB_ID,
      kind: 'fixed-panel',
    })
    expect(gitPanel).toMatchObject({
      filePath: FIXED_GIT_TAB_ID,
      fixedTabKind: 'git-panel',
      id: FIXED_GIT_TAB_ID,
      kind: 'fixed-panel',
    })
    expect(isWorkspaceFixedPanelTab(filePanel)).toBe(true)
    expect(isWorkspaceFileTab(filePanel)).toBe(false)
  })

  it('derives fixed and file tab view state for each layout', () => {
    const fileTab = createFileTab('meo')
    const agentState = deriveWorkspaceTabViewState({
      activeAgentLayoutFixedTab: 'file',
      activeTabId: fileTab.id,
      isAgentLayout: true,
      isAgentLayoutFixedTabActive: true,
      openTabs: [fileTab],
    })

    expect(agentState.displayTabs.map((tab) => tab.id)).toEqual([
      FIXED_GIT_TAB_ID,
      FIXED_FILE_TAB_ID,
      fileTab.id,
    ])
    expect(agentState.displayActiveTabId).toBe(FIXED_FILE_TAB_ID)
    expect(agentState.activeFixedPanelTab?.fixedTabKind).toBe('file-panel')
    expect(agentState.shouldRenderWorkspaceEditor).toBe(false)

    const editorState = deriveWorkspaceTabViewState({
      activeAgentLayoutFixedTab: 'git',
      activeTabId: fileTab.id,
      isAgentLayout: false,
      isAgentLayoutFixedTabActive: false,
      openTabs: [fileTab],
    })

    expect(editorState.activeFileTab).toBe(fileTab)
    expect(editorState.currentFileContent).toBe('# Readme')
    expect(editorState.activeWorkspaceAutosaveTab).toBe(fileTab)
    expect(editorState.shouldRenderWorkspaceEditor).toBe(true)
  })

  it('detects dirty file tabs related to the active diff across path formats', () => {
    const diffTab = createDiffTab(createDiff())
    const dirtyFileTab = createFileTab('code', {
      filePath: 'c:\\WORKSPACE\\docs\\readme.md',
      isDirty: true,
    })
    const state = deriveWorkspaceTabViewState({
      activeAgentLayoutFixedTab: 'file',
      activeTabId: diffTab.id,
      isAgentLayout: false,
      isAgentLayoutFixedTabActive: false,
      openTabs: [dirtyFileTab, diffTab],
    })

    expect(state.activeDiffTab).toBe(diffTab)
    expect(state.activeDiffDraftContent).toBe(diffTab.diff.modifiedContent)
    expect(state.activeDiffHasDirtyRelatedFileTab).toBe(true)
    expect(getActiveWorkspaceFilePath([dirtyFileTab, diffTab], dirtyFileTab.id)).toBe(dirtyFileTab.filePath)
    expect(getActiveWorkspaceFilePath([dirtyFileTab, diffTab], diffTab.id)).toBeNull()
  })

  it('creates diff tabs and exposes their underlying source path', () => {
    const navigationRequest = {
      lineNumber: 2,
      requestKey: 'navigation-1',
      source: 'worktree' as const,
    }
    const tab = createDiffTab(createDiff(), navigationRequest)

    expect(tab).toMatchObject({
      filePath: `git-diff://unstaged/${encodeURIComponent(change.path)}`,
      navigationRequest,
      title: 'readme.md',
    })
    expect(isWorkspaceDiffTab(tab)).toBe(true)
    expect(getWorkspaceTabSourcePath(tab)).toBe(change.path)
  })

  it('identifies autosaved file views without treating previews as editable', () => {
    const meoTab = createFileTab('meo')
    const previewTab = createFileTab('preview')

    expect(isWorkspaceFileTab(meoTab)).toBe(true)
    expect(isWorkspaceAutosaveTab(meoTab)).toBe(true)
    expect(isWorkspaceAutosaveTab(previewTab)).toBe(false)
    expect(getWorkspaceTabSourcePath(meoTab)).toBe(change.path)
  })

  it('normalizes Git diff request lines and generates a unique request key', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234)

    expect(createWorkspaceFileGitDiffRequest(change, 'revision', 4.9, 'unified')).toEqual({
      lineNumber: 4,
      mode: 'unified',
      requestKey: `${change.scope}:${change.path}:revision:4.9:1234`,
      scope: 'unstaged',
      source: 'revision',
    })
    expect(createWorkspaceFileGitDiffRequest(change, 'worktree', -5).lineNumber).toBe(1)
  })

  it('opens a diff only when the requested line belongs to a visual change', () => {
    const diff = createDiff()

    expect(shouldOpenGitDiffForLine(diff, 'revision')).toBe(true)
    expect(shouldOpenGitDiffForLine(diff, 'revision', 2)).toBe(true)
    expect(shouldOpenGitDiffForLine(diff, 'worktree', 1)).toBe(false)
  })
})

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { GitChangeItem, GitFileDiffResult } from '../src/features/git/types'
import {
  getDirtyWorkspaceTabs,
  getDirtyWorkspaceTabsForNodePath,
  getDirtyWorkspaceTabsForPaths,
  hasDirtyWorkspaceFileTab,
} from '../src/features/workspace/lib/workspace-document-state'
import { createDiffTab } from '../src/features/workspace/lib/workspace-tabs'
import {
  createWorkspaceFileTabId,
  type WorkspaceDiffTab,
  type WorkspaceFileTab,
  type WorkspaceTab,
} from '../src/features/workspace/store/use-workspace-store'

const workspacePath = 'C:/workspace'
const filePath = `${workspacePath}/docs/readme.md`

function createFileTab(
  viewMode: WorkspaceFileTab['viewMode'],
  overrides: Partial<WorkspaceFileTab> = {},
): WorkspaceFileTab {
  return {
    content: '# Local edit',
    editorKind: 'prose',
    exists: true,
    filePath,
    id: createWorkspaceFileTabId(filePath, viewMode),
    isDirty: true,
    kind: 'file',
    savedContent: '# Saved',
    viewMode,
    ...overrides,
  }
}

function createDiffTabFixture(
  overrides: Partial<WorkspaceDiffTab> = {},
): WorkspaceDiffTab {
  const change: GitChangeItem = {
    kind: 'modified',
    originalPath: null,
    path: filePath,
    relativePath: 'docs/readme.md',
    scope: 'unstaged',
    statusCode: ' M',
  }
  const diff: GitFileDiffResult = {
    change,
    editorKind: 'prose',
    modifiedContent: '# Saved',
    modifiedExists: true,
    modifiedLabel: 'Working tree',
    originalContent: '# Original',
    originalExists: true,
    originalLabel: 'Revision',
    repositoryRootPath: workspacePath,
    selections: [],
    source: { kind: 'working-tree' },
  }

  return {
    ...createDiffTab(diff),
    draftContent: '# Local diff edit',
    isDirty: true,
    ...overrides,
  }
}

describe('workspace document state', () => {
  it('includes editable file drafts and working-tree diffs only', () => {
    const codeTab = createFileTab('code')
    const previewTab = createFileTab('preview')
    const workingTreeDiff = createDiffTabFixture()
    const commitDiff = createDiffTabFixture({
      diff: {
        ...workingTreeDiff.diff,
        source: {
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
        },
      },
      id: 'commit-diff',
    })

    expect(getDirtyWorkspaceTabs([codeTab, previewTab, workingTreeDiff, commitDiff]))
      .toEqual([codeTab, workingTreeDiff])
  })

  it('matches file targets across normalized path formats', () => {
    const codeTab = createFileTab('code')
    const otherTab = createFileTab('meo', {
      filePath: `${workspacePath}/guide.md`,
      id: createWorkspaceFileTabId(`${workspacePath}/guide.md`, 'meo'),
    })
    const tabs: WorkspaceTab[] = [codeTab, otherTab]

    expect(getDirtyWorkspaceTabsForPaths(tabs, ['c:\\WORKSPACE\\docs\\readme.md']))
      .toEqual([codeTab])
    expect(hasDirtyWorkspaceFileTab(tabs, 'c:\\workspace\\DOCS\\readme.md')).toBe(true)
    expect(hasDirtyWorkspaceFileTab(tabs, `${workspacePath}/missing.md`)).toBe(false)
  })

  it('finds dirty documents below a file-system node without matching siblings', () => {
    const nestedTab = createFileTab('meo', {
      filePath: `${workspacePath}/docs/nested/guide.md`,
      id: createWorkspaceFileTabId(`${workspacePath}/docs/nested/guide.md`, 'meo'),
    })
    const siblingTab = createFileTab('code', {
      filePath: `${workspacePath}/docs-archive/readme.md`,
      id: createWorkspaceFileTabId(`${workspacePath}/docs-archive/readme.md`, 'code'),
    })

    expect(getDirtyWorkspaceTabsForNodePath([nestedTab, siblingTab], `${workspacePath}/docs`))
      .toEqual([nestedTab])
  })
})

describe('workspace document feature ownership', () => {
  it('keeps document persistence and navigation implementation out of App', async () => {
    const [appSource, navigationSource, persistenceSource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/hooks/use-workspace-document-navigation.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/hooks/use-workspace-document-persistence.ts', import.meta.url), 'utf8'),
    ])

    expect(appSource).toContain('useWorkspaceDocumentNavigation({')
    expect(appSource).toContain('useWorkspaceDocumentPersistence({')
    expect(appSource).not.toContain('workspaceAutosaveTimerRef')
    expect(appSource).not.toContain("recordOpenFileProfile('app:open-file:start'")
    expect(appSource).not.toContain('async function restoreWorkspaceTabs')
    expect(navigationSource).toContain("recordOpenFileProfile('app:open-file:start'")
    expect(navigationSource).toContain('const restoreWorkspaceTabs = useCallback')
    expect(persistenceSource).toContain('const flushWorkspaceAutosave = useCallback')
    expect(persistenceSource).toContain('const confirmDiscardDirtyTabs = useCallback')
  })
})

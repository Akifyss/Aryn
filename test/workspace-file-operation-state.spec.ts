import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { GitChangeItem, GitFileDiffResult } from '../src/features/git/types'
import type { WorkspaceNode } from '../src/features/workspace/types'
import {
  collectWorkspaceDirectoryPaths,
  getWorkspaceFileTabIdsForPath,
  getWorkspaceMovedTabMutations,
  getWorkspaceTabIdsForNodePath,
  rebaseExpandedWorkspacePaths,
  resolveWorkspaceMoveRelativePath,
  resolveWorkspaceRenameTarget,
} from '../src/features/workspace/lib/workspace-file-operation-state'
import { createDiffTab } from '../src/features/workspace/lib/workspace-tabs'
import {
  createWorkspaceFileTabId,
  type WorkspaceDiffTab,
  type WorkspaceFileTab,
  type WorkspaceTab,
} from '../src/features/workspace/store/use-workspace-store'

const workspacePath = 'C:/workspace'

function createFileTab(filePath: string, viewMode: WorkspaceFileTab['viewMode']): WorkspaceFileTab {
  return {
    content: '# Draft',
    editorKind: 'prose',
    exists: true,
    filePath,
    id: createWorkspaceFileTabId(filePath, viewMode),
    isDirty: false,
    kind: 'file',
    savedContent: '# Draft',
    viewMode,
  }
}

function createDiffTabFixture(filePath: string): WorkspaceDiffTab {
  const relativePath = filePath.slice(`${workspacePath}/`.length)
  const change: GitChangeItem = {
    kind: 'modified',
    originalPath: null,
    path: filePath,
    relativePath,
    scope: 'unstaged',
    statusCode: ' M',
  }
  const diff: GitFileDiffResult = {
    change,
    editorKind: 'prose',
    modifiedContent: '# Modified',
    modifiedExists: true,
    modifiedLabel: 'Working tree',
    originalContent: '# Original',
    originalExists: true,
    originalLabel: 'Revision',
    repositoryRootPath: workspacePath,
    selections: [],
    source: { kind: 'working-tree' },
  }

  return createDiffTab(diff)
}

describe('workspace file operation state', () => {
  it('collects every nested directory and excludes files', () => {
    const nodes: WorkspaceNode[] = [
      {
        children: [
          { kind: 'file', name: 'readme.md', path: `${workspacePath}/docs/readme.md` },
          {
            children: [],
            kind: 'directory',
            name: 'guides',
            path: `${workspacePath}/docs/guides`,
          },
        ],
        kind: 'directory',
        name: 'docs',
        path: `${workspacePath}/docs`,
      },
      { kind: 'file', name: 'index.ts', path: `${workspacePath}/index.ts` },
    ]

    expect(collectWorkspaceDirectoryPaths(nodes)).toEqual(new Set([
      `${workspacePath}/docs`,
      `${workspacePath}/docs/guides`,
    ]))
  })

  it('rebases expanded descendants while retaining sibling paths', () => {
    const expandedPaths = new Set([
      `${workspacePath}/docs`,
      `${workspacePath}/docs/guides`,
      `${workspacePath}/docs-archive`,
    ])

    expect(rebaseExpandedWorkspacePaths(
      expandedPaths,
      `${workspacePath}/docs`,
      `${workspacePath}/archive/docs`,
    )).toEqual(new Set([
      `${workspacePath}/archive/docs`,
      `${workspacePath}/archive/docs/guides`,
      `${workspacePath}/docs-archive`,
    ]))
  })

  it('plans moved file renames and diff closures in tab order without duplicate file work', () => {
    const readmePath = `${workspacePath}/docs/readme.md`
    const guidePath = `${workspacePath}/docs/guides/start.md`
    const siblingPath = `${workspacePath}/docs-archive/old.md`
    const readmeMeoTab = createFileTab(readmePath, 'meo')
    const readmeCodeTab = createFileTab(readmePath, 'code')
    const diffTab = createDiffTabFixture(guidePath)
    const tabs: WorkspaceTab[] = [
      readmeMeoTab,
      diffTab,
      readmeCodeTab,
      createFileTab(guidePath, 'meo'),
      createFileTab(siblingPath, 'meo'),
    ]

    expect(getWorkspaceMovedTabMutations(
      tabs,
      `${workspacePath}/docs`,
      `${workspacePath}/archive/docs`,
    )).toEqual([
      {
        currentPath: readmePath,
        kind: 'rename-file',
        nextPath: `${workspacePath}/archive/docs/readme.md`,
      },
      { kind: 'close-tab', tabId: diffTab.id },
      {
        currentPath: guidePath,
        kind: 'rename-file',
        nextPath: `${workspacePath}/archive/docs/guides/start.md`,
      },
    ])
  })

  it('finds tabs affected by a node or exact file path', () => {
    const filePath = `${workspacePath}/docs/readme.md`
    const fileTab = createFileTab(filePath, 'meo')
    const codeTab = createFileTab(filePath, 'code')
    const diffTab = createDiffTabFixture(`${workspacePath}/docs/guide.md`)
    const siblingTab = createFileTab(`${workspacePath}/docs-archive/old.md`, 'meo')
    const tabs: WorkspaceTab[] = [fileTab, codeTab, diffTab, siblingTab]

    expect(getWorkspaceFileTabIdsForPath(tabs, filePath)).toEqual([fileTab.id, codeTab.id])
    expect(getWorkspaceTabIdsForNodePath(tabs, `${workspacePath}/docs`)).toEqual([
      fileTab.id,
      codeTab.id,
      diffTab.id,
    ])
  })

  it('resolves move and rename targets while preserving an omitted file extension', () => {
    const fileNode: WorkspaceNode = {
      kind: 'file',
      name: 'readme.md',
      path: `${workspacePath}/docs/readme.md`,
    }

    expect(resolveWorkspaceMoveRelativePath(
      workspacePath,
      fileNode,
      `${workspacePath}/archive`,
    )).toBe('archive/readme.md')
    expect(resolveWorkspaceMoveRelativePath(workspacePath, fileNode, workspacePath)).toBe('readme.md')
    expect(resolveWorkspaceRenameTarget(workspacePath, fileNode, ' guide ')).toEqual({
      baseName: 'guide.md',
      relativePath: 'docs/guide.md',
    })
    expect(resolveWorkspaceRenameTarget(workspacePath, fileNode, 'guide.txt')).toEqual({
      baseName: 'guide.txt',
      relativePath: 'docs/guide.txt',
    })
    expect(() => resolveWorkspaceRenameTarget(workspacePath, fileNode, '  '))
      .toThrow('File name is required.')
  })
})

describe('workspace file operation ownership', () => {
  it('keeps file-system mutations and tree expansion state out of App', async () => {
    const [appSource, hookSource] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/hooks/use-workspace-file-operations.ts', import.meta.url), 'utf8'),
    ])

    expect(appSource).toContain('useWorkspaceFileOperations({')
    expect(appSource).not.toContain('async function handleMoveWorkspaceNode')
    expect(appSource).not.toContain('function handleToggleFileTreeExpansion')
    expect(hookSource).toContain('const moveWorkspaceNode = useCallback')
    expect(hookSource).toContain('const toggleTreeExpansion = useCallback')
  })
})

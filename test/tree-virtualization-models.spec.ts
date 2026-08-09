import { describe, expect, it } from 'vitest'
import type {
  GitChangeItem,
  GitCommitDetails,
  GitCommitItem,
} from '@/features/git/types'
import { createGitChangeTreeRows } from '@/features/git/components/git-panel/git-change-section/git-change-tree-model'
import { createGitHistorySectionRows } from '@/features/git/components/git-panel/git-history/git-history-model'
import { createVisibleWorkspaceTreeRows } from '@/features/workspace/components/workspace-tree/workspace-tree-model'
import type { WorkspaceNode } from '@/features/workspace/types'

function createChange(relativePath: string): GitChangeItem {
  return {
    kind: 'modified',
    originalPath: null,
    path: `C:\\workspace\\${relativePath.replaceAll('/', '\\')}`,
    relativePath,
    scope: 'unstaged',
    statusCode: ' M',
  }
}

function createCommit(index: number): GitCommitItem {
  return {
    authorEmail: null,
    authorName: 'Aryn',
    authorTimeUnix: 1_700_000_000 + index,
    hash: `commit-${index}`,
    shortHash: `c${index}`,
    subject: `Commit ${index}`,
  }
}

describe('Workspace virtual tree row model', () => {
  it('flattens only expanded directories in pre-order with tree metadata', () => {
    const nodes: WorkspaceNode[] = [{
      children: [{
        kind: 'file',
        name: 'guide.md',
        path: 'C:\\workspace\\docs\\guide.md',
      }],
      kind: 'directory',
      name: 'docs',
      path: 'C:\\workspace\\docs',
    }, {
      kind: 'file',
      name: 'README.md',
      path: 'C:\\workspace\\README.md',
    }]

    const collapsedRows = createVisibleWorkspaceTreeRows(nodes, new Set())
    expect(collapsedRows.map((row) => row.node.name)).toEqual(['docs', 'README.md'])

    const expandedRows = createVisibleWorkspaceTreeRows(
      nodes,
      new Set(['C:\\workspace\\docs']),
    )
    expect(expandedRows.map((row) => row.node.name)).toEqual(['docs', 'guide.md', 'README.md'])
    expect(expandedRows.map((row) => row.aria)).toEqual([
      { level: 1, positionInSet: 1, setSize: 2 },
      { level: 2, positionInSet: 1, setSize: 1 },
      { level: 1, positionInSet: 2, setSize: 2 },
    ])
  })

  it('does not inspect descendants of collapsed directories', () => {
    let childReads = 0
    const directory = {
      kind: 'directory',
      name: 'large',
      path: 'C:\\workspace\\large',
    } as WorkspaceNode
    Object.defineProperty(directory, 'children', {
      get() {
        childReads += 1
        return [{ kind: 'file', name: 'hidden.md', path: 'hidden.md' }]
      },
    })

    createVisibleWorkspaceTreeRows([directory], new Set())
    expect(childReads).toBe(0)
  })

  it('creates stable unique rows for ten thousand visible files', () => {
    const nodes: WorkspaceNode[] = Array.from({ length: 10_000 }, (_, index) => ({
      kind: 'file',
      name: `file-${index}.md`,
      path: `C:\\workspace\\file-${index}.md`,
    }))
    const rows = createVisibleWorkspaceTreeRows(nodes, new Set())

    expect(rows).toHaveLength(nodes.length)
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
    expect(rows.at(-1)?.aria).toEqual({
      level: 1,
      positionInSet: 10_000,
      setSize: 10_000,
    })
  })
})

describe('Git virtual tree row models', () => {
  it('preserves folder-first ordering and removes closed descendants', () => {
    const changes = [
      createChange('src/index.ts'),
      createChange('README.md'),
      createChange('src/components/button.tsx'),
      createChange('docs/guide.md'),
    ]
    const expandedRows = createGitChangeTreeRows(changes, 'tree', {})

    expect(expandedRows.map((row) => (
      row.kind === 'folder' ? `folder:${row.node.path}` : `file:${row.change.relativePath}`
    ))).toEqual([
      'folder:docs',
      'file:docs/guide.md',
      'folder:src',
      'folder:src/components',
      'file:src/components/button.tsx',
      'file:src/index.ts',
      'file:README.md',
    ])

    const collapsedRows = createGitChangeTreeRows(changes, 'tree', { src: true })
    expect(collapsedRows.map((row) => row.key)).not.toContain(
      'folder:src/components',
    )
    expect(collapsedRows.some((row) => (
      row.kind === 'change' && row.change.relativePath === 'src/index.ts'
    ))).toBe(false)
  })

  it('flattens expanded commit files into the shared history row set', () => {
    const commit = createCommit(0)
    const details: GitCommitDetails = {
      ...commit,
      changes: Array.from({ length: 1_000 }, (_, index) => ({
        kind: 'modified' as const,
        originalPath: null,
        path: `C:\\workspace\\file-${index}.md`,
        relativePath: `file-${index}.md`,
        statusCode: 'M',
      })),
    }
    const rows = createGitHistorySectionRows({
      commits: [commit],
      detailsByHash: { [commit.hash]: details },
      detailsErrorsByHash: {},
      error: null,
      expandedCommitHashes: { [commit.hash]: true },
      isLoading: false,
      loadingCommitHashes: {},
    })

    expect(rows).toHaveLength(1_001)
    expect(rows[0]).toMatchObject({ depth: 0, kind: 'commit' })
    expect(rows[1]).toMatchObject({
      aria: { level: 2, positionInSet: 1, setSize: 1_000 },
      depth: 1,
      kind: 'commit-change',
    })
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })
})

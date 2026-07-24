import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type {
  GitChangeItem,
  GitCommitItem,
  GitRecentPullItem,
  GitRepositoryState,
} from '../src/features/git/types'
import {
  buildGitTree,
  formatCommitRelativeTime,
  getCleanStateSubtext,
  getCommitChangeCountLabel,
  getCommitMeta,
  getDirectoryLabel,
  getGitChangeKindLabel,
  getRepositoryHeading,
  getSelectedCommitHash,
  isScopedGitChange,
  supportsMeoDiff,
} from '../src/features/git/components/git-panel/git-panel-model'

function createChange(
  relativePath: string,
  kind: GitChangeItem['kind'] = 'modified',
): GitChangeItem {
  return {
    kind,
    originalPath: null,
    path: `C:\\workspace\\${relativePath.replaceAll('/', '\\')}`,
    relativePath,
    scope: 'unstaged',
    statusCode: ' M',
  }
}

function createPulledChange(relativePath: string): GitRecentPullItem {
  return {
    kind: 'modified',
    originalPath: null,
    path: `C:\\workspace\\${relativePath.replaceAll('/', '\\')}`,
    relativePath,
    statusCode: 'M',
  }
}

function createRepositoryState(
  patch: Partial<GitRepositoryState> = {},
): GitRepositoryState {
  return {
    ahead: 0,
    behind: 0,
    branch: 'main',
    hasCommits: true,
    hasChanges: false,
    hasRemote: true,
    isRepository: true,
    recentlyPulledChanges: [],
    remoteCount: 1,
    repositoryRootPath: 'C:\\workspace',
    stagedChanges: [],
    unpushedCommits: 0,
    unstagedChanges: [],
    workspacePath: 'C:\\workspace',
    ...patch,
  }
}

describe('Git panel display model', () => {
  it('builds sorted nested directory nodes while excluding root files', () => {
    const docsChange = createChange('docs/guide.md')
    const sourceChange = createChange('src/index.ts')
    const nestedSourceChange = createChange('src/components/button.tsx')

    const tree = buildGitTree([
      sourceChange,
      createChange('README.md'),
      nestedSourceChange,
      docsChange,
    ])

    expect(tree.map((node) => node.path)).toEqual(['docs', 'src'])
    expect(tree[0]).toMatchObject({
      items: [docsChange],
      label: 'docs',
      path: 'docs',
    })
    expect(tree[1]?.items).toEqual([sourceChange, nestedSourceChange])
    expect(tree[1]?.children).toHaveLength(1)
    expect(tree[1]?.children[0]).toMatchObject({
      items: [nestedSourceChange],
      label: 'components',
      path: 'src/components',
    })
  })

  it('distinguishes working-tree changes from read-only history changes', () => {
    const markdownChange = createChange('notes.md')
    const textChange = createChange('notes.txt')
    const pulledChange = createPulledChange('notes.md')

    expect(isScopedGitChange(markdownChange)).toBe(true)
    expect(isScopedGitChange(pulledChange)).toBe(false)
    expect(supportsMeoDiff(markdownChange)).toBe(true)
    expect(supportsMeoDiff(textChange)).toBe(false)
    expect(supportsMeoDiff(pulledChange)).toBe(false)
  })

  it('formats file, change, and commit metadata consistently', () => {
    const commit: GitCommitItem = {
      authorEmail: null,
      authorName: 'Aryn',
      authorTimeUnix: 0,
      hash: 'abcdef123456',
      shortHash: 'abcdef1',
      subject: 'Refine Git panel',
    }

    expect(getDirectoryLabel('src/components/button.tsx')).toBe('src / components')
    expect(getDirectoryLabel('README.md')).toBe('')
    expect(getCommitChangeCountLabel(3)).toBe('3 个变更文件')
    expect(formatCommitRelativeTime(0)).toBe('未知时间')
    expect(getCommitMeta(commit)).toBe('Aryn · 未知时间 · abcdef1')
    expect(getGitChangeKindLabel('conflicted')).toBe('冲突')
    expect(getSelectedCommitHash({ kind: 'working-tree' })).toBeNull()
    expect(getSelectedCommitHash({
      commitHash: commit.hash,
      kind: 'commit',
    })).toBe(commit.hash)
  })

  it('derives repository headings and clean-state sync summaries', () => {
    expect(getRepositoryHeading(createRepositoryState())).toBe('main')
    expect(getRepositoryHeading(createRepositoryState({
      branch: null,
      hasCommits: true,
    }))).toBe('分离 HEAD')
    expect(getRepositoryHeading(createRepositoryState({
      branch: 'main',
      hasCommits: false,
    }))).toBe('main 尚无提交')
    expect(getCleanStateSubtext(createRepositoryState())).toBe('所有更改已提交')
    expect(getCleanStateSubtext(createRepositoryState({
      behind: 2,
      unpushedCommits: 1,
    }))).toBe('1 个提交待推送 / 2 个远程提交待拉取')
  })
})

describe('Git panel model ownership', () => {
  it('keeps pure display modeling outside the panel component', async () => {
    const panelSource = await readFile(
      new URL(
        '../src/features/git/components/git-panel/git-panel.tsx',
        import.meta.url,
      ),
      'utf8',
    )

    expect(panelSource).toContain("from './git-panel-model'")
    expect(panelSource).not.toContain('function buildGitTree(')
    expect(panelSource).not.toContain('function getRepositoryHeading(')
  })
})

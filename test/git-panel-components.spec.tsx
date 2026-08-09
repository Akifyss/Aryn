import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  GitChangeItem,
  GitCommitDetails,
  GitCommitFileChange,
  GitCommitItem,
  GitRepositoryState,
} from '@/features/git/types'
import { GitPanel } from '@/features/git/components/git-panel/git-panel'
import { GitChangeSection } from '@/features/git/components/git-panel/git-change-section/git-change-section'
import {
  GitCommitDetail,
  GitHistoryPane,
  GitHistorySection,
} from '@/features/git/components/git-panel/git-history/git-history'

const markdownChange: GitChangeItem = {
  kind: 'modified',
  originalPath: null,
  path: 'C:\\workspace\\src\\guide.md',
  relativePath: 'src/guide.md',
  scope: 'unstaged',
  statusCode: ' M',
}

const nonRepositoryState: GitRepositoryState = {
  ahead: 0,
  behind: 0,
  branch: null,
  hasCommits: false,
  hasChanges: false,
  hasRemote: false,
  isRepository: false,
  recentlyPulledChanges: [],
  remoteCount: 0,
  repositoryRootPath: null,
  stagedChanges: [],
  unpushedCommits: 0,
  unstagedChanges: [],
  workspacePath: 'C:\\workspace',
}

const commit: GitCommitItem = {
  authorEmail: 'aryn@example.com',
  authorName: 'Aryn',
  authorTimeUnix: 1_700_000_000,
  hash: 'abcdef1234567890',
  shortHash: 'abcdef1',
  subject: 'Refine Git panel',
}

const commitDetails: GitCommitDetails = {
  ...commit,
  changes: [{
    kind: 'modified',
    originalPath: null,
    path: 'C:\\workspace\\src\\guide.md',
    relativePath: 'src/guide.md',
    statusCode: 'M',
  }],
}

const ignoreChange = () => undefined
const ignoreChanges = () => undefined
const ignorePath = () => undefined
const scrollElementRef = createRef<HTMLDivElement>()

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

describe('Git panel presentation components', () => {
  it('uses the shared empty state for a workspace without a Git repository', () => {
    const markup = renderToStaticMarkup(
      <GitPanel
        busyLabel={null}
        commitMessage=''
        historyRefreshVersion={0}
        iconTheme={null}
        isLoading={false}
        layout='list'
        menuPortalTarget={null}
        repositoryState={nonRepositoryState}
        workspacePath='C:\\workspace'
        onCommit={ignoreChange}
        onCommitAndSync={ignoreChange}
        onCommitMessageChange={ignorePath}
        onDiscardAll={ignoreChange}
        onDiscardMany={ignoreChanges}
        onInitialize={ignoreChange}
        onLayoutChange={ignorePath}
        onOpenCommitFileDiff={ignoreChange}
        onOpenDiff={ignoreChange}
        onOpenFile={ignorePath}
        onOpenMeoDiff={ignoreChange}
        onPull={ignoreChange}
        onPush={ignoreChange}
        onRefresh={ignoreChange}
        onRevertCommit={ignoreChange}
        onStage={ignorePath}
        onUnstage={ignorePath}
      />,
    )

    expect(markup).toContain('class="app-empty-state git-panel-init-state"')
    expect(markup).toContain('class="app-empty-state-actions"')
    expect(markup).toContain('当前工作区尚未初始化 Git')
    expect(markup).toContain('初始化 Git')
  })

  it('preserves editable file actions in list and tree layouts', () => {
    const sharedProps = {
      changes: [markdownChange],
      iconTheme: null,
      kind: 'unstaged' as const,
      scrollElementRef,
      onDiscardMany: ignoreChanges,
      onOpenDiff: ignoreChange,
      onOpenFile: ignorePath,
      onOpenMeoDiff: ignoreChange,
      onStage: ignorePath,
      onUnstage: ignorePath,
      title: '更改',
    }
    const listMarkup = renderToStaticMarkup(
      <GitChangeSection {...sharedProps} layout='list' />,
    )
    const treeMarkup = renderToStaticMarkup(
      <GitChangeSection {...sharedProps} layout='tree' />,
    )

    expect(listMarkup).toContain('guide.md')
    expect(listMarkup).toContain('src')
    expect(listMarkup).toContain('aria-label="打开文件"')
    expect(listMarkup).toContain('aria-label="打开 MEO 分屏差异"')
    expect(listMarkup).toContain('aria-label="放弃更改"')
    expect(listMarkup).toContain('aria-label="暂存"')
    expect(treeMarkup).toContain('aria-expanded="true"')
    expect(treeMarkup).toContain('guide.md')
  })

  it('preserves desktop history, compact history, and commit detail states', () => {
    const historyPaneMarkup = renderToStaticMarkup(
      <GitHistoryPane
        busyLabel={null}
        commits={[commit]}
        error={null}
        historySelection={{ kind: 'commit', commitHash: commit.hash }}
        isLoading={false}
        repositoryMeta='main / 1 个更改'
        revertDisabledReason={null}
        onRevertCommit={ignoreChange}
        onSelectCommit={ignorePath}
        onSelectWorkingTree={ignorePath}
      />,
    )
    const compactHistoryMarkup = renderToStaticMarkup(
      <GitHistorySection
        busyLabel={null}
        commits={[commit]}
        detailsByHash={{ [commit.hash]: commitDetails }}
        detailsErrorsByHash={{}}
        error={null}
        expandedCommitHashes={{ [commit.hash]: true }}
        iconTheme={null}
        isExpanded
        isLoading={false}
        loadingCommitHashes={{}}
        revertDisabledReason={null}
        scrollElementRef={scrollElementRef}
        onExpandedChange={ignorePath}
        onOpenCommitFileDiff={ignoreChange}
        onRevertCommit={ignoreChange}
        onToggleCommit={ignorePath}
      />,
    )
    const commitDetailMarkup = renderToStaticMarkup(
      <GitCommitDetail
        busyLabel={null}
        details={commitDetails}
        error={null}
        iconTheme={null}
        isLoading={false}
        layout='list'
        layoutAction={<button type='button'>切换布局</button>}
        revertDisabledReason={null}
        selectedCommitHash={commit.hash}
        summary={commit}
        onOpenCommitFileDiff={ignoreChange}
        onRevertCommit={ignoreChange}
      />,
    )

    expect(historyPaneMarkup).toContain('aria-label="Git 历史"')
    expect(historyPaneMarkup).toContain('Refine Git panel')
    expect(historyPaneMarkup).toContain('aria-label="还原提交 abcdef1"')
    expect(compactHistoryMarkup).toContain('aria-expanded="true"')
    expect(compactHistoryMarkup).toContain('guide.md')
    expect(commitDetailMarkup).toContain('Refine Git panel')
    expect(commitDetailMarkup).toContain('1 个变更文件')
    expect(commitDetailMarkup).toContain('切换布局')
    expect(commitDetailMarkup).toContain('guide.md')
  })

  it('bounds every large Git collection to its virtual render window', () => {
    const changes = Array.from({ length: 1_000 }, (_, index): GitChangeItem => ({
      ...markdownChange,
      path: `C:\\workspace\\src\\file-${index}.md`,
      relativePath: `src/file-${index}.md`,
    }))
    const commits = Array.from({ length: 1_000 }, (_, index) => createCommit(index))
    const changeMarkup = renderToStaticMarkup(
      <GitChangeSection
        changes={changes}
        iconTheme={null}
        kind='unstaged'
        layout='list'
        scrollElementRef={scrollElementRef}
        title='Changes'
        onDiscardMany={ignoreChanges}
        onOpenDiff={ignoreChange}
        onOpenFile={ignorePath}
        onOpenMeoDiff={ignoreChange}
        onStage={ignorePath}
        onUnstage={ignorePath}
      />,
    )
    const historyMarkup = renderToStaticMarkup(
      <GitHistoryPane
        busyLabel={null}
        commits={commits}
        error={null}
        historySelection={{ kind: 'working-tree' }}
        isLoading={false}
        repositoryMeta='main'
        revertDisabledReason={null}
        onRevertCommit={ignoreChange}
        onSelectCommit={ignorePath}
        onSelectWorkingTree={ignorePath}
      />,
    )
    const compactHistoryMarkup = renderToStaticMarkup(
      <GitHistorySection
        busyLabel={null}
        commits={commits}
        detailsByHash={{}}
        detailsErrorsByHash={{}}
        error={null}
        expandedCommitHashes={{}}
        iconTheme={null}
        isExpanded
        isLoading={false}
        loadingCommitHashes={{}}
        revertDisabledReason={null}
        scrollElementRef={scrollElementRef}
        onExpandedChange={ignorePath}
        onOpenCommitFileDiff={ignoreChange}
        onRevertCommit={ignoreChange}
        onToggleCommit={ignorePath}
      />,
    )
    const largeCommitDetails: GitCommitDetails = {
      ...commit,
      changes: changes.map((change): GitCommitFileChange => ({
        kind: 'modified',
        originalPath: change.originalPath,
        path: change.path,
        relativePath: change.relativePath,
        statusCode: 'M',
      })),
    }
    const detailMarkup = renderToStaticMarkup(
      <GitCommitDetail
        busyLabel={null}
        details={largeCommitDetails}
        error={null}
        iconTheme={null}
        isLoading={false}
        layout='list'
        layoutAction={null}
        revertDisabledReason={null}
        selectedCommitHash={commit.hash}
        summary={commit}
        onOpenCommitFileDiff={ignoreChange}
        onRevertCommit={ignoreChange}
      />,
    )

    for (const [markup, rowClassName] of [
      [changeMarkup, 'git-change-virtual-item'],
      [historyMarkup, 'git-history-virtual-item'],
      [compactHistoryMarkup, 'git-history-virtual-item'],
      [detailMarkup, 'git-change-virtual-item'],
    ] as const) {
      const renderedRows = markup.match(new RegExp(rowClassName, 'g')) ?? []
      expect(renderedRows.length).toBeGreaterThan(0)
      expect(renderedRows.length).toBeLessThan(40)
    }

    expect(changeMarkup).toContain('file-0.md')
    expect(changeMarkup).not.toContain('file-999.md')
    expect(historyMarkup).toContain('Commit 0')
    expect(historyMarkup).not.toContain('Commit 999')
    expect(compactHistoryMarkup).toContain('Commit 0')
    expect(compactHistoryMarkup).not.toContain('Commit 999')
    expect(detailMarkup).toContain('file-0.md')
    expect(detailMarkup).not.toContain('file-999.md')
  })

  it('announces asynchronous Git history states without claiming tree-widget semantics', () => {
    const loadingMarkup = renderToStaticMarkup(
      <GitHistoryPane
        busyLabel={null}
        commits={[]}
        error={null}
        historySelection={{ kind: 'working-tree' }}
        isLoading
        repositoryMeta='main'
        revertDisabledReason={null}
        onRevertCommit={ignoreChange}
        onSelectCommit={ignorePath}
        onSelectWorkingTree={ignorePath}
      />,
    )
    const errorMarkup = renderToStaticMarkup(
      <GitHistoryPane
        busyLabel={null}
        commits={[]}
        error='History unavailable'
        historySelection={{ kind: 'working-tree' }}
        isLoading={false}
        repositoryMeta='main'
        revertDisabledReason={null}
        onRevertCommit={ignoreChange}
        onSelectCommit={ignorePath}
        onSelectWorkingTree={ignorePath}
      />,
    )

    expect(loadingMarkup).toContain('role="status"')
    expect(loadingMarkup).toContain('aria-live="polite"')
    expect(errorMarkup).toContain('role="alert"')
    expect(errorMarkup).toContain('aria-live="assertive"')
    expect(loadingMarkup).not.toContain('role="tree"')
    expect(errorMarkup).not.toContain('role="treeitem"')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  GitChangeItem,
  GitCommitDetails,
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
    expect(markup).toContain('这个工作区还不是 Git 仓库。')
    expect(markup).toContain('初始化 Git')
  })

  it('preserves editable file actions in list and tree layouts', () => {
    const sharedProps = {
      changes: [markdownChange],
      iconTheme: null,
      kind: 'unstaged' as const,
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
})

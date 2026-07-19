import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type {
  GitChangeItem,
  GitRepositoryState,
} from '../src/features/git/types'
import { findGitChangeByFilePath } from '../src/features/git/lib/repository-state'

function createChange(
  scope: GitChangeItem['scope'],
  path: string,
): GitChangeItem {
  return {
    kind: 'modified',
    originalPath: null,
    path,
    relativePath: path.split(/[\\/]/).pop() ?? path,
    scope,
    statusCode: 'M',
  }
}

function createRepositoryState(
  stagedChanges: GitChangeItem[],
  unstagedChanges: GitChangeItem[],
): GitRepositoryState {
  return {
    ahead: 0,
    behind: 0,
    branch: 'main',
    hasCommits: true,
    hasChanges: stagedChanges.length + unstagedChanges.length > 0,
    hasRemote: false,
    isRepository: true,
    recentlyPulledChanges: [],
    remoteCount: 0,
    repositoryRootPath: 'C:\\workspace',
    stagedChanges,
    unpushedCommits: 0,
    unstagedChanges,
    workspacePath: 'C:\\workspace',
  }
}

describe('Git repository state helpers', () => {
  it('matches normalized paths and prefers unstaged changes by default', () => {
    const staged = createChange('staged', 'C:\\workspace\\src\\App.tsx')
    const unstaged = createChange('unstaged', 'C:/workspace/src/App.tsx')
    const repositoryState = createRepositoryState([staged], [unstaged])

    expect(findGitChangeByFilePath(repositoryState, 'c:\\WORKSPACE\\src\\App.tsx')).toBe(unstaged)
    expect(findGitChangeByFilePath(repositoryState, staged.path, ['staged', 'unstaged'])).toBe(staged)
  })

  it('returns null outside a repository or when the path has no change', () => {
    const repositoryState = createRepositoryState([], [])

    expect(findGitChangeByFilePath(null, 'C:\\workspace\\README.md')).toBeNull()
    expect(findGitChangeByFilePath(
      { ...repositoryState, isRepository: false },
      'C:\\workspace\\README.md',
    )).toBeNull()
    expect(findGitChangeByFilePath(repositoryState, 'C:\\workspace\\README.md')).toBeNull()
  })
})

describe('Git feature ownership', () => {
  it('keeps repository commands and component styles out of App', async () => {
    const [
      appCss,
      appSource,
      controllerSource,
      diffEditorCss,
      diffEditorSource,
      gitPanelCss,
      gitPanelSource,
    ] = await Promise.all([
      readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/git/hooks/use-git-workspace-controller.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/editor/components/git-diff-editor/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/editor/components/git-diff-editor/git-diff-editor.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/git/components/git-panel/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/git/components/git-panel/git-panel.tsx', import.meta.url), 'utf8'),
    ])

    expect(appSource).not.toContain('const [gitRepositoryState, setGitRepositoryState]')
    expect(appSource).not.toContain('async function handleStageGitPaths')
    expect(controllerSource).toContain('export function useGitWorkspaceController')
    expect(controllerSource).toContain('window.appApi.stageGitPaths')
    expect(controllerSource).toContain('window.appApi.commitAndSyncGitChanges')
    expect(appCss).not.toMatch(
      /(^|\n)\.(?:git-panel|git-history|git-commit|git-change|git-push|git-empty|git-clean|git-diff)(?:-|\s|[.:#>,{])/,
    )
    expect(gitPanelCss).toContain('.git-panel {')
    expect(gitPanelCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(diffEditorCss).toContain('.git-diff-editor {')
    expect(diffEditorCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(`${gitPanelCss}\n${diffEditorCss}`).not.toContain('transition: all')
    expect(diffEditorCss).not.toContain('.git-diff-pierre-shell')
    expect(gitPanelSource).toContain("import './styles.css'")
    expect(diffEditorSource).toContain("import './styles.css'")
  })
})

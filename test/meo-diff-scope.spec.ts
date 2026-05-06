import { describe, expect, it } from 'vitest'
import type { GitBaselinePayload, GitChangeItem, GitChangeScope } from '../src/features/git/types'
import { buildDiffComparisonOptions, resolveOriginalText } from '../src/features/editor/lib/meo-native-diff-split'

function createBaseline(baseText = 'base\n', indexText = 'index\n'): GitBaselinePayload {
  return {
    available: true,
    baseText,
    gitPath: 'draft.md',
    headOid: 'HEAD',
    indexText,
    repoRoot: '/repo',
    tracked: true,
  }
}

function createChange(scope: GitChangeScope): GitChangeItem {
  return {
    kind: 'modified',
    originalPath: null,
    path: '/repo/draft.md',
    relativePath: 'draft.md',
    scope,
    statusCode: 'M',
  }
}

describe('meo diff scope resolution', () => {
  it('honors a staged diff request even when the worktree has additional edits', () => {
    const resolved = resolveOriginalText(
      createBaseline('base\n', 'index\n'),
      { label: 'Saved document', text: 'saved\n' },
      'worktree\n',
      {
        stagedChange: createChange('staged'),
        unstagedChange: createChange('unstaged'),
      },
      'staged',
    )

    expect(resolved).toMatchObject({
      actionScope: 'staged',
      label: 'HEAD',
      modifiedLabel: 'Index',
      modifiedReadOnly: true,
      modifiedText: 'index\n',
      text: 'base\n',
    })
  })

  it('falls back to the unstaged view when a stale staged preference no longer has a staged change', () => {
    const resolved = resolveOriginalText(
      createBaseline('base\n', 'index\n'),
      { label: 'Saved document', text: 'saved\n' },
      'worktree\n',
      {
        stagedChange: null,
        unstagedChange: createChange('unstaged'),
      },
      'staged',
    )

    expect(resolved).toMatchObject({
      actionScope: 'unstaged',
      label: 'Index',
      modifiedLabel: 'Working tree',
      modifiedReadOnly: false,
      modifiedText: 'worktree\n',
      text: 'index\n',
    })
  })

  it('keeps an explicit unstaged view even after index and working tree become equal', () => {
    const resolved = resolveOriginalText(
      createBaseline('base\n', 'index\n'),
      { label: 'Saved document', text: 'saved\n' },
      'index\n',
      {
        stagedChange: createChange('staged'),
        unstagedChange: null,
      },
      'unstaged',
    )

    expect(resolved).toMatchObject({
      actionScope: null,
      label: 'Index',
      modifiedLabel: 'Working tree',
      modifiedReadOnly: false,
      modifiedText: 'index\n',
      text: 'index\n',
      viewScope: 'unstaged',
    })
  })

  it('lists staged and remembered unstaged comparisons in one selector', () => {
    const baseline = createBaseline('base\n', 'index\n')
    const resolved = resolveOriginalText(
      baseline,
      { label: 'Saved document', text: 'saved\n' },
      'index\n',
      {
        stagedChange: createChange('staged'),
        unstagedChange: null,
      },
      'unstaged',
    )

    expect(buildDiffComparisonOptions(
      baseline,
      {
        stagedChange: createChange('staged'),
        unstagedChange: null,
      },
      resolved,
      'unstaged',
    ).map((option) => ({
      disabled: option.disabled,
      label: option.label,
      scope: option.scope,
    }))).toEqual([
      {
        disabled: false,
        label: 'HEAD - Index',
        scope: 'staged',
      },
      {
        disabled: false,
        label: 'Index - Working tree',
        scope: 'unstaged',
      },
    ])
  })
})

import { EditorState, Text, Transaction } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { splitDiffLines } from '../src/vendor/meo/shared/gitDiffCore'
import {
  buildLineFlagsFromVsCodeDiff,
  buildScopedLineFlagsFromVsCodeDiff,
} from '../src/vendor/meo/shared/gitDiffLineFlags'
import {
  __gitDiffGutterTestHooks,
  gitDiffGutterBaselineExtensions,
  gitDiffLineFlagsField,
  refreshGitDiffLineFlagsEffect,
  setGitBaselineEffect,
} from '../src/vendor/meo/webview/helpers/gitDiffGutter'

function flagSummary(flags: ReturnType<typeof buildLineFlagsFromVsCodeDiff>) {
  return Array.from(flags, (flag) => {
    if (flag?.deleted) return 'deleted'
    if (flag?.modified) return 'modified'
    if (flag?.added) return 'added'
    return null
  })
}

function scopedFlagSummary(flags: ReturnType<typeof buildScopedLineFlagsFromVsCodeDiff>) {
  return Array.from(flags, (flag) => {
    if (flag?.deleted) return `${flag.scope}:deleted`
    if (flag?.modified) return `${flag.scope}:modified`
    if (flag?.added) return `${flag.scope}:added`
    return null
  })
}

describe('meo git diff gutter', () => {
  it('matches VS Code-style line ranges for blank lines inserted before the EOF visual line', () => {
    const baseText = 'L1\nL2\nL3\n'
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines(baseText),
      Text.of(`${baseText}\n\n\n`.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      null,
      null,
      'added',
      'added',
      'added',
      null,
    ])
  })

  it('moves trailing newline insertions after a no-final-newline last line onto the new blank lines', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A'),
      Text.of('A\n\n\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'added',
      'added',
      'added',
    ])
  })

  it('marks a middle inserted blank line as added', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nB\n\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      null,
      'added',
      null,
      null,
    ])
  })

  it('does not mark pushed-down content when blank lines are inserted before it', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      [
        '# Tab',
        '',
        '- A',
        '- B',
        '- C',
        '## Project',
        '-',
      ],
      Text.of([
        '# Tab',
        '',
        '- A',
        '- B',
        '- C',
        '',
        '',
        '## Project',
        '-',
      ]),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      null,
      null,
      null,
      null,
      'added',
      'added',
      null,
      null,
    ])
  })

  it('marks replaced current lines as modified', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nX\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'modified',
      null,
      null,
    ])
  })

  it('keeps the native live gutter marker for a line replaced by an inline diff widget', () => {
    let state = EditorState.create({
      doc: 'A\nX\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: 'A\nB\nC\n',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    }).state

    const line = state.doc.line(2)
    const marker = __gitDiffGutterTestHooks.liveCollapsedBlockMarkerAtPos(
      state,
      state.field(gitDiffLineFlagsField),
      line.from,
    ) as { flags?: { modified?: boolean, scope?: string } } | null

    expect(marker?.flags?.modified).toBe(true)
    expect(marker?.flags?.scope).toBe('unstaged')
  })

  it('anchors middle pure deletions to the previous current line like VS Code', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      'deleted',
      null,
      null,
    ])
  })

  it('anchors leading pure deletions to the first current line bottom edge like VS Code', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('B\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      'deleted',
      null,
      null,
    ])
  })

  it('anchors trailing pure deletions to the last remaining current line', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nB\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'deleted',
      null,
    ])
  })

  it('matches VS Code anchors for leading and mid-file deletion blocks', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      [
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        'test',
        '',
        '',
        '',
        'Agent',
      ],
      Text.of([
        '',
        '',
        '',
        '',
        '',
        'test',
        '',
        'Agent',
      ]),
    )

    expect(flagSummary(flags)).toEqual([
      'deleted',
      null,
      null,
      null,
      null,
      'deleted',
      null,
      null,
    ])
  })

  it('marks whitespace-only line edits as modified like VS Code', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nB  \nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'modified',
      null,
      null,
    ])
  })

  it('keeps an all-content deletion visible on the remaining empty visual line', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('hello'),
      Text.of(''.split('\n')),
    )

    expect(flagSummary(flags)).toEqual(['modified'])
  })

  it('marks final newline insertions on the EOF visual line', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A'),
      Text.of('A\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      'added',
    ])
  })

  it('keeps a single inserted EOF blank line added in meo gutter state', () => {
    const initialState = EditorState.create({
      doc: '\n\ntest\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    const transaction = initialState.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: '\n\ntest',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    })

    expect(flagSummary(transaction.state.field(gitDiffLineFlagsField))).toEqual([
      null,
      null,
      null,
      'added',
    ])
  })

  it('refreshes git gutter flags after deferred IME composition edits', () => {
    let state = EditorState.create({
      doc: 'A\nB\nC\n',
      extensions: gitDiffGutterBaselineExtensions(),
    })
    state = state.update({
      effects: setGitBaselineEffect.of({
        available: true,
        baseText: 'A\nB\nC\n',
        headOid: 'HEAD',
        indexText: null,
        tracked: true,
      }),
    }).state

    const previousFlags = state.field(gitDiffLineFlagsField)
    const line = state.doc.line(2)
    const composedState = state.update({
      changes: { from: line.to, insert: ' changed' },
      annotations: Transaction.userEvent.of('input.type.compose'),
    }).state

    expect(composedState.field(gitDiffLineFlagsField)).toBe(previousFlags)

    const refreshedState = composedState.update({
      effects: refreshGitDiffLineFlagsEffect.of(null),
    }).state

    expect(flagSummary(refreshedState.field(gitDiffLineFlagsField))).toEqual([
      null,
      'modified',
      null,
      null,
    ])
  })

  it('treats content added to an empty tracked file as added, not modified', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines(''),
      Text.of('hello'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual(['added'])
  })

  it('separates staged and unstaged gutter lines with unstaged taking precedence', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A staged\nB\nC\n'),
      Text.of('A staged\nB unstaged\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'staged:modified',
      'unstaged:modified',
      null,
      null,
    ])
  })

  it('maps staged lines onto working tree line numbers after unstaged insertions', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A staged\nB\nC\n'),
      Text.of('X unstaged\nA staged\nB\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'unstaged:added',
      'staged:modified',
      null,
      null,
      null,
    ])
  })

  it('marks unstaged pure deletions in scoped gutter state', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'unstaged:deleted',
      null,
      null,
    ])
  })

  it('maps staged pure deletions onto the current worktree anchor line', () => {
    const flags = buildScopedLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      splitDiffLines('A\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(scopedFlagSummary(flags)).toEqual([
      'staged:deleted',
      null,
      null,
    ])
  })
})

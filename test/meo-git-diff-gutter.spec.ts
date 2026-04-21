import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { splitDiffLines } from '../src/vendor/meo/shared/gitDiffCore'
import {
  buildLineFlagsFromVsCodeDiff,
  buildScopedLineFlagsFromVsCodeDiff,
} from '../src/vendor/meo/shared/gitDiffLineFlags'

function flagSummary(flags: ReturnType<typeof buildLineFlagsFromVsCodeDiff>) {
  return Array.from(flags, (flag) => {
    if (flag?.modified) return 'modified'
    if (flag?.added) return 'added'
    return null
  })
}

function scopedFlagSummary(flags: ReturnType<typeof buildScopedLineFlagsFromVsCodeDiff>) {
  return Array.from(flags, (flag) => {
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

  it('does not mark current lines for pure deletions', () => {
    const flags = buildLineFlagsFromVsCodeDiff(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
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
})

import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { splitDiffLines } from '../src/vendor/meo/shared/gitDiffCore'
import {
  buildLineFlagsFromCodeMirrorChunks,
  buildScopedLineFlagsFromCodeMirrorChunks,
} from '../src/vendor/meo/shared/gitDiffLineFlags'

function flagSummary(flags: ReturnType<typeof buildLineFlagsFromCodeMirrorChunks>) {
  return Array.from(flags, (flag) => {
    if (flag?.modified) return 'modified'
    if (flag?.added) return 'added'
    return null
  })
}

function scopedFlagSummary(flags: ReturnType<typeof buildScopedLineFlagsFromCodeMirrorChunks>) {
  return Array.from(flags, (flag) => {
    if (flag?.modified) return `${flag.scope}:modified`
    if (flag?.added) return `${flag.scope}:added`
    return null
  })
}

describe('meo git diff gutter', () => {
  it('matches CodeMirror merge ranges for blank lines inserted before the EOF visual line', () => {
    const baseText = 'L1\nL2\nL3\n'
    const flags = buildLineFlagsFromCodeMirrorChunks(
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

  it('marks a middle inserted blank line as added', () => {
    const flags = buildLineFlagsFromCodeMirrorChunks(
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

  it('marks replaced current lines as modified', () => {
    const flags = buildLineFlagsFromCodeMirrorChunks(
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
    const flags = buildLineFlagsFromCodeMirrorChunks(
      splitDiffLines('A\nB\nC\n'),
      Text.of('A\nC\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      null,
      null,
      null,
    ])
  })

  it('marks final newline changes as a modification of the existing line', () => {
    const flags = buildLineFlagsFromCodeMirrorChunks(
      splitDiffLines('A'),
      Text.of('A\n'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual([
      'modified',
      null,
    ])
  })

  it('treats content added to an empty tracked file as added, not modified', () => {
    const flags = buildLineFlagsFromCodeMirrorChunks(
      splitDiffLines(''),
      Text.of('hello'.split('\n')),
    )

    expect(flagSummary(flags)).toEqual(['added'])
  })

  it('separates staged and unstaged gutter lines with unstaged taking precedence', () => {
    const flags = buildScopedLineFlagsFromCodeMirrorChunks(
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
    const flags = buildScopedLineFlagsFromCodeMirrorChunks(
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

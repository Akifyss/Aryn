import { Text } from '@codemirror/state'
import { Chunk } from '@codemirror/merge'
import { describe, expect, it } from 'vitest'
import {
  createSelectionFromCodeMirrorChunk,
  createVisualDiffSelections,
  findBestNavigationTarget,
  isLineWithinVisualDiff,
} from '@/features/editor/lib/git-diff-navigation'
import { buildCodeMirrorChunksFromVsCodeDiff, buildSourceToTargetLineMap } from '@/vendor/meo/shared/gitDiffLineFlags'

function getOnlyChunk(originalText: string, modifiedText: string) {
  const originalDoc = Text.of(originalText.split('\n'))
  const modifiedDoc = Text.of(modifiedText.split('\n'))
  const chunks = Chunk.build(originalDoc, modifiedDoc)

  expect(chunks).toHaveLength(1)
  return {
    chunk: chunks[0],
    modifiedDoc,
    originalDoc,
  }
}

function getOnlyVsCodeStyleChunk(originalText: string, modifiedText: string) {
  const originalDoc = Text.of(originalText.split('\n'))
  const modifiedDoc = Text.of(modifiedText.split('\n'))
  const chunks = Chunk.build(originalDoc, modifiedDoc, {
    overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
  })

  expect(chunks).toHaveLength(1)
  return {
    chunk: chunks[0],
    modifiedDoc,
    originalDoc,
  }
}

function getVsCodeStyleChunks(originalText: string, modifiedText: string) {
  const originalDoc = Text.of(originalText.split('\n'))
  const modifiedDoc = Text.of(modifiedText.split('\n'))

  return {
    chunks: Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
    }),
    modifiedDoc,
    originalDoc,
  }
}

describe('git diff navigation', () => {
  it('counts every inserted blank line at EOF when converting a CodeMirror merge chunk', () => {
    const baseText = 'L1\nL2\nL3\n'
    const { chunk, modifiedDoc, originalDoc } = getOnlyChunk(baseText, `${baseText}\n\n\n`)

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject({
      modifiedLineCount: 3,
      modifiedStartLine: 4,
      originalLineCount: 0,
      originalStartLine: 3,
    })
  })

  it('counts a middle inserted blank line when converting a CodeMirror merge chunk', () => {
    const { chunk, modifiedDoc, originalDoc } = getOnlyChunk('A\nB\nC\n', 'A\nB\n\nC\n')

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject({
      modifiedLineCount: 1,
      modifiedStartLine: 3,
      originalLineCount: 0,
      originalStartLine: 2,
    })
  })

  it('counts a middle deleted blank line when converting a CodeMirror merge chunk', () => {
    const { chunk, modifiedDoc, originalDoc } = getOnlyChunk('A\nB\n\nC\n', 'A\nB\nC\n')

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject({
      modifiedLineCount: 0,
      modifiedStartLine: 2,
      originalLineCount: 1,
      originalStartLine: 3,
    })
  })

  it('counts final newline-only changes as one modified-side line', () => {
    const { chunk, modifiedDoc, originalDoc } = getOnlyChunk('A', 'A\n')

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject({
      modifiedLineCount: 1,
      modifiedStartLine: 2,
      originalLineCount: 0,
      originalStartLine: 1,
    })
  })

  it('moves no-final-newline EOF insertions onto the inserted visual lines', () => {
    const { chunk, modifiedDoc, originalDoc } = getOnlyChunk('A', 'A\n\n\n')

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject({
      modifiedLineCount: 3,
      modifiedStartLine: 2,
      originalLineCount: 0,
      originalStartLine: 1,
    })
  })

  it.each([
    {
      expected: {
        modifiedLineCount: 3,
        modifiedStartLine: 2,
        originalLineCount: 0,
        originalStartLine: 1,
      },
      modifiedText: 'A\n\n\n',
      name: 'no-final-newline EOF blank line insertion',
      originalText: 'A',
    },
    {
      expected: {
        modifiedLineCount: 3,
        modifiedStartLine: 4,
        originalLineCount: 0,
        originalStartLine: 3,
      },
      modifiedText: 'L1\nL2\nL3\n\n\n\n',
      name: 'EOF blank line insertion after an existing trailing newline',
      originalText: 'L1\nL2\nL3\n',
    },
    {
      expected: {
        modifiedLineCount: 1,
        modifiedStartLine: 3,
        originalLineCount: 0,
        originalStartLine: 2,
      },
      modifiedText: 'A\nB\n\nC\n',
      name: 'middle blank line insertion',
      originalText: 'A\nB\nC\n',
    },
    {
      expected: {
        modifiedLineCount: 2,
        modifiedStartLine: 6,
        originalLineCount: 0,
        originalStartLine: 5,
      },
      modifiedText: '# Tab\n\n- A\n- B\n- C\n\n\n## Project\n-',
      name: 'blank line insertion before pushed-down content',
      originalText: '# Tab\n\n- A\n- B\n- C\n## Project\n-',
    },
    {
      expected: {
        modifiedLineCount: 0,
        modifiedStartLine: 2,
        originalLineCount: 1,
        originalStartLine: 3,
      },
      modifiedText: 'A\nB\nC\n',
      name: 'middle blank line deletion',
      originalText: 'A\nB\n\nC\n',
    },
    {
      expected: {
        modifiedLineCount: 1,
        modifiedStartLine: 2,
        originalLineCount: 1,
        originalStartLine: 2,
      },
      modifiedText: 'A\nX\nC\n',
      name: 'line replacement',
      originalText: 'A\nB\nC\n',
    },
    {
      expected: {
        modifiedLineCount: 1,
        modifiedStartLine: 4,
        originalLineCount: 0,
        originalStartLine: 3,
      },
      modifiedText: '\n\ntest\n',
      name: 'single EOF blank line insertion after a no-final-newline content line',
      originalText: '\n\ntest',
    },
    {
      expected: {
        modifiedLineCount: 1,
        modifiedStartLine: 2,
        originalLineCount: 0,
        originalStartLine: 1,
      },
      modifiedText: 'A\n',
      name: 'final newline insertion',
      originalText: 'A',
    },
    {
      expected: {
        modifiedLineCount: 1,
        modifiedStartLine: 1,
        originalLineCount: 0,
        originalStartLine: 0,
      },
      modifiedText: 'hello',
      name: 'empty file content insertion',
      originalText: '',
    },
  ])('builds CodeMirror merge chunks from VS Code-style line ranges: $name', ({ expected, modifiedText, originalText }) => {
    const { chunk, modifiedDoc, originalDoc } = getOnlyVsCodeStyleChunk(originalText, modifiedText)

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject(expected)
  })

  it('keeps operation ranges separate from visual ranges for no-final-newline EOF insertions', () => {
    const { chunk } = getOnlyVsCodeStyleChunk('A', 'A\n\n\n')

    expect(chunk).toMatchObject({
      actualFromA: 1,
      actualFromB: 1,
      actualToA: 1,
      actualToB: 4,
      fromA: 1,
      fromB: 2,
      toA: 1,
      toB: 5,
    })
  })

  it('does not generate negative inner change offsets for EOF blank-line chunks', () => {
    const { chunk } = getOnlyVsCodeStyleChunk('\n\ntest', '\n\ntest\n')

    expect(chunk).toMatchObject({
      actualFromA: 6,
      actualFromB: 6,
      actualToA: 6,
      actualToB: 7,
      fromA: 6,
      fromB: 7,
      toA: 6,
      toB: 8,
      vscodeModifiedEndLineExclusive: 5,
      vscodeModifiedStartLine: 4,
      vscodeOriginalEndLineExclusive: 4,
      vscodeOriginalStartLine: 4,
    })
    expect(Array.from(chunk.changes, (change) => ({
      fromA: change.fromA,
      fromB: change.fromB,
      toA: change.toA,
      toB: change.toB,
    }))).toEqual([
      {
        fromA: 0,
        fromB: 0,
        toA: 0,
        toB: 0,
      },
    ])
  })

  it('does not count CodeMirror’s visual empty original line as changed content for empty files', () => {
    const { chunk, modifiedDoc, originalDoc } = getOnlyChunk('', 'hello')

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject({
      modifiedLineCount: 1,
      modifiedStartLine: 1,
      originalLineCount: 0,
      originalStartLine: 0,
    })
  })

  it('uses visual diff selections for final newline-only navigation hits', () => {
    const originalText = '\n\ntest'
    const modifiedText = '\n\ntest\n'

    expect(createVisualDiffSelections(originalText, modifiedText)).toEqual([
      {
        modifiedLineCount: 1,
        modifiedStartLine: 4,
        originalLineCount: 0,
        originalStartLine: 3,
      },
    ])
    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 4)).toBe(true)
    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 3)).toBe(false)
  })

  it('treats pure deletion boundaries as worktree navigation hits', () => {
    expect(isLineWithinVisualDiff('A\nB\nC\n', 'B\nC\n', 'worktree', 1)).toBe(true)
    expect(isLineWithinVisualDiff('A\nB\nC\n', 'B\nC\n', 'worktree', 2)).toBe(false)

    expect(isLineWithinVisualDiff('A\nB\nC\n', 'A\nC\n', 'worktree', 1)).toBe(true)
    expect(isLineWithinVisualDiff('A\nB\nC\n', 'A\nC\n', 'worktree', 2)).toBe(false)

    expect(isLineWithinVisualDiff('A\nB\nC\n', 'A\nB\n', 'worktree', 2)).toBe(true)
    expect(isLineWithinVisualDiff('A\nB\nC\n', 'A\nB\n', 'worktree', 1)).toBe(false)
  })

  it('targets the original side for split-view worktree navigation to pure deletions', () => {
    const leading = getVsCodeStyleChunks('A\nB\nC\n', 'B\nC\n')
    expect(findBestNavigationTarget(
      leading.originalDoc,
      leading.modifiedDoc,
      leading.chunks,
      1,
      'modified',
    )?.target).toEqual({
      focusEditor: false,
      lineNumber: 1,
      selectLine: false,
      side: 'original',
    })

    const middle = getVsCodeStyleChunks('A\nB\nC\n', 'A\nC\n')
    expect(findBestNavigationTarget(
      middle.originalDoc,
      middle.modifiedDoc,
      middle.chunks,
      1,
      'modified',
    )?.target).toEqual({
      focusEditor: false,
      lineNumber: 2,
      selectLine: false,
      side: 'original',
    })

    const trailing = getVsCodeStyleChunks('A\nB\nC\n', 'A\nB\n')
    expect(findBestNavigationTarget(
      trailing.originalDoc,
      trailing.modifiedDoc,
      trailing.chunks,
      2,
      'modified',
    )?.target).toEqual({
      focusEditor: false,
      lineNumber: 3,
      selectLine: false,
      side: 'original',
    })
  })

  it('keeps inserted-line navigation scoped to inserted worktree lines', () => {
    const originalText = 'A\nC\n'
    const modifiedText = 'A\nB\nC\n'

    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 2)).toBe(true)
    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 1)).toBe(false)
    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 3)).toBe(false)

    const { chunks, modifiedDoc, originalDoc } = getVsCodeStyleChunks(originalText, modifiedText)
    expect(findBestNavigationTarget(originalDoc, modifiedDoc, chunks, 2, 'modified')?.target).toEqual({
      focusEditor: true,
      lineNumber: 2,
      selectLine: true,
      side: 'modified',
    })
  })

  it('targets staged additions on the index side when navigating from a live gutter marker', () => {
    const headText = 'A\nC\n'
    const indexText = 'A\nB staged\nC\n'
    const currentText = 'intro\nA\nB staged\nC\n'
    const indexDoc = Text.of(indexText.split('\n'))
    const currentDoc = Text.of(currentText.split('\n'))
    const indexToCurrentLineMap = buildSourceToTargetLineMap(indexDoc, currentDoc)
    const clickedCurrentLine = 3
    const clickedIndexLine = indexToCurrentLineMap.findIndex((lineNumber) => lineNumber === clickedCurrentLine)

    expect(clickedIndexLine).toBe(2)

    const { chunks, modifiedDoc, originalDoc } = getVsCodeStyleChunks(headText, indexText)
    expect(findBestNavigationTarget(originalDoc, modifiedDoc, chunks, clickedIndexLine, 'modified')?.target).toEqual({
      focusEditor: true,
      lineNumber: 2,
      selectLine: true,
      side: 'modified',
    })
  })

  it('keeps modified-line navigation scoped to changed lines', () => {
    const originalText = 'A\nB\nC\n'
    const modifiedText = 'A\nX\nC\n'

    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 2)).toBe(true)
    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 1)).toBe(false)
    expect(isLineWithinVisualDiff(originalText, modifiedText, 'worktree', 3)).toBe(false)

    const { chunks, modifiedDoc, originalDoc } = getVsCodeStyleChunks(originalText, modifiedText)
    expect(findBestNavigationTarget(originalDoc, modifiedDoc, chunks, 2, 'modified')?.target).toEqual({
      focusEditor: true,
      lineNumber: 2,
      selectLine: true,
      side: 'modified',
    })
  })
})

import { Text } from '@codemirror/state'
import { Chunk } from '@codemirror/merge'
import { describe, expect, it } from 'vitest'
import { createSelectionFromCodeMirrorChunk } from '@/features/editor/lib/git-diff-navigation'
import { buildCodeMirrorChunksFromVsCodeDiff } from '@/vendor/meo/shared/gitDiffLineFlags'

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

  it('does not count CodeMirror’s visual empty original line as changed content for empty files', () => {
    const { chunk, modifiedDoc, originalDoc } = getOnlyChunk('', 'hello')

    expect(createSelectionFromCodeMirrorChunk(originalDoc, modifiedDoc, chunk)).toMatchObject({
      modifiedLineCount: 1,
      modifiedStartLine: 1,
      originalLineCount: 0,
      originalStartLine: 0,
    })
  })
})

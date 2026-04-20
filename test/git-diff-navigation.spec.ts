import { Text } from '@codemirror/state'
import { Chunk } from '@codemirror/merge'
import { describe, expect, it } from 'vitest'
import { createSelectionFromCodeMirrorChunk } from '@/features/editor/lib/git-diff-navigation'

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
      modifiedStartLine: 1,
      originalLineCount: 1,
      originalStartLine: 1,
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

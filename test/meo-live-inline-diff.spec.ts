import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import type { CodeMirrorDiffChunk } from '../src/features/editor/lib/git-diff-navigation'
import { __meoLiveInlineDiffTestHooks } from '../src/features/editor/lib/meo-native-live-inline-diff'
import { buildCodeMirrorChunksFromVsCodeDiff } from '../src/vendor/meo/shared/gitDiffLineFlags'

function createScenarioDocs() {
  const originalLines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
  originalLines[57] = '## 9. Math formulas'
  originalLines[58] = 'Markdown supports LaTeX formulas.'

  const modifiedLines = [...originalLines]
  modifiedLines[57] = '## 9. Math formulas!'
  modifiedLines[58] = 'Markdown supports LaTeX formulas. extra'

  return {
    modifiedDoc: Text.of(modifiedLines),
    originalDoc: Text.of(originalLines),
  }
}

function createChineseMarkdownScenarioDocs() {
  const originalLines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
  originalLines[57] = '## 9. 数学公式'
  originalLines[58] = 'Markdown 支持 LaTeX 语法来书写数学公式。'

  const modifiedLines = [...originalLines]
  modifiedLines[57] = '## 9. 数学公式发'
  modifiedLines[58] = 'Markdown 支持 LaTeX 语法来书写数学公式。 都得空'

  return {
    modifiedDoc: Text.of(modifiedLines),
    originalDoc: Text.of(originalLines),
  }
}

describe('meo live inline diff', () => {
  it('projects the current-side render envelope back to original lines', () => {
    const { modifiedDoc, originalDoc } = createScenarioDocs()
    const originalParagraph = originalDoc.line(59)
    const modifiedHeading = modifiedDoc.line(58)
    const modifiedParagraph = modifiedDoc.line(59)
    const chunk: CodeMirrorDiffChunk = {
      changes: [],
      endA: originalParagraph.to,
      endB: modifiedParagraph.to,
      fromA: originalParagraph.from,
      fromB: modifiedHeading.from,
      toA: originalParagraph.to,
      toB: modifiedParagraph.to,
      vscodeModifiedEndLineExclusive: 60,
      vscodeModifiedStartLine: 58,
      vscodeOriginalEndLineExclusive: 60,
      vscodeOriginalStartLine: 59,
    }

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      [chunk],
      59,
    )

    expect(match?.selection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 1,
      originalStartLine: 59,
    })
    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
  })

  it('keeps adjacent refreshed chunks in one inline split widget', () => {
    const { modifiedDoc, originalDoc } = createScenarioDocs()
    const originalHeading = originalDoc.line(58)
    const originalParagraph = originalDoc.line(59)
    const modifiedHeading = modifiedDoc.line(58)
    const modifiedParagraph = modifiedDoc.line(59)
    const chunks: CodeMirrorDiffChunk[] = [
      {
        changes: [],
        endA: originalHeading.to,
        endB: modifiedHeading.to,
        fromA: originalHeading.from,
        fromB: modifiedHeading.from,
        toA: originalHeading.to,
        toB: modifiedHeading.to,
        vscodeModifiedEndLineExclusive: 59,
        vscodeModifiedStartLine: 58,
        vscodeOriginalEndLineExclusive: 59,
        vscodeOriginalStartLine: 58,
      },
      {
        changes: [],
        endA: originalParagraph.to,
        endB: modifiedParagraph.to,
        fromA: originalParagraph.from,
        fromB: modifiedParagraph.from,
        toA: originalParagraph.to,
        toB: modifiedParagraph.to,
        vscodeModifiedEndLineExclusive: 60,
        vscodeModifiedStartLine: 59,
        vscodeOriginalEndLineExclusive: 60,
        vscodeOriginalStartLine: 59,
      },
    ]

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      59,
    )

    expect(match?.selection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
    expect(match?.displaySelection).toEqual(match?.selection)
  })

  it('keeps the refreshed markdown block envelope with real diff chunks', () => {
    const { modifiedDoc, originalDoc } = createScenarioDocs()
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      59,
    )

    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
  })

  it('keeps the refreshed Chinese markdown heading and paragraph envelope', () => {
    const { modifiedDoc, originalDoc } = createChineseMarkdownScenarioDocs()
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc) as readonly CodeMirrorDiffChunk[]

    const match = __meoLiveInlineDiffTestHooks.findInlineChunkMatch(
      originalDoc,
      modifiedDoc,
      chunks,
      59,
    )

    expect(match?.displaySelection).toEqual({
      modifiedLineCount: 2,
      modifiedStartLine: 58,
      originalLineCount: 2,
      originalStartLine: 58,
    })
  })

  it('maps an outer live caret inside a refreshed hunk to the inline modified editor', () => {
    const lines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
    lines[57] = '## 9. Math formulasaa'
    lines[58] = 'Markdown supports LaTeX formulas. extra'

    const outerDoc = Text.of(lines)
    const line58 = outerDoc.line(58)
    const line59 = outerDoc.line(59)
    const inlineDoc = Text.of([line58.text, line59.text])
    const cursor = line58.to

    const target = __meoLiveInlineDiffTestHooks.createModifiedSelectionTarget(
      outerDoc,
      {
        modifiedText: inlineDoc.toString(),
        replaceFrom: line58.from,
        replaceTo: line59.to,
      },
      { anchor: cursor, head: cursor },
    )

    expect(target).toEqual({
      anchor: {
        column: line58.text.length,
        lineOffset: 0,
      },
      head: {
        column: line58.text.length,
        lineOffset: 0,
      },
    })
    expect(__meoLiveInlineDiffTestHooks.resolveModifiedSelectionTargetOffsets(inlineDoc, target!)).toEqual({
      anchor: inlineDoc.line(1).to,
      head: inlineDoc.line(1).to,
    })
  })

  it('restores an inline caret to the outer editor when its line leaves the refreshed hunk', () => {
    const lines = Array.from({ length: 62 }, (_, index) => `line ${index + 1}`)
    lines[57] = '## 9. Math formulasaa'
    lines[58] = 'Markdown supports LaTeX formulas.'

    const outerDoc = Text.of(lines)
    const line58 = outerDoc.line(58)
    const line59 = outerDoc.line(59)
    const nextInlineDoc = Text.of([line58.text, line59.text])
    const inlineCursor = nextInlineDoc.line(2).to

    const outerTarget = __meoLiveInlineDiffTestHooks.createOuterSelectionTargetFromInlineSelection(
      line58.from,
      nextInlineDoc.toString(),
      { anchor: inlineCursor, head: inlineCursor },
    )

    expect(__meoLiveInlineDiffTestHooks.createModifiedSelectionTarget(
      outerDoc,
      {
        modifiedText: line58.text,
        replaceFrom: line58.from,
        replaceTo: line58.to,
      },
      outerTarget,
    )).toBeNull()

    const restoredSelection = __meoLiveInlineDiffTestHooks.resolveOuterEditorSelection(outerDoc, outerTarget)
    expect({
      anchor: restoredSelection.main.anchor,
      head: restoredSelection.main.head,
    }).toEqual({
      anchor: line59.to,
      head: line59.to,
    })
  })
})

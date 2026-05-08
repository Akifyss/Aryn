import { describe, expect, it } from 'vitest'
import { Chunk } from '../src/vendor/codemirror-merge/src/chunk'
import { addChunkDecorations, isLineFullyInsertedOrDeleted, isWholeLineChange, normalizeInlineChangeRects, shouldAddTrailingSpacer, shouldMeasureInlineChangeLayer, shouldReadInlineChangeLayerDom, shouldRefreshChunkDecorationsForUpdate, shouldRefreshFrozenChunkDecorationsForUpdate, snapInlineChangeLayerRect, spacerKindAfterChunk, spacerSideAfterChunk } from '../src/vendor/codemirror-merge/src/deco'
import { RangeSetBuilder, Text } from '@codemirror/state'
import { buildCodeMirrorChunksFromVsCodeDiff } from '../src/vendor/meo/shared/gitDiffLineFlags'
import { __meoDiffSplitUnifiedLineNumberTestHooks } from '../src/features/editor/lib/meo-native-diff-split'
import { Decoration } from '@codemirror/view'

const {
  buildUnifiedDiffLineNumberMap,
  getUnifiedSingleLineNumber,
  getLineNumbersInRange,
  getUnifiedDiffChunkLineRange,
  normalizeUnifiedLineNumberOptions,
} = __meoDiffSplitUnifiedLineNumberTestHooks

describe('CodeMirror merge decorations', () => {
  it('builds reusable chunk decorations with the canonical merge classes', () => {
    const originalDoc = Text.of(['one', 'two', 'three'])
    const modifiedDoc = Text.of(['one', 'TWO', 'three'])
    const [chunk] = Chunk.build(originalDoc, modifiedDoc, {
      overrideChunks: buildCodeMirrorChunksFromVsCodeDiff,
      scanLimit: 1000,
      timeout: 200,
    })
    const builder = new RangeSetBuilder<Decoration>()

    addChunkDecorations(chunk, originalDoc, true, true, builder, null, { gutter: false })

    const ranges: Array<{ from: number, to: number, classes: string }> = []
    builder.finish().between(0, originalDoc.length, (from, to, value) => {
      ranges.push({ from, to, classes: value.spec?.class ?? '' })
    })

    expect(ranges).toEqual(expect.arrayContaining([
      { from: originalDoc.line(2).from, to: originalDoc.line(2).from, classes: 'cm-changedLine' },
      { from: originalDoc.line(2).from, to: originalDoc.line(3).from, classes: 'cm-deletedLine' },
      { from: originalDoc.line(2).from, to: originalDoc.line(2).to, classes: 'cm-changedText' },
    ]))
  })

  it('snaps inline change layer rectangles to device pixels', () => {
    expect(snapInlineChangeLayerRect({ left: 10.2, top: 4.25, width: 12.1, height: 20.3 }, 2)).toMatchObject({
      left: 10,
      top: 4,
      width: 12.5,
      height: 21,
    })
  })

  it('treats pure inserted lines as whole-line changes only on the modified side', () => {
    const chunk = new Chunk([], 4, 4, 4, 10)

    expect(isWholeLineChange(chunk, false)).toBe(true)
    expect(isWholeLineChange(chunk, true)).toBe(false)
  })

  it('treats pure deleted lines as whole-line changes only on the original side', () => {
    const chunk = new Chunk([], 4, 10, 4, 4)

    expect(isWholeLineChange(chunk, true)).toBe(true)
    expect(isWholeLineChange(chunk, false)).toBe(false)
  })

  it('keeps replacements in the inline-change path', () => {
    const chunk = new Chunk([], 4, 10, 4, 10)

    expect(isWholeLineChange(chunk, true)).toBe(false)
    expect(isWholeLineChange(chunk, false)).toBe(false)
  })

  it('keeps full-line replacements in the inline-change path', () => {
    const originalDoc = Text.of(['same', 'old sentence', 'same'])
    const modifiedDoc = Text.of(['same', 'new sentence', 'same'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const builder = new RangeSetBuilder<Decoration>()

    addChunkDecorations(chunk, originalDoc, true, true, builder, null, { gutter: false })

    const ranges: Array<{ from: number, to: number, classes: string }> = []
    builder.finish().between(0, originalDoc.length, (from, to, value) => {
      ranges.push({ from, to, classes: value.spec?.class ?? '' })
    })

    expect(isLineFullyInsertedOrDeleted(chunk, chunk.fromA, originalDoc.line(2).from, originalDoc.line(2).to, true)).toBe(false)
    expect(ranges.some((range) => range.classes.includes('cm-deletedLineFull'))).toBe(false)
    expect(ranges.some((range) => range.classes.includes('cm-changedText'))).toBe(true)
  })

  it('promotes single-sided ranges inside replacement chunks to full-line decorations', () => {
    const originalDoc = Text.of([
      'same',
      'shared original',
      'tail',
    ])
    const modifiedDoc = Text.of([
      'same',
      'inserted standalone',
      'shared modified',
      'tail',
      'same',
    ])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const originalBuilder = new RangeSetBuilder<Decoration>()
    const modifiedBuilder = new RangeSetBuilder<Decoration>()

    addChunkDecorations(chunk, originalDoc, true, true, originalBuilder, null, { gutter: false })
    addChunkDecorations(chunk, modifiedDoc, false, true, modifiedBuilder, null, { gutter: false })

    const collectClasses = (doc: Text, builder: RangeSetBuilder<Decoration>) => {
      const ranges: Array<{ from: number, to: number, classes: string }> = []
      builder.finish().between(0, doc.length, (from, to, value) => {
        ranges.push({ from, to, classes: value.spec?.class ?? '' })
      })
      return ranges
    }
    const originalRanges = collectClasses(originalDoc, originalBuilder)
    const modifiedRanges = collectClasses(modifiedDoc, modifiedBuilder)

    expect(isLineFullyInsertedOrDeleted(chunk, chunk.fromB, modifiedDoc.line(2).from, modifiedDoc.line(2).to, false)).toBe(true)
    expect(originalRanges.some((range) => range.classes.includes('cm-deletedLineFull'))).toBe(false)
    expect(modifiedRanges.some((range) => range.classes.includes('cm-insertedLineFull'))).toBe(false)
    expect(modifiedRanges).toEqual(expect.arrayContaining([
      { from: modifiedDoc.line(2).from, to: modifiedDoc.line(2).from, classes: 'cm-changedLine' },
      { from: modifiedDoc.line(2).from, to: modifiedDoc.line(2).to, classes: 'cm-changedText cm-changedTextFullLine' },
    ]))
  })

  it('does not promote same-line empty/non-empty edits to full-line decorations', () => {
    const originalDoc = Text.of(['same', '', 'tail'])
    const modifiedDoc = Text.of(['same', 'abc', 'tail'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const builder = new RangeSetBuilder<Decoration>()

    addChunkDecorations(chunk, modifiedDoc, false, true, builder, null, { gutter: false })

    const ranges: Array<{ from: number, to: number, classes: string }> = []
    builder.finish().between(0, modifiedDoc.length, (from, to, value) => {
      ranges.push({ from, to, classes: value.spec?.class ?? '' })
    })

    expect(isLineFullyInsertedOrDeleted(chunk, chunk.fromB, modifiedDoc.line(2).from, modifiedDoc.line(2).to, false)).toBe(false)
    expect(ranges.some((range) => range.classes.includes('cm-insertedLineFull'))).toBe(false)
    expect(ranges).toEqual(expect.arrayContaining([
      { from: modifiedDoc.line(2).from, to: modifiedDoc.line(2).to, classes: 'cm-changedText' },
    ]))
  })

  it('does not promote same-line non-empty/empty edits to full-line decorations', () => {
    const originalDoc = Text.of(['same', 'abc', 'tail'])
    const modifiedDoc = Text.of(['same', '', 'tail'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const builder = new RangeSetBuilder<Decoration>()

    addChunkDecorations(chunk, originalDoc, true, true, builder, null, { gutter: false })

    const ranges: Array<{ from: number, to: number, classes: string }> = []
    builder.finish().between(0, originalDoc.length, (from, to, value) => {
      ranges.push({ from, to, classes: value.spec?.class ?? '' })
    })

    expect(isLineFullyInsertedOrDeleted(chunk, chunk.fromA, originalDoc.line(2).from, originalDoc.line(2).to, true)).toBe(false)
    expect(ranges.some((range) => range.classes.includes('cm-deletedLineFull'))).toBe(false)
    expect(ranges).toEqual(expect.arrayContaining([
      { from: originalDoc.line(2).from, to: originalDoc.line(2).to, classes: 'cm-changedText' },
    ]))
  })

  it('keeps empty single-sided lines on full-line decorations because there is no text range', () => {
    const originalDoc = Text.of(['same', 'shared original', 'tail'])
    const modifiedDoc = Text.of(['same', '', 'shared modified', 'tail', 'same'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const builder = new RangeSetBuilder<Decoration>()

    addChunkDecorations(chunk, modifiedDoc, false, true, builder, null, { gutter: false })

    const ranges: Array<{ from: number, to: number, classes: string }> = []
    builder.finish().between(0, modifiedDoc.length, (from, to, value) => {
      ranges.push({ from, to, classes: value.spec?.class ?? '' })
    })

    expect(isLineFullyInsertedOrDeleted(chunk, chunk.fromB, modifiedDoc.line(2).from, modifiedDoc.line(2).to, false)).toBe(true)
    expect(ranges).toEqual(expect.arrayContaining([
      { from: modifiedDoc.line(2).from, to: modifiedDoc.line(2).from, classes: 'cm-insertedLineFull' },
    ]))
  })

  it('places EOF fake-line spacers after the final content line', () => {
    const originalDoc = Text.of(['line 580', 'line 581'])
    const modifiedDoc = Text.of(['line 580', 'line 581', 'added'])
    const chunk = new Chunk([], originalDoc.length, originalDoc.length, originalDoc.length, modifiedDoc.length)

    expect(spacerSideAfterChunk(chunk, 'fakeLines', originalDoc, originalDoc.length)).toBe(1)
  })

  it('keeps fake-line spacers before the next line when the insertion point is a line start', () => {
    const originalDoc = Text.of(['line 1', 'line 2'])
    const modifiedDoc = Text.of(['line 1', 'added', 'line 2'])
    const insertionPoint = originalDoc.line(2).from
    const chunk = new Chunk([], insertionPoint, insertionPoint, insertionPoint, modifiedDoc.line(3).from)

    expect(spacerSideAfterChunk(chunk, 'fakeLines', originalDoc, insertionPoint)).toBe(-1)
  })

  it('places EOF fake-line spacers after an empty final changed line', () => {
    const originalDoc = Text.of(['line 580', 'line 581', ''])
    const modifiedDoc = Text.of(['line 580', 'line 581', 'added', ''])
    const chunk = new Chunk([], originalDoc.length, originalDoc.length + 1, originalDoc.length, modifiedDoc.length)

    expect(spacerSideAfterChunk(chunk, 'fakeLines', originalDoc, originalDoc.length)).toBe(1)
  })

  it('places VS Code-style EOF insertion spacers after the original empty final line', () => {
    const originalDoc = Text.of(['formula', ''])
    const modifiedDoc = Text.of(['formula', 'added 1', 'added 2', ''])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)

    expect(chunk).toMatchObject({
      fromA: originalDoc.length,
      toA: originalDoc.length,
    })
    expect(spacerSideAfterChunk(chunk, 'fakeLines', originalDoc, originalDoc.length)).toBe(1)
  })

  it('does not classify inline EOF insertions as fake lines', () => {
    const originalDoc = Text.of(['Markdown 支持 LaTeX 语法来书写数学公式。'])
    const modifiedDoc = Text.of(['Markdown 支持 LaTeX 语法来书写数学公式。哒哒哒哒'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)

    expect(spacerKindAfterChunk(chunk, 'a', false, originalDoc, modifiedDoc)).toBe('alignment')
  })

  it('keeps whole-line EOF insertions classified as fake lines', () => {
    const originalDoc = Text.of(['formula'])
    const modifiedDoc = Text.of(['formula', 'added'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)

    expect(spacerKindAfterChunk(chunk, 'a', false, originalDoc, modifiedDoc)).toBe('fakeLines')
  })

  it('keeps VS Code-style middle insertion spacers before the following unchanged line', () => {
    const originalDoc = Text.of(['formula', 'tail'])
    const modifiedDoc = Text.of(['formula', 'added', 'tail'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const insertionPoint = originalDoc.line(2).from

    expect(chunk).toMatchObject({
      fromA: insertionPoint,
      toA: insertionPoint,
    })
    expect(spacerKindAfterChunk(chunk, 'a', false, originalDoc, modifiedDoc)).toBe('fakeLines')
    expect(spacerSideAfterChunk(chunk, 'fakeLines', originalDoc, insertionPoint)).toBe(-1)
  })

  it('keeps VS Code-style replacement spacers after the changed middle line', () => {
    const originalDoc = Text.of(['formula', 'old', 'tail'])
    const modifiedDoc = Text.of(['formula', 'new 1', 'new 2', 'tail'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const followingLineStart = originalDoc.line(3).from

    expect(chunk).toMatchObject({
      fromA: originalDoc.line(2).from,
      toA: followingLineStart,
    })
    expect(spacerKindAfterChunk(chunk, 'a', false, originalDoc, modifiedDoc)).toBe('fakeLines')
    expect(spacerSideAfterChunk(chunk, 'fakeLines', originalDoc, followingLineStart)).toBe(-1)
  })

  it('keeps VS Code-style middle deletion spacers before the following unchanged line', () => {
    const originalDoc = Text.of(['formula', 'deleted', 'tail'])
    const modifiedDoc = Text.of(['formula', 'tail'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const followingLineStart = modifiedDoc.line(2).from

    expect(chunk).toMatchObject({
      fromB: followingLineStart,
      toB: followingLineStart,
    })
    expect(spacerKindAfterChunk(chunk, 'b', false, originalDoc, modifiedDoc)).toBe('fakeLines')
    expect(spacerSideAfterChunk(chunk, 'fakeLines', modifiedDoc, followingLineStart)).toBe(-1)
  })

  it('places VS Code-style EOF deletion spacers after the final modified line', () => {
    const originalDoc = Text.of(['formula', 'deleted'])
    const modifiedDoc = Text.of(['formula'])
    const [chunk] = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)

    expect(chunk).toMatchObject({
      fromB: modifiedDoc.length,
      toB: modifiedDoc.length,
    })
    expect(spacerSideAfterChunk(chunk, 'fakeLines', modifiedDoc, modifiedDoc.length)).toBe(1)
  })

  it('maps unified diff line numbers to old/new columns', () => {
    const originalDoc = Text.of([
      'task 1',
      'task 2',
      '## 9. old title',
      'old formula',
      'after',
    ])
    const modifiedDoc = Text.of([
      'task 1',
      'task 2',
      '## 9. new title',
      'new formula phone',
      'after',
    ])
    const chunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, modifiedDoc)
    const lineNumberMap = buildUnifiedDiffLineNumberMap(originalDoc, modifiedDoc, chunks)
    const [chunk] = chunks
    const range = getUnifiedDiffChunkLineRange(originalDoc, modifiedDoc, chunk)

    expect(lineNumberMap.originalByModifiedLine.slice(1)).toEqual([1, 2, null, null, 5])
    expect(lineNumberMap.modifiedLineChanged.slice(1)).toEqual([false, false, true, true, false])
    expect(getLineNumbersInRange(range.originalStartLine, range.originalEndLineExclusive)).toEqual([3, 4])
  })

  it('maps pure insertions and deletions without shifting unchanged unified line numbers', () => {
    const originalDoc = Text.of(['A', 'B', 'C', 'D'])
    const insertedDoc = Text.of(['A', 'X', 'Y', 'B', 'C', 'D'])
    const deletedDoc = Text.of(['A', 'D'])

    const insertionMap = buildUnifiedDiffLineNumberMap(
      originalDoc,
      insertedDoc,
      buildCodeMirrorChunksFromVsCodeDiff(originalDoc, insertedDoc),
    )
    const deletionChunks = buildCodeMirrorChunksFromVsCodeDiff(originalDoc, deletedDoc)
    const deletionMap = buildUnifiedDiffLineNumberMap(originalDoc, deletedDoc, deletionChunks)
    const deletionRange = getUnifiedDiffChunkLineRange(originalDoc, deletedDoc, deletionChunks[0])

    expect(insertionMap.originalByModifiedLine.slice(1)).toEqual([1, null, null, 2, 3, 4])
    expect(deletionMap.originalByModifiedLine.slice(1)).toEqual([1, 4])
    expect(getLineNumbersInRange(deletionRange.originalStartLine, deletionRange.originalEndLineExclusive)).toEqual([2, 3])
  })

  it('keeps unified diff line numbers dual by default and supports inline single-column display', () => {
    expect(normalizeUnifiedLineNumberOptions(58)).toEqual({
      display: 'dual',
      modifiedLineStart: 58,
      originalLineStart: 58,
    })
    expect(normalizeUnifiedLineNumberOptions({
      display: 'single',
      modifiedLineStart: 58,
      originalLineStart: 55,
    })).toEqual({
      display: 'single',
      modifiedLineStart: 58,
      originalLineStart: 55,
    })
    expect(getUnifiedSingleLineNumber({ modified: 58, original: null })).toBe(58)
    expect(getUnifiedSingleLineNumber({ modified: null, original: 55 })).toBe(55)
  })

  it('uses normal before-line placement for non-fake alignment spacers', () => {
    const doc = Text.of(['line 1'])
    const chunk = new Chunk([], doc.length, doc.length, doc.length, doc.length + 1)

    expect(spacerSideAfterChunk(chunk, 'alignment', doc, doc.length)).toBe(-1)
  })

  it('can suppress trailing alignment spacers while keeping fake-line spacers', () => {
    expect(shouldAddTrailingSpacer('alignment', 'fakeLines')).toBe(false)
    expect(shouldAddTrailingSpacer('fakeLines', 'fakeLines')).toBe(true)
  })

  it('expands inline highlight rects to the default line height', () => {
    const [rect] = normalizeInlineChangeRects([
      { left: 0, top: 4, width: 12, height: 16 },
    ], 24)

    expect(rect).toEqual({ left: 0, top: 0, width: 12, height: 24 })
  })

  it('keeps taller inline highlight rects for heading-sized rows', () => {
    const [rect] = normalizeInlineChangeRects([
      { left: 0, top: 0, width: 12, height: 38 },
    ], 24)

    expect(rect).toEqual({ left: 0, top: 0, width: 12, height: 38 })
  })

  it('uses the measured visual row box when the inline text box is shorter', () => {
    const [rect] = normalizeInlineChangeRects([
      { left: 0, top: 6, width: 12, height: 30, lineHeight: 38, rowTop: 0, rowBottom: 38 },
    ], 24)

    expect(rect).toEqual({ left: 0, top: 0, width: 12, height: 38 })
  })

  it('keeps wrapped visual rows aligned to their measured row boxes', () => {
    const [first, second] = normalizeInlineChangeRects([
      { left: 0, top: 4, width: 12, height: 16, lineHeight: 24, rowTop: 0, rowBottom: 24 },
      { left: 0, top: 28, width: 12, height: 16, lineHeight: 24, rowTop: 24, rowBottom: 48 },
    ], 24)

    expect(first).toEqual({ left: 0, top: 0, width: 12, height: 24 })
    expect(second).toEqual({ left: 0, top: 24, width: 12, height: 24 })
  })

  it('closes small gaps between adjacent visual rows without shrinking tall rows', () => {
    const [heading, next] = normalizeInlineChangeRects([
      { left: 0, top: 0, width: 12, height: 38 },
      { left: 0, top: 44, width: 12, height: 16 },
    ], 24)

    expect(heading.height).toBeGreaterThan(38)
    expect(next.top).toBeLessThan(40)
    expect(next.height).toBeGreaterThan(24)
  })

  it('remeasures inline highlights for focus and explicit live-layout refreshes', () => {
    expect(shouldMeasureInlineChangeLayer({ focusChanged: true })).toBe(true)
    expect(shouldMeasureInlineChangeLayer({ refreshRequested: true })).toBe(true)
    expect(shouldMeasureInlineChangeLayer({})).toBe(false)
  })

  it('does not remeasure inline highlights while merge chunks are deferred', () => {
    expect(shouldMeasureInlineChangeLayer({ deferredChunkUpdate: true, docChanged: true })).toBe(false)
    expect(shouldMeasureInlineChangeLayer({ deferredChunkUpdate: true, viewportChanged: true })).toBe(false)
    expect(shouldMeasureInlineChangeLayer({ deferredChunkUpdate: true, refreshRequested: true })).toBe(false)
  })

  it('does not read inline highlight DOM while merge chunks are deferred', () => {
    expect(shouldReadInlineChangeLayerDom(true)).toBe(false)
    expect(shouldReadInlineChangeLayerDom(false)).toBe(true)
    expect(shouldReadInlineChangeLayerDom()).toBe(true)
  })

  it('keeps frozen chunk decorations responsive to viewport changes', () => {
    expect(shouldRefreshFrozenChunkDecorationsForUpdate({ viewportChanged: true })).toBe(true)
    expect(shouldRefreshFrozenChunkDecorationsForUpdate({ configChanged: true })).toBe(true)
    expect(shouldRefreshFrozenChunkDecorationsForUpdate({ docChanged: true, viewportChanged: true })).toBe(false)
    expect(shouldRefreshFrozenChunkDecorationsForUpdate({})).toBe(false)
  })

  it('refreshes chunk decorations for explicit refresh requests', () => {
    expect(shouldRefreshChunkDecorationsForUpdate({ refreshRequested: true })).toBe(true)
    expect(shouldRefreshChunkDecorationsForUpdate({ viewportChanged: true })).toBe(true)
    expect(shouldRefreshChunkDecorationsForUpdate({ docChanged: true })).toBe(true)
    expect(shouldRefreshChunkDecorationsForUpdate({ configChanged: true })).toBe(true)
    expect(shouldRefreshChunkDecorationsForUpdate({})).toBe(false)
  })
})

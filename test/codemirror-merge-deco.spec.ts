import { describe, expect, it } from 'vitest'
import { Chunk } from '../src/vendor/codemirror-merge/src/chunk'
import { isWholeLineChange, normalizeInlineChangeRects, spacerSideAfterChunk } from '../src/vendor/codemirror-merge/src/deco'
import { Text } from '@codemirror/state'
import { buildCodeMirrorChunksFromVsCodeDiff } from '../src/vendor/meo/shared/gitDiffLineFlags'

describe('CodeMirror merge decorations', () => {
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

  it('uses normal before-line placement for non-fake alignment spacers', () => {
    const doc = Text.of(['line 1'])
    const chunk = new Chunk([], doc.length, doc.length, doc.length, doc.length + 1)

    expect(spacerSideAfterChunk(chunk, 'alignment', doc, doc.length)).toBe(-1)
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
})

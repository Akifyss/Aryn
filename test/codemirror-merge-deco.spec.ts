import { describe, expect, it } from 'vitest'
import { Chunk } from '../src/vendor/codemirror-merge/src/chunk'
import { isWholeLineChange, normalizeInlineChangeRects } from '../src/vendor/codemirror-merge/src/deco'

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

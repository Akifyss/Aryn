import { describe, expect, it } from 'vitest'
import { Chunk } from '../src/vendor/codemirror-merge/src/chunk'
import { isWholeLineChange } from '../src/vendor/codemirror-merge/src/deco'

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
})

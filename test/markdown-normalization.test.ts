import { describe, expect, it } from 'vitest'
import { normalizeMarkdownForComparison } from '../src/features/editor/lib/markdown'

describe('normalizeMarkdownForComparison', () => {
  it('treats Windows and Unix line endings as equivalent', () => {
    expect(normalizeMarkdownForComparison('a\r\nb\r\nc')).toBe('a\nb\nc')
  })

  it('normalizes non-breaking spaces to plain spaces', () => {
    expect(normalizeMarkdownForComparison('a\u00A0b&nbsp;c&#160;d')).toBe('a b c d')
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildOutlineSubtreeEndIndexes,
  resolveOutlineDropTarget,
} from '../src/features/editor/lib/meo-native-outline'
import type { MeoHeading } from '../src/features/editor/lib/meo-native-editor-types'

const headings: MeoHeading[] = [
  { from: 0, level: 1, line: 1, text: 'A' },
  { from: 10, level: 2, line: 2, text: 'A.1' },
  { from: 20, level: 2, line: 3, text: 'A.2' },
  { from: 30, level: 1, line: 4, text: 'B' },
  { from: 40, level: 2, line: 5, text: 'B.1' },
]

describe('MEO React outline movement model', () => {
  it('computes the inclusive subtree boundary for every heading', () => {
    expect(buildOutlineSubtreeEndIndexes(headings)).toEqual([2, 1, 2, 4, 4])
  })

  it('rejects drops into the source subtree and structural no-ops', () => {
    expect(resolveOutlineDropTarget({
      headings,
      placement: 'before',
      sourceFrom: 0,
      targetFrom: 10,
    })).toBeNull()

    expect(resolveOutlineDropTarget({
      headings,
      placement: 'before',
      sourceFrom: 0,
      targetFrom: 30,
    })).toBeNull()
  })

  it('allows moving complete heading subtrees to a meaningful destination', () => {
    expect(resolveOutlineDropTarget({
      headings,
      placement: 'after',
      sourceFrom: 0,
      targetFrom: 30,
    })).toEqual({ placement: 'after', targetFrom: 30 })

    expect(resolveOutlineDropTarget({
      headings,
      placement: 'before',
      sourceFrom: 30,
      targetFrom: 0,
    })).toEqual({ placement: 'before', targetFrom: 0 })
  })

  it('rejects stale heading identifiers without throwing', () => {
    expect(resolveOutlineDropTarget({
      headings,
      placement: 'after',
      sourceFrom: 999,
      targetFrom: 30,
    })).toBeNull()
  })
})

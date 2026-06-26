import { describe, expect, it } from 'vitest'
import {
  resolveAgentMessageVirtualItemTop,
  resolveAgentMessageVirtualRange,
  shouldRestoreAgentMessageVirtualAnchor,
} from '../src/features/agent/lib/message-virtualization'

describe('resolveAgentMessageVirtualRange', () => {
  it('renders the first viewport plus overscan at the top', () => {
    expect(resolveAgentMessageVirtualRange({
      count: 20,
      estimatedHeight: 100,
      gap: 10,
      overscan: 100,
      scrollTop: 0,
      viewportHeight: 250,
    })).toEqual({
      afterHeight: 1750,
      beforeHeight: 0,
      endIndex: 4,
      startIndex: 0,
      totalHeight: 2190,
    })
  })

  it('renders a middle window with spacer heights around it', () => {
    expect(resolveAgentMessageVirtualRange({
      count: 20,
      estimatedHeight: 100,
      gap: 10,
      overscan: 50,
      scrollTop: 660,
      viewportHeight: 220,
    })).toEqual({
      afterHeight: 1200,
      beforeHeight: 550,
      endIndex: 9,
      startIndex: 5,
      totalHeight: 2190,
    })
  })

  it('clamps an oversized scrollTop to the bottom window', () => {
    expect(resolveAgentMessageVirtualRange({
      count: 10,
      estimatedHeight: 100,
      gap: 10,
      overscan: 0,
      scrollTop: Number.MAX_SAFE_INTEGER,
      viewportHeight: 250,
    })).toEqual({
      afterHeight: 0,
      beforeHeight: 770,
      endIndex: 10,
      startIndex: 7,
      totalHeight: 1090,
    })
  })

  it('uses measured heights when available', () => {
    expect(resolveAgentMessageVirtualRange({
      count: 4,
      estimatedHeight: 100,
      gap: 10,
      measuredHeights: [50, undefined, 200, null],
      overscan: 0,
      scrollTop: 61,
      viewportHeight: 100,
    })).toEqual({
      afterHeight: 310,
      beforeHeight: 60,
      endIndex: 2,
      startIndex: 1,
      totalHeight: 480,
    })
  })

  it('resolves an item top from the same measured height map used for virtual ranges', () => {
    expect(resolveAgentMessageVirtualItemTop({
      count: 5,
      estimatedHeight: 100,
      gap: 10,
      index: 3,
      measuredHeights: [80, undefined, 160, 90],
    })).toBe(370)
  })
})

describe('shouldRestoreAgentMessageVirtualAnchor', () => {
  it('restores only when an earlier virtual item changes height', () => {
    expect(shouldRestoreAgentMessageVirtualAnchor({
      anchorIndex: 5,
      changedIndex: 4,
    })).toBe(true)

    expect(shouldRestoreAgentMessageVirtualAnchor({
      anchorIndex: 5,
      changedIndex: 5,
    })).toBe(false)

    expect(shouldRestoreAgentMessageVirtualAnchor({
      anchorIndex: 5,
      changedIndex: 6,
    })).toBe(false)
  })

  it('does not restore when either index is unavailable', () => {
    expect(shouldRestoreAgentMessageVirtualAnchor({
      anchorIndex: -1,
      changedIndex: 4,
    })).toBe(false)

    expect(shouldRestoreAgentMessageVirtualAnchor({
      anchorIndex: 5,
      changedIndex: -1,
    })).toBe(false)
  })
})

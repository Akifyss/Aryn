import { describe, expect, it } from 'vitest'
import {
  createProjectMenuVirtualAnchor,
  resolveProjectMenuCollisionBoundary,
  serializeProjectMenuAnchorRect,
} from '../src/features/workspace/components/project-menu/project-menu-positioning'

describe('project menu positioning', () => {
  it('serializes only stable anchor geometry', () => {
    const rect = {
      bottom: 70,
      height: 30,
      left: 20,
      right: 140,
      top: 40,
      width: 120,
      x: 20,
      y: 40,
      toJSON: () => ({}),
    } as DOMRect

    expect(serializeProjectMenuAnchorRect(rect)).toEqual({
      bottom: 70,
      height: 30,
      left: 20,
      right: 140,
      top: 40,
      width: 120,
    })
  })

  it('uses the drawer frame for fallback anchors and collision bounds', () => {
    const frameRect = { height: 500, left: 100, top: 50, width: 320 }
    const anchor = createProjectMenuVirtualAnchor(null, frameRect).getBoundingClientRect()

    expect(anchor).toMatchObject({
      bottom: 58,
      height: 0,
      left: 108,
      right: 108,
      top: 58,
      width: 0,
      x: 108,
      y: 58,
    })
    expect(resolveProjectMenuCollisionBoundary(frameRect)).toEqual({
      height: 500,
      width: 320,
      x: 100,
      y: 50,
    })
  })
})

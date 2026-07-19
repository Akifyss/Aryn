import { describe, expect, it } from 'vitest'
import {
  createProjectMenuVirtualAnchor,
  resolveProjectMenuCollisionBoundary,
  resolveProjectMenuStyle,
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

  it('sizes global switch menus against the viewport', () => {
    const viewport = { height: 768, width: 1280 }

    expect(resolveProjectMenuStyle('editor-switch', false, viewport)).toEqual({
      '--project-menu-list-max-height': '320px',
      width: '320px',
    })
    expect(resolveProjectMenuStyle('agent-add', false, viewport)).toEqual({
      width: '288px',
    })
  })

  it('reserves room for fixed actions inside a short drawer frame', () => {
    const frameRect = { height: 240, left: 12, top: 20, width: 300 }

    expect(resolveProjectMenuStyle('agent-new-switch', false, frameRect)).toEqual({
      '--project-menu-list-max-height': '92px',
      width: '284px',
    })
    expect(resolveProjectMenuStyle('agent-new-switch', true, frameRect)).toEqual({
      '--project-menu-list-max-height': '53px',
      width: '284px',
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

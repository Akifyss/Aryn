import { describe, expect, it } from 'vitest'
import { createFileTabsBoundaryPaths } from '../src/features/workspace/components/file-tabs/file-tabs-boundary-path'

const interiorTabGeometry = {
  frameHeight: 500,
  frameWidth: 800,
  radius: 10,
  shape: {
    kind: 'active' as const,
    activeHeight: 38,
    activeLeft: 90,
    activeTop: 5,
    activeWidth: 100,
  },
}

describe('file tabs boundary path', () => {
  it('draws the left divider, content corner, active tab, and top edge as one outline', () => {
    const paths = createFileTabsBoundaryPaths(interiorTabGeometry)

    expect(paths).not.toBeNull()
    expect(paths?.boundaryY).toBe(42.5)
    expect(paths?.withLeftBoundary.outlinePath).toMatch(
      /^M 0\.5 500 L 0\.5 52\.5 C .* 10\.5 42\.5 L 80\.5 42\.5 C /,
    )
    expect(paths?.withLeftBoundary.outlinePath.endsWith('L 800 42.5')).toBe(true)
    expect(paths?.withLeftBoundary.outlinePathWithRightBoundary).toMatch(
      /L 789\.5 42\.5 C .* 799\.5 52\.5 L 799\.5 500$/,
    )
    expect(paths?.withLeftBoundary.activeFillPath.startsWith('M 80.5 42.5 C')).toBe(true)
    expect(paths?.withLeftBoundary.activeFillPath.endsWith('L 80.5 43 Z')).toBe(true)
    expect(paths?.withLeftBoundary.surfacePath).toMatch(
      /^M 0\.5 500 .* L 800 42\.5 L 800 500 L 0\.5 500 Z$/,
    )
    expect(paths?.withLeftBoundary.surfacePathWithRightBoundary).toMatch(
      /^M 0\.5 500 .* L 799\.5 500 L 0\.5 500 Z$/,
    )
    expect(paths?.withLeftBoundary.outlinePath).not.toContain(' Z')
    expect(paths?.withLeftBoundary.outlinePath).not.toContain('NaN')
  })

  it('uses the same continuous active profile without manufacturing a left divider', () => {
    const paths = createFileTabsBoundaryPaths(interiorTabGeometry)

    expect(paths).not.toBeNull()
    expect(paths?.withoutLeftBoundary.outlinePath.startsWith('M 0 42.5 L 80.5 42.5 C')).toBe(true)
    expect(paths?.withoutLeftBoundary.outlinePath.endsWith('L 800 42.5')).toBe(true)
    expect(paths?.withoutLeftBoundary.outlinePathWithRightBoundary).toMatch(
      /L 789\.5 42\.5 C .* 799\.5 52\.5 L 799\.5 500$/,
    )
    expect(paths?.withoutLeftBoundary.outlinePath).not.toContain('M 0.5 500')
    expect(paths?.withoutLeftBoundary.surfacePath).toMatch(
      /^M 0 42\.5 .* L 800 500 L 0 500 Z$/,
    )
  })

  it('merges the first active tab directly into the left divider', () => {
    const paths = createFileTabsBoundaryPaths({
      ...interiorTabGeometry,
      shape: {
        ...interiorTabGeometry.shape,
        activeLeft: 0,
      },
    })

    expect(paths).not.toBeNull()
    expect(paths?.withLeftBoundary.outlinePath.startsWith('M 0.5 500 L 0.5 42.5 L 0.5 15.5')).toBe(true)
    expect(paths?.withoutLeftBoundary.outlinePath.startsWith('M 0.5 42.5 L 0.5 15.5')).toBe(true)
  })

  it('returns no path until the frame and active tab have measurable geometry', () => {
    expect(createFileTabsBoundaryPaths({
      ...interiorTabGeometry,
      frameWidth: 0,
    })).toBeNull()
  })

  it('uses the same complete frame outline when there is no active tab', () => {
    const paths = createFileTabsBoundaryPaths({
      frameHeight: 500,
      frameWidth: 800,
      radius: 10,
      shape: {
        kind: 'empty',
        railHeight: 43,
      },
    })

    expect(paths).not.toBeNull()
    expect(paths?.boundaryY).toBe(42.5)
    expect(paths?.withLeftBoundary.outlinePath).toBe(
      'M 0.5 500 L 0.5 52.5 C 0.5 46.977 4.977 42.5 10.5 42.5 L 800 42.5',
    )
    expect(paths?.withLeftBoundary.outlinePathWithRightBoundary).toMatch(
      /^M 0\.5 500 .* L 789\.5 42\.5 C .* 799\.5 52\.5 L 799\.5 500$/,
    )
    expect(paths?.withoutLeftBoundary.outlinePath).toBe('M 0 42.5 L 800 42.5')
    expect(paths?.withLeftBoundary.activeFillPath).toBeNull()
    expect(paths?.withoutLeftBoundary.activeFillPath).toBeNull()
    expect(paths?.withLeftBoundary.surfacePath).toBe(
      'M 0.5 500 L 0.5 52.5 C 0.5 46.977 4.977 42.5 10.5 42.5 L 800 42.5 L 800 500 L 0.5 500 Z',
    )
    expect(paths?.withoutLeftBoundary.surfacePathWithRightBoundary).toMatch(
      /^M 0 42\.5 .* L 799\.5 500 L 0 500 Z$/,
    )
  })

  it('keeps active and empty outlines on the same full-height chrome boundary', () => {
    const activePaths = createFileTabsBoundaryPaths({
      frameHeight: 500,
      frameWidth: 800,
      radius: 8,
      shape: {
        kind: 'active',
        activeHeight: 38,
        activeLeft: 90,
        activeTop: 6,
        activeWidth: 100,
      },
    })
    const emptyPaths = createFileTabsBoundaryPaths({
      frameHeight: 500,
      frameWidth: 800,
      radius: 8,
      shape: {
        kind: 'empty',
        railHeight: 44,
      },
    })

    expect(activePaths?.boundaryY).toBe(43.5)
    expect(emptyPaths?.boundaryY).toBe(43.5)
    expect(activePaths?.withLeftBoundary.activeFillPath).toMatch(/L 82\.5 44 Z$/)
    expect(emptyPaths?.withLeftBoundary.outlinePath).toMatch(
      /^M 0\.5 500 L 0\.5 51\.5 C .* 8\.5 43\.5 L 800 43\.5$/,
    )
  })

  it('returns no path until the empty rail has measurable geometry', () => {
    expect(createFileTabsBoundaryPaths({
      frameHeight: 500,
      frameWidth: 800,
      radius: 10,
      shape: {
        kind: 'empty',
        railHeight: 0,
      },
    })).toBeNull()
  })
})

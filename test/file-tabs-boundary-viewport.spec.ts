import { describe, expect, it } from 'vitest'
import { getVisibleFileTabsBoundaryShape } from '../src/features/workspace/components/file-tabs/file-tabs-boundary-viewport'
import { createFileTabsBoundaryRenderablePaths } from '../src/features/workspace/components/file-tabs/file-tabs-boundary-path'

const active = { kind: 'active' as const, activeLeft: 160, activeWidth: 100, activeTop: 6, activeHeight: 38 }

describe('file tab viewport boundary', () => {
  it('leaves a fully visible selected tab unchanged', () => {
    expect(getVisibleFileTabsBoundaryShape(active, 0, 300)).toEqual(active)
  })
  it('stops the selected body at the text viewport before reserved window controls', () => {
    expect(getVisibleFileTabsBoundaryShape(active, 0, 210)).toEqual({ ...active, activeWidth: 50 })
  })
  it('clips the left edge when scrolling behind leading chrome', () => {
    expect(getVisibleFileTabsBoundaryShape(active, 180, 300)).toEqual({ ...active, activeLeft: 180, activeWidth: 80 })
  })
  it.each([[0, 100], [280, 350], [210, 210]])('keeps the panel outline when the selected tab is outside viewport %s..%s', (left, right) => {
    const shape = getVisibleFileTabsBoundaryShape(active, left, right)
    expect(shape).toEqual({ kind: 'empty', railHeight: 44 })
    const paths = createFileTabsBoundaryRenderablePaths({ frameWidth: 400, frameHeight: 600, radius: 8,
      hasBottomBoundary: true, hasLeftBoundary: true, hasRightBoundary: true, shape })
    expect(paths?.activeFillPath).toBeNull()
    expect(paths?.outlinePath).toBeTruthy()
    expect(paths?.surfacePath).toBeTruthy()
  })
  it('preserves empty rails', () => {
    expect(getVisibleFileTabsBoundaryShape({ kind: 'empty', railHeight: 44 }, 0, 100)).toEqual({ kind: 'empty', railHeight: 44 })
  })
})

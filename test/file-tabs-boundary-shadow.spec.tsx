import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  createFileTabsShadowSnapshot,
  FileTabsBoundaryShadowLayer,
  getFileTabsShadowSnapshotCssTransform,
} from '../src/features/workspace/components/file-tabs/file-tabs-boundary-shadow'
import { createFileTabsBoundaryPaths } from '../src/features/workspace/components/file-tabs/file-tabs-boundary-path'

function createTestPaths() {
  const paths = createFileTabsBoundaryPaths({
    frameHeight: 300,
    frameWidth: 400,
    radius: 8,
    shape: {
      activeHeight: 38,
      activeLeft: 24,
      activeTop: 6,
      activeWidth: 140,
      kind: 'active',
    },
  })

  if (!paths) {
    throw new Error('Expected valid boundary paths for the shadow fixture')
  }

  return paths
}

describe('file tab boundary shadow', () => {
  it('captures every filter input as one immutable layout snapshot', () => {
    const paths = createTestPaths()
    const snapshot = createFileTabsShadowSnapshot({
      frameHeight: 300,
      frameLeft: 320,
      frameTop: 44,
      frameWidth: 400,
      hasLeftBoundary: true,
      hasRightBoundary: false,
    }, paths)

    expect(snapshot).toEqual({
      frameHeight: 300,
      frameLeft: 320,
      frameTop: 44,
      frameWidth: 400,
      hasLeftBoundary: true,
      hasRightBoundary: false,
      paths,
    })
    expect(snapshot.paths).toBe(paths)
  })

  it('allocates a compositor transform only when the frame actually moves or resizes', () => {
    const geometry = {
      frameHeight: 900,
      frameLeft: 320,
      frameTop: 44,
      frameWidth: 1200,
    }

    expect(getFileTabsShadowSnapshotCssTransform(geometry, geometry)).toBeUndefined()
    expect(getFileTabsShadowSnapshotCssTransform(geometry, {
      frameHeight: 900,
      frameLeft: 0,
      frameTop: 44,
      frameWidth: 1520,
    })).toBe('translate3d(-320px, 0px, 0) scale(1.2666666666666666, 1)')
  })

  it('renders the frozen boundary variant through an outer-only SVG shadow filter', () => {
    const paths = createTestPaths()
    const snapshot = createFileTabsShadowSnapshot({
      frameHeight: 300,
      frameLeft: 320,
      frameTop: 44,
      frameWidth: 400,
      hasLeftBoundary: true,
      hasRightBoundary: true,
    }, paths)
    const markup = renderToStaticMarkup(
      <FileTabsBoundaryShadowLayer
        className='file-tabs-boundary-shadow-layer'
        filterId='test-shadow-filter'
        shadowLayers={[{
          blurRadius: 4,
          color: 'rgba(0, 0, 0, 0.12)',
          offsetX: 0,
          offsetY: 1,
          spreadRadius: 0,
        }]}
        snapshot={snapshot}
      />,
    )

    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('id="test-shadow-filter"')
    expect(markup).toContain('operator="out"')
    expect(markup).toContain('filter="url(#test-shadow-filter)"')
    expect(markup).toContain(`d="${paths.withLeftBoundary.surfacePathWithRightBoundary}"`)

    const detachedMarkup = renderToStaticMarkup(
      <FileTabsBoundaryShadowLayer
        className='file-tabs-boundary-shadow-layer'
        filterId='detached-shadow-filter'
        shadowLayers={[]}
        snapshot={createFileTabsShadowSnapshot({
          frameHeight: 300,
          frameLeft: 0,
          frameTop: 44,
          frameWidth: 400,
          hasLeftBoundary: false,
          hasRightBoundary: false,
        }, paths)}
      />,
    )

    expect(detachedMarkup).toContain(`d="${paths.withoutLeftBoundary.surfacePath}"`)
  })
})

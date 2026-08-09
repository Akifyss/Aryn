import { Fragment, memo, type AnimationEvent as ReactAnimationEvent } from 'react'
import {
  resolveFileTabShadowSnapshotTransform,
  type FileTabFrameGeometry,
} from './file-tabs-boundary-motion'
import type { FileTabsBoundaryPaths } from './file-tabs-boundary-path'
import {
  getFileTabsShadowFilterPadding,
  type FileTabsShadowLayer,
} from './file-tabs-shadow'

const FILE_TAB_SHADOW_TRANSFORM_EPSILON = 0.0001

type FileTabsShadowGeometry = FileTabFrameGeometry & {
  hasLeftBoundary: boolean
  hasRightBoundary: boolean
}

export type FileTabsShadowSnapshot = FileTabFrameGeometry & {
  hasLeftBoundary: boolean
  hasRightBoundary: boolean
  paths: FileTabsBoundaryPaths
}

export function createFileTabsShadowSnapshot(
  geometry: FileTabsShadowGeometry,
  paths: FileTabsBoundaryPaths,
): FileTabsShadowSnapshot {
  return {
    frameHeight: geometry.frameHeight,
    frameLeft: geometry.frameLeft,
    frameTop: geometry.frameTop,
    frameWidth: geometry.frameWidth,
    hasLeftBoundary: geometry.hasLeftBoundary,
    hasRightBoundary: geometry.hasRightBoundary,
    paths,
  }
}

export function getFileTabsShadowSnapshotCssTransform(
  snapshot: FileTabFrameGeometry,
  geometry: FileTabFrameGeometry,
) {
  const transform = resolveFileTabShadowSnapshotTransform(snapshot, geometry)
  if (!transform) {
    return undefined
  }

  const isIdentityTransform = (
    Math.abs(transform.scaleX - 1) < FILE_TAB_SHADOW_TRANSFORM_EPSILON
    && Math.abs(transform.scaleY - 1) < FILE_TAB_SHADOW_TRANSFORM_EPSILON
    && Math.abs(transform.translateX) < FILE_TAB_SHADOW_TRANSFORM_EPSILON
    && Math.abs(transform.translateY) < FILE_TAB_SHADOW_TRANSFORM_EPSILON
  )
  if (isIdentityTransform) {
    return undefined
  }

  return `translate3d(${transform.translateX}px, ${transform.translateY}px, 0) scale(${transform.scaleX}, ${transform.scaleY})`
}

const FileTabsBoundaryShadowSurface = memo(function FileTabsBoundaryShadowSurface({
  filterId,
  shadowLayers,
  snapshot,
}: {
  filterId: string
  shadowLayers: FileTabsShadowLayer[]
  snapshot: FileTabsShadowSnapshot
}) {
  const variant = snapshot.hasLeftBoundary
    ? snapshot.paths.withLeftBoundary
    : snapshot.paths.withoutLeftBoundary
  const surfacePath = snapshot.hasRightBoundary
    ? variant.surfacePathWithRightBoundary
    : variant.surfacePath
  const filterPadding = getFileTabsShadowFilterPadding(shadowLayers)

  return (
    <>
      <defs>
        <filter
          id={filterId}
          x={-filterPadding.x}
          y={-filterPadding.y}
          width={snapshot.paths.frameWidth + filterPadding.x * 2}
          height={snapshot.paths.frameHeight + filterPadding.y * 2}
          colorInterpolationFilters='sRGB'
          filterUnits='userSpaceOnUse'
        >
          {shadowLayers.map((layer, index) => {
            const resultPrefix = `${filterId}-layer-${index}`
            const spreadResult = `${resultPrefix}-spread`
            const shadowSource = layer.spreadRadius === 0 ? 'SourceAlpha' : spreadResult

            return (
              <Fragment key={`${layer.offsetX}-${layer.offsetY}-${layer.blurRadius}-${layer.spreadRadius}-${layer.color}`}>
                {layer.spreadRadius !== 0 ? (
                  <feMorphology
                    in='SourceAlpha'
                    operator={layer.spreadRadius > 0 ? 'dilate' : 'erode'}
                    radius={Math.abs(layer.spreadRadius)}
                    result={spreadResult}
                  />
                ) : null}
                <feGaussianBlur
                  in={shadowSource}
                  stdDeviation={layer.blurRadius / 2}
                  result={`${resultPrefix}-blur`}
                />
                <feOffset
                  in={`${resultPrefix}-blur`}
                  dx={layer.offsetX}
                  dy={layer.offsetY}
                  result={`${resultPrefix}-offset`}
                />
                <feFlood floodColor={layer.color} result={`${resultPrefix}-color`} />
                <feComposite
                  in={`${resultPrefix}-color`}
                  in2={`${resultPrefix}-offset`}
                  operator='in'
                  result={`${resultPrefix}-shadow`}
                />
                <feComposite
                  in={`${resultPrefix}-shadow`}
                  in2='SourceAlpha'
                  operator='out'
                  result={`${resultPrefix}-outer`}
                />
              </Fragment>
            )
          })}

          <feMerge>
            {shadowLayers.map((_, index) => (
              <feMergeNode key={index} in={`${filterId}-layer-${index}-outer`} />
            ))}
          </feMerge>
        </filter>
      </defs>
      <path
        className='file-tabs-boundary-shadow-source'
        d={surfacePath}
        filter={`url(#${filterId})`}
      />
    </>
  )
})

export function FileTabsBoundaryShadowLayer({
  className,
  filterId,
  onAnimationEnd,
  shadowLayers,
  snapshot,
  transform,
}: {
  className: string
  filterId: string
  onAnimationEnd?: (event: ReactAnimationEvent<SVGSVGElement>) => void
  shadowLayers: FileTabsShadowLayer[]
  snapshot: FileTabsShadowSnapshot
  transform?: string
}) {
  return (
    <svg
      aria-hidden='true'
      className={className}
      focusable='false'
      height={snapshot.paths.frameHeight}
      onAnimationEnd={onAnimationEnd}
      viewBox={`0 0 ${snapshot.paths.frameWidth} ${snapshot.paths.frameHeight}`}
      width={snapshot.paths.frameWidth}
      style={{
        left: snapshot.frameLeft,
        top: snapshot.frameTop,
        transform,
        transformOrigin: '0 0',
      }}
    >
      <FileTabsBoundaryShadowSurface
        filterId={filterId}
        shadowLayers={shadowLayers}
        snapshot={snapshot}
      />
    </svg>
  )
}

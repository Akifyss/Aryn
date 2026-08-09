export const DEFAULT_FILE_TAB_ACTIVATION_DURATION_MS = 180

export type FileTabActiveMotionGeometry = {
  activeHeight: number
  activeLeft: number
  activeTop: number
  activeWidth: number
}

export type FileTabFrameGeometry = {
  frameHeight: number
  frameLeft: number
  frameTop: number
  frameWidth: number
}

export type FileTabShadowSnapshotTransform = {
  scaleX: number
  scaleY: number
  translateX: number
  translateY: number
}

function clampUnitInterval(value: number) {
  return Math.min(1, Math.max(0, value))
}

/** A compact, non-bouncy deceleration curve for routine tab activation. */
export function easeFileTabActivation(progress: number) {
  const clampedProgress = clampUnitInterval(progress)
  return 1 - (1 - clampedProgress) ** 3
}

export function interpolateFileTabActiveGeometry(
  from: FileTabActiveMotionGeometry,
  to: FileTabActiveMotionGeometry,
  progress: number,
): FileTabActiveMotionGeometry {
  const easedProgress = easeFileTabActivation(progress)
  const interpolate = (start: number, end: number) => start + (end - start) * easedProgress

  return {
    activeHeight: interpolate(from.activeHeight, to.activeHeight),
    activeLeft: interpolate(from.activeLeft, to.activeLeft),
    activeTop: interpolate(from.activeTop, to.activeTop),
    activeWidth: interpolate(from.activeWidth, to.activeWidth),
  }
}

/**
 * Maps a frozen shadow surface onto the current editor frame using only
 * compositor-friendly translation and scaling. The SVG path and filter stay
 * unchanged while sidebars animate, avoiding per-frame shadow rasterization.
 */
export function resolveFileTabShadowSnapshotTransform(
  snapshot: FileTabFrameGeometry,
  current: FileTabFrameGeometry,
): FileTabShadowSnapshotTransform | null {
  const values = [
    snapshot.frameHeight,
    snapshot.frameLeft,
    snapshot.frameTop,
    snapshot.frameWidth,
    current.frameHeight,
    current.frameLeft,
    current.frameTop,
    current.frameWidth,
  ]

  if (
    values.some((value) => !Number.isFinite(value))
    || snapshot.frameHeight <= 0
    || snapshot.frameWidth <= 0
    || current.frameHeight <= 0
    || current.frameWidth <= 0
  ) {
    return null
  }

  return {
    scaleX: current.frameWidth / snapshot.frameWidth,
    scaleY: current.frameHeight / snapshot.frameHeight,
    translateX: current.frameLeft - snapshot.frameLeft,
    translateY: current.frameTop - snapshot.frameTop,
  }
}

export function parseCssTimeInMilliseconds(
  value: string,
  fallback = DEFAULT_FILE_TAB_ACTIVATION_DURATION_MS,
) {
  const normalizedValue = value.trim().toLowerCase()
  const parsedValue = Number.parseFloat(normalizedValue)

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallback
  }

  if (normalizedValue.endsWith('ms')) {
    return parsedValue
  }

  if (normalizedValue.endsWith('s')) {
    return parsedValue * 1000
  }

  return fallback
}

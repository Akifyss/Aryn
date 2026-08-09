export const DEFAULT_FILE_TAB_ACTIVATION_DURATION_MS = 180

export type FileTabActiveMotionGeometry = {
  activeHeight: number
  activeLeft: number
  activeTop: number
  activeWidth: number
}

export type FileTabActiveMotionTarget = FileTabActiveMotionGeometry & {
  isLayoutChanging: boolean
  tabId: string
}

export type FileTabAnimationFrame = {
  progress: number
  startedAt: number
}

export type FileTabBoundaryMotionPaths = {
  activeFillPath: string | null
  outlinePath: string
  surfacePath: string
}

export type FileTabBoundaryMotionPathTargets = {
  activeFill: Pick<SVGPathElement, 'setAttribute'> | null
  outline: Pick<SVGPathElement, 'setAttribute'> | null
  shadow: Pick<SVGPathElement, 'setAttribute'> | null
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

/**
 * Starts the animation clock on the first frame the browser can actually
 * render. File activation can keep the renderer busy before that frame; using
 * the state-change time would silently consume most of a short transition.
 */
export function resolveFileTabAnimationFrame(
  timestamp: number,
  startedAt: number | null,
  duration: number,
): FileTabAnimationFrame {
  const resolvedStartedAt = startedAt ?? timestamp
  const elapsed = Math.max(0, timestamp - resolvedStartedAt)

  return {
    progress: duration <= 0 ? 1 : clampUnitInterval(elapsed / duration),
    startedAt: resolvedStartedAt,
  }
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
 * Keeps viewport scrolling attached to the activation already in flight.
 * The target tab remains the same while its frame-relative position changes,
 * so restarting or snapping would break the shared-element movement.
 */
export function canRetargetFileTabActiveMotion(
  currentTarget: FileTabActiveMotionTarget | null,
  nextTarget: FileTabActiveMotionTarget,
) {
  return currentTarget?.tabId === nextTarget.tabId
    && !currentTarget.isLayoutChanging
    && !nextTarget.isLayoutChanging
}

export function resolveFileTabAutoScrollBehavior(prefersReducedMotion: boolean) {
  return prefersReducedMotion ? 'auto' : 'smooth'
}

/**
 * Applies one in-flight boundary frame outside React's state queue. React owns
 * the start and end states; this narrow writer keeps each requestAnimationFrame
 * visible even when editor rendering is concurrently busy.
 */
export function renderFileTabBoundaryMotionFrame(
  targets: FileTabBoundaryMotionPathTargets,
  paths: FileTabBoundaryMotionPaths,
) {
  if (!targets.outline || (paths.activeFillPath && !targets.activeFill)) {
    return false
  }

  targets.outline.setAttribute('d', paths.outlinePath)

  if (targets.activeFill && paths.activeFillPath) {
    targets.activeFill.setAttribute('d', paths.activeFillPath)
  }

  targets.shadow?.setAttribute('d', paths.surfacePath)
  return true
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

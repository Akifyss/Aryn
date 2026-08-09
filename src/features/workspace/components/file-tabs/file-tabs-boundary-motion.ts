export const DEFAULT_FILE_TAB_ACTIVATION_DURATION_MS = 180

export type FileTabActiveMotionGeometry = {
  activeHeight: number
  activeLeft: number
  activeTop: number
  activeWidth: number
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

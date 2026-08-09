export type FileTabsBoundaryShape =
  | {
      kind: 'active'
      activeHeight: number
      activeLeft: number
      activeTop: number
      activeWidth: number
    }
  | {
      kind: 'empty'
      railHeight: number
    }

export type FileTabsBoundaryPathOptions = {
  frameHeight: number
  frameWidth: number
  radius: number
  shape: FileTabsBoundaryShape
}

export type FileTabsBoundaryVariantPaths = {
  activeFillPath: string | null
  outlinePath: string
  outlinePathWithRightBoundary: string
  surfacePath: string
  surfacePathWithRightBoundary: string
}

export type FileTabsBoundaryPaths = {
  boundaryY: number
  frameHeight: number
  frameWidth: number
  withLeftBoundary: FileTabsBoundaryVariantPaths
  withoutLeftBoundary: FileTabsBoundaryVariantPaths
}

const STROKE_CENTER_INSET = 0.5
const QUARTER_CIRCLE_CONTROL_POINT = 0.5522847498
const MIN_CHROME_SIZE = 1

function formatPathValue(value: number) {
  return Number(value.toFixed(3))
}

function curveControlOffset(radius: number) {
  return radius * QUARTER_CIRCLE_CONTROL_POINT
}

type ActiveProfile = {
  commands: string[]
  endX: number
  startX: number
}

function createActiveProfile({
  activeHeight,
  activeLeft,
  activeTop,
  activeWidth,
  leadingShoulderRadius,
  radius,
}: Extract<FileTabsBoundaryShape, { kind: 'active' }> & { leadingShoulderRadius: number; radius: number }): ActiveProfile {
  const top = activeTop + STROKE_CENTER_INSET
  const boundaryY = activeTop + activeHeight - STROKE_CENTER_INSET
  const bodyLeft = activeLeft + STROKE_CENTER_INSET
  const bodyRight = activeLeft + activeWidth - STROKE_CENTER_INSET
  const startX = bodyLeft - leadingShoulderRadius
  const endX = bodyRight + radius
  const leadingControlOffset = curveControlOffset(leadingShoulderRadius)
  const controlOffset = curveControlOffset(radius)
  const commands: string[] = []

  if (leadingShoulderRadius > 0) {
    commands.push(
      `C ${formatPathValue(startX + leadingControlOffset)} ${formatPathValue(boundaryY)}`,
      `${formatPathValue(bodyLeft)} ${formatPathValue(boundaryY - leadingShoulderRadius + leadingControlOffset)}`,
      `${formatPathValue(bodyLeft)} ${formatPathValue(boundaryY - leadingShoulderRadius)}`,
    )
  }

  commands.push(
    `L ${formatPathValue(bodyLeft)} ${formatPathValue(top + radius)}`,
    `C ${formatPathValue(bodyLeft)} ${formatPathValue(top + radius - controlOffset)}`,
    `${formatPathValue(bodyLeft + radius - controlOffset)} ${formatPathValue(top)}`,
    `${formatPathValue(bodyLeft + radius)} ${formatPathValue(top)}`,
    `L ${formatPathValue(bodyRight - radius)} ${formatPathValue(top)}`,
    `C ${formatPathValue(bodyRight - radius + controlOffset)} ${formatPathValue(top)}`,
    `${formatPathValue(bodyRight)} ${formatPathValue(top + radius - controlOffset)}`,
    `${formatPathValue(bodyRight)} ${formatPathValue(top + radius)}`,
    `L ${formatPathValue(bodyRight)} ${formatPathValue(boundaryY - radius)}`,
    `C ${formatPathValue(bodyRight)} ${formatPathValue(boundaryY - radius + controlOffset)}`,
    `${formatPathValue(endX - controlOffset)} ${formatPathValue(boundaryY)}`,
    `${formatPathValue(endX)} ${formatPathValue(boundaryY)}`,
  )

  return { commands, endX, startX }
}

function createBoundaryVariant({
  frameHeight,
  frameWidth,
  hasLeftBoundary,
  radius,
  shape,
}: FileTabsBoundaryPathOptions & { hasLeftBoundary: boolean }): FileTabsBoundaryVariantPaths {
  const boundaryY = shape.kind === 'active'
    ? shape.activeTop + shape.activeHeight - STROKE_CENTER_INSET
    : shape.railHeight - STROKE_CENTER_INSET
  const outerCornerRadius = hasLeftBoundary
    ? shape.kind === 'active'
      ? Math.min(radius, Math.max(0, shape.activeLeft / 2))
      : radius
    : 0
  const leadingShoulderRadius = shape.kind === 'active'
    ? hasLeftBoundary
      ? outerCornerRadius
      : Math.min(radius, Math.max(0, shape.activeLeft))
    : 0
  const profile = shape.kind === 'active'
    ? createActiveProfile({ ...shape, leadingShoulderRadius, radius })
    : null
  const outlineCommands: string[] = []
  let currentBoundaryX = 0

  if (hasLeftBoundary) {
    const outerControlOffset = curveControlOffset(outerCornerRadius)
    currentBoundaryX = STROKE_CENTER_INSET
    outlineCommands.push(
      `M ${STROKE_CENTER_INSET} ${formatPathValue(frameHeight)}`,
      `L ${STROKE_CENTER_INSET} ${formatPathValue(boundaryY + outerCornerRadius)}`,
    )

    if (outerCornerRadius > 0) {
      outlineCommands.push(
        `C ${STROKE_CENTER_INSET} ${formatPathValue(boundaryY + outerCornerRadius - outerControlOffset)}`,
        `${formatPathValue(STROKE_CENTER_INSET + outerCornerRadius - outerControlOffset)} ${formatPathValue(boundaryY)}`,
        `${formatPathValue(STROKE_CENTER_INSET + outerCornerRadius)} ${formatPathValue(boundaryY)}`,
      )
      currentBoundaryX += outerCornerRadius
    }

    if (profile && Math.abs(profile.startX - currentBoundaryX) > 0.001) {
      outlineCommands.push(`L ${formatPathValue(profile.startX)} ${formatPathValue(boundaryY)}`)
    }
  } else if (profile && leadingShoulderRadius > 0) {
    outlineCommands.push(
      `M 0 ${formatPathValue(boundaryY)}`,
      `L ${formatPathValue(profile.startX)} ${formatPathValue(boundaryY)}`,
    )
  } else if (profile) {
    outlineCommands.push(`M ${formatPathValue(profile.startX)} ${formatPathValue(boundaryY)}`)
  } else {
    outlineCommands.push(`M 0 ${formatPathValue(boundaryY)}`)
  }

  if (profile) {
    outlineCommands.push(...profile.commands)
    currentBoundaryX = profile.endX
  }

  const outlinePath = [
    ...outlineCommands,
    `L ${formatPathValue(frameWidth)} ${formatPathValue(boundaryY)}`,
  ].join(' ')
  const rightBoundaryX = frameWidth - STROKE_CENTER_INSET
  const rightCornerRadius = Math.min(
    radius,
    Math.max(0, (rightBoundaryX - currentBoundaryX) / 2),
  )
  const rightCornerStartX = rightBoundaryX - rightCornerRadius
  const rightControlOffset = curveControlOffset(rightCornerRadius)
  const rightBoundaryCommands = [...outlineCommands]

  if (Math.abs(rightCornerStartX - currentBoundaryX) > 0.001) {
    rightBoundaryCommands.push(
      `L ${formatPathValue(rightCornerStartX)} ${formatPathValue(boundaryY)}`,
    )
  }

  if (rightCornerRadius > 0) {
    rightBoundaryCommands.push(
      `C ${formatPathValue(rightCornerStartX + rightControlOffset)} ${formatPathValue(boundaryY)}`,
      `${formatPathValue(rightBoundaryX)} ${formatPathValue(boundaryY + rightCornerRadius - rightControlOffset)}`,
      `${formatPathValue(rightBoundaryX)} ${formatPathValue(boundaryY + rightCornerRadius)}`,
    )
  }

  rightBoundaryCommands.push(
    `L ${formatPathValue(rightBoundaryX)} ${formatPathValue(frameHeight)}`,
  )

  const activeFillPath = profile && shape.kind === 'active'
    ? [
        `M ${formatPathValue(profile.startX)} ${formatPathValue(boundaryY)}`,
        ...profile.commands,
        `L ${formatPathValue(profile.endX)} ${formatPathValue(shape.activeTop + shape.activeHeight)}`,
        `L ${formatPathValue(profile.startX)} ${formatPathValue(shape.activeTop + shape.activeHeight)}`,
        'Z',
      ].join(' ')
    : null
  const surfaceLeftX = hasLeftBoundary ? STROKE_CENTER_INSET : 0
  const surfacePath = [
    outlinePath,
    `L ${formatPathValue(frameWidth)} ${formatPathValue(frameHeight)}`,
    `L ${formatPathValue(surfaceLeftX)} ${formatPathValue(frameHeight)}`,
    'Z',
  ].join(' ')
  const surfacePathWithRightBoundary = [
    rightBoundaryCommands.join(' '),
    `L ${formatPathValue(surfaceLeftX)} ${formatPathValue(frameHeight)}`,
    'Z',
  ].join(' ')

  return {
    activeFillPath,
    outlinePath,
    outlinePathWithRightBoundary: rightBoundaryCommands.join(' '),
    surfacePath,
    surfacePathWithRightBoundary,
  }
}

/**
 * Creates the complete editor frame outline for every tab state. Empty and
 * active rails share the same side dividers, outer corners, and top edge;
 * only the active shape inserts the selected tab silhouette into that path.
 */
export function createFileTabsBoundaryPaths({
  frameHeight,
  frameWidth,
  radius,
  shape,
}: FileTabsBoundaryPathOptions): FileTabsBoundaryPaths | null {
  if (
    frameHeight < MIN_CHROME_SIZE
    || frameWidth < MIN_CHROME_SIZE
    || (shape.kind === 'active' && (
      shape.activeHeight < MIN_CHROME_SIZE
      || shape.activeWidth < MIN_CHROME_SIZE
    ))
    || (shape.kind === 'empty' && shape.railHeight < MIN_CHROME_SIZE)
  ) {
    return null
  }

  const resolvedRadius = Math.max(
    0,
    shape.kind === 'active'
      ? Math.min(radius, (shape.activeWidth - 1) / 2, (shape.activeHeight - 1) / 2)
      : radius,
  )
  const normalizedShape: FileTabsBoundaryShape = shape.kind === 'active'
    ? {
        ...shape,
        activeLeft: Math.max(0, shape.activeLeft),
      }
    : {
        ...shape,
        railHeight: Math.min(frameHeight, shape.railHeight),
      }
  const normalizedOptions: FileTabsBoundaryPathOptions = {
    frameHeight,
    frameWidth,
    radius: resolvedRadius,
    shape: normalizedShape,
  }

  return {
    boundaryY: normalizedShape.kind === 'active'
      ? normalizedShape.activeTop + normalizedShape.activeHeight - STROKE_CENTER_INSET
      : normalizedShape.railHeight - STROKE_CENTER_INSET,
    frameHeight,
    frameWidth,
    withLeftBoundary: createBoundaryVariant({
      ...normalizedOptions,
      hasLeftBoundary: true,
    }),
    withoutLeftBoundary: createBoundaryVariant({
      ...normalizedOptions,
      hasLeftBoundary: false,
    }),
  }
}

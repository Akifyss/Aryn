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
  hasBottomBoundary?: boolean
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

export type FileTabsBoundaryRenderablePathOptions = FileTabsBoundaryPathOptions & {
  hasLeftBoundary: boolean
  hasRightBoundary: boolean
}

export type FileTabsBoundaryRenderablePaths = {
  activeFillPath: string | null
  frameHeight: number
  frameWidth: number
  outlinePath: string
  surfacePath: string
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

type BoundaryVariantBase = {
  activeFillPath: string | null
  boundaryY: number
  currentBoundaryX: number
  hasLeftBoundary: boolean
  outlineCommands: string[]
  surfaceLeftX: number
}

type SelectedBoundaryPaths = {
  outlinePath: string
  surfacePath: string
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

function createBoundaryVariantBase({
  frameHeight,
  hasLeftBoundary,
  radius,
  shape,
}: FileTabsBoundaryPathOptions & { hasLeftBoundary: boolean }): BoundaryVariantBase {
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

  const activeFillPath = profile && shape.kind === 'active'
    ? [
        `M ${formatPathValue(profile.startX)} ${formatPathValue(boundaryY)}`,
        ...profile.commands,
        `L ${formatPathValue(profile.endX)} ${formatPathValue(shape.activeTop + shape.activeHeight)}`,
        `L ${formatPathValue(profile.startX)} ${formatPathValue(shape.activeTop + shape.activeHeight)}`,
        'Z',
      ].join(' ')
    : null

  return {
    activeFillPath,
    boundaryY,
    currentBoundaryX,
    hasLeftBoundary,
    outlineCommands,
    surfaceLeftX: hasLeftBoundary ? STROKE_CENTER_INSET : 0,
  }
}

function createOpenBoundaryPaths(
  base: BoundaryVariantBase,
  frameHeight: number,
  frameWidth: number,
): SelectedBoundaryPaths {
  const outlinePath = [
    ...base.outlineCommands,
    `L ${formatPathValue(frameWidth)} ${formatPathValue(base.boundaryY)}`,
  ].join(' ')

  return {
    outlinePath,
    surfacePath: [
      outlinePath,
      `L ${formatPathValue(frameWidth)} ${formatPathValue(frameHeight)}`,
      `L ${formatPathValue(base.surfaceLeftX)} ${formatPathValue(frameHeight)}`,
      'Z',
    ].join(' '),
  }
}

function createRightBoundaryPaths(
  base: BoundaryVariantBase,
  frameHeight: number,
  frameWidth: number,
  radius: number,
  hasBottomBoundary: boolean,
): SelectedBoundaryPaths {
  const rightBoundaryX = frameWidth - STROKE_CENTER_INSET
  const rightCornerRadius = Math.min(
    radius,
    Math.max(0, (rightBoundaryX - base.currentBoundaryX) / 2),
  )
  const rightCornerStartX = rightBoundaryX - rightCornerRadius
  const rightControlOffset = curveControlOffset(rightCornerRadius)
  const rightBoundaryCommands = [...base.outlineCommands]

  if (Math.abs(rightCornerStartX - base.currentBoundaryX) > 0.001) {
    rightBoundaryCommands.push(
      `L ${formatPathValue(rightCornerStartX)} ${formatPathValue(base.boundaryY)}`,
    )
  }

  if (rightCornerRadius > 0) {
    rightBoundaryCommands.push(
      `C ${formatPathValue(rightCornerStartX + rightControlOffset)} ${formatPathValue(base.boundaryY)}`,
      `${formatPathValue(rightBoundaryX)} ${formatPathValue(base.boundaryY + rightCornerRadius - rightControlOffset)}`,
      `${formatPathValue(rightBoundaryX)} ${formatPathValue(base.boundaryY + rightCornerRadius)}`,
    )
  }

  if (!hasBottomBoundary) {
    rightBoundaryCommands.push(
      `L ${formatPathValue(rightBoundaryX)} ${formatPathValue(frameHeight)}`,
    )

    const outlinePath = rightBoundaryCommands.join(' ')

    return {
      outlinePath,
      surfacePath: [
        outlinePath,
        `L ${formatPathValue(base.surfaceLeftX)} ${formatPathValue(frameHeight)}`,
        'Z',
      ].join(' '),
    }
  }

  const bottomBoundaryY = frameHeight - STROKE_CENTER_INSET
  const bottomCornerRadius = Math.min(
    radius,
    Math.max(0, bottomBoundaryY - (base.boundaryY + rightCornerRadius)),
    Math.max(0, (rightBoundaryX - base.surfaceLeftX) / 2),
  )
  const bottomControlOffset = curveControlOffset(bottomCornerRadius)
  const bottomLeftRadius = base.hasLeftBoundary ? bottomCornerRadius : 0

  if (base.hasLeftBoundary) {
    rightBoundaryCommands[0] = `M ${STROKE_CENTER_INSET} ${formatPathValue(bottomBoundaryY - bottomLeftRadius)}`
  }

  rightBoundaryCommands.push(
    `L ${formatPathValue(rightBoundaryX)} ${formatPathValue(bottomBoundaryY - bottomCornerRadius)}`,
  )

  if (bottomCornerRadius > 0) {
    rightBoundaryCommands.push(
      `C ${formatPathValue(rightBoundaryX)} ${formatPathValue(bottomBoundaryY - bottomCornerRadius + bottomControlOffset)}`,
      `${formatPathValue(rightBoundaryX - bottomCornerRadius + bottomControlOffset)} ${formatPathValue(bottomBoundaryY)}`,
      `${formatPathValue(rightBoundaryX - bottomCornerRadius)} ${formatPathValue(bottomBoundaryY)}`,
    )
  }

  const bottomLeftCornerEndX = base.surfaceLeftX + bottomLeftRadius
  rightBoundaryCommands.push(
    `L ${formatPathValue(bottomLeftCornerEndX)} ${formatPathValue(bottomBoundaryY)}`,
  )

  if (bottomLeftRadius > 0) {
    const bottomLeftControlOffset = curveControlOffset(bottomLeftRadius)
    rightBoundaryCommands.push(
      `C ${formatPathValue(bottomLeftCornerEndX - bottomLeftControlOffset)} ${formatPathValue(bottomBoundaryY)}`,
      `${formatPathValue(base.surfaceLeftX)} ${formatPathValue(bottomBoundaryY - bottomLeftRadius + bottomLeftControlOffset)}`,
      `${formatPathValue(base.surfaceLeftX)} ${formatPathValue(bottomBoundaryY - bottomLeftRadius)}`,
    )
  }

  const outlinePath = rightBoundaryCommands.join(' ')

  return {
    outlinePath,
    surfacePath: `${outlinePath} Z`,
  }
}

function createBoundaryVariant(options: FileTabsBoundaryPathOptions & {
  hasLeftBoundary: boolean
}): FileTabsBoundaryVariantPaths {
  const base = createBoundaryVariantBase(options)
  const openBoundary = createOpenBoundaryPaths(
    base,
    options.frameHeight,
    options.frameWidth,
  )
  const rightBoundary = createRightBoundaryPaths(
    base,
    options.frameHeight,
    options.frameWidth,
    options.radius,
    options.hasBottomBoundary ?? false,
  )

  return {
    activeFillPath: base.activeFillPath,
    outlinePath: openBoundary.outlinePath,
    outlinePathWithRightBoundary: rightBoundary.outlinePath,
    surfacePath: openBoundary.surfacePath,
    surfacePathWithRightBoundary: rightBoundary.surfacePath,
  }
}

function normalizeFileTabsBoundaryPathOptions({
  frameHeight,
  frameWidth,
  hasBottomBoundary = false,
  radius,
  shape,
}: FileTabsBoundaryPathOptions): FileTabsBoundaryPathOptions | null {
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

  return {
    frameHeight,
    frameWidth,
    hasBottomBoundary,
    radius: resolvedRadius,
    shape: normalizedShape,
  }
}

/**
 * Creates only the boundary variant visible in the current layout. Animation
 * frames use this path to avoid building the unused opposite-side variant.
 */
export function createFileTabsBoundaryRenderablePaths({
  hasLeftBoundary,
  hasRightBoundary,
  ...options
}: FileTabsBoundaryRenderablePathOptions): FileTabsBoundaryRenderablePaths | null {
  const normalizedOptions = normalizeFileTabsBoundaryPathOptions(options)
  if (!normalizedOptions) {
    return null
  }

  const base = createBoundaryVariantBase({
    ...normalizedOptions,
    hasLeftBoundary,
  })
  // A visible bottom edge necessarily returns through the right edge. Treat
  // that geometric invariant here so callers cannot request a bottom boundary
  // that is silently dropped by an inconsistent right-edge flag.
  const selectedPaths = hasRightBoundary || normalizedOptions.hasBottomBoundary
    ? createRightBoundaryPaths(
        base,
        normalizedOptions.frameHeight,
        normalizedOptions.frameWidth,
        normalizedOptions.radius,
        normalizedOptions.hasBottomBoundary ?? false,
      )
    : createOpenBoundaryPaths(
        base,
        normalizedOptions.frameHeight,
        normalizedOptions.frameWidth,
      )

  return {
    activeFillPath: base.activeFillPath,
    frameHeight: normalizedOptions.frameHeight,
    frameWidth: normalizedOptions.frameWidth,
    outlinePath: selectedPaths.outlinePath,
    surfacePath: selectedPaths.surfacePath,
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
  hasBottomBoundary = false,
  radius,
  shape,
}: FileTabsBoundaryPathOptions): FileTabsBoundaryPaths | null {
  const normalizedOptions = normalizeFileTabsBoundaryPathOptions({
    frameHeight,
    frameWidth,
    hasBottomBoundary,
    radius,
    shape,
  })
  if (!normalizedOptions) {
    return null
  }

  const normalizedShape = normalizedOptions.shape

  return {
    boundaryY: normalizedShape.kind === 'active'
      ? normalizedShape.activeTop + normalizedShape.activeHeight - STROKE_CENTER_INSET
      : normalizedShape.railHeight - STROKE_CENTER_INSET,
    frameHeight: normalizedOptions.frameHeight,
    frameWidth: normalizedOptions.frameWidth,
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

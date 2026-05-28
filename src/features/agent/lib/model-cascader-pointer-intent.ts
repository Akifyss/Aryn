export function shouldRunAgentModelCascaderDelayedActivation<TPoint, TTarget>(
  latestPoint: TPoint | null,
  target: TTarget,
  isPointerInsideSafeTriangle: (point: TPoint, target: TTarget) => boolean,
) {
  return latestPoint === null || !isPointerInsideSafeTriangle(latestPoint, target)
}

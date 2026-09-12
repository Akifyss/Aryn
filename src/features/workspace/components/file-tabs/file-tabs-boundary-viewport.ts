import type { FileTabsBoundaryShape } from './file-tabs-boundary-path'

// The text viewport can be much narrower than the editor frame (window chrome
// and header actions occupy the rest). Every SVG layer must use the same bounds.
export function getVisibleFileTabsBoundaryShape(
  shape: FileTabsBoundaryShape,
  viewportLeft: number,
  viewportRight: number,
): FileTabsBoundaryShape {
  if (shape.kind === 'empty') return shape
  const left = Math.max(shape.activeLeft, viewportLeft)
  const right = Math.min(shape.activeLeft + shape.activeWidth, viewportRight)
  if (right - left < 1) {
    return { kind: 'empty', railHeight: shape.activeTop + shape.activeHeight }
  }
  return { ...shape, activeLeft: left, activeWidth: right - left }
}

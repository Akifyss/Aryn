export type ProjectMenuMode = 'agent-add' | 'agent-new-switch' | 'editor-switch'
export type ProjectMenuSurface = 'global' | 'left-drawer' | 'right-drawer'
export type ProjectMenuAnchorRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>
export type ProjectMenuFrameRect = Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>

export const PROJECT_MENU_MARGIN_PX = 8
export const PROJECT_MENU_GAP_PX = 8

export function serializeProjectMenuAnchorRect(rect: ProjectMenuAnchorRect): ProjectMenuAnchorRect {
  return {
    bottom: rect.bottom,
    height: rect.height,
    left: rect.left,
    right: rect.right,
    top: rect.top,
    width: rect.width,
  }
}

export function createProjectMenuVirtualAnchor(
  anchorRect: ProjectMenuAnchorRect | null,
  frameRect: ProjectMenuFrameRect | null,
) {
  const fallbackLeft = (frameRect?.left ?? 0) + PROJECT_MENU_MARGIN_PX
  const fallbackTop = (frameRect?.top ?? 0) + PROJECT_MENU_MARGIN_PX
  const rect = anchorRect ?? {
    bottom: fallbackTop,
    height: 0,
    left: fallbackLeft,
    right: fallbackLeft,
    top: fallbackTop,
    width: 0,
  }

  return {
    getBoundingClientRect() {
      return {
        bottom: rect.bottom,
        height: rect.height,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        width: rect.width,
        x: rect.left,
        y: rect.top,
        toJSON() {
          return this
        },
      }
    },
  }
}

export function resolveProjectMenuCollisionBoundary(frameRect: ProjectMenuFrameRect | null) {
  if (!frameRect) {
    return undefined
  }

  return {
    height: frameRect.height,
    width: frameRect.width,
    x: frameRect.left,
    y: frameRect.top,
  }
}

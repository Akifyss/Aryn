import type { CSSProperties } from 'react'

export type ProjectMenuMode = 'agent-add' | 'agent-new-switch' | 'editor-switch'
export type ProjectMenuAnchorRect = Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'>
export type ProjectMenuFrameRect = Pick<DOMRect, 'top' | 'left' | 'width' | 'height'>
export type ProjectMenuViewport = Pick<ProjectMenuFrameRect, 'width' | 'height'>

type ProjectMenuStyle = CSSProperties & {
  '--project-menu-list-max-height'?: string
}

export const PROJECT_MENU_MARGIN_PX = 8
export const PROJECT_MENU_GAP_PX = 8

const PROJECT_MENU_AGENT_ADD_WIDTH_PX = 288
const PROJECT_MENU_EDITOR_SWITCH_WIDTH_PX = 320
const PROJECT_MENU_AGENT_ADD_ESTIMATED_HEIGHT_PX = 96
const PROJECT_MENU_EDITOR_SWITCH_MAX_HEIGHT_PX = 520
const PROJECT_MENU_EDITOR_SWITCH_MIN_HEIGHT_PX = 180
const PROJECT_MENU_EDITOR_SWITCH_SEARCH_HEIGHT_PX = 36
const PROJECT_MENU_EDITOR_SWITCH_ACTIONS_HEIGHT_PX = 72
const PROJECT_MENU_AGENT_PROJECTLESS_ACTION_HEIGHT_PX = 39
const PROJECT_MENU_PROJECT_ROW_HEIGHT_PX = 34
const PROJECT_MENU_PROJECT_LIST_MAX_HEIGHT_PX = 320
const PROJECT_MENU_EDITOR_SWITCH_VERTICAL_CHROME_PX = 24

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

export function resolveProjectMenuStyle(
  mode: ProjectMenuMode,
  includesProjectlessAction: boolean,
  viewport: ProjectMenuViewport,
): ProjectMenuStyle {
  const viewportWidth = viewport.width
  const viewportHeight = viewport.height
  const maxWidth = Math.max(240, viewportWidth - (PROJECT_MENU_MARGIN_PX * 2))
  const width = Math.min(
    mode === 'agent-add' ? PROJECT_MENU_AGENT_ADD_WIDTH_PX : PROJECT_MENU_EDITOR_SWITCH_WIDTH_PX,
    maxWidth,
  )
  const maxHeight = mode === 'agent-add'
    ? PROJECT_MENU_AGENT_ADD_ESTIMATED_HEIGHT_PX
    : PROJECT_MENU_EDITOR_SWITCH_MAX_HEIGHT_PX
  const availableHeight = Math.max(
    PROJECT_MENU_EDITOR_SWITCH_MIN_HEIGHT_PX,
    viewportHeight - (PROJECT_MENU_MARGIN_PX * 2),
  )
  const menuMaxHeight = Math.min(maxHeight, availableHeight)
  const fixedMenuHeight = PROJECT_MENU_EDITOR_SWITCH_SEARCH_HEIGHT_PX
    + PROJECT_MENU_EDITOR_SWITCH_ACTIONS_HEIGHT_PX
    + (includesProjectlessAction ? PROJECT_MENU_AGENT_PROJECTLESS_ACTION_HEIGHT_PX : 0)
    + PROJECT_MENU_EDITOR_SWITCH_VERTICAL_CHROME_PX
  const listMaxHeight = Math.max(
    PROJECT_MENU_PROJECT_ROW_HEIGHT_PX,
    Math.min(PROJECT_MENU_PROJECT_LIST_MAX_HEIGHT_PX, menuMaxHeight - fixedMenuHeight),
  )

  const style: ProjectMenuStyle = {
    width: `${width}px`,
  }

  if (mode !== 'agent-add') {
    style['--project-menu-list-max-height'] = `${listMaxHeight}px`
  }

  return style
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

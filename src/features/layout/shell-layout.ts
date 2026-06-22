export const FULL_LAYOUT_BREAKPOINT = 1360
export const COMPACT_LAYOUT_BREAKPOINT = 1160
export const RIGHT_DRAWER_MAX_WIDTH = 420
export const EDITOR_MAIN_MIN_WIDTH = 480
export const LEFT_SIDEBAR_MIN_WIDTH = 240
export const LEFT_SIDEBAR_MAX_WIDTH = 520
export const EDITOR_RIGHT_SIDEBAR_MIN_WIDTH = 300
export const EDITOR_RIGHT_SIDEBAR_MAX_WIDTH = 560
export const AGENT_CHAT_MIN_WIDTH = 376
export const AGENT_EDITOR_MIN_WIDTH = 520
export const SIDEBAR_RESIZE_HANDLE_WIDTH = 12
export const SIDEBAR_RESIZE_END_EVENT = 'aryn:sidebar-resize-end'

export type LayoutMode = 'full' | 'compact' | 'focus'
export type ShellPlatform = 'macos' | 'windows'
export type AgentLayoutWidths = {
  chatTrackWidth: number
  chatWidth: number
  editorTrackWidth: number
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function clampAgentChatWidth(nextWidth: number, shellWidth: number, leftSidebarWidth: number) {
  const reservedWidth = AGENT_EDITOR_MIN_WIDTH + leftSidebarWidth + SIDEBAR_RESIZE_HANDLE_WIDTH * 2
  const maxWidth = Math.max(AGENT_CHAT_MIN_WIDTH, shellWidth - reservedWidth)

  return clamp(nextWidth, AGENT_CHAT_MIN_WIDTH, maxWidth)
}

export function clampLeftSidebarWidth({
  centerMinWidth,
  nextWidth,
  rightSidebarWidth,
  shellWidth,
}: {
  centerMinWidth: number
  nextWidth: number
  rightSidebarWidth: number
  shellWidth: number
}) {
  const reservedWidth = centerMinWidth
    + SIDEBAR_RESIZE_HANDLE_WIDTH
    + (rightSidebarWidth > 0 ? rightSidebarWidth + SIDEBAR_RESIZE_HANDLE_WIDTH : 0)
  const maxWidth = Math.min(
    LEFT_SIDEBAR_MAX_WIDTH,
    Math.max(LEFT_SIDEBAR_MIN_WIDTH, shellWidth - reservedWidth),
  )

  return clamp(nextWidth, LEFT_SIDEBAR_MIN_WIDTH, maxWidth)
}

export function clampEditorRightSidebarWidth(nextWidth: number, shellWidth: number, leftSidebarWidth: number) {
  const reservedWidth = EDITOR_MAIN_MIN_WIDTH + leftSidebarWidth + SIDEBAR_RESIZE_HANDLE_WIDTH * 2
  const availableWidth = Math.max(EDITOR_RIGHT_SIDEBAR_MIN_WIDTH, shellWidth - reservedWidth)
  const maxWidth = Math.min(EDITOR_RIGHT_SIDEBAR_MAX_WIDTH, availableWidth)

  return clamp(nextWidth, EDITOR_RIGHT_SIDEBAR_MIN_WIDTH, maxWidth)
}

export function getAgentEditorWidth(shellWidth: number, leftSidebarWidth: number, agentChatWidth: number) {
  return Math.max(0, shellWidth - leftSidebarWidth - agentChatWidth)
}

export function resolveAgentLayoutWidths({
  agentChatWidth,
  isEditorVisible,
  leftSidebarWidth,
  shellWidth,
}: {
  agentChatWidth: number
  isEditorVisible: boolean
  leftSidebarWidth: number
  shellWidth: number
}): AgentLayoutWidths {
  const clampedChatWidth = clampAgentChatWidth(agentChatWidth, shellWidth, leftSidebarWidth)

  if (!isEditorVisible) {
    return {
      chatTrackWidth: Math.max(AGENT_CHAT_MIN_WIDTH, shellWidth - leftSidebarWidth),
      chatWidth: clampedChatWidth,
      editorTrackWidth: 0,
    }
  }

  return {
    chatTrackWidth: clampedChatWidth,
    chatWidth: clampedChatWidth,
    editorTrackWidth: getAgentEditorWidth(shellWidth, leftSidebarWidth, clampedChatWidth),
  }
}

const RIGHT_PANEL_TOGGLE_ANCHOR =
  'calc(var(--right-window-controls-width) + var(--right-chrome-edge-gap))'
const RIGHT_PANEL_CONTENT_INSET =
  'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap))'
const RIGHT_WINDOW_CONTROLS_WIDTH =
  'calc(var(--window-control-button-width) * var(--window-control-button-count))'

const SHELL_CHROME_VARS = {
  macos: {
    '--chrome-height': '44px',
    '--panel-toggle-size': '32px',
    '--panel-toggle-gap': '2px',
    '--left-chrome-action-gap': '2px',
    '--left-chrome-content-gap': '2px',
    '--left-chrome-edge-gap': '6px',
    '--right-chrome-edge-gap': '6px',
    '--window-control-button-width': '48px',
    '--window-control-button-count': '0',
    '--right-window-controls-width': RIGHT_WINDOW_CONTROLS_WIDTH,
    '--layout-mode-switch-width': '62px',
    '--left-panel-toggle-anchor': '84px',
    '--right-panel-toggle-anchor': RIGHT_PANEL_TOGGLE_ANCHOR,
    '--left-panel-content-inset': 'calc(var(--left-panel-toggle-anchor) + var(--layout-mode-switch-width) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-content-gap))',
    '--right-panel-content-inset': RIGHT_PANEL_CONTENT_INSET,
    '--sidebar-icon-x': '20px',
  },
  windows: {
    '--chrome-height': '44px',
    '--panel-toggle-size': '32px',
    '--panel-toggle-gap': '2px',
    '--left-chrome-action-gap': '2px',
    '--left-chrome-content-gap': '2px',
    '--left-chrome-edge-gap': '6px',
    '--right-chrome-edge-gap': '6px',
    '--window-control-button-width': '48px',
    '--window-control-button-count': '3',
    '--right-window-controls-width': RIGHT_WINDOW_CONTROLS_WIDTH,
    '--layout-mode-switch-width': '62px',
    '--left-panel-toggle-anchor': '6px',
    '--right-panel-toggle-anchor': RIGHT_PANEL_TOGGLE_ANCHOR,
    '--left-panel-content-inset': 'calc(var(--left-panel-toggle-anchor) + var(--layout-mode-switch-width) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-content-gap))',
    '--right-panel-content-inset': RIGHT_PANEL_CONTENT_INSET,
    '--sidebar-icon-x': '20px',
  },
} as const satisfies Record<ShellPlatform, Record<string, string>>

const MACOS_FULLSCREEN_CHROME_VARS = {
  '--left-panel-toggle-anchor': '6px',
} as const

export function deriveShellPlatform(platform: string): ShellPlatform {
  return platform === 'darwin' ? 'macos' : 'windows'
}

export function deriveLayoutMode(shellWidth: number): LayoutMode {
  if (shellWidth > FULL_LAYOUT_BREAKPOINT) {
    return 'full'
  }

  if (shellWidth > COMPACT_LAYOUT_BREAKPOINT) {
    return 'compact'
  }

  return 'focus'
}

export function getShellChromeVars(
  shellPlatform: ShellPlatform,
  options: { isFullScreen?: boolean } = {},
) {
  if (shellPlatform === 'macos' && options.isFullScreen) {
    return {
      ...SHELL_CHROME_VARS.macos,
      ...MACOS_FULLSCREEN_CHROME_VARS,
    }
  }

  return SHELL_CHROME_VARS[shellPlatform]
}

export function getShellChromeOverlayState({
  isLeftDrawerOpen,
  isModalLayerOpen,
  isRightDrawerOpen,
}: {
  isLeftDrawerOpen: boolean
  isModalLayerOpen: boolean
  isRightDrawerOpen: boolean
}) {
  const isRightDrawerActive = isRightDrawerOpen && !isLeftDrawerOpen

  return {
    leftControlsElevated: !isModalLayerOpen && !isRightDrawerOpen,
    leftControlsTopLayer: !isModalLayerOpen && isLeftDrawerOpen && !isRightDrawerOpen,
    rightControlsElevated: !isModalLayerOpen && !isLeftDrawerOpen,
    rightControlsTopLayer: !isModalLayerOpen && isRightDrawerActive,
  }
}

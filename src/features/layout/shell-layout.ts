export type ShellPlatform = 'macos' | 'windows'

const RIGHT_PANEL_TOGGLE_ANCHOR =
  'calc(var(--right-window-controls-width) + var(--right-chrome-edge-gap))'
const RIGHT_PANEL_CONTROL_INSET =
  'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap))'
const RIGHT_PANEL_CONTENT_INSET =
  'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--right-chrome-content-gap))'
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
    '--right-chrome-content-gap': '6px',
    '--right-chrome-edge-gap': '6px',
    '--window-control-button-width': '48px',
    '--window-control-button-count': '0',
    '--right-window-controls-width': RIGHT_WINDOW_CONTROLS_WIDTH,
    '--left-panel-toggle-anchor': '84px',
    '--right-panel-toggle-anchor': RIGHT_PANEL_TOGGLE_ANCHOR,
    '--right-panel-control-inset': RIGHT_PANEL_CONTROL_INSET,
    '--right-panel-content-inset': RIGHT_PANEL_CONTENT_INSET,
  },
  windows: {
    '--chrome-height': '44px',
    '--panel-toggle-size': '32px',
    '--panel-toggle-gap': '2px',
    '--left-chrome-action-gap': '2px',
    '--left-chrome-content-gap': '2px',
    '--left-chrome-edge-gap': '6px',
    '--right-chrome-content-gap': '6px',
    '--right-chrome-edge-gap': '6px',
    '--window-control-button-width': '48px',
    '--window-control-button-count': '3',
    '--right-window-controls-width': RIGHT_WINDOW_CONTROLS_WIDTH,
    '--left-panel-toggle-anchor': '6px',
    '--right-panel-toggle-anchor': RIGHT_PANEL_TOGGLE_ANCHOR,
    '--right-panel-control-inset': RIGHT_PANEL_CONTROL_INSET,
    '--right-panel-content-inset': RIGHT_PANEL_CONTENT_INSET,
  },
} as const satisfies Record<ShellPlatform, Record<string, string>>

const MACOS_FULLSCREEN_CHROME_VARS = {
  '--left-panel-toggle-anchor': '6px',
} as const

export function deriveShellPlatform(platform: string): ShellPlatform {
  return platform === 'darwin' ? 'macos' : 'windows'
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

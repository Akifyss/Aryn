export const FULL_LAYOUT_BREAKPOINT = 1360
export const COMPACT_LAYOUT_BREAKPOINT = 1160
export const RIGHT_DRAWER_MAX_WIDTH = 420

export type LayoutMode = 'full' | 'compact' | 'focus'
export type ShellPlatform = 'macos' | 'windows'

const SHELL_CHROME_VARS = {
  macos: {
    '--chrome-height': '44px',
    '--panel-toggle-size': '32px',
    '--panel-toggle-gap': '2px',
    '--left-chrome-action-gap': '2px',
    '--left-chrome-content-gap': '2px',
    '--left-chrome-edge-gap': '6px',
    '--layout-mode-switch-width': '62px',
    '--left-panel-toggle-anchor': '84px',
    '--right-panel-toggle-anchor': '6px',
    '--left-panel-content-inset': 'calc(var(--left-panel-toggle-anchor) + var(--layout-mode-switch-width) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-content-gap))',
    '--right-panel-content-inset': '46px',
    '--sidebar-icon-x': '20px',
  },
  windows: {
    '--chrome-height': '44px',
    '--panel-toggle-size': '32px',
    '--panel-toggle-gap': '8px',
    '--left-chrome-action-gap': '2px',
    '--left-chrome-content-gap': '2px',
    '--left-chrome-edge-gap': '6px',
    '--layout-mode-switch-width': '62px',
    '--left-panel-toggle-anchor': '6px',
    '--right-panel-toggle-anchor': '150px',
    '--left-panel-content-inset': 'calc(var(--left-panel-toggle-anchor) + var(--layout-mode-switch-width) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-content-gap))',
    '--right-panel-content-inset': '190px',
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

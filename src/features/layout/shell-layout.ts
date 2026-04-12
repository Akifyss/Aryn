export const FULL_LAYOUT_BREAKPOINT = 1360
export const COMPACT_LAYOUT_BREAKPOINT = 1160

export type LayoutMode = 'full' | 'compact' | 'focus'
export type ShellPlatform = 'macos' | 'windows'

const SHELL_CHROME_VARS = {
  macos: {
    '--chrome-height': '44px',
    '--panel-toggle-size': '32px',
    '--panel-toggle-gap': '8px',
    '--left-panel-toggle-anchor': '76px',
    '--right-panel-toggle-anchor': '12px',
    '--left-panel-content-inset': '116px',
    '--right-panel-content-inset': '52px',
    '--sidebar-icon-x': '20px',
  },
  windows: {
    '--chrome-height': '44px',
    '--panel-toggle-size': '32px',
    '--panel-toggle-gap': '8px',
    '--left-panel-toggle-anchor': '12px',
    '--right-panel-toggle-anchor': '156px',
    '--left-panel-content-inset': '52px',
    '--right-panel-content-inset': '196px',
    '--sidebar-icon-x': '20px',
  },
} as const satisfies Record<ShellPlatform, Record<string, string>>

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

export function getShellChromeVars(shellPlatform: ShellPlatform) {
  return SHELL_CHROME_VARS[shellPlatform]
}

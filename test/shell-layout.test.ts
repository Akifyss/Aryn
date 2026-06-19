import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  COMPACT_LAYOUT_BREAKPOINT,
  deriveLayoutMode,
  deriveShellPlatform,
  FULL_LAYOUT_BREAKPOINT,
  getShellChromeVars,
  getShellChromeOverlayState,
} from '../src/features/layout/shell-layout'

describe('shell layout helpers', () => {
  const leftPanelContentInset =
    'calc(var(--left-panel-toggle-anchor) + var(--layout-mode-switch-width) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-content-gap))'
  const rightPanelToggleAnchor =
    'calc(var(--right-window-controls-width) + var(--right-chrome-edge-gap))'
  const rightPanelContentInset =
    'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap))'
  const rightWindowControlsWidth =
    'calc(var(--window-control-button-width) * var(--window-control-button-count))'

  function px(vars: Record<string, string>, name: string) {
    const value = vars[name]

    if (!value?.endsWith('px')) {
      throw new Error(`Expected ${name} to be a px token, received ${value}`)
    }

    return Number.parseFloat(value)
  }

  function rightPanelToggleAnchorPx(vars: Record<string, string>) {
    return (px(vars, '--window-control-button-width') * Number(vars['--window-control-button-count']))
      + px(vars, '--right-chrome-edge-gap')
  }

  function rightPanelContentInsetPx(vars: Record<string, string>) {
    return rightPanelToggleAnchorPx(vars)
      + px(vars, '--panel-toggle-size')
      + px(vars, '--panel-toggle-gap')
  }

  async function readAppCss() {
    const appCss = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
    return appCss.replace(/\r\n/g, '\n')
  }

  async function readTreeSource() {
    const treeSource = await readFile(new URL('../src/components/tree.tsx', import.meta.url), 'utf8')
    return treeSource.replace(/\r\n/g, '\n')
  }

  it('derives the expected three layout modes from shell width', () => {
    expect(deriveLayoutMode(FULL_LAYOUT_BREAKPOINT + 1)).toBe('full')
    expect(deriveLayoutMode(FULL_LAYOUT_BREAKPOINT)).toBe('compact')
    expect(deriveLayoutMode(COMPACT_LAYOUT_BREAKPOINT + 1)).toBe('compact')
    expect(deriveLayoutMode(COMPACT_LAYOUT_BREAKPOINT)).toBe('focus')
    expect(deriveLayoutMode(960)).toBe('focus')
  })

  it('maps darwin to macos and treats other platforms as windows chrome layout', () => {
    expect(deriveShellPlatform('darwin')).toBe('macos')
    expect(deriveShellPlatform('win32')).toBe('windows')
    expect(deriveShellPlatform('linux')).toBe('windows')
  })

  it('returns stable chrome safe-area variables for each supported platform', () => {
    expect(getShellChromeVars('macos')).toMatchObject({
      '--panel-toggle-size': '32px',
      '--left-chrome-action-gap': '2px',
      '--left-chrome-content-gap': '2px',
      '--left-chrome-edge-gap': '6px',
      '--right-chrome-edge-gap': '6px',
      '--window-control-button-width': '48px',
      '--window-control-button-count': '0',
      '--right-window-controls-width': rightWindowControlsWidth,
      '--panel-toggle-gap': '2px',
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '84px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--left-panel-content-inset': leftPanelContentInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })

    expect(getShellChromeVars('windows')).toMatchObject({
      '--panel-toggle-size': '32px',
      '--left-chrome-action-gap': '2px',
      '--left-chrome-content-gap': '2px',
      '--left-chrome-edge-gap': '6px',
      '--right-chrome-edge-gap': '6px',
      '--window-control-button-width': '48px',
      '--window-control-button-count': '3',
      '--right-window-controls-width': rightWindowControlsWidth,
      '--panel-toggle-gap': '2px',
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '6px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--left-panel-content-inset': leftPanelContentInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })
  })

  it('derives right chrome safe-area widths from button count and edge gaps', () => {
    const macosVars = getShellChromeVars('macos')
    const windowsVars = getShellChromeVars('windows')

    expect(rightPanelToggleAnchorPx(macosVars)).toBe(6)
    expect(rightPanelContentInsetPx(macosVars)).toBe(40)
    expect(rightPanelToggleAnchorPx(windowsVars)).toBe(150)
    expect(rightPanelContentInsetPx(windowsVars)).toBe(184)
  })

  it('scopes file tab action padding to expanded editor sidebars', async () => {
    const appCss = await readAppCss()

    expect(appCss).toContain(`.file-tabs-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0;`)
    expect(appCss).toContain(`.app-shell[data-app-layout='editor'][data-right-collapsed='false'] .file-tabs-actions {
  padding: 0 6px 0 0;
}`)
    expect(appCss).toContain('--right-window-controls-width: calc(var(--window-control-button-width) * var(--window-control-button-count));')
    expect(appCss).toContain('--right-panel-toggle-anchor: calc(var(--right-window-controls-width) + var(--right-chrome-edge-gap));')
    expect(appCss).toContain('--right-panel-content-inset: calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap));')
    expect(appCss).toContain('width: var(--window-control-button-width);')
  })

  it('keeps the compact Git detail pane stretched when every section is collapsed', async () => {
    const appCss = await readAppCss()

    expect(appCss).toContain(`.git-panel-history-shell.is-compact .git-panel-detail-pane {
  flex: 1;
  width: 100%;
}`)
  })

  it('keeps disabled tree action tooltips hoverable', async () => {
    const [appCss, treeSource] = await Promise.all([
      readAppCss(),
      readTreeSource(),
    ])

    expect(treeSource).toContain('tooltip={disabled ? undefined : resolvedTooltip}')
    expect(treeSource).toContain("triggerClassName='tree-item-action-tooltip-trigger'")
    expect(appCss).toContain(`.tree-item-action-tooltip-trigger {
  display: inline-flex;
  flex-shrink: 0;
}`)
  })

  it('keeps docked sidebar expansion motion scoped and disableable', async () => {
    const appCss = await readAppCss()

    expect(appCss).toContain('--sidebar-layout-transition-duration: 180ms;')
    expect(appCss).toContain('--sidebar-layout-transition-easing: cubic-bezier(0.16, 1, 0.3, 1);')
    expect(appCss).toContain('transition: grid-template-columns var(--sidebar-layout-transition-duration) var(--sidebar-layout-transition-easing);')
    expect(appCss).toContain(`.app-shell[data-resizing='true'] {
  transition: none;
}`)
    expect(appCss).toContain(`.app-shell[data-resizing='true'] .titlebar-spacer,
.app-shell[data-resizing='true'] .left-chrome-actions {
  transition: none;
}`)
    expect(appCss).toContain(`.app-shell[data-resizing='true'] .file-tabs-shell {
  transition: none;
}`)
    expect(appCss).toContain(`@media (prefers-reduced-motion: reduce) {

  .app-shell,
  .titlebar-spacer,
  .left-chrome-actions,
  .panel-resize-slot,
  .file-tabs-shell,
  .agent-threadbar {
    transition: none;
  }`)
  })

  it('keeps macOS fullscreen chrome aligned with the screen edge', () => {
    expect(getShellChromeVars('macos', { isFullScreen: true })).toMatchObject({
      '--left-chrome-edge-gap': '6px',
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '6px',
      '--left-panel-content-inset': leftPanelContentInset,
    })
  })

  it('places left chrome controls below the backdrop while the right drawer is open', () => {
    expect(getShellChromeOverlayState({
      isLeftDrawerOpen: false,
      isModalLayerOpen: false,
      isRightDrawerOpen: true,
    })).toEqual({
      leftControlsElevated: false,
      leftControlsTopLayer: false,
      rightControlsElevated: true,
      rightControlsTopLayer: true,
    })
  })

  it('keeps the titlebar switch interactive while the left drawer owns drawer-only controls', () => {
    expect(getShellChromeOverlayState({
      isLeftDrawerOpen: true,
      isModalLayerOpen: false,
      isRightDrawerOpen: false,
    })).toEqual({
      leftControlsElevated: true,
      leftControlsTopLayer: true,
      rightControlsElevated: false,
      rightControlsTopLayer: false,
    })
  })

  it('keeps overlapping drawer flags from elevating stale chrome controls', () => {
    expect(getShellChromeOverlayState({
      isLeftDrawerOpen: true,
      isModalLayerOpen: false,
      isRightDrawerOpen: true,
    })).toEqual({
      leftControlsElevated: false,
      leftControlsTopLayer: false,
      rightControlsElevated: false,
      rightControlsTopLayer: false,
    })
  })

  it('lowers shell chrome controls behind modal layers', () => {
    expect(getShellChromeOverlayState({
      isLeftDrawerOpen: true,
      isModalLayerOpen: true,
      isRightDrawerOpen: true,
    })).toEqual({
      leftControlsElevated: false,
      leftControlsTopLayer: false,
      rightControlsElevated: false,
      rightControlsTopLayer: false,
    })
  })
})

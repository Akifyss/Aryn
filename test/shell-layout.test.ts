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
  const rightPanelContentInset =
    'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap))'

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
      '--left-chrome-action-gap': '2px',
      '--left-chrome-content-gap': '2px',
      '--left-chrome-edge-gap': '6px',
      '--panel-toggle-gap': '2px',
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '84px',
      '--right-panel-toggle-anchor': '6px',
      '--left-panel-content-inset': leftPanelContentInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })

    expect(getShellChromeVars('windows')).toMatchObject({
      '--left-chrome-action-gap': '2px',
      '--left-chrome-content-gap': '2px',
      '--left-chrome-edge-gap': '6px',
      '--panel-toggle-gap': '2px',
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '6px',
      '--right-panel-toggle-anchor': '150px',
      '--left-panel-content-inset': leftPanelContentInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })
  })

  it('scopes file tab action padding to expanded editor sidebars', async () => {
    const appCss = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')

    expect(appCss).toContain(`.file-tabs-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0;`)
    expect(appCss).toContain(`.app-shell[data-app-layout='editor'][data-right-collapsed='false'] .file-tabs-actions {
  padding: 0 6px 0 0;
}`)
    expect(appCss).toContain('--right-panel-content-inset: calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap));')
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

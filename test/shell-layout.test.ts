import { describe, expect, it } from 'vitest'
import {
  COMPACT_LAYOUT_BREAKPOINT,
  deriveLayoutMode,
  deriveShellPlatform,
  FULL_LAYOUT_BREAKPOINT,
  getShellChromeVars,
} from '../src/features/layout/shell-layout'

describe('shell layout helpers', () => {
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
      '--left-panel-toggle-anchor': '76px',
      '--right-panel-toggle-anchor': '12px',
      '--left-panel-content-inset': '116px',
      '--right-panel-content-inset': '52px',
    })

    expect(getShellChromeVars('windows')).toMatchObject({
      '--left-panel-toggle-anchor': '12px',
      '--right-panel-toggle-anchor': '156px',
      '--left-panel-content-inset': '52px',
      '--right-panel-content-inset': '196px',
    })
  })
})

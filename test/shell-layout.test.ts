import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { deriveShellPlatform, getShellChromeVars } from '../src/features/layout/shell-layout'

describe('workspace window chrome', () => {
  const rightPanelToggleAnchor =
    'calc(var(--right-window-controls-width) + var(--right-chrome-edge-gap))'
  const rightPanelControlInset =
    'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap))'
  const rightPanelContentInset =
    'calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--right-chrome-content-gap))'
  const rightWindowControlsWidth =
    'calc(var(--window-control-button-width) * var(--window-control-button-count))'
  function px(vars: Record<string, string>, name: string) {
    const value = vars[name]

    if (!value?.endsWith('px')) {
      throw new Error(`Expected ${name} to be a px token, received ${value}`)
    }

    return Number.parseFloat(value)
  }

  async function readGitPanelCss() {
    const gitPanelCss = await readFile(new URL('../src/features/git/components/git-panel/styles.css', import.meta.url), 'utf8')
    return gitPanelCss.replace(/\r\n/g, '\n')
  }

  async function readAppIconButtonCss() {
    const appIconButtonCss = await readFile(new URL('../src/components/app-icon-button/styles.css', import.meta.url), 'utf8')
    return appIconButtonCss.replace(/\r\n/g, '\n')
  }

  async function readFileTabsCss() {
    const fileTabsCss = await readFile(new URL('../src/features/workspace/components/file-tabs/styles.css', import.meta.url), 'utf8')
    return fileTabsCss.replace(/\r\n/g, '\n')
  }

  async function readFileTabsSource() {
    const fileTabsSource = await readFile(new URL('../src/features/workspace/components/file-tabs/file-tabs.tsx', import.meta.url), 'utf8')
    return fileTabsSource.replace(/\r\n/g, '\n')
  }

  async function readAppItemCss() {
    const appItemCss = await readFile(new URL('../src/components/app-item/styles.css', import.meta.url), 'utf8')
    return appItemCss.replace(/\r\n/g, '\n')
  }

  async function readAppItemSource() {
    const appItemSource = await readFile(new URL('../src/components/app-item/app-item.tsx', import.meta.url), 'utf8')
    return appItemSource.replace(/\r\n/g, '\n')
  }

  function rightPanelControlInsetPx(vars: Record<string, string>) {
    return rightPanelToggleAnchorPx(vars)
      + px(vars, '--panel-toggle-size')
      + px(vars, '--panel-toggle-gap')
  }

  function rightPanelContentInsetPx(vars: Record<string, string>) {
    return rightPanelToggleAnchorPx(vars)
      + px(vars, '--panel-toggle-size')
      + px(vars, '--right-chrome-content-gap')
  }

  function rightPanelToggleAnchorPx(vars: Record<string, string>) {
    return (px(vars, '--window-control-button-width') * Number(vars['--window-control-button-count']))
      + px(vars, '--right-chrome-edge-gap')
  }

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
      '--right-chrome-content-gap': '6px',
      '--right-chrome-edge-gap': '6px',
      '--window-control-button-width': '48px',
      '--window-control-button-count': '0',
      '--right-window-controls-width': rightWindowControlsWidth,
      '--panel-toggle-gap': '2px',
      '--left-panel-toggle-anchor': '84px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--right-panel-control-inset': rightPanelControlInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })

    expect(getShellChromeVars('windows')).toMatchObject({
      '--panel-toggle-size': '32px',
      '--left-chrome-action-gap': '2px',
      '--left-chrome-content-gap': '2px',
      '--left-chrome-edge-gap': '6px',
      '--right-chrome-content-gap': '6px',
      '--right-chrome-edge-gap': '6px',
      '--window-control-button-width': '48px',
      '--window-control-button-count': '3',
      '--right-window-controls-width': rightWindowControlsWidth,
      '--panel-toggle-gap': '2px',
      '--left-panel-toggle-anchor': '6px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--right-panel-control-inset': rightPanelControlInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })
  })

  it('derives right chrome safe-area widths from button count and edge gaps', () => {
    const macosVars = getShellChromeVars('macos')
    const windowsVars = getShellChromeVars('windows')

    expect(rightPanelToggleAnchorPx(macosVars)).toBe(6)
    expect(rightPanelControlInsetPx(macosVars)).toBe(40)
    expect(rightPanelContentInsetPx(macosVars)).toBe(44)
    expect(rightPanelToggleAnchorPx(windowsVars)).toBe(150)
    expect(rightPanelControlInsetPx(windowsVars)).toBe(184)
    expect(rightPanelContentInsetPx(windowsVars)).toBe(188)
  })

  it('delegates file tab overflow edges to Base UI Scroll Area state', async () => {
    const fileTabsSource = await readFileTabsSource()

    expect(fileTabsSource).toContain("import { ScrollArea } from '@base-ui/react/scroll-area'")
    expect(fileTabsSource).toContain('<ScrollArea.Root')
    expect(fileTabsSource).toContain('overflowEdgeThreshold={1}')
    expect(fileTabsSource).toContain('<ScrollArea.Viewport')
    expect(fileTabsSource).toContain("<ScrollArea.Content className='file-tabs-scroll-content'>")
    expect(fileTabsSource).toContain("data-has-actions={hasFileTabActions ? 'true' : 'false'}")
    expect(fileTabsSource).not.toContain('scrollEdgeResizeObserver')
    expect(fileTabsSource).not.toContain('scrollEdgeState')
  })

  it('keeps file tab actions visible for keyboard focus', async () => {
    const [fileTabsCss, appIconButtonCss] = await Promise.all([
      readFileTabsCss(),
      readAppIconButtonCss(),
    ])

    expect(fileTabsCss).toContain(`.file-tab:hover .file-tab-actions,
.file-tab:has(:focus-visible) .file-tab-actions,
.file-tab.is-dirty .file-tab-actions {
  opacity: 1;
  pointer-events: auto;
}`)
    expect(fileTabsCss).toContain(`.file-tab.is-dirty:not(:hover):not(:has(:focus-visible)) .file-tab-close svg {
  opacity: 0;
  pointer-events: none;
}`)
    expect(appIconButtonCss).toContain(`.app-icon-button[data-size]:focus-visible {
  color: var(--foreground-primary);
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}`)
  })

  it('keeps the compact Git detail pane stretched when every section is collapsed', async () => {
    const gitPanelCss = await readGitPanelCss()

    expect(gitPanelCss).toContain(`.git-panel-history-shell.is-compact .git-panel-detail-pane {
  flex: 1;
  width: 100%;
}`)
  })

  it('keeps disabled shared item action tooltips hoverable', async () => {
    const [appItemCss, appItemSource] = await Promise.all([
      readAppItemCss(),
      readAppItemSource(),
    ])

    expect(appItemSource).toContain('tooltip={disabled ? null : resolvedTooltip}')
    expect(appItemSource).toContain("triggerClassName='app-item-action-tooltip-trigger'")
    expect(appItemCss).toContain(`.app-item-action-tooltip-trigger {
  display: inline-flex;
  flex-shrink: 0;
}`)
  })

  it('uses Base UI tabs while keeping drag events on the native tab trigger', async () => {
    const fileTabsSource = await readFileTabsSource()
    const tabTooltipBlock = fileTabsSource.match(/<AppTooltip\s+isOpen=\{labelTooltip\?\.tabId === tab\.id\}[\s\S]*?<\/AppTooltip>/)?.[0]

    expect(fileTabsSource).toContain("import { Tabs } from '@base-ui/react/tabs'")
    expect(fileTabsSource).toContain('<Tabs.Root')
    expect(fileTabsSource).toContain('<Tabs.List')
    expect(fileTabsSource).toContain('activateOnFocus')
    expect(tabTooltipBlock).toBeDefined()
    expect(tabTooltipBlock).toContain("triggerMode='focusable'")
    expect(tabTooltipBlock).toContain('<Tabs.Tab')
    expect(tabTooltipBlock).toContain('value={tab.id}')
    expect(tabTooltipBlock).toContain('draggable={isReorderableTab(tab)}')
    expect(tabTooltipBlock).toContain('onDragStart={(event) => {')
    expect(tabTooltipBlock).not.toContain('<AppTooltipButton')
  })

  it('keeps macOS fullscreen chrome aligned with the screen edge', () => {
    const fullscreenVars = getShellChromeVars('macos', { isFullScreen: true })

    expect(fullscreenVars).toMatchObject({
      '--left-chrome-edge-gap': '6px',
      '--right-chrome-content-gap': '6px',
      '--right-chrome-edge-gap': '6px',
      '--left-panel-toggle-anchor': '6px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--right-panel-control-inset': rightPanelControlInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })
    expect(rightPanelToggleAnchorPx(fullscreenVars)).toBe(6)
    expect(rightPanelControlInsetPx(fullscreenVars)).toBe(40)
    expect(rightPanelContentInsetPx(fullscreenVars)).toBe(44)
  })

  it('marks workspace chrome controls for DevTools focus settlement', async () => {
    const [focus, chrome, shell] = await Promise.all([
      readFile(new URL('../src/hooks/use-devtools-focus-settlement.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/layout/components/app-chrome-controls/app-chrome-controls.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workbench/workspace-shell.tsx', import.meta.url), 'utf8'),
    ])
    expect(focus).toContain("const WINDOW_CHROME_BUTTON_SELECTOR = '[data-window-chrome-button]'")
    expect(chrome).toContain("data-window-chrome-button='true'")
    expect(shell).toContain('<AppChromeSearchButton')
  })
})

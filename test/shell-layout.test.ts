import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  AGENT_CHAT_MIN_WIDTH,
  AGENT_EDITOR_MIN_WIDTH,
  COMPACT_LAYOUT_BREAKPOINT,
  clampAgentChatWidth,
  clampEditorRightSidebarWidth,
  clampLeftSidebarWidth,
  deriveLayoutMode,
  deriveShellPlatform,
  EDITOR_MAIN_MIN_WIDTH,
  EDITOR_RIGHT_SIDEBAR_MAX_WIDTH,
  EDITOR_RIGHT_SIDEBAR_MIN_WIDTH,
  FULL_LAYOUT_BREAKPOINT,
  getAgentEditorWidth,
  getShellChromeVars,
  getShellChromeOverlayState,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  resolveAgentLayoutWidths,
} from '../src/features/layout/shell-layout'

describe('shell layout helpers', () => {
  const leftPanelContentInset =
    'calc(var(--left-panel-toggle-anchor) + var(--layout-mode-switch-width) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-action-gap) + var(--panel-toggle-size) + var(--left-chrome-content-gap))'
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

  function rightPanelToggleAnchorPx(vars: Record<string, string>) {
    return (px(vars, '--window-control-button-width') * Number(vars['--window-control-button-count']))
      + px(vars, '--right-chrome-edge-gap')
  }

  function rightPanelContentInsetPx(vars: Record<string, string>) {
    return rightPanelToggleAnchorPx(vars)
      + px(vars, '--panel-toggle-size')
      + px(vars, '--right-chrome-content-gap')
  }

  function rightPanelControlInsetPx(vars: Record<string, string>) {
    return rightPanelToggleAnchorPx(vars)
      + px(vars, '--panel-toggle-size')
      + px(vars, '--panel-toggle-gap')
  }

  async function readGlobalCss() {
    const globalCss = await readFile(new URL('../src/index.css', import.meta.url), 'utf8')
    return globalCss.replace(/\r\n/g, '\n')
  }

  async function readAppSource() {
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    return appSource.replace(/\r\n/g, '\n')
  }

  async function readAppShellCss() {
    const shellCss = await readFile(
      new URL('../src/features/layout/components/app-shell/styles.css', import.meta.url),
      'utf8',
    )
    return shellCss.replace(/\r\n/g, '\n')
  }

  async function readAppShellSource() {
    const shellSource = await readFile(
      new URL('../src/features/layout/components/app-shell/app-shell.tsx', import.meta.url),
      'utf8',
    )
    return shellSource.replace(/\r\n/g, '\n')
  }

  async function readAgentChatSurfaceCss() {
    const agentChatSurfaceCss = await readFile(
      new URL('../src/features/agent/components/agent-chat-surface/styles.css', import.meta.url),
      'utf8',
    )
    return agentChatSurfaceCss.replace(/\r\n/g, '\n')
  }

  async function readShellLayoutControllerSource() {
    const controllerSource = await readFile(
      new URL('../src/features/layout/hooks/use-shell-layout-controller.ts', import.meta.url),
      'utf8',
    )
    return controllerSource.replace(/\r\n/g, '\n')
  }

  async function readShellDrawerControllerSource() {
    const controllerSource = await readFile(
      new URL('../src/features/layout/hooks/use-shell-drawer-controller.ts', import.meta.url),
      'utf8',
    )
    return controllerSource.replace(/\r\n/g, '\n')
  }

  async function readSidebarLayoutTransitionSource() {
    const transitionSource = await readFile(
      new URL('../src/features/layout/hooks/use-sidebar-layout-transition.ts', import.meta.url),
      'utf8',
    )
    return transitionSource.replace(/\r\n/g, '\n')
  }

  async function readAppTitlebarCss() {
    const titlebarCss = await readFile(new URL('../src/components/app-titlebar/styles.css', import.meta.url), 'utf8')
    return titlebarCss.replace(/\r\n/g, '\n')
  }

  async function readAppItemSource() {
    const appItemSource = await readFile(new URL('../src/components/app-item/app-item.tsx', import.meta.url), 'utf8')
    return appItemSource.replace(/\r\n/g, '\n')
  }

  async function readAppItemCss() {
    const appItemCss = await readFile(new URL('../src/components/app-item/styles.css', import.meta.url), 'utf8')
    return appItemCss.replace(/\r\n/g, '\n')
  }

  async function readFileTabsSource() {
    const fileTabsSource = await readFile(new URL('../src/features/workspace/components/file-tabs/file-tabs.tsx', import.meta.url), 'utf8')
    return fileTabsSource.replace(/\r\n/g, '\n')
  }

  async function readFileTabsBoundaryShadowSource() {
    const shadowSource = await readFile(
      new URL('../src/features/workspace/components/file-tabs/file-tabs-boundary-shadow.tsx', import.meta.url),
      'utf8',
    )
    return shadowSource.replace(/\r\n/g, '\n')
  }

  async function readFileTabsCss() {
    const fileTabsCss = await readFile(new URL('../src/features/workspace/components/file-tabs/styles.css', import.meta.url), 'utf8')
    return fileTabsCss.replace(/\r\n/g, '\n')
  }

  async function readAppIconButtonCss() {
    const appIconButtonCss = await readFile(new URL('../src/components/app-icon-button/styles.css', import.meta.url), 'utf8')
    return appIconButtonCss.replace(/\r\n/g, '\n')
  }

  async function readGitPanelCss() {
    const gitPanelCss = await readFile(new URL('../src/features/git/components/git-panel/styles.css', import.meta.url), 'utf8')
    return gitPanelCss.replace(/\r\n/g, '\n')
  }

  async function readWorkspaceEditorSurfaceCss() {
    const editorSurfaceCss = await readFile(new URL('../src/features/workspace/components/workspace-editor-surface/styles.css', import.meta.url), 'utf8')
    return editorSurfaceCss.replace(/\r\n/g, '\n')
  }

  async function readWorkspaceTabsSource() {
    const workspaceTabsSource = await readFile(new URL('../src/features/workspace/lib/workspace-tabs.ts', import.meta.url), 'utf8')
    return workspaceTabsSource.replace(/\r\n/g, '\n')
  }

  it('derives the expected three layout modes from shell width', () => {
    expect(deriveLayoutMode(FULL_LAYOUT_BREAKPOINT + 1)).toBe('full')
    expect(deriveLayoutMode(FULL_LAYOUT_BREAKPOINT)).toBe('compact')
    expect(deriveLayoutMode(COMPACT_LAYOUT_BREAKPOINT + 1)).toBe('compact')
    expect(deriveLayoutMode(COMPACT_LAYOUT_BREAKPOINT)).toBe('focus')
    expect(deriveLayoutMode(960)).toBe('focus')
  })

  it('keeps the Agent chat resizable while reserving space for the fluid editor', () => {
    expect(AGENT_CHAT_MIN_WIDTH).toBe(376)
    expect(AGENT_EDITOR_MIN_WIDTH).toBe(520)
    expect(clampAgentChatWidth(320, 1440, 320)).toBe(376)
    expect(clampAgentChatWidth(500, 1440, 320)).toBe(500)
    expect(clampAgentChatWidth(960, 1440, 320)).toBe(576)
    expect(getAgentEditorWidth(1440, 320, 576)).toBe(544)
    expect(resolveAgentLayoutWidths({
      agentChatWidth: 500,
      isEditorVisible: true,
      leftSidebarWidth: 320,
      shellWidth: 1440,
    })).toEqual({
      chatTrackWidth: 500,
      chatWidth: 500,
      editorTrackWidth: 620,
    })
    expect(resolveAgentLayoutWidths({
      agentChatWidth: 500,
      isEditorVisible: false,
      leftSidebarWidth: 320,
      shellWidth: 1440,
    })).toEqual({
      chatTrackWidth: 1120,
      chatWidth: 500,
      editorTrackWidth: 0,
    })
  })

  it('clamps shell sidebars with explicit numeric layout constraints', () => {
    expect(EDITOR_MAIN_MIN_WIDTH).toBe(480)
    expect(LEFT_SIDEBAR_MIN_WIDTH).toBe(240)
    expect(LEFT_SIDEBAR_MAX_WIDTH).toBe(520)
    expect(EDITOR_RIGHT_SIDEBAR_MIN_WIDTH).toBe(300)
    expect(EDITOR_RIGHT_SIDEBAR_MAX_WIDTH).toBe(560)

    expect(clampLeftSidebarWidth({
      centerMinWidth: EDITOR_MAIN_MIN_WIDTH,
      nextWidth: 160,
      rightSidebarWidth: 368,
      shellWidth: 1440,
    })).toBe(240)
    expect(clampLeftSidebarWidth({
      centerMinWidth: EDITOR_MAIN_MIN_WIDTH,
      nextWidth: 620,
      rightSidebarWidth: 368,
      shellWidth: 1440,
    })).toBe(520)
    expect(clampLeftSidebarWidth({
      centerMinWidth: 500,
      nextWidth: 420,
      rightSidebarWidth: AGENT_EDITOR_MIN_WIDTH,
      shellWidth: 1320,
    })).toBe(276)
    expect(clampLeftSidebarWidth({
      centerMinWidth: AGENT_CHAT_MIN_WIDTH,
      nextWidth: 520,
      rightSidebarWidth: 0,
      shellWidth: 960,
    })).toBe(520)

    expect(clampEditorRightSidebarWidth(240, 1440, 320)).toBe(300)
    expect(clampEditorRightSidebarWidth(640, 1440, 320)).toBe(560)
    expect(clampEditorRightSidebarWidth(560, 1120, 320)).toBe(300)
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
      '--right-chrome-content-gap': '6px',
      '--right-chrome-edge-gap': '6px',
      '--window-control-button-width': '48px',
      '--window-control-button-count': '0',
      '--right-window-controls-width': rightWindowControlsWidth,
      '--panel-toggle-gap': '2px',
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '84px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--right-panel-control-inset': rightPanelControlInset,
      '--left-panel-content-inset': leftPanelContentInset,
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
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '6px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--right-panel-control-inset': rightPanelControlInset,
      '--left-panel-content-inset': leftPanelContentInset,
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

  it('keeps file tab chrome edges from doubling against adjacent panels', async () => {
    const [appShellCss, fileTabsCss, titlebarCss] = await Promise.all([
      readAppShellCss(),
      readFileTabsCss(),
      readAppTitlebarCss(),
    ])

    expect(fileTabsCss).toContain(`.file-tabs-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 0 0 6px;`)
    expect(fileTabsCss).toContain(`.app-shell[data-app-layout='editor'][data-right-collapsed='false'] .file-tabs-actions {
  padding: 0 6px;
}`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent'] .panel-agent .file-tabs-drag-spacer {
  min-width: var(--panel-toggle-size);
}`)
    expect(fileTabsCss).toContain(`.app-shell[data-app-layout='agent'] .panel-agent .file-tabs-scroll-edge-left,
.app-shell[data-app-layout='editor'][data-left-collapsed='false'] .file-tabs-scroll-edge-left,
.app-shell[data-app-layout='editor'][data-right-collapsed='false'] .file-tabs-shell[data-has-actions='false'] .file-tabs-scroll-edge-right {
  display: none;
}`)
    expect(fileTabsCss).not.toContain(".app-shell[data-app-layout='agent'] .panel-agent .file-tabs-scroll-edge-right")
    expect(fileTabsCss).toContain(`.file-tabs-scroll-frame[data-overflow-x-start] .file-tabs-scroll-edge-left,
.file-tabs-scroll-frame[data-overflow-x-end] .file-tabs-scroll-edge-right {
  opacity: 1;
}`)
    expect(fileTabsCss).toContain(`.file-tabs-scroll-frame[data-has-overflow-x] .file-tabs-scroller {
  clip-path: inset(0 1px 0 0);
}`)
    expect(fileTabsCss).toContain(`.file-tabs-shell {
  --file-tabs-right-panel-inset: var(--right-panel-control-inset);`)
    expect(fileTabsCss).toContain(`.app-shell[data-app-layout='editor']
  .panel-editor
  > .editor-frame
  > .file-tabs-shell {
  --file-tabs-rail-surface: var(--sidebar);
}`)
    expect(fileTabsCss).toContain(`.file-tabs-shell[data-has-actions='false'] {
  --file-tabs-right-panel-inset: var(--right-panel-content-inset);
}`)
    expect(fileTabsCss).toContain(`.app-shell[data-right-collapsed='true'] .file-tabs-shell {
  padding-right: var(--file-tabs-right-panel-inset);
}`)
    expect(fileTabsCss).not.toContain(".app-shell[data-right-collapsed='true'] .file-tabs-shell::after")
    expect(fileTabsCss).not.toContain(".app-shell[data-right-collapsed='true'] .file-tabs-shell[data-has-actions='false']")
    expect(fileTabsCss).not.toContain('.file-tabs-scroll-edge::before')
    expect(fileTabsCss).not.toContain('.file-tabs-scroll-edge::after')
    expect(appShellCss).toContain('--right-window-controls-width: calc(var(--window-control-button-width) * var(--window-control-button-count));')
    expect(appShellCss).toContain('--right-panel-toggle-anchor: calc(var(--right-window-controls-width) + var(--right-chrome-edge-gap));')
    expect(appShellCss).toContain('--right-panel-control-inset: calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap));')
    expect(appShellCss).toContain('--right-panel-content-inset: calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--right-chrome-content-gap));')
    expect(appShellCss).toContain('right: var(--right-panel-control-inset);')
    expect(titlebarCss).toContain('width: var(--window-control-button-width);')
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
.file-tab:focus-within .file-tab-actions,
.file-tab.is-dirty .file-tab-actions {
  opacity: 1;
  pointer-events: auto;
}`)
    expect(fileTabsCss).toContain(`.file-tab.is-dirty:not(:hover):not(:focus-within) .file-tab-close svg {
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

  it('keeps the Agent fixed Git panel clear of the tab bar edge', async () => {
    const editorSurfaceCss = await readWorkspaceEditorSurfaceCss()

    expect(editorSurfaceCss).toContain('--editor-fixed-panel-block-start-gap: var(--editor-toolbar-inline-padding);')
    expect(editorSurfaceCss).toContain(`.app-shell[data-app-layout='agent'] .editor-content-shell > .sidebar-git-pane .git-panel-detail-pane > .git-panel > .git-panel-header,
.app-shell[data-app-layout='agent'] .editor-content-shell > .sidebar-git-pane .git-panel-detail-pane > .git-commit-detail > .git-commit-detail-header {
  margin-block-start: var(--editor-fixed-panel-block-start-gap);
}`)
    expect(editorSurfaceCss).not.toMatch(/\.editor-content-shell\s*>\s*\.sidebar-git-pane\s*\{\s*padding-(?:top|block-start):/)
    expect(editorSurfaceCss).not.toMatch(/\.editor-content-shell\s*>\s*\.sidebar-git-pane\s+\.git-panel-detail-pane\s*\{\s*padding-(?:top|block-start):/)
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
    expect(fileTabsSource).toContain('<Tabs.Indicator')
    expect(fileTabsSource).toContain("className='file-tabs-geometry-indicator'")
    expect(fileTabsSource).toContain('activateOnFocus')
    expect(tabTooltipBlock).toBeDefined()
    expect(tabTooltipBlock).toContain("triggerMode='focusable'")
    expect(tabTooltipBlock).toContain('<Tabs.Tab')
    expect(tabTooltipBlock).toContain('value={tab.id}')
    expect(tabTooltipBlock).toContain('draggable={isReorderableTab(tab)}')
    expect(tabTooltipBlock).toContain('onDragStart={(event) => {')
    expect(tabTooltipBlock).not.toContain('<AppTooltipButton')
    expect(fileTabsSource).not.toContain("event.key === 'ArrowRight'")
  })

  it('keeps the panel boundary and resize guide continuous with the active tab chrome', async () => {
    const [appShellCss, editorSurfaceCss, fileTabsCss, globalCss] = await Promise.all([
      readAppShellCss(),
      readWorkspaceEditorSurfaceCss(),
      readFileTabsCss(),
      readGlobalCss(),
    ])

    expect(globalCss).toContain('--file-tabs-top-gap: 6px;')
    expect(globalCss).toContain('--file-tab-radius: 8px;')
    expect(globalCss).toContain('--file-tab-shadow-handoff-duration: 100ms;')
    expect(globalCss).toContain('--file-tab-shadow-handoff-easing: cubic-bezier(0.16, 1, 0.3, 1);')
    expect(appShellCss).toContain('--tabs-chrome-height: var(--chrome-height);')
    expect(appShellCss).not.toContain('--tabs-chrome-height: calc(var(--chrome-height) - 1px);')
    expect(fileTabsCss).toContain('--file-tabs-rail-surface: var(--background-primary);')
    expect(fileTabsCss).toContain('--file-tab-activation-duration: 180ms;')
    expect(fileTabsCss).not.toContain(
      '--file-tabs-rail-surface: color-mix(in oklch, var(--background-secondary) 42%, var(--background-primary));',
    )
    expect(fileTabsCss).toContain('--file-tab-shoulder-size: var(--file-tab-radius);')
    expect(fileTabsCss).toContain('--file-tab-content-bottom-inset: var(--file-tabs-top-gap);')
    expect(fileTabsCss).not.toContain('var(--chrome-height) - var(--tabs-chrome-height)')
    expect(fileTabsCss).toContain('padding: var(--file-tabs-top-gap) var(--file-tab-shoulder-size) 0 0;')
    expect(fileTabsCss).toContain('padding: 0 24px var(--file-tab-content-bottom-inset) 8px;')
    expect(fileTabsCss).toContain('padding: 0 0 var(--file-tab-content-bottom-inset) 12px;')
    expect(fileTabsCss).toContain('border-radius: var(--file-tab-radius) var(--file-tab-radius) 0 0;')
    expect(fileTabsCss).not.toContain('box-shadow: inset 0 -1px 0 var(--separator);')
    expect(fileTabsCss).toContain(`.file-tab.is-active {
  --file-tab-actions-surface: var(--background-primary);`)
    expect(fileTabsCss).not.toContain('.file-tab:hover:not(.is-active)')
    expect(fileTabsCss).not.toContain('--file-tab-surface')
    expect(fileTabsCss).not.toContain('border-left-width: 0;')
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent'] .panel-agent {
  background: var(--background-primary);
  border-left: 0;
}`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='editor'][data-left-collapsed='false'] .panel-sidebar {
  border-right: 0;
}`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='editor'][data-right-collapsed='false'] .panel-agent {
  border-left: 0;
}`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent'] .panel-resize-slot-right .panel-resize-handle::before,
.app-shell[data-app-layout='editor'] .panel-resize-slot-left .panel-resize-handle::before,
.app-shell[data-app-layout='editor'] .panel-resize-slot-right .panel-resize-handle::before {
  top: calc(var(--tabs-chrome-height) + var(--file-tab-radius) - 1px);
  left: 50%;
  border-radius: 0;
}`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent'] .panel-resize-slot-right .panel-resize-handle::before,
.app-shell[data-app-layout='editor'] .panel-resize-slot-left .panel-resize-handle::before {
  transform: none;
}`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='editor'] .panel-resize-slot-right .panel-resize-handle::before {
  transform: translateX(-100%);
}`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent']:has(.panel-agent > .editor-frame > .file-tabs-shell[data-first-tab-active='true'])
  .panel-resize-slot-right .panel-resize-handle::before,
.app-shell[data-app-layout='editor']:has(.panel-editor > .editor-frame > .file-tabs-shell[data-first-tab-active='true'])
  .panel-resize-slot-left .panel-resize-handle::before {
  top: calc(var(--file-tabs-top-gap) + var(--file-tab-radius));
}`)
    expect(appShellCss).toContain('--panel-resize-guide-opacity: 0;')
    expect(appShellCss).toContain(`.panel-resize-handle:is(:hover, :focus-visible, .is-active) {
  --panel-resize-guide-opacity: 1;
}`)
    expect(appShellCss).not.toContain('.panel-resize-handle::after')
    expect(editorSurfaceCss).not.toContain(".editor-frame:has(> .file-tabs-shell[data-empty='true'])::after")
    expect(editorSurfaceCss).not.toContain('margin-top: -1px;')
    expect(editorSurfaceCss).toContain('padding-left: 1px;')
    expect(editorSurfaceCss).toContain('padding-right: 1px;')
    const editorFrameRule = editorSurfaceCss.match(/\.editor-frame\s*\{[^}]*\}/)?.[0]
    const editorContentShellRule = editorSurfaceCss.match(/\.editor-content-shell\s*\{[^}]*\}/)?.[0]
    expect(editorFrameRule).toBeDefined()
    expect(editorFrameRule).not.toContain('border')
    expect(editorContentShellRule).toBeDefined()
    expect(editorContentShellRule).not.toContain('border')
    expect(fileTabsCss).toMatch(/\.file-tabs-shell\s*\{[^}]*z-index: 3;/s)
    expect(fileTabsCss).toContain('.file-tabs-boundary-chrome {')
    expect(fileTabsCss).toContain('.file-tabs-geometry-indicator {')
    expect(fileTabsCss).toContain(`.file-tabs-boundary-fill-layer {
  z-index: 1;
}`)
    expect(fileTabsCss).toContain(`.file-tabs-boundary-outline-layer {
  z-index: 3;
}`)
    expect(fileTabsCss).toContain('.file-tabs-boundary-shadow-layer {')
    const shadowLayerRule = fileTabsCss.match(/\.file-tabs-boundary-shadow-layer\s*\{[^}]*\}/)?.[0]
    expect(shadowLayerRule).toBeDefined()
    expect(shadowLayerRule).not.toContain('will-change')
    expect(fileTabsCss).toContain('.file-tabs-boundary-shadow-layer.is-layout-snapshot {')
    expect(fileTabsCss).toContain('will-change: transform;')
    expect(fileTabsCss).toContain('.file-tabs-boundary-shadow-layer.is-shadow-handoff-outgoing,')
    expect(fileTabsCss).toContain('will-change: transform, opacity;')
    expect(fileTabsCss).toContain('@keyframes file-tabs-shadow-handoff-out')
    expect(fileTabsCss).toContain('@keyframes file-tabs-shadow-handoff-in')
    expect(fileTabsCss).toContain('box-shadow: var(--shadow-xs);')
    expect(fileTabsCss).not.toContain('--editor-frame-shadow-')
    expect(fileTabsCss).toContain('.file-tabs-boundary-active-fill {')
    expect(fileTabsCss).toContain('.file-tabs-boundary-outline {')
    expect(fileTabsCss).not.toContain('.file-tabs-boundary-variant-with-left')
    expect(fileTabsCss).not.toContain('.file-tabs-boundary-right-variant-with')
    expect(fileTabsCss).not.toContain('.file-tab.is-active::before')
    expect(fileTabsCss).not.toContain('.file-tab.is-active::after')
    expect(fileTabsCss).not.toContain('radial-gradient')
    expect(fileTabsCss).not.toContain('box-shadow: 0 1px 0 var(--file-tab-actions-surface);')
    expect(fileTabsCss).toContain('.file-tab-trigger::before {')
    expect(fileTabsCss).toContain('.file-tab:hover + .file-tab .file-tab-trigger::before {')
    expect(fileTabsCss).not.toContain('.file-tab:hover + .file-tab::before')
    expect(fileTabsCss).toContain('.file-tab.is-dirty:not(:hover):not(:focus-within) .file-tab-actions {')
    expect(fileTabsCss).toContain('.file-tab.is-dirty:focus-within .file-tab-dirty-indicator,')
    expect(fileTabsCss).toMatch(
      /\.file-tab-actions\s*\{[^}]*transparent calc\(100% - 1px\)/s,
    )
    expect(fileTabsCss).not.toContain('.file-tabs-leading-corner')
    expect(fileTabsCss).not.toContain('.panel-resize-handle')
    expect(fileTabsCss).not.toContain(".app-shell[data-left-collapsed='true'] .file-tabs-scroller")

    const [fileTabsSource, fileTabsBoundaryShadowSource] = await Promise.all([
      readFileTabsSource(),
      readFileTabsBoundaryShadowSource(),
    ])
    expect(fileTabsSource).toContain("from './file-tabs-boundary-path'")
    expect(fileTabsSource).toContain('<FileTabsBoundaryChrome')
    expect(fileTabsSource).toContain("kind: 'empty'")
    expect(fileTabsSource).toContain("kind: 'active'")
    expect(fileTabsSource).toContain("className='file-tabs-boundary-chrome file-tabs-boundary-fill-layer'")
    expect(fileTabsSource).toContain("className='file-tabs-boundary-chrome file-tabs-boundary-outline-layer'")
    expect(fileTabsSource).toContain("className='file-tabs-boundary-shadow-layer'")
    expect(fileTabsSource).toContain('parseComputedBoxShadow(window.getComputedStyle(shadowTokenProbe).boxShadow)')
    expect(fileTabsSource).toContain("attributeFilter: ['class', 'data-theme']")
    expect(fileTabsSource).toContain('createPortal(')
    expect(fileTabsSource).toContain('function FileTabsBoundaryChromeController({')
    expect(fileTabsSource).not.toContain('geometry.isLayoutChanging || shadowLayers.length')
    expect(fileTabsSource).toContain("className='file-tabs-boundary-shadow-layer is-layout-snapshot'")
    expect(fileTabsSource).toContain("className='file-tabs-boundary-shadow-layer is-shadow-handoff-outgoing'")
    expect(fileTabsSource).toContain("className='file-tabs-boundary-shadow-layer is-shadow-handoff-incoming'")
    expect(fileTabsBoundaryShadowSource).toContain('const FileTabsBoundaryShadowSurface = memo(')
    expect(fileTabsSource).toContain("event.animationName === 'file-tabs-shadow-handoff-in'")
    expect(fileTabsSource).toContain("appShellElement?.hasAttribute('data-sidebar-transition')")
    expect(fileTabsSource).toContain("appShellElement?.dataset.resizing === 'true'")
    expect(fileTabsSource).toContain("attributeName === 'data-sidebar-transition'")
    expect(fileTabsSource).toContain("attributeName === 'data-resizing'")
    expect(fileTabsSource).toContain('<FileTabsBoundaryChromeController')
    expect(fileTabsSource).toContain('chromeHost={chromeHost}')
    expect(fileTabsSource.lastIndexOf('<FileTabsBoundaryChromeController')).toBeGreaterThan(
      fileTabsSource.lastIndexOf('</Tabs.Root>'),
    )
    expect(fileTabsSource.indexOf('const [boundaryGeometry, setBoundaryGeometry]')).toBeLessThan(
      fileTabsSource.indexOf('export function FileTabs({'),
    )
    expect(fileTabsSource).toContain('new ResizeObserver(scheduleBoundaryGeometrySync)')
    expect(fileTabsSource).toContain('for (const tabElement of Object.values(tabContainerRefs.current))')
    expect(fileTabsSource).toContain('resizeObserver?.observe(tabElement)')
    expect(fileTabsSource).toContain('resizeObserver?.observe(shellElement)')
    expect(fileTabsSource).toContain("scrollerElement.addEventListener('scroll', scheduleBoundaryGeometrySync")
    expect(fileTabsSource).toContain("indicatorStyle.getPropertyValue(property)")
    expect(fileTabsSource).toContain("readNumber('--active-tab-left')")
    expect(fileTabsSource).toContain("window.matchMedia('(prefers-reduced-motion: reduce)').matches")
    expect(fileTabsSource).toContain('interpolateFileTabActiveGeometry(')
    expect(fileTabsSource).toContain('boundaryMotionTargetRef.current = nextGeometry')
    expect(fileTabsSource).toContain('isTabActivating: progress < 1')
    expect(fileTabsSource).toContain('const stableShadowSnapshotRef = useRef<FileTabsShadowSnapshot | null>(null)')
    expect(fileTabsSource).toContain(
      '|| (!geometry.isTabActivating && !geometry.isLayoutChanging)',
    )
    expect(fileTabsSource).toContain('layoutShadowSnapshotRef.current = stableShadowSnapshotRef.current')
    expect(fileTabsSource).toContain('setActiveShadowSlot(getAlternateShadowSlot(activeShadowSlot))')
  })

  it('uses the workspace FileSystem for the Agent fixed file tab', async () => {
    const [
      appShellCss,
      appSource,
      editorSurfaceControllerSource,
      workspacePanelsSource,
      workbenchSource,
      workspaceTabsSource,
    ] = await Promise.all([
      readAppShellCss(),
      readAppSource(),
      readFile(
        new URL(
          '../src/features/workspace/hooks/use-workspace-editor-surface-controller.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/layout/components/app-workspace-shell/app-workspace-panels.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/workspace/components/workspace-workbench/workspace-editor-workbench.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readWorkspaceTabsSource(),
    ])

    expect(appSource).toContain('useWorkspaceEditorSurfaceController({')
    expect(editorSurfaceControllerSource).toContain('useWorkspaceTabViewState({')
    expect(appSource).toContain('createWorkspaceEditorConfiguration({')
    expect(workspacePanelsSource).toContain('<WorkspaceEditorWorkbench')
    expect(workspaceTabsSource).toContain("? [getFixedPanelTab('git'), getFixedPanelTab('file')]")
    expect(workbenchSource).toContain("activeFixedPanelTab?.fixedTabKind === 'file-panel' ? (")
    expect(workbenchSource).toContain('<WorkspaceFileSystemPanel')
    expect(`${appSource}\n${workbenchSource}\n${workspaceTabsSource}`).not.toContain("getFixedPanelTab('file-system')")
    expect(`${appSource}\n${workbenchSource}\n${workspaceTabsSource}`).not.toContain("fixedTabKind === 'file-system-panel'")
    expect(appShellCss).toContain('--agent-collapsed-tab-actions-width: calc((var(--panel-toggle-size) * 2) + var(--panel-toggle-gap));')
  })

  it('hides collapsed fixed-tab actions without reserving their titlebar space', async () => {
    const [appShellCss, appShellSource, appWorkspaceShellSource] = await Promise.all([
      readAppShellCss(),
      readAppShellSource(),
      readFile(
        new URL(
          '../src/features/layout/components/app-workspace-shell/app-workspace-shell.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
    ])

    expect(appWorkspaceShellSource).toContain('const SHOW_COLLAPSED_FIXED_TAB_ACTIONS = false')
    expect(appWorkspaceShellSource).toContain('rightCollapsedActions={SHOW_COLLAPSED_FIXED_TAB_ACTIONS ? (')
    expect(appWorkspaceShellSource).toContain("handleCollapsedFixedTabClick('git')")
    expect(appWorkspaceShellSource).toContain("handleCollapsedFixedTabClick('file')")
    expect(appShellSource).toContain('const shouldRenderRightCollapsedActions = isAgentLayout')
    expect(appShellSource).toContain('&& Boolean(rightCollapsedActions)')
    expect(appShellSource).toContain("data-right-collapsed-actions={shouldRenderRightCollapsedActions ? 'true' : 'false'}")
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent'][data-right-collapsed='true'] .panel-editor .agent-threadbar {
  padding-right: var(--right-panel-content-inset);
}`)
    expect(appShellCss).toContain(`[data-right-collapsed-actions='true'] .panel-editor .agent-threadbar {
  padding-right: calc(var(--right-panel-content-inset) + var(--agent-collapsed-tab-actions-width) + var(--panel-toggle-gap));
}`)
  })

  it('keeps docked sidebar expansion motion scoped and disableable', async () => {
    const [
      globalCss,
      agentChatSurfaceCss,
      appShellCss,
      appShellSource,
      appWorkspaceShellSource,
      appWorkspacePanelsSource,
      appSource,
      fileTabsCss,
      sidebarLayoutTransitionSource,
      shellDrawerControllerSource,
      shellLayoutControllerSource,
    ] = await Promise.all([
      readGlobalCss(),
      readAgentChatSurfaceCss(),
      readAppShellCss(),
      readAppShellSource(),
      readFile(
        new URL(
          '../src/features/layout/components/app-workspace-shell/app-workspace-shell.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/layout/components/app-workspace-shell/app-workspace-panels.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readAppSource(),
      readFileTabsCss(),
      readSidebarLayoutTransitionSource(),
      readShellDrawerControllerSource(),
      readShellLayoutControllerSource(),
    ])
    const layoutSource = [
      shellLayoutControllerSource,
      shellDrawerControllerSource,
      sidebarLayoutTransitionSource,
    ].join('\n')
    const appShellRule = appShellCss.match(/\.app-shell \{([\s\S]*?)\n\}/)?.[1]

    expect(appSource).toContain('<AppWorkspaceShell')
    expect(appSource).toContain('layout={shellLayout}')
    expect(appSource).not.toContain('<AppShell')
    expect(appWorkspaceShellSource).toContain('<AppShell')
    expect(appWorkspaceShellSource).toContain('layout={layout}')
    expect(appWorkspaceShellSource).toContain('renderRightPanel={(surfaceMode) => (')
    expect(appWorkspacePanelsSource).toContain(
      "surfaceMode === 'docked' && configuration.projectBootstrap.isVisible",
    )
    expect(appSource).not.toContain("className='app-shell'")
    expect(appSource).not.toContain('className="app-shell"')
    expect(appShellSource).toContain("className='app-shell'")
    expect(appShellSource).toContain("{renderRightPanel('docked')}")
    expect(appShellSource).toContain("{renderRightPanel('drawer')}")
    expect(appShellSource).toContain('{isRightSidebarDrawer ? (')
    expect(appShellSource).not.toContain('{isRightSidebarDrawer && shouldExposeRightPanelTools ? (')
    expect(globalCss).not.toContain('.app-shell {')
    expect(globalCss).not.toContain('.panel-resize-handle {')
    expect(appShellRule).toBeDefined()
    expect(appShellRule).not.toContain('transition:')
    expect(appShellCss).toContain('--sidebar-layout-transition-duration: 180ms;')
    expect(appShellCss).toContain('--sidebar-layout-transition-easing: cubic-bezier(0.16, 1, 0.3, 1);')
    expect(appShellCss).toContain(`.app-shell[data-sidebar-transition='true'] {
  transition: grid-template-columns var(--sidebar-layout-transition-duration) var(--sidebar-layout-transition-easing);
}`)
    expect(appShellCss).toContain(`.app-shell[data-sidebar-transition='true'][data-resizing='true'] {
  transition: none;
}`)
    expect(appShellCss).toContain(`.panel-sidebar > .workspace-sidebar-surface {
  width: var(--left-sidebar-content-width);
  min-width: var(--left-sidebar-content-width);
}`)
    expect(appShellCss).toContain(`.panel-agent > .agent-shell {
  width: var(--right-sidebar-content-width);
  min-width: var(--right-sidebar-content-width);
}`)
    expect(appShellCss).toContain(`.panel-agent > .editor-frame {
  width: 100%;
  min-width: 0;
}`)
    expect(appShellCss).toContain(`.panel-sidebar > .workspace-sidebar-surface[data-sidebar-transition='true'] {
  contain: layout paint;
}`)
    expect(appShellCss).toContain(`.panel-agent > .agent-shell[data-sidebar-transition='true'],
.panel-agent > .editor-frame[data-sidebar-transition='true'] {
  contain: layout paint;
}`)
    expect(appShellCss).toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  border-color: transparent;
}`)
    expect(appShellCss).not.toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  display: none;
}`)
    expect(appShellCss).not.toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  visibility: hidden;
}`)
    expect(appShellCss).not.toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  opacity: 0;
}`)
    expect(appShellSource).toContain("className={`panel panel-sidebar${isLeftSidebarVisible ? '' : ' is-collapsed'}`}")
    expect(appShellSource).toContain("className={`panel panel-agent${isRightSidebarVisible ? '' : ' is-collapsed'}`}")
    expect(appShellSource).toContain("'--left-sidebar-content-width': `${renderedLeftSidebarWidth}px`")
    expect(appShellSource).toContain("'--agent-chat-track-width': `${effectiveAgentChatTrackWidth}px`")
    expect(appShellSource).toContain("'--agent-editor-track-width': `${effectiveAgentEditorTrackWidth}px`")
    expect(appShellSource).toContain("'--right-sidebar-content-width': `${renderedEditorRightSidebarWidth}px`")
    expect(appShellSource).toContain('inert={isLeftSidebarVisible ? undefined : true}')
    expect(appShellSource).toContain('inert={isRightSidebarVisible ? undefined : true}')
    expect(appShellCss).toContain(`.app-shell[data-resizing='true'] .titlebar-spacer[data-sidebar-transition='true'],
.app-shell[data-resizing='true'] .left-chrome-actions[data-sidebar-transition='true'] {
  transition: none;
}`)
    expect(appShellCss).toContain(`.app-shell[data-resizing='true'] .file-tabs-shell[data-sidebar-transition='true'] {
  transition: none;
}`)
    expect(appShellCss).not.toMatch(/\.app-shell\[data-sidebar-transition='true'\]\s+\./)
    expect(appSource).toContain('useShellLayoutController({')
    expect(appSource).not.toContain('function applySidebarResizePreview(')
    expect(appSource).not.toContain("refreshWindowInteractionRegions('soft')")
    expect(shellLayoutControllerSource).toContain('useShellDrawerController({')
    expect(shellLayoutControllerSource).toContain('useSidebarLayoutTransition(activeResizePanel !== null)')
    expect(shellDrawerControllerSource).toContain("refreshWindowInteractionRegions('soft')")
    expect(shellDrawerControllerSource).toContain("refreshWindowInteractionRegions('hard')")
    expect(layoutSource).toContain('SIDEBAR_LAYOUT_TRANSITION_TARGET_SELECTOR')
    expect(layoutSource).toContain('shell.querySelectorAll<HTMLElement>(SIDEBAR_LAYOUT_TRANSITION_TARGET_SELECTOR)')
    expect(layoutSource).toContain("target.dataset.sidebarTransition = 'true'")
    expect(layoutSource).toContain("target.removeAttribute('data-sidebar-transition')")
    expect(layoutSource).toContain("appShellRef.current?.removeAttribute('data-sidebar-transition')")
    expect(layoutSource).toContain("event.propertyName === 'grid-template-columns'")
    expect(appShellSource).toContain('onTransitionEnd={handleSidebarLayoutTransitionEnd}')
    expect(layoutSource).toContain('return finishSidebarLayoutTransition')
    expect(layoutSource).toContain('if (activeResizePanel) {')
    expect(layoutSource.match(/runSidebarLayoutTransition\(\(\) => \{/g)).toHaveLength(3)
    expect(layoutSource).toContain('if (!isRightSidebarCollapsed) {')
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent'] {
  --agent-chat-min-width: 376px;
  --agent-chat-track-width: 376px;
  --agent-editor-track-width: 520px;`)
    expect(appShellCss).toContain(`.app-shell[data-app-layout='agent'][data-layout='full'] {
  grid-template-columns:
    var(--left-sidebar-width)
    minmax(var(--agent-chat-min-width), var(--agent-chat-track-width))
    minmax(0, var(--agent-editor-track-width));
}`)
    expect(appShellCss).not.toMatch(/\.app-shell\[data-app-layout='agent'\]\[data-right-collapsed='true'\][^{]*\{[^}]*grid-template-columns/)
    expect(layoutSource).toContain('const [agentChatWidth, setAgentChatWidth] = useState(')
    expect(layoutSource).toContain('clampAgentChatWidth,')
    expect(layoutSource).toContain('preview.agentChatWidth = clampAgentChatWidth(')
    expect(layoutSource).not.toContain('agentRightSidebarWidthMode')
    expect(appShellCss).not.toContain(".app-shell[data-resizing='true'] .panel-resize-handle::before")
    expect(layoutSource).toContain('resizeSidebarRef.current(resizePanel, pointerClientX)')
    expect(layoutSource).toContain('animationFrameId = window.requestAnimationFrame(() => {')
    expect(layoutSource).toContain('window.cancelAnimationFrame(animationFrameId)')
    expect(appShellSource).toContain('event.currentTarget.setPointerCapture(event.pointerId)')
    expect(layoutSource).toContain('function applySidebarResizePreview(')
    expect(layoutSource).toContain("shell.style.setProperty('--left-sidebar-width'")
    expect(layoutSource).toContain('agentChatWidth: isRightSidebarVisible ? effectiveAgentChatWidth : agentChatWidth')
    expect(layoutSource).toContain(`if (isRightSidebarVisible) {
        preview.agentChatWidth = nextAgentLayoutWidths.chatWidth
      }`)
    expect(layoutSource).toContain('sidebarResizeSessionRef.current = {')
    expect(layoutSource).toContain('finishSidebarResizeRef.current(resizePanel)')
    expect(layoutSource).toContain(`if (isAgentLayout) {
        if (isRightSidebarVisible) {
          setAgentChatWidth(preview.agentChatWidth)
        }
      } else {
        setEditorRightSidebarWidth(preview.editorRightSidebarWidth)
      }`)
    expect(layoutSource).toContain('function handleResizeKeyDown(panel: ResizePanel')
    expect(appShellSource).toContain('tabIndex={0}')
    expect(appShellSource).toContain("id='workspace-sidebar-panel'")
    expect(appShellSource).toContain("id='assistant-sidebar-panel'")
    expect(appShellSource).toContain('aria-valuemin={leftSidebarResizeBounds.min}')
    expect(appShellSource).toContain("aria-controls='workspace-sidebar-panel'")
    expect(appShellSource).toContain("aria-controls={isAgentLayout ? 'editor-main' : 'assistant-sidebar-panel'}")
    expect(appShellSource).toContain('aria-label={isAgentLayout ? \'Resize Agent chat panel\' : \'Resize assistant sidebar\'}')
    expect(layoutSource).toContain("event.key !== 'ArrowLeft'")
    expect(layoutSource).toContain('notifySidebarResizeEnd()')
    expect(appShellCss).toContain(`.panel-resize-handle {
  --panel-resize-guide-color: var(--separator);
  --panel-resize-guide-opacity: 0;
  --panel-resize-guide-shadow: none;

  position: relative;
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  cursor: col-resize;
  touch-action: none;
  user-select: none;
}`)
    expect(layoutSource).toContain('function scheduleShellWidthSync()')
    expect(layoutSource).toContain(`function scheduleShellWidthSync() {
      finishSidebarLayoutTransition()`)
    expect(layoutSource).toContain('syncFrameId = window.requestAnimationFrame(() => {')
    expect(layoutSource).toContain("window.addEventListener('resize', scheduleShellWidthSync)")
    expect(layoutSource).toContain('window.cancelAnimationFrame(syncFrameId)')
    expect(appShellCss).toContain(`@media (prefers-reduced-motion: reduce) {
  .app-shell,
  .titlebar-spacer,
  .left-chrome-actions,
  .panel-resize-slot {
    transition: none;
  }`)
    expect(agentChatSurfaceCss).toContain(`@media (prefers-reduced-motion: reduce) {
  .agent-threadbar {
    transition: none;
  }`)
    expect(fileTabsCss).toContain(`@media (prefers-reduced-motion: reduce) {
  .file-tabs-shell {
    --file-tab-activation-duration: 0ms;
  }

  .file-tabs-shell,
  .file-tabs-scroll-edge,`)
  })

  it('keeps macOS fullscreen chrome aligned with the screen edge', () => {
    const fullscreenVars = getShellChromeVars('macos', { isFullScreen: true })

    expect(fullscreenVars).toMatchObject({
      '--left-chrome-edge-gap': '6px',
      '--right-chrome-content-gap': '6px',
      '--right-chrome-edge-gap': '6px',
      '--layout-mode-switch-width': '62px',
      '--left-panel-toggle-anchor': '6px',
      '--right-panel-toggle-anchor': rightPanelToggleAnchor,
      '--right-panel-control-inset': rightPanelControlInset,
      '--left-panel-content-inset': leftPanelContentInset,
      '--right-panel-content-inset': rightPanelContentInset,
    })
    expect(rightPanelToggleAnchorPx(fullscreenVars)).toBe(6)
    expect(rightPanelControlInsetPx(fullscreenVars)).toBe(40)
    expect(rightPanelContentInsetPx(fullscreenVars)).toBe(44)
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

  it('uses an explicit behavior marker for DevTools focus settlement', async () => {
    const [focusSource, chromeSource, shellSource, workspaceShellSource, shellCss] = await Promise.all([
      readFile(new URL('../src/hooks/use-devtools-focus-settlement.ts', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../src/features/layout/components/app-chrome-controls/app-chrome-controls.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../src/features/layout/components/app-shell/app-shell.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/layout/components/app-workspace-shell/app-workspace-shell.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readAppShellCss(),
    ])

    expect(focusSource).toContain("const WINDOW_CHROME_BUTTON_SELECTOR = '[data-window-chrome-button]'")
    expect(chromeSource.match(/data-window-chrome-button='true'/g)).toHaveLength(2)
    expect(shellSource).toContain("data-window-chrome-button='true'")
    expect(workspaceShellSource.match(/data-window-chrome-button='true'/g)).toHaveLength(2)
    expect(`${chromeSource}\n${shellSource}\n${workspaceShellSource}`).not.toContain(
      'agent-collapsed-tab-button',
    )
    expect(shellCss).not.toMatch(/\.panel-toggle-button\s*\{/)
  })
})

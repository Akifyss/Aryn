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

  async function readAppCss() {
    const appCss = await readFile(new URL('../src/App.css', import.meta.url), 'utf8')
    return appCss.replace(/\r\n/g, '\n')
  }

  async function readAppSource() {
    const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
    return appSource.replace(/\r\n/g, '\n')
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

  async function readTreeSource() {
    const treeSource = await readFile(new URL('../src/components/tree/tree.tsx', import.meta.url), 'utf8')
    return treeSource.replace(/\r\n/g, '\n')
  }

  async function readTreeCss() {
    const treeCss = await readFile(new URL('../src/components/tree/styles.css', import.meta.url), 'utf8')
    return treeCss.replace(/\r\n/g, '\n')
  }

  async function readFileTabsSource() {
    const fileTabsSource = await readFile(new URL('../src/features/workspace/components/file-tabs/file-tabs.tsx', import.meta.url), 'utf8')
    return fileTabsSource.replace(/\r\n/g, '\n')
  }

  async function readFileTabsCss() {
    const fileTabsCss = await readFile(new URL('../src/features/workspace/components/file-tabs/styles.css', import.meta.url), 'utf8')
    return fileTabsCss.replace(/\r\n/g, '\n')
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
    const [appCss, fileTabsCss, titlebarCss] = await Promise.all([
      readAppCss(),
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
    expect(appCss).toContain(`.app-shell[data-app-layout='agent'] .panel-agent .file-tabs-drag-spacer {
  min-width: var(--panel-toggle-size);
}`)
    expect(fileTabsCss).toContain(`.app-shell[data-app-layout='agent'] .panel-agent .file-tabs-scroll-edge-left,
.app-shell[data-app-layout='editor'][data-left-collapsed='false'] .file-tabs-scroll-edge-left,
.app-shell[data-app-layout='editor'][data-right-collapsed='false'] .file-tabs-shell[data-has-actions='false'] .file-tabs-scroll-edge-right {
  display: none;
}`)
    expect(fileTabsCss).not.toContain(".app-shell[data-app-layout='agent'] .panel-agent .file-tabs-scroll-edge-right")
    expect(fileTabsCss).toContain(`.file-tabs-scroll-frame[data-can-scroll-left='true'] .file-tabs-scroll-edge-left,
.file-tabs-scroll-frame[data-has-scroll-overflow='true'] .file-tabs-scroll-edge-right {
  opacity: 1;
}`)
    expect(fileTabsCss).toContain(`.file-tabs-scroll-frame[data-has-scroll-overflow='true'] .file-tabs-scroller {
  clip-path: inset(0 1px 0 0);
}`)
    expect(fileTabsCss).toContain(`.file-tabs-scroll-frame[data-has-scroll-overflow='true'] .file-tab:last-child {
  border-right-color: transparent;
}`)
    expect(fileTabsCss).toContain(`.file-tabs-shell {
  --file-tabs-right-panel-inset: var(--right-panel-control-inset);`)
    expect(fileTabsCss).toContain(`.file-tabs-shell[data-has-actions='false'] {
  --file-tabs-right-panel-inset: var(--right-panel-content-inset);
}`)
    expect(fileTabsCss).toContain(`.app-shell[data-right-collapsed='true'] .file-tabs-shell {
  padding-right: var(--file-tabs-right-panel-inset);
}`)
    expect(fileTabsCss).toContain(`.app-shell[data-right-collapsed='true'] .file-tabs-shell::after {
  content: "";
  position: absolute;
  right: 0;
  bottom: 0;
  width: var(--file-tabs-right-panel-inset);
  border-bottom: 1px solid var(--separator);
  z-index: 1;
}`)
    expect(fileTabsCss).not.toContain(".app-shell[data-right-collapsed='true'] .file-tabs-shell[data-has-actions='false']")
    expect(fileTabsCss).not.toContain('.file-tabs-scroll-edge::before')
    expect(fileTabsCss).not.toContain('.file-tabs-scroll-edge::after')
    expect(appCss).toContain('--right-window-controls-width: calc(var(--window-control-button-width) * var(--window-control-button-count));')
    expect(appCss).toContain('--right-panel-toggle-anchor: calc(var(--right-window-controls-width) + var(--right-chrome-edge-gap));')
    expect(appCss).toContain('--right-panel-control-inset: calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--panel-toggle-gap));')
    expect(appCss).toContain('--right-panel-content-inset: calc(var(--right-panel-toggle-anchor) + var(--panel-toggle-size) + var(--right-chrome-content-gap));')
    expect(appCss).toContain('right: var(--right-panel-control-inset);')
    expect(titlebarCss).toContain('width: var(--window-control-button-width);')
  })

  it('keeps file tab edge separators independent from scroll-end state', async () => {
    const fileTabsSource = await readFileTabsSource()

    expect(fileTabsSource).toContain('const hasScrollOverflow = maxScrollLeft > FILE_TAB_SCROLL_EDGE_EPSILON')
    expect(fileTabsSource).toContain('hasScrollOverflow,')
    expect(fileTabsSource).toContain("data-has-actions={hasFileTabActions ? 'true' : 'false'}")
    expect(fileTabsSource).toContain("data-has-scroll-overflow={scrollEdgeState.hasScrollOverflow ? 'true' : 'false'}")
    expect(fileTabsSource).not.toContain('canScrollRight')
    expect(fileTabsSource).not.toContain('rightEdgeTabId')
    expect(fileTabsSource).not.toContain('data-scroll-edge-right')
    expect(fileTabsSource).not.toContain('const settleTimeoutId = window.setTimeout')
  })

  it('keeps file tab actions visible for keyboard focus', async () => {
    const fileTabsCss = await readFileTabsCss()

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
    expect(fileTabsCss).toContain(`.file-tab-close:focus-visible,
.file-tabs-toolbar-button:focus-visible {
  color: var(--foreground-primary);
  background: var(--hover);
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

  it('keeps disabled tree action tooltips hoverable', async () => {
    const [treeCss, treeSource] = await Promise.all([
      readTreeCss(),
      readTreeSource(),
    ])

    expect(treeSource).toContain('tooltip={disabled ? undefined : resolvedTooltip}')
    expect(treeSource).toContain("triggerClassName='tree-item-action-tooltip-trigger'")
    expect(treeCss).toContain(`.tree-item-action-tooltip-trigger {
  display: inline-flex;
  flex-shrink: 0;
}`)
  })

  it('keeps file tab drag events on the native tab trigger', async () => {
    const fileTabsSource = await readFileTabsSource()
    const tabTooltipBlock = fileTabsSource.match(/<AppTooltip\s+isOpen=\{labelTooltip\?\.tabId === tab\.id\}[\s\S]*?<\/AppTooltip>/)?.[0]

    expect(tabTooltipBlock).toBeDefined()
    expect(tabTooltipBlock).toContain("triggerMode='focusable'")
    expect(tabTooltipBlock).toContain('<button')
    expect(tabTooltipBlock).toContain('draggable={isReorderableTab(tab)}')
    expect(tabTooltipBlock).toContain('onDragStart={(event) => {')
    expect(tabTooltipBlock).not.toContain('<AppTooltipButton')
  })

  it('uses the workspace FileSystem for the Agent fixed file tab', async () => {
    const [appCss, appSource, workspaceTabsSource] = await Promise.all([
      readAppCss(),
      readAppSource(),
      readWorkspaceTabsSource(),
    ])

    expect(appSource).toContain('useWorkspaceTabViewState({')
    expect(workspaceTabsSource).toContain("? [getFixedPanelTab('git'), getFixedPanelTab('file')]")
    expect(appSource).toContain("activeFixedPanelTab?.fixedTabKind === 'file-panel' ? renderFixedFilePanel() : null")
    expect(appSource).toContain('<WorkspaceFileSystemPanel')
    expect(`${appSource}\n${workspaceTabsSource}`).not.toContain("getFixedPanelTab('file-system')")
    expect(`${appSource}\n${workspaceTabsSource}`).not.toContain("fixedTabKind === 'file-system-panel'")
    expect(appCss).toContain('--agent-collapsed-tab-actions-width: calc((var(--panel-toggle-size) * 2) + var(--panel-toggle-gap));')
  })

  it('keeps docked sidebar expansion motion scoped and disableable', async () => {
    const [
      appCss,
      appSource,
      fileTabsCss,
      sidebarLayoutTransitionSource,
      shellDrawerControllerSource,
      shellLayoutControllerSource,
    ] = await Promise.all([
      readAppCss(),
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
    const appShellRule = appCss.match(/\.app-shell \{([\s\S]*?)\n\}/)?.[1]

    expect(appShellRule).toBeDefined()
    expect(appShellRule).not.toContain('transition:')
    expect(appCss).toContain('--sidebar-layout-transition-duration: 180ms;')
    expect(appCss).toContain('--sidebar-layout-transition-easing: cubic-bezier(0.16, 1, 0.3, 1);')
    expect(appCss).toContain(`.app-shell[data-sidebar-transition='true'] {
  transition: grid-template-columns var(--sidebar-layout-transition-duration) var(--sidebar-layout-transition-easing);
}`)
    expect(appCss).toContain(`.app-shell[data-sidebar-transition='true'][data-resizing='true'] {
  transition: none;
}`)
    expect(appCss).toContain(`.panel-sidebar > .workspace-sidebar-surface {
  width: var(--left-sidebar-content-width);
  min-width: var(--left-sidebar-content-width);
}`)
    expect(appCss).toContain(`.panel-agent > .agent-shell {
  width: var(--right-sidebar-content-width);
  min-width: var(--right-sidebar-content-width);
}`)
    expect(appCss).toContain(`.panel-agent > .editor-frame {
  width: 100%;
  min-width: 0;
}`)
    expect(appCss).toContain(`.panel-sidebar > .workspace-sidebar-surface[data-sidebar-transition='true'] {
  contain: layout paint;
}`)
    expect(appCss).toContain(`.panel-agent > .agent-shell[data-sidebar-transition='true'],
.panel-agent > .editor-frame[data-sidebar-transition='true'] {
  contain: layout paint;
}`)
    expect(appCss).toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  border-color: transparent;
}`)
    expect(appCss).not.toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  display: none;
}`)
    expect(appCss).not.toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  visibility: hidden;
}`)
    expect(appCss).not.toContain(`.panel-sidebar.is-collapsed,
.panel-agent.is-collapsed {
  opacity: 0;
}`)
    expect(appSource).toContain("className={`panel panel-sidebar${isLeftSidebarVisible ? '' : ' is-collapsed'}`}")
    expect(appSource).toContain("className={`panel panel-agent${isRightSidebarVisible ? '' : ' is-collapsed'}`}")
    expect(appSource).toContain("'--left-sidebar-content-width': `${renderedLeftSidebarWidth}px`")
    expect(appSource).toContain("'--agent-chat-track-width': `${effectiveAgentChatTrackWidth}px`")
    expect(appSource).toContain("'--agent-editor-track-width': `${effectiveAgentEditorTrackWidth}px`")
    expect(appSource).toContain("'--right-sidebar-content-width': `${renderedEditorRightSidebarWidth}px`")
    expect(appSource).toContain('inert={isLeftSidebarVisible ? undefined : true}')
    expect(appSource).toContain('inert={isRightSidebarVisible ? undefined : true}')
    expect(appCss).toContain(`.app-shell[data-resizing='true'] .titlebar-spacer[data-sidebar-transition='true'],
.app-shell[data-resizing='true'] .left-chrome-actions[data-sidebar-transition='true'] {
  transition: none;
}`)
    expect(appCss).toContain(`.app-shell[data-resizing='true'] .file-tabs-shell[data-sidebar-transition='true'] {
  transition: none;
}`)
    expect(appCss).not.toMatch(/\.app-shell\[data-sidebar-transition='true'\]\s+\./)
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
    expect(appSource).toContain('onTransitionEnd={handleSidebarLayoutTransitionEnd}')
    expect(layoutSource).toContain('return finishSidebarLayoutTransition')
    expect(layoutSource).toContain('if (activeResizePanel) {')
    expect(layoutSource.match(/runSidebarLayoutTransition\(\(\) => \{/g)).toHaveLength(3)
    expect(layoutSource).toContain('if (!isRightSidebarCollapsed) {')
    expect(appCss).toContain(`.app-shell[data-app-layout='agent'] {
  --agent-chat-min-width: 376px;
  --agent-chat-track-width: 376px;
  --agent-editor-track-width: 520px;`)
    expect(appCss).toContain(`.app-shell[data-app-layout='agent'][data-layout='full'] {
  grid-template-columns:
    var(--left-sidebar-width)
    minmax(var(--agent-chat-min-width), var(--agent-chat-track-width))
    minmax(0, var(--agent-editor-track-width));
}`)
    expect(appCss).not.toMatch(/\.app-shell\[data-app-layout='agent'\]\[data-right-collapsed='true'\][^{]*\{[^}]*grid-template-columns/)
    expect(layoutSource).toContain('const [agentChatWidth, setAgentChatWidth] = useState(')
    expect(layoutSource).toContain('clampAgentChatWidth,')
    expect(layoutSource).toContain('preview.agentChatWidth = clampAgentChatWidth(')
    expect(layoutSource).not.toContain('agentRightSidebarWidthMode')
    expect(appCss).not.toContain(".app-shell[data-resizing='true'] .panel-resize-handle::before")
    expect(layoutSource).toContain('resizeSidebarRef.current(resizePanel, pointerClientX)')
    expect(layoutSource).toContain('animationFrameId = window.requestAnimationFrame(() => {')
    expect(layoutSource).toContain('window.cancelAnimationFrame(animationFrameId)')
    expect(appSource).toContain('event.currentTarget.setPointerCapture(event.pointerId)')
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
    expect(appSource).toContain('tabIndex={0}')
    expect(appSource).toContain("id='workspace-sidebar-panel'")
    expect(appSource).toContain("id='assistant-sidebar-panel'")
    expect(appSource).toContain('aria-valuemin={leftSidebarResizeBounds.min}')
    expect(appSource).toContain("aria-controls='workspace-sidebar-panel'")
    expect(appSource).toContain("aria-controls={isAgentLayout ? 'editor-main' : 'assistant-sidebar-panel'}")
    expect(appSource).toContain('aria-label={isAgentLayout ? \'Resize Agent chat panel\' : \'Resize assistant sidebar\'}')
    expect(layoutSource).toContain("event.key !== 'ArrowLeft'")
    expect(layoutSource).toContain('notifySidebarResizeEnd()')
    expect(appCss).toContain(`.panel-resize-handle {
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
    expect(appCss).toContain(`@media (prefers-reduced-motion: reduce) {

  .app-shell,
  .titlebar-spacer,
  .left-chrome-actions,
  .panel-resize-slot,
  .agent-threadbar {
    transition: none;
  }`)
    expect(fileTabsCss).toContain(`@media (prefers-reduced-motion: reduce) {
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
})

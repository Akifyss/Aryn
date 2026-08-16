import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceSidebar } from '../src/features/workspace/components/workspace-sidebar/workspace-sidebar'
import { WorkspaceSidebarTabs } from '../src/features/workspace/components/workspace-sidebar-tabs/workspace-sidebar-tabs'

const noop = () => {}

describe('WorkspaceSidebar', () => {
  it('renders the docked workspace controls and content without drawer-only UI', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSidebar
        chromeStyle={{ width: 320 }}
        hasWorkspace
        isPickingWorkspace={false}
        platform='windows'
        showWorkspaceSwitch
        surfaceMode='docked'
        workspaceLabel='Aryn'
        onOpenSettings={noop}
        onOpenWorkspaceSwitch={noop}
      >
        <div data-slot='workspace-content'>Workspace content</div>
      </WorkspaceSidebar>,
    )

    expect(markup).toContain('class="workspace-sidebar-surface"')
    expect(markup).toContain('data-platform="windows"')
    expect(markup).toContain(
      'class="app-button app-menu-trigger editor-workspace-switch-button"',
    )
    expect(markup).toContain('data-size="md"')
    expect(markup).toContain('data-variant="outline"')
    expect(markup).toContain('>Aryn</span>')
    expect(markup).toContain('data-slot="workspace-content"')
    expect(markup).toContain('class="sidebar-footer"')
    expect(markup).toContain('class="app-item-row sidebar-footer-settings-item"')
    expect(markup).toContain('class="app-item-icon"')
    expect(markup).toContain('class="app-item-label"')
    expect(markup).toContain('>设置</span>')
    expect(markup).not.toContain('app-item-container')
    expect(markup).not.toContain('style="width:320px"')
    expect(markup).not.toContain('drawer-local-overlay-root')
  })

  it('renders drawer chrome and its local overlay without a workspace switch', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSidebar
        chromeStyle={{ width: 320 }}
        drawerHeaderActions={<button type='button'>Drawer action</button>}
        hasWorkspace={false}
        isPickingWorkspace={false}
        overlay={<div data-slot='drawer-overlay'>Drawer overlay</div>}
        platform='macos'
        showWorkspaceSwitch={false}
        surfaceMode='drawer'
        workspaceLabel='Hidden workspace'
        onOpenSettings={noop}
        onOpenWorkspaceSwitch={noop}
      >
        <div data-slot='drawer-content'>Drawer content</div>
      </WorkspaceSidebar>,
    )

    expect(markup).toContain('class="workspace-sidebar-surface is-drawer"')
    expect(markup).toContain('data-platform="macos"')
    expect(markup).toContain('style="width:320px"')
    expect(markup).toContain('>Drawer action</button>')
    expect(markup).toContain('data-slot="drawer-content"')
    expect(markup).toContain('class="drawer-local-overlay-root"')
    expect(markup).toContain('data-slot="drawer-overlay"')
    expect(markup).not.toContain('Hidden workspace')
    expect(markup).not.toContain('editor-workspace-switch-row')
  })
})

describe('WorkspaceSidebarTabs', () => {
  it('renders the file and Git tabs with their panel slots and optional action', () => {
    const gitMarkup = renderToStaticMarkup(
      <WorkspaceSidebarTabs
        activeTab='git'
        filePanel={<div data-slot='file-panel'>Files</div>}
        gitPanel={<div data-slot='git-panel'>Changes</div>}
        tabListAction={<button type='button'>Panel action</button>}
        onActiveTabChange={noop}
      />,
    )
    const fileMarkup = renderToStaticMarkup(
      <WorkspaceSidebarTabs
        activeTab='file'
        filePanel={<div data-slot='file-panel'>Files</div>}
        gitPanel={<div data-slot='git-panel'>Changes</div>}
        onActiveTabChange={noop}
      />,
    )

    expect(gitMarkup).toContain('class="segmented-tabs-root sidebar-workspace-tabs"')
    expect(gitMarkup.match(/role="tab"/g)).toHaveLength(2)
    expect(gitMarkup).toContain('>文件</span>')
    expect(gitMarkup).toContain('>更改</span>')
    expect(gitMarkup).toContain('>Panel action</button>')
    expect(gitMarkup).toContain('data-slot="git-panel"')
    expect(gitMarkup).not.toContain('data-slot="file-panel"')
    expect(fileMarkup).toContain('data-slot="file-panel"')
    expect(fileMarkup).not.toContain('data-slot="git-panel"')
  })
})

describe('workspace sidebar styles', () => {
  it('keeps component styles local, focus-visible, and reduced-motion aware', async () => {
    const [globalCss, sidebarCss, tabsCss, segmentedTabsCss] = await Promise.all([
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/workspace-sidebar/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/workspace-sidebar-tabs/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/segmented-tabs/styles.css', import.meta.url), 'utf8'),
    ])

    expect(globalCss).not.toContain('.sidebar-workspace-tabs')
    expect(globalCss).not.toContain('.sidebar-footer-item')
    expect(sidebarCss).not.toContain('.sidebar-footer-item')
    expect(sidebarCss).not.toMatch(/(^|\n)\.section-title/)
    const workspaceSwitchRule = sidebarCss.match(
      /\.editor-workspace-switch-button\s*\{[^}]*\}/,
    )?.[0]
    const sidebarFooterRule = sidebarCss.match(
      /\.workspace-sidebar-surface \.sidebar-footer\s*\{[^}]*\}/,
    )?.[0]
    const sidebarFooterSettingsRule = sidebarCss.match(
      /\.workspace-sidebar-surface \.sidebar-footer-settings-item\s*\{[^}]*\}/,
    )?.[0]
    const sidebarFooterLabelRule = sidebarCss.match(
      /\.workspace-sidebar-surface \.sidebar-footer-settings-item \.app-item-label\s*\{[^}]*\}/,
    )?.[0]
    const sidebarFooterInteractiveRule = sidebarCss.match(
      /\.workspace-sidebar-surface \.sidebar-footer-settings-item:hover,[\s\S]*?\{[^}]*\}/,
    )?.[0]
    expect(workspaceSwitchRule).toContain('gap: 8px;')
    expect(workspaceSwitchRule).toContain('padding: 0 8px;')
    expect(workspaceSwitchRule).toContain('text-align: left;')
    expect(workspaceSwitchRule).not.toMatch(
      /\b(?:min-height|border(?:-radius)?|background|box-shadow|font-size|font-weight|opacity|transition)\s*:/,
    )
    expect(sidebarCss).toContain(
      'width: var(--icon-size-md);',
    )
    expect(sidebarCss).toContain(
      'transition: color var(--app-button-base-transition-duration) ease;',
    )
    expect(sidebarFooterRule).toContain(
      'padding: 8px var(--sidebar-content-inline-padding);',
    )
    expect(sidebarFooterRule).toContain('gap: var(--app-item-list-gap);')
    expect(sidebarFooterSettingsRule).toContain(
      '--app-item-current-foreground: var(--foreground-secondary);',
    )
    expect(sidebarFooterLabelRule).toContain('font-weight: 500;')
    expect(sidebarFooterInteractiveRule).toContain(
      '--app-item-current-foreground: var(--foreground-primary);',
    )
    expect(sidebarFooterInteractiveRule).toContain(
      '--app-item-current-icon-foreground: var(--foreground-primary);',
    )
    expect(tabsCss).not.toContain('.segmented-tabs-option')
    expect(segmentedTabsCss).toContain('.segmented-tabs-option:focus-visible')
    expect(sidebarCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(segmentedTabsCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(`${sidebarCss}\n${tabsCss}\n${segmentedTabsCss}`).not.toContain('transition: all')
  })
})

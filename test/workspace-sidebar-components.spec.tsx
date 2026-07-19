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
    expect(markup).toContain('class="section-title-text editor-workspace-switch-button"')
    expect(markup).toContain('>Aryn</span>')
    expect(markup).toContain('data-slot="workspace-content"')
    expect(markup).toContain('class="sidebar-footer-item"')
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

    expect(gitMarkup).toContain('class="sidebar-workspace-tabs"')
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
    const [appCss, sidebarCss, tabsCss] = await Promise.all([
      readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/workspace-sidebar/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/workspace-sidebar-tabs/styles.css', import.meta.url), 'utf8'),
    ])

    expect(appCss).not.toContain('.sidebar-workspace-tabs')
    expect(appCss).not.toContain('.sidebar-footer-item')
    expect(sidebarCss).not.toMatch(/(^|\n)\.section-title/)
    expect(sidebarCss).toContain('.sidebar-footer-item:focus-visible')
    expect(tabsCss).toContain('.sidebar-workspace-tab:focus-visible')
    expect(sidebarCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(tabsCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(`${sidebarCss}\n${tabsCss}`).not.toContain('transition: all')
  })
})

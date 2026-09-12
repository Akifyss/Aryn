import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceSidebarTabs } from '../src/features/workspace/components/workspace-sidebar-tabs/workspace-sidebar-tabs'

const noop = () => {}

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
  it('retains shared keyboard focus and reduced-motion styles', async () => {
    const css = await readFile(new URL('../src/components/ui/segmented-tabs/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.segmented-tabs-option:focus-visible')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).not.toContain('transition: all')
  })
})

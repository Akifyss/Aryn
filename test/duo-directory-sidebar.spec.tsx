import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { WorkspaceSidebarTabs } from '../src/features/workspace/components/workspace-sidebar-tabs/workspace-sidebar-tabs'
import { WorkspaceEditorDirectorySidebar, WorkspaceEditorDirectoryToggle } from '../src/features/workspace/components/workspace-editor-surface/workspace-editor-surface'

describe('Duo directory controls', () => {
  it('adds the conversation segment only when the workbench supplies it', () => {
    const normal = renderToStaticMarkup(<WorkspaceSidebarTabs activeTab='file' filePanel='files' gitPanel='changes' onActiveTabChange={() => {}} />)
    expect(normal).not.toContain('对话')
    const duo = renderToStaticMarkup(<WorkspaceSidebarTabs activeTab='conversation' filePanel='files' gitPanel='changes' conversationPanel={<span>shared conversation tree</span>} onActiveTabChange={() => {}} />)
    expect(duo).toContain('对话')
    expect(duo).toContain('shared conversation tree')
    expect(duo.match(/role="tab"/g)).toHaveLength(3)
  })

  it.each(['left', 'right'] as const)('connects the %s toggle to its own sidebar', (side) => {
    const id = `duo-${side}-directory`
    const markup = renderToStaticMarkup(<>
      <WorkspaceEditorDirectoryToggle side={side} controls={id} isVisible onToggle={() => {}} />
      <WorkspaceEditorDirectorySidebar side={side} id={id}>navigation</WorkspaceEditorDirectorySidebar>
    </>)
    expect(markup).toContain(`aria-controls="${id}"`)
    expect(markup).toContain(`id="${id}"`)
    expect(markup).toContain(`data-side="${side}"`)
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain(side === 'left' ? '隐藏左侧目录侧边栏' : '隐藏右侧目录侧边栏')
  })
})

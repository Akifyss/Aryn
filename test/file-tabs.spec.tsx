import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FileTabs } from '../src/features/workspace/components/file-tabs/file-tabs'
import type { WorkspaceFileTab } from '../src/features/workspace/store/use-workspace-store'

function createFileTab(fileName: string, overrides: Partial<WorkspaceFileTab> = {}): WorkspaceFileTab {
  const filePath = `C:/workspace/${fileName}`

  return {
    content: '',
    editorKind: 'prose',
    exists: true,
    filePath,
    id: `file://${fileName}`,
    isDirty: false,
    kind: 'file',
    savedContent: '',
    viewMode: 'meo',
    ...overrides,
  }
}

describe('FileTabs', () => {
  it('renders controlled Base UI tabs and a shared editor tabpanel relationship', () => {
    const tabs = [
      createFileTab('active.md'),
      createFileTab('draft.ts', { isDirty: true }),
    ]
    const markup = renderToStaticMarkup(
      <FileTabs
        activeTabId={tabs[0].id}
        iconTheme={null}
        tabs={tabs}
        workspacePath='C:/workspace'
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onMoveTab={vi.fn()}
      />,
    )

    expect(markup).toContain('class="file-tabs-shell"')
    expect(markup).toContain('data-first-tab-active="true"')
    expect(markup).toContain('class="file-tabs-scroll-frame"')
    expect(markup).toContain('role="tablist"')
    expect(markup.match(/role="tab"/g)).toHaveLength(2)
    expect(markup).toMatch(/role="tab"[^>]*aria-controls="editor-content-panel"[^>]*aria-selected="true"/)
    expect(markup).toMatch(/role="tab"[^>]*aria-controls="editor-content-panel"[^>]*aria-selected="false"/)
    expect(markup).toContain('class="file-tab is-dirty"')
  })

  it('exposes when an interior tab is active so the tab chrome can own the leading corner', () => {
    const tabs = [
      createFileTab('first.md'),
      createFileTab('active.md'),
    ]
    const markup = renderToStaticMarkup(
      <FileTabs
        activeTabId={tabs[1].id}
        iconTheme={null}
        tabs={tabs}
        workspacePath='C:/workspace'
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onMoveTab={vi.fn()}
      />,
    )

    expect(markup).toContain('data-first-tab-active="false"')
  })

  it('keeps the empty tab rail mounted for the shared editor boundary', () => {
    const markup = renderToStaticMarkup(
      <FileTabs
        activeTabId={null}
        iconTheme={null}
        tabs={[]}
        workspacePath='C:/workspace'
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onMoveTab={vi.fn()}
      />,
    )

    expect(markup).toContain('class="file-tabs-shell"')
    expect(markup).toContain('data-empty="true"')
    expect(markup).toContain('data-first-tab-active="false"')
    expect(markup).toContain('role="tablist"')
    expect(markup).not.toContain('role="tab"')
  })
})

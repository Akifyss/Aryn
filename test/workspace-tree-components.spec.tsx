import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { WorkspaceTreePanel } from '@/features/workspace/components/workspace-tree-panel/workspace-tree-panel'
import type { WorkspaceNode } from '@/features/workspace/types'

describe('Workspace tree virtualization', () => {
  beforeAll(() => {
    vi.stubGlobal('window', {
      appApi: { platform: 'win32' },
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('bounds a large directory to the shared virtual render window', () => {
    const nodes: WorkspaceNode[] = Array.from({ length: 1_000 }, (_, index) => ({
      kind: 'file',
      name: `workspace-file-${index}.md`,
      path: `C:\\workspace\\workspace-file-${index}.md`,
    }))
    const markup = renderToStaticMarkup(
      <WorkspaceTreePanel
        activeFilePath={null}
        expandedPaths={new Set()}
        iconTheme={null}
        isCreatingDirectory={false}
        isCreatingFile={false}
        nodes={nodes}
        setExpandedPaths={vi.fn()}
        title='文件树'
        workspacePath='C:\\workspace'
        onCreateDirectory={vi.fn()}
        onCreateFile={vi.fn()}
        onDeleteNode={vi.fn(async () => undefined)}
        onMoveNode={vi.fn(async () => undefined)}
        onOpenInCodeEditor={vi.fn()}
        onRenameNode={vi.fn(async () => undefined)}
        onSelectFile={vi.fn()}
        onToggleFileTreeExpansion={vi.fn()}
      />,
    )
    const renderedRows = markup.match(/workspace-tree-virtual-item/g) ?? []

    expect(markup).toContain('workspace-file-0.md')
    expect(markup).not.toContain('workspace-file-999.md')
    expect(markup).toContain('aria-setsize="1000"')
    expect(renderedRows.length).toBeGreaterThan(0)
    expect(renderedRows.length).toBeLessThan(40)
  })
})

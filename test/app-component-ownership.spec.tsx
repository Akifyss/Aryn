import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SegmentedIconTabs } from '../src/components/ui/segmented-icon-tabs/segmented-icon-tabs'
import { WorkspaceTreeEmptyState } from '../src/features/workspace/components/workspace-tree/workspace-tree-empty-state'

const noop = () => {}

describe('shared application components', () => {
  it('renders segmented icon tabs with owned structure and disabled state', () => {
    const markup = renderToStaticMarkup(
      <SegmentedIconTabs<'agent' | 'editor'>
        ariaLabel='Layout mode'
        className='app-layout-mode-switch'
        controlClassName='custom-control'
        options={[
          {
            ariaLabel: 'Agent mode',
            icon: <span>Agent</span>,
            tooltip: 'Agent mode',
            value: 'agent',
          },
          {
            ariaLabel: 'Editor mode',
            disabled: true,
            icon: <span>Editor</span>,
            tooltip: 'Editor mode',
            value: 'editor',
          },
        ]}
        value='agent'
        onValueChange={noop}
      />,
    )

    expect(markup).toContain('class="segmented-icon-tabs-root app-layout-mode-switch"')
    expect(markup).toContain('class="segmented-icon-tabs-control custom-control"')
    expect(markup).toContain('class="segmented-icon-tabs-option is-active"')
    expect(markup).toContain('aria-label="Editor mode"')
    expect(markup).toContain('disabled=""')
    expect(markup.match(/role="tab"/g)).toHaveLength(2)
  })

  it('renders workspace tree empty states through one presentation component', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceTreeEmptyState
        icon={<span>Folder</span>}
        message='No files'
      />,
    )

    expect(markup).toContain('class="workspace-tree-empty-state"')
    expect(markup).toContain('class="workspace-tree-empty-icon" aria-hidden="true"')
    expect(markup).toContain('<p>No files</p>')
  })
})

describe('App stylesheet ownership', () => {
  it('keeps component selectors out of App.css and colocates component styles', async () => {
    const [
      appCss,
      commandPaletteSource,
      treeSource,
      previewSource,
      segmentedTabsCss,
    ] = await Promise.all([
      readFile(new URL('../src/App.css', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/features/command-palette/components/command-palette/command-palette.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/workspace/components/workspace-tree/workspace-tree.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/workspace/components/workspace-file-preview/workspace-file-preview.tsx', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../src/components/ui/segmented-icon-tabs/styles.css', import.meta.url), 'utf8'),
    ])

    expect(appCss).not.toContain('.command-palette-dialog')
    expect(appCss).not.toContain('.workspace-tree-root')
    expect(appCss).not.toContain('.image-preview-zoom-surface')
    expect(commandPaletteSource).toContain("import './styles.css'")
    expect(treeSource).toContain("import './styles.css'")
    expect(previewSource).toContain("import './styles.css'")
    expect(segmentedTabsCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

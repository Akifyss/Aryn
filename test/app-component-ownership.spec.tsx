import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SegmentedTabs } from '../src/components/ui/segmented-tabs/segmented-tabs'
import { WorkspaceTreeEmptyState } from '../src/features/workspace/components/workspace-tree/workspace-tree-empty-state'

const noop = () => {}

describe('shared application components', () => {
  it('renders icon, icon-and-label, and label segmented tabs with one owned structure', () => {
    const markup = renderToStaticMarkup(
      <SegmentedTabs<'agent' | 'editor' | 'diff'>
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
            label: 'Files',
            tooltip: 'Editor mode',
            value: 'editor',
          },
          {
            label: 'Diff',
            value: 'diff',
          },
        ]}
        value='agent'
        onValueChange={noop}
      />,
    )

    expect(markup).toContain('class="segmented-tabs-root app-layout-mode-switch"')
    expect(markup).toContain('class="segmented-tabs-control custom-control"')
    expect(markup).toContain('class="segmented-tabs-option is-active"')
    expect(markup).toContain('data-content="icon"')
    expect(markup).toContain('data-content="icon-label"')
    expect(markup).toContain('data-content="label"')
    expect(markup).toContain('class="segmented-tabs-label">Files</span>')
    expect(markup).toContain('class="segmented-tabs-label">Diff</span>')
    expect(markup).toContain('aria-label="Editor mode"')
    expect(markup).toContain('disabled=""')
    expect(markup.match(/role="tab"/g)).toHaveLength(3)
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

describe('application stylesheet ownership', () => {
  it('keeps global tokens and component styles in their owning layers', async () => {
    const [
      appSource,
      globalCss,
      appShellCss,
      commandPaletteSource,
      navigationPanelsSource,
      navigationPanelsCss,
      treeSource,
      treePanelCss,
      previewSource,
      segmentedTabsCss,
    ] = await Promise.all([
      readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/features/layout/components/app-shell/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/command-palette/components/command-palette/command-palette.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/workspace/components/workspace-workbench/workspace-navigation-panels.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/workspace/components/workspace-workbench/workspace-navigation-panels.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/workspace/components/workspace-tree/workspace-tree.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/workspace/components/workspace-tree-panel/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL('../src/features/workspace/components/workspace-file-preview/workspace-file-preview.tsx', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../src/components/ui/segmented-tabs/styles.css', import.meta.url), 'utf8'),
    ])

    expect(appSource).not.toContain("import './App.css'")
    expect(globalCss).toContain('--app-z-panel-resize:')
    expect(globalCss).not.toContain('--app-menu-item-hover-background:')
    expect(globalCss).not.toContain('--app-menu-item-active-background:')
    expect(appShellCss).toContain('.panel-drawer-backdrop.panel-drawer-backdrop')
    expect(appShellCss).not.toContain("[data-slot='backdrop']")
    expect(commandPaletteSource).toContain("import './styles.css'")
    expect(navigationPanelsSource).toContain("import './workspace-navigation-panels.css'")
    expect(navigationPanelsCss).toContain('.sidebar-stack-pane')
    expect(navigationPanelsCss).toContain('.sidebar-git-pane')
    expect(treePanelCss).not.toContain('.sidebar-stack-pane')
    expect(treeSource).toContain("import './styles.css'")
    expect(previewSource).toContain("import './styles.css'")
    expect(segmentedTabsCss).toContain('height: 32px;')
    expect(segmentedTabsCss).toMatch(
      /\.segmented-tabs-option:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus\);/s,
    )
    expect(segmentedTabsCss).not.toMatch(
      /\.segmented-tabs-option:focus-visible[^{}]*\{[^}]*outline:\s*none;/s,
    )
    expect(segmentedTabsCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

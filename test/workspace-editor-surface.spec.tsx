import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WorkspaceEditorDirectorySidebar,
  WorkspaceEditorDirectoryToggle,
  WorkspaceEditorDirectoryToggleSlot,
  WorkspaceEditorEmptyState,
  WorkspaceEditorSurface,
  WorkspaceEditorView,
} from '../src/features/workspace/components/workspace-editor-surface/workspace-editor-surface'

const noop = () => {}

describe('WorkspaceEditorSurface', () => {
  it('renders tabs, editor content, directory controls, and view toolbar in stable slots', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceEditorSurface tabs={<div data-slot='tabs'>Tabs</div>}>
        <WorkspaceEditorDirectorySidebar>
          <div data-slot='directory'>Directory</div>
        </WorkspaceEditorDirectorySidebar>
        <WorkspaceEditorDirectoryToggleSlot>
          <WorkspaceEditorDirectoryToggle isVisible onToggle={noop} />
        </WorkspaceEditorDirectoryToggleSlot>
        <WorkspaceEditorView leadingToolbarAction={<button type='button'>Toggle</button>}>
          <div data-slot='editor'>Editor</div>
        </WorkspaceEditorView>
      </WorkspaceEditorSurface>,
    )

    expect(markup).toContain('class="editor-frame"')
    expect(markup).toContain('data-slot="tabs"')
    expect(markup).toContain('id="editor-content-panel"')
    expect(markup).toContain('class="editor-directory-sidebar"')
    expect(markup).toContain('class="editor-directory-toggle-slot"')
    expect(markup).toContain('class="app-icon-button editor-directory-toggle"')
    expect(markup).not.toContain('data-active="true"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('class="editor-plain-toolbar"')
    expect(markup).toContain('data-slot="editor"')
  })

  it('renders the appropriate empty state for workspace presence', () => {
    const missingWorkspaceMarkup = renderToStaticMarkup(
      <WorkspaceEditorEmptyState
        hasWorkspace={false}
        isPickingWorkspace={false}
        onOpenWorkspaceSwitch={noop}
      />,
    )
    const unopenedFileMarkup = renderToStaticMarkup(
      <WorkspaceEditorEmptyState
        hasWorkspace
        isPickingWorkspace={false}
        onOpenWorkspaceSwitch={noop}
      />,
    )

    expect(missingWorkspaceMarkup).toContain('class="editor-empty-state is-workspace-missing"')
    expect(missingWorkspaceMarkup).toContain('选择工作目录')
    expect(missingWorkspaceMarkup).toContain('连接一个文件夹后')
    expect(missingWorkspaceMarkup).toContain(
      'data-size="md" data-tone="default" data-variant="primary" class="app-button"',
    )
    expect(missingWorkspaceMarkup).toMatch(
      /<button[^>]*class="app-button"[^>]*><svg[^>]*aria-hidden="true"/,
    )
    expect(unopenedFileMarkup).toContain('未打开文件')
    expect(unopenedFileMarkup).not.toContain('选择工作目录')
  })
})

describe('workspace editor component styles', () => {
  it('keeps component-owned styles outside global CSS with accessible motion and focus states', async () => {
    const [globalCss, appIconButtonCss, editorSurfaceCss, fileTabsCss, fileTabsSource] = await Promise.all([
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-icon-button/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/workspace-editor-surface/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/file-tabs/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/workspace/components/file-tabs/file-tabs.tsx', import.meta.url), 'utf8'),
    ])

    expect(globalCss).not.toMatch(/(^|\n)\.editor-frame\s*\{/)
    expect(globalCss).not.toMatch(/(^|\n)\.editor-empty-state\s*\{/)
    expect(globalCss).not.toMatch(/(^|\n)\.file-tabs-shell\s*\{/)
    expect(appIconButtonCss).toContain('.app-icon-button[data-size]:focus-visible')
    expect(appIconButtonCss).toContain('outline: 2px solid var(--focus);')
    expect(editorSurfaceCss).not.toMatch(/(^|\n)\.editor-directory-toggle\s*\{/)
    expect(editorSurfaceCss).not.toContain('.app-icon-button.editor-directory-toggle')
    expect(editorSurfaceCss).toMatch(
      /\.editor-directory-toggle\[aria-pressed='true'\]\s*\{[^}]*color:\s*var\(--foreground-primary\);/s,
    )
    expect(editorSurfaceCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(fileTabsCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(`${editorSurfaceCss}\n${fileTabsCss}`).not.toContain('transition: all')
    expect(fileTabsSource).toContain("import './styles.css'")
  })
})

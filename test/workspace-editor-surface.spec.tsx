import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  WorkspaceEditorDirectorySidebar,
  WorkspaceEditorDirectoryToggle,
  WorkspaceEditorLoadingState,
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
          <WorkspaceEditorDirectoryToggle isVisible onToggle={noop} />
        <WorkspaceEditorView leadingToolbarAction={<button type='button'>Toggle</button>}>
          <div data-slot='editor'>Editor</div>
        </WorkspaceEditorView>
      </WorkspaceEditorSurface>,
    )

    expect(markup).toContain('class="editor-frame"')
    expect(markup).toContain('data-slot="tabs"')
    expect(markup).toContain('id="editor-content-panel"')
    expect(markup).toContain('aria-label="Editor content"')
    expect(markup).toContain('role="tabpanel"')
    expect(markup).toContain('class="editor-directory-sidebar"')
    expect(markup).toContain('class="app-icon-button editor-directory-toggle"')
    expect(markup).not.toContain('data-active="true"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('class="viewer-toolbar"')
    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-orientation="horizontal"')
    expect(markup).toContain('aria-label="编辑器工具栏"')
    expect(markup).toContain('data-slot="editor"')
  })

  it('uses the shared loading state for lazy editor surfaces', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceEditorLoadingState label='正在加载差异编辑器…' />,
    )

    expect(markup).toContain('class="app-loading-state editor-lazy-fallback"')
    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
    expect(markup).toContain('正在加载差异编辑器…')
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
    expect(editorSurfaceCss).not.toContain('.editor-lazy-spinner')
    expect(editorSurfaceCss).not.toContain('@keyframes editor-lazy-spin')
    expect(fileTabsCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(`${editorSurfaceCss}\n${fileTabsCss}`).not.toContain('transition: all')
    expect(fileTabsSource).toContain("import './styles.css'")
  })
})

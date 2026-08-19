import { readFile } from 'node:fs/promises'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ViewerToolbar,
  ViewerToolbarGroup,
} from '../src/components/ui/document-viewer-controls'

function readSource(path: string) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('ViewerToolbar structure', () => {
  it('provides the shared visual and accessibility shell', () => {
    const markup = renderToStaticMarkup(
      <ViewerToolbar aria-label='Preview controls'>
        <ViewerToolbarGroup>Leading</ViewerToolbarGroup>
        <ViewerToolbarGroup align='end'>Trailing</ViewerToolbarGroup>
      </ViewerToolbar>,
    )

    expect(markup).toContain('class="viewer-toolbar"')
    expect(markup).toContain('role="toolbar"')
    expect(markup).toContain('aria-orientation="horizontal"')
    expect(markup).toContain('aria-label="Preview controls"')
    expect(markup).toContain('class="viewer-toolbar-control-group"')
    expect(markup).toContain('data-align="end"')
  })

  it('owns every full-width editor and preview toolbar shell', async () => {
    const [
      controlsSource,
      controlsStyles,
      fileSystemSource,
      fileSystemStyles,
      gitDiffStyles,
      meoHostStyles,
      meoSource,
      meoVendorStyles,
      workspaceSource,
      workspaceStyles,
    ] = await Promise.all([
      readSource('src/components/ui/document-viewer-controls/document-viewer-controls.tsx'),
      readSource('src/components/ui/document-viewer-controls/styles.css'),
      readSource('src/components/ui/file-system/file-system.tsx'),
      readSource('src/components/ui/file-system/styles.css'),
      readSource('src/features/editor/components/git-diff-editor/styles.css'),
      readSource('src/features/editor/components/meo-editor-host/styles.css'),
      readSource('src/features/editor/lib/meo-native-editor-shell.tsx'),
      readSource('src/vendor/meo/webview/styles.css'),
      readSource('src/features/workspace/components/workspace-editor-surface/workspace-editor-surface.tsx'),
      readSource('src/features/workspace/components/workspace-editor-surface/styles.css'),
    ])

    expect(controlsSource).toContain('React.forwardRef<HTMLElement, ViewerToolbarProps>')
    expect(controlsSource).toContain('type ViewerToolbarAccessibilityProps =')
    expect(controlsSource).toContain('<ViewerToolbarGroup className={className}>')
    expect(controlsStyles).toContain('padding: 0 var(--editor-toolbar-inline-padding, 6px);')
    expect(controlsStyles).toContain('gap: var(--editor-toolbar-gap, 6px);')
    expect(controlsStyles).toContain('gap: var(--editor-toolbar-control-gap, 2px);')
    expect(meoSource).toContain('<ViewerToolbar')
    expect(meoSource).toContain('<ViewerToolbarGroup>{leadingToolbarAction}</ViewerToolbarGroup>')
    expect(meoSource).toContain('<ViewerToolbarSeparator />')
    expect(meoSource).not.toContain("className='format-group'")
    expect(meoSource).not.toContain("className='right-group'")
    expect(meoSource).not.toContain("className='format-separator'")
    expect(workspaceSource).toContain("<ViewerToolbar aria-label='编辑器工具栏'")
    expect(fileSystemSource).toContain('<ViewerToolbar aria-label="文件浏览器工具栏">')

    expect(fileSystemSource).not.toContain('<div className="file-system-toolbar">')
    expect(fileSystemStyles).not.toMatch(/(^|\n)\.file-system-toolbar\s*\{/)
    expect(fileSystemStyles).not.toMatch(
      /\.file-system-toolbar-(?:leading|trailing)\s*\{[^}]*gap\s*:/s,
    )
    expect(meoHostStyles).not.toContain('meo-directory-toolbar-inset')
    expect(meoHostStyles).not.toContain('data-leading-toolbar-inset')
    expect(meoVendorStyles).not.toMatch(
      /\.mode-toolbar\s*\{[^}]*--editor-toolbar-(?:control-)?gap\s*:/s,
    )
    expect(meoVendorStyles).not.toContain('.format-group')
    expect(meoVendorStyles).not.toContain('.right-group')
    expect(meoVendorStyles).not.toContain('.format-separator')
    expect(meoVendorStyles).not.toMatch(
      /\.meo-native-theme \.mode-toolbar\s*\{[^}]*padding(?:-inline-start|-left)?\s*:/s,
    )
    expect(workspaceStyles).not.toMatch(/(^|\n)\.editor-plain-toolbar\s*\{/)
    expect(workspaceStyles).not.toContain('--editor-toolbar-gap:')
    expect(workspaceStyles).not.toContain('--editor-toolbar-control-gap:')
    expect(gitDiffStyles).toMatch(
      /\.git-diff-header-start\s*\{[^}]*gap:\s*var\(--editor-toolbar-gap, 6px\);/s,
    )
  })

  it('is the toolbar shell used by every file preview family', async () => {
    const previewSources = await Promise.all(
      [
        'src/components/ui/csv-viewer.tsx',
        'src/components/ui/docx-viewer.tsx',
        'src/components/ui/file-system/file-system.tsx',
        'src/components/ui/pdf-viewer.tsx',
        'src/components/ui/pptx-viewer.tsx',
        'src/components/ui/xlsx-viewer.tsx',
        'src/features/editor/components/git-diff-editor/git-diff-editor.tsx',
        'src/features/editor/lib/meo-native-editor-shell.tsx',
        'src/features/workspace/components/workspace-editor-surface/workspace-editor-surface.tsx',
        'src/features/workspace/components/workspace-file-preview/workspace-file-preview.tsx',
      ].map(readSource),
    )

    for (const source of previewSources) {
      expect(source).toContain('<ViewerToolbar')

      const toolbarOpenTags = source.match(
        /<ViewerToolbar(?=[\s/>])[\s\S]*?>/g,
      ) ?? []

      for (const openTag of toolbarOpenTags) {
        expect(openTag).toMatch(/aria-(?:hidden|label|labelledby)=/)
      }
    }
  })
})

import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

describe('shadow system', () => {
  it('uses shadow-plugin as the single global elevation scale', async () => {
    const [packageJsonSource, indexCss] = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
    ])
    const packageJson = JSON.parse(packageJsonSource) as {
      devDependencies?: Record<string, string>
    }

    expect(packageJson.devDependencies?.['shadow-plugin']).toBe('1.2.7')
    expect(indexCss.indexOf('@import "tailwindcss" source("./");')).toBeLessThan(
      indexCss.indexOf('@import "shadow-plugin";'),
    )
    expect(indexCss.indexOf('@import "shadow-plugin";')).toBeLessThan(
      indexCss.indexOf('@import "@heroui/styles";'),
    )

    for (const size of ['xs', 'sm', 'md', 'lg', 'xl', '2xl']) {
      expect(indexCss).toContain(`--shadow-${size}: var(--smooth-shadow-${size});`)
    }
    expect(indexCss).toContain('--shadow-none: 0 0 #0000;')
    expect(indexCss).not.toContain('--shadow-2xs:')
    expect(indexCss).not.toContain('--shadow-3xl:')
  })

  it('uses a ring only for shared elevated surfaces', async () => {
    const [
      indexCss,
      appMenuCss,
      appDialogSource,
      appAlertDialogSource,
      appDialogCss,
      appButtonCss,
      appIconButtonCss,
    ] = await Promise.all([
      readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-menu/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-dialog/app-dialog.tsx', import.meta.url), 'utf8'),
      readFile(
        new URL('../src/components/app-dialog/app-alert-dialog.tsx', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../src/components/app-dialog/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-button/styles.css', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-icon-button/styles.css', import.meta.url), 'utf8'),
    ])

    expect(indexCss).toContain(
      [
        '--app-menu-popup-shadow:',
        '    var(--shadow-sm),',
        '    0 0 0 1px var(--smooth-ring-color);',
      ].join('\n'),
    )
    expect(indexCss).not.toContain('--dialog-shadow:')
    expect(appMenuCss).toMatch(
      /\.app-menu-surface\s*\{[^}]*border:\s*0;[^}]*box-shadow:\s*var\(--app-menu-popup-shadow\);/s,
    )
    expect(appDialogSource).toMatch(
      /className=\{joinClassNames\(\s*'app-dialog-popup',\s*'smooth-shadow-ring-md',\s*className,\s*\)\}/s,
    )
    expect(appAlertDialogSource).toMatch(
      /className=\{joinClassNames\(\s*'app-alert-dialog-popup',\s*'smooth-shadow-ring-md',\s*className,\s*\)\}/s,
    )
    expect(appDialogCss).toMatch(
      /\.app-dialog-popup,\s*\n\.app-alert-dialog-popup\s*\{[^}]*border:\s*0;/s,
    )
    expect(appDialogCss).not.toMatch(
      /\.app-dialog-popup,\s*\n\.app-alert-dialog-popup\s*\{[^}]*box-shadow:/s,
    )

    expect(appButtonCss).toContain('box-shadow: var(--app-button-shadow);')
    expect(appIconButtonCss).toContain('box-shadow: var(--shadow-xs);')
    expect(appButtonCss).not.toContain('--smooth-ring-color')
    expect(appIconButtonCss).not.toContain('--smooth-ring-color')
  })

  it('applies ring utilities to standalone floating surfaces without leaking into embedded UI', async () => {
    const [
      appTooltipSource,
      appTooltipCss,
      documentViewerControlsSource,
      documentViewerSidebarSource,
      docxAnnotationSource,
      fileSystemSource,
      overlayLayerSource,
      overlayLayerCss,
      xlsxViewerSource,
    ] = await Promise.all([
      readFile(new URL('../src/components/app-tooltip/app-tooltip.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/app-tooltip/styles.css', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../src/components/ui/document-viewer-controls/document-viewer-controls.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../src/components/ui/document-viewer-sidebar.tsx', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../src/components/ui/docx-annotation-card.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/ui/file-system/file-system.tsx', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../src/features/layout/components/app-overlay-layer/app-overlay-layer.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../src/features/layout/components/app-overlay-layer/styles.css', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../src/components/ui/xlsx-viewer.tsx', import.meta.url), 'utf8'),
    ])

    expect(appTooltipSource).toContain("className='app-tooltip'")
    expect(appTooltipSource).not.toContain('smooth-shadow-ring')
    expect(appTooltipCss).toContain(
      [
        '.app-tooltip {',
        '  --shadow-overlay:',
        '    var(--shadow-xs),',
        '    0 0 0 1px var(--smooth-ring-color);',
      ].join('\n'),
    )
    expect(documentViewerControlsSource).toContain('smooth-shadow-ring-sm z-50')
    expect(documentViewerControlsSource).not.toContain(
      'rounded-lg border border-[var(--border-primary)]',
    )
    expect(docxAnnotationSource).toContain('smooth-shadow-ring-sm pointer-events-auto')
    expect(docxAnnotationSource).not.toContain(
      'rounded-lg border border-[var(--border-secondary)]',
    )
    expect(fileSystemSource).toContain('smooth-shadow-ring-sm z-[82]')
    expect(fileSystemSource).not.toContain('shadow-[0_24px_64px_rgba(15,23,42,0.18)]')
    expect(fileSystemSource).not.toContain('shadow-xs/5')
    expect(xlsxViewerSource).toContain('smooth-shadow-ring-md pointer-events-none fixed')
    expect(xlsxViewerSource).not.toContain('shadow-sm/5')
    expect(xlsxViewerSource).not.toContain('shadow-xl')

    expect(overlayLayerSource).toContain("import './styles.css'")
    expect(overlayLayerSource).toContain("className='app-toast-region'")
    expect(overlayLayerCss).toContain(
      [
        '.app-toast-region {',
        '  --shadow-overlay:',
        '    var(--shadow-sm),',
        '    0 0 0 1px var(--smooth-ring-color);',
        '}',
      ].join('\n'),
    )
    expect(overlayLayerCss).not.toContain('[data-slot=')

    expect(documentViewerSidebarSource).toContain('border-r bg-[var(--background-primary)] shadow-lg')
    expect(documentViewerSidebarSource).not.toContain('smooth-shadow-ring')
  })
})

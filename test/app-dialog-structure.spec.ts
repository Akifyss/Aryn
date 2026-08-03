import { readdir, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function collectSourceFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryUrl = new URL(
        entry.name + (entry.isDirectory() ? '/' : ''),
        directory,
      )
      if (entry.isDirectory()) {
        return collectSourceFiles(entryUrl)
      }
      return /\.[cm]?[jt]sx?$/.test(entry.name) ? [entryUrl] : []
    }),
  )

  return files.flat()
}

describe('shared application dialogs', () => {
  it('owns every Base UI dialog import and leaves no HeroUI modal primitives behind', async () => {
    const sourceFiles = await collectSourceFiles(
      new URL('../src/', import.meta.url),
    )
    const sources = await Promise.all(
      sourceFiles.map(async (url) => ({
        path: url.pathname.replaceAll('\\', '/'),
        source: await readFile(url, 'utf8'),
      })),
    )

    const directBaseUiConsumers = sources
      .filter(
        ({ path, source }) =>
          !path.includes('/components/app-dialog/') &&
          /@base-ui\/react\/(?:alert-dialog|dialog)/.test(source),
      )
      .map(({ path }) => path)

    const heroUiDialogConsumers = sources
      .filter(({ source }) =>
        /import\s*\{[^}]*\b(?:AlertDialog|Modal|useOverlayState)\b[^}]*\}\s*from\s*['"]@heroui\/react['"]/s.test(
          source,
        ),
      )
      .map(({ path }) => path)

    expect(directBaseUiConsumers).toEqual([])
    expect(heroUiDialogConsumers).toEqual([])
  })

  it('centralizes the accessible portal, backdrop, viewport, popup, and motion contract', async () => {
    const [dialogSource, alertDialogSource, dialogCss, shellCss, indexCss] =
      await Promise.all([
        readFile(
          new URL(
            '../src/components/app-dialog/app-dialog.tsx',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(
          new URL(
            '../src/components/app-dialog/app-alert-dialog.tsx',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(
          new URL('../src/components/app-dialog/styles.css', import.meta.url),
          'utf8',
        ),
        readFile(
          new URL(
            '../src/features/layout/components/app-shell/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
        readFile(new URL('../src/index.css', import.meta.url), 'utf8'),
      ])

    expect(dialogSource).toContain("from '@base-ui/react/dialog'")
    expect(alertDialogSource).toContain("from '@base-ui/react/alert-dialog'")
    expect(dialogSource).toContain('<BaseDialog.Portal>')
    expect(dialogSource).toContain('<BaseDialog.Backdrop')
    expect(dialogSource).toContain('<BaseDialog.Viewport')
    expect(dialogSource).toContain('<BaseDialog.Popup')
    expect(alertDialogSource).toContain('<BaseAlertDialog.Portal>')
    expect(alertDialogSource).toContain('<BaseAlertDialog.Backdrop')
    expect(alertDialogSource).toContain('<BaseAlertDialog.Viewport')
    expect(alertDialogSource).toContain('<BaseAlertDialog.Popup')
    expect(dialogSource).toContain("from '@/components/app-icon-button'")
    expect(alertDialogSource).toContain("from '@/components/app-icon-button'")
    expect(dialogSource).toContain('<AppIconButton')
    expect(alertDialogSource).toContain('<AppIconButton')
    expect(dialogSource).toContain('tooltip={closeLabel}')
    expect(dialogSource).toContain("placement='top'")
    expect(alertDialogSource).toContain("tooltip='关闭'")
    expect(alertDialogSource).toContain("placement='top'")
    expect(alertDialogSource).toContain('<BaseAlertDialog.Close')
    expect(dialogSource).not.toContain('CloseButton:')
    expect(alertDialogSource).not.toContain('CloseButton:')
    expect(dialogCss).not.toContain('.app-dialog-close-button svg')
    expect(indexCss).toContain('--app-icon-button-size-md: 32px;')
    expect(indexCss).toContain('--icon-size-md: 16px;')
    expect(indexCss).not.toContain('--app-button-base-icon-size:')
    expect(indexCss).toContain('--app-button-base-radius-md: 8px;')
    expect(indexCss).not.toContain('--app-icon-button-icon-size:')
    expect(indexCss).not.toContain('--app-icon-button-radius-md:')
    expect(dialogCss).toMatch(
      /\.app-alert-dialog-header\s*\{[^}]*padding-inline-end:\s*calc\(var\(--app-icon-button-size-md\) \+ 12px\);/s,
    )
    expect(dialogCss).toContain('[data-starting-style]')
    expect(dialogCss).toContain('[data-ending-style]')
    expect(indexCss).toContain('--dialog-backdrop-transition-duration: 150ms;')
    expect(indexCss).toContain('--dialog-popup-start-scale: 0.98;')
    expect(indexCss).toContain('--dialog-popup-transition-duration: 100ms;')
    expect(indexCss).toContain('--dialog-popup-transition-easing: ease-out;')
    expect(dialogCss).toContain(
      'transition: opacity var(--dialog-backdrop-transition-duration);',
    )
    expect(dialogCss).toContain(
      'transform var(--dialog-popup-transition-duration) var(--dialog-popup-transition-easing)',
    )
    expect(dialogCss).toContain(
      'opacity var(--dialog-popup-transition-duration) var(--dialog-popup-transition-easing)',
    )
    expect(dialogCss).toContain(
      'transform: scale(var(--dialog-popup-start-scale));',
    )
    expect(dialogCss).not.toContain('translateY(4px) scale(0.985)')
    expect(dialogCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(indexCss.match(/--app-z-modal-layer: 50;/g)).toHaveLength(1)
    expect(indexCss.match(/--dialog-radius: var\(--radius-2xl\);/g)).toHaveLength(1)
    expect(
      indexCss.match(
        /--dialog-shadow:\s*\n\s*var\(--shadow-md\),\s*\n\s*0 0 0 1px var\(--smooth-ring-color\);/g,
      ),
    ).toHaveLength(1)
    expect(indexCss.match(/--backdrop: rgb\(0 0 0 \/ 0\.25\);/g)).toHaveLength(1)
    expect(indexCss.match(/--backdrop: rgb\(0 0 0 \/ 0\.5\);/g)).toHaveLength(1)
    expect(dialogCss.match(/z-index: var\(--app-z-modal-layer\);/g)).toHaveLength(2)
    expect(dialogCss).toContain('background: var(--backdrop);')
    expect(dialogCss).toContain('border-radius: var(--dialog-radius);')
    expect(dialogCss).toContain('box-shadow: var(--dialog-shadow);')
    expect(dialogCss).toMatch(
      /\.app-dialog-popup,\s*\n\.app-alert-dialog-popup\s*\{[^}]*border:\s*0;/s,
    )
    expect(dialogCss).not.toMatch(
      /\.app-dialog-popup,\s*\n\.app-alert-dialog-popup\s*\{[^}]*border:\s*1px/s,
    )
    expect(dialogCss).toContain('background: var(--danger-soft);')
    expect(dialogCss).toContain('background: var(--warning-soft);')
    expect(dialogCss).toMatch(
      /\.app-alert-dialog-popup\s*\{[^}]*width:\s*min\(100%, 32rem\);/s,
    )
    expect(shellCss).toContain('body:has([data-app-modal-layer])')
    expect(shellCss).not.toContain("[data-slot='modal-backdrop']")
    expect(shellCss).not.toContain("[data-slot='alert-dialog-backdrop']")
    expect(shellCss).toMatch(
      /\.panel-drawer-backdrop\.panel-drawer-backdrop\s*\{[^}]*background-color:\s*var\(--backdrop\);/s,
    )
    expect(shellCss).not.toMatch(
      /\.panel-drawer-backdrop\.panel-drawer-backdrop\s*\{[^}]*background-color:\s*var\(--overlay\);/s,
    )
  })

  it('defines status soft colors consistently across themes', async () => {
    const indexCss = await readFile(
      new URL('../src/index.css', import.meta.url),
      'utf8',
    )

    for (const token of ['danger', 'success', 'warning']) {
      expect(
        indexCss.match(
          new RegExp(
            `--${token}-soft: color-mix\\(in oklch, var\\(--${token}\\) 15%, transparent\\);`,
            'g',
          ),
        ),
      ).toHaveLength(2)
    }
  })

  it('keeps Base UI as a runtime dependency', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }

    expect(packageJson.dependencies?.['@base-ui/react']).toBeDefined()
    expect(packageJson.devDependencies?.['@base-ui/react']).toBeUndefined()
  })

  it('keeps feature dialogs from overriding the shared visual shell', async () => {
    const dialogStyles = [
      {
        selector: 'settings-dialog',
        source: await readFile(
          new URL(
            '../src/features/settings/components/settings-dialog/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
      },
      {
        selector: 'command-palette-dialog',
        source: await readFile(
          new URL(
            '../src/features/command-palette/components/command-palette/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
      },
      {
        selector: 'project-create-dialog',
        source: await readFile(
          new URL(
            '../src/features/workspace/components/new-project-dialog/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
      },
      {
        selector: 'file-system-date-range-dialog',
        source: await readFile(
          new URL(
            '../src/components/ui/file-system/styles.css',
            import.meta.url,
          ),
          'utf8',
        ),
      },
    ]
    const sharedVisualProperty =
      /(?:^|\n)\s*(?:background(?:-[\w-]+)?|border(?:-[\w-]+)?|box-shadow)\s*:/

    dialogStyles.forEach(({ selector, source }) => {
      const rule = source.match(
        new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`),
      )?.[1]

      expect(rule, `missing .${selector} rule`).toBeDefined()
      expect(rule).not.toMatch(sharedVisualProperty)
    })
  })

  it('keeps file dialog roots mounted and retains their content through exit transitions', async () => {
    const fileSystemSource = await readFile(
      new URL(
        '../src/components/ui/file-system/file-system.tsx',
        import.meta.url,
      ),
      'utf8',
    )

    expect(fileSystemSource).toContain('open={isViewerDialogOpen}')
    expect(fileSystemSource).toContain('open={isDateRangeDialogOpen}')
    expect(fileSystemSource).toContain('onOpenChangeComplete={(open) => {')
    expect(fileSystemSource).toContain('setOpenedFile(null)')
    expect(
      fileSystemSource.match(/onOpenChangeComplete=\{\(open\) => \{/g),
    ).toHaveLength(2)
    expect(fileSystemSource).toContain('setDateRangeDialog(null)')
    expect(fileSystemSource).toContain('setIsDateRangeDialogOpen(true)')
    expect(fileSystemSource).toContain('initialFocus={initialFocusRef}')
    expect(fileSystemSource.match(/showCloseButton/g)).toHaveLength(2)
  })

  it('uses the shared close button composition in every custom dialog', async () => {
    const [
      commandPaletteSource,
      settingsSource,
      newProjectSource,
      fileSystemSource,
    ] = await Promise.all([
      readFile(
        new URL(
          '../src/features/command-palette/components/command-palette/command-palette.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/settings/components/settings-dialog/settings-dialog.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/features/workspace/components/new-project-dialog/new-project-dialog.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL(
          '../src/components/ui/file-system/file-system.tsx',
          import.meta.url,
        ),
        'utf8',
      ),
    ])

    expect(settingsSource).toContain('showCloseButton')
    expect(newProjectSource).toContain('showCloseButton')
    expect(fileSystemSource.match(/showCloseButton/g)).toHaveLength(2)
    expect(commandPaletteSource).toContain(
      "<AppDialog.Close className='sr-only' tabIndex={-1}>",
    )
  })
})

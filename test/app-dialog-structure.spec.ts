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
    const [dialogSource, alertDialogSource, dialogCss, shellCss] =
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
    expect(dialogSource).toContain("triggerMode='focusable'")
    expect(alertDialogSource).toContain("triggerMode='focusable'")
    expect(alertDialogSource).toContain('<BaseAlertDialog.Close')
    expect(dialogSource).not.toContain('CloseButton:')
    expect(alertDialogSource).not.toContain('CloseButton:')
    expect(dialogCss).toMatch(
      /\.app-dialog-close-button\s*\{[^}]*width:\s*32px;[^}]*height:\s*32px;/s,
    )
    expect(dialogCss).toMatch(
      /\.app-dialog-close-button svg\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s,
    )
    expect(dialogCss).toContain('.app-dialog-close-button:focus-visible')
    expect(dialogCss).toMatch(
      /\.app-alert-dialog-description\s*\{[^}]*color:\s*var\(--foreground-primary\);/s,
    )
    expect(dialogCss).toMatch(
      /\.app-alert-dialog-header\s*\{[^}]*padding-inline-end:\s*44px;/s,
    )
    expect(dialogCss).toContain('[data-starting-style]')
    expect(dialogCss).toContain('[data-ending-style]')
    expect(dialogCss).toContain('transition: opacity 150ms;')
    expect(dialogCss).toContain('transform 100ms ease-out')
    expect(dialogCss).toContain('opacity 100ms ease-out')
    expect(dialogCss).toContain('transform: scale(0.98);')
    expect(dialogCss).not.toContain('translateY(4px) scale(0.985)')
    expect(dialogCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(shellCss).toContain('body:has([data-app-modal-layer])')
    expect(shellCss).not.toContain("[data-slot='modal-backdrop']")
    expect(shellCss).not.toContain("[data-slot='alert-dialog-backdrop']")
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
    expect(fileSystemSource).toContain('<AppTooltip tooltip="关闭"')
    expect(fileSystemSource).toContain('<AppDialog.Close')
  })

  it('uses the existing tooltip and Base UI close composition in every custom dialog', async () => {
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

    expect(settingsSource).toContain("<AppTooltip tooltip='关闭'")
    expect(settingsSource).toContain('<AppDialog.Close')
    expect(newProjectSource).toContain("<AppTooltip tooltip='关闭'")
    expect(newProjectSource).toContain('<AppDialog.Close')
    expect(fileSystemSource).toContain('<AppTooltip tooltip="关闭"')
    expect(fileSystemSource).toContain('<AppDialog.Close')
    expect(commandPaletteSource).toContain(
      "<AppDialog.Close className='sr-only' tabIndex={-1}>",
    )
  })
})

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('settings dialog structure', () => {
  it('keeps the modal shell and all feature-owned styles with the settings dialog', async () => {
    const [appSource, appCss, dialogSource, dialogCss] = await Promise.all([
      readSource('../src/App.tsx'),
      readSource('../src/App.css'),
      readSource('../src/features/settings/components/settings-dialog/settings-dialog.tsx'),
      readSource('../src/features/settings/components/settings-dialog/styles.css'),
    ])

    expect(appSource).toContain(
      "from '@/features/settings/components/settings-dialog/settings-dialog'",
    )
    expect(appSource).toContain('<SettingsDialog')
    expect(appSource).not.toContain('<Modal.Backdrop')

    expect(dialogSource).toContain("import './styles.css'")
    expect(dialogSource).toContain('<Modal.Backdrop')
    expect(dialogSource).toContain('<SettingsView')

    expect(dialogCss).toContain('.settings-modal {')
    expect(dialogCss).toContain('.settings-select-trigger {')
    expect(dialogCss).toContain('.provider-card-list {')
    expect(dialogCss).toContain('@media (max-width: 860px)')

    const featureClassNames = new Set(
      Array.from(
        dialogCss.matchAll(/\.(settings-[\w-]+|provider-[\w-]+)/g),
        (match) => match[1],
      ),
    )

    expect(featureClassNames.size).toBeGreaterThan(0)
    featureClassNames.forEach((className) => {
      expect(appCss).not.toContain(`.${className}`)
    })
  })

  it('keeps extracted styles focused, keyboard-visible, and reduced-motion aware', async () => {
    const [dialogSource, dialogCss] = await Promise.all([
      readSource('../src/features/settings/components/settings-dialog/settings-dialog.tsx'),
      readSource('../src/features/settings/components/settings-dialog/styles.css'),
    ])

    expect(dialogCss).not.toContain('.settings-radio-item')
    expect(dialogCss).not.toContain('.settings-sidebar-eyebrow')
    expect(dialogCss).not.toContain('.provider-brand-icon-wrapper')
    expect(dialogCss).not.toContain('transition: all')
    expect(dialogCss).toContain('overscroll-behavior: contain')
    expect(dialogCss).toContain('.settings-modal-close:focus-visible')
    expect(dialogCss).toContain('.settings-nav-item:focus-visible')
    expect(dialogCss).toContain('.provider-card-header:focus-visible')
    expect(dialogCss).toContain('.settings-secondary-toggle:focus-visible')
    expect(dialogCss).toContain('box-shadow: 0 0 0 2px var(--focus)')
    expect(dialogCss).toContain('box-shadow: inset 0 0 0 2px var(--focus)')
    expect(dialogCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(dialogSource).toContain("aria-current={section.id === activeSection ? 'page' : undefined}")
    expect(dialogSource).toContain('aria-controls={detailsId}')
    expect(dialogSource).toContain('aria-expanded={isExpanded}')
    expect(dialogSource).toContain('aria-hidden={!isExpanded}')
    expect(dialogSource).toContain('inert={isExpanded ? undefined : true}')
  })
})

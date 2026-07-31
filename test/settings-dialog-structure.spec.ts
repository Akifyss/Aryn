import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

async function readSource(relativePath: string) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8')
}

describe('settings dialog structure', () => {
  it('keeps the dialog shell and setting sections inside the settings feature', async () => {
    const [
      appSource,
      overlaySource,
      dialogSource,
      appearanceSource,
      conversationSource,
      editorSource,
      providerSource,
    ] = await Promise.all([
      readSource('../src/App.tsx'),
      readSource('../src/features/layout/components/app-overlay-layer/app-overlay-layer.tsx'),
      readSource('../src/features/settings/components/settings-dialog/settings-dialog.tsx'),
      readSource(
        '../src/features/settings/components/settings-dialog/appearance-settings-section/appearance-settings-section.tsx',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/conversation-settings-section/conversation-settings-section.tsx',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/editor-settings-section/editor-settings-section.tsx',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/provider-settings-section/provider-settings-section.tsx',
      ),
    ])

    expect(appSource).toContain(
      "from '@/features/layout/components/app-overlay-layer/app-overlay-layer'",
    )
    expect(appSource).toContain('<AppOverlayLayer')
    expect(appSource).not.toContain('<SettingsDialog')
    expect(appSource).not.toContain('<Modal.Backdrop')
    expect(overlaySource).toContain(
      "from '@/features/settings/components/settings-dialog/settings-dialog'",
    )
    expect(overlaySource).toContain('<SettingsDialog')

    expect(dialogSource).toContain("import './styles.css'")
    expect(dialogSource).toContain("import { AppDialog } from '@/components/app-dialog'")
    expect(dialogSource).toContain('<AppDialog.Root')
    expect(dialogSource).toContain('<AppDialog.Popup')
    expect(dialogSource).toContain('<SettingsView')
    expect(dialogSource).toContain('<AppearanceSettingsSection')
    expect(dialogSource).toContain('<ConversationSettingsSection')
    expect(dialogSource).toContain('<EditorSettingsSection')
    expect(dialogSource).toContain('<ProviderSettingsSection')

    expect(appearanceSource).toContain("import './styles.css'")
    expect(conversationSource).toContain("import './styles.css'")
    expect(editorSource).toContain("import './styles.css'")
    expect(providerSource).toContain("import './styles.css'")
    expect(providerSource).toContain('window.appApi.onAgentProviderAuthUiEvent')
  })

  it('keeps component styles locally owned and out of the global stylesheet', async () => {
    const [
      globalCss,
      dialogCss,
      appearanceCss,
      conversationCss,
      editorCss,
      providerCss,
      selectCss,
    ] = await Promise.all([
      readSource('../src/index.css'),
      readSource('../src/features/settings/components/settings-dialog/styles.css'),
      readSource(
        '../src/features/settings/components/settings-dialog/appearance-settings-section/styles.css',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/conversation-settings-section/styles.css',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/editor-settings-section/styles.css',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/provider-settings-section/styles.css',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/settings-select/styles.css',
      ),
    ])

    expect(dialogCss).toContain('.settings-dialog {')
    expect(dialogCss).toContain('@media (max-width: 860px)')
    expect(dialogCss).not.toContain('.settings-select-trigger {')
    expect(dialogCss).not.toContain('.provider-card-list {')
    expect(dialogCss).not.toContain('.settings-theme-switcher {')
    expect(dialogCss).not.toContain('.settings-running-behavior-tabs {')

    expect(selectCss).toContain('.settings-select-trigger {')
    expect(appearanceCss).toContain('.settings-theme-switcher {')
    expect(conversationCss).toContain('.settings-running-behavior-tabs {')
    expect(editorCss).toContain('.settings-editor-image-folder')
    expect(providerCss).toContain('.provider-card-list {')

    const localCss = [
      dialogCss,
      appearanceCss,
      conversationCss,
      editorCss,
      providerCss,
      selectCss,
    ].join('\n')
    const featureClassNames = new Set(
      Array.from(
        localCss.matchAll(/\.(settings-[\w-]+|provider-[\w-]+)/g),
        (match) => match[1],
      ),
    )

    expect(featureClassNames.size).toBeGreaterThan(0)
    featureClassNames.forEach((className) => {
      expect(globalCss).not.toContain(`.${className}`)
    })
  })

  it('keeps extracted styles focused, keyboard-visible, and reduced-motion aware', async () => {
    const [
      dialogSource,
      providerCardSource,
      dialogCss,
      providerCss,
      selectCss,
      appIconButtonCss,
    ] = await Promise.all([
      readSource('../src/features/settings/components/settings-dialog/settings-dialog.tsx'),
      readSource(
        '../src/features/settings/components/settings-dialog/provider-settings-section/provider-card.tsx',
      ),
      readSource('../src/features/settings/components/settings-dialog/styles.css'),
      readSource(
        '../src/features/settings/components/settings-dialog/provider-settings-section/styles.css',
      ),
      readSource(
        '../src/features/settings/components/settings-dialog/settings-select/styles.css',
      ),
      readSource('../src/components/app-icon-button/styles.css'),
    ])
    const settingsCss = [dialogCss, providerCss, selectCss].join('\n')

    expect(settingsCss).not.toContain('.settings-radio-item')
    expect(settingsCss).not.toContain('.settings-sidebar-eyebrow')
    expect(settingsCss).not.toContain('.provider-brand-icon-wrapper')
    expect(settingsCss).not.toContain('transition: all')
    expect(dialogSource).toContain('showCloseButton')
    expect(dialogCss).toContain('.settings-nav-item:focus-visible')
    expect(providerCss).toContain('.provider-card-header:focus-visible')
    expect(appIconButtonCss).toContain('.app-icon-button[data-size]:focus-visible')
    expect(appIconButtonCss).toContain('outline: 2px solid var(--focus)')
    expect(providerCss).toContain('box-shadow: inset 0 0 0 2px var(--focus)')
    expect(providerCss).toContain(
      'padding-right: calc(var(--app-icon-button-size-md) + 20px) !important;',
    )
    expect(providerCardSource).toContain("variant='outline'")
    expect(providerCardSource).toContain("tone='danger'")
    expect(providerCardSource).not.toContain('settings-danger-button')
    expect(providerCss).not.toContain('settings-danger-button')
    expect(dialogCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(providerCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(selectCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(appIconButtonCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(dialogSource).toContain("aria-current={section.id === activeSection ? 'page' : undefined}")
    expect(providerCardSource).toContain('aria-controls={detailsId}')
    expect(providerCardSource).toContain('aria-expanded={isExpanded}')
    expect(providerCardSource).toContain('aria-hidden={!isExpanded}')
    expect(providerCardSource).toContain('inert={isExpanded ? undefined : true}')
  })
})

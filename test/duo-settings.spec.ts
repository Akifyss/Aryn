import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'

let browser: Browser
let script: string
let css: string

beforeAll(async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { DuoWorkspaceShell } from './src/features/duo/duo-workspace-shell'
      import { SettingsDialog } from './src/features/settings/components/settings-dialog/settings-dialog'
      import { WorkspaceSidebar } from './src/features/workspace/components/workspace-sidebar/workspace-sidebar'
      import { useAppOverlayController } from './src/hooks/use-app-overlay-controller'
      const noop = () => {}
      window.appApi = { platform: 'win32', onAgentProviderAuthUiEvent: () => noop }
      function App() {
        const overlay = useAppOverlayController({ closeDrawers: noop, hasConfirmation: false,
          isGlobalProjectMenuOpen: false, isNewProjectDialogOpen: false, isProjectMenuOpen: false })
        window.readSettingsState = () => ({ sectionType: typeof overlay.settingsSection,
          section: typeof overlay.settingsSection === 'string' ? overlay.settingsSection : null,
          eventType: overlay.settingsSection?.type ?? null })
        return <>
          {window.fixtureLayout === 'editor' || window.fixtureLayout === 'agent' ?
            <div style={{ position: 'fixed', left: 0, top: 0, width: 280, height: 700 }}>
              <WorkspaceSidebar hasWorkspace isPickingWorkspace={false} platform='windows'
                showWorkspaceSwitch={window.fixtureLayout === 'editor'} surfaceMode='docked'
                workspaceLabel='QA' onOpenSettings={overlay.openSettings} onOpenWorkspaceSwitch={noop}>
                <span>Workspace navigation</span>
              </WorkspaceSidebar>
            </div> : <DuoWorkspaceShell configuration={{conversations:{}}} chromeVars={{}} platform='windows'
            isFullScreen={false} isModalOpen={overlay.isAppModalLayerOpen} isActive
            onRequestClose={noop} onSearch={noop} onSettings={overlay.openSettings}
            onWorkspace={noop} workspaceLabel='QA' isPickingWorkspace={false}
            isWorkspaceMenuOpen={false} ref={null} />}
          <button style={{ position: 'fixed', left: 360, top: 100 }}
            onClick={() => overlay.openSettingsSection('providers')}>Open providers directly</button>
          <SettingsDialog activeSection={overlay.settingsSection} isOpen={overlay.isSettingsOpen}
            onOpenChange={overlay.setIsSettingsOpen} onSectionChange={overlay.selectSettingsSection}
            agentState={null} iconThemes={{ light: null, dark: null }} iconThemeOptions={[]}
            isIconThemeBusy={false} onAgentStateChange={noop} onSelectIconTheme={async () => {}}
            onStatusMessage={noop} resolvedTheme='light' workspacePath='/qa' />
        </>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': path.resolve('src') },
    outfile: 'duo-settings-fixture.js',
    plugins: [{ name: 'unrelated-pane-content', setup(builder) {
      // Seed retained legacy state inside the test build; production exposes only typed commands.
      builder.onLoad({ filter: /use-app-overlay-controller\.ts$/ }, async (args) => ({
        contents: (await readFile(args.path, 'utf8')).replace(
          'const [isSettingsOpen, setIsSettingsOpen]',
          "window.restoreLegacySettingsState = () => setSettingsSection({ type: 'click' } as unknown as SettingsSectionId)\n  const [isSettingsOpen, setIsSettingsOpen]",
        ),
        loader: 'ts', resolveDir: path.dirname(args.path),
      }))
      // Exercise real settings buttons in all layouts, the controller and entire dialog.
      builder.onResolve({ filter: /\/(duo-pane|duo-panel-layer|duo-conversation-layer|app-titlebar)$/ },
        (args) => ({ path: args.path.split('/').pop()!, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({
        contents: args.path === 'duo-pane'
          ? 'export const DuoPane = () => null'
          : args.path === 'duo-panel-layer' ? 'export const DuoPanelLayer = () => null'
          : args.path === 'duo-conversation-layer' ? 'export const DuoConversationLayer = () => null'
          : 'export const AppTitlebar = () => null',
      }))
    } }],
  })
  script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text
  const styles = await compile(
    await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} },
  )
  css = styles.build(['flex-1', 'min-h-0', 'flex', 'flex-col', 'overflow-hidden', 'sr-only'])
  browser = await chromium.launch({ headless: true })
})

it.each([false, true])('repairs retained invalid state before rendering settings (already open: %s)', async (alreadyOpen) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.setDefaultTimeout(4000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: script })
    const settingsButton = page.getByRole('button', { name: '打开设置', exact: true })
    await settingsButton.waitFor()
    if (alreadyOpen) {
      await settingsButton.focus()
      await page.keyboard.press('Enter')
      await page.getByText('主题模式', { exact: true }).waitFor({ state: 'visible' })
      await page.getByRole('button', { name: '编辑器', exact: true }).click()
      await page.getByText('Markdown 编辑器', { exact: true }).waitFor({ state: 'visible' })
    }

    await page.evaluate(() => (window as unknown as { restoreLegacySettingsState: () => void }).restoreLegacySettingsState())

    await expect.poll(() => page.evaluate(() => (window as unknown as { readSettingsState: () => unknown }).readSettingsState()))
      .toEqual({ sectionType: 'string', section: 'appearance', eventType: null })
    if (!alreadyOpen) {
      // Recovery belongs to the controller and must work while the view is absent.
      expect(await page.getByRole('dialog').count()).toBe(0)
      await settingsButton.focus()
      await page.keyboard.press('Enter')
    }
    await page.getByText('主题模式', { exact: true }).waitFor({ state: 'visible' })
    expect(await page.locator('.settings-nav [aria-current="page"]').allTextContents()).toEqual(['外观'])
    expect(await page.locator('.settings-panel-title').textContent()).toBe('外观')
    await page.getByText('主题模式', { exact: true }).waitFor({ state: 'visible' })

    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
    await settingsButton.focus()
    await page.keyboard.press('Enter')
    await page.getByText('主题模式', { exact: true }).waitFor({ state: 'visible' })
    expect(errors).toEqual([])
  } finally { await page.close() }
})

afterAll(async () => { await browser?.close() })

it.each(['duo', 'editor', 'agent'].flatMap((layout) => ['mouse', 'keyboard'].map((input) => ({ layout, input }))))(
  'opens and remembers $layout settings via $input without treating the event as a section', async ({ layout, input }) => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
  page.setDefaultTimeout(4000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="root"></div>')
    await page.evaluate((value) => Object.assign(window, { fixtureLayout: value }), layout)
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: script })
    const settingsButton = page.getByRole('button', { name: layout === 'duo' ? '打开设置' : '设置', exact: true })
    await settingsButton.waitFor()
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    const openSettings = async () => {
      if (input === 'mouse') await settingsButton.click()
      else { await settingsButton.focus(); await page.keyboard.press('Enter') }
      expect(errors).toEqual([])
      await page.getByRole('dialog').waitFor()
    }
    const assertSection = async (section: string, title: string) => {
      expect(await page.evaluate(() => (window as unknown as { readSettingsState: () => unknown }).readSettingsState()))
        .toEqual({ sectionType: 'string', section, eventType: null })
      expect(await page.locator('.settings-panel-title').textContent()).toBe(title)
      expect(await page.locator('.settings-nav [aria-current="page"]').allTextContents()).toEqual([title])
      await page.locator('.settings-panel-content').waitFor({ state: 'visible' })
    }
    const closeSettings = () => page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()

    await openSettings()
    await assertSection('appearance', '外观')
    await page.getByText('主题模式', { exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '对话', exact: true }).click()
    await assertSection('conversation', '对话')
    await page.getByText('跟进行为', { exact: true }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '编辑器', exact: true }).click()
    await assertSection('editor', '编辑器')
    await closeSettings()
    await openSettings()
    await assertSection('editor', '编辑器')
    await page.getByText('Markdown 编辑器', { exact: true }).waitFor({ state: 'visible' })
    await closeSettings()
    await page.getByRole('button', { name: 'Open providers directly' }).click()
    await assertSection('providers', '服务提供商')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

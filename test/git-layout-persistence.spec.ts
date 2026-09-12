import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { AppStateStore } from '../electron/main/app-state'
import type { PersistedLayoutState } from '../electron/shared/contracts/persistence'

it('persists Git view changes independently of the window layout and restores them on restart', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { useGitWorkspaceController } from './src/features/git/hooks/use-git-workspace-controller'
      import { initializeRendererPersistentState } from './src/features/persistence/renderer-state'
      window.appApi = { updateLayoutState: window.writeLayout }
      initializeRendererPersistentState({ app: { layout: window.savedLayout }, workspace: { workspaceTabs: {} } })
      const noop = async () => {}
      function App() {
        const git = useGitWorkspaceController({ workspacePath: null,
          ensureWorkspaceTabsSaved: async () => true, loadWorkspaceTree: noop,
          reconcileDiscardedFile: noop, requestConfirmation: async () => true,
          setStatusMessage: noop, syncOpenDiffTabs: noop })
        return <>
          <output>{git.panelLayout}</output>
          <button onClick={() => git.setPanelLayout('tree')}>Tree</button>
          <button onClick={() => git.setPanelLayout('list')}>List</button>
        </>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': path.resolve('src') },
  })
  const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-git-layout-'))
  const statePath = path.join(root, 'app-state.json')
  const projectWorkspaces = { version: 1 as const, layouts: {} }
  await new AppStateStore(statePath).update(state => ({
    ...state, layout: { ...state.layout, projectWorkspaces },
  }))
  const browser = await chromium.launch({ headless: true })
  try {
    for (const [expected, next, label] of [['list', 'tree', 'Tree'], ['tree', 'list', 'List'], ['list', null, null]]) {
      const store = new AppStateStore(statePath)
      const savedLayout = (await store.read()).layout
      const page = await browser.newPage()
      const errors: string[] = []
      const writes: Partial<PersistedLayoutState>[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.exposeFunction('writeLayout', async (patch: Partial<PersistedLayoutState>) => {
        const saved = await store.update(state => ({ ...state, layout: { ...state.layout, ...patch } }))
        writes.push(patch)
        return saved.layout
      })
      await page.setContent('<div id="root"></div>')
      await page.evaluate(layout => { (window as any).savedLayout = layout }, savedLayout)
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      await expect.poll(() => page.locator('output').textContent()).toBe(expected)
      expect(writes).toEqual([])
      if (label) {
        await page.getByRole('button', { name: label, exact: true }).click()
        await expect.poll(() => page.locator('output').textContent()).toBe(next)
        await expect.poll(() => writes).toEqual([{ gitPanelLayout: next }])
      }
      expect((await new AppStateStore(statePath).read()).layout.projectWorkspaces).toEqual(projectWorkspaces)
      expect(errors).toEqual([])
      await page.close()
    }
  } finally {
    await browser.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)

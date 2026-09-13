import path from 'node:path'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('keeps independent file and Git instances through creation, moving, switching and closing', async () => {
  const mocks: Record<string, string> = {
    'workspace-editor-content': 'export const WorkspaceEditorContent=()=>null',
    'workspace-file-preview': 'export const WorkspaceFileRenderer=()=>null',
    'workspace-tree-panel': 'export const WorkspaceTreePanel=()=>null',
    'workbench-conversation-list': 'export const WorkbenchConversationList=()=>null',
  }
  const bundle = await build({ entryPoints: ['test/fixtures/workbench-panel-move.tsx'], bundle: true, write: false,
    platform: 'browser', format: 'iife', outfile: 'panels.js', alias: { '@': path.resolve('src') },
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.woff2': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl', '.wasm': 'dataurl' },
    plugins: [{ name: 'unrelated-editors', setup(builder) {
      builder.onResolve({ filter: /\/(workspace-editor-content|workspace-file-preview|workspace-tree-panel|workbench-conversation-list)$/ }, args => ({ path: args.path.split('/').pop()!, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }))
    } }],
  })
  const styles = await compile(await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1800, height: 800 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(6000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://127.0.0.1/__panels__', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/__panels__')
    const candidates = new Scanner({ sources: [{ base: path.resolve('src'), pattern: '**/*.{ts,tsx,css}', negated: false }] }).scan()
    await page.addStyleTag({ content: styles.build(candidates) })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    const identity = (id: string) => id.includes('://') ? id : `app://fixed/${id}`
    const panel = (side: string, id: string) => page.locator(`#workbench-${side} .workbench-panel-view:not([hidden])[data-panel-tab-id="${identity(id)}"]`)
    const tab = (side: string, id: string) => page.locator(`#workbench-${side} .file-tab[data-tab-id="${identity(id)}"]`)
    const move = async (side: string, id: string) => { await tab(side, id).hover(); await tab(side, id).locator('.file-tab-move').click() }
    const state = () => page.evaluate(() => (window as any).panelTest.inspect())
    const files = panel('left', 'files')
    await files.getByRole('searchbox', { name: '搜索文件' }).waitFor().catch(async error => {
      throw new Error(`${error.message}\n${JSON.stringify(errors)}\n${(await page.locator('body').innerText()).slice(0, 1500)}`)
    })
    await files.locator('[data-item-path="folder/"]').dblclick()
    await files.getByRole('button', { name: '后退', exact: true }).waitFor()
    await files.getByRole('searchbox', { name: '搜索文件' }).fill('note-0')
    await files.locator('[data-item-path="note-000.txt"]').click()
    await files.evaluate(node => {
      const test = (window as any).panelTest
      test.fileElement = node.querySelector('.workspace-file-system')
      const descendants = (root: Element | ShadowRoot): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('*')].flatMap(item => [item, ...(item.shadowRoot ? descendants(item.shadowRoot) : [])])
      test.fileScroll = descendants(node).find(item => item.scrollHeight > item.clientHeight + 100 && ['auto', 'scroll'].includes(getComputedStyle(item).overflowY))
      if (test.fileScroll) test.fileScroll.scrollTop = 240
    })
    await panel('right', 'peer-files').getByRole('searchbox', { name: '搜索文件' }).fill('peer search')
    await move('left', 'files')
    const movedFiles = panel('right', 'files')
    expect(await movedFiles.getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('note-0')
    expect(await movedFiles.evaluate(node => node.querySelector('.workspace-file-system') === (window as any).panelTest.fileElement)).toBe(true)
    expect(await movedFiles.getByRole('button', { name: '后退', exact: true }).isEnabled()).toBe(true)
    expect((await state()).panes.right.tabs.map((tab: any) => tab.id)).toEqual(['app://fixed/peer-git', 'app://fixed/peer-files', 'app://fixed/files'])
    expect((await state()).panes.left.tabs).toEqual([])
    expect(await page.locator('#workbench-left').getByRole('tab', { name: '开始', exact: true }).isVisible()).toBe(true)
    expect(await page.evaluate(() => !!document.activeElement?.closest('#workbench-right'))).toBe(true)
    expect(await page.evaluate(() => (window as any).panelTest.fileScroll?.scrollTop)).toBe(240)
    expect(await movedFiles.innerText()).toContain('已选择“note-000.txt”')
    await page.evaluate(() => (window as any).panelTest.activate('right', 'peer-files'))
    expect(await panel('right', 'peer-files').getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('peer search')
    await page.evaluate(() => (window as any).panelTest.activate('right', 'files'))
    // The older appendChild path must also preserve the same instance.
    await page.evaluate(() => document.querySelectorAll('.workbench-panel-host').forEach(host => Object.defineProperty(host, 'moveBefore', { value: undefined })))
    await move('right', 'files')
    expect(await panel('left', 'files').getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('note-0')
    expect(await page.evaluate(() => (window as any).panelTest.fileScroll?.scrollTop)).toBe(240)
    // Move a visited but inactive file tab, then revisit its retained search.
    await page.evaluate(() => (window as any).panelTest.open('left', 'git'))
    await panel('left', 'git').getByText('Commit 0', { exact: true }).waitFor()
    await move('left', 'files')
    expect((await state()).panes.left.activeTabId).toBe('app://fixed/git')
    expect(await movedFiles.getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('note-0')
    // Each project retains its own mounted browser, without adopting a peer's root.
    await page.evaluate(() => { const test = (window as any).panelTest; test.switchProject('other'); test.open('left', 'files') })
    await panel('left', 'files').getByRole('searchbox', { name: '搜索文件' }).fill('other search')
    await page.evaluate(() => (window as any).panelTest.switchProject('qa'))
    expect(await movedFiles.getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('note-0')
    await expect.poll(() => movedFiles.locator('[data-file-tree-virtualized-scroll]').evaluate(node => node.scrollTop)).toBe(240)
    expect(await movedFiles.getByRole('button', { name: '后退', exact: true }).isEnabled()).toBe(true)
    // The target's independently selected commit must survive the move as well.
    await page.evaluate(() => (window as any).panelTest.activate('right', 'peer-git'))
    await panel('right', 'peer-git').getByText('Commit 1', { exact: true }).click()
    await panel('right', 'peer-git').getByRole('heading', { name: 'Commit 1', exact: true }).waitFor()
    const git = panel('left', 'git')
    await git.getByPlaceholder('提交信息').fill('Unsubmitted commit draft')
    await git.getByText('Commit 0', { exact: true }).click()
    await git.getByText('history.txt', { exact: true }).waitFor()
    await git.evaluate(node => {
      const test = (window as any).panelTest
      test.gitElement = node.querySelector('.git-panel-history-shell')
      test.gitScroll = node.querySelector<HTMLElement>('.git-history-scroll [data-slot="scroll-area-viewport"]')
        ?? [...node.querySelectorAll<HTMLElement>('*')].find(item => item.scrollHeight > item.clientHeight + 100 && ['auto', 'scroll'].includes(getComputedStyle(item).overflowY))
      if (test.gitScroll) test.gitScroll.scrollTop = 200
      test.historyCount = test.history.length; test.detailCount = test.details.length
    })
    await move('left', 'git')
    const movedGit = panel('right', 'git')
    expect(await movedGit.evaluate(node => node.querySelector('.git-panel-history-shell') === (window as any).panelTest.gitElement)).toBe(true)
    expect(await movedGit.getByText('history.txt', { exact: true }).isVisible()).toBe(true)
    expect(await page.evaluate(() => (window as any).panelTest.gitScroll?.scrollTop)).toBe(200)
    expect(await page.evaluate(() => { const test = (window as any).panelTest; return [test.history.length, test.details.length] })).toEqual(
      await page.evaluate(() => { const test = (window as any).panelTest; return [test.historyCount, test.detailCount] }))
    await page.evaluate(() => (window as any).panelTest.activate('right', 'peer-git'))
    expect(await panel('right', 'peer-git').getByRole('heading', { name: 'Commit 1', exact: true }).isVisible()).toBe(true)
    await page.evaluate(() => (window as any).panelTest.activate('right', 'git'))
    await page.screenshot({ path: path.join(os.tmpdir(), 'aryn-moved-panels.png') })
    // Opening the selected commit's file follows the panel's new side.
    await movedGit.getByText('history.txt', { exact: true }).dblclick()
    await expect.poll(async () => (await state()).panes.right.tabs.some((tab: any) => tab.kind === 'document')).toBe(true)
    expect((await state()).panes.left.tabs.some((tab: any) => tab.kind === 'document')).toBe(false)
    await page.evaluate(() => (window as any).panelTest.activate('right', 'git'))
    await movedGit.locator('.git-history-scroll').hover()
    await page.mouse.wheel(0, -1000)
    await movedGit.getByText('工作树', { exact: true }).click()
    expect(await movedGit.getByPlaceholder('提交信息').inputValue()).toBe('Unsubmitted commit draft')
    // A non-default browser view and the selected file travel with the tab too.
    await page.evaluate(() => (window as any).panelTest.activate('right', 'files'))
    await movedFiles.getByRole('tab', { name: '图标视图' }).click()
    await move('right', 'files')
    expect(await files.getByRole('tab', { name: '图标视图' }).getAttribute('aria-selected')).toBe('true')
    expect(await files.getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('note-0')
    expect(await files.innerText()).toContain('已选择“note-000.txt”')
    await files.getByText('note-000.txt', { exact: true }).dblclick()
    await expect.poll(async () => (await state()).panes.left.tabs.some((tab: any) => tab.kind === 'document')).toBe(true)
    expect(await page.evaluate(() => (window as any).panelTest.opens.at(-1))).toEqual({ path: '/qa/folder/note-000.txt', root: '/qa' })
    // Closing and reopening creates a fresh view; moving never does.
    await tab('left', 'files').hover()
    await tab('left', 'files').locator('.file-tab-close').click()
    await page.evaluate(() => (window as any).panelTest.open('right', 'files'))
    expect(await panel('right', 'files').getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('')
    // The real + menu creates a fresh instance on every click, on either side.
    const create = async (side: 'left' | 'right', label: '文件' | '更改') => {
      const before = (await state()).panes[side].tabs.length
      await page.getByRole('button', { name: side === 'left' ? '左侧新建标签页' : '右侧新建标签页', exact: true }).click()
      await page.getByRole('menuitem', { name: label, exact: true }).click()
      const current = (await state()).panes[side]
      expect(current.tabs).toHaveLength(before + 1)
      expect(current.activeTabId).toBe(current.tabs.at(-1).id)
      return current.activeTabId as string
    }
    const firstFiles = await create('left', '文件')
    await panel('left', firstFiles).getByRole('searchbox', { name: '搜索文件' }).fill('first browser')
    const secondFiles = await create('left', '文件')
    expect(secondFiles).not.toBe(firstFiles)
    expect(await panel('left', secondFiles).getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('')
    await panel('left', secondFiles).getByRole('searchbox', { name: '搜索文件' }).fill('second browser')
    await page.evaluate(id => (window as any).panelTest.activate('left', id), firstFiles)
    expect(await panel('left', firstFiles).getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('first browser')
    await tab('left', firstFiles).getByRole('tab').focus()
    await tab('left', firstFiles).locator('.file-tab-move').focus()
    await page.keyboard.press('Enter')
    expect(await panel('right', firstFiles).getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('first browser')
    expect(await panel('left', secondFiles).getByRole('searchbox', { name: '搜索文件' }).inputValue()).toBe('second browser')
    await tab('left', secondFiles).hover()
    await tab('left', secondFiles).locator('.file-tab-close').click()
    expect((await state()).panes.right.tabs.some((tab: any) => tab.id === firstFiles)).toBe(true)
    const firstGit = await create('right', '更改')
    await panel('right', firstGit).getByText('Commit 0', { exact: true }).click()
    await panel('right', firstGit).getByRole('heading', { name: 'Commit 0', exact: true }).waitFor()
    const secondGit = await create('right', '更改')
    expect(secondGit).not.toBe(firstGit)
    await panel('right', secondGit).getByText('Commit 2', { exact: true }).click()
    await panel('right', secondGit).getByRole('heading', { name: 'Commit 2', exact: true }).waitFor()
    await page.evaluate(id => (window as any).panelTest.activate('right', id), firstGit)
    expect(await panel('right', firstGit).getByRole('heading', { name: 'Commit 0', exact: true }).isVisible()).toBe(true)
    await move('right', firstGit)
    expect(await panel('left', firstGit).getByRole('heading', { name: 'Commit 0', exact: true }).isVisible()).toBe(true)
    expect(await panel('right', secondGit).getByRole('heading', { name: 'Commit 2', exact: true }).isVisible()).toBe(true)
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 60000)

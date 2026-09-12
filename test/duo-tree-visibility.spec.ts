import path from 'node:path'
import { mkdir, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, expect, it } from 'vitest'

let browser: Browser
let script: string
let css: string

beforeAll(async () => {
  const bundle = await build({
    entryPoints: ['test/fixtures/duo-tree-visibility.tsx'],
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': path.resolve('src') },
    outfile: 'duo-tree-fixture.js',
    plugins: [{ name: 'unrelated-content-fixtures', setup(builder) {
      // Keep the actual Duo lists, navigation, rows, virtualizers and scroll areas.
      const fixtures: Record<string, string> = {
        'workspace-editor-content': 'export const WorkspaceEditorContent = () => null',
        'workspace-file-system-panel': 'export const WorkspaceFileSystemPanel = () => null',
        'duo-conversations': 'export const DuoConversationView = () => null',
      }
      builder.onResolve({ filter: /\/agent-sidebar\/agent-sidebar$/ },
        () => ({ path: path.resolve('test/fixtures/duo-sidebar-agent-provider.tsx') }))
      builder.onResolve({ filter: /\/(workspace-editor-content|workspace-file-system-panel|duo-conversations)$/ },
        (args) => ({ path: args.path.split('/').pop()!, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' },
        (args) => ({ contents: fixtures[args.path], resolveDir: process.cwd() }))
    } }],
  })
  script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text
  const styles = await compile(
    await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} },
  )
  css = styles.build([])
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => { await browser?.close() })

async function settleMeasurements(page: Page) {
  // Let ResizeObserver deliver hidden/visible sizes and React commit the resulting range.
  await page.evaluate(async () => {
    for (let frame = 0; frame < 4; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
}

async function setVisible(page: Page, visible: boolean) {
  await page.evaluate((next) => {
    (window as unknown as { setFixtureVisible: (value: boolean) => void }).setFixtureVisible(next)
  }, visible)
  await settleMeasurements(page)
}

async function mountSidebarFixture(page: Page, gitLayout = 'list') {
  page.setDefaultTimeout(4000)
  await page.route('https://aryn-fixture.invalid/agent-icons/*', async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname)
    await route.fulfill({ contentType: 'image/svg+xml', body: await readFile(path.join('public/agent-icons', file)) })
  })
  await page.setContent('<base href="https://aryn-fixture.invalid/"><div id="root"></div>')
  await page.evaluate((gitLayout) => Object.assign(window, {
    fixtureOptions: { initiallyHidden: false, fileCount: 9, gitLayout },
  }), gitLayout)
  await page.addStyleTag({ content: css })
  await page.addScriptTag({ content: script })
  await page.locator('#duo-left').waitFor()
  await settleMeasurements(page)
}

async function sidebarState(page: Page) {
  return page.evaluate(() => (window as any).getTreeFixtureState())
}

async function captureSidebar(page: Page, side: string, name: string) {
  const directory = process.env.ARYN_DUO_QA_SCREENSHOTS
  if (!directory) return
  await mkdir(directory, { recursive: true })
  await page.locator(`#duo-${side} .editor-directory-sidebar`).screenshot({ path: path.join(directory, `${name}-${side}.png`) })
}

it.each(['left', 'right'] as const)('opens conversation rows locally and across panes from the %s list', async (side) => {
  const page = await browser.newPage({ viewport: { width: 1760, height: 835 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message))
  try {
    await mountSidebarFixture(page)
    const other = side === 'left' ? 'right' : 'left'
    const label = side === 'left' ? '在右侧打开' : '在左侧打开'
    const sidebar = page.locator(`#duo-${side} .editor-directory-sidebar`)
    await sidebar.getByRole('tab', { name: '对话', exact: true }).click()
    const row = sidebar.locator('.app-item-row').filter({ has: page.locator('.app-item-label', { hasText: '测试对话' }) })
    const arrow = row.getByRole('button', { name: label, exact: true })
    await row.waitFor()
    expect(await arrow.isVisible()).toBe(false)
    await row.hover()
    await expect.poll(() => arrow.isVisible()).toBe(true)
    await captureSidebar(page, side, 'conversations-light')
    await arrow.click()
    await expect.poll(async () => (await sidebarState(page)).panes[other].tabs.length).toBe(1)
    expect((await sidebarState(page)).panes[side].tabs).toEqual([])
    await arrow.click()
    expect((await sidebarState(page)).panes[other].tabs).toHaveLength(1)
    await row.locator('.app-item-main').click()
    // A normal row click focuses the already-open conversation instead of
    // duplicating its live provider in the source pane.
    await expect.poll(async () => (await sidebarState(page)).focusedPane).toBe(other)
    expect((await sidebarState(page)).panes[side].tabs).toEqual([])
    expect((await sidebarState(page)).panes[other].tabs[0].projectSession.request).toMatchObject({
      kind: 'session', agentId: 'builtin-pi', sessionPath: '/qa/session-0.jsonl', sessionLabel: '测试对话',
    })

    const second = sidebar.locator('.app-item-row').filter({ has: page.locator('.app-item-label', { hasText: '第二个对话' }) })
    await page.mouse.move(850, 750)
    await second.locator('.app-item-main').focus()
    await page.keyboard.press('Tab')
    expect(await second.getByRole('button', { name: label }).evaluate(el => document.activeElement === el)).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await sidebarState(page)).panes[other].tabs.length).toBe(2)
    expect((await sidebarState(page)).panes[side].tabs).toHaveLength(0)

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await row.hover()
    await captureSidebar(page, side, 'conversations-dark')
    await row.getByRole('button', { name: /^Open .* menu$/ }).click()
    const rename = page.getByRole('menuitem', { name: '重命名', exact: true })
    await rename.waitFor()
    await rename.click()
    await sidebar.getByRole('textbox', { name: 'Rename conversation' }).waitFor()
    expect(await row.getByRole('button', { name: label }).count()).toBe(0)
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it.each([
  { side: 'left', layout: 'list' }, { side: 'right', layout: 'list' },
  { side: 'left', layout: 'tree' }, { side: 'right', layout: 'tree' },
])('opens working-tree and history diffs from the $side Git $layout', async ({ side, layout }) => {
  const page = await browser.newPage({ viewport: { width: 1760, height: 1000 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await mountSidebarFixture(page, layout)
    const other = side === 'left' ? 'right' : 'left'
    const label = side === 'left' ? '在右侧打开' : '在左侧打开'
    const sidebar = page.locator(`#duo-${side} .editor-directory-sidebar`)
    await sidebar.getByRole('tab', { name: '更改', exact: true }).click()
    const row = (file: string) => sidebar.locator('.app-item-row').filter({ has: page.locator('.app-item-label', { hasText: new RegExp(`^${file.replace('.', '\\.')}$`) }) })
    // Arrow opens the same diff as the primary row, including removed files.
    for (const [index, file] of ['staged.md', 'unstaged.md', 'deleted.md'].entries()) {
      const item = row(file)
      await item.hover()
      await item.getByRole('button', { name: label, exact: true }).click()
      await expect.poll(async () => (await sidebarState(page)).panes[other].tabs.length).toBe(index + 1)
      expect((await sidebarState(page)).panes[side].tabs).toHaveLength(index)
      await item.locator('.app-item-main').click()
      await expect.poll(async () => (await sidebarState(page)).panes[side].tabs.length).toBe(index + 1)
      expect((await sidebarState(page)).panes[side].activeTabId).toBe((await sidebarState(page)).panes[other].activeTabId)
    }
    expect((await sidebarState(page)).documents.every(tab => tab.kind === 'diff')).toBe(true)
    expect((await sidebarState(page)).reads).toContain('staged:/qa/staged.md')
    expect((await sidebarState(page)).reads).toContain('unstaged:/qa/deleted.md')
    await row('unstaged.md').hover()
    if (layout === 'list') await captureSidebar(page, side, 'changes-light')
    await row('unstaged.md').getByRole('button', { name: '暂存', exact: true }).click()
    await row('staged.md').hover()
    await row('staged.md').getByRole('button', { name: '取消暂存', exact: true }).click()
    expect((await sidebarState(page)).actions).toEqual([
      { kind: 'stage', paths: ['/qa/unstaged.md'] }, { kind: 'unstage', paths: ['/qa/staged.md'] },
    ])

    // The narrow sidebar expands commit files inline.
    await sidebar.locator('.app-item-row').filter({ has: page.locator('.app-item-label', { hasText: '测试提交' }) }).locator('.app-item-main').click()
    await row('history.md').waitFor()
    await page.mouse.move(850, 900)
    await row('history.md').locator('.app-item-main').focus()
    await page.keyboard.press('Tab')
    expect(await row('history.md').getByRole('button', { name: label }).evaluate(el => document.activeElement === el)).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await sidebarState(page)).panes[other].tabs.length).toBe(4)
    expect((await sidebarState(page)).reads).toContain('abcdef123:/qa/history.md')
    expect((await sidebarState(page)).panes[side].tabs).toHaveLength(3)
    await row('history.md').locator('.app-item-main').click()
    await expect.poll(async () => (await sidebarState(page)).panes[side].tabs.length).toBe(4)
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'))
    await row('history.md').hover()
    if (layout === 'list') await captureSidebar(page, side, 'history-dark')

    // Wide Git panels use a separate commit detail path, which must receive the same action.
    await sidebar.evaluate(el => (el as HTMLElement).style.flexBasis = '600px')
    await sidebar.locator('.git-history-pane').waitFor()
    await sidebar.locator('.git-history-pane .app-item-row').filter({ hasText: '测试提交' }).locator('.app-item-main').click()
    await row('history.md').hover()
    await row('history.md').getByRole('button', { name: label }).click()
    expect((await sidebarState(page)).panes[other].tabs).toHaveLength(4)
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it.each(['left', 'right'] as const)('opens a row locally and its arrow in the opposite pane from the %s tree', async (side) => {
  const page = await browser.newPage({ viewport: { width: 1760, height: 835 } })
  page.setDefaultTimeout(4000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="root"></div>')
    await page.evaluate(() => Object.assign(window, { fixtureOptions: { initiallyHidden: false, fileCount: 9 } }))
    await page.addStyleTag({ content: css })
    await page.addScriptTag({ content: script })
    const other = side === 'left' ? 'right' : 'left'
    const targetLabel = side === 'left' ? '在右侧打开' : '在左侧打开'
    const tree = page.locator(`#duo-${side} .workspace-tree-root`)
    const row = (name: string) => tree.locator('.app-item-row').filter({ has: page.locator('.app-item-label', { hasText: name }) })
    const arrow = row('file-0.md').getByRole('button', { name: targetLabel, exact: true })
    await tree.waitFor()
    await settleMeasurements(page)
    expect(await arrow.isVisible()).toBe(false)
    expect(await row('.agents').getByRole('button', { name: targetLabel }).count()).toBe(0)

    // Hover reveals the action, but does not open a file or shift the row label.
    const labelRect = await row('file-0.md').locator('.app-item-label').boundingBox()
    await row('file-0.md').hover()
    await expect.poll(() => arrow.isVisible()).toBe(true)
    expect(await row('file-0.md').locator('.app-item-label').boundingBox()).toEqual(labelRect)
    await arrow.click()
    await expect.poll(() => page.locator(`#duo-${other} .file-tab-label`).allTextContents()).toContain('file-0.md')
    expect(await page.locator(`#duo-${side} .file-tab-label`).allTextContents()).toEqual(['开始'])

    // Repeated clicks activate the same tab. A regular click adds it only locally.
    await arrow.click()
    await row('file-0.md').getByRole('button', { name: 'file-0.md', exact: true }).click()
    await expect.poll(() => page.locator(`#duo-${side} .file-tab-label`).allTextContents()).toContain('file-0.md')
    const loaded = await page.evaluate(() => (window as unknown as { getTreeFixtureState: () => {
      reads: string[]; documents: unknown[]; panes: Record<string, { tabs: unknown[] }>
    } }).getTreeFixtureState())
    expect(loaded.reads).toEqual(['/qa/file-0.md'])
    expect(loaded.documents).toHaveLength(1)
    expect(loaded.panes.left.tabs).toHaveLength(1)
    expect(loaded.panes.right.tabs).toHaveLength(1)

    // Keyboard users reveal the same action and can activate it with Enter.
    await page.mouse.move(900, 780)
    const nextFile = row('file-1.md').getByRole('button', { name: 'file-1.md', exact: true })
    await nextFile.focus()
    await page.keyboard.press('Tab')
    const nextArrow = row('file-1.md').getByRole('button', { name: targetLabel, exact: true })
    expect(await nextArrow.evaluate((element) => document.activeElement === element)).toBe(true)
    await page.keyboard.press('Enter')
    await expect.poll(() => page.locator(`#duo-${other} .file-tab-label`).allTextContents()).toContain('file-1.md')
    expect(await page.locator(`#duo-${side} .file-tab-label`).allTextContents()).toEqual(['file-0.md'])
    await row('file-0.md').hover()
    await row('file-0.md').getByRole('button', { name: 'File actions', exact: true }).click()
    await page.getByRole('menuitem', { name: '重命名', exact: true }).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

it.each([
  { initiallyHidden: false, fileCount: 9, tallRows: false },
  { initiallyHidden: true, fileCount: 9, tallRows: false },
  { initiallyHidden: false, fileCount: 150, tallRows: true },
])('restores both Duo trees after hiding ($initiallyHidden, files=$fileCount, measured=$tallRows)', async (options) => {
  const page = await browser.newPage({ viewport: { width: 1760, height: 835 } })
  page.setDefaultTimeout(4000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.setContent('<div id="root"></div>')
    await page.evaluate((value) => { Object.assign(window, { fixtureOptions: value }) }, options)
    await page.addStyleTag({ content: css })
    if (options.tallRows) {
      // Exercise real measurements that differ from the default 34px estimate.
      await page.addStyleTag({ content: '.workspace-tree-root .app-item-row { height: 48px; min-height: 48px; }' })
    }
    await page.addScriptTag({ content: script })
    await page.locator('#duo-left').waitFor({ state: 'attached' })
    await settleMeasurements(page)
    if (options.initiallyHidden) await setVisible(page, true)

    const trees = ['left', 'right'].map((side) => page.locator(`#duo-${side} .workspace-tree-root`))
    const labels = (tree: typeof trees[number]) => tree.locator('.app-item-label').allTextContents()
    const expected = ['.agents', '.codex', '.idea', '.obsidian', '.thinkrail', 'proto', 'specs',
      ...Array.from({ length: options.fileCount }, (_, i) => `file-${i}.md`)]
    for (const tree of trees) {
      await expect.poll(() => tree.locator('[data-index="0"]').count()).toBe(1)
      if (!options.tallRows) expect(await labels(tree)).toEqual(expected)
    }
    // Expansion is local to each pane and must survive layout switches too.
    await trees[0].getByRole('button', { name: '.agents', exact: true }).click()
    await settleMeasurements(page)
    expect(await labels(trees[0])).toContain('child.md')
    expect(await labels(trees[1])).not.toContain('child.md')

    const viewports = ['left', 'right'].map((side) => page.locator(`#duo-${side} .workspace-tree-scroll > .app-scroll-area-viewport`))
    if (options.tallRows) {
      await viewports[0].evaluate((element) => { element.scrollTop = 800 })
      await viewports[1].evaluate((element) => { element.scrollTop = 1400 })
      await settleMeasurements(page)
    }
    const before = await Promise.all(trees.map(labels))
    const offsets = await Promise.all(viewports.map((viewport) => viewport.evaluate((element) => element.scrollTop)))
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await setVisible(page, false)
      await setVisible(page, true)
      for (let index = 0; index < trees.length; index += 1) {
        await expect.poll(() => labels(trees[index])).toEqual(before[index])
        expect(await viewports[index].evaluate((element) => element.scrollTop)).toBe(offsets[index])
      }
    }
    // Rows must be in the viewport and clickable, not merely present in the DOM.
    if (options.tallRows) {
      await Promise.all(viewports.map((viewport) => viewport.evaluate((element) => { element.scrollTop = 0 })))
      await settleMeasurements(page)
    }
    await trees[0].getByRole('button', { name: '.agents', exact: true }).click()
    await settleMeasurements(page)
    expect(await labels(trees[0])).not.toContain('child.md')
    expect(await labels(trees[1])).not.toContain('child.md')
    expect(errors).toEqual([])
  } finally { await page.close() }
})

import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('moves the real conversation provider and composer without interrupting drafts, creation or streaming', async () => {
  const mocks: Record<string, string> = {
    'workspace-editor-content': 'export const WorkspaceEditorContent=()=>null',
    'workspace-file-system-panel': 'export const WorkspaceFileSystemPanel=()=>null',
    'workspace-navigation-panels': 'export const WorkspaceGitPane=()=>null; export const WorkspaceTreePane=()=>null; export const WorkspaceNavigationPanels=()=>null',
    'duo-conversation-list': 'export const DuoConversationList=()=>null',
    'bb-session-timeline': 'export const BbSessionTimeline=()=>null',
    'bb-session-surface-loader': 'export const getPreloadedBbSessionSurface=()=>({}); export const preloadBbSessionSurface=async()=>({})',
    'agent-sidebar': `import React from 'react';
      import {AgentProvider as RealProvider} from './src/features/agent/components/agent-sidebar/agent-sidebar.tsx';
      import {Probe} from './test/fixtures/duo-conversation-probe';
      export {AgentChatSurface} from './src/features/agent/components/agent-sidebar/agent-sidebar.tsx';
      export const AgentProvider=props=><RealProvider {...props}><Probe/>{props.children}</RealProvider>;`,
  }
  const bundle = await build({ entryPoints: ['test/fixtures/duo-conversation-move.tsx'], bundle: true, write: false,
    platform: 'browser', format: 'iife', outfile: 'move.js', alias: { '@': path.resolve('src') },
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.woff2': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl' },
    plugins: [{ name: 'unrelated-surfaces-and-provider-probe', setup(builder) {
      builder.onResolve({ filter: /\/(workspace-editor-content|workspace-file-system-panel|workspace-navigation-panels|duo-conversation-list|bb-session-timeline|bb-session-surface-loader|agent-sidebar)$/ }, args => ({ path: args.path.split('/').pop()!, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }))
    } }],
  })
  const styles = await compile(await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(8000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://127.0.0.1/__move__', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/__move__')
    await page.addStyleTag({ content: styles.build([]) })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    const editor = (side: string) => page.locator(`#duo-${side} .duo-conversation-view:not([hidden]) .agent-composer-editor`)
    const model = (side: string) => page.locator(`#duo-${side} .duo-conversation-view:not([hidden]) .agent-model-cascader-trigger`)
    const move = (side: string) => page.locator(`#duo-${side} .file-tab.is-active .file-tab-move`)
    const clickMove = async (side: string) => {
      await page.locator(`#duo-${side} .file-tab.is-active`).hover()
      await move(side).click()
    }
    const calls = () => page.evaluate(() => (window as any).calls)
    const layout = () => page.evaluate(() => (window as any).inspect())
    const read = (side: string) => page.evaluate(side => (window as any).read(side), side)
    const draft = 'Draft and attachment survive moving\n' + Array.from({ length: 60 }, (_, i) => `Unsent line ${i}`).join('\n')
    await editor('left').fill(draft)
    await expect.poll(() => model('left').isEnabled()).toBe(true)
    await expect.poll(() => page.evaluate(() => (window as any).workspaceState?.sessions?.[0]?.name)).toBe('Created')
    await model('left').click()
    await page.getByRole('searchbox', { name: 'Search models' }).fill('model-b')
    await page.getByRole('option', { name: /model-b/ }).click()
    await page.getByRole('button', { name: '附加文件', exact: true }).click()
    await page.getByText('notes.txt', { exact: true }).waitFor()
    const baseline = await calls()
    await editor('left').evaluate(node => {
      const app = window as any
      app.originalEditor = node
      const range = document.createRange()
      const text = node.firstChild!.firstChild ?? node.firstChild!
      range.setStart(text, 2); range.setEnd(text, 9)
      const selection = window.getSelection()!
      selection.removeAllRanges(); selection.addRange(range)
      app.selection = selection.toString()
      const viewport = node.closest('.agent-composer-text-shell') as HTMLElement
      viewport.scrollTop = 300
      app.scrollTop = viewport.scrollTop
    })
    // At under 520px per pane the arrow must still appear on hover and work.
    await page.locator('#duo-left .file-tab.is-active').hover()
    expect(await move('left').isVisible()).toBe(true)
    await clickMove('left')
    await expect.poll(() => editor('right').innerText()).toBe(draft)
    expect(await editor('right').evaluate(node => node === (window as any).originalEditor)).toBe(true)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(await page.evaluate(() => (window as any).selection))
    expect(await page.evaluate(() => document.activeElement === (window as any).originalEditor)).toBe(true)
    expect(await page.evaluate(() => (window as any).scrollTop)).toBeGreaterThan(0)
    expect(await editor('right').evaluate(node => (node.closest('.agent-composer-text-shell') as HTMLElement).scrollTop)).toBe(await page.evaluate(() => (window as any).scrollTop))
    expect(await model('right').innerText()).toContain('model-b')
    expect(await page.locator('#duo-right').getByText('notes.txt', { exact: true }).isVisible()).toBe(true)
    expect((await layout()).panes.left.tabs).toEqual([])
    await page.locator('#duo-left').getByRole('tab', { name: '开始', exact: true }).waitFor()
    expect(await calls()).toEqual(baseline)
    // Closing follows the destination guard; moving never asks to discard a draft.
    await page.evaluate(() => (window as any).close('right'))
    expect((await calls()).confirms).toBe(1)
    expect((await layout()).panes.right.activeTabId).toBe(await page.evaluate(() => (window as any).draftId))
    await move('right').focus(); await page.keyboard.press('Enter')
    await editor('left').waitFor()
    expect(await editor('left').evaluate(node => node === (window as any).originalEditor)).toBe(true)
    // Also exercise hosts without state-preserving moveBefore.
    await page.evaluate(() => {
      for (const host of document.querySelectorAll('.duo-conversation-host')) Object.defineProperty(host, 'moveBefore', { value: undefined })
      const app = window as any; app.moveNow('left'); app.moveNow('right'); app.moveNow('left')
    })
    expect(await editor('right').evaluate(node => node === (window as any).originalEditor)).toBe(true)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(await page.evaluate(() => (window as any).selection))
    // Move while native session creation is pending, then complete the same request.
    await page.locator('#duo-right button[type=submit]').click()
    await expect.poll(async () => (await calls()).creates.length).toBe(1)
    await clickMove('right')
    await page.evaluate(() => (window as any).finishCreate())
    await expect.poll(async () => (await calls()).prompts.length).toBe(1)
    await expect.poll(() => page.evaluate(() => (window as any).workspaceState?.activeSession?.sessionPath)).toBe('created')
    await expect.poll(async () => (await layout()).panes.left.tabs[0]?.projectSession?.request?.kind).toBe('session')
    expect((await layout()).panes.right.tabs.every((tab: any) => tab.kind !== 'conversation')).toBe(true)
    expect((await calls()).creates[0].options.modelKey).toBe('test/model-b')
    expect(JSON.stringify((await calls()).prompts)).toContain('notes.txt')
    const created = await calls()
    // Keep receiving stream deltas on the same runtime after each move.
    await page.evaluate(() => { const app = window as any; app.startStream(); app.stream('First chunk. ') })
    await expect.poll(async () => (await read('left'))?.assistant).toBe('First chunk. ')
    await clickMove('left')
    await page.evaluate(() => (window as any).stream('Second chunk.'))
    await expect.poll(async () => (await read('right'))?.assistant).toBe('First chunk. Second chunk.')
    const afterStream = await calls()
    for (const key of ['mounts', 'unmounts', 'loads', 'aborts', 'switches']) {
      expect(afterStream[key], key).toBe(baseline[key])
    }
    // Materialization legitimately subscribes to the new session ID once;
    // moving that running session must not resubscribe.
    expect(afterStream.subscriptions).toBe(created.subscriptions)
    expect(afterStream.unsubscribes).toBe(created.unsubscribes)
    await page.evaluate(() => (window as any).reopen('left'))
    expect((await layout()).panes.left.tabs).toEqual([])
    expect((await layout()).focusedPane).toBe('right')
    expect(await editor('right').evaluate(node => node === (window as any).originalEditor)).toBe(true)
    // A second composer survives being displaced in the destination.
    await page.evaluate(() => (window as any).openNew('left'))
    await editor('left').fill('Independent peer draft')
    const peerId = (await layout()).panes.left.activeTabId
    await clickMove('right')
    expect(await editor('left').evaluate(node => node === (window as any).originalEditor)).toBe(true)
    await page.evaluate(id => (window as any).activate('left', id), peerId)
    expect(await editor('left').innerText()).toBe('Independent peer draft')
    const originalId = await page.evaluate(() => (window as any).draftId)
    // The arrow belongs to its tab, including a tab that is not currently active.
    const inactive = page.locator('#duo-left .file-tab').filter({ has: page.locator('.file-tab-move') }).filter({ hasNot: page.locator('[aria-selected="true"]') })
    await inactive.hover()
    await inactive.locator('.file-tab-move').click()
    expect((await layout()).panes.left.activeTabId).toBe(peerId)
    expect(await editor('left').innerText()).toBe('Independent peer draft')
    // File links inside the moved provider route to its new pane and original CWD.
    await page.evaluate(() => (window as any).context('right').onOpenMessageFile('/qa/linked.txt', 'modified'))
    await expect.poll(async () => (await layout()).panes.right.tabs.some((tab: any) => tab.kind === 'document')).toBe(true)
    expect((await layout()).panes.left.tabs.every((tab: any) => tab.kind !== 'document')).toBe(true)
    expect((await calls()).files).toEqual([{ path: '/qa/linked.txt', root: '/qa' }])
    await page.evaluate(id => (window as any).activate('right', id), originalId)
    await editor('right').fill('Close guard on the destination')
    const beforeClose = await calls()
    await page.evaluate(() => { const app = window as any; app.allowClose = true; return app.close('right') })
    await expect.poll(() => editor('right').count()).toBe(0)
    expect((await calls()).confirms).toBe(beforeClose.confirms + 1)
    expect((await calls()).unmounts).toBe(beforeClose.unmounts + 1)
    expect(await editor('left').innerText()).toBe('Independent peer draft')
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 60000)

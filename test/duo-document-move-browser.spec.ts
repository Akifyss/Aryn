import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('moves actual editors, preserves drafts and view state, deduplicates and transfers keyboard focus', async () => {
  // Real editors and pane chrome; unrelated panels, workers and asset loading are isolated.
  const mocks: Record<string, string> = {
    'workspace-file-system-panel': 'export const WorkspaceFileSystemPanel=()=>null',
    'workspace-navigation-panels': 'export const WorkspaceTreePane=()=>null; export const WorkspaceGitPane=()=>null; export const WorkspaceNavigationPanels=()=>null',
    'duo-conversation-list': 'export const DuoConversationList=()=>null',
    'duo-conversations': 'export const DuoConversationView=()=>null',
  }
  const bundle = await build({ entryPoints:['test/fixtures/duo-document-move.tsx'], bundle:true, write:false,
    platform:'browser', format:'iife', outfile:'move.js', alias:{'@':path.resolve('src')},
    define:{'process.env.NODE_ENV':'"development"', 'import.meta.env.DEV':'false', 'import.meta.url':'"http://127.0.0.1/fixture.js"'},
    loader:{'.ttf':'dataurl','.woff':'dataurl','.woff2':'dataurl','.png':'dataurl','.svg':'dataurl'},
    plugins:[{name:'fixture-assets',setup(builder){
      builder.onResolve({filter:/\/(workspace-file-system-panel|workspace-navigation-panels|duo-conversation-list|duo-conversations)$/},args=>({path:args.path.split('/').pop()!,namespace:'fixture'}))
      builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:process.cwd()}))
      builder.onLoad({filter:/src[\\/]index\.css$/},()=>({contents:'',loader:'css'}))
      builder.onResolve({filter:/\?worker$/},args=>({path:args.path,namespace:'worker'}))
      builder.onLoad({filter:/.*/,namespace:'worker'},()=>({contents:'export default class extends Worker { constructor(){super(URL.createObjectURL(new Blob(["self.onmessage=()=>{}"],{type:"text/javascript"})))} }',loader:'js'}))
      builder.onResolve({filter:/\?url$/},args=>({path:args.path,namespace:'url'}))
      builder.onLoad({filter:/.*/,namespace:'url'},()=>({contents:'export default "data:text/javascript,export{}"',loader:'js'}))
    }}],
  })
  const styles=await compile(await readFile('src/index.css','utf8')+'\n'+bundle.outputFiles.find(file=>file.path.endsWith('.css'))!.text,
    {base:path.resolve('src'),onDependency:()=>{}})
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1600, height: 850 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(8000)
    const errors: string[] = []
    page.on('pageerror', error => {
      // Stub language workers leave word-highlight requests pending at teardown.
      if (error.message === 'Canceled' && error.stack?.includes('WordHighlighter')) return
      errors.push(error.message)
    })
    await page.route('http://127.0.0.1/__move__', route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}))
    await page.goto('http://127.0.0.1/__move__')
    await page.addStyleTag({content:styles.build([])})
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js'))!.text})
    const clickMove = async (side: string) => {
      const tab = page.locator(`#duo-${side} .file-tab.is-active`)
      await tab.hover()
      await tab.locator('.file-tab-move').click()
    }
    await page.locator('#duo-left .cm-content').waitFor()
    await page.evaluate(() => {
      const app = window as any, view = app.cm('left')
      view.dispatch({ changes: { from: 0, insert: 'unsaved ' }, selection: { anchor: 25, head: 40 } })
      view.scrollDOM.scrollTop = 500
      app.staleRequests()
    })
    const before = await page.evaluate(() => (window as any).cmSnapshot('left'))
    await clickMove('left')
    await page.locator('#duo-right .cm-content').waitFor()
    await expect.poll(() => page.evaluate(() => (window as any).cmSnapshot('right').ranges)).toEqual(before.ranges)
    await expect.poll(() => page.evaluate(() => Math.abs((window as any).cmSnapshot('right').scrollTop - 500))).toBeLessThan(3)
    expect(await page.locator('#duo-left').getByRole('tab', { name: '开始', exact: true }).count()).toBe(1)
    expect(await page.evaluate(() => !!document.activeElement?.closest('#duo-right'))).toBe(true)
    await page.evaluate(() => { const app = window as any; app.lateLeft('late'); app.lateRight('late') })
    const state = await page.evaluate(() => (window as any).inspect())
    expect(state.panes.left.tabs).toEqual([])
    expect(state.panes.right.tabs.map((t: { id: string }) => t.id)).toEqual(['app://fixed/files', state.documents[0].id])
    expect(state.documents[0].content).toMatch(/^unsaved /)
    expect(state.documents[0].isDirty).toBe(true)
    expect(await page.evaluate(() => (window as any).closeCalls)).toBe(0)

    // Keyboard activation returns the same document; repeated movement does not lose its selection.
    const back = page.locator('#duo-right .file-tab.is-active .file-tab-move')
    await back.focus(); await page.keyboard.press('Enter')
    await page.locator('#duo-left .cm-content').waitFor()
    await expect.poll(() => page.evaluate(() => (window as any).cmSnapshot('left').ranges)).toEqual(before.ranges)

    // A peer already showing this document must adopt the source view, not keep its old cursor.
    await page.evaluate(() => (window as any).setup('meo', true))
    await page.locator('#duo-right .cm-content').waitFor()
    await page.evaluate(() => {
      const app = window as any
      app.cm('right').dispatch({ selection: { anchor: 1 } })
      app.cm('left').dispatch({ selection: { anchor: 65, head: 90 } })
    })
    await clickMove('left')
    await expect.poll(() => page.evaluate(() => (window as any).cmSnapshot('right').ranges.ranges)).toEqual([{ anchor: 65, head: 90 }])
    expect(await page.evaluate(() => (window as any).inspect().panes.right.tabs.length)).toBe(2)

    await page.evaluate(() => (window as any).setup('code'))
    await page.locator('#duo-left .monaco-editor').waitFor()
    await expect.poll(() => page.evaluate(() => !!(window as any).code('left'))).toBe(true)
    await page.evaluate(() => {
      const editor = (window as any).code('left')
      editor.executeEdits('test', [{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: 'unsaved ' }])
      editor.setSelection({ startLineNumber: 28, startColumn: 2, endLineNumber: 29, endColumn: 4 })
      editor.setScrollTop(400)
    })
    const codeBefore = await page.evaluate(() => (window as any).code('left').saveViewState())
    await clickMove('left')
    await page.locator('#duo-right .monaco-editor').waitFor()
    await expect.poll(() => page.evaluate(() => (window as any).code('right')?.saveViewState()?.cursorState)).toEqual(codeBefore.cursorState)
    expect(await page.evaluate(() => (window as any).inspect().documents[0].content)).toMatch(/^unsaved /)
    expect(await page.evaluate(() => !!document.activeElement?.closest('#duo-right'))).toBe(true)
    // Move back and forth before Monaco's asynchronous peer mount can finish.
    await page.evaluate(() => { const app = window as any; app.moveNow('right'); app.moveNow('left') })
    await expect.poll(() => page.evaluate(() => (window as any).code('right')?.saveViewState()?.cursorState)).toEqual(codeBefore.cursorState)
    // Both editors use the same Monaco URI/model. Disposing the source must not break the peer.
    await page.evaluate(() => (window as any).setup('code', true))
    await expect.poll(() => page.evaluate(() => !!(window as any).code('left') && !!(window as any).code('right'))).toBe(true)
    await page.evaluate(() => (window as any).code('left').setPosition({ lineNumber: 42, column: 3 }))
    await clickMove('left')
    await expect.poll(() => page.evaluate(() => (window as any).code('right')?.getPosition())).toEqual({ lineNumber: 42, column: 3 })
    await page.keyboard.type('peer still editable ')
    expect(await page.evaluate(() => (window as any).code('right').getValue())).toContain('peer still editable ')
    expect(await page.evaluate(() => (window as any).inspect().panes.right.tabs.length)).toBe(2)

    await page.evaluate(() => (window as any).setup('meo-diff'))
    await expect.poll(() => page.evaluate(() => !!(window as any).cm('left'))).toBe(true)
    await page.evaluate(() => (window as any).cm('left').focus())
    await page.evaluate(() => (window as any).cm('left').dispatch({ changes: { from: 0, insert: 'diff draft ' }, selection: { anchor: 65, head: 90 } }))
    await clickMove('left')
    await page.locator('#duo-right .cm-content').waitFor()
    await expect.poll(() => page.evaluate(() => (window as any).cmSnapshot('right').ranges.ranges)).toEqual([{ anchor: 65, head: 90 }])

    await page.evaluate(() => (window as any).setup('diff'))
    await expect.poll(() => page.evaluate(() => (window as any).diff()?.getText()), { timeout: 8000 }).toMatch(/^Line /)
    await page.evaluate(() => {
      const editor = (window as any).diff()
      editor.applyEdits([{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'diff draft ' }])
      editor.setSelections([{ start: { line: 25, character: 2 }, end: { line: 26, character: 4 }, direction: 1 }])
      document.querySelector('#duo-left .git-diff-pierre-viewport')!.scrollTop = 400
    })
    const diffBefore = await page.evaluate(() => (window as any).diff().getState())
    await clickMove('left')
    await expect.poll(() => page.evaluate(() => (window as any).diff()?.getState().selections), { timeout: 8000 }).toEqual(diffBefore.selections)
    await expect.poll(() => page.evaluate(() => document.querySelector('#duo-right .git-diff-pierre-viewport')?.scrollTop)).toBe(400)
    expect(await page.evaluate(() => (window as any).diff().getText())).toMatch(/^diff draft /)
    expect(await page.evaluate(() => !!document.activeElement?.closest('#duo-right'))).toBe(true)

    await page.evaluate(() => (window as any).setup('history'))
    await page.locator('#duo-left diffs-container').waitFor()
    await expect.poll(() => page.evaluate(() => {
      const viewport = document.querySelector('#duo-left .git-diff-pierre-viewport')!
      viewport.scrollTop = 400
      return viewport.scrollTop
    })).toBe(400)
    const historyBefore = await page.evaluate(() => (window as any).inspect().documents[0])
    await clickMove('left')
    await expect.poll(() => page.evaluate(() => document.querySelector('#duo-right .git-diff-pierre-viewport')?.scrollTop)).toBe(400)
    expect(await page.evaluate(() => (window as any).inspect().documents[0])).toEqual(historyBefore)
    expect(await page.evaluate(() => (window as any).diffEditors.size)).toBe(0)
    expect(await page.evaluate(() => (window as any).closeCalls)).toBe(0)
    expect(errors).toEqual([])
  } finally { await browser?.close() }
}, 120000)

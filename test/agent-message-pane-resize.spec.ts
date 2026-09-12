import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('settles pinned messages after pane resizing without moving a reader of older messages', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'
      import { createRoot } from 'react-dom/client'
      import { AppScrollArea } from './src/components/app-scroll-area'
      import { useAgentMessageViewportScroll } from './src/features/agent/components/agent-message-viewport/use-agent-message-viewport-scroll'
      const revisions = { assistantDraft:'', fileChanges:'', liveTools:[], renderedMessageCount:1, sessionStatus:'idle', thinkingDraft:'' }
      function App() {
        const { messagesScrollViewportRef } = useAgentMessageViewportScroll({ activeSessionPath:null, contentRevisions:revisions })
        return <div className='app-shell' data-resizing='false'>
          <AppScrollArea className='agent-messages-scroll' viewportClassName='messages'
            rootStyle={{width:400,height:240}} viewportProps={{style:{height:240,overflow:'auto',overflowAnchor:'none'}}}
            viewportRef={messagesScrollViewportRef} contentClassName='agent-messages-scroll-content'>
            <div style={{height:1500}}>Message history</div>
          </AppScrollArea>
        </div>
      }
      window.settleFrames = async () => { for (let i=0;i<4;i++) await new Promise(requestAnimationFrame) }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', outfile: 'resize.js',
    define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': path.resolve('src') },
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    const viewport = page.locator('.messages')
    const gap = () => viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)
    await viewport.waitFor()
    await page.evaluate(() => (window as any).settleFrames())
    expect(await gap()).toBe(0)
    await page.evaluate(async () => {
      document.querySelector('.app-shell')!.setAttribute('data-resizing', 'true')
      document.querySelector<HTMLElement>('.messages')!.style.height = '160px'
      await (window as any).settleFrames()
    })
    expect(await gap()).toBe(80)
    await page.locator('.app-shell').evaluate(element => element.setAttribute('data-resizing', 'false'))
    await expect.poll(gap).toBe(0)

    await viewport.evaluate(async element => {
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -500 }))
      element.scrollTop = 100
      await (window as any).settleFrames()
      document.querySelector('.app-shell')!.setAttribute('data-resizing', 'true')
      ;(element as HTMLElement).style.height = '120px'
      await (window as any).settleFrames()
      document.querySelector('.app-shell')!.setAttribute('data-resizing', 'false')
      await (window as any).settleFrames()
    })
    expect(await viewport.evaluate(element => element.scrollTop)).toBe(100)
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 20_000)

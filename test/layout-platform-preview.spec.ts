import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it.each([true, false])('provides temporary, reactive layout preview only in development (dev=%s)', async development => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react'
      import {createRoot} from 'react-dom/client'
      import {useShellLayoutController} from './src/features/layout/hooks/use-shell-layout-controller'
      import {AppTitlebar} from './src/components/app-titlebar'
      import './src/features/layout/components/app-shell/styles.css'
      import './src/features/duo/styles.css'
      const listeners = new Set()
      window.calls={native:0,writes:[],project:0}
      window.nativeFullScreen=false
      window.sendWindowState=full=>{window.nativeFullScreen=full;listeners.forEach(fn=>fn({isFullScreen:full,isMaximized:false}))}
      window.appApi={platform:'win32',onWindowStateChanged:fn=>{listeners.add(fn);return ()=>listeners.delete(fn)},
        isWindowMaximized:async()=>({isMaximized:false,isFullScreen:window.nativeFullScreen}),
        minimizeWindow:async()=>{window.calls.native++},toggleMaximizeWindow:async()=>{window.calls.native++;return {isMaximized:false}},
        closeWindow:async()=>{window.calls.native++},updateLayoutState:async patch=>{window.calls.writes.push(patch);return {ok:true}}}
      function App() {
        const layout=useShellLayoutController({platform:window.appApi.platform,gitPanelLayout:'list',isAgentLayout:true,shouldExposeRightSidebar:true})
        return <div ref={layout.appShellRef} className='app-shell duo-shell' data-app-layout='duo'
          data-platform={layout.shellPlatform} data-window-fullscreen={layout.isWindowFullScreen} style={layout.shellChromeVars}>
          <input aria-label='草稿' style={{marginTop:100}} />
          <AppTitlebar leftControls={<div className='left-chrome-actions'><button onClick={()=>window.calls.project++}>项目</button></div>} />
        </div>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', outfile: 'preview.js',
    alias: { '@': path.resolve('src') }, define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': String(development) },
  })
  const compiled = await compile(await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 } })
    page.setDefaultTimeout(3000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://127.0.0.1/**', route => {
      const url = new URL(route.request().url())
      return route.fulfill(url.pathname === '/preview.js'
        ? { contentType: 'text/javascript', body: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text }
        : url.pathname === '/preview.css' ? { contentType: 'text/css', body: compiled.build([]) }
          : { contentType: 'text/html', body: '<link rel="stylesheet" href="/preview.css"><div id="root"></div><script src="/preview.js"></script>' })
    })
    await page.goto('http://127.0.0.1/')
    await page.getByRole('textbox', {name:'草稿'}).fill('keep this draft')
    await page.evaluate(() => { (window as any).initialInput = document.querySelector('input') })
    const leftEdge = () => page.locator('.left-chrome-actions').evaluate(element => element.getBoundingClientRect().left)
    expect(await leftEdge()).toBe(6)
    if (!development) {
      expect(await page.evaluate(() => typeof window.arynLayoutPreview)).toBe('undefined')
      expect(await page.locator('[data-platform-preview]').count()).toBe(0)
    } else {
      const preview = (mode: 'macos' | 'macos-fullscreen' | 'windows' | 'system') => page.evaluate(mode => window.arynLayoutPreview!(mode), mode)
      await expect.poll(() => page.evaluate(() => (window as any).calls.writes.length)).toBe(1)
      await preview('macos')
      await expect.poll(leftEdge).toBe(84)
      expect(await page.getByRole('img', {name:'macOS 红绿灯占位（布局预览）'}).count()).toBe(1)
      expect(await page.getByRole('button', {name:'Minimize window'}).count()).toBe(0)
      await page.getByRole('button', {name:'项目',exact:true}).click()
      await preview('macos-fullscreen')
      await expect.poll(leftEdge).toBe(6)
      expect(await page.locator('.titlebar-preview-traffic-lights').count()).toBe(0)
      await page.getByRole('button', {name:'项目',exact:true}).click()
      await preview('windows')
      await page.getByRole('button', {name:'Minimize window'}).waitFor()
      expect(await page.locator('.app-shell').getAttribute('data-platform')).toBe('windows')
      expect(await page.evaluate(() => window.appApi.platform)).toBe('win32')
      expect(await page.evaluate(() => document.querySelector('input') === (window as any).initialInput)).toBe(true)
      expect(await page.getByRole('textbox', {name:'草稿'}).inputValue()).toBe('keep this draft')
      await preview('macos')
      await page.evaluate(() => (window as any).sendWindowState(true))
      expect(await page.locator('.app-shell').getAttribute('data-window-fullscreen')).toBe('false')
      await preview('system')
      await expect.poll(() => page.locator('.app-shell').getAttribute('data-window-fullscreen')).toBe('true')
      expect(await page.evaluate(() => (window as any).calls)).toMatchObject({native:0,project:2})
      expect(await page.evaluate(() => (window as any).calls.writes.length)).toBe(1)
      await preview('macos')
      await page.reload()
      await page.waitForFunction(() => typeof window.arynLayoutPreview === 'function')
      expect(await page.evaluate(() => window.arynLayoutPreview!().mode)).toBe('system')
      expect(await leftEdge()).toBe(6)
    }
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 20000)

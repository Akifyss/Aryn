import path from 'node:path'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'

async function checkCorners(page: Page, name: string) {
  const samples = await page.evaluate(() => {
    const points: { x: number; y: number; inside: boolean; hitContent: boolean }[] = []
    for (const frame of document.querySelectorAll<HTMLElement>('.editor-frame')) {
      const bounds = frame.getBoundingClientRect()
      const content = frame.querySelector<HTMLElement>('.editor-content-shell')!
      const contentTop = content.getBoundingClientRect().top
      const outline = frame.querySelector<SVGPathElement>('.file-tabs-boundary-outline')!
      for (const x of [Math.ceil(bounds.left) + 1, Math.floor(bounds.right) - 2]) {
        for (const y of [Math.ceil(contentTop) + 1, Math.floor(bounds.bottom) - 2]) {
          points.push({ x, y, inside: outline.isPointInFill(new DOMPoint(x + 0.5 - bounds.left, y + 0.5 - bounds.top)),
            hitContent: content.contains(document.elementFromPoint(x + 0.5, y + 0.5)) })
        }
      }
    }
    return points
  })
  const screenshot = await page.screenshot({ path: path.join(os.tmpdir(), `aryn-pane-corners-${name}.png`), scale: 'css' })
  const pixels = await page.evaluate(async ({ data, samples }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const rgb = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data].slice(0, 3)
    return { backdrop: rgb(1, 100), corners: samples.map(({ x, y }) => rgb(x, y)) }
  }, { data: screenshot.toString('base64'), samples })
  const outside = samples.map((sample, index) => ({ ...sample, color: pixels.corners[index] })).filter(sample => !sample.inside)
  expect(outside.length).toBeGreaterThanOrEqual(6)
  for (const corner of outside) {
    expect(corner.color, `${name}: outside corner ${corner.x},${corner.y}`).toEqual(pixels.backdrop)
    expect(corner.hitContent, `${name}: clipped corner must not receive content clicks`).toBe(false)
  }
}

it('clips both pane surfaces to the tab outline across tab selection, themes and resizing', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react'
      import {createRoot} from 'react-dom/client'
      import {FileTabs} from './src/features/workspace/components/file-tabs/file-tabs'
      import {WorkspaceEditorSurface} from './src/features/workspace/components/workspace-editor-surface/workspace-editor-surface'
      import './src/features/layout/components/app-shell/styles.css'
      import './src/features/duo/styles.css'
      const tabs = ['file', 'git'].map(kind => ({id:kind,kind:'fixed-panel',fixedTabKind:kind==='file'?'file-panel':'git-panel',closable:true}))
      function Pane({side}) {
        const [active, setActive] = useState('git')
        const [items, setItems] = useState(tabs)
        return <section id={'duo-'+side} className='duo-pane'>
          <WorkspaceEditorSurface contentPanelId={side+'-content'} tabs={<FileTabs contentPanelId={side+'-content'}
            activeTabId={active} tabs={items} iconTheme={null} workspacePath='/test' onActivate={setActive}
            onClose={id=>setItems(items.filter(item=>item.id!==id))} onMoveTab={()=>{}} />}>
            <div style={{flex:1,background:'var(--background-primary)',display:'grid',placeItems:'center'}}>
              <input aria-label={side+' input'} />
            </div>
          </WorkspaceEditorSurface>
        </section>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode>
        <div className='app-shell duo-shell' data-app-layout='duo' style={{'--left-panel-toggle-anchor':'6px','--duo-left-controls-width':'80px'}}>
          <div className='duo-panes' style={{'--duo-left-ratio':'50%'}}><Pane side='left'/><div className='duo-separator'/><Pane side='right'/></div>
        </div>
      </React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', outfile: 'corners.js',
    alias: { '@': path.resolve('src') }, define: { 'process.env.NODE_ENV': '"development"' },
  })
  const styles = await compile(await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 800 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: styles.build([]) })
    // Exclude the separate shadow from pixel sampling; this checks the surface underneath it.
    await page.addStyleTag({ content: '.file-tabs-boundary-shadow-layer { visibility: hidden; }' })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    await page.locator('#duo-right .file-tabs-boundary-outline').waitFor({ state: 'attached' })
    await checkCorners(page, 'light-interior-tab')
    for (const side of ['left', 'right']) {
      await page.locator('#duo-'+side).getByRole('tab', {name:'文件',exact:true}).click()
      await page.getByRole('textbox', {name:side+' input'}).fill('still interactive')
    }
    await checkCorners(page, 'light-first-tab')
    await page.locator('html').evaluate(element => element.classList.add('dark'))
    await page.setViewportSize({ width: 1100, height: 650 })
    await expect.poll(() => page.locator('#duo-right .editor-frame').evaluate(frame =>
      Number(frame.querySelector('.file-tabs-boundary-outline-layer')?.getAttribute('width')) === frame.getBoundingClientRect().width,
    )).toBe(true)
    await checkCorners(page, 'dark-resized')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    const animation = await page.locator('#duo-right').evaluate(async pane => {
      const snapshots: { outline: string | null; clip: string | null }[] = []
      const tab = [...pane.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.textContent === '更改')!
      tab.click()
      for (let i = 0; i < 24; i++) {
        await new Promise(requestAnimationFrame)
        snapshots.push({ outline: pane.querySelector('.file-tabs-boundary-outline')?.getAttribute('d') ?? null,
          clip: pane.querySelector('clipPath path')?.getAttribute('d') ?? null })
      }
      return snapshots
    })
    expect(new Set(animation.map(frame => frame.outline)).size).toBeGreaterThan(2)
    for (const frame of animation) expect(frame.clip).toBe(`${frame.outline} Z`)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const label of ['文件', '更改']) {
      await page.locator('#duo-right').getByRole('tab', { name: label, exact: true }).hover()
      await page.locator('#duo-right').getByRole('button', { name: `Close ${label}`, exact: true }).click()
    }
    await page.locator('#duo-right .file-tabs-shell[data-empty="true"]').waitFor()
    await checkCorners(page, 'dark-empty-rail')
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 20000)

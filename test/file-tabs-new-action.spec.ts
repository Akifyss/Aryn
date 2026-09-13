import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium, type Locator } from 'playwright'
import { expect, it } from 'vitest'

async function geometry(pane: Locator) {
  return pane.evaluate(node => {
    const scroller = node.querySelector<HTMLElement>('.file-tabs-scroller')!
    const viewport = scroller.getBoundingClientRect()
    const action = node.querySelector<HTMLElement>('.file-tabs-new-action')!
    const button = action.querySelector('button')!
    const buttonBounds = button.getBoundingClientRect()
    const active = node.querySelector('.file-tab.is-active')?.getBoundingClientRect()
    const spacer = node.querySelector<HTMLElement>('.file-tabs-drag-spacer')!
    const y = buttonBounds.top + buttonBounds.height / 2
    return {
      bodyGap: active ? buttonBounds.left - active.right : null,
      viewportGap: buttonBounds.left - viewport.right,
      overflowing: scroller.scrollWidth > scroller.clientWidth + 1,
      scrollLeft: scroller.scrollLeft,
      spacerWidth: spacer.getBoundingClientRect().width,
      minSpacerWidth: parseFloat(getComputedStyle(spacer).minWidth),
      edgeBlocked: [1, 4, 7].some(offset => action.contains(document.elementFromPoint(viewport.right - offset, y))),
      buttonReachable: button.contains(document.elementFromPoint(buttonBounds.left + 1, y)),
      edgeX: viewport.right - 4,
      edgeY: y,
    }
  })
}

it('keeps the new-tab gap stable without covering scrolling tabs or wasting title space', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react'
      import {createRoot} from 'react-dom/client'
      import {AppMenu as Menu} from './src/components/app-menu'
      import {FileTabs} from './src/features/workspace/components/file-tabs/file-tabs'
      import {WorkspaceEditorSurface} from './src/features/workspace/components/workspace-editor-surface/workspace-editor-surface'
      import './src/features/layout/components/app-shell/styles.css'
      import './src/features/workbench/styles.css'
      const tab = (id, title) => ({id, title, kind:'conversation', conversationId:null, exists:true, isDirty:false})
      function Pane({side}) {
        const [tabs, setTabs] = useState([tab('short', '新对话')])
        const [active, setActive] = useState('short')
        const [showAction, setShowAction] = useState(true)
        window['hideAction'+side] = () => setShowAction(false)
        window['setTabs'+side] = count => {
          const items = Array.from({length:count}, (_,i)=>tab('tab-'+i, 'Long conversation title '+i))
          setTabs(items); setActive(items.at(-1)?.id ?? null)
        }
        return <section id={'workbench-'+side} className='workbench-pane'>
          <WorkspaceEditorSurface contentPanelId={side+'-content'} tabs={<FileTabs
            contentPanelId={side+'-content'} tabs={tabs} activeTabId={active}
            iconTheme={null} workspacePath='/qa' onActivate={setActive} onClose={()=>{}} onMoveTab={()=>{}}
            newTabAction={showAction && <Menu.Root>
              <Menu.Trigger variant='icon' aria-label={side+' new tab'}>+</Menu.Trigger>
              <Menu.Portal><Menu.Positioner><Menu.Popup>
                <Menu.Item label='New conversation' onClick={()=>{}} />
              </Menu.Popup></Menu.Positioner></Menu.Portal>
            </Menu.Root>} />}><div>Content</div></WorkspaceEditorSurface>
        </section>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode>
        <div className='app-shell' style={{'--left-panel-toggle-anchor':'6px','--workbench-left-controls-width':'80px'}}>
          <div className='workbench-panes' style={{'--workbench-left-ratio':'50%'}}>
            <Pane side='left'/><div className='workbench-separator'/><Pane side='right'/>
          </div>
        </div>
      </React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', outfile: 'new-tab.js',
    alias: { '@': path.resolve('src') }, define: { 'process.env.NODE_ENV': '"development"' },
  })
  const styles = await compile(await readFile('src/index.css', 'utf8') + '\n'
    + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text,
  { base: path.resolve('src'), onDependency: () => {} })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 600 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: styles.build([]) })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    const setTabs = async (side: string, count: number) => {
      await page.evaluate(({ side, count }) => (window as any)['setTabs'+side](count), { side, count })
      await expect.poll(() => page.locator('#workbench-'+side+' .file-tab').count()).toBe(count)
    }
    for (const side of ['left', 'right']) {
      const pane = page.locator('#workbench-'+side)
      await expect.poll(async () => (await geometry(pane)).bodyGap).toBe(6)
      expect((await geometry(pane)).overflowing).toBe(false)
      await setTabs(side, 8)
    }
    for (const width of [1400, 1000]) {
      await page.setViewportSize({ width, height: 600 })
      for (const side of ['left', 'right']) {
        const pane = page.locator('#workbench-'+side)
        await pane.locator('.file-tab').last().getByRole('tab').focus()
        await page.keyboard.press('Enter')
        for (const edge of ['start', 'end']) {
          await pane.locator('.file-tabs-scroller').evaluate((scroller, edge) => {
            scroller.scrollLeft = edge === 'start' ? 0 : scroller.scrollWidth
          }, edge)
          await expect.poll(async () => {
            const value = await geometry(pane)
            return [value.bodyGap, value.viewportGap, value.overflowing, value.edgeBlocked, value.buttonReachable]
          }).toEqual([6, 6, true, false, true])
        }
        // With the selection at the left, an inactive tab crosses the right
        // viewport edge. Its fading tail must still receive mouse and wheel input.
        await pane.locator('.file-tab').first().getByRole('tab').focus()
        await page.keyboard.press('Enter')
        await pane.locator('.file-tabs-scroller').evaluate(scroller => { scroller.scrollLeft = 100 })
        await expect.poll(async () => (await geometry(pane)).edgeBlocked).toBe(false)
        const before = await geometry(pane)
        await page.mouse.move(before.edgeX, before.edgeY)
        await page.mouse.wheel(0, 40)
        await expect.poll(async () => (await geometry(pane)).scrollLeft).toBeGreaterThan(before.scrollLeft)
        await pane.getByRole('button', { name: side+' new tab', exact: true }).click()
        await page.getByRole('menu').waitFor()
        await page.keyboard.press('Escape')
      }
    }
    // A single long title should use all the space up to the reserved drag
    // handle. Counting the decorative shoulder again wastes another 8px here.
    await page.setViewportSize({ width: 660, height: 600 })
    for (const side of ['left', 'right']) {
      const pane = page.locator('#workbench-'+side)
      await setTabs(side, 1)
      await expect.poll(async () => {
        const value = await geometry(pane)
        return value.spacerWidth - value.minSpacerWidth
      }).toBe(0)
      expect((await geometry(pane)).bodyGap).toBe(6)
      expect((await geometry(pane)).overflowing).toBe(false)
      await setTabs(side, 0)
      await expect.poll(async () => (await geometry(pane)).viewportGap).toBe(6)
      expect((await geometry(pane)).buttonReachable).toBe(true)
      await pane.getByRole('button', { name: side+' new tab', exact: true }).click()
      await page.getByRole('menu').waitFor()
      await page.keyboard.press('Escape')
    }
    // Crossing the exact-fit threshold must not move the button relative to
    // the tab body or introduce a feedback loop in overflow detection.
    await page.setViewportSize({ width: 1100, height: 600 })
    const left = page.locator('#workbench-left')
    await setTabs('left', 2)
    await expect.poll(async () => (await geometry(left)).overflowing).toBe(false)
    const fit = await geometry(left)
    const threshold = 1100 - 2 * (fit.spacerWidth - fit.minSpacerWidth)
    for (const extra of [4, -4, 4]) {
      await page.setViewportSize({ width: threshold + extra, height: 600 })
      await expect.poll(async () => {
        const value = await geometry(left)
        return [value.bodyGap, value.viewportGap, value.overflowing]
      }).toEqual([6, 6, extra < 0])
    }
    // The shared component retains its original trailing room when the
    // workbench does not provide a new-tab action.
    const right = page.locator('#workbench-right')
    await page.evaluate(() => (window as any).hideActionright())
    await expect.poll(() => right.locator('.file-tabs-new-action').count()).toBe(0)
    await setTabs('right', 8)
    await expect.poll(() => right.evaluate(node => {
      const viewport = node.querySelector('.file-tabs-scroller')!.getBoundingClientRect()
      const tab = node.querySelector('.file-tab.is-active')!.getBoundingClientRect()
      return viewport.right - tab.right
    })).toBe(8)
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 20000)

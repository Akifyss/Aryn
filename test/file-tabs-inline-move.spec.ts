import path from 'node:path'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('keeps tabs and actions reachable across overflow, resizing and list changes', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react'
    import {createRoot} from 'react-dom/client'
    import {FileTabs} from './src/features/workspace/components/file-tabs/file-tabs'
    import {reorderWorkspaceTabs} from './src/features/workspace/store/use-workspace-store'
    import {WorkspaceEditorSurface} from './src/features/workspace/components/workspace-editor-surface/workspace-editor-surface'
    import './src/features/layout/components/app-shell/styles.css'
    import './src/features/workbench/styles.css'
    const base={kind:'conversation',conversationId:null,exists:true,isDirty:false}
    const tabs=[{...base,id:'short',title:'新对话'},
      {...base,id:'greeting',title:'Greeting'},
      {...base,id:'long',title:'A long conversation title 用于检查标题与按钮之间的渐变和间距'},
      {id:'dirty',kind:'file',filePath:'/qa/Unsaved.md',exists:true,isDirty:true,editorKind:'prose',content:'draft'},
      {id:'files',kind:'fixed-panel',fixedTabKind:'file-panel',closable:true,exists:true,isDirty:false}]
    window.calls={moves:[],activations:[],closes:[]}
    function App(){const [active,setActive]=useState('short');const [items,setItems]=useState(tabs);window.activate=setActive;window.remove=id=>setItems(items=>items.filter(tab=>tab.id!==id));window.insert=()=>setItems(items=>[{...base,id:'inserted',title:'Inserted'},...items]);window.onlyLong=()=>{setItems(tabs.filter(tab=>tab.id==='long'));setActive('long')};return <div className='app-shell'><section className='workbench-pane' style={{flex:1}}>
      <WorkspaceEditorSurface contentPanelId='content' tabs={<FileTabs tabs={items} activeTabId={active} iconTheme={null} workspacePath='/qa'
        otherPaneAction={{direction:'right',onMove:id=>window.calls.moves.push(id)}}
        onActivate={id=>{window.calls.activations.push(id);setActive(id)}} onClose={id=>window.calls.closes.push(id)} onMoveTab={(moving,target,position)=>setItems(items=>reorderWorkspaceTabs(items,moving,target,position))} />}>
        <div style={{padding:24}}>Tab interaction fixture</div>
      </WorkspaceEditorSurface></section></div>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
  ` }, bundle: true, write: false, outfile: 'tabs.js', platform: 'browser', format: 'iife',
    alias: { '@': path.resolve('src') }, define: { 'process.env.NODE_ENV': '"development"' } })
  const styles = await compile(await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 260 }, reducedMotion: 'reduce' })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent('<div id="root"></div>')
    await page.addStyleTag({ content: styles.build([]) })
    await page.addScriptTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text })
    const tab = (id: string) => page.locator(`.file-tab[data-tab-id="${id}"]`)
    const checkActiveBoundary = async (id: string) => {
      const bounds = await tab(id).evaluate(node => {
        const outer = node.getBoundingClientRect()
        const trigger = node.querySelector('[role="tab"]')!.getBoundingClientRect()
        const outline = node.closest('.editor-frame')!.querySelector<SVGPathElement>('.file-tabs-boundary-outline')!
        const transform = outline.getScreenCTM()!.inverse()
        return {
          outerWidth: outer.width, triggerWidth: trigger.width,
          controlsInside: [...node.querySelectorAll('.file-tab-actions button')].map(button => {
            const rect = button.getBoundingClientRect()
            return [rect.left + 1, rect.right - 1].every(x => [rect.top + 1, rect.bottom - 1].every(y =>
              outline.isPointInFill(new DOMPoint(x, y).matrixTransform(transform))))
          }),
        }
      })
      expect(bounds.triggerWidth, 'The indicator must measure the full tab, including its reserved action space').toBe(bounds.outerWidth)
      expect(bounds.controlsInside, 'Both action buttons must be inside the visible tab outline').toEqual([true, true])
    }
    const checkBorderPaint = async (id: string) => {
      const rect = await tab(id).boundingBox()
      // A fading tooltip may overlap the lower edge; sample the tab paint only.
      const tooltips = await page.addStyleTag({ content: '.app-tooltip { display: none !important; }' })
      const visible = await page.screenshot({ scale: 'css', path: path.join(os.tmpdir(), 'aryn-tab-border-visible.png') })
      const hidden = await page.addStyleTag({ content: '.file-tab-actions { visibility: hidden !important; }' })
      const withoutActions = await page.screenshot({ scale: 'css', path: path.join(os.tmpdir(), 'aryn-tab-border-hidden.png') })
      await hidden.evaluate(node => node.remove())
      await tooltips.evaluate(node => node.remove())
      const changedPixels = await page.evaluate(async ({ visible, withoutActions, rect }) => {
        const pixels = async (data: string) => {
          const image = new Image()
          image.src = `data:image/png;base64,${data}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width; canvas.height = image.height
          const context = canvas.getContext('2d')!
          context.drawImage(image, 0, 0)
          return context.getImageData(0, 0, image.width, image.height)
        }
        const [withActions, baseline] = await Promise.all([pixels(visible), pixels(withoutActions)])
        let changed = 0
        // Neither the hover surface nor its fade may cover the outline or the
        // keyboard focus ring along the top/bottom edges, including the corners.
        const rows = [0, 1, 2].flatMap(offset => [Math.floor(rect.y) + offset, Math.ceil(rect.y + rect.height) - 1 - offset])
        for (const y of rows) for (let x = Math.ceil(rect.x); x < Math.floor(rect.x + rect.width); x++) {
          const start = (y * baseline.width + x) * 4
          if ([0, 1, 2].some(channel => withActions.data[start + channel] !== baseline.data[start + channel])) changed++
        }
        return changed
      }, { visible: visible.toString('base64'), withoutActions: withoutActions.toString('base64'), rect: rect! })
      expect(changedPixels, 'Action backgrounds must leave the tab outline and focus ring intact').toBe(0)
    }
    const geometry = (id: string) => tab(id).evaluate(node => {
      const title = node.querySelector('.file-tab-label')!.getBoundingClientRect()
      const actions = node.querySelector('.file-tab-actions') as HTMLElement
      const buttons = Array.from(actions.querySelectorAll('button')).map(button => button.getBoundingClientRect())
      const rect = actions.getBoundingClientRect()
      const fade = getComputedStyle(actions, '::before')
      return { width: node.getBoundingClientRect().width, titleWidth: title.width, titleRight: title.right,
        buttonSizes: buttons.map(button => [button.width, button.height]),
        iconSizes: Array.from(actions.querySelectorAll('button > svg')).map(icon => {
          const bounds = icon.getBoundingClientRect(); return [bounds.width, bounds.height]
        }),
        iconRight: node.querySelector('.file-tab-leading-icon')?.getBoundingClientRect().right ?? 0,
        actionsLeft: rect.left, fadeLeft: rect.left + parseFloat(fade.left), fadeWidth: parseFloat(fade.width),
        fade: fade.backgroundImage, surface: getComputedStyle(actions).getPropertyValue('--file-tab-actions-surface').trim(),
        opacity: getComputedStyle(actions).opacity, moveRight: buttons[0].right, closeLeft: buttons[1]?.left }
    })
    await tab('short').waitFor()
    await page.locator('.file-tabs-boundary-outline').waitFor({ state: 'attached' })
    await page.screenshot({ path: path.join(os.tmpdir(), 'aryn-inline-tab-boundary.png') })
    await checkActiveBoundary('short')
    expect((await geometry('short')).opacity).toBe('0')
    for (const id of ['short', 'greeting']) {
      expect((await geometry(id)).width).toBeLessThan(140)
    }
    expect((await geometry('long')).opacity).toBe('0')
    expect(await tab('files').locator('.file-tab-move').count()).toBe(1)
    expect(await page.locator('.file-tabs-actions .file-tab-move').count()).toBe(0)
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((node, theme) => node.classList.toggle('dark', theme === 'dark'), theme)
      for (const id of ['short', 'greeting', 'long']) {
        await page.mouse.click(900, 200)
        const before = await geometry(id)
        expect(before.opacity).toBe('0')
        await tab(id).hover()
        const after = await geometry(id)
        expect(after.width).toBe(before.width)
        expect(after.titleWidth).toBe(before.titleWidth)
        expect(after.opacity).toBe('1')
        expect(after.buttonSizes).toEqual([[24, 24], [24, 24]])
        expect(after.iconSizes).toEqual([[16, 16], [16, 16]])
        expect(after.fadeWidth).toBe(16)
        // At the minimum tab width, the fade still clears the leading icon.
        expect(after.fadeLeft).toBeGreaterThanOrEqual(after.iconRight + 2)
        expect(after.titleRight).toBeGreaterThan(after.actionsLeft)
        expect(after.closeLeft - after.moveRight).toBe(2)
        expect(after.fade).toContain('linear-gradient(to right')
      }
      // A mouse click selects the tab but must not keep its actions visible
      // after the pointer leaves. Keyboard navigation still exposes both.
      await tab('short').getByRole('tab').click({ position: { x: 12, y: 16 } })
      await page.mouse.move(900, 200)
      expect((await geometry('short')).opacity).toBe('0')
      await page.keyboard.press('Tab')
      expect(await tab('short').locator('.file-tab-move').evaluate(node => node === document.activeElement)).toBe(true)
      expect((await geometry('short')).opacity).toBe('1')
      await tab('long').locator('.file-tab-move').focus()
      await page.mouse.move(900, 200)
      expect((await geometry('long')).opacity).toBe('1')
      await page.keyboard.press('Enter')
      expect(await page.evaluate(() => (window as any).calls.moves.at(-1))).toBe('long')
      expect(await tab('short').getAttribute('data-active')).toBe('true')
      await tab('short').getByRole('tab').focus()
      await page.mouse.move(900, 200)
      await checkBorderPaint('short')
      expect(await tab('dirty').locator('.file-tab-move').evaluate(node => getComputedStyle(node).opacity)).toBe('0')
      expect(await tab('dirty').locator('.file-tab-dirty-indicator').evaluate(node => getComputedStyle(node).opacity)).toBe('1')
      await tab('dirty').hover()
      expect(await tab('dirty').locator('.file-tab-move').evaluate(node => getComputedStyle(node).opacity)).toBe('1')
      await tab('dirty').getByRole('tab').click({ position: { x: 12, y: 16 } })
      await page.mouse.move(900, 200)
      expect(await tab('dirty').locator('.file-tab-move').evaluate(node => getComputedStyle(node).opacity)).toBe('0')
      expect(await tab('dirty').locator('.file-tab-close svg').evaluate(node => getComputedStyle(node).opacity)).toBe('0')
      expect(await tab('dirty').locator('.file-tab-dirty-indicator').evaluate(node => getComputedStyle(node).opacity)).toBe('1')
      await page.keyboard.press('Tab')
      expect(await tab('dirty').locator('.file-tab-move').evaluate(node => node === document.activeElement)).toBe(true)
      expect(await tab('dirty').locator('.file-tab-move').evaluate(node => getComputedStyle(node).opacity)).toBe('1')
      await tab('short').getByRole('tab').click({ position: { x: 12, y: 16 } })
      await page.mouse.move(900, 200)
      await page.screenshot({ path: path.join(os.tmpdir(), `aryn-inline-tab-idle-${theme}.png`) })
      // The compact tab's center is over the move action; hover its title area
      // to exercise the full-title tooltip rather than the action tooltip.
      await tab('short').getByRole('tab').hover({ position: { x: 32, y: 16 } })
      await checkBorderPaint('short')
      await page.locator('.app-tooltip').filter({ hasText: /^新对话$/ }).waitFor({ state: 'visible' })
      await tab('long').hover()
      await checkActiveBoundary('short')
      await page.screenshot({ path: path.join(os.tmpdir(), `aryn-inline-tab-actions-${theme}.png`) })
    }
    await page.setViewportSize({ width: 320, height: 260 })
    await page.evaluate(() => (window as any).activate('long'))
    await tab('long').hover()
    await expect.poll(() => tab('long').locator('.file-tab-move').evaluate(node => {
      const rect = node.getBoundingClientRect(); return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node.querySelector('svg')
        || node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBe(true)
    expect((await geometry('long')).width).toBeLessThanOrEqual(224)
    await checkActiveBoundary('long')
    await page.screenshot({ path: path.join(os.tmpdir(), 'aryn-inline-tab-actions-narrow.png') })
    await tab('long').locator('.file-tab-move').click()
    await tab('long').locator('.file-tab-close').click()
    expect(await page.evaluate(() => (window as any).calls.closes)).toEqual(['long'])
    await page.locator('.file-tabs-scroller').evaluate(node => node.setAttribute('data-dragging', 'true'))
    expect((await geometry('long')).opacity).toBe('0')
    await page.locator('.file-tabs-scroller').evaluate(node => node.removeAttribute('data-dragging'))
    const order = await page.locator('.file-tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('data-tab-id')))
    for (const theme of ['light', 'dark']) {
      await page.locator('html').evaluate((node, theme) => node.classList.toggle('dark', theme === 'dark'), theme)
      for (const width of [320, 220]) {
        await page.setViewportSize({ width, height: 260 })
        for (const id of ['short', 'long', 'files']) {
          await page.evaluate(id => (window as any).activate(id), id)
          for (const position of [0, 0.5, 1]) {
            await page.locator('.file-tabs-scroller').evaluate((node, position) => {
              node.scrollLeft = (node.scrollWidth - node.clientWidth) * position
            }, position)
            await expect.poll(() => tab(id).evaluate(active => {
              const viewport = active.closest('.file-tabs-scroller')!.getBoundingClientRect()
              const rect = active.getBoundingClientRect()
              const style = getComputedStyle(active)
              const fill = active.closest('.editor-frame')!.querySelector('.file-tabs-boundary-active-fill')!.getBoundingClientRect()
              const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
              return rect.left >= viewport.left - 0.5 && rect.right <= viewport.right + 0.5
                && fill.left <= rect.left + 0.5 && fill.left >= rect.left - 16
                && fill.right >= rect.right - 0.5 && fill.right <= rect.right + 16
                && style.maskImage === 'none' && style.clipPath === 'none'
                && hit?.closest('.file-tab') === active
            })).toBe(true)
            await checkActiveBoundary(id)
            expect(await page.locator('.file-tab:not(.is-active)').evaluateAll(tabs => tabs.some(tab =>
              getComputedStyle(tab).maskImage.includes('linear-gradient'),
            ))).toBe(true)
          }
          await tab(id).hover({ position: {x:12,y:16} })
          expect((await geometry(id)).opacity).toBe('1')
          expect(await page.locator('.file-tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('data-tab-id')))).toEqual(order)
        }
        await page.locator('.file-tabs-scroller').evaluate(node => { node.scrollLeft = 0 })
        await page.locator('.file-tabs-shell').screenshot({ path: path.join(os.tmpdir(), 'aryn-tabs-sticky-'+theme+'-'+width+'.png') })
      }
    }
    // A narrow pane inside a wide window must leave another tab reachable,
    // even when the selected title could otherwise consume the entire rail.
    await page.setViewportSize({ width: 1600, height: 260 })
    await page.locator('.workbench-pane').evaluate(node => { node.style.width = '260px' })
    await page.evaluate(() => (window as any).activate('long'))
    await page.locator('.file-tabs-scroller').evaluate(node => { node.scrollLeft = 0 })
    await expect.poll(() => tab('long').evaluate(active => {
      const viewport = active.closest('.file-tabs-scroller')!.getBoundingClientRect()
      return active.getBoundingClientRect().left - viewport.left
    }), 'A sticky long title must leave room to select a neighboring tab').toBeGreaterThanOrEqual(108)
    await checkActiveBoundary('long')
    await page.locator('.file-tabs-scroller').evaluate(node => {
      node.scrollLeft = node.querySelector<HTMLElement>('[data-tab-id="greeting"]')!.offsetLeft
    })
    await tab('greeting').getByRole('tab').click({ position: { x: 20, y: 16 } })
    await expect.poll(() => tab('greeting').getAttribute('data-active')).toBe('true')
    await page.locator('.file-tabs-shell').screenshot({ path: path.join(os.tmpdir(), 'aryn-tabs-narrow-pane-wide-window.png') })
    expect(await page.locator('.file-tab').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('data-tab-id')))).toEqual(order)
    // Shift+Tab must not enter an inactive action hidden behind the sticky tab.
    await page.evaluate(() => (window as any).activate('files'))
    await tab('files').getByRole('tab').focus()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => page.evaluate(() => {
      const focused = document.activeElement!
      if (!focused.closest('.file-tab')) return true
      const rect = focused.getBoundingClientRect()
      return focused.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2))
    }), 'Keyboard focus must not disappear under the sticky selection').toBe(true)
    await page.locator('.workbench-pane').evaluate(node => { node.style.width = '' })
    // With enough space there is no clipping, fading or change in tab order.
    await page.setViewportSize({ width: 1600, height: 260 })
    await expect.poll(() => page.locator('.file-tab').evaluateAll(tabs => tabs.every(tab =>
      getComputedStyle(tab).maskImage === 'none' && getComputedStyle(tab).clipPath === 'none',
    ))).toBe(true)
    // Auto-scrolling under the same drag target must move its insertion marker.
    await page.setViewportSize({ width: 320, height: 260 })
    await page.evaluate(() => (window as any).activate('files'))
    await page.locator('.file-tabs-scroller').evaluate(node => { node.scrollLeft = 200 })
    const scrollDrag = await page.evaluateHandle(() => new DataTransfer())
    await tab('files').getByRole('tab').dispatchEvent('dragstart', { dataTransfer: scrollDrag })
    expect(await page.locator('body > .file-tab').evaluate(preview =>
      preview.inert && preview.getAttribute('aria-hidden') === 'true'
        && getComputedStyle(preview).clipPath === 'none' && getComputedStyle(preview).maskImage === 'none',
    )).toBe(true)
    for (let step = 0; step < 2; step++) {
      await tab('long').locator('.file-tab-leading-icon').dispatchEvent('dragover', { dataTransfer: scrollDrag, clientX: 40, clientY: 20 })
      await expect.poll(() => page.locator('.file-tabs-shell').evaluate(shell => {
        const marker = shell.querySelector('.file-tabs-drop-indicator')!.getBoundingClientRect()
        const target = shell.querySelector('[data-tab-id="long"]')!.getBoundingClientRect()
        return Math.abs(marker.left + marker.width / 2 - target.left)
      }), 'The drag marker must follow the target while scrolling').toBeLessThan(1)
    }
    await tab('files').getByRole('tab').dispatchEvent('dragend', { dataTransfer: scrollDrag })
    await scrollDrag.dispose()
    await page.setViewportSize({ width: 1600, height: 260 })
    // Reorder both an inactive tab and the sticky selection through the real
    // HTML drag handlers. Mask ownership must follow DOM order after the move.
    const dragTab = async (id: string, targetSelector: string) => {
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await tab(id).getByRole('tab').dispatchEvent('dragstart', {dataTransfer:transfer})
      const target = page.locator(targetSelector)
      const box = await target.boundingBox()
      const event = {dataTransfer:transfer,clientX:box!.x+4,clientY:box!.y+20}
      await target.dispatchEvent('dragover', event)
      await target.dispatchEvent('drop', event)
      await tab(id).getByRole('tab').dispatchEvent('dragend', {dataTransfer:transfer})
      await transfer.dispose()
    }
    const greetingTrigger = await tab('greeting').getByRole('tab').elementHandle()
    await dragTab('greeting', '.file-tab[data-tab-id="short"]')
    await expect.poll(() => page.locator('.file-tab').first().getAttribute('data-tab-id')).toBe('greeting')
    await expect.poll(() => tab('greeting').getAttribute('data-active')).toBe('true')
    await dragTab('greeting', '.file-tabs-drag-spacer')
    await expect.poll(() => page.locator('.file-tab').last().getAttribute('data-tab-id')).toBe('greeting')
    expect(await greetingTrigger!.evaluate(node => node === document.querySelector('.file-tabs-list [data-tab-id="greeting"] [role="tab"]'))).toBe(true)
    await greetingTrigger!.dispose()
    await page.setViewportSize({width:320,height:260})
    await page.locator('.file-tabs-scroller').evaluate(node => {node.scrollLeft=0})
    await expect.poll(() => tab('greeting').evaluate(active => {
      const rect=active.getBoundingClientRect(), viewport=active.closest('.file-tabs-scroller')!.getBoundingClientRect()
      return rect.left>=viewport.left && rect.right<=viewport.right && getComputedStyle(active).maskImage==='none'
    })).toBe(true)
    // Keyboard navigation transfers visibility to the newly selected tab.
    await tab('greeting').getByRole('tab').focus()
    await page.keyboard.press('Home')
    await expect.poll(() => tab('short').getAttribute('data-active')).toBe('true')
    for (const id of ['long', 'dirty', 'files', 'greeting']) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => tab(id).getAttribute('data-active')).toBe('true')
    }
    await page.keyboard.press('Home')
    await expect.poll(() => tab('short').getAttribute('data-active')).toBe('true')
    await page.keyboard.press('End')
    await expect.poll(() => tab('greeting').getAttribute('data-active')).toBe('true')
    // Closing another tab while the selected trigger keeps focus must update
    // its roving index too, not just the special drag/drop path.
    await page.evaluate(() => (window as any).remove('short'))
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => tab('files').getAttribute('data-active')).toBe('true')
    await page.evaluate(() => (window as any).insert())
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => tab('dirty').getAttribute('data-active')).toBe('true')
    await page.keyboard.press('Control+ArrowRight')
    expect(await tab('dirty').getAttribute('data-active')).toBe('true')
    await page.keyboard.press('End')
    await expect.poll(() => tab('greeting').getAttribute('data-active')).toBe('true')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => tab('inserted').getAttribute('data-active')).toBe('true')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => tab('greeting').getAttribute('data-active')).toBe('true')
    expect(await page.locator('.file-tabs-list [role="tab"][tabindex="0"]').count()).toBe(1)
    // A single long title grows back after narrowing; current content width
    // must not become a permanent maximum for subsequent window sizes.
    await page.evaluate(() => (window as any).onlyLong())
    await page.setViewportSize({width:1000,height:260})
    await expect.poll(async () => (await geometry('long')).width).toBe(224)
    await page.setViewportSize({width:220,height:260})
    await expect.poll(async () => (await geometry('long')).width).toBeLessThan(220)
    await page.setViewportSize({width:1000,height:260})
    await expect.poll(async () => (await geometry('long')).width).toBe(224)
    expect(errors).toEqual([])
  } finally { await browser.close() }
})

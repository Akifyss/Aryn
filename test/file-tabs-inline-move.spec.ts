import path from 'node:path'
import os from 'node:os'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('keeps compact tabs stable and reveals inline actions only on hover or keyboard focus', async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
    import React,{useState} from 'react'
    import {createRoot} from 'react-dom/client'
    import {FileTabs} from './src/features/workspace/components/file-tabs/file-tabs'
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
    function App(){const [active,setActive]=useState('short');window.activate=setActive;return <div className='app-shell'><section className='workbench-pane' style={{flex:1}}>
      <WorkspaceEditorSurface contentPanelId='content' tabs={<FileTabs tabs={tabs} activeTabId={active} iconTheme={null} workspacePath='/qa'
        otherPaneAction={{direction:'right',onMove:id=>window.calls.moves.push(id)}}
        onActivate={id=>{window.calls.activations.push(id);setActive(id)}} onClose={id=>window.calls.closes.push(id)} onMoveTab={()=>{}} />}>
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
        expect(after.fadeWidth).toBe(16)
        // At the compact 96px minimum, the fade still clears the leading icon.
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
    expect(errors).toEqual([])
  } finally { await browser.close() }
})

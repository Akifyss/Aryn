import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('fills the pane without phantom gaps before and after terminal styles load', async () => {
  const [surfaceStyles, workbenchStyles, terminalStyles] = await Promise.all([
    readFile('src/features/workspace/components/workspace-editor-surface/styles.css', 'utf8'),
    readFile('src/features/workbench/styles.css', 'utf8'),
    readFile('src/features/terminal/styles.css', 'utf8'),
  ])
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    for (const width of [360, 900]) {
      for (const side of ['none', 'left', 'right']) {
        const directory = `<aside class="editor-directory-sidebar" data-side="${side}">Directory</aside>`
        await page.setContent(`<style>
          :root { --file-tabs-frame-gap: 6px; --workspace-surface-radius: 8px; }
          * { box-sizing: border-box; } body { margin: 0; }
          ${surfaceStyles}\n${workbenchStyles}
        </style>
        <section class="workbench-pane" style="width:${width}px;height:400px">
          <div class="editor-frame"><div class="editor-content-shell">
            ${side === 'left' ? directory : ''}
            <div class="workbench-panel-host"><div class="workbench-panel-view">Changes</div></div>
            <div class="workbench-conversation-host"></div>
            <div class="workbench-terminal-host"></div>
            ${side === 'right' ? directory : ''}
          </div></div>
        </section>`)

        const checkBounds = async (selector: string) => {
          const bounds = await page.evaluate(({ selector, side }) => {
            const shell = document.querySelector('.editor-content-shell')!.getBoundingClientRect()
            const content = document.querySelector(selector)!.getBoundingClientRect()
            const sidebar = document.querySelector('.editor-directory-sidebar')?.getBoundingClientRect()
            return {
              start: content.left - (side === 'left' ? sidebar!.right : shell.left),
              end: (side === 'right' ? sidebar!.left : shell.right) - content.right,
              height: content.height - shell.height,
            }
          }, { selector, side })
          expect(bounds.start).toBeCloseTo(side === 'left' ? 6 : 0)
          expect(bounds.end).toBeCloseTo(side === 'right' ? 6 : 0)
          expect(bounds.height).toBeCloseTo(0)
        }

        // A cold start has an empty terminal host, without terminal CSS loaded.
        await checkBounds('.workbench-panel-view')
        await page.evaluate(() => {
          const terminal = document.createElement('div')
          terminal.className = 'workbench-terminal-view'
          terminal.hidden = true
          document.querySelector('.workbench-terminal-host')!.appendChild(terminal)
        })

        for (const loaded of [false, true]) {
          if (loaded) await page.addStyleTag({ content: terminalStyles })
          await checkBounds('.workbench-panel-view')
          // The portal must fill the same space even while lazy content is pending.
          await page.evaluate(() => {
            document.querySelector<HTMLElement>('.workbench-panel-view')!.hidden = true
            document.querySelector<HTMLElement>('.workbench-terminal-view')!.hidden = false
          })
          await checkBounds('.workbench-terminal-view')
          await page.evaluate(() => {
            document.querySelector<HTMLElement>('.workbench-panel-view')!.hidden = false
            document.querySelector<HTMLElement>('.workbench-terminal-view')!.hidden = true
          })
          await checkBounds('.workbench-panel-view')
        }
      }
    }
  } finally {
    await browser.close()
  }
})

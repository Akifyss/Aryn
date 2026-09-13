import { build } from 'esbuild'
import { readFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('keeps the space below the final terminal row on the app background across sizes and themes', async () => {
  const bundle = await build({ stdin: { contents: `
    import { Terminal } from '@xterm/xterm';
    const terminal = new Terminal({ cols: 60, rows: 24, fontSize: 13, lineHeight: 1.3,
      theme: { background: '#ffffff', foreground: '#20242c' } });
    terminal.open(document.querySelector('.terminal-viewport'));
    terminal.write('PS C:\\\\QA> ');
    window.terminalQA = terminal;
  `, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 950 }, deviceScaleFactor: 1.5 })
    await page.setContent('<style>:root { --background-primary:#ffffff; --foreground-primary:#20242c; } * { box-sizing:border-box } body { margin:20px } </style><div class="terminal-surface" style="width:650px;height:700px"><div class="terminal-scroll-area"><div class="terminal-viewport"></div></div></div>')
    await page.addStyleTag({ content: await readFile('node_modules/@xterm/xterm/css/xterm.css', 'utf8') + await readFile('src/features/terminal/styles.css', 'utf8') })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.waitForSelector('.xterm-screen')
    await mkdir('tmp/terminal-background', { recursive: true })
    for (const [theme, background, rows, width] of [
      ['light', '#ffffff', 24, 650], ['dark', '#18191b', 37, 530], ['light-resized', '#ffffff', 40, 580],
    ] as const) {
      await page.evaluate(async ({ background, rows, width }) => {
        const terminal = (window as any).terminalQA
        document.documentElement.style.setProperty('--background-primary', background)
        terminal.options.theme = { background, foreground: background === '#ffffff' ? '#20242c' : '#eeeeee' }
        terminal.resize(60, rows)
        await new Promise<void>(resolve => terminal.write('', resolve))
        await new Promise(requestAnimationFrame)
        // Real windows seldom fit an exact number of terminal rows. Leave two
        // pixels after the grid, plus the surface's 8px top/bottom padding.
        const surface = document.querySelector<HTMLElement>('.terminal-surface')!
        surface.style.height = `${document.querySelector('.xterm-screen')!.getBoundingClientRect().height + 18}px`
        surface.style.width = `${width}px`
      }, { background, rows, width })
      const area = await page.locator('.xterm-viewport').boundingBox()
      const grid = await page.locator('.xterm-screen').boundingBox()
      expect(area!.height - grid!.height).toBeCloseTo(2, 0)
      const screenshot = await page.screenshot({ path: `tmp/terminal-background/${theme}.png` })
      const pixels = await page.evaluate(async ({ image, area }) => {
        const bitmap = new Image()
        bitmap.src = image
        await bitmap.decode()
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width; canvas.height = bitmap.height
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        return [0.15, 0.5, 0.85].map(fraction => [...context.getImageData(
          Math.floor((area.x + area.width * fraction) * devicePixelRatio),
          Math.floor((area.y + area.height - 1) * devicePixelRatio), 1, 1).data])
      }, { image: `data:image/png;base64,${screenshot.toString('base64')}`, area: area! })
      const expected = background === '#ffffff' ? [255, 255, 255, 255] : [24, 25, 27, 255]
      expect(pixels, `${theme}: unused pixels must not expose xterm's default black viewport`).toEqual([expected, expected, expected])
    }
  } finally { await browser.close() }
}, 30000)

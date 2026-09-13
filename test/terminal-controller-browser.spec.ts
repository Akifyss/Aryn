import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('reattaches a real xterm without duplicate bytes or replies, and keeps input and grid ordering', async () => {
  const bundle = await build({ stdin: { contents: `
    import { TerminalController } from './src/features/terminal/terminal-controller';
    let receive, complete;
    const writes = [], resizes = [], acks = [], states = [], links = [];
    window.appApi = { openExternalLink: async url => links.push(url) };
    const api = {
      open: () => new Promise(resolve => complete = resolve),
      write: async value => { writes.push(value) }, resize: async value => { resizes.push(value) },
      acknowledge: value => acks.push(value), close: async () => { throw Error('A view cannot own process lifetime') },
      detach: () => {},
      onEvent: handler => { receive = handler; return () => { receive = null } },
    };
    const host = document.getElementById('host');
    const controller = new TerminalController(host, api, state => states.push(state), () => {});
    const ref = { id: 'terminal://qa', generation: 'new-generation' };
    const opened = controller.open(ref.id, 'project');
    controller.setVisible(true);
    window.qa = { controller, writes, resizes, acks, states, links, opened,
      event: event => receive?.({ ...ref, ...event }),
      complete: () => complete({ ...ref, projectId: 'project', cwd: '/qa', shell: 'Shell',
        cols: 80, rows: 24, sequence: 4, screen: 'snapshot\\r\\n', screenReaderMode: false, status: 'running', exitCode: null }),
      screen: () => Array.from({ length: controller.terminal.buffer.active.length }, (_, i) => controller.terminal.buffer.active.getLine(i)?.translateToString(true)).join('\\n'),
      parsed: () => new Promise(resolve => controller.terminal.write('', resolve)),
    };
  `, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser', format: 'iife' })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 650 } })
    const errors: string[] = []
    const dialogs: string[] = []
    page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss() })
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://127.0.0.1/__terminal__', route => route.fulfill({ contentType: 'text/html', body: '<div id="host" style="width:800px;height:500px"></div>' }))
    await page.goto('http://127.0.0.1/__terminal__')
    await page.addStyleTag({ content: await readFile('node_modules/@xterm/xterm/css/xterm.css', 'utf8') })
    await page.evaluate(() => { const peer = document.createElement('input'); peer.id = 'peer'; document.body.appendChild(peer); peer.focus() })
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.evaluate(async () => {
      const q = (window as any).qa
      q.event({ type: 'data', sequence: 4, data: 'snapshot\r\n' }) // Already included in the snapshot.
      q.event({ type: 'data', sequence: 5, data: 'live\r\n' }) // Crosses the snapshot IPC reply.
      q.event({ type: 'data', sequence: 6, generation: 'old-generation', data: 'stale' })
      q.complete(); await q.opened; await q.parsed()
    })
    expect(await page.evaluate(() => (window as any).qa.screen())).toMatch(/^snapshot\nlive\n/)
    expect(await page.evaluate(() => (window as any).qa.screen())).not.toContain('stale')
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('peer')
    await page.evaluate(async () => {
      const q = (window as any).qa
      q.event({ type: 'data', sequence: 6, data: '\x1b[6n\x1b[c\x1bP$qm\x1b\\' })
      await q.parsed()
    })
    expect(await page.evaluate(() => (window as any).qa.writes)).toEqual([])
    await page.getByRole('textbox', { name: '终端输入' }).focus()
    await page.keyboard.type('中文 input')
    await expect.poll(() => page.evaluate(() => (window as any).qa.writes.map((value: any) => value.data).join(''))).toBe('中文 input')
    await page.keyboard.press('Control+c')
    await expect.poll(() => page.evaluate(() => (window as any).qa.writes.at(-1).data)).toBe('\x03')
    await page.evaluate(async () => {
      const q = (window as any).qa
      q.event({ type: 'data', sequence: 7, data: '\x1b[2J\x1b[H0123456789' })
      q.event({ type: 'resize', sequence: 8, cols: 5, rows: 24 })
      q.event({ type: 'data', sequence: 9, data: '\r\nNEXT' })
      await q.parsed()
    })
    expect(await page.evaluate(() => (window as any).qa.controller.terminal.cols)).toBe(5)
    expect(await page.evaluate(() => (window as any).qa.screen())).toContain('NEXT')
    await page.evaluate(async () => {
      const q = (window as any).qa
      q.event({ type: 'resize', sequence: 10, cols: 80, rows: 24 })
      q.event({ type: 'data', sequence: 11, data: '\x1b[2J\x1b[H\x1b]8;;https://example.com/terminal\x07Link\x1b]8;;\x07' })
      await q.parsed()
    })
    await expect.poll(() => page.locator('.xterm-rows').textContent()).toContain('Link')
    const screen = await page.locator('.xterm-screen').boundingBox()
    await page.mouse.click(screen!.x + 5, screen!.y + 8)
    expect(await page.evaluate(() => (window as any).qa.links)).toEqual([])
    await page.keyboard.down('Control')
    await page.mouse.click(screen!.x + 5, screen!.y + 8)
    await page.keyboard.up('Control')
    await expect.poll(() => page.evaluate(() => (window as any).qa.links)).toEqual(['https://example.com/terminal'])
    expect(dialogs).toEqual([])
    const beforeHidden = await page.evaluate(() => {
      const q = (window as any).qa
      q.controller.setVisible(false)
      document.getElementById('host')!.style.width = '300px'
      return q.resizes.length
    })
    await page.waitForTimeout(100)
    expect(await page.evaluate(() => (window as any).qa.resizes.length)).toBe(beforeHidden)
    await page.evaluate(() => (window as any).qa.controller.dispose())
    expect(errors).toEqual([])
  } finally { await browser.close() }
}, 30000)

import path from 'node:path'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Page } from 'playwright'
import { expect, it } from 'vitest'

async function settleFrames(page: Page) {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 6; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
}

it('recovers an existing broken tree when its fix is hot-reloaded', async () => {
  const tempRoot = path.resolve('tmp')
  await mkdir(tempRoot, { recursive: true })
  const directory = await mkdtemp(path.join(tempRoot, 'tree-hot-refresh-'))
  const componentPath = path.join(directory, 'tree-component.tsx')
  const source = (await readFile('src/components/tree/virtualized-tree-list.tsx', 'utf8'))
    .replace("from './tree'", "from '@/components/tree/tree'")
    .replace('const virtualRows = virtualizer.getVirtualItems()',
      'const virtualRows = virtualizer.getVirtualItems(); window.fixtureVirtualizer = virtualizer')
  const withoutReset = source.replace(/^\/\/ @refresh reset\r?\n/m, '')
  const versioned = (contents: string, version: string) =>
    `${contents}\nwindow.fixtureVersion = ${JSON.stringify(version)}\n`
  await writeFile(componentPath, versioned(withoutReset, 'initial'))
  await writeFile(path.join(directory, 'index.html'), '<style>:root{--app-item-list-gap:2px}.app-scroll-area-viewport{height:100%;width:100%}</style><div id="root"></div><script type="module" src="./fixture.tsx"></script>')
  await writeFile(path.join(directory, 'fixture.tsx'), `
    import React, {useRef} from 'react'
    import {createRoot} from 'react-dom/client'
    import {TreeScrollArea} from '@/components/tree/tree'
    import {VirtualizedTreeList} from './tree-component'
    import '@/components/tree/styles.css'
    const rows = Array.from({length:16},(_,i)=>({key:String(i),label:'row-'+i}))
    function App() {
      const viewport = useRef(null)
      return <div style={{display:'flex',height:690,width:280}}>
        <TreeScrollArea viewportRef={viewport}>
          <VirtualizedTreeList ariaLabel='test tree' estimateRowSize={()=>34}
            rows={rows} scrollElementRef={viewport}
            renderRow={row=><button style={{height:32,display:'block'}}>{row.label}</button>}/>
        </TreeScrollArea>
      </div>
    }
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
  `)
  const server = await createServer({
    configFile: false, root: directory, logLevel: 'error',
    cacheDir: path.join(directory, 'node_modules/.vite'),
    plugins: [react()], resolve: { alias: { '@': path.resolve('src') } },
    server: { host: '127.0.0.1', port: 0, fs: { allow: [process.cwd()] } },
    optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom', 'react-dom/client', '@tanstack/react-virtual', '@base-ui/react/scroll-area'] },
  })
  const browser = await chromium.launch({ headless: true })
  try {
    await server.listen()
    const address = server.httpServer!.address()
    if (!address || typeof address === 'string') throw new Error('Missing test server port')
    const page = await browser.newPage()
    page.setDefaultTimeout(5000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${address.port}/index.html`)
    await server.waitForRequestsIdle()
    await page.waitForLoadState('networkidle')
    const labels = () => page.locator('.tree-virtual-item button').allTextContents()
    const expected = Array.from({length:16},(_,i)=>'row-'+i)
    await expect.poll(labels).toEqual(expected)
    await settleFrames(page)
    // Seed the scrollOffset left by pre-fix zero-height measurements. This
    // test starts with an already-corrupted instance, unlike the visibility tests.
    await page.evaluate(() => {
      const instance = (window as unknown as { fixtureVirtualizer: {
        scrollOffset: number; options: { onChange: (value: unknown, sync: boolean) => void }
      } }).fixtureVirtualizer
      instance.scrollOffset = 544
      instance.options.onChange(instance, false)
    })
    await expect.poll(labels).toEqual(expected.slice(7))
    // An ordinary Fast Refresh keeps the imperative cache and leaves the gap.
    await writeFile(componentPath, versioned(withoutReset, 'guard-only'))
    await page.waitForFunction(() => (window as unknown as {fixtureVersion:string}).fixtureVersion === 'guard-only')
    await settleFrames(page)
    expect(await labels()).toEqual(expected.slice(7))
    // The production refresh policy must replace that stale virtualizer instance.
    await writeFile(componentPath, versioned(source, 'fixed'))
    await page.waitForFunction(() => (window as unknown as {fixtureVersion:string}).fixtureVersion === 'fixed')
    await settleFrames(page)
    await expect.poll(labels).toEqual(expected)
    expect(errors).toEqual([])
  } finally {
    await browser.close()
    await server.close()
    // Only delete this test's mkdtemp directory under the workspace tmp root.
    if (path.dirname(directory) !== tempRoot) throw new Error('Unexpected fixture directory')
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

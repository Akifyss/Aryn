import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('uses an ephemeral start tab and opens each entry in its source pane', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useRef, useState} from 'react'
      import {createRoot} from 'react-dom/client'
      import {DuoPane} from './src/features/duo/duo-pane'
      import {DuoConversationLayer} from './src/features/duo/duo-conversation-layer'
      import {DuoPanelLayer} from './src/features/duo/duo-panel-layer'
      import {useDuoStore, createDuoPane, createDefaultDuoLayout} from './src/features/duo/duo-state'
      import {useWorkspaceStore} from './src/features/workspace/store/use-workspace-store'
      import './src/features/layout/components/app-shell/styles.css'
      import './src/features/duo/styles.css'
      const noop = () => {}
      useDuoStore.setState({panes: {left: {...createDuoPane(), directoryOpen:false}, right: {...createDuoPane(), directoryOpen:false}}})
      window.readTabs = () => ({left:useDuoStore.getState().panes.left.tabs, right:useDuoStore.getState().panes.right.tabs, files:useWorkspaceStore.getState().openTabs})
      function App() {
        const [selectedProject, setProject] = useState({id:'qa',name:'QA',path:'/qa',addedAt:'',lastOpenedAt:'',lastFilePath:null})
        window.selectProject = id => setProject(id ? {id,name:id,path:'/'+id,addedAt:'',lastOpenedAt:'',lastFilePath:null} : null)
        window.selectScopedProject = id => {
          const project = {id,name:id,path:'/'+id,addedAt:'',lastOpenedAt:'',lastFilePath:null}
          const store = useDuoStore.getState()
          store.switchProject(project, store.projectLayouts[id] ?? createDefaultDuoLayout(project))
          setProject(project)
        }
        window.chooseProjectCalls ??= 0
        const commands = useRef({})
        const editorRef = useRef(null)
        const configuration = {
          editor: {
            navigation: {activeTab:'file', treePanel:{expandedPaths:new Set(), nodes:[]}, gitPanel:{}},
            editorContent: {workspacePath:'/qa', meoEditorHostRef:editorRef, fileActions:{}},
            fileTabs: {iconTheme:null, workspacePath:'/qa'}, fileSystemPanel:{}, emptyState:{},
          },
          conversations:{selectedProject,onChooseProject:()=>window.chooseProjectCalls++}, documentNavigation:{},
          refreshGitState:noop, onCloseDocument:async()=>true, confirmCloseConversation:async()=>true,
        }
        return <div className='app-shell duo-shell' data-app-layout='duo' style={{'--left-panel-toggle-anchor':'6px'}}>
          <div className='duo-panes' style={{'--duo-left-ratio':'50%'}}>
            <DuoPane pane='left' configuration={configuration} commands={commands} isActive />
            <div className='duo-separator' />
            <DuoPane pane='right' configuration={configuration} commands={commands} isActive />
            <DuoPanelLayer configuration={configuration} commands={commands} />
            <DuoConversationLayer configuration={configuration} commands={commands} />
          </div>
        </div>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': path.resolve('src') },
    outfile: 'duo-fixture.js',
    plugins: [{ name: 'unrelated-content-fixtures', setup(builder) {
      const fixtures: Record<string, string> = {
        'workspace-editor-content': 'export const WorkspaceEditorContent = () => null',
        'workspace-file-system-panel': 'export const WorkspaceFileSystemPanel = () => null',
        'workspace-navigation-panels': 'export const WorkspaceGitPane = () => null; export const WorkspaceTreePane = () => null; export const WorkspaceNavigationPanels = () => null',
        'duo-conversation-list': 'export const DuoConversationList = () => null',
        'duo-conversations': "import React,{useEffect} from 'react'; export function DuoConversationView({registerCloseGuard}) {useEffect(()=>{registerCloseGuard(async()=>true)},[]);return React.createElement('input',{'aria-label':'测试草稿'})}",
      }
      builder.onResolve({ filter: /\/(workspace-editor-content|workspace-file-system-panel|workspace-navigation-panels|duo-conversation-list|duo-conversations)$/ }, (args) => ({ path: args.path.split('/').pop()!, namespace: 'fixture' }))
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: fixtures[args.path], resolveDir: process.cwd() }))
    } }],
  })
  const styles = await compile(
    await readFile('src/index.css', 'utf8') + '\n' + bundle.outputFiles.find((file) => file.path.endsWith('.css'))!.text,
    { base: path.resolve('src'), onDependency: () => {} },
  )
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    // Like Electron's app origin, this must be a secure context for draft UUIDs.
    await page.route('https://duo.test/', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('https://duo.test/')
    await page.addStyleTag({ content: styles.build([]) })
    await page.addScriptTag({ content: bundle.outputFiles.find((file) => file.path.endsWith('.js'))!.text })
    const left = page.locator('#duo-left')
    const right = page.locator('#duo-right')
    const readTabs = () => page.evaluate(() => (window as unknown as { readTabs: () => unknown }).readTabs())
    await left.getByRole('tab', { name: '开始', exact: true }).waitFor()
    await right.getByRole('tab', { name: '开始', exact: true }).waitFor()
    expect(await readTabs()).toEqual({ left: [], right: [], files: [] })
    expect(await page.getByRole('button', { name: 'Close 开始', exact: true }).count()).toBe(0)
    await page.setViewportSize({width:1100,height:720})
    await page.locator('html').evaluate((element) => element.classList.add('dark'))
    const foregroundColor = await left.evaluate((element) => getComputedStyle(element).color)
    await expect.poll(() => left.getByRole('tab', {name:'开始',exact:true}).evaluate((element) => getComputedStyle(element).color)).toBe(foregroundColor)
    await page.locator('html').evaluate((element) => element.classList.remove('dark'))
    // Keep both directories in flow while exercising a narrow window.
    await left.locator('[aria-controls="duo-left-directory"]').click()
    await right.locator('[aria-controls="duo-right-directory"]').click()

    for (const [pane, peer] of [[left, right], [right, left]]) {
      for (const label of ['新对话', '文件', '更改']) {
        const action = pane.locator('.duo-start-page').getByRole('button', { name: label, exact: true })
        if (pane === right) { await action.focus(); await page.keyboard.press('Enter') }
        else await action.click()
        expect(errors).toEqual([])
        await pane.locator('.file-tabs-shell').getByRole('tab', { name: label, exact: true }).waitFor()
        expect(await pane.locator('.duo-start-page').count()).toBe(0)
        expect(await peer.locator('.duo-start-page').count()).toBe(1)
        await pane.locator('.file-tab.is-active').hover()
        await pane.getByRole('button', { name: `Close ${label}`, exact: true }).click()
        await pane.getByRole('tab', { name: '开始', exact: true }).waitFor()
      }
    }
    expect(await readTabs()).toEqual({ left: [], right: [], files: [] })
    expect(errors).toEqual([])
    // Project changes hide other projects without remounting their draft views.
    await left.getByRole('button', { name: '新对话', exact: true }).click()
    await left.getByRole('textbox', { name: '测试草稿' }).fill('project A unsent draft')
    await right.getByRole('button', { name: '右侧新建标签页' }).click()
    await page.getByRole('menuitem', { name: '新对话', exact: true }).click()
    const selectProject = (id: string | null) => page.evaluate((id) => (window as any).selectProject(id), id)
    await selectProject('b')
    await left.getByRole('tab', { name: '开始', exact: true }).waitFor()
    await right.getByRole('tab', { name: '开始', exact: true }).waitFor()
    await left.getByRole('button', { name: '新对话', exact: true }).click()
    await left.getByRole('textbox', { name: '测试草稿' }).fill('project B unsent draft')
    await selectProject('qa')
    await left.getByRole('textbox', { name: '测试草稿' }).waitFor()
    expect(await left.getByRole('textbox', { name: '测试草稿' }).inputValue()).toBe('project A unsent draft')
    // Close targets the visible tab even when a hidden project was last active.
    await left.locator('.file-tab.is-active').hover()
    await left.getByRole('button', { name: 'Close 新对话', exact: true }).click()
    await left.getByRole('tab', { name: '开始', exact: true }).waitFor()
    await selectProject('b')
    expect(await left.getByRole('textbox', { name: '测试草稿' }).inputValue()).toBe('project B unsent draft')
    await selectProject(null)
    await left.getByRole('button', { name: '选择项目以开始对话' }).click()
    expect(await page.evaluate(() => (window as any).chooseProjectCalls)).toBe(1)
    expect((await readTabs() as any).left).toHaveLength(1)
    // Use the actual project layout cache. The mounted composer stays alive
    // when its Tab moves from the foreground layout into the inactive cache.
    const scoped = (id: string) => page.evaluate(id => (window as any).selectScopedProject(id), id)
    await scoped('scoped-a')
    await left.getByRole('textbox', { name: '测试草稿' }).fill('cached A draft')
    await scoped('scoped-b')
    await left.getByRole('textbox', { name: '测试草稿' }).fill('cached B draft')
    await scoped('scoped-a')
    expect(await left.getByRole('textbox', { name: '测试草稿' }).inputValue()).toBe('cached A draft')
    await left.locator('.file-tab.is-active').hover()
    await left.getByRole('button', { name: 'Close 新对话', exact: true }).click()
    await left.getByRole('tab', { name: '开始', exact: true }).waitFor()
    await scoped('scoped-b')
    expect(await left.getByRole('textbox', { name: '测试草稿' }).inputValue()).toBe('cached B draft')
    await scoped('scoped-a')
    await left.getByRole('tab', { name: '开始', exact: true }).waitFor()
    expect(errors).toEqual([])
  } finally { await browser.close() }
})

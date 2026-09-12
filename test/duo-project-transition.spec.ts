import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('keeps both committed panes visible until project restoration commits, including late results and errors', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useRef,useState} from 'react'
      import {createRoot} from 'react-dom/client'
      import {DuoWorkspaceShell} from './src/features/duo/duo-workspace-shell'
      import {useDuoWorkspaceSync} from './src/features/duo/use-duo-workspace-sync'
      import {useDuoStore} from './src/features/duo/duo-state'
      import {captureDuoDocumentTarget} from './src/features/duo/duo-document-navigation'
      import {initializeRendererPersistentState} from './src/features/persistence/renderer-state'
      import {useWorkspaceStore} from './src/features/workspace/store/use-workspace-store'
      import {getShellChromeVars} from './src/features/layout/shell-layout'
      const projects=['a','b','slow'].map(id=>({id,name:id,path:'/'+id,addedAt:'',lastOpenedAt:'',lastFilePath:null}))
      const projectState={projects,lastProjectId:'a'}, conversationState={version:3,conversations:[]}
      const saved=id=>({version:1,ratio:.6,focusedPane:'right',panes:{
        left:{directoryOpen:true,directoryTab:'conversation',activeTabId:'draft-'+id,tabs:[{kind:'conversation',id:'draft-'+id,projectId:id,conversationId:null,session:null}]},
        right:{directoryOpen:false,directoryTab:'git',activeTabId:'app://fixed/files',tabs:[
          {kind:'panel',id:'app://fixed/files',panel:'files'},
          {kind:'file',id:'doc-'+id,path:'/'+id+'/saved.md',workspacePath:'/'+id,viewMode:'code'}]}
      }})
      initializeRendererPersistentState({app:{layout:{duoProjects:{version:1,layouts:{b:saved('b'),slow:saved('slow')}}}},workspace:{workspaceTabs:{}}})
      const gates={}
      window.appApi={platform:'win32',updateLayoutState:async()=>({}),onWindowStateChanged:()=>()=>{},isWindowMaximized:async()=>({isMaximized:false}),
        resolveWorkspaceEditorKind:async()=>'prose',readWorkspaceFile:async file=>{await new Promise(resolve=>gates[file]=resolve);return 'restored file'}}
      useWorkspaceStore.getState().setCurrentPath('/a')
      window.complete=id=>gates['/'+id+'/saved.md']?.()
      window.inspect=()=>({project:useDuoStore.getState().project?.id,restoring:useDuoStore.getState().restoring,documents:useWorkspaceStore.getState().openTabs.map(tab=>tab.filePath)})
      window.capture=()=>{window.oldTarget=captureDuoDocumentTarget('left')}
      const noop=()=>{}
      function App(){
        const [selected,setSelected]=useState(projects[0])
        const [unavailable,setUnavailable]=useState(null)
        const initialized=useDuoStore(state=>state.initialized)
        const cwd=useWorkspaceStore(state=>state.currentPath)
        const shellRef=useRef(null),editorRef=useRef(null)
        window.request=id=>{setUnavailable(null);setSelected(projects.find(p=>p.id===id))}
        window.connect=id=>useWorkspaceStore.getState().setCurrentPath('/'+id)
        window.fail=()=>setUnavailable('无法访问当前工作目录。')
        useDuoWorkspaceSync({isActive:true,initialized,bootstrapReady:true,projectState,conversationState,selectedProject:selected,workspaceUnavailableMessage:unavailable})
        const configuration={editor:{
          navigation:{activeTab:'file',workspaceLabel:cwd,treePanel:{expandedPaths:new Set(),nodes:[]},gitPanel:{}},
          editorContent:{workspacePath:cwd,meoEditorHostRef:editorRef,fileActions:{}},
          fileTabs:{iconTheme:null,workspacePath:cwd},fileSystemPanel:{workspacePath:cwd,title:cwd},emptyState:{},
        },conversations:{selectedProject:selected,projectState},documentNavigation:{},refreshGitState:noop,onCloseDocument:async()=>true,confirmCloseConversation:async()=>true}
        return <DuoWorkspaceShell ref={shellRef} configuration={configuration} chromeVars={getShellChromeVars('windows')} platform='windows' isFullScreen={false}
          isModalOpen={false} isActive onRequestClose={noop} onSearch={noop} onSettings={noop} onWorkspace={noop} workspaceLabel={selected.name} isPickingWorkspace={false} isWorkspaceMenuOpen={false}/>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife', outfile: 'transition.js',
    define: { 'process.env.NODE_ENV': '"development"', 'import.meta.env.DEV': 'false' },
    alias: { '@': path.resolve('src') },
    plugins: [{ name: 'content-fixtures', setup(builder) {
      const fixtures: Record<string, string> = {
        'workspace-editor-content': 'export const WorkspaceEditorContent=()=>null',
        'workspace-file-system-panel': `import React from 'react';export const WorkspaceFileSystemPanel=({workspacePath})=><div className='fixture-files'>{workspacePath} files</div>`,
        'workspace-navigation-panels': `import React from 'react';export const WorkspaceTreePane=({configuration})=><div>{configuration.workspaceLabel} tree</div>;export const WorkspaceGitPane=()=>null;export const WorkspaceNavigationPanels=()=>null`,
        'duo-conversation-list': `import React from 'react';export const DuoConversationList=({configuration})=><div>{configuration.selectedProject.name} sessions</div>`,
        'duo-conversations': `import React from 'react';export function DuoConversationView({tab,registerCloseGuard}){registerCloseGuard(async()=>true);return <input aria-label={'Draft '+tab.projectSession.project.id}/>}`,
      }
      builder.onResolve({ filter: /\/(workspace-editor-content|workspace-file-system-panel|workspace-navigation-panels|duo-conversation-list|duo-conversations)$/ }, args => ({path:args.path.split('/').pop()!,namespace:'fixture'}))
      builder.onLoad({ filter: /.*/, namespace:'fixture' }, args => ({contents:fixtures[args.path],loader:'tsx',resolveDir:process.cwd()}))
    } }],
  })
  const styles = await compile(await readFile('src/index.css','utf8') + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text,
    {base:path.resolve('src'),onDependency:()=>{}})
  const browser = await chromium.launch({headless:true})
  try {
    const page = await browser.newPage({viewport:{width:1300,height:800}})
    page.setDefaultTimeout(4000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://127.0.0.1/', route => route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}))
    await page.goto('http://127.0.0.1/')
    await page.addStyleTag({content:styles.build([])})
    await page.addScriptTag({content:bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text})
    const draft = page.getByRole('textbox',{name:'Draft a'})
    await draft.fill('keep my draft')
    await page.evaluate(() => {
      const app = window as any
      app.inputBefore = document.querySelector('input')
      app.frames = []
      const sample = () => {
        const main = document.querySelector('.duo-panes')!
        app.frames.push({visibility:getComputedStyle(main).visibility,
          title:document.querySelector('.duo-workspace-switch-label')?.textContent,
          files:document.querySelector('.duo-panel-view:not([hidden]) .fixture-files')?.textContent,
          draft:document.querySelector('.duo-conversation-view:not([hidden]) input')?.getAttribute('aria-label')})
        app.frameId=requestAnimationFrame(sample)
      }
      app.frameId=requestAnimationFrame(sample)
      app.capture(); app.request('b')
    })
    const assertAVisible = async () => {
      expect(await page.locator('.duo-panes').evaluate(el=>getComputedStyle(el).visibility)).toBe('visible')
      expect(await page.locator('.duo-panes').getAttribute('inert')).not.toBeNull()
      expect(await page.locator('.duo-workspace-switch-label').innerText()).toBe('a')
      expect(await page.locator('.fixture-files:visible').innerText()).toBe('/a files')
      expect(await page.locator('.duo-conversation-view:not([hidden]) input').inputValue()).toBe('keep my draft')
      expect(await page.getByText('正在恢复项目…',{exact:true}).count()).toBe(0)
    }
    await expect.poll(()=>page.evaluate(()=>(window as any).inspect().restoring)).toBe(true)
    await assertAVisible()
    expect(await page.evaluate(()=>(window as any).oldTarget.isCurrent())).toBe(false)
    await page.evaluate(()=>(window as any).connect('b'))
    // The new filesystem inputs are ready, but the saved file is still loading.
    await page.waitForTimeout(120)
    await assertAVisible()
    await page.setViewportSize({width:1000,height:720})
    await page.locator('html').evaluate(el=>el.classList.add('dark'))
    await assertAVisible()
    await page.evaluate(()=>(window as any).complete('b'))
    await expect.poll(()=>page.locator('.duo-panes').getAttribute('inert')).toBeNull()
    await page.getByRole('textbox',{name:'Draft b'}).fill('B draft')
    expect(await page.locator('.fixture-files:visible').innerText()).toBe('/b files')
    expect(await page.locator('.duo-workspace-switch-label').innerText()).toBe('b')
    await page.evaluate(()=>{(window as any).request('slow');(window as any).connect('slow')})
    await expect.poll(()=>page.evaluate(()=>(window as any).inspect().restoring)).toBe(true)
    await page.waitForTimeout(120)
    expect(await page.locator('.fixture-files:visible').innerText()).toBe('/b files')
    await page.evaluate(()=>{(window as any).request('a');(window as any).connect('a')})
    await draft.waitFor()
    expect(await draft.inputValue()).toBe('keep my draft')
    expect(await draft.evaluate(el=>el===(window as any).inputBefore)).toBe(true)
    await page.evaluate(()=>(window as any).complete('slow'))
    await page.waitForTimeout(120)
    expect(await page.evaluate(()=>(window as any).inspect().documents)).not.toContain('/slow/saved.md')
    await page.evaluate(()=>{(window as any).request('b');(window as any).fail()})
    await page.getByRole('alert').waitFor()
    await assertAVisible()
    await page.evaluate(()=>(window as any).request('a'))
    await expect.poll(()=>page.getByRole('alert').count()).toBe(0)
    await draft.fill('editing still works')
    const frames = await page.evaluate(()=>{cancelAnimationFrame((window as any).frameId);return (window as any).frames})
    expect(frames.length).toBeGreaterThan(10)
    for (const frame of frames) {
      expect(frame.visibility).toBe('visible')
      expect(frame.files).toBe('/'+frame.title+' files')
      expect(frame.draft).toBe('Draft '+frame.title)
    }
    expect(errors).toEqual([])
  } finally {await browser.close()}
},20000)

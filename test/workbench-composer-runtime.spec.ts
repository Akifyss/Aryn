import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

// Exercise the real Workbench hosts, AgentProvider, navigation/lifecycle hooks and
// composer. The bridge models the native workspace's latest-activation rule.
// A second provider mounted just to show the directory must not supersede it.
it.each([false, true])('restores a usable project composer with both directories open (load failure=%s)', async (failFirstLoad) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: 'tsx', contents: `
        import React, { useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import { WorkbenchConversationView } from './src/features/workbench/workbench-conversations'
        import { WorkbenchConversationList } from './src/features/workbench/workbench-conversation-list'
        import { ProjectMenu } from './src/features/workspace/components/project-menu/project-menu'
        import { AGENT_DEFINITIONS } from './src/features/agent/agent-definition'
        const project = {id:'project-a',name:'Workspace',path:'/project-a',addedAt:'',lastOpenedAt:'',lastFilePath:null}
        const configuration = {projectState:{projects:[project],lastProjectId:project.id},selectedProject:project}
        const tab = {id:'draft',kind:'conversation',conversationId:null,projectSession:{project,request:{kind:'new',projectId:project.id,requestId:0}}}
        let revision=0,failNext=${failFirstLoad}
        window.calls={loads:0,lists:0,workspaceWrites:0,attachments:0,prompts:[],creates:[],projectMenus:[],projectSelections:[]}
        const runtime = {
          agentId:'pi',workspacePath:project.path,auth:{},hasConfiguredModels:true,
          availableModels:['test/model-a','test/model-b'],availableModelInputs:{},
          availableThinkingLevels:['off'],availableThinkingLevelsByModel:{},
          defaultModel:'test/model-a',selectedModel:'test/model-a',defaultThinkingLevel:'off',thinkingLevel:'off',
          preferredModelByProvider:{test:'model-a'},isStreaming:false,isCompacting:false,compactionReason:null,
          steeringMessages:[],followUpMessages:[],steeringMode:'one-at-a-time',followUpMode:'one-at-a-time',
          steeringMessageCount:0,followUpMessageCount:0,pendingMessageCount:0,retryAttempt:0,retryMaxAttempts:null,
          supportsThinking:false,supportsQueuedMessageEditing:true,supportedRunningPromptBehaviors:['steer','followUp'],setupHint:null,
        }
        const session={id:'history',path:'history',name:'Project history',createdAt:'2026-09-10',modifiedAt:'2026-09-10',messageCount:1}
        const state=()=>({runtime:{...runtime},activeSession:null,sessions:[session]})
        window.appApi={
          platform:'win32',loadWorkspaceTree:async()=>[],
          getAgentCatalog:async()=>AGENT_DEFINITIONS.map(definition=>({definition,available:true,command:null,reason:null,guidance:null,version:null})),
          onAgentEvent:()=>()=>{},
          listAgentSessions:async({agentId})=>{window.calls.lists++;return agentId==='pi'?[session]:[]},
          getWorkspaceState:async()=>({lastAgentSessionPath:null,prefersNewAgentSession:true}),
          updateWorkspaceState:async()=>{window.calls.workspaceWrites++;return {}},
          loadAgentWorkspace:async()=>{
            window.calls.loads++; const current=++revision;
            await new Promise(resolve=>setTimeout(resolve,80));
            if(current!==revision)throw new Error('PI CLI workspace activation was superseded.');
            if(failNext){failNext=false;throw new Error('Fixture initialization failed');}
            return state();
          },
          pickAgentAttachments:async()=>{window.calls.attachments++;return [{fileName:'notes.txt',kind:'file',path:'/notes.txt',mimeType:'text/plain',size:12}]},
          createAgentSession:async(scope,options)=>{
            window.calls.creates.push({scope,options});return {...state(),activeSession:{sessionId:'created',sessionPath:'created',workspacePath:scope.workspacePath,messages:[],annotations:{fileChangesByEntryId:{}},name:'Created'}};
          },
          sendAgentPrompt:async(...args)=>{window.calls.prompts.push(args)},
        }
        localStorage.setItem('aryn:last-new-conversation-agent','pi')
        function Fixture(){
          const [directories,setDirectories]=useState(true)
          const [menuAnchor,setMenuAnchor]=useState(null)
          const onOpenProjectSwitchMenu=(anchor,options)=>{window.calls.projectMenus.push({anchor:{top:anchor.top,left:anchor.left},options});setMenuAnchor(anchor)}
          const chatConfiguration={...configuration,onOpenProjectSwitchMenu}
          return <>
            <button onClick={()=>setDirectories(value=>!value)}>Toggle directories</button>
            <main><WorkbenchConversationView pane='left' tab={tab} configuration={chatConfiguration} onOpenFile={()=>{}} registerCloseGuard={()=>{}} confirmClose={async()=>true}/></main>
            {directories?<aside><WorkbenchConversationList pane='left' configuration={configuration}/><WorkbenchConversationList pane='right' configuration={configuration}/></aside>:null}
            {menuAnchor?<ProjectMenu activeProjectId={project.id} anchorRect={menuAnchor} canUseNoProject={false} isBusy={false} mode='editor-switch' surface='global'
              projects={[project]} onClose={()=>setMenuAnchor(null)} onAddExistingProject={()=>{}} onCreateProject={()=>{}} onUseNoProject={()=>{}}
              onSelectProject={selected=>{window.calls.projectSelections.push(selected.id);setMenuAnchor(null)}}/>:null}
          </>
        }
        createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>)
      `,
    },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    alias: { '@': path.resolve('src') },
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
    plugins: [{
      name: 'timeline-only-fixture',
      setup(builder) {
        // Native timeline rendering isn't involved in new-draft readiness.
        builder.onResolve({ filter: /bb-session-timeline\/bb-session-timeline$/ }, () => ({ path: 'timeline', namespace: 'fixture' }))
        builder.onResolve({ filter: /bb-session-surface-loader$/ }, () => ({ path: 'loader', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: name }) => ({ contents: name === 'timeline'
          ? 'export const BbSessionTimeline = () => null;'
          : 'export const getPreloadedBbSessionSurface = () => ({}); export const preloadBbSessionSurface = async () => ({});',
        }))
      },
    }],
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('http://127.0.0.1/', (route) => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
    await page.goto('http://127.0.0.1/')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const editor = page.locator('main .agent-composer-editor')
    await editor.waitFor()
    await editor.fill('Keep this draft during initialization')
    if (failFirstLoad) {
      await expect.poll(() => page.getByRole('alert').innerText()).toContain('Fixture initialization failed')
      expect(await page.locator('main button[type=submit]').isDisabled()).toBe(true)
      await page.getByRole('button', { name: '重试', exact: true }).click()
      await expect.poll(() => page.getByRole('alert').count()).toBe(0)
    }
    const model = page.locator('main .agent-model-cascader-trigger')
    await expect.poll(() => model.isEnabled()).toBe(true)
    await expect.poll(() => page.locator('main button[type=submit]').isEnabled()).toBe(true)
    expect(await editor.innerText()).toBe('Keep this draft during initialization')
    for (const selector of ['.agent-new-conversation-prompt', '.agent-new-project-bar']) {
      const trigger = page.locator(`main ${selector}`).getByRole('button', {name:'切换项目，当前项目：Workspace'})
      const bounds = await trigger.boundingBox()
      await trigger.click()
      await page.getByRole('menu').waitFor()
      expect(await page.getByRole('menuitem', {name:'不使用项目',exact:true}).count()).toBe(0)
      await page.getByRole('menuitem', {name:/Workspace/}).click()
      const lastMenu = await page.evaluate(() => (window as any).calls.projectMenus.at(-1))
      expect(lastMenu.options).toBeUndefined()
      expect(lastMenu.anchor).toEqual({top:bounds!.y,left:bounds!.x})
      expect(await editor.innerText()).toBe('Keep this draft during initialization')
    }
    expect(await page.evaluate(() => (window as any).calls.projectSelections)).toEqual(['project-a','project-a'])
    expect(await page.evaluate(() => (window as any).calls.creates)).toEqual([])
    const expectedLoads = failFirstLoad ? 2 : 1
    expect(await page.evaluate(() => (window as any).calls.loads)).toBe(expectedLoads)
    await expect.poll(() => page.getByText('Project history', { exact: true }).count()).toBe(2)
    // Closing/reopening either directory may read catalogues, but never start
    // or restore a runtime, or overwrite the active conversation preference.
    const writes = await page.evaluate(() => (window as any).calls.workspaceWrites)
    await page.getByRole('button', { name: 'Toggle directories' }).click()
    await page.getByRole('button', { name: 'Toggle directories' }).click()
    await expect.poll(() => page.getByText('Project history', { exact: true }).count()).toBe(2)
    expect(await page.evaluate(() => (window as any).calls.loads)).toBe(expectedLoads)
    expect(await page.evaluate(() => (window as any).calls.workspaceWrites)).toBe(writes)
    await model.click()
    await page.getByRole('searchbox', { name: 'Search models' }).fill('model-b')
    await page.getByRole('option', { name: /model-b/ }).click()
    await expect.poll(() => model.innerText()).toContain('model-b')
    await page.getByRole('button', { name: '附加文件', exact: true }).click()
    await expect.poll(() => page.getByText('notes.txt', { exact: true }).count()).toBeGreaterThan(0)
    await page.locator('main button[type=submit]').click()
    await expect.poll(() => page.evaluate(() => (window as any).calls.prompts.length)).toBe(1)
    const calls = await page.evaluate(() => (window as any).calls)
    expect(calls.creates[0].scope).toEqual({ agentId: 'pi', workspacePath: '/project-a' })
    expect(calls.creates[0].options.modelKey).toBe('test/model-b')
    expect(JSON.stringify(calls.prompts)).toContain('Keep this draft during initialization')
    expect(JSON.stringify(calls.prompts)).toContain('notes.txt')
    expect(errors).toEqual([])
  } finally {
    await browser.close()
  }
})

import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { AppStateStore } from '../electron/main/app-state'
import type { PersistedWorkbenchLayout, PersistedProjectWorkspaces } from '../electron/shared/contracts/workbench-layout'

it('isolates project layouts, migrates once, survives restart and rejects late restores under StrictMode', async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React, {useState} from 'react'
      import {createRoot} from 'react-dom/client'
      import {useProjectWorkspaceSync} from './src/features/workbench/use-project-workspace-sync'
      import {flushWorkbenchPersistence} from './src/features/workbench/workbench-persistence'
      import {initializeRendererPersistentState} from './src/features/persistence/renderer-state'
      import {useWorkbenchStore, WORKBENCH_FILES_ID, WORKBENCH_GIT_ID} from './src/features/workbench/workbench-state'
      import {captureWorkbenchDocumentTarget} from './src/features/workbench/workbench-document-navigation'
      import {useWorkspaceStore} from './src/features/workspace/store/use-workspace-store'
      const projects = {projects:['a','b','c','slow'].map(id=>({id,name:id,path:'/'+id,addedAt:'',lastOpenedAt:'',lastFilePath:null})),lastProjectId:'a'}
      const conversations = {version:1,conversations:[]}
      const gates = {}
      window.completeFile = path => gates[path]?.()
      window.appApi = {
        updateLayoutState: window.writeLayout,
        resolveWorkspaceEditorKind: async () => 'prose',
        readWorkspaceFile: async path => {
          if (path === '/a/saved.md' || path === '/slow/saved.md') await new Promise(resolve => gates[path] = resolve)
          return 'disk file'
        },
      }
      initializeRendererPersistentState({app:{layout:window.savedLayout},workspace:{workspaceTabs:{}}})
      window.inspect = () => {
        const {panes,ratio,focusedPane,initialized,project,restoring,projectLayouts} = useWorkbenchStore.getState()
        return {panes,ratio,focusedPane,initialized,project,restoring,projectLayouts,documents:useWorkspaceStore.getState().openTabs}
      }
      window.flush = flushWorkbenchPersistence
      window.customizeA = () => {
        const store = useWorkbenchStore.getState()
        store.setDirectoryTab('left','conversation')
        store.toggleDirectory('right')
        store.open('right',{kind:'panel',id:WORKBENCH_GIT_ID, panel: 'git' })
        store.open('right',{kind:'panel',id:WORKBENCH_FILES_ID, panel: 'files' })
        store.reorder('right',WORKBENCH_FILES_ID,WORKBENCH_GIT_ID,'before')
        store.activate('right',WORKBENCH_GIT_ID)
        store.setRatio(.62)
        useWorkspaceStore.getState().updateFileTabsContent('/a/saved.md','private unsaved edit')
      }
      window.closeB = () => {
        const store = useWorkbenchStore.getState()
        for (const side of ['left','right']) for (const tab of [...store.panes[side].tabs]) store.close(side,tab.id)
        store.setDirectoryTab('right','git')
        store.setRatio(.4)
      }
      window.completeBackground = () => useWorkbenchStore.getState().setProjectSession('left','draft-a',{agentId:'pi',sessionPath:'/a/new-session'})
      window.captureOpen = () => { window.target = captureWorkbenchDocumentTarget('left') }
      window.isOpenCurrent = () => window.target.isCurrent()
      window.openFromLeft = () => {
        const target = captureWorkbenchDocumentTarget('left')
        useWorkspaceStore.getState().openTab({filePath:'/a/temporary.md',content:'temporary',editorKind:'prose',viewMode:'meo',workspacePath:'/a'})
        const id = useWorkspaceStore.getState().activeTabId
        target(id)
        return id
      }
      window.closeReference = id => useWorkbenchStore.getState().close('left',id)
      window.renameBackgroundFile = () => useWorkspaceStore.getState().renameTab('/a/saved.md','/a/renamed.md')
      window.restoreBackgroundFileName = () => useWorkspaceStore.getState().renameTab('/a/renamed.md','/a/saved.md')
      function App() {
        const [ready,setReady] = useState(false)
        const [selected,setSelected] = useState(projects.projects[0])
        const initialized = useWorkbenchStore(state=>state.initialized)
        const restoring = useWorkbenchStore(state=>state.restoring)
        const project = useWorkbenchStore(state=>state.project)
        window.completeBootstrap = () => { useWorkspaceStore.getState().setCurrentPath('/a'); setReady(true) }
        window.requestProject = id => setSelected(projects.projects.find(project=>project.id===id))
        window.connectProject = id => useWorkspaceStore.getState().setCurrentPath('/'+id)
        useProjectWorkspaceSync({initialized,bootstrapReady:ready,projectState:projects,conversationState:conversations,selectedProject:selected})
        return <output>{initialized && !restoring ? project?.id : 'loading'}</output>
      }
      createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>)
    ` },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' }, alias: { '@': path.resolve('src') },
  })
  const root = await mkdtemp(path.join(os.tmpdir(), 'aryn-workbench-project-lifecycle-'))
  const statePath = path.join(root, 'app-state.json')
  const initial: PersistedWorkbenchLayout = { version: 1, ratio: .58, focusedPane: 'left', panes: {
    left: { directoryOpen: false, directoryTab: 'git', activeTabId: 'draft-a', tabs: [
      { kind: 'file', id: 'saved-file', path: '/a/saved.md', workspacePath: '/a', viewMode: 'meo' },
      { kind: 'conversation', id: 'draft-a', conversationId: null, projectId: 'a', session: null },
    ] },
    right: { directoryOpen: true, directoryTab: 'file', activeTabId: 'b-file', tabs: [
      { kind: 'file', id: 'b-file', path: '/b/saved.md', workspacePath: '/b', viewMode: 'code' },
      { kind: 'file', id: 'slow-file', path: '/slow/saved.md', workspacePath: '/slow', viewMode: 'meo' },
    ] },
  } }
  await new AppStateStore(statePath).update(state => ({ ...state, layout: { ...state.layout, legacyWorkspaceLayout: initial } }))
  const browser = await chromium.launch({ headless: true })
  try {
    for (let launch = 0; launch < 2; launch++) {
      const store = new AppStateStore(statePath)
      const saved = (await store.read()).layout
      const context = await browser.newContext()
      const page = await context.newPage()
      const writes: PersistedProjectWorkspaces[] = []
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.exposeFunction('writeLayout', async (patch: { projectWorkspaces: PersistedProjectWorkspaces }) => {
        writes.push(patch.projectWorkspaces)
        await store.update(state => ({ ...state, layout: { ...state.layout, ...patch } }))
      })
      await page.route('https://workbench.test/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }))
      await page.goto('https://workbench.test/')
      await page.evaluate(value => { (window as any).savedLayout = value }, saved)
      await page.addScriptTag({ content: bundle.outputFiles[0].text })
      await expect.poll(() => page.locator('output').textContent()).toBe('loading')
      await page.waitForTimeout(180)
      expect(writes).toEqual([])
      await page.evaluate(() => (window as any).completeBootstrap())
      await page.waitForTimeout(180)
      expect(writes).toEqual([])
      await page.evaluate(() => (window as any).completeFile('/a/saved.md'))
      await expect.poll(() => page.locator('output').textContent()).toBe('a')
      let actual = await page.evaluate(() => (window as any).inspect())
      expect(actual.panes.left.activeTabId).toBe('draft-a')
      expect(actual.panes.left.directoryOpen).toBe(false)
      expect(actual.documents.map((tab: any) => tab.filePath)).toEqual(['/a/saved.md'])
      if (launch) {
        expect(actual.ratio).toBe(.62)
        expect(actual.focusedPane).toBe('right')
        expect(actual.panes.left.directoryTab).toBe('conversation')
        expect(actual.panes.left.tabs[1]).toMatchObject({ projectSession: { request: { kind: 'session', sessionPath: '/a/new-session' } } })
      } else {
        await page.evaluate(() => (window as any).customizeA())
      }
      const switchTo = async (id: string) => {
        await page.evaluate(id => { (window as any).requestProject(id); (window as any).connectProject(id) }, id)
        await expect.poll(() => page.locator('output').textContent()).toBe(id)
      }
      await page.evaluate(() => { (window as any).captureOpen(); (window as any).requestProject('b') })
      await expect.poll(() => page.locator('output').textContent()).toBe('loading')
      expect(await page.evaluate(() => (window as any).isOpenCurrent())).toBe(false)
      // A save during transition must still belong to A.
      await page.evaluate(() => (window as any).flush())
      expect(writes.at(-1)?.layouts.a.ratio).toBe(.62)
      await page.evaluate(() => (window as any).connectProject('b'))
      await expect.poll(() => page.locator('output').textContent()).toBe('b')
      actual = await page.evaluate(() => (window as any).inspect())
      if (!launch) {
        expect(actual.panes.right.tabs).toHaveLength(1)
        expect(decodeURIComponent(actual.panes.right.tabs[0].id)).toContain('/b/saved.md')
        expect(actual.documents.find((tab: any) => tab.filePath === '/a/saved.md')).toMatchObject({ content: 'private unsaved edit', isDirty: true })
        await page.evaluate(() => { (window as any).closeB(); (window as any).completeBackground() })
      } else {
        expect(actual.panes.left.tabs).toEqual([])
        expect(actual.panes.right.tabs).toEqual([])
        expect(actual.ratio).toBe(.4)
      }
      await switchTo('c')
      actual = await page.evaluate(() => (window as any).inspect())
      expect(actual.panes.left).toMatchObject({ directoryOpen: true, tabs: [{ kind: 'conversation', projectSession: { project: { id: 'c' }, request: { kind: 'new' } } }] })
      expect(actual.panes.right).toMatchObject({ directoryOpen: false, activeTabId: 'app://fixed/files',
        tabs: [{ id: 'app://fixed/files' }, { id: 'app://fixed/git' }] })
      expect(actual.ratio).toBe(.5)
      await page.evaluate(() => (window as any).renameBackgroundFile())
      actual = await page.evaluate(() => (window as any).inspect())
      expect(actual.panes.right.tabs.map((tab: any) => tab.kind)).toEqual(['panel', 'panel'])
      expect(actual.projectLayouts.a.panes.left.tabs[0].id).toContain('renamed.md')
      await page.evaluate(() => (window as any).restoreBackgroundFileName())
      await switchTo('a')
      actual = await page.evaluate(() => (window as any).inspect())
      expect(actual.ratio).toBe(.62)
      expect(actual.panes.left.tabs[1]).toMatchObject({ projectSession: { request: { sessionPath: '/a/new-session' } } })
      expect(actual.panes.right.tabs.map((tab: any) => tab.id)).toEqual(['app://fixed/files', 'app://fixed/git'])
      if (!launch) expect(actual.documents.find((tab: any) => tab.filePath === '/a/saved.md').content).toBe('private unsaved edit')
      // Slow project hydration cannot overwrite A, even after a full round trip.
      await page.evaluate(() => { (window as any).requestProject('slow'); (window as any).connectProject('slow') })
      await expect.poll(() => page.locator('output').textContent()).toBe('loading')
      await page.waitForTimeout(100)
      await switchTo('a')
      await page.evaluate(() => (window as any).completeFile('/slow/saved.md'))
      await page.waitForTimeout(180)
      expect(await page.locator('output').textContent()).toBe('a')
      expect((await page.evaluate(() => (window as any).inspect())).documents.some((tab: any) => tab.filePath === '/slow/saved.md')).toBe(false)
      const openedId = await page.evaluate(() => (window as any).openFromLeft())
      actual = await page.evaluate(() => (window as any).inspect())
      expect(actual.panes.left.activeTabId).toBe(openedId)
      expect(actual.panes.right.tabs.some((tab: any) => tab.id === openedId)).toBe(false)
      await page.evaluate(id => (window as any).closeReference(id), openedId)
      await page.evaluate(() => (window as any).flush())
      const disk = (await new AppStateStore(statePath).read()).layout
      expect(disk.legacyWorkspaceLayout).toEqual(initial) // Original archive survives migration.
      expect(Object.keys(disk.projectWorkspaces!.layouts).sort()).toEqual(['a','b','c','slow'])
      expect(await readFile(statePath, 'utf8')).not.toContain('private unsaved edit')
      expect(errors).toEqual([])
      await context.close()
    }
  } finally {
    await browser.close()
    await rm(root, { recursive: true, force: true })
  }
}, 30000)

import path from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it.each([false, true])('finishes historical conversation validation on StrictMode mount (cached=%s)', async (cached) => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(), loader: 'tsx', contents: `
        import React, { useRef, useState } from 'react'
        import { createRoot } from 'react-dom/client'
        import { useAgentSessionNavigation } from './src/features/agent/hooks/use-agent-session-navigation'
        import { cacheAgentSessionSnapshot } from './src/features/agent/lib/agent-session-snapshot-cache'
        const noop = () => {}
        const workspacePath = '/history'
        if (${cached}) cacheAgentSessionSnapshot('pi', workspacePath, 'session-a', {
          workspacePath, sessionPath: 'session-a', sessionId: 'session-a', messages: [],
        })
        window.appApi = {
          async readAgentSession(scope, sessionPath) {
            await new Promise(resolve => setTimeout(resolve, 30))
            return { workspacePath, sessionPath, sessionId: sessionPath, messages: [] }
          },
          async readAgentSessionInteractionHistory() { return [] },
        }
        function Probe() {
          const [sessionPath, setSessionPath] = useState('session-a')
          const [selection, setSelection] = useState({kind: 'new'})
          const selectionRef = useRef(selection)
          const [snapshot, setSnapshot] = useState(null)
          const [error, setError] = useState(null)
          const result = useAgentSessionNavigation({
            externalRequest: {
              activeConversation: {id: 'history', agentId: 'pi', workspacePath, agentSessionPath: sessionPath},
              activeWorkspaceContext: {kind: 'conversation', conversationId: 'history'},
              hasLoadedWorkspaceState: true, isLoading: false, projectState: {projects: []},
            },
            model: {newSessionModelDraftRef: useRef({}), syncModelDraft: noop, syncNewSessionModelDraft: noop},
            navigation: {
              activeRuntimeSessionRef: useRef(null), activeSessionSelection: selection,
              activeSessionSelectionRef: selectionRef, selectedAgentId: 'pi', selectedAgentIdRef: useRef('pi'),
              setSelectedAgentIdValue: noop,
              syncActiveSessionSelection: next => {selectionRef.current = next; setSelection(next)},
              workspacePath, workspacePathRef: useRef(workspacePath),
            },
            state: {
              agentState: {runtime: {agentId: 'pi', workspacePath}, activeSession: null},
              closeSessionOverlay: noop, resetComposer: noop, setAgentState: noop,
              setPanelError: setError, setViewedSessionSnapshot: setSnapshot,
            },
          })
          return <><button onClick={() => setSessionPath('session-b')}>Next</button>
            <output>{JSON.stringify({loading: result.isSessionSnapshotLoading,
              pending: result.isSessionSnapshotContentPending, snapshot: snapshot?.sessionPath, error})}</output></>
        }
        createRoot(document.getElementById('root')).render(<React.StrictMode><Probe /></React.StrictMode>)
      `,
    },
    bundle: true, write: false, platform: 'browser', format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' },
    alias: { '@': path.resolve('src') },
    plugins: [{
      name: 'session-surface-fixture',
      setup(builder) {
        builder.onResolve({ filter: /bb-session-surface-loader$/ }, () => ({ path: 'surface', namespace: 'fixture' }))
        builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
          contents: 'export const getPreloadedBbSessionSurface = () => ({}); export const preloadBbSessionSurface = async () => ({});',
        }))
      },
    }],
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<div id="root"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await expect.poll(async () => JSON.parse(await page.locator('output').innerText()), { timeout: 2500 }).toEqual({
      loading: false, pending: false, snapshot: 'session-a', error: null,
    })
    // Existing providers in the first two layouts navigate without remounting.
    await page.getByRole('button', { name: 'Next' }).click()
    await expect.poll(async () => JSON.parse(await page.locator('output').innerText()), { timeout: 2500 }).toEqual({
      loading: false, pending: false, snapshot: 'session-b', error: null,
    })
  } finally {
    await browser.close()
  }
})

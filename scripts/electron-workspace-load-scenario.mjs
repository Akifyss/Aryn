import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function prepareWorkspaceLoadScenario(runRoot) {
  const agentDir = path.join(runRoot, 'pi-agent')
  const sessionDir = path.join(agentDir, 'sessions')
  await fs.mkdir(sessionDir, { recursive: true })
  // Real PI RPC initialization, with isolated configuration and no model calls.
  await fs.writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers: {
    fixture: {
      api: 'openai-completions', apiKey: 'fixture-only', baseUrl: 'http://127.0.0.1:1/v1',
      models: [{ id: 'model-a', name: 'Fixture A' }, { id: 'model-b', name: 'Fixture B' }],
    },
  } }))
  await fs.writeFile(path.join(agentDir, 'settings.json'), JSON.stringify({
    defaultProvider: 'fixture', defaultModel: 'model-a', enabledModels: ['fixture/*'],
  }))
  return { PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: sessionDir }
}

export async function runWorkspaceLoadScenario({ page }) {
  page.setDefaultTimeout(30000)
  const loads = await page.evaluate(async () => {
    const { projects } = await window.appApi.getProjectState()
    const project = projects[0]
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => (
      window.appApi.loadAgentWorkspace({ agentId: 'pi', workspacePath: project.path }, null, { restoreSession: false })
    )))
    return results.map(result => result.status === 'fulfilled'
      ? { status: result.status, session: result.value.activeSession, configured: result.value.runtime.hasConfiguredModels }
      : { status: result.status, error: String(result.reason) })
  })
  assert.deepEqual(loads, Array.from({ length: 3 }, () => ({ status: 'fulfilled', session: null, configured: true })))
  await page.evaluate(() => localStorage.setItem('aryn:last-new-conversation-agent', 'pi'))
  for (const side of ['左', '左', '右']) {
    await page.getByRole('button', { name: `${side}侧新建标签页`, exact: true }).click()
    await page.getByRole('menuitem', { name: '新对话', exact: true }).click()
  }
  const tabCount = await page.locator('.workbench-conversation-view').count()
  assert.ok(tabCount >= 3)
  const waitReady = () => page.waitForFunction(expectedCount => {
    const tabs = [...document.querySelectorAll('.workbench-conversation-view')]
    return tabs.length === expectedCount && tabs.every(tab => {
      const model = tab.querySelector('.agent-model-cascader-trigger')
      return model && !model.disabled && !tab.querySelector('[role="alert"]')
    })
  }, tabCount)
  await waitReady()
  // Wait for the actual Workbench persistence write before replaying startup.
  await page.waitForFunction(async expectedCount => {
    const state = await window.appApi.initializePersistentState({})
    return Object.values(state.app.layout.projectWorkspaces?.layouts ?? {}).some(layout => (
      Object.values(layout.panes).flatMap(pane => pane.tabs).filter(tab => tab.kind === 'conversation').length === expectedCount
    ))
  }, tabCount)
  for (let reload = 0; reload < 2; reload += 1) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitReady()
    assert.equal(await page.locator('.workbench-conversation-view [role="alert"]').count(), 0)
  }
  const visibleEditors = page.locator('.workbench-conversation-view:not([hidden]) .agent-composer-editor')
  assert.equal(await visibleEditors.count(), 2)
  await visibleEditors.nth(0).fill('Left draft stays independent')
  await visibleEditors.nth(1).fill('Right draft stays independent')
  const enabledSendButtons = page.locator('.workbench-conversation-view:not([hidden]) button[type="submit"]:enabled')
  await enabledSendButtons.nth(1).waitFor()
  assert.equal(await enabledSendButtons.count(), 2)
  return {
    concurrentIpcLoads: loads,
    restoredTabs: await page.locator('.workbench-conversation-view').count(),
    reloads: 2,
    readyVisibleComposers: 2,
    alerts: await page.locator('.workbench-conversation-view [role="alert"]').allTextContents(),
  }
}

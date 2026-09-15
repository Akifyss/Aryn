import assert from 'node:assert/strict'
import path from 'node:path'
import { observeTerminalConfirmations } from './electron-terminal-confirmation.mjs'

// Uses the existing isolated Electron debug profile. Keep the Unix launch check
// independent of Windows PSReadLine/PowerShell assertions in the full scenario.
export async function runPosixTerminalScenario({ app, page, artifactRoot }) {
  page.setDefaultTimeout(20000)
  const project = await page.evaluate(async () => {
    const state = await window.appApi.getProjectState()
    return state.projects.find(project => project.id === state.lastProjectId)
  })
  assert(project, 'Terminal debug workspace has no selected project in ProjectState.lastProjectId')
  const { dialog, dialogCount, waitDialog } = await observeTerminalConfirmations({ app, page })
  const surface = page.locator('#workbench-right [data-terminal-surface]:visible')
  const open = async () => {
    await page.getByRole('button', { name: '右侧新建标签页', exact: true }).click()
    await page.getByRole('menuitem', { name: '终端', exact: true }).click()
    await surface.getByText('运行中', { exact: true }).waitFor()
    return surface.getAttribute('data-terminal-id')
  }
  let id = await open()
  const snapshot = () => page.evaluate(({ id, projectId }) => window.appApi.terminal.open({ id, projectId, cols: 80, rows: 24 }), { id, projectId: project.id })
  const waitOutput = async pattern => {
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      const value = await snapshot()
      if (pattern.test(value.screen)) return value
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.fail(`Terminal output missing ${pattern}: ${(await snapshot()).screen.slice(-2000)}`)
  }
  const command = async value => {
    await surface.locator('textarea').first().focus()
    await page.keyboard.type(value)
    await page.keyboard.press('Enter')
  }
  const restart = async () => {
    const oldInput = await surface.locator('textarea').first().elementHandle()
    await surface.getByRole('button', { name: '重新启动终端', exact: true }).click()
    await page.waitForFunction(node => !node.isConnected, oldInput)
    await oldInput.dispose()
    await surface.getByText('运行中', { exact: true }).waitFor()
  }
  await command("printf 'ARYN_%s\\n' 'POSIX_READY'; printf '%s%s\\n' '中文' '终端'; pwd")
  const ready = await waitOutput(/ARYN_POSIX_READY/)
  await waitOutput(/中文终端/)
  await waitOutput(new RegExp(path.basename(project.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.notEqual(ready.shell, 'PowerShell')
  const close = () => page.locator('#workbench-right').getByRole('button', { name: 'Close 终端', exact: true }).click({ force: true })
  // The shell itself executes this loop: no child PID can tell us it is busy.
  await command("printf 'BUSY_%s\\n' READY; while true; do :; done")
  await waitOutput(/BUSY_READY/)
  await close()
  await waitDialog(1)
  await dialog.getByRole('heading', { name: '任务仍在运行，关闭终端？', exact: true }).waitFor()
  await page.screenshot({ path: path.join(artifactRoot, 'terminal-close-confirmation.png') })
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  assert.equal((await snapshot()).generation, ready.generation) // Cancel preserves the running shell.
  await surface.locator('textarea').first().focus()
  await page.keyboard.press('Control+c')
  await command("printf 'IDLE_%s\\n' READY")
  await waitOutput(/IDLE_READY/)
  await restart()
  await command("printf 'IDLE_RESTART_%s\\n' OK")
  await waitOutput(/IDLE_RESTART_OK/)
  assert.equal(await dialogCount(), 1)
  const restarted = await snapshot()
  assert.notEqual(restarted.generation, ready.generation)
  await command('exit 7')
  await surface.getByText('已退出 · 7', { exact: true }).waitFor()
  assert.equal((await snapshot()).exitCode, 7)
  await restart()
  assert.notEqual((await snapshot()).generation, restarted.generation)
  await command("printf 'RESTART_%s\\n' 'OK'")
  await waitOutput(/RESTART_OK/)
  await command('exit')
  await surface.getByText('已退出 · 0', { exact: true }).waitFor()
  await close()
  await surface.waitFor({ state: 'detached' })
  assert.equal(await dialogCount(), 1)
  id = await open()
  await command("printf 'FRESH_%s\\n' IDLE")
  await waitOutput(/FRESH_IDLE/)
  await close()
  await surface.waitFor({ state: 'detached' })
  assert.equal(await dialogCount(), 1)
  return { ok: true, shell: ready.shell, checks: ['native-shell', 'cwd', 'CJK-input', 'builtin-close-cancel',
    'idle-restart-without-dialog', 'exit-code', 'restart', 'exited-close-without-dialog', 'idle-close-without-dialog'] }
}

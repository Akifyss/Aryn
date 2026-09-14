import assert from 'node:assert/strict'
import path from 'node:path'

// Uses the existing isolated Electron debug profile. Keep the Unix launch check
// independent of Windows PSReadLine/PowerShell assertions in the full scenario.
export async function runPosixTerminalScenario({ app, page }) {
  page.setDefaultTimeout(20000)
  const project = await page.evaluate(async () => {
    const state = await window.appApi.getProjectState()
    return state.projects.find(project => project.id === state.lastProjectId)
  })
  assert(project, 'Terminal debug workspace has no selected project in ProjectState.lastProjectId')
  await app.evaluate(({ dialog }) => {
    globalThis.__terminalCloseDialogs = []
    dialog.showMessageBox = async (...args) => {
      globalThis.__terminalCloseDialogs.push(args.at(-1))
      return { response: 0, checkboxChecked: false }
    }
  })
  await page.getByRole('button', { name: '右侧新建标签页', exact: true }).click()
  await page.getByRole('menuitem', { name: '终端', exact: true }).click()
  const surface = page.locator('#workbench-right [data-terminal-surface]:visible')
  await surface.getByText('运行中', { exact: true }).waitFor()
  const id = await surface.getAttribute('data-terminal-id')
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
  await command("printf 'ARYN_%s\\n' 'POSIX_READY'; printf '%s%s\\n' '中文' '终端'; pwd")
  const ready = await waitOutput(/ARYN_POSIX_READY/)
  await waitOutput(/中文终端/)
  await waitOutput(new RegExp(path.basename(project.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.notEqual(ready.shell, 'PowerShell')
  await command('exit 7')
  await surface.getByText('已退出 · 7', { exact: true }).waitFor()
  assert.equal((await snapshot()).exitCode, 7)
  await surface.getByRole('button', { name: '重新启动终端', exact: true }).click()
  await surface.getByText('运行中', { exact: true }).waitFor()
  assert.notEqual((await snapshot()).generation, ready.generation)
  await command("printf 'RESTART_%s\\n' 'OK'")
  await waitOutput(/RESTART_OK/)
  await command('exit')
  await surface.getByText('已退出 · 0', { exact: true }).waitFor()
  await page.locator('#workbench-right').getByRole('button', { name: 'Close 终端', exact: true }).click({ force: true })
  await surface.waitFor({ state: 'detached' })
  assert.equal(await app.evaluate(() => globalThis.__terminalCloseDialogs.length), 0)
  return { ok: true, shell: ready.shell, checks: ['native-shell', 'cwd', 'CJK-input', 'exit-code', 'restart', 'exited-close-without-dialog'] }
}

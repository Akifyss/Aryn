import assert from 'node:assert/strict'
import path from 'node:path'
import fs from 'node:fs/promises'

// Uses the isolated profile created by electron-debug-session.mjs. Native
// dialogs are answered in the test process, never in the user's desktop session.
export async function runTerminalScenario({ app, page, artifactRoot }) {
  if (process.platform !== 'win32') {
    return (await import('./electron-terminal-posix-scenario.mjs')).runPosixTerminalScenario({ app, page })
  }
  page.setDefaultTimeout(20000)
  const project = await page.evaluate(async () => {
    const state = await window.appApi.getProjectState()
    return state.projects.find(project => project.id === state.activeProjectId) ?? state.projects[0]
  })
  assert(project)
  await app.evaluate(({ dialog }) => {
    globalThis.__terminalCloseDialogs = []
    globalThis.__terminalCloseResponse = 0
    dialog.showMessageBox = async (...args) => {
      globalThis.__terminalCloseDialogs.push(args.at(-1))
      if (globalThis.__terminalDeferClose) return new Promise(resolve => { globalThis.__terminalResolveClose = resolve })
      return { response: globalThis.__terminalCloseResponse, checkboxChecked: false }
    }
  })
  const dialogCount = () => app.evaluate(() => globalThis.__terminalCloseDialogs.length)
  const waitDialog = async count => {
    const end = Date.now() + 10000
    while (Date.now() < end) {
      if (await dialogCount() === count) return
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.fail(`Expected ${count} terminal confirmations`)
  }
  const dead = async pid => {
    const end = Date.now() + 5000
    while (Date.now() < end) {
      try { process.kill(pid, 0) } catch { return true }
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    return false
  }
  const open = async side => {
    await page.getByRole('button', { name: `${side === 'left' ? '左' : '右'}侧新建标签页`, exact: true }).click()
    await page.getByRole('menuitem', { name: '终端', exact: true }).click()
    const surface = page.locator(`#workbench-${side} [data-terminal-surface]:visible`)
    await surface.getByText('运行中', { exact: true }).waitFor()
    return surface.getAttribute('data-terminal-id')
  }
  const id = await open('right')
  const snapshot = () => page.evaluate(({ id, projectId }) => window.appApi.terminal.open({ id, projectId, cols: 80, rows: 24 }), { id, projectId: project.id })
  const waitOutput = async pattern => {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const state = await snapshot()
      if (pattern.test(state.screen)) return state
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    throw new Error(`Terminal output missing ${pattern}: ${(await snapshot()).screen.slice(-3000)}`)
  }
  const input = () => page.locator(`[data-terminal-id="${id}"] textarea`).first()
  await waitOutput(/PS .*?>/)
  await input().focus()
  await page.keyboard.type("Write-Output ('ARYN_' + 'READY'); Write-Output ('SHELLPID=' + $PID); Write-Output (Get-Location).Path")
  await page.keyboard.press('Enter')
  const ready = await waitOutput(/ARYN_READY/)
  assert(ready.screen.includes(project.path))
  const originalGeneration = ready.generation
  const shellPid = Number((await waitOutput(/SHELLPID=\d+/)).screen.match(/SHELLPID=(\d+)/)[1])

  // Use real textarea input for CJK and terminal editing chords.
  await page.keyboard.type("Write-Output ('中文' + '终端')")
  await page.keyboard.press('Enter')
  await waitOutput(/中文终端/)
  await page.keyboard.type('will-be-deleted')
  await page.keyboard.press('Escape') // PowerShell's default RevertLine binding.
  await page.keyboard.type("Write-Output ('KEY_' + 'OK')")
  await page.keyboard.press('Enter')
  await waitOutput(/KEY_OK/)
  await app.evaluate(({ clipboard }) => clipboard.writeText("Write-Output ('PASTE_' + 'OK')"))
  await page.locator(`[data-terminal-id="${id}"]`).getByRole('button', { name: '粘贴到终端', exact: true }).click()
  await page.keyboard.press('Enter')
  await waitOutput(/PASTE_OK/)

  // Move the actual DOM-backed tab and prove that the shell and textarea survive.
  const beforeMove = await input().elementHandle()
  await page.locator('#workbench-right .file-tab').filter({ has: page.getByRole('tab', { name: '终端', exact: true }) }).hover()
  await page.locator('#workbench-right').getByRole('button', { name: /将 终端 .*左侧/ }).click()
  await page.locator(`#workbench-left [data-terminal-id="${id}"]`).waitFor({ state: 'visible' })
  assert.equal(await input().evaluate((node, previous) => node === previous, beforeMove), true)
  assert.equal((await snapshot()).generation, originalGeneration)

  const peerId = await open('right')
  assert.notEqual(peerId, id)
  await page.locator('#workbench-left').getByRole('tab', { name: '终端', exact: true }).click({ position: { x: 18, y: 16 } })
  await input().focus()
  await page.keyboard.type("1..600 | ForEach-Object { Write-Output ('history-' + $_) }; Write-Output ('TAIL_' + 'OK')")
  await page.keyboard.press('Enter')
  await waitOutput(/TAIL_OK/)
  const terminalSurface = page.locator(`[data-terminal-id="${id}"]`)
  await terminalSurface.getByRole('button', { name: '查找终端内容', exact: true }).click()
  await terminalSurface.getByRole('textbox', { name: '查找终端内容', exact: true }).fill('history-100')
  await terminalSurface.getByRole('button', { name: '复制终端选中内容', exact: true }).click()
  assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'history-100')
  await terminalSurface.getByRole('textbox', { name: '查找终端内容', exact: true }).fill('this-string-does-not-exist')
  await terminalSurface.getByText('无匹配项', { exact: true }).waitFor()
  await terminalSurface.getByRole('button', { name: '关闭终端查找', exact: true }).click()
  const scrollbar = page.locator(`[data-terminal-id="${id}"] .terminal-scroll-proxy`)
  await scrollbar.evaluate(element => { element.scrollTop = 0 })
  await page.waitForTimeout(100)
  assert(await scrollbar.evaluate(element => element.scrollHeight > element.clientHeight + 100))
  await scrollbar.evaluate(element => { element.scrollTop = element.scrollHeight })

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 820))
  await page.waitForTimeout(250)
  const resized = await snapshot()
  assert(resized.cols > 10 && resized.cols < 160)
  const geometry = await page.locator(`[data-terminal-id="${id}"] .terminal-viewport`).evaluate(host => {
    const screen = host.querySelector('.xterm-screen').getBoundingClientRect()
    const viewport = host.getBoundingClientRect()
    return { screenWidth: screen.width, screenHeight: screen.height, viewportWidth: viewport.width, viewportHeight: viewport.height }
  })
  assert(geometry.screenWidth <= geometry.viewportWidth - 16, JSON.stringify(geometry))
  assert(geometry.screenHeight <= geometry.viewportHeight - 12, JSON.stringify(geometry))
  await page.screenshot({ path: path.join(artifactRoot, 'terminal-light.png') })
  const light = await page.locator(`[data-terminal-id="${id}"] .xterm-scrollable-element`).evaluate(node => getComputedStyle(node).backgroundColor)
  await page.evaluate(() => {
    for (const node of [document.documentElement, document.body]) { node.classList.remove('light'); node.classList.add('dark') }
    document.documentElement.setAttribute('data-theme', 'dark')
  })
  await page.waitForTimeout(150)
  const dark = await page.locator(`[data-terminal-id="${id}"] .xterm-scrollable-element`).evaluate(node => getComputedStyle(node).backgroundColor)
  assert.notEqual(dark, light)
  await page.screenshot({ path: path.join(artifactRoot, 'terminal-dark.png') })
  await page.evaluate(() => {
    for (const node of [document.documentElement, document.body]) { node.classList.remove('dark'); node.classList.add('light') }
    document.documentElement.setAttribute('data-theme', 'light')
  })

  // Reload the renderer: persisted tabs reattach to the existing live process.
  await page.waitForTimeout(500)
  await page.reload()
  await page.locator(`[data-terminal-id="${id}"]`).waitFor({ state: 'visible' })
  assert.equal((await snapshot()).generation, originalGeneration)
  await waitOutput(/TAIL_OK/)

  // A different project must not adopt this terminal or end its background shell.
  await page.evaluate(() => window.appApi.createEmptyProject('Terminal QA peer'))
  await page.reload()
  const switchProject = async name => {
    // Project navigation closes its menu after asynchronous workspace hydration.
    // Wait for its enabled menu state; a rapid next request may open while the
    // previous navigation is still closing the controlled popup.
    const deadline = Date.now() + 20000
    let selected = false
    while (Date.now() < deadline) {
      const trigger = page.locator('.workbench-workspace-switch')
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
      const item = page.getByRole('menuitem', { name, exact: true })
      if (await item.isVisible() && await item.isEnabled()) { await item.click(); selected = true; break }
      await page.waitForTimeout(100)
    }
    assert(selected, `Project menu did not become ready for ${name}`)
    await page.locator('.workbench-workspace-switch').filter({ hasText: name }).waitFor()
    await page.getByRole('menu').waitFor({ state: 'hidden' })
  }
  await page.locator('.workbench-workspace-switch').filter({ hasText: 'Terminal QA peer' }).waitFor()
  assert.equal(await page.locator(`[data-terminal-id="${id}"]:visible`).count(), 0)
  await switchProject(project.name)
  await terminalSurface.waitFor({ state: 'visible' })
  await terminalSurface.getByText('运行中', { exact: true }).waitFor()
  const beforeProjectSwitch = await input().elementHandle()
  await switchProject('Terminal QA peer')
  await terminalSurface.waitFor({ state: 'hidden' })
  await switchProject(project.name)
  await terminalSurface.waitFor({ state: 'visible' })
  assert.equal(await input().evaluate((node, previous) => node === previous, beforeProjectSwitch), true)
  assert.equal((await snapshot()).generation, originalGeneration)

  await input().focus()
  await page.keyboard.type('node -e "setTimeout(()=>process.stdout.write((\'background\\r\\n\').repeat(100000),()=>{require(\'fs\').writeFileSync(\'terminal-background-done\',\'done\');console.log(\'BACKGROUND_\'+\'DONE\')}),2000)"')
  await page.keyboard.press('Enter')
  await switchProject('Terminal QA peer')
  await page.reload()
  await page.locator('.workbench-workspace-switch').filter({ hasText: 'Terminal QA peer' }).waitFor()
  assert.equal(await page.locator(`[data-terminal-id="${id}"]:visible`).count(), 0)
  const marker = path.join(project.path, 'terminal-background-done')
  const backgroundDeadline = Date.now() + 20000
  let completed = false
  while (Date.now() < backgroundDeadline) {
    if (await fs.readFile(marker, 'utf8').catch(() => '') === 'done') { completed = true; break }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert(completed, 'Background command stalled while no renderer was attached')
  await switchProject(project.name)
  await terminalSurface.getByText('运行中', { exact: true }).waitFor()
  assert.equal((await snapshot()).generation, originalGeneration)
  await waitOutput(/BACKGROUND_DONE[\s\S]*PS [^>]+>/)

  // The shell stays interactive after Ctrl+C terminates a foreground child.
  await input().focus()
  await page.keyboard.type('node -e "console.log(\'CHILD_PID=\'+process.pid);setInterval(()=>{},1000)"')
  await page.keyboard.press('Enter')
  const childState = await waitOutput(/CHILD_PID=\d+/)
  const childPid = Number(childState.screen.match(/CHILD_PID=(\d+)/)[1])
  await page.keyboard.press('Control+c')
  assert(await dead(childPid), `child ${childPid} survived Ctrl+C`)
  await waitOutput(/CHILD_PID=\d+[\s\S]*PS [^>]+>/)
  await page.keyboard.type("Write-Output ('INTERRUPT_' + 'OK')")
  await page.keyboard.press('Enter')
  await waitOutput(/INTERRUPT_OK/)
  await page.keyboard.type("Write-Output ('BUILTIN_' + 'READY'); Start-Sleep -Seconds 60")
  await page.keyboard.press('Enter')
  await waitOutput(/BUILTIN_READY/)
  await page.locator('#workbench-left').getByRole('button', { name: 'Close 终端', exact: true }).click({ force: true })
  await waitDialog(1)
  assert.equal(await app.evaluate(() => globalThis.__terminalCloseDialogs[0].message), '任务仍在运行，关闭终端？')
  assert.equal((await snapshot()).generation, originalGeneration)
  await input().focus()
  await page.keyboard.press('Control+c')
  await waitOutput(/BUILTIN_READY[\s\S]*PS [^>]+>/)
  await page.keyboard.type('node -e "console.log(\'CLOSE_CHILD=\'+process.pid);setInterval(()=>{},1000)"')
  await page.keyboard.press('Enter')
  const closeChildPid = Number((await waitOutput(/CLOSE_CHILD=\d+/)).screen.match(/CLOSE_CHILD=(\d+)/)[1])

  await page.locator('#workbench-left').getByRole('button', { name: 'Close 终端', exact: true }).click({ force: true })
  await waitDialog(2)
  assert.match(await app.evaluate(() => globalThis.__terminalCloseDialogs[1].detail), /node\.exe/)
  assert.equal((await snapshot()).generation, originalGeneration)
  await app.evaluate(() => { globalThis.__terminalCloseResponse = 1; globalThis.__terminalDeferClose = true })
  await page.locator('#workbench-left').getByRole('button', { name: 'Close 终端', exact: true }).click({ force: true })
  await waitDialog(3)
  // A delayed close completion belongs to this terminal, even if its pane and
  // active project have changed. The isolated dialog stub leaves UI operable.
  await page.locator('#workbench-left .file-tab').filter({ has: page.getByRole('tab', { name: '终端', exact: true }) }).hover()
  await page.locator('#workbench-left').getByRole('button', { name: /将 终端 .*右侧/ }).click()
  await switchProject('Terminal QA peer')
  await app.evaluate(() => {
    globalThis.__terminalDeferClose = false
    globalThis.__terminalResolveClose({ response: 1, checkboxChecked: false })
  })
  await page.locator(`[data-terminal-id="${id}"]`).waitFor({ state: 'detached' })
  await switchProject(project.name)
  assert.equal(await page.getByRole('tab', { name: '终端', exact: true }).count(), 0, 'A closed terminal must not remain in a moved/background layout')
  assert(await dead(shellPid), `shell ${shellPid} leaked after closing tab`)
  assert(await dead(closeChildPid), `child ${closeChildPid} leaked after closing tab`)

  const peerSurface = page.locator(`[data-terminal-id="${peerId}"]`)
  const peerSnapshot = () => page.evaluate(({ id, projectId }) => window.appApi.terminal.open({ id, projectId, cols: 80, rows: 24 }), { id: peerId, projectId: project.id })
  const peerGeneration = (await peerSnapshot()).generation
  await peerSurface.locator('textarea').focus()
  await page.keyboard.type('exit 7')
  await page.keyboard.press('Enter')
  await peerSurface.getByText('已退出 · 7', { exact: true }).waitFor()
  assert.equal((await peerSnapshot()).exitCode, 7)
  await peerSurface.getByRole('button', { name: '重新启动终端', exact: true }).click()
  await peerSurface.getByText('运行中', { exact: true }).waitFor()
  assert.notEqual((await peerSnapshot()).generation, peerGeneration)
  assert.equal(await dialogCount(), 3, 'An exited shell must restart without confirmation')
  const readyDeadline = Date.now() + 10000
  while (!/PS [^>]+>/.test((await peerSnapshot()).screen)) {
    assert(Date.now() < readyDeadline, 'Restarted PowerShell never became ready')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await page.locator('#workbench-right').getByRole('button', { name: /Close 终端/ }).click({ force: true })
  await peerSurface.waitFor({ state: 'detached' })
  assert.equal(await dialogCount(), 3, 'An idle shell must close without confirmation')
  return { ok: true, projectPath: project.path, shellPid, childPid, restoredGeneration: originalGeneration,
    resizedCols: resized.cols, geometry, checks: ['native-shell', 'cwd', 'CJK-input', 'editing-chord', 'clipboard-paste', 'pane-move', 'multiple-terminals',
      'search', 'clipboard-copy', 'scrollback', 'resize', 'themes', 'renderer-reattach', 'project-switch', 'detached-background-output', 'Ctrl+C',
      'builtin-close-cancel', 'close-cancel', 'close-after-pane-and-project-move', 'process-cleanup', 'exit-code', 'restart', 'idle-close-without-dialog'] }
}

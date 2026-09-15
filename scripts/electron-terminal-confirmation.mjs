import assert from 'node:assert/strict'

// Observe the real IPC and operate the real app dialog. A native-dialog
// regression fails explicitly instead of hanging an unattended CI runner.
export async function observeTerminalConfirmations({ app, page }) {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => { throw new Error('Terminal confirmation must use the app dialog') }
  })
  await page.evaluate(() => {
    window.__terminalCloseRequests = []
    window.appApi.terminal.onCloseConfirmation(request => window.__terminalCloseRequests.push(request))
  })
  const dialog = page.getByRole('alertdialog')
  return {
    dialog,
    dialogCount: () => page.evaluate(() => window.__terminalCloseRequests.length),
    waitDialog: async count => {
      await page.waitForFunction(count => window.__terminalCloseRequests.length === count, count)
      await dialog.waitFor({ state: 'visible' })
      await page.waitForFunction(() => document.activeElement?.textContent === '取消')
      await page.waitForFunction(() => {
        const popup = document.querySelector('[role="alertdialog"]')
        return popup && getComputedStyle(popup).opacity === '1'
      })
      assert.equal(await dialog.getByRole('button', { name: '取消', exact: true }).count(), 1)
    },
  }
}

import fs from 'node:fs/promises'
import { _electron as electron } from 'playwright'

const app = await electron.launch({
  args: ['.'],
  env: {
    ...process.env,
    ARYN_ELECTRON_DEBUG: '1',
  },
})

try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1500)

  const nativeWindowControls = await app.evaluate(({ BrowserWindow }) => {
    const targetWindow = BrowserWindow.getAllWindows()[0]
    const platform = process.platform

    return {
      platform,
      windowButtonPosition: platform === 'darwin'
        ? targetWindow?.getWindowButtonPosition?.() ?? null
        : null,
    }
  })

  const before = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell')
    const readHit = (selector) => {
      const element = document.querySelector(selector)
      if (!element) {
        return null
      }

      const rect = element.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top + rect.height / 2
      const hit = document.elementFromPoint(x, y)

      return {
        selector,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
        hitClassName: hit?.className ?? null,
        hitTag: hit?.tagName ?? null,
        pointerEvents: getComputedStyle(element).pointerEvents,
      }
    }

    return {
      shell: shell
        ? {
            left: shell.getAttribute('data-left-collapsed'),
            right: shell.getAttribute('data-right-collapsed'),
          }
        : null,
      leftToggle: readHit('.panel-toggle-button-overlay-left'),
      rightToggle: readHit('.panel-toggle-button-overlay-right'),
      windowClose: readHit('.window-button-close'),
    }
  })

  await page.screenshot({ path: '/tmp/awa-playwright.png' })

  let leftError = null
  let rightError = null

  try {
    await page.click('.panel-toggle-button-overlay-left', { timeout: 1500 })
  } catch (error) {
    leftError = error instanceof Error ? error.message : String(error)
  }

  await page.waitForTimeout(250)
  const afterLeft = await page.locator('.app-shell').getAttribute('data-left-collapsed')

  try {
    await page.click('.panel-toggle-button-overlay-right', { timeout: 1500 })
  } catch (error) {
    rightError = error instanceof Error ? error.message : String(error)
  }

  await page.waitForTimeout(250)
  const afterRight = await page.locator('.app-shell').getAttribute('data-right-collapsed')

  const report = {
    afterLeft,
    afterRight,
    before,
    leftError,
    nativeWindowControls,
    rightError,
  }

  await fs.writeFile('/tmp/awa-playwright.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  const processHandle = app.process()

  let closed = false
  await Promise.race([
    app.close()
      .then(() => {
        closed = true
      })
      .catch(() => {
        closed = true
      }),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ])

  if (!closed && processHandle && !processHandle.killed) {
    processHandle.kill()
  }
}

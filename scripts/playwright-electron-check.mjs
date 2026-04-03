import fs from 'node:fs/promises'
import { _electron as electron } from 'playwright'

const app = await electron.launch({
  args: ['dist-electron/main/index.js'],
})

try {
  const page = await app.firstWindow()
  await page.waitForTimeout(1500)

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
      trafficClose: readHit('.traffic-close'),
    }
  })

  await page.screenshot({ path: '/tmp/awa-playwright.png' })

  let leftError = null
  let rightError = null
  let closeError = null

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

  try {
    await page.click('.traffic-close', { timeout: 1500 })
  } catch (error) {
    closeError = error instanceof Error ? error.message : String(error)
  }

  const report = {
    afterLeft,
    afterRight,
    before,
    closeError,
    leftError,
    rightError,
  }

  await fs.writeFile('/tmp/awa-playwright.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await app.close().catch(() => {})
}

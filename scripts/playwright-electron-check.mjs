import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactRoot = path.join(rootDir, 'tmp', 'playwright-electron-check')
const runRoot = path.join(artifactRoot, 'run')
const appDataRoot = path.join(runRoot, 'appdata')
const localAppDataRoot = path.join(runRoot, 'localappdata')
const tempRoot = path.join(runRoot, 'temp')
const workspacePath = path.join(runRoot, 'workspace')
const filePath = path.join(workspacePath, 'debug.md')
const reportPath = path.join(artifactRoot, 'report.json')
const screenshotPath = path.join(artifactRoot, 'screenshot.png')
const tabStorageKey = `aryn:workspace-tabs:${workspacePath}`

await fs.rm(runRoot, { force: true, recursive: true })
await fs.mkdir(appDataRoot, { recursive: true })
await fs.mkdir(localAppDataRoot, { recursive: true })
await fs.mkdir(tempRoot, { recursive: true })
await fs.mkdir(workspacePath, { recursive: true })
await fs.writeFile(filePath, '# Electron chrome check\n\nTemporary workspace fixture.\n', 'utf8')

function assert(condition, message, details) {
  if (!condition) {
    throw new Error(`${message}\n${JSON.stringify(details, null, 2)}`)
  }
}

function readShellChromeState() {
  const readHit = (selector) => {
    const element = document.querySelector(selector)

    if (!element) {
      return null
    }

    const rect = element.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)

    return {
      hitClassName: typeof hit?.className === 'string' ? hit.className : null,
      hitLabel: hit?.getAttribute('aria-label') ?? hit?.closest('[aria-label]')?.getAttribute('aria-label') ?? null,
      hitTag: hit?.tagName ?? null,
      pointerEvents: getComputedStyle(element).pointerEvents,
      rect: {
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      },
    }
  }

  return {
    shell: {
      appLayout: document.querySelector('.app-shell')?.getAttribute('data-app-layout') ?? null,
      layout: document.querySelector('.app-shell')?.getAttribute('data-layout') ?? null,
      leftCollapsed: document.querySelector('.app-shell')?.getAttribute('data-left-collapsed') ?? null,
      leftDrawerOpen: document.querySelector('.app-shell')?.getAttribute('data-left-drawer-open') ?? null,
      rightCollapsed: document.querySelector('.app-shell')?.getAttribute('data-right-collapsed') ?? null,
      rightDrawerOpen: document.querySelector('.app-shell')?.getAttribute('data-right-drawer-open') ?? null,
    },
    chrome: {
      drawerSwitchCount: document.querySelectorAll('.workspace-sidebar-surface.is-drawer .layout-mode-segmented-control').length,
      leftChromeElevated: document.querySelector('.left-chrome-actions')?.getAttribute('data-overlay-elevated') ?? null,
      leftChromeSurface: document.querySelector('.left-chrome-actions')?.getAttribute('data-left-surface') ?? null,
      titlebarSwitchCount: document.querySelectorAll('.titlebar .layout-mode-segmented-control').length,
    },
    hits: {
      drawerSearch: readHit('.workspace-sidebar-surface.is-drawer .left-chrome-search-button'),
      drawerToggle: readHit('.workspace-sidebar-surface.is-drawer .panel-toggle-button:not(.left-chrome-search-button)'),
      rightToggle: readHit('.panel-toggle-button-overlay-right'),
      titlebarSwitch: readHit('.titlebar .layout-mode-segmented-control'),
      windowClose: readHit('.window-button-close'),
    },
  }
}

const app = await electron.launch({
  args: [rootDir],
  env: {
    ...process.env,
    APPDATA: appDataRoot,
    ARYN_ELECTRON_DEBUG: '1',
    ELECTRON_ENABLE_LOGGING: '1',
    LOCALAPPDATA: localAppDataRoot,
    TEMP: tempRoot,
    TMP: tempRoot,
  },
  timeout: 30_000,
})

try {
  const page = await app.firstWindow()

  await page.waitForFunction(() => !!window.appApi, null, { timeout: 30_000 })
  await page.waitForSelector('.app-shell', { timeout: 30_000 })
  await page.evaluate(
    ({ filePath, storageKey, workspacePath }) => {
      window.localStorage.setItem(storageKey, JSON.stringify({
        activePath: filePath,
        entries: [{ path: filePath, viewMode: 'meo' }],
        paths: [filePath],
      }))
      window.localStorage.setItem('aryn:left-sidebar-collapsed', 'false')
      window.localStorage.setItem('aryn:right-sidebar-collapsed', 'false')

      return Promise.all([
        window.appApi.updateSettingsState({
          layoutPreference: 'editor',
          meo: {
            focusedLineHighlight: false,
            gitDiffLineHighlights: true,
            imageFolder: 'assets',
            outlinePosition: 'right',
          },
          theme: 'auto',
        }),
        window.appApi.updateWorkspaceState(workspacePath, {
          lastFilePath: filePath,
          markAsLastOpened: true,
        }),
      ])
    },
    {
      filePath,
      storageKey: tabStorageKey,
      workspacePath,
    },
  )
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForSelector('.app-shell', { timeout: 30_000 })

  const nativeWindowControls = await app.evaluate(({ BrowserWindow }) => {
    const targetWindow = BrowserWindow.getAllWindows()[0]
    const platform = process.platform

    targetWindow?.setSize(1000, 760)

    return {
      platform,
      windowButtonPosition: platform === 'darwin'
        ? targetWindow?.getWindowButtonPosition?.() ?? null
        : null,
    }
  })

  await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-layout') === 'focus', null, { timeout: 30_000 })
  await page.waitForTimeout(300)

  const initial = await page.evaluate(readShellChromeState)

  assert(initial.shell.appLayout === 'editor', 'fixture must start in editor layout', initial)
  assert(initial.shell.layout === 'focus', 'fixture must start in focus shell layout', initial)

  await page.getByLabel('Open workspace panel').click({ timeout: 5_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-left-drawer-open') === 'true', null, { timeout: 5_000 })
  await page.waitForTimeout(800)

  const leftDrawer = await page.evaluate(readShellChromeState)

  assert(leftDrawer.chrome.drawerSwitchCount === 0, 'layout switch must not render inside the left drawer', leftDrawer)
  assert(leftDrawer.chrome.titlebarSwitchCount === 1, 'layout switch must stay in the titlebar', leftDrawer)
  assert(leftDrawer.chrome.leftChromeSurface === 'drawer', 'titlebar switch should use drawer surface state while the left drawer is open', leftDrawer)
  assert(leftDrawer.chrome.leftChromeElevated === 'true', 'titlebar switch should remain above the left drawer backdrop', leftDrawer)
  assert(leftDrawer.hits.drawerSearch?.hitLabel === 'Open search', 'left drawer search button is not clickable at its center', leftDrawer)
  assert(leftDrawer.hits.drawerToggle?.hitLabel === 'Close workspace panel', 'left drawer sidebar toggle is not clickable at its center', leftDrawer)

  await page.getByLabel('Close workspace panel').click({ timeout: 5_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-left-drawer-open') === 'false', null, { timeout: 5_000 })

  await page.getByLabel('Open assistant panel').click({ timeout: 5_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-right-drawer-open') === 'true', null, { timeout: 5_000 })
  await page.waitForTimeout(800)

  const rightDrawer = await page.evaluate(readShellChromeState)

  assert(rightDrawer.chrome.leftChromeElevated === 'false', 'left chrome should be below the right drawer backdrop', rightDrawer)
  assert(rightDrawer.hits.titlebarSwitch?.hitLabel !== 'Layout mode', 'right drawer backdrop should cover the titlebar switch', rightDrawer)
  assert(rightDrawer.hits.titlebarSwitch?.pointerEvents === 'none', 'left chrome should not receive pointer events under the right drawer backdrop', rightDrawer)

  await page.screenshot({ path: screenshotPath, fullPage: false })

  const report = {
    initial,
    leftDrawer,
    nativeWindowControls,
    rightDrawer,
    screenshotPath,
  }

  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await app.close().catch(() => undefined)
}

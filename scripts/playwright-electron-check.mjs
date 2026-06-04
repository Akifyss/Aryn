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
const conversationIndexPath = path.join(workspacePath, '.aryn', 'conversations', 'index.json')
const reportPath = path.join(artifactRoot, 'report.json')
const screenshotPath = path.join(artifactRoot, 'screenshot.png')
const tabStorageKey = `aryn:workspace-tabs:${workspacePath}`
const seededConversationTitle = 'E2E drawer menu conversation'

await fs.rm(runRoot, { force: true, recursive: true })
await fs.mkdir(appDataRoot, { recursive: true })
await fs.mkdir(localAppDataRoot, { recursive: true })
await fs.mkdir(tempRoot, { recursive: true })
await fs.mkdir(workspacePath, { recursive: true })
await fs.mkdir(path.dirname(conversationIndexPath), { recursive: true })
await fs.writeFile(filePath, '# Electron chrome check\n\nTemporary workspace fixture.\n', 'utf8')
await fs.writeFile(conversationIndexPath, JSON.stringify({
  version: 1,
  conversations: [
    {
      agentSessionPath: null,
      createdAt: '2026-06-04T00:00:00.000Z',
      id: 'drawer-menu-conversation',
      lastMessagePreview: 'Drawer menu interaction fixture',
      status: 'active',
      title: seededConversationTitle,
      updatedAt: '2026-06-04T00:00:00.000Z',
      workspacePath: null,
    },
  ],
}, null, 2), 'utf8')

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
    const visibleLeft = Math.max(rect.left, 0)
    const visibleTop = Math.max(rect.top, 0)
    const visibleRight = Math.min(rect.right, window.innerWidth)
    const visibleBottom = Math.min(rect.bottom, window.innerHeight)
    const hasVisibleArea = visibleRight > visibleLeft && visibleBottom > visibleTop
    const hitX = hasVisibleArea ? visibleLeft + (visibleRight - visibleLeft) / 2 : rect.left + rect.width / 2
    const hitY = hasVisibleArea ? visibleTop + (visibleBottom - visibleTop) / 2 : rect.top + rect.height / 2
    const hit = document.elementFromPoint(hitX, hitY)

    return {
      hitClassName: typeof hit?.className === 'string' ? hit.className : null,
      hitLabel: hit?.getAttribute('aria-label') ?? hit?.closest('[aria-label]')?.getAttribute('aria-label') ?? null,
      hitTag: hit?.tagName ?? null,
      hitPoint: {
        x: Math.round(hitX),
        y: Math.round(hitY),
      },
      pointerEvents: getComputedStyle(element).pointerEvents,
      rect: {
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      },
    }
  }
  const readAppRegionValues = (selector) => Array.from(document.querySelectorAll(selector)).map((element) => {
    const style = getComputedStyle(element)
    return style.getPropertyValue('-webkit-app-region') || style.getPropertyValue('app-region') || ''
  })
  const readAuthoredAppRegionRules = (selectorPattern) => {
    const rules = []
    const visitRules = (cssRules) => {
      for (const rule of cssRules) {
        if ('cssRules' in rule) {
          visitRules(rule.cssRules)
          continue
        }

        if (!('selectorText' in rule) || !selectorPattern.test(rule.selectorText)) {
          continue
        }

        const appRegion = rule.style?.getPropertyValue('-webkit-app-region')
          || rule.style?.getPropertyValue('app-region')
          || ''
        if (appRegion) {
          rules.push({
            appRegion,
            selector: rule.selectorText,
          })
        }
      }
    }

    for (const sheet of document.styleSheets) {
      visitRules(sheet.cssRules)
    }

    return rules
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
    drag: {
      agentLocalOverlayAppRegions: readAppRegionValues('.agent-local-overlay-root'),
      agentThreadbarAuthoredAppRegionRules: readAuthoredAppRegionRules(/(^|[\s>+~,(])\.agent-threadbar(?![-\w])/),
      drawerLocalOverlayAppRegions: readAppRegionValues('.drawer-local-overlay-root'),
      drawerProxy: readHit('.drawer-window-drag-region'),
      drawerProxyCount: document.querySelectorAll('.drawer-window-drag-region').length,
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
  const rendererErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      rendererErrors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    rendererErrors.push(error.stack || error.message)
  })

  await page.waitForFunction(() => !!window.appApi, null, { timeout: 30_000 })
  await page.waitForSelector('.app-shell', { timeout: 30_000 })
  const activeProjectFixture = await page.evaluate(
    async ({ filePath, storageKey, workspacePath }) => {
      const projectState = await window.appApi.getProjectState()
      const activeProject = projectState.projects.find((project) => project.id === projectState.lastProjectId)
        ?? projectState.projects[0]
        ?? null

      if (!activeProject) {
        throw new Error('No visible project found in the real .aryn project state.')
      }

      window.localStorage.setItem(storageKey, JSON.stringify({
        activePath: filePath,
        entries: [{ path: filePath, viewMode: 'meo' }],
        paths: [filePath],
      }))
      window.localStorage.setItem('aryn:left-sidebar-collapsed', 'false')
      window.localStorage.setItem('aryn:right-sidebar-collapsed', 'false')

      await Promise.all([
        window.appApi.setActiveProject(activeProject.id),
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
        window.appApi.updateLayoutState({
          activeLeftSidebarTab: 'file',
          leftSidebarCollapsed: false,
        }),
      ])

      return {
        id: activeProject.id,
        name: activeProject.name,
        path: activeProject.path,
      }
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
  assert(leftDrawer.drag.drawerProxyCount === 1, 'left drawer should expose one top-layer drag proxy', leftDrawer)
  assert(leftDrawer.drag.drawerProxy?.hitClassName === 'drawer-window-drag-region', 'left drawer drag proxy is not hittable at its center', leftDrawer)
  assert(leftDrawer.drag.drawerLocalOverlayAppRegions.every((value) => value !== 'no-drag'), 'drawer local overlay root must not mark the whole surface as no-drag', leftDrawer)
  assert(leftDrawer.hits.drawerSearch?.hitLabel === 'Open search', 'left drawer search button is not clickable at its center', leftDrawer)
  assert(leftDrawer.hits.drawerToggle?.hitLabel === 'Close workspace panel', 'left drawer sidebar toggle is not clickable at its center', leftDrawer)

  await page.waitForSelector('.workspace-sidebar-surface.is-drawer .workspace-tree-root .workspace-tree-row .git-change-icon-button', { timeout: 10_000 })
  const drawerFileRow = page.locator('.workspace-sidebar-surface.is-drawer .workspace-tree-root .workspace-tree-row', {
    has: page.locator('.git-change-icon-button'),
  }).first()
  await drawerFileRow.hover({ timeout: 5_000 })
  await drawerFileRow.locator('.git-change-icon-button').click({ timeout: 5_000 })
  const drawerFileTreeTriggerProbe = await page.evaluate(() => {
    const button = document.querySelector('.workspace-sidebar-surface.is-drawer .workspace-tree-root .workspace-tree-row .git-change-icon-button')
    const rect = button?.getBoundingClientRect()
    const hit = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null

    return {
      buttonAriaExpanded: button?.getAttribute('aria-expanded') ?? null,
      buttonDisabled: button instanceof HTMLButtonElement ? button.disabled : null,
      buttonRect: rect ? {
        height: Math.round(rect.height),
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
      } : null,
      hitClassName: hit instanceof Element ? hit.className : null,
      hitLabel: hit instanceof Element ? hit.getAttribute('aria-label') ?? hit.closest('[aria-label]')?.getAttribute('aria-label') ?? null : null,
      hitTag: hit instanceof Element ? hit.tagName : null,
      menuCount: document.querySelectorAll('.workspace-tree-menu').length,
      portalCount: document.querySelectorAll('.workspace-tree-menu-portal').length,
      roleMenus: Array.from(document.querySelectorAll('[role="menu"]')).map((menu) => ({
        className: typeof menu.className === 'string' ? menu.className : null,
        parentClassName: menu.parentElement && typeof menu.parentElement.className === 'string' ? menu.parentElement.className : null,
        rootClassName: menu.parentElement?.parentElement && typeof menu.parentElement.parentElement.className === 'string'
          ? menu.parentElement.parentElement.className
          : null,
        text: menu.textContent?.trim() ?? '',
      })),
    }
  })
  await page.waitForSelector('.workspace-tree-menu', { timeout: 5_000 }).catch((error) => {
    throw new Error(`${error.message}\n${JSON.stringify({ drawerFileTreeTriggerProbe, rendererErrors }, null, 2)}`)
  })
  const drawerFileTreeMenu = await page.evaluate(() => {
    const menu = document.querySelector('.workspace-tree-menu')
    const rect = menu?.getBoundingClientRect()
    const hit = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null

    return {
      hitRoot: hit instanceof Element ? Boolean(hit.closest('.drawer-local-overlay-root')) : false,
      hitText: hit instanceof Element ? hit.closest('.workspace-tree-menu-item')?.textContent?.trim() ?? null : null,
      menuRoot: menu instanceof Element ? Boolean(menu.closest('.drawer-local-overlay-root')) : false,
      pointerEvents: menu ? getComputedStyle(menu).pointerEvents : null,
    }
  })
  assert(drawerFileTreeMenu.menuRoot, 'workspace tree menu should portal into the drawer local overlay root', drawerFileTreeMenu)
  assert(drawerFileTreeMenu.hitRoot, 'workspace tree menu center should be hittable inside the drawer local overlay root', drawerFileTreeMenu)
  assert(drawerFileTreeMenu.pointerEvents !== 'none', 'workspace tree menu should accept pointer events', drawerFileTreeMenu)
  assert(drawerFileTreeMenu.hitText !== null, 'workspace tree menu center should hit a menu item', drawerFileTreeMenu)
  await page.mouse.move(800, 500)
  await page.waitForTimeout(250)
  assert(
    await page.locator('.drawer-local-overlay-root .workspace-tree-menu').count() === 1,
    'workspace tree menu should stay open when the pointer leaves the menu',
    await page.evaluate(() => ({
      menuCount: document.querySelectorAll('.workspace-tree-menu').length,
      openButtons: document.querySelectorAll('.workspace-sidebar-surface.is-drawer .workspace-tree-root .git-change-icon-button[aria-expanded="true"]').length,
    })),
  )
  await page.locator('.drawer-local-overlay-root .workspace-tree-menu [data-menu-action="rename"]').click({ timeout: 5_000 })
  await page.waitForSelector('.workspace-sidebar-surface.is-drawer .workspace-tree-root .workspace-tree-row.is-editing .raw-rename-input', { timeout: 5_000 })
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('.workspace-sidebar-surface.is-drawer .workspace-tree-root .workspace-tree-row.is-editing'), null, { timeout: 5_000 })

  const leftDrawerStillOpen = await page.evaluate(() => document.querySelector('.app-shell')?.getAttribute('data-left-drawer-open') === 'true')
  if (leftDrawerStillOpen) {
    const clickedLeftDrawerToggle = await page.evaluate(() => {
      const button = document.querySelector('.workspace-sidebar-surface.is-drawer .panel-toggle-button:not(.left-chrome-search-button)')
      if (!(button instanceof HTMLButtonElement)) {
        return false
      }

      button.click()
      return true
    })
    assert(clickedLeftDrawerToggle, 'left drawer toggle should be available after closing the workspace tree menu', await page.evaluate(readShellChromeState))
    await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-left-drawer-open') === 'false', null, { timeout: 5_000 })
  }

  await page.getByLabel('Open assistant panel').click({ timeout: 5_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-right-drawer-open') === 'true', null, { timeout: 5_000 })
  await page.waitForTimeout(800)

  const rightDrawer = await page.evaluate(readShellChromeState)

  assert(rightDrawer.chrome.leftChromeElevated === 'false', 'left chrome should be below the right drawer backdrop', rightDrawer)
  assert(rightDrawer.drag.drawerProxyCount === 1, 'right drawer should expose one top-layer drag proxy', rightDrawer)
  assert(rightDrawer.drag.drawerProxy?.hitClassName === 'drawer-window-drag-region', 'right drawer drag proxy is not hittable at its center', rightDrawer)
  assert(rightDrawer.drag.agentLocalOverlayAppRegions.every((value) => value !== 'no-drag'), 'agent local overlay root must not mark the whole surface as no-drag', rightDrawer)
  assert(rightDrawer.drag.agentThreadbarAuthoredAppRegionRules.length === 0, 'agent threadbar container must not own native drag hit-testing', rightDrawer)
  assert(rightDrawer.drag.drawerLocalOverlayAppRegions.every((value) => value !== 'no-drag'), 'drawer local overlay root must not mark the whole surface as no-drag', rightDrawer)
  assert(rightDrawer.hits.rightToggle?.hitLabel === 'Close assistant panel', 'right drawer sidebar toggle is not clickable at its center', rightDrawer)
  assert(rightDrawer.hits.titlebarSwitch?.hitLabel !== 'Layout mode', 'right drawer backdrop should cover the titlebar switch', rightDrawer)
  assert(rightDrawer.hits.titlebarSwitch?.pointerEvents === 'none', 'left chrome should not receive pointer events under the right drawer backdrop', rightDrawer)

  await page.getByLabel('Close assistant panel').click({ timeout: 5_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-right-drawer-open') === 'false', null, { timeout: 5_000 })

  await page.evaluate(() => window.appApi.updateSettingsState({ layoutPreference: 'agent' }))
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.waitForFunction(() => (
    document.querySelector('.app-shell')?.getAttribute('data-app-layout') === 'agent'
    && document.querySelector('.app-shell')?.getAttribute('data-layout') === 'focus'
  ), null, { timeout: 30_000 })
  await page.waitForTimeout(300)

  await page.getByLabel('Open workspace panel').click({ timeout: 5_000 })
  await page.waitForFunction(() => document.querySelector('.app-shell')?.getAttribute('data-left-drawer-open') === 'true', null, { timeout: 5_000 })
  await page.waitForSelector('.workspace-sidebar-surface.is-drawer .agent-conversation-row', { timeout: 10_000 })

  const agentLeftDrawer = await page.evaluate(readShellChromeState)
  assert(agentLeftDrawer.drag.drawerProxyCount === 1, 'agent left drawer should keep one top-layer drag proxy', agentLeftDrawer)
  assert(agentLeftDrawer.drag.drawerProxy?.hitClassName === 'drawer-window-drag-region', 'agent left drawer drag proxy is not hittable at its center', agentLeftDrawer)
  assert(agentLeftDrawer.drag.drawerLocalOverlayAppRegions.every((value) => value !== 'no-drag'), 'agent left drawer local overlay root must not mark the whole surface as no-drag', agentLeftDrawer)

  await page.locator('.workspace-sidebar-surface.is-drawer .agent-project-tree-header').first().hover({ timeout: 5_000 })
  await page.locator('.workspace-sidebar-surface.is-drawer .agent-project-tree-header-action').first().click({ timeout: 5_000 })
  await page.waitForSelector('.drawer-local-overlay-root .project-menu-agent-add', { timeout: 5_000 })
  const drawerProjectMenu = await page.evaluate(() => {
    const menu = document.querySelector('.project-menu-agent-add')
    const rect = menu?.getBoundingClientRect()
    const hit = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null

    return {
      hitRoot: hit instanceof Element ? Boolean(hit.closest('.drawer-local-overlay-root')) : false,
      menuRoot: menu instanceof Element ? Boolean(menu.closest('.drawer-local-overlay-root')) : false,
      pointerEvents: menu ? getComputedStyle(menu).pointerEvents : null,
      surface: menu?.getAttribute('data-surface') ?? null,
    }
  })
  assert(drawerProjectMenu.menuRoot, 'project add menu should portal into the drawer local overlay root', drawerProjectMenu)
  assert(drawerProjectMenu.hitRoot, 'project add menu center should be hittable inside the drawer local overlay root', drawerProjectMenu)
  assert(drawerProjectMenu.pointerEvents !== 'none', 'project add menu should accept pointer events', drawerProjectMenu)
  assert(drawerProjectMenu.surface === 'left-drawer', 'project add menu should use the left drawer surface', drawerProjectMenu)
  await page.mouse.move(800, 500)
  await page.waitForTimeout(250)
  assert(
    await page.locator('.drawer-local-overlay-root .project-menu-agent-add').count() === 1,
    'project add menu should stay open when the pointer leaves the menu',
    await page.evaluate(() => ({
      menuCount: document.querySelectorAll('.project-menu-agent-add').length,
      surface: document.querySelector('.project-menu-agent-add')?.getAttribute('data-surface') ?? null,
    })),
  )
  await page.locator('.drawer-local-overlay-root .project-menu-agent-add .project-menu-action').first().click({ timeout: 5_000 })
  await page.waitForSelector('.project-create-modal', { timeout: 5_000 })
  await page.locator('.project-create-modal-close').click({ timeout: 5_000 })
  await page.waitForSelector('.project-create-modal', { state: 'detached', timeout: 5_000 })

  const drawerConversationRow = page.locator('.workspace-sidebar-surface.is-drawer .agent-conversation-row').first()
  await drawerConversationRow.hover({ timeout: 5_000 })
  await drawerConversationRow.locator('.agent-project-row-action').first().click({ timeout: 5_000 })
  await page.waitForSelector('.drawer-local-overlay-root .agent-session-tree-menu', { timeout: 5_000 })
  const drawerTreeMenu = await page.evaluate(() => {
    const menu = document.querySelector('.agent-session-tree-menu')
    const rect = menu?.getBoundingClientRect()
    const hit = rect
      ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : null

    return {
      hitLabel: hit?.getAttribute('aria-label') ?? hit?.closest('[aria-label]')?.getAttribute('aria-label') ?? null,
      hitRoot: hit instanceof Element ? Boolean(hit.closest('.drawer-local-overlay-root')) : false,
      menuRoot: menu instanceof Element ? Boolean(menu.closest('.drawer-local-overlay-root')) : false,
      pointerEvents: menu ? getComputedStyle(menu).pointerEvents : null,
    }
  })
  assert(drawerTreeMenu.menuRoot, 'agent tree menu should portal into the drawer local overlay root', drawerTreeMenu)
  assert(drawerTreeMenu.hitRoot, 'agent tree menu center should be hittable inside the drawer local overlay root', drawerTreeMenu)
  assert(drawerTreeMenu.pointerEvents !== 'none', 'agent tree menu should accept pointer events', drawerTreeMenu)
  await page.locator('.drawer-local-overlay-root .agent-session-tree-menu .agent-session-tree-menu-item').first().click({ timeout: 5_000 })
  await page.waitForSelector('.workspace-sidebar-surface.is-drawer .agent-conversation-row.is-editing .raw-rename-input', { timeout: 5_000 })

  await page.screenshot({ path: screenshotPath, fullPage: false })

  const report = {
    agentLeftDrawer,
    activeProjectFixture,
    drawerFileTreeMenu,
    drawerProjectMenu,
    drawerTreeMenu,
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

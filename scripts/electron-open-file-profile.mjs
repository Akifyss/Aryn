import { _electron as electron } from 'playwright'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const mainEntry = path.join(rootDir, 'dist-electron', 'main', 'index.js')
const rendererEntry = path.join(rootDir, 'dist', 'index.html')
const artifactRoot = path.resolve(process.env.ARYN_ELECTRON_PROFILE_ARTIFACT_ROOT ?? path.join(rootDir, 'tmp', 'electron-open-file-profile'))
const runId = process.env.ARYN_ELECTRON_PROFILE_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-')
const runRoot = path.join(artifactRoot, 'runs', runId)
const appDataRoot = path.join(runRoot, 'appdata')
const localAppDataRoot = path.join(runRoot, 'localappdata')
const tempRoot = path.join(runRoot, 'temp')
const reportPath = path.join(artifactRoot, 'electron-open-file-profile-report.json')
const screenshotPath = path.join(artifactRoot, 'electron-open-file-profile.png')

const workspacePath = process.env.ARYN_ELECTRON_PROFILE_WORKSPACE
  ? path.resolve(process.env.ARYN_ELECTRON_PROFILE_WORKSPACE)
  : null
const filePath = process.env.ARYN_ELECTRON_PROFILE_FILE
  ? path.resolve(process.env.ARYN_ELECTRON_PROFILE_FILE)
  : null
const warmupFilePath = process.env.ARYN_ELECTRON_PROFILE_WARMUP_FILE
  ? path.resolve(process.env.ARYN_ELECTRON_PROFILE_WARMUP_FILE)
  : null
const timeoutMs = readNumberEnv('ARYN_ELECTRON_PROFILE_TIMEOUT_MS', 120_000)
const mode = process.env.ARYN_ELECTRON_PROFILE_MODE === 'restore' ? 'restore' : 'click'
const settleMs = readNumberEnv('ARYN_ELECTRON_PROFILE_SETTLE_MS', 1_000)
const meoMode = readMeoMode(process.env.ARYN_ELECTRON_PROFILE_MEO_MODE)

const scriptStart = performance.now()
const nodeEvents = []

function readNumberEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readMeoMode(value) {
  return ['diff-split', 'diff-unified', 'live', 'source'].includes(value) ? value : null
}

function nowMs() {
  return Math.round((performance.now() - scriptStart) * 10) / 10
}

function compactText(value, maxLength = 1000) {
  const text = String(value ?? '')
    .replace(/data:font\/woff2;base64,[^'")\s]+/g, 'data:font/woff2;base64,...')

  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`
}

function mark(name, details) {
  const entry = {
    atMs: nowMs(),
    details: details ?? null,
    name,
    source: 'node',
  }
  nodeEvents.push(entry)
  const suffix = details ? ` ${JSON.stringify(details)}` : ''
  console.log(`[profile ${entry.atMs.toFixed(1).padStart(7)}ms] ${name}${suffix}`)
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureBuildExists() {
  const missing = []

  if (!(await pathExists(mainEntry))) {
    missing.push(mainEntry)
  }

  if (!(await pathExists(rendererEntry))) {
    missing.push(rendererEntry)
  }

  if (missing.length > 0) {
    throw new Error(`Missing Electron build output: ${missing.join(', ')}. Run "npm.cmd run pretest" first.`)
  }
}

function tabStorageKey(nextWorkspacePath) {
  return `aryn:file-tabs:${encodeURIComponent(nextWorkspacePath)}`
}

function meoStorageKey(targetFilePath) {
  return `aryn:meo-state:${encodeURIComponent(targetFilePath)}`
}

function baseName(targetPath) {
  return path.basename(targetPath)
}

function installBrowserProfiler() {
  const startedAt = performance.now()
  const events = []

  function record(name, details) {
    events.push({
      atMs: Math.round((performance.now() - startedAt) * 10) / 10,
      details: details ?? null,
      name,
      source: 'renderer',
    })
  }

  window.__ARYN_OPEN_FILE_PROFILE__ = {
    events,
    record,
    startedAt,
  }
  record('profiler:installed', {
    href: window.location.href,
  })

  const apiNames = [
    'getWorkspaceRestoreState',
    'getWorkspaceState',
    'updateWorkspaceState',
    'loadWorkspaceTree',
    'resolveWorkspaceEditorKind',
    'readWorkspaceFile',
    'getGitRepositoryState',
    'getGitBaseline',
    'getWorkspaceIconTheme',
    'getWorkspaceIconThemeCatalog',
    'getAppIconSelection',
    'getAppIconCatalog',
    'startWorkspaceWatch',
  ]

  function wrapAppApi() {
    const api = window.appApi

    if (!api || api.__arynProfileWrapped) {
      return Boolean(api?.__arynProfileWrapped)
    }

    for (const name of apiNames) {
      const original = api[name]

      if (typeof original !== 'function') {
        continue
      }

      const wrapped = async (...args) => {
        const start = performance.now()
        record(`appApi:${name}:start`, { args: args.map((arg) => typeof arg === 'string' ? arg : typeof arg) })

        try {
          const result = await original(...args)
          record(`appApi:${name}:end`, {
            durationMs: Math.round((performance.now() - start) * 10) / 10,
            ok: true,
          })
          return result
        } catch (error) {
          record(`appApi:${name}:end`, {
            durationMs: Math.round((performance.now() - start) * 10) / 10,
            message: error instanceof Error ? error.message : String(error),
            ok: false,
          })
          throw error
        }
      }

      try {
        api[name] = wrapped
      } catch (error) {
        record(`appApi:${name}:wrap-failed`, {
          message: error instanceof Error ? error.message : String(error),
        })
      }

      if (api[name] !== wrapped) {
        record(`appApi:${name}:wrap-failed`, {
          message: 'assignment did not replace function',
        })
      }
    }

    try {
      Object.defineProperty(api, '__arynProfileWrapped', { value: true })
    } catch {
      // The contextBridge object may be frozen; wrapper events above still tell us what happened.
    }

    record('appApi:wrapped')
    return true
  }

  if (!wrapAppApi()) {
    const timer = window.setInterval(() => {
      if (wrapAppApi()) {
        window.clearInterval(timer)
      }
    }, 0)
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        record('performance:longtask', {
          durationMs: Math.round(entry.duration * 10) / 10,
          name: entry.name,
          startTimeMs: Math.round(entry.startTime * 10) / 10,
        })
      }
    })
    observer.observe({ entryTypes: ['longtask'] })
    record('performance:longtask-observer:ready')
  } catch (error) {
    record('performance:longtask-observer:failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    let editorMountedRecorded = false
    let editorTextVisibleRecorded = false

    function isVisibleEditorElement(element) {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      return rect.width > 0
        && rect.height > 0
        && style.display !== 'none'
        && style.visibility !== 'hidden'
    }

    function getEditorElement() {
      return Array.from(document.querySelectorAll('.cm-content, .ProseMirror, .monaco-editor'))
        .find(isVisibleEditorElement) ?? null
    }

    function checkEditorDom() {
      const editor = getEditorElement()
      if (!editor) {
        return
      }

      if (!editorMountedRecorded) {
        editorMountedRecorded = true
        record('editor:mounted:mutation', {
          selector: ['.cm-content', '.ProseMirror', '.monaco-editor']
            .find((selector) => editor.matches(selector)) ?? editor.tagName.toLowerCase(),
        })
      }

      if (!editorTextVisibleRecorded && (editor.textContent?.trim().length ?? 0) > 0) {
        editorTextVisibleRecorded = true
        record('editor:text-visible:mutation', {
          textLength: editor.textContent?.length ?? null,
        })
      }
    }

    const editorObserver = new MutationObserver(checkEditorDom)
    const observeEditorDom = () => {
      if (!document.documentElement) {
        window.setTimeout(observeEditorDom, 0)
        return
      }

      editorObserver.observe(document.documentElement, {
        characterData: true,
        childList: true,
        subtree: true,
      })
      window.requestAnimationFrame(checkEditorDom)
      record('editor:mutation-observer:ready')
    }

    observeEditorDom()
  } catch (error) {
    record('editor:mutation-observer:failed', {
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

async function resetRunRoots() {
  fsSync.mkdirSync(artifactRoot, { recursive: true })
  await fs.rm(appDataRoot, { force: true, recursive: true })
  await fs.rm(localAppDataRoot, { force: true, recursive: true })
  await fs.rm(tempRoot, { force: true, recursive: true })
  await fs.mkdir(appDataRoot, { recursive: true })
  await fs.mkdir(localAppDataRoot, { recursive: true })
  await fs.mkdir(tempRoot, { recursive: true })
}

async function waitForAppShell(page, label) {
  mark(`${label}:domcontentloaded:wait`)
  await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
  mark(`${label}:domcontentloaded:ready`)
  await page.waitForSelector('.app-shell', { timeout: timeoutMs })
  mark(`${label}:app-shell:ready`)
}

async function waitForTargetFileInTree(page, targetFilePath) {
  await page.waitForFunction(
    (nextFilePath) => {
      return Array.from(document.querySelectorAll('.workspace-tree-trigger'))
        .some((element) => element.getAttribute('title') === nextFilePath)
    },
    targetFilePath,
    { timeout: timeoutMs },
  )
  mark('workspace-tree:file-visible', { filePath: targetFilePath })
}

async function clickTargetFile(page, targetFilePath) {
  mark('file-click:start', { filePath: targetFilePath })
  await page.evaluate((nextFilePath) => {
    const profile = window.__ARYN_OPEN_FILE_PROFILE__
    const trigger = Array.from(document.querySelectorAll('.workspace-tree-trigger'))
      .find((element) => element.getAttribute('title') === nextFilePath)
    const row = trigger?.closest('.workspace-tree-row')

    if (!(row instanceof HTMLElement)) {
      throw new Error(`Could not find workspace tree row for ${nextFilePath}`)
    }

    profile?.record?.('file-click:dispatch:start', { filePath: nextFilePath })
    row.click()
    profile?.record?.('file-click:dispatch:end', { filePath: nextFilePath })
  }, targetFilePath)
  mark('file-click:dispatched', { filePath: targetFilePath })
}

async function waitForActiveTab(page, targetFilePath, label = 'file-tab') {
  const targetName = baseName(targetFilePath)
  await page.waitForFunction(
    (nextName) => {
      return Array.from(document.querySelectorAll('.file-tab'))
        .some((element) => (
          element.textContent?.includes(nextName)
          && (element.getAttribute('data-active') === 'true' || element.matches('[data-active="true"]'))
        ))
    },
    targetName,
    { timeout: timeoutMs },
  )
  await page.evaluate(
    ({ filePath: nextFilePath, name, markerLabel }) => {
      window.__ARYN_OPEN_FILE_PROFILE__?.record?.(`${markerLabel}:active:observed`, {
        fileName: name,
        filePath: nextFilePath,
      })
    },
    { filePath: targetFilePath, markerLabel: label, name: targetName },
  )
  mark(`${label}:active`, { fileName: targetName })
}

async function waitForEditorReady(page, label = 'editor') {
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('.cm-content, .ProseMirror, .monaco-editor'))
      .some((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
      })
  }, null, { timeout: timeoutMs })
  await page.evaluate((markerLabel) => {
    const editor = Array.from(document.querySelectorAll('.cm-content, .ProseMirror, .monaco-editor'))
      .find((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
      }) ?? null
    window.__ARYN_OPEN_FILE_PROFILE__?.record?.(`${markerLabel}:mounted:observed`, {
      selector: editor
        ? ['.cm-content', '.ProseMirror', '.monaco-editor']
            .find((selector) => editor.matches(selector)) ?? editor.tagName.toLowerCase()
        : null,
    })
  }, label)
  mark(`${label}:mounted`)

  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('.cm-content, .ProseMirror, .monaco-editor'))
      .some((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && (element.textContent?.trim().length ?? 0) > 0
      })
  }, null, { timeout: timeoutMs })
  await page.evaluate((markerLabel) => {
    const editor = Array.from(document.querySelectorAll('.cm-content, .ProseMirror, .monaco-editor'))
      .find((element) => {
        const rect = element.getBoundingClientRect()
        const style = window.getComputedStyle(element)
        return rect.width > 0
          && rect.height > 0
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && (element.textContent?.trim().length ?? 0) > 0
      }) ?? null
    window.__ARYN_OPEN_FILE_PROFILE__?.record?.(`${markerLabel}:text-visible:observed`, {
      textLength: editor?.textContent?.length ?? null,
    })
  }, label)
  mark(`${label}:text-visible`)
}

async function restoreWorkspaceState(page, targetWorkspacePath, targetFilePath) {
  const shouldOpenFile = mode === 'restore'
  mark('workspace-state:prepare', { meoMode, mode, shouldOpenFile })

  await page.waitForFunction(() => Boolean(window.appApi?.updateWorkspaceState), null, { timeout: timeoutMs })
  await page.evaluate(
    ({
      meoMode: nextMeoMode,
      meoStateKey,
      openFileOnReload,
      storageKey,
      targetFilePath: nextFilePath,
      targetWorkspacePath: nextWorkspacePath,
    }) => {
      window.localStorage.setItem(storageKey, JSON.stringify(openFileOnReload
        ? {
            activePath: nextFilePath,
            entries: [{ path: nextFilePath, viewMode: 'meo' }],
            paths: [nextFilePath],
          }
        : {
            activePath: null,
            entries: [],
            paths: [],
          }))
      window.localStorage.setItem('aryn:left-sidebar-collapsed', 'false')
      window.localStorage.setItem('aryn:right-sidebar-collapsed', 'false')
      if (nextMeoMode) {
        window.localStorage.setItem(meoStateKey, JSON.stringify({
          gitChangesGutter: true,
          gitChangesGutterConfigured: true,
          lineNumbers: true,
          mode: nextMeoMode,
        }))
      }

      return window.appApi.updateWorkspaceState(nextWorkspacePath, {
        lastFilePath: openFileOnReload ? nextFilePath : null,
        markAsLastOpened: true,
      })
    },
    {
      meoMode,
      meoStateKey: meoStorageKey(targetFilePath),
      openFileOnReload: shouldOpenFile,
      storageKey: tabStorageKey(targetWorkspacePath),
      targetFilePath,
      targetWorkspacePath,
    },
  )
  mark('workspace-state:ready')
}

async function snapshot(page) {
  return page.evaluate(() => {
    const editor = document.querySelector('.meo-native-root, .cm-content, .ProseMirror, .monaco-editor')
    const activeTab = document.querySelector('.file-tab[data-active="true"], [data-active="true"].file-tab')

    return {
      activeTabText: activeTab?.textContent?.trim() ?? null,
      bodyTextSample: document.body.textContent?.slice(0, 500) ?? '',
      changedTextCount: document.querySelectorAll('.cm-changedText').length,
      changedTextEmptyCount: document.querySelectorAll('.cm-changedTextEmpty').length,
      deletedTextCount: document.querySelectorAll('.cm-deletedText').length,
      inlineChangeLayerCount: document.querySelectorAll('.cm-changedTextLayerRanges, .cm-deletedTextLayerRanges').length,
      editorSelector: editor
        ? ['.meo-native-root', '.cm-content', '.ProseMirror', '.monaco-editor']
            .find((selector) => editor.matches(selector)) ?? editor.tagName.toLowerCase()
        : null,
      editorTextLength: editor?.textContent?.length ?? null,
      title: document.title,
      url: window.location.href,
    }
  })
}

async function closeElectronApp(app) {
  let processHandle = null

  try {
    processHandle = app.process()
  } catch {
    processHandle = null
  }

  let closed = false
  await Promise.race([
    app.close()
      .then(() => {
        closed = true
      })
      .catch(() => {
        closed = true
      }),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ])

  if (!closed && processHandle && !processHandle.killed) {
    processHandle.kill()
  }
}

function summarizeApiDurations(rendererEvents) {
  return rendererEvents
    .filter((event) => event.name.startsWith('appApi:') && event.name.endsWith(':end'))
    .map((event) => ({
      durationMs: event.details?.durationMs ?? null,
      name: event.name.replace(/^appApi:/, '').replace(/:end$/, ''),
      ok: event.details?.ok !== false,
    }))
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
}

function summarizeLongTasks(rendererEvents) {
  const longTasks = rendererEvents
    .filter((event) => event.name === 'performance:longtask')
    .map((event) => event.details)

  return {
    count: longTasks.length,
    maxDurationMs: longTasks.reduce((max, task) => Math.max(max, task?.durationMs ?? 0), 0),
    totalDurationMs: Math.round(longTasks.reduce((total, task) => total + (task?.durationMs ?? 0), 0) * 10) / 10,
  }
}

function findLastEventIndex(events, name, predicate = () => true) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.name === name && predicate(event)) {
      return index
    }
  }

  return -1
}

function findFirstEventAfter(events, startIndex, name, predicate = () => true) {
  for (let index = Math.max(0, startIndex); index < events.length; index += 1) {
    const event = events[index]
    if (event.name === name && predicate(event)) {
      return event
    }
  }

  return null
}

function summarizeClickStages(rendererEvents, targetFilePath) {
  const isTargetFileEvent = (event) => event.details?.filePath === targetFilePath
  const clickStartIndex = findLastEventIndex(rendererEvents, 'file-click:dispatch:start', isTargetFileEvent)

  if (clickStartIndex < 0) {
    return []
  }

  const clickStart = rendererEvents[clickStartIndex]
  const stageSpecs = [
    ['file-click:dispatch:start', 'click dispatch start'],
    ['workspace-tree:row-click', 'tree row click handler'],
    ['app:open-file:start', 'openFile start'],
    ['app:open-file:resolve-editor-kind:end', 'editor kind resolved'],
    ['app:open-file:resolve-view-mode:end', 'view mode resolved'],
    ['app:open-file:read-file:start', 'read file start'],
    ['app:open-file:read-file:end', 'read file end'],
    ['app:open-file:open-tab:start', 'open tab start'],
    ['app:open-file:open-tab:end', 'open tab state set'],
    ['app:active-file-tab:committed', 'React active tab committed'],
    ['file-tab:active:observed', 'tab visible active'],
    ['lazy:meo-editor-host:start', 'Meo chunk import start'],
    ['lazy:meo-editor-host:end', 'Meo chunk import end'],
    ['editor:fallback:mounted', 'editor fallback mounted'],
    ['editor:fallback:unmounted', 'editor fallback unmounted'],
    ['meo-host:layout-effect:start', 'MeoHost layout effect start'],
    ['native-meo:mount:start', 'native Meo mount start'],
    ['native-meo:create-shell:end', 'native shell created'],
    ['native-meo:create-vendor-editor:start', 'vendor editor create start'],
    ['native-meo:create-vendor-editor:end', 'vendor editor create end'],
    ['native-meo:mount-scroll-area:end', 'scroll area mounted'],
    ['native-meo:create-live-inline-diff:start', 'live diff controller create start'],
    ['native-meo:create-live-inline-diff:end', 'live diff controller created'],
    ['native-meo:mount:end', 'native Meo mount end'],
    ['meo-host:mount-native:end', 'MeoHost native mount end'],
    ['meo-host:controller-ready', 'Meo controller ready'],
    ['editor:mounted:mutation', 'editor DOM mounted mutation'],
    ['editor:text-visible:mutation', 'editor text visible mutation'],
    ['editor:mounted:observed', 'editor DOM mounted observed'],
    ['editor:text-visible:observed', 'editor text visible observed'],
    ['meo-host:git-baseline:start', 'Git baseline start'],
    ['meo-host:git-baseline:end', 'Git baseline end'],
    ['app:open-file:update-workspace-state:end', 'workspace state persisted'],
    ['app:open-file:end', 'openFile promise end'],
  ]

  const stages = stageSpecs
    .map(([name, label]) => {
      const event = name === 'file-click:dispatch:start'
        ? clickStart
        : findFirstEventAfter(rendererEvents, clickStartIndex, name, (candidate) => {
            if (candidate.details?.filePath && candidate.details.filePath !== targetFilePath) {
              return false
            }

            return true
          })

      if (!event) {
        return null
      }

      const fromClickMs = Math.round((event.atMs - clickStart.atMs) * 10) / 10

      return {
        atMs: event.atMs,
        deltaMs: 0,
        details: event.details ?? null,
        fromClickMs,
        label,
        name,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.atMs - right.atMs)

  let previousAt = clickStart.atMs
  for (const stage of stages) {
    stage.deltaMs = Math.round((stage.atMs - previousAt) * 10) / 10
    previousAt = stage.atMs
    delete stage.atMs
  }

  return stages
}

function printSummary(report) {
  console.log('')
  console.log('Slowest appApi calls:')
  if (report.summary.slowestApiCalls.length === 0) {
    console.log('- unavailable: Electron contextBridge exposes frozen appApi functions, so this script uses DOM milestones.')
  } else {
    for (const item of report.summary.slowestApiCalls.slice(0, 12)) {
      console.log(`- ${String(item.durationMs).padStart(7)} ms  ${item.name}${item.ok ? '' : ' (failed)'}`)
    }
  }

  console.log('')
  console.log('Click-to-visible stages:')
  if (report.summary.clickStages.length === 0) {
    console.log('- unavailable')
  } else {
    for (const stage of report.summary.clickStages) {
      const detailBits = []
      if (typeof stage.details?.durationMs === 'number') {
        detailBits.push(`duration=${stage.details.durationMs}ms`)
      }
      if (typeof stage.details?.chars === 'number') {
        detailBits.push(`chars=${stage.details.chars}`)
      }
      if (stage.details?.editorKind) {
        detailBits.push(`editor=${stage.details.editorKind}`)
      }
      if (stage.details?.viewMode || stage.details?.targetViewMode) {
        detailBits.push(`view=${stage.details.viewMode ?? stage.details.targetViewMode}`)
      }
      const suffix = detailBits.length > 0 ? ` (${detailBits.join(', ')})` : ''
      console.log(`- +${String(stage.fromClickMs).padStart(7)} ms  Δ${String(stage.deltaMs).padStart(7)} ms  ${stage.label}${suffix}`)
    }
  }

  console.log('')
  console.log('Milestones:')
  for (const event of report.events.filter((entry) => entry.source === 'node')) {
    console.log(`- ${String(event.atMs).padStart(7)} ms  ${event.name}`)
  }

  console.log('')
  console.log(JSON.stringify({
    ok: report.ok,
    mode: report.mode,
    reportPath,
    screenshotPath,
    summary: report.summary,
    target: report.target,
  }, null, 2))
}

async function main() {
  if (!workspacePath || !filePath) {
    throw new Error('Set ARYN_ELECTRON_PROFILE_WORKSPACE and ARYN_ELECTRON_PROFILE_FILE.')
  }

  mark('script:start', { filePath, meoMode, mode, workspacePath })
  await ensureBuildExists()
  await resetRunRoots()

  const report = {
    artifacts: {
      reportPath,
      screenshotPath,
    },
    error: null,
    events: nodeEvents,
    mode,
    meoMode,
    ok: false,
    process: {
      stderr: [],
      stdout: [],
    },
    renderer: {
      console: [],
      pageErrors: [],
      requestFailures: [],
    },
    snapshot: null,
    summary: null,
    target: {
      filePath,
      warmupFilePath,
      workspacePath,
    },
  }

  let app = null
  let page = null

  try {
    mark('electron:launch:start')
    app = await electron.launch({
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
      timeout: timeoutMs,
    })
    mark('electron:launch:ready', { pid: app.process()?.pid ?? null })

    const processHandle = app.process()
    processHandle?.stdout?.on('data', (chunk) => {
      report.process.stdout.push(compactText(chunk.toString()))
    })
    processHandle?.stderr?.on('data', (chunk) => {
      report.process.stderr.push(compactText(chunk.toString()))
    })

    page = await app.firstWindow()
    mark('electron:first-window:ready')

    page.on('console', (message) => {
      report.renderer.console.push({
        location: message.location(),
        text: compactText(message.text()),
        type: message.type(),
      })
    })
    page.on('pageerror', (error) => {
      report.renderer.pageErrors.push({
        message: error.message,
        stack: error.stack,
      })
    })
    page.on('requestfailed', (request) => {
      report.renderer.requestFailures.push({
        failure: request.failure()?.errorText ?? null,
        method: request.method(),
        resourceType: request.resourceType(),
        url: compactText(request.url()),
      })
    })

    await waitForAppShell(page, 'initial')
    await restoreWorkspaceState(page, workspacePath, filePath)
    await page.addInitScript(installBrowserProfiler)

    mark('reload:start')
    await page.reload({ waitUntil: 'domcontentloaded', timeout: timeoutMs })
    mark('reload:domcontentloaded')
    await waitForAppShell(page, 'reload')

    if (mode === 'click') {
      await waitForTargetFileInTree(page, filePath)

      if (warmupFilePath) {
        mark('warmup:start', { filePath: warmupFilePath })
        await waitForTargetFileInTree(page, warmupFilePath)
        await clickTargetFile(page, warmupFilePath)
        await waitForActiveTab(page, warmupFilePath, 'warmup-tab')
        await waitForEditorReady(page, 'warmup-editor')
        await page.waitForTimeout(500)
        mark('warmup:done', { filePath: warmupFilePath })
      }

      await clickTargetFile(page, filePath)
      await waitForActiveTab(page, filePath)
    }

    await waitForEditorReady(page)
    await page.waitForTimeout(settleMs)
    mark('settle:done', { settleMs })

    const rendererEvents = await page.evaluate(() => window.__ARYN_OPEN_FILE_PROFILE__?.events ?? [])
    const appApiWrapFailures = rendererEvents
      .filter((event) => event.name.startsWith('appApi:') && event.name.endsWith(':wrap-failed'))
      .length
    report.events = [...nodeEvents, ...rendererEvents]
    report.snapshot = await snapshot(page)
    report.summary = {
      appApiWrapFailures,
      clickStages: summarizeClickStages(rendererEvents, filePath),
      elapsedMs: nowMs(),
      longTasks: summarizeLongTasks(rendererEvents),
      pageErrors: report.renderer.pageErrors.length,
      requestFailures: report.renderer.requestFailures.length,
      slowestApiCalls: summarizeApiDurations(rendererEvents),
    }
    await page.screenshot({ path: screenshotPath, fullPage: false })
    report.ok = true
  } catch (error) {
    report.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }
    mark('script:error', { message: report.error.message })

    if (page) {
      try {
        report.snapshot = await snapshot(page)
      } catch {
        report.snapshot = null
      }

      try {
        await page.screenshot({ path: screenshotPath, fullPage: false })
      } catch {
        // Ignore screenshot failures while reporting the original error.
      }
    }
  } finally {
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    if (app) {
      await closeElectronApp(app)
    }
  }

  printSummary(report)

  if (!report.ok) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

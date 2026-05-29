import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AppStateStore,
  APP_STATE_SCHEMA_VERSION,
  DEFAULT_AGENT_COMPOSER_HEIGHT,
  DEFAULT_WINDOW_HEIGHT,
  DEFAULT_WINDOW_WIDTH,
  getWorkspaceEntry,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  normalizePersistedAppState,
} from '../electron/main/app-state'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'app-state-'))
  tempRoots.push(rootPath)
  return rootPath
}

describe('app state persistence', () => {
  it('migrates legacy workspace settings into the new app state file', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, 'app-state.json')
    const legacyPath = path.join(rootPath, 'workspace-settings.json')

    await writeFile(legacyPath, JSON.stringify({
      lastWorkspacePath: 'C:/notes',
    }, null, 2), 'utf8')

    const store = new AppStateStore(appStatePath, legacyPath)
    const state = await store.read()

    expect(state).toMatchObject({
      version: APP_STATE_SCHEMA_VERSION,
      migrations: {
        rendererLocalStorage: 0,
      },
      ui: {
        agentComposerHeight: DEFAULT_AGENT_COMPOSER_HEIGHT,
        workspaceIconTheme: {
          activeThemeId: null,
          sourceKind: 'bundled',
          sourceVsixPath: null,
        },
      },
      workspace: {
        activeProjectId: 'C:/notes',
        entries: {
          'C:/notes': {
            lastAgentSessionPath: null,
            lastFilePath: null,
          },
        },
        lastWorkspacePath: 'C:/notes',
        projects: [
          {
            addedAt: '1970-01-01T00:00:00.000Z',
            id: 'C:/notes',
            lastFilePath: null,
            lastOpenedAt: '1970-01-01T00:00:00.000Z',
            name: 'notes',
            path: 'C:/notes',
          },
        ],
      },
      window: {
        width: DEFAULT_WINDOW_WIDTH,
        height: DEFAULT_WINDOW_HEIGHT,
        isMaximized: false,
      },
    })
    expect(state.settings).toEqual({
      agent: {
        runningPromptEnterBehavior: 'followUp',
      },
      layoutPreference: 'agent',
      meo: {
        focusedLineHighlight: false,
        gitDiffLineHighlights: true,
        imageFolder: 'assets',
        outlinePosition: 'right',
      },
      theme: 'auto',
    })
    expect(state.layout).toMatchObject({
      activeLeftSidebarTab: 'file',
      gitPanelLayout: 'list',
    })

    await expect(readFile(appStatePath, 'utf8')).resolves.toContain('"lastWorkspacePath": "C:/notes"')
    await expect(readFile(appStatePath, 'utf8')).resolves.toContain(`"version": ${APP_STATE_SCHEMA_VERSION}`)
  })

  it('migrates legacy app state into a nested target directory before legacy workspace settings', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, '.aryn', 'app-state.json')
    const legacyAppStatePath = path.join(rootPath, 'old-user-data', 'app-state.json')
    const legacySettingsPath = path.join(rootPath, 'old-user-data', 'workspace-settings.json')

    await mkdir(path.dirname(legacyAppStatePath), { recursive: true })
    await writeFile(legacyAppStatePath, JSON.stringify({
      workspace: {
        activeProjectId: 'C:/project',
        projects: [
          {
            id: 'C:/project',
            name: 'project',
            path: 'C:/project',
          },
        ],
      },
    }, null, 2), 'utf8')
    await writeFile(legacySettingsPath, JSON.stringify({
      lastWorkspacePath: 'C:/settings-only',
    }, null, 2), 'utf8')

    const store = new AppStateStore(appStatePath, [legacyAppStatePath, legacySettingsPath])
    const state = await store.read()

    expect(state.workspace.activeProjectId).toBe('C:/project')
    expect(state.workspace.projects.map((project) => project.id)).toEqual(['C:/project'])
    await expect(readFile(appStatePath, 'utf8')).resolves.toContain('"activeProjectId": "C:/project"')
  })

  it('merges legacy workspace settings when legacy app state has no workspace yet', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, '.aryn', 'app-state.json')
    const legacyAppStatePath = path.join(rootPath, 'old-user-data', 'app-state.json')
    const legacySettingsPath = path.join(rootPath, 'old-user-data', 'workspace-settings.json')

    await mkdir(path.dirname(legacyAppStatePath), { recursive: true })
    await writeFile(legacyAppStatePath, JSON.stringify({
      ui: {
        agentComposerHeight: 188,
      },
      window: {
        width: 1280,
        height: 820,
        isMaximized: true,
      },
      workspace: {
        entries: {},
        lastWorkspacePath: null,
      },
    }, null, 2), 'utf8')
    await writeFile(legacySettingsPath, JSON.stringify({
      lastFilePath: 'C:/legacy-workspace/notes.md',
      lastWorkspacePath: 'C:/legacy-workspace',
    }, null, 2), 'utf8')

    const store = new AppStateStore(appStatePath, [legacyAppStatePath, legacySettingsPath])
    const state = await store.read()

    expect(state.ui.agentComposerHeight).toBe(188)
    expect(state.window).toEqual({
      width: 1280,
      height: 820,
      isMaximized: true,
    })
    expect(state.workspace.activeProjectId).toBe('C:/legacy-workspace')
    expect(state.workspace.lastWorkspacePath).toBe('C:/legacy-workspace')
    expect(state.workspace.projects).toEqual([
      expect.objectContaining({
        id: 'C:/legacy-workspace',
        lastFilePath: 'C:/legacy-workspace/notes.md',
        path: 'C:/legacy-workspace',
      }),
    ])
  })

  it('uses readable legacy app state even when the migration target cannot be written', async () => {
    const rootPath = await createTempDir()
    const blockedTargetDirectory = path.join(rootPath, '.aryn')
    const appStatePath = path.join(blockedTargetDirectory, 'app-state.json')
    const legacyAppStatePath = path.join(rootPath, 'old-user-data', 'app-state.json')

    await writeFile(blockedTargetDirectory, 'not a directory', 'utf8')
    await mkdir(path.dirname(legacyAppStatePath), { recursive: true })
    await writeFile(legacyAppStatePath, JSON.stringify({
      workspace: {
        activeProjectId: 'C:/project',
        projects: [
          {
            id: 'C:/project',
            name: 'project',
            path: 'C:/project',
          },
        ],
      },
    }, null, 2), 'utf8')

    const store = new AppStateStore(appStatePath, legacyAppStatePath)
    const state = await store.read()

    expect(state.workspace.activeProjectId).toBe('C:/project')
    expect(state.workspace.projects.map((project) => project.id)).toEqual(['C:/project'])
  })

  it('creates the nested app state directory when writing new state atomically', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, '.aryn', 'app-state.json')
    const store = new AppStateStore(appStatePath)

    await store.update((state) => ({
      ...state,
      workspace: {
        ...state.workspace,
        lastWorkspacePath: 'C:/new-project',
      },
    }))

    const persistedRaw = await readFile(appStatePath, 'utf8')
    const persistedState = JSON.parse(persistedRaw) as Record<string, unknown>
    const directoryEntries = await readdir(path.dirname(appStatePath))

    expect(persistedState.version).toBe(APP_STATE_SCHEMA_VERSION)
    expect(persistedRaw).toContain('"lastWorkspacePath": "C:/new-project"')
    expect(directoryEntries.filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })

  it('restores from the backup file when the app state file is malformed', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, '.aryn', 'app-state.json')

    await mkdir(path.dirname(appStatePath), { recursive: true })
    await writeFile(appStatePath, '{', 'utf8')
    await writeFile(`${appStatePath}.bak`, JSON.stringify({
      workspace: {
        lastWorkspacePath: 'C:/backup-project',
      },
    }), 'utf8')

    const store = new AppStateStore(appStatePath)
    const state = await store.read()

    expect(state.workspace.activeProjectId).toBe('C:/backup-project')
    expect(state.workspace.lastWorkspacePath).toBe('C:/backup-project')
  })

  it('does not silently reset app state when a malformed file has no backup', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, '.aryn', 'app-state.json')

    await mkdir(path.dirname(appStatePath), { recursive: true })
    await writeFile(appStatePath, '{', 'utf8')

    const store = new AppStateStore(appStatePath)

    await expect(store.read()).rejects.toThrow(SyntaxError)
  })

  it('serializes concurrent app state updates without losing patches', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, '.aryn', 'app-state.json')
    const store = new AppStateStore(appStatePath)

    await Promise.all([
      store.update((state) => ({
        ...state,
        layout: {
          ...state.layout,
          leftSidebarWidth: 360,
        },
      })),
      store.update((state) => ({
        ...state,
        settings: {
          ...state.settings,
          theme: 'dark',
        },
      })),
    ])

    const state = await store.read()

    expect(state.layout.leftSidebarWidth).toBe(360)
    expect(state.settings.theme).toBe('dark')
  })

  it('normalizes invalid window sizes while preserving persisted workspace state', async () => {
    const nextState = normalizePersistedAppState({
      workspace: {
        activeProjectId: 'C:/workspace',
        entries: {
          'C:/workspace': {
            lastAgentSessionPath: 'C:/workspace/.sessions/current.json',
            lastFilePath: 'C:/workspace/draft.md',
          },
        },
        lastWorkspacePath: 'C:/workspace',
        projects: [
          {
            addedAt: '1970-01-01T00:00:00.000Z',
            id: 'C:/workspace',
            lastFilePath: 'C:/workspace/draft.md',
            lastOpenedAt: '1970-01-01T00:00:00.000Z',
            name: 'workspace',
            path: 'C:/workspace',
          },
        ],
      },
      window: {
        width: 300,
        height: 240,
        isMaximized: true,
      },
      ui: {
        agentComposerHeight: 40,
      },
    })

    expect(nextState).toMatchObject({
      version: APP_STATE_SCHEMA_VERSION,
      ui: {
        agentComposerHeight: 132,
        workspaceIconTheme: {
          activeThemeId: null,
          sourceKind: 'bundled',
          sourceVsixPath: null,
        },
      },
      workspace: {
        activeProjectId: 'C:/workspace',
        entries: {
          'C:/workspace': {
            lastAgentSessionPath: 'C:/workspace/.sessions/current.json',
            lastFilePath: 'C:/workspace/draft.md',
          },
        },
        lastWorkspacePath: 'C:/workspace',
        projects: [
          {
            addedAt: '1970-01-01T00:00:00.000Z',
            id: 'C:/workspace',
            lastFilePath: 'C:/workspace/draft.md',
            lastOpenedAt: '1970-01-01T00:00:00.000Z',
            name: 'workspace',
            path: 'C:/workspace',
          },
        ],
      },
      window: {
        width: MIN_WINDOW_WIDTH,
        height: MIN_WINDOW_HEIGHT,
        isMaximized: true,
      },
    })
  })

  it('normalizes persisted app settings and layout state', () => {
    const state = normalizePersistedAppState({
      layout: {
        activeLeftSidebarTab: 'git',
        agentRightSidebarCollapsed: true,
        agentRightSidebarWidth: 640,
        agentRightSidebarWidthMode: 'fixed',
        editorRightSidebarCollapsed: true,
        editorRightSidebarWidth: 420,
        gitPanelHeight: 360,
        gitPanelLayout: 'tree',
        leftSidebarCollapsed: true,
        leftSidebarWidth: 340,
      },
      settings: {
        agent: {
          runningPromptEnterBehavior: 'steer',
        },
        layoutPreference: 'editor',
        meo: {
          focusedLineHighlight: true,
          gitDiffLineHighlights: false,
          imageFolder: 'images',
          outlinePosition: 'left',
        },
        theme: 'dark',
      },
      migrations: {
        rendererLocalStorage: 2.8,
      },
    })

    expect(state.settings).toEqual({
      agent: {
        runningPromptEnterBehavior: 'steer',
      },
      layoutPreference: 'editor',
      meo: {
        focusedLineHighlight: true,
        gitDiffLineHighlights: false,
        imageFolder: 'images',
        outlinePosition: 'left',
      },
      theme: 'dark',
    })
    expect(state.layout).toEqual({
      activeLeftSidebarTab: 'git',
      agentRightSidebarCollapsed: true,
      agentRightSidebarWidth: 640,
      agentRightSidebarWidthMode: 'fixed',
      editorRightSidebarCollapsed: true,
      editorRightSidebarWidth: 420,
      gitPanelHeight: 360,
      gitPanelLayout: 'tree',
      leftSidebarCollapsed: true,
      leftSidebarWidth: 340,
    })
    expect(state.migrations).toEqual({
      rendererLocalStorage: 2,
    })
  })

  it('returns a default workspace entry when no state exists for that workspace', () => {
    const state = normalizePersistedAppState({})

    expect(getWorkspaceEntry(state, 'C:/workspace')).toEqual({
      lastAgentSessionPath: null,
      lastFilePath: null,
    })
  })

  it('restores active project from last workspace when the persisted active project is stale', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeProjectId: 'C:/missing',
        lastWorkspacePath: 'C:/active',
        projects: [
          {
            id: 'C:/first',
            name: 'first',
            path: 'C:/first',
          },
          {
            id: 'C:/active',
            name: 'active',
            path: 'C:/active',
          },
        ],
      },
    })

    expect(state.workspace.activeProjectId).toBe('C:/active')
  })

  it('deduplicates persisted projects by path while keeping the latest normalized record', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeProjectId: 'stale-id',
        projects: [
          {
            id: 'C:/workspace',
            name: 'old',
            path: 'C:/workspace',
            lastFilePath: 'C:/workspace/old.md',
          },
          {
            id: 'stale-id',
            name: 'workspace',
            path: 'C:/workspace',
            lastFilePath: 'C:/workspace/current.md',
          },
        ],
      },
    })

    expect(state.workspace.projects).toHaveLength(1)
    expect(state.workspace.projects[0]).toMatchObject({
      id: 'stale-id',
      lastFilePath: 'C:/workspace/current.md',
      name: 'workspace',
      path: 'C:/workspace',
    })
  })

  it('preserves persisted project order independent of last opened time', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeProjectId: 'C:/second',
        projects: [
          {
            id: 'C:/first',
            name: 'first',
            path: 'C:/first',
            lastOpenedAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'C:/second',
            name: 'second',
            path: 'C:/second',
            lastOpenedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    })

    expect(state.workspace.projects.map((project) => project.id)).toEqual([
      'C:/first',
      'C:/second',
    ])
  })

  it('drops legacy app icon selections from normalized app state', () => {
    const state = normalizePersistedAppState({
      ui: {
        appIconId: 'alt4',
      },
    })

    expect(state.ui).toEqual({
      agentComposerHeight: DEFAULT_AGENT_COMPOSER_HEIGHT,
      workspaceIconTheme: {
        activeThemeId: null,
        sourceKind: 'bundled',
        sourceVsixPath: null,
      },
    })
  })

  it('preserves external workspace icon theme paths', () => {
    const state = normalizePersistedAppState({
      ui: {
        workspaceIconTheme: {
          activeThemeId: 'flow-you',
          sourceKind: 'external',
          sourceVsixPath: '/Users/me/theme.vsix',
        },
      },
    })

    expect(state.ui.workspaceIconTheme).toEqual({
      activeThemeId: 'flow-you',
      sourceKind: 'external',
      sourceVsixPath: '/Users/me/theme.vsix',
    })
  })

  it('stores bundled workspace icon theme selections without a VSIX path', () => {
    const state = normalizePersistedAppState({
      ui: {
        workspaceIconTheme: {
          activeThemeId: 'flow-dawn',
          sourceKind: 'bundled',
          sourceVsixPath: '/old/app/public/icon-themes/thang-nm.flow-icons-1.3.2.vsix',
        },
      },
    })

    expect(state.ui.workspaceIconTheme).toEqual({
      activeThemeId: 'flow-dawn',
      sourceKind: 'bundled',
      sourceVsixPath: null,
    })
  })

  it('normalizes invalid external workspace icon theme selections to bundled', () => {
    const state = normalizePersistedAppState({
      ui: {
        workspaceIconTheme: {
          activeThemeId: 'flow-deep',
          sourceKind: 'external',
          sourceVsixPath: null,
        },
      },
    })

    expect(state.ui.workspaceIconTheme).toEqual({
      activeThemeId: 'flow-deep',
      sourceKind: 'bundled',
      sourceVsixPath: null,
    })
  })
})

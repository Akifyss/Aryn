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
import { cleanupStaleJsonTempFiles, writeJsonFileAtomic } from '../electron/main/json-file-store'

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
        lastProjectId: 'C:/notes',
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
        lastProjectId: 'C:/project',
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

    expect(state.workspace.lastProjectId).toBe('C:/project')
    expect(state.workspace.projects.map((project) => project.id)).toEqual(['C:/project'])
    await expect(readFile(appStatePath, 'utf8')).resolves.toContain('"lastProjectId": "C:/project"')
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
    expect(state.workspace.lastProjectId).toBe('C:/legacy-workspace')
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
        lastProjectId: 'C:/project',
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

    expect(state.workspace.lastProjectId).toBe('C:/project')
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

  it('cleans up stale internal JSON temp files without touching fresh or unrelated files', async () => {
    const rootPath = await createTempDir()
    const stateDir = path.join(rootPath, '.aryn')
    const conversationDir = path.join(stateDir, 'conversations')
    const staleTimestamp = Date.now() - 120_000
    const freshTimestamp = Date.now()
    const staleAppTempName = `.app-state.json.1234.${staleTimestamp}.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.tmp`
    const staleConversationTempName = `.index.json.1234.${staleTimestamp}.cccccccc-cccc-cccc-cccc-cccccccccccc.tmp`
    const freshWorkspaceTempName = `.workspace-state.json.1234.${freshTimestamp}.bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.tmp`

    await mkdir(conversationDir, { recursive: true })
    await writeFile(path.join(stateDir, staleAppTempName), '{}', 'utf8')
    await writeFile(path.join(stateDir, freshWorkspaceTempName), '{}', 'utf8')
    await writeFile(path.join(stateDir, 'notes.tmp'), 'not ours', 'utf8')
    await writeFile(path.join(stateDir, 'app-state.json'), '{}', 'utf8')
    await writeFile(path.join(conversationDir, staleConversationTempName), '{}', 'utf8')

    await expect(cleanupStaleJsonTempFiles(stateDir, {
      maxAgeMs: 60_000,
      recursive: true,
    })).resolves.toBe(2)
    await expect(cleanupStaleJsonTempFiles(path.join(stateDir, 'missing'))).resolves.toBe(0)

    await expect(readdir(stateDir)).resolves.toEqual(expect.arrayContaining([
      'app-state.json',
      freshWorkspaceTempName,
      'notes.tmp',
    ]))
    await expect(readdir(stateDir)).resolves.not.toContain(staleAppTempName)
    await expect(readdir(conversationDir)).resolves.not.toContain(staleConversationTempName)
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

    expect(state.workspace.lastProjectId).toBe('C:/backup-project')
    expect(state.workspace.lastWorkspacePath).toBe('C:/backup-project')

    const repairedState = JSON.parse(await readFile(appStatePath, 'utf8'))
    expect(repairedState.workspace.lastWorkspacePath).toBe('C:/backup-project')
    expect(repairedState.version).toBe(APP_STATE_SCHEMA_VERSION)
  })

  it('preserves the previous valid app state as a backup before replacing it', async () => {
    const rootPath = await createTempDir()
    const appStatePath = path.join(rootPath, '.aryn', 'app-state.json')
    const store = new AppStateStore(appStatePath)

    await store.update((state) => ({
      ...state,
      workspace: {
        ...state.workspace,
        lastWorkspacePath: 'C:/first',
      },
    }))
    await store.update((state) => ({
      ...state,
      workspace: {
        ...state.workspace,
        lastWorkspacePath: 'C:/second',
      },
    }))

    const currentState = JSON.parse(await readFile(appStatePath, 'utf8'))
    const backupState = JSON.parse(await readFile(`${appStatePath}.bak`, 'utf8'))

    expect(currentState.workspace.lastWorkspacePath).toBe('C:/second')
    expect(backupState.workspace.lastWorkspacePath).toBe('C:/first')
  })

  it('does not overwrite a valid backup with a malformed current JSON file', async () => {
    const rootPath = await createTempDir()
    const statePath = path.join(rootPath, '.aryn', 'state.json')
    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, '{', 'utf8')
    await writeFile(`${statePath}.bak`, JSON.stringify({ value: 'previous-good-state' }), 'utf8')

    await writeJsonFileAtomic(statePath, { value: 'new-state' })

    await expect(readFile(statePath, 'utf8').then(JSON.parse)).resolves.toEqual({ value: 'new-state' })
    await expect(readFile(`${statePath}.bak`, 'utf8').then(JSON.parse)).resolves.toEqual({
      value: 'previous-good-state',
    })
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
        lastProjectId: 'C:/workspace',
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
        lastProjectId: 'C:/workspace',
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

  it('migrates the legacy active project field into the last project field', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeProjectId: 'C:/legacy-project',
        projects: [
          {
            id: 'C:/legacy-project',
            name: 'legacy-project',
            path: 'C:/legacy-project',
          },
        ],
      },
    })

    expect(state.workspace.lastProjectId).toBe('C:/legacy-project')
    expect(state.workspace.activeContext).toEqual({
      kind: 'project',
      projectId: 'C:/legacy-project',
    })
    expect(state.workspace).not.toHaveProperty('activeProjectId')
  })

  it('restores last project from last workspace when the persisted last project is stale', () => {
    const state = normalizePersistedAppState({
      workspace: {
        lastProjectId: 'C:/missing',
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

    expect(state.workspace.lastProjectId).toBe('C:/active')
  })

  it('keeps the project context and last project in sync when persisted fields disagree', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeContext: {
          kind: 'project',
          projectId: 'C:/second',
        },
        lastProjectId: 'C:/first',
        lastWorkspacePath: 'C:/conversation-workspace',
        projects: [
          {
            id: 'C:/first',
            name: 'first',
            path: 'C:/first',
          },
          {
            id: 'C:/second',
            name: 'second',
            path: 'C:/second',
          },
        ],
      },
    })

    expect(state.workspace.activeContext).toEqual({
      kind: 'project',
      projectId: 'C:/second',
    })
    expect(state.workspace.lastProjectId).toBe('C:/second')
    expect(state.workspace.lastWorkspacePath).toBe('C:/second')
  })

  it('does not promote a conversation workspace into the project list', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeContext: {
          kind: 'conversation',
          conversationId: 'conversation-1',
        },
        lastProjectId: 'C:/project',
        lastWorkspacePath: 'C:/Users/me/Documents/Aryn/2026-05-30/topic',
        projects: [
          {
            id: 'C:/project',
            name: 'project',
            path: 'C:/project',
          },
        ],
      },
    })

    expect(state.workspace.activeContext).toEqual({
      kind: 'conversation',
      conversationId: 'conversation-1',
    })
    expect(state.workspace.projects.map((project) => project.path)).toEqual(['C:/project'])
  })

  it('preserves the most recent project when the active context is a conversation', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeContext: {
          kind: 'conversation',
          conversationId: 'conversation-1',
        },
        lastProjectId: 'C:/project',
        lastWorkspacePath: 'C:/Users/me/Documents/Aryn/2026-05-30/topic',
        projects: [
          {
            id: 'C:/project',
            name: 'project',
            path: 'C:/project',
          },
        ],
      },
    })

    expect(state.workspace.activeContext).toEqual({
      kind: 'conversation',
      conversationId: 'conversation-1',
    })
    expect(state.workspace.lastProjectId).toBe('C:/project')
    expect(state.workspace.lastWorkspacePath).toBe('C:/Users/me/Documents/Aryn/2026-05-30/topic')
  })

  it('falls back from an invalid project context to a valid recent project', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeContext: {
          kind: 'project',
          projectId: 'C:/missing',
        },
        lastProjectId: 'C:/project',
        projects: [
          {
            id: 'C:/project',
            name: 'project',
            path: 'C:/project',
          },
        ],
      },
    })

    expect(state.workspace.activeContext).toEqual({
      kind: 'project',
      projectId: 'C:/project',
    })
    expect(state.workspace.lastProjectId).toBe('C:/project')
    expect(state.workspace.lastWorkspacePath).toBe('C:/project')
  })

  it('falls back from an invalid project context to a draft when no project exists', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeContext: {
          kind: 'project',
          projectId: 'C:/missing',
        },
        lastProjectId: 'C:/missing',
        projects: [],
      },
    })

    expect(state.workspace.activeContext).toEqual({ kind: 'conversationDraft' })
    expect(state.workspace.lastProjectId).toBeNull()
    expect(state.workspace.lastWorkspacePath).toBeNull()
  })

  it('keeps conversation drafts projectless even when a previous workspace path exists', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeContext: {
          kind: 'conversationDraft',
        },
        lastWorkspacePath: 'C:/Users/me/Documents/Aryn/2026-05-30/draft',
      },
    })

    expect(state.workspace.activeContext).toEqual({ kind: 'conversationDraft' })
    expect(state.workspace.lastProjectId).toBeNull()
    expect(state.workspace.projects).toEqual([])
  })

  it('keeps a valid active project fallback when the last workspace belongs to a conversation draft', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeContext: {
          kind: 'conversationDraft',
        },
        lastWorkspacePath: 'C:/Users/me/Documents/Aryn/2026-05-30/draft',
        projects: [
          {
            id: 'C:/project',
            name: 'project',
            path: 'C:/project',
          },
        ],
      },
    })

    expect(state.workspace.activeContext).toEqual({ kind: 'conversationDraft' })
    expect(state.workspace.lastProjectId).toBe('C:/project')
    expect(state.workspace.projects.map((project) => project.path)).toEqual(['C:/project'])
  })

  it('deduplicates persisted projects by path while keeping the latest normalized record', () => {
    const state = normalizePersistedAppState({
      workspace: {
        lastProjectId: 'stale-id',
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

  it('deduplicates persisted Windows projects without treating path casing as identity', () => {
    if (process.platform !== 'win32') {
      return
    }

    const state = normalizePersistedAppState({
      workspace: {
        projects: [
          {
            id: 'C:/Workspace',
            name: 'old',
            path: 'C:/Workspace',
          },
          {
            id: 'c:/workspace',
            name: 'current',
            path: 'c:/workspace',
          },
        ],
      },
    })

    expect(state.workspace.projects).toHaveLength(1)
    expect(state.workspace.projects[0]).toMatchObject({
      id: 'c:/workspace',
      name: 'current',
      path: 'c:/workspace',
    })
  })

  it('preserves persisted project order independent of last opened time', () => {
    const state = normalizePersistedAppState({
      workspace: {
        lastProjectId: 'C:/second',
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
          activeThemeId: 'catppuccin-mocha',
          sourceKind: 'external',
          sourceVsixPath: '/Users/me/theme.vsix',
        },
      },
    })

    expect(state.ui.workspaceIconTheme).toEqual({
      activeThemeId: 'catppuccin-mocha',
      sourceKind: 'external',
      sourceVsixPath: '/Users/me/theme.vsix',
    })
  })

  it('stores bundled workspace icon theme selections without a VSIX path', () => {
    const state = normalizePersistedAppState({
      ui: {
        workspaceIconTheme: {
          activeThemeId: 'catppuccin-latte',
          sourceKind: 'bundled',
          sourceVsixPath: '/old/app/public/icon-themes/Catppuccin.catppuccin-vsc-icons-1.26.0.vsix',
        },
      },
    })

    expect(state.ui.workspaceIconTheme).toEqual({
      activeThemeId: 'catppuccin-latte',
      sourceKind: 'bundled',
      sourceVsixPath: null,
    })
  })

  it('normalizes invalid external workspace icon theme selections to bundled', () => {
    const state = normalizePersistedAppState({
      ui: {
        workspaceIconTheme: {
          activeThemeId: 'catppuccin-latte',
          sourceKind: 'external',
          sourceVsixPath: null,
        },
      },
    })

    expect(state.ui.workspaceIconTheme).toEqual({
      activeThemeId: 'catppuccin-latte',
      sourceKind: 'bundled',
      sourceVsixPath: null,
    })
  })
})

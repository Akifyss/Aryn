import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AppStateStore,
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

    expect(state).toEqual({
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

    await expect(readFile(appStatePath, 'utf8')).resolves.toContain('"lastWorkspacePath": "C:/notes"')
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

    expect(nextState).toEqual({
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

  it('deduplicates persisted projects by id while keeping the latest normalized record', () => {
    const state = normalizePersistedAppState({
      workspace: {
        activeProjectId: 'C:/workspace',
        projects: [
          {
            id: 'C:/workspace',
            name: 'old',
            path: 'C:/workspace',
            lastFilePath: 'C:/workspace/old.md',
          },
          {
            id: 'C:/workspace',
            name: 'workspace',
            path: 'C:/workspace',
            lastFilePath: 'C:/workspace/current.md',
          },
        ],
      },
    })

    expect(state.workspace.projects).toHaveLength(1)
    expect(state.workspace.projects[0]).toMatchObject({
      id: 'C:/workspace',
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

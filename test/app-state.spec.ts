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
import { DEFAULT_APP_ICON_ID } from '../electron/main/app-icons'

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
        appIconId: DEFAULT_APP_ICON_ID,
        workspaceIconTheme: {
          activeThemeId: null,
          sourceKind: 'bundled',
          sourceVsixPath: null,
        },
      },
      workspace: {
        entries: {
          'C:/notes': {
            lastAgentSessionPath: null,
            lastFilePath: null,
          },
        },
        lastWorkspacePath: 'C:/notes',
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
        entries: {
          'C:/workspace': {
            lastAgentSessionPath: 'C:/workspace/.sessions/current.json',
            lastFilePath: 'C:/workspace/draft.md',
          },
        },
        lastWorkspacePath: 'C:/workspace',
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
        appIconId: DEFAULT_APP_ICON_ID,
        workspaceIconTheme: {
          activeThemeId: null,
          sourceKind: 'bundled',
          sourceVsixPath: null,
        },
      },
      workspace: {
        entries: {
          'C:/workspace': {
            lastAgentSessionPath: 'C:/workspace/.sessions/current.json',
            lastFilePath: 'C:/workspace/draft.md',
          },
        },
        lastWorkspacePath: 'C:/workspace',
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

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizeWorkspaceTabState,
  normalizeWorkspaceUiState,
  WORKSPACE_STATE_SCHEMA_VERSION,
  WorkspaceStateStore,
} from '../electron/main/workspace-state-store'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => rm(rootPath, { recursive: true, force: true })))
})

async function createTempDir() {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), 'workspace-state-'))
  tempRoots.push(rootPath)
  return rootPath
}

describe('workspace UI state persistence', () => {
  it('normalizes workspace tabs and MEO file state', () => {
    const state = normalizeWorkspaceUiState({
      meoFileStates: {
        'C:/workspace/a.md': {
          findOptions: {
            caseSensitive: true,
            wholeWord: 'bad',
          },
          gitChangesGutter: false,
          gitChangesGutterConfigured: true,
          lineNumbers: false,
          mode: 'live',
          outlineVisible: true,
          topLine: 9,
          topLineOffset: 2,
          viewPositions: {
            live: {
              topLine: 10,
              topLineOffset: 3,
            },
            invalid: {
              topLine: 99,
            },
          },
        },
        '': {
          topLine: 1,
        },
      },
      workspaceTabs: {
        'C:/workspace': {
          activePath: 'C:/workspace/a.md',
          entries: [
            {
              path: 'C:/workspace/a.md',
              viewMode: 'meo',
            },
            {
              path: '',
            },
          ],
        },
        'C:/legacy': {
          activePath: '',
          paths: ['C:/legacy/a.md', '', 'C:/legacy/b.md'],
        },
      },
    })

    expect(state.version).toBe(WORKSPACE_STATE_SCHEMA_VERSION)
    expect(state.meoFileStates).toEqual({
      'C:/workspace/a.md': {
        findOptions: {
          caseSensitive: true,
          wholeWord: false,
        },
        gitChangesGutter: false,
        gitChangesGutterConfigured: true,
        lineNumbers: false,
        mode: 'live',
        outlineVisible: true,
        topLine: 9,
        topLineOffset: 2,
        viewPositions: {
          live: {
            topLine: 10,
            topLineOffset: 3,
          },
        },
      },
    })
    expect(state.workspaceTabs).toEqual({
      'C:/workspace': {
        activePath: 'C:/workspace/a.md',
        entries: [
          {
            path: 'C:/workspace/a.md',
            viewMode: 'meo',
          },
        ],
        paths: ['C:/workspace/a.md'],
      },
      'C:/legacy': {
        activePath: null,
        entries: [
          {
            path: 'C:/legacy/a.md',
          },
          {
            path: 'C:/legacy/b.md',
          },
        ],
        paths: ['C:/legacy/a.md', 'C:/legacy/b.md'],
      },
    })
  })

  it('preserves file system navigation, view, and selection state', () => {
    expect(normalizeWorkspaceTabState({
      activePath: 'C:\\workspace\\README.md',
      entries: [{ path: 'C:\\workspace\\README.md', viewMode: 'meo' }],
      fileSystem: {
        navigation: {
          index: 99,
          stack: ['', 'src', 'src/components/'],
        },
        selectedPath: 'src/App.tsx',
        view: 'columns',
      },
    })).toEqual({
      activePath: 'C:\\workspace\\README.md',
      entries: [{ path: 'C:\\workspace\\README.md', viewMode: 'meo' }],
      fileSystem: {
        navigation: {
          index: 2,
          stack: ['', 'src/', 'src/components/'],
        },
        selectedPath: 'src/App.tsx',
        view: 'columns',
      },
      paths: ['C:\\workspace\\README.md'],
    })
  })

  it('falls back invalid file system view values to icons', () => {
    expect(normalizeWorkspaceTabState({
      fileSystem: {
        navigation: {
          index: -1,
          stack: [''],
        },
        selectedPath: '',
        view: 'unknown',
      },
      paths: ['C:\\workspace\\README.md'],
    })).toEqual({
      activePath: null,
      entries: [{ path: 'C:\\workspace\\README.md' }],
      fileSystem: {
        navigation: {
          index: 0,
          stack: [''],
        },
        selectedPath: null,
        view: 'icons',
      },
      paths: ['C:\\workspace\\README.md'],
    })
  })

  it('writes normalized state atomically and returns cloned reads', async () => {
    const rootPath = await createTempDir()
    const statePath = path.join(rootPath, '.aryn', 'workspace-state.json')
    const store = new WorkspaceStateStore(statePath)

    const updatedState = await store.update((state) => ({
      ...state,
      workspaceTabs: {
        ...state.workspaceTabs,
        'C:/workspace': {
          activePath: 'C:/workspace/a.md',
          entries: [
            {
              path: 'C:/workspace/a.md',
              viewMode: 'preview',
            },
          ],
          paths: [],
        },
      },
    }))
    updatedState.workspaceTabs['C:/workspace'].activePath = 'mutated'

    const rereadState = await store.read()
    const persistedRaw = await readFile(statePath, 'utf8')
    const directoryEntries = await readdir(path.dirname(statePath))

    expect(rereadState.workspaceTabs['C:/workspace'].activePath).toBe('C:/workspace/a.md')
    expect(JSON.parse(persistedRaw)).toMatchObject({
      version: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaceTabs: {
        'C:/workspace': {
          activePath: 'C:/workspace/a.md',
        },
      },
    })
    expect(directoryEntries.filter((entry) => entry.endsWith('.tmp'))).toEqual([])
  })

  it('serializes concurrent workspace state updates without losing patches', async () => {
    const rootPath = await createTempDir()
    const statePath = path.join(rootPath, '.aryn', 'workspace-state.json')
    const store = new WorkspaceStateStore(statePath)

    await Promise.all([
      store.update((state) => ({
        ...state,
        workspaceTabs: {
          ...state.workspaceTabs,
          'C:/one': {
            activePath: 'C:/one/a.md',
            entries: [
              {
                path: 'C:/one/a.md',
              },
            ],
            paths: [],
          },
        },
      })),
      store.update((state) => ({
        ...state,
        meoFileStates: {
          ...state.meoFileStates,
          'C:/one/a.md': {
            mode: 'source',
            topLine: 8,
          },
        },
      })),
    ])

    const state = await store.read()

    expect(state.workspaceTabs['C:/one'].activePath).toBe('C:/one/a.md')
    expect(state.meoFileStates['C:/one/a.md']).toMatchObject({
      mode: 'source',
      topLine: 8,
    })
  })

  it('loads existing state from disk', async () => {
    const rootPath = await createTempDir()
    const statePath = path.join(rootPath, '.aryn', 'workspace-state.json')

    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, JSON.stringify({
      version: 0,
      workspaceTabs: {
        'C:/workspace': {
          paths: ['C:/workspace/a.md'],
        },
      },
    }), 'utf8')

    const store = new WorkspaceStateStore(statePath)

    expect(await store.read()).toMatchObject({
      version: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaceTabs: {
        'C:/workspace': {
          activePath: null,
          entries: [
            {
              path: 'C:/workspace/a.md',
            },
          ],
          paths: ['C:/workspace/a.md'],
        },
      },
    })
  })

  it('does not silently reset workspace UI state when the state file is malformed without backup', async () => {
    const rootPath = await createTempDir()
    const statePath = path.join(rootPath, '.aryn', 'workspace-state.json')

    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, '{', 'utf8')

    const store = new WorkspaceStateStore(statePath)
    await expect(store.read()).rejects.toThrow(SyntaxError)
  })

  it('restores workspace UI state from backup and repairs the primary file', async () => {
    const rootPath = await createTempDir()
    const statePath = path.join(rootPath, '.aryn', 'workspace-state.json')

    await mkdir(path.dirname(statePath), { recursive: true })
    await writeFile(statePath, '{', 'utf8')
    await writeFile(`${statePath}.bak`, JSON.stringify({
      workspaceTabs: {
        'C:/workspace': {
          paths: ['C:/workspace/restored.md'],
        },
      },
    }), 'utf8')

    const store = new WorkspaceStateStore(statePath)
    const state = await store.read()

    expect(state.workspaceTabs['C:/workspace'].paths).toEqual(['C:/workspace/restored.md'])
    await expect(readFile(statePath, 'utf8').then(JSON.parse)).resolves.toMatchObject({
      version: WORKSPACE_STATE_SCHEMA_VERSION,
      workspaceTabs: {
        'C:/workspace': {
          paths: ['C:/workspace/restored.md'],
        },
      },
    })
  })
})

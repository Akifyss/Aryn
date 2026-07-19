import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPersistedWorkspaceTabState,
  initializeRendererPersistentState,
  readStoredGitPanelLayout,
  readStoredLayoutBoolean,
  readStoredLayoutNumber,
  readStoredLeftSidebarTab,
} from '../src/features/persistence/renderer-state'
import type { PersistentClientStateSnapshot } from '../src/features/persistence/types'
import {
  createStoredWorkspaceTabState,
  mergeWorkspaceFileSystemState,
  normalizeWorkspaceFileSystemNavigation,
  normalizeWorkspaceFileSystemState,
  readStoredFileSystemState,
  readStoredTabState,
  toStoredWorkspaceTab,
  writeStoredFileSystemState,
  writeStoredTabState,
} from '../src/features/workspace/lib/workspace-tab-persistence'

const workspacePath = 'C:/workspace'
const persistedFileSystem = {
  navigation: {
    index: 1,
    stack: ['docs/', 'src/'],
  },
  selectedPath: 'src/readme.md',
  view: 'list' as const,
}

function createSnapshot(): PersistentClientStateSnapshot {
  return {
    app: {
      layout: {
        activeLeftSidebarTab: 'git',
        agentChatWidth: 420,
        agentRightSidebarCollapsed: true,
        editorRightSidebarCollapsed: false,
        editorRightSidebarWidth: 360,
        gitPanelHeight: 280,
        gitPanelLayout: 'tree',
        leftSidebarCollapsed: false,
        leftSidebarWidth: 300,
      },
      settings: {
        agent: {
          runningPromptEnterBehavior: 'steer',
        },
        layoutPreference: 'editor',
        meo: {
          focusedLineHighlight: true,
          gitDiffLineHighlights: true,
          imageFolder: 'images',
          outlinePosition: 'left',
        },
        theme: 'dark',
      },
    },
    workspace: {
      meoFileStates: {},
      workspaceTabs: {
        [workspacePath]: {
          activePath: 'C:/workspace/readme.md',
          entries: [{ path: 'C:/workspace/readme.md', viewMode: 'meo' }],
          fileSystem: persistedFileSystem,
          paths: ['C:/workspace/readme.md'],
        },
      },
    },
  }
}

describe('renderer persistence helpers', () => {
  const updateWorkspaceTabState = vi.fn(() => Promise.resolve({ ok: true }))

  beforeEach(() => {
    updateWorkspaceTabState.mockClear()
    vi.stubGlobal('window', {
      appApi: {
        updateWorkspaceTabState,
      },
    })
    initializeRendererPersistentState(createSnapshot())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads initialized layout values and applies typed fallbacks', () => {
    expect(readStoredLayoutNumber('leftSidebarWidth', 240)).toBe(300)
    expect(readStoredLayoutBoolean('agentRightSidebarCollapsed', false)).toBe(true)
    expect(readStoredGitPanelLayout('list')).toBe('tree')
    expect(readStoredLeftSidebarTab()).toBe('git')

    const invalidSnapshot = createSnapshot()
    initializeRendererPersistentState({
      ...invalidSnapshot,
      app: {
        ...invalidSnapshot.app,
        layout: {
          ...invalidSnapshot.app.layout,
          gitPanelLayout: 'invalid',
          leftSidebarWidth: Number.NaN,
        } as PersistentClientStateSnapshot['app']['layout'],
      },
    })

    expect(readStoredLayoutNumber('leftSidebarWidth', 240)).toBe(240)
    expect(readStoredGitPanelLayout('list')).toBe('list')
  })

  it('reads workspace tabs and returns independent default file-system states', () => {
    expect(readStoredTabState(workspacePath)).toMatchObject({
      activePath: 'C:/workspace/readme.md',
      fileSystem: persistedFileSystem,
      paths: ['C:/workspace/readme.md'],
    })
    expect(readStoredFileSystemState(workspacePath)).toEqual(persistedFileSystem)

    const firstDefault = readStoredFileSystemState(null)
    const secondDefault = readStoredFileSystemState(null)
    expect(firstDefault).toEqual({ navigation: null, selectedPath: null, view: 'icons' })
    expect(firstDefault).not.toBe(secondDefault)
  })

  it('normalizes navigation paths, preserves the workspace root, deduplicates, and clamps the index', () => {
    expect(normalizeWorkspaceFileSystemNavigation({
      index: 99,
      stack: ['', ' /docs ', 'docs/', '\\src\\nested', 'src/nested/'],
    })).toEqual({
      index: 2,
      stack: ['', 'docs/', 'src/nested/'],
    })
    expect(normalizeWorkspaceFileSystemNavigation({ index: 0, stack: ['', '  '] })).toEqual({
      index: 0,
      stack: [''],
    })
  })

  it('normalizes invalid file-system values to supported defaults', () => {
    expect(normalizeWorkspaceFileSystemState({
      navigation: null,
      selectedPath: '',
      view: 'unsupported',
    } as never)).toEqual({
      navigation: null,
      selectedPath: null,
      view: 'icons',
    })
  })

  it('merges partial file-system updates without clearing omitted values', () => {
    expect(mergeWorkspaceFileSystemState(persistedFileSystem, {
      view: 'gallery',
    })).toEqual({
      ...persistedFileSystem,
      view: 'gallery',
    })

    expect(mergeWorkspaceFileSystemState(persistedFileSystem, {
      navigation: undefined,
      selectedPath: null,
    })).toEqual({
      navigation: null,
      selectedPath: null,
      view: 'list',
    })
  })

  it('preserves file-system state when writing tab-only changes', () => {
    writeStoredTabState(workspacePath, {
      activePath: 'C:/workspace/guide.md',
      entries: [{ path: 'C:/workspace/guide.md', viewMode: 'code' }],
      paths: ['C:/workspace/guide.md'],
    })

    const nextState = getPersistedWorkspaceTabState(workspacePath)
    expect(nextState).toEqual({
      activePath: 'C:/workspace/guide.md',
      entries: [{ path: 'C:/workspace/guide.md', viewMode: 'code' }],
      fileSystem: persistedFileSystem,
      paths: ['C:/workspace/guide.md'],
    })
    expect(updateWorkspaceTabState).toHaveBeenCalledWith(workspacePath, nextState)
  })

  it('normalizes explicit file-system updates and persists them through the app API', () => {
    writeStoredFileSystemState(workspacePath, {
      navigation: {
        index: -10,
        stack: ['', 'docs', 'docs/', 'src'],
      },
      selectedPath: '',
      view: 'gallery',
    })

    const nextState = getPersistedWorkspaceTabState(workspacePath)
    expect(nextState?.fileSystem).toEqual({
      navigation: {
        index: 0,
        stack: ['', 'docs/', 'src/'],
      },
      selectedPath: null,
      view: 'gallery',
    })
    expect(updateWorkspaceTabState).toHaveBeenLastCalledWith(workspacePath, nextState)
  })

  it('creates restorable workspace file tabs with stable ids', () => {
    expect(toStoredWorkspaceTab('C:/workspace/readme.md', '# Readme', 'prose', 'meo')).toEqual({
      content: '# Readme',
      editorKind: 'prose',
      exists: true,
      filePath: 'C:/workspace/readme.md',
      id: `file://meo/${encodeURIComponent('C:/workspace/readme.md')}`,
      isDirty: false,
      kind: 'file',
      savedContent: '# Readme',
      viewMode: 'meo',
    })
  })

  it('creates a restorable snapshot from file tabs that still exist', () => {
    const existingTab = toStoredWorkspaceTab('C:/workspace/readme.md', '# Readme', 'prose', 'meo')
    const missingTab = {
      ...toStoredWorkspaceTab('C:/workspace/missing.ts', 'const missing = true', 'code', 'code'),
      exists: false,
    }

    expect(createStoredWorkspaceTabState(existingTab.id, [existingTab, missingTab])).toEqual({
      activePath: existingTab.id,
      entries: [{ path: existingTab.filePath, viewMode: 'meo' }],
      paths: [existingTab.filePath],
    })
  })
})

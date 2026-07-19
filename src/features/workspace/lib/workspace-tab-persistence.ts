import {
  getPersistedWorkspaceTabState,
  updatePersistedWorkspaceTabState,
} from '@/features/persistence/renderer-state'
import type { PersistedWorkspaceTabState } from '@/features/persistence/types'
import {
  normalizeWorkspaceFileViewMode,
  type LegacyWorkspaceFileViewMode,
  type WorkspaceFileViewMode,
} from '@/features/workspace/lib/file-types'
import {
  createWorkspaceFileTabId,
  type WorkspaceFileTab,
} from '@/features/workspace/store/use-workspace-store'
import type {
  WorkspaceFileSystemNavigationState,
  WorkspaceFileSystemState,
  WorkspaceFileSystemView,
} from '@/features/workspace/types'

export type StoredTabState = {
  activePath: string | null
  entries?: Array<{
    path: string
    viewMode?: LegacyWorkspaceFileViewMode
  }>
  fileSystem?: WorkspaceFileSystemState | null
  paths: string[]
}

const DEFAULT_WORKSPACE_FILE_SYSTEM_STATE: WorkspaceFileSystemState = {
  navigation: null,
  selectedPath: null,
  view: 'icons',
}

const WORKSPACE_FILE_SYSTEM_VIEWS: WorkspaceFileSystemView[] = ['icons', 'list', 'columns', 'gallery']

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

export function readStoredTabState(workspacePath: string): StoredTabState {
  const storedState = getPersistedWorkspaceTabState(workspacePath)

  if (storedState) {
    return {
      activePath: storedState.activePath,
      entries: storedState.entries,
      fileSystem: storedState.fileSystem ?? null,
      paths: storedState.paths,
    }
  }

  return {
    activePath: null,
    entries: [],
    paths: [],
  }
}

export function normalizeWorkspaceFileSystemNavigation(
  navigation: WorkspaceFileSystemNavigationState | null | undefined,
): WorkspaceFileSystemNavigationState | null {
  if (!navigation || !Array.isArray(navigation.stack) || navigation.stack.length === 0) {
    return null
  }

  const stack = navigation.stack
    .filter((path): path is string => typeof path === 'string')
    .map((path) => {
      const normalizedPath = path.trim().replace(/[\\/]+/g, '/').replace(/^\/+/, '')

      if (!normalizedPath) {
        return ''
      }

      return normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`
    })
    .filter((path, index, allPaths) => index === 0 || path !== allPaths[index - 1])

  if (stack.length === 0) {
    return null
  }

  const index = Number.isFinite(navigation.index)
    ? clamp(Math.trunc(navigation.index), 0, stack.length - 1)
    : 0

  return { index, stack }
}

export function normalizeWorkspaceFileSystemState(
  state: WorkspaceFileSystemState | null | undefined,
): WorkspaceFileSystemState {
  if (!state) {
    return { ...DEFAULT_WORKSPACE_FILE_SYSTEM_STATE }
  }

  return {
    navigation: normalizeWorkspaceFileSystemNavigation(state.navigation),
    selectedPath: state.selectedPath || null,
    view: WORKSPACE_FILE_SYSTEM_VIEWS.includes(state.view) ? state.view : 'icons',
  }
}

export function writeStoredTabState(workspacePath: string, state: StoredTabState) {
  const entries = state.entries ?? state.paths.map((entryPath) => ({ path: entryPath }))
  const previousState = getPersistedWorkspaceTabState(workspacePath)
  const fileSystem = state.fileSystem === undefined
    ? previousState?.fileSystem
    : state.fileSystem ?? undefined
  const nextState: PersistedWorkspaceTabState = {
    activePath: state.activePath,
    entries,
    ...(fileSystem ? { fileSystem } : null),
    paths: entries.map((entry) => entry.path),
  }

  updatePersistedWorkspaceTabState(workspacePath, nextState)
}

export function readStoredFileSystemState(workspacePath: string | null): WorkspaceFileSystemState {
  if (!workspacePath) {
    return { ...DEFAULT_WORKSPACE_FILE_SYSTEM_STATE }
  }

  return normalizeWorkspaceFileSystemState(getPersistedWorkspaceTabState(workspacePath)?.fileSystem)
}

export function writeStoredFileSystemState(workspacePath: string, fileSystem: WorkspaceFileSystemState) {
  writeStoredTabState(workspacePath, {
    ...readStoredTabState(workspacePath),
    fileSystem: normalizeWorkspaceFileSystemState(fileSystem),
  })
}

export function dedupeStoredEntries(entries: Array<{ path: string, viewMode?: LegacyWorkspaceFileViewMode }>) {
  const seen = new Set<string>()

  return entries.filter((entry) => {
    const key = `${entry.path}::${entry.viewMode ?? 'default'}`

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

export function toStoredWorkspaceTab(
  filePath: string,
  content: string,
  editorKind: WorkspaceFileTab['editorKind'],
  viewMode: WorkspaceFileViewMode,
): WorkspaceFileTab {
  return {
    content,
    editorKind,
    exists: true,
    filePath,
    id: createWorkspaceFileTabId(filePath, viewMode),
    isDirty: false,
    kind: 'file',
    savedContent: content,
    viewMode,
  }
}

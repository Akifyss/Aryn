import type {
  PersistedMeoStoredMode,
  PersistedMeoStoredState,
  PersistedMeoStoredViewPosition,
  PersistedWorkspaceTabState,
} from '../../src/features/persistence/types'
import type {
  WorkspaceFileSystemNavigationState,
  WorkspaceFileSystemState,
  WorkspaceFileSystemView,
} from '../../src/features/workspace/types'
import { AtomicJsonStore } from './json-file-store'

export const WORKSPACE_STATE_SCHEMA_VERSION = 1

export type PersistedWorkspaceUiState = {
  version: number
  meoFileStates: Record<string, PersistedMeoStoredState>
  workspaceTabs: Record<string, PersistedWorkspaceTabState>
}

const DEFAULT_WORKSPACE_UI_STATE: PersistedWorkspaceUiState = {
  version: WORKSPACE_STATE_SCHEMA_VERSION,
  meoFileStates: {},
  workspaceTabs: {},
}

const MEO_STORED_MODES: PersistedMeoStoredMode[] = ['diff-split', 'diff-unified', 'live', 'source']
const WORKSPACE_FILE_SYSTEM_VIEWS: WorkspaceFileSystemView[] = ['icons', 'list', 'columns', 'gallery']

function cloneState(state: PersistedWorkspaceUiState) {
  return structuredClone(state)
}

function readNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function readNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readMeoMode(value: unknown): PersistedMeoStoredMode | undefined {
  return MEO_STORED_MODES.includes(value as PersistedMeoStoredMode)
    ? value as PersistedMeoStoredMode
    : undefined
}

function readWorkspaceFileSystemView(value: unknown): WorkspaceFileSystemView | undefined {
  return WORKSPACE_FILE_SYSTEM_VIEWS.includes(value as WorkspaceFileSystemView)
    ? value as WorkspaceFileSystemView
    : undefined
}

function normalizeWorkspaceFileSystemNavigationPath(value: string) {
  const normalizedPath = value.trim().replace(/[\\/]+/g, '/').replace(/^\/+/, '')

  if (!normalizedPath) {
    return ''
  }

  return normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`
}

function readWorkspaceFileSystemNavigationState(
  value: unknown,
): WorkspaceFileSystemNavigationState | null {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const stack = Array.isArray(candidate.stack)
    ? candidate.stack
      .filter((path): path is string => typeof path === 'string')
      .map(normalizeWorkspaceFileSystemNavigationPath)
      .filter((path, index, allPaths) => index === 0 || path !== allPaths[index - 1])
    : []

  if (stack.length === 0) {
    return null
  }

  const rawIndex = readNumber(candidate.index)
  const index = rawIndex === undefined
    ? 0
    : Math.min(Math.max(Math.trunc(rawIndex), 0), stack.length - 1)

  return { index, stack }
}

function readWorkspaceFileSystemState(value: unknown): WorkspaceFileSystemState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  const view = readWorkspaceFileSystemView(candidate.view)
  const selectedPath = readNullableString(candidate.selectedPath)

  return {
    navigation: readWorkspaceFileSystemNavigationState(candidate.navigation),
    selectedPath,
    view: view ?? 'icons',
  }
}

function readMeoViewPosition(value: unknown): PersistedMeoStoredViewPosition | undefined {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const topLine = readNumber(candidate.topLine)

  if (topLine === undefined) {
    return undefined
  }

  return {
    topLine,
    topLineOffset: readNumber(candidate.topLineOffset) ?? 0,
  }
}

function readMeoViewPositions(value: unknown): PersistedMeoStoredState['viewPositions'] {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const source = value as Record<string, unknown>
  const viewPositions: NonNullable<PersistedMeoStoredState['viewPositions']> = {}

  for (const mode of MEO_STORED_MODES) {
    const position = readMeoViewPosition(source[mode])
    if (position) {
      viewPositions[mode] = position
    }
  }

  return Object.keys(viewPositions).length > 0 ? viewPositions : undefined
}

export function normalizeMeoFileState(value: unknown): PersistedMeoStoredState {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const findOptionsCandidate = candidate.findOptions && typeof candidate.findOptions === 'object'
    ? candidate.findOptions as Record<string, unknown>
    : {}

  return {
    findOptions: {
      caseSensitive: findOptionsCandidate.caseSensitive === true,
      wholeWord: findOptionsCandidate.wholeWord === true,
    },
    gitChangesGutter: readBoolean(candidate.gitChangesGutter),
    gitChangesGutterConfigured: readBoolean(candidate.gitChangesGutterConfigured),
    lineNumbers: candidate.lineNumbers !== false,
    mode: readMeoMode(candidate.mode),
    outlineVisible: candidate.outlineVisible === true,
    topLine: readNumber(candidate.topLine),
    topLineOffset: readNumber(candidate.topLineOffset),
    viewPositions: readMeoViewPositions(candidate.viewPositions),
  }
}

export function normalizeWorkspaceTabState(value: unknown): PersistedWorkspaceTabState {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const entries = Array.isArray(candidate.entries)
    ? candidate.entries
      .map((entry) => {
        const entryCandidate = entry && typeof entry === 'object'
          ? entry as Record<string, unknown>
          : {}
        const path = readNullableString(entryCandidate.path)

        if (!path) {
          return null
        }

        const viewMode = entryCandidate.viewMode === 'code'
          || entryCandidate.viewMode === 'default'
          || entryCandidate.viewMode === 'file'
          || entryCandidate.viewMode === 'meo'
          || entryCandidate.viewMode === 'preview'
          ? entryCandidate.viewMode
          : undefined

        return {
          path,
          ...(viewMode ? { viewMode } : null),
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : []
  const legacyPaths = Array.isArray(candidate.paths)
    ? candidate.paths.map(readNullableString).filter((entry): entry is string => Boolean(entry))
    : []
  const normalizedEntries = entries.length > 0
    ? entries
    : legacyPaths.map((entryPath) => ({ path: entryPath }))
  const fileSystem = readWorkspaceFileSystemState(candidate.fileSystem)

  return {
    activePath: readNullableString(candidate.activePath),
    entries: normalizedEntries,
    ...(fileSystem ? { fileSystem } : null),
    paths: normalizedEntries.map((entry) => entry.path),
  }
}

export function normalizeWorkspaceUiState(value: unknown): PersistedWorkspaceUiState {
  if (!value || typeof value !== 'object') {
    return cloneState(DEFAULT_WORKSPACE_UI_STATE)
  }

  const candidate = value as Record<string, unknown>
  const workspaceTabsCandidate = candidate.workspaceTabs && typeof candidate.workspaceTabs === 'object'
    ? candidate.workspaceTabs as Record<string, unknown>
    : {}
  const meoFileStatesCandidate = candidate.meoFileStates && typeof candidate.meoFileStates === 'object'
    ? candidate.meoFileStates as Record<string, unknown>
    : {}

  return {
    version: WORKSPACE_STATE_SCHEMA_VERSION,
    meoFileStates: Object.fromEntries(
      Object.entries(meoFileStatesCandidate)
        .filter(([filePath]) => filePath.trim().length > 0)
        .map(([filePath, state]) => [filePath, normalizeMeoFileState(state)]),
    ),
    workspaceTabs: Object.fromEntries(
      Object.entries(workspaceTabsCandidate)
        .filter(([workspacePath]) => workspacePath.trim().length > 0)
        .map(([workspacePath, state]) => [workspacePath, normalizeWorkspaceTabState(state)]),
    ),
  }
}

export class WorkspaceStateStore {
  private readonly store: AtomicJsonStore<PersistedWorkspaceUiState>

  constructor(private readonly filePath: string) {
    this.store = new AtomicJsonStore({
      defaultState: () => cloneState(DEFAULT_WORKSPACE_UI_STATE),
      filePath: this.filePath,
      normalize: normalizeWorkspaceUiState,
    })
  }

  async read() {
    return this.store.read()
  }

  async update(updater: (currentState: PersistedWorkspaceUiState) => PersistedWorkspaceUiState) {
    return this.store.update(updater)
  }
}

import type {
  PersistedMeoStoredMode,
  PersistedMeoStoredState,
  PersistedMeoStoredViewPosition,
  PersistedWorkspaceTabState,
} from '../../src/features/persistence/types'
import { readPersistedJsonFile, writeJsonFileAtomic } from './app-state'

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

  return {
    activePath: readNullableString(candidate.activePath),
    entries: normalizedEntries,
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
  private cachedState: PersistedWorkspaceUiState | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {}

  async read() {
    await this.writeQueue.catch(() => undefined)
    return cloneState(await this.getCachedState())
  }

  async update(updater: (currentState: PersistedWorkspaceUiState) => PersistedWorkspaceUiState) {
    let nextState: PersistedWorkspaceUiState | null = null

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        nextState = normalizeWorkspaceUiState(updater(cloneState(await this.getCachedState())))
        await writeJsonFileAtomic(this.filePath, nextState)
        this.cachedState = nextState
      })

    await this.writeQueue
    return cloneState(nextState!)
  }

  private async getCachedState() {
    if (!this.cachedState) {
      this.cachedState = await this.load()
    }

    return this.cachedState
  }

  private async load() {
    let persistedJson: Awaited<ReturnType<typeof readPersistedJsonFile>>

    try {
      persistedJson = await readPersistedJsonFile(this.filePath)
    } catch (error) {
      if (error instanceof SyntaxError) {
        return cloneState(DEFAULT_WORKSPACE_UI_STATE)
      }

      throw error
    }

    if (!persistedJson.found) {
      return cloneState(DEFAULT_WORKSPACE_UI_STATE)
    }

    return normalizeWorkspaceUiState(persistedJson.value)
  }
}

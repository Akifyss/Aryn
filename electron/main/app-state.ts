import { readFile, writeFile } from 'node:fs/promises'

export const DEFAULT_WINDOW_WIDTH = 1440
export const DEFAULT_WINDOW_HEIGHT = 900
export const MIN_WINDOW_WIDTH = 1080
export const MIN_WINDOW_HEIGHT = 720
export const DEFAULT_AGENT_COMPOSER_HEIGHT = 172

export type PersistedWorkspaceIconThemeSelection = {
  activeThemeId: string | null
  sourceVsixPath: string | null
}

export type PersistedWorkspaceEntry = {
  lastAgentSessionPath: string | null
  lastFilePath: string | null
}

export type PersistedWorkspaceState = {
  entries: Record<string, PersistedWorkspaceEntry>
  lastWorkspacePath: string | null
}

export type PersistedWindowState = {
  width: number
  height: number
  isMaximized: boolean
}

export type PersistedUiState = {
  agentComposerHeight: number
  workspaceIconTheme: PersistedWorkspaceIconThemeSelection
}

export type PersistedAppState = {
  ui: PersistedUiState
  workspace: PersistedWorkspaceState
  window: PersistedWindowState
}

const DEFAULT_APP_STATE: PersistedAppState = {
  ui: {
    agentComposerHeight: DEFAULT_AGENT_COMPOSER_HEIGHT,
    workspaceIconTheme: {
      activeThemeId: null,
      sourceVsixPath: null,
    },
  },
  workspace: {
    entries: {},
    lastWorkspacePath: null,
  },
  window: {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    isMaximized: false,
  },
}

function cloneState(state: PersistedAppState) {
  return structuredClone(state)
}

function readNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readWorkspaceEntry(value: unknown): PersistedWorkspaceEntry {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    lastAgentSessionPath: readNullableString(candidate.lastAgentSessionPath),
    lastFilePath: readNullableString(candidate.lastFilePath),
  }
}

function readWindowDimension(value: unknown, fallback: number, min: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(min, Math.round(value))
}

function readAgentComposerHeight(value: unknown) {
  return readWindowDimension(value, DEFAULT_AGENT_COMPOSER_HEIGHT, 132)
}

function readWorkspaceIconThemeSelection(value: unknown): PersistedWorkspaceIconThemeSelection {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    activeThemeId: readNullableString(candidate.activeThemeId),
    sourceVsixPath: readNullableString(candidate.sourceVsixPath),
  }
}

export function normalizePersistedAppState(value: unknown): PersistedAppState {
  if (!value || typeof value !== 'object') {
    return cloneState(DEFAULT_APP_STATE)
  }

  const candidate = value as Record<string, unknown>
  const workspaceCandidate = candidate.workspace && typeof candidate.workspace === 'object'
    ? candidate.workspace as Record<string, unknown>
    : candidate
  const windowCandidate = candidate.window && typeof candidate.window === 'object'
    ? candidate.window as Record<string, unknown>
    : {}
  const uiCandidate = candidate.ui && typeof candidate.ui === 'object'
    ? candidate.ui as Record<string, unknown>
    : {}
  const entriesCandidate = workspaceCandidate.entries && typeof workspaceCandidate.entries === 'object'
    ? workspaceCandidate.entries as Record<string, unknown>
    : {}
  const entries = Object.fromEntries(
    Object.entries(entriesCandidate)
      .filter(([workspacePath]) => workspacePath.trim().length > 0)
      .map(([workspacePath, entry]) => [workspacePath, readWorkspaceEntry(entry)]),
  )
  const lastWorkspacePath = readNullableString(workspaceCandidate.lastWorkspacePath)
  const legacyLastFilePath = readNullableString(workspaceCandidate.lastFilePath)

  if (lastWorkspacePath && !entries[lastWorkspacePath]) {
    entries[lastWorkspacePath] = readWorkspaceEntry({
      lastAgentSessionPath: null,
      lastFilePath: legacyLastFilePath,
    })
  }

  return {
    ui: {
      agentComposerHeight: readAgentComposerHeight(uiCandidate.agentComposerHeight),
      workspaceIconTheme: readWorkspaceIconThemeSelection(uiCandidate.workspaceIconTheme),
    },
    workspace: {
      entries,
      lastWorkspacePath,
    },
    window: {
      width: readWindowDimension(windowCandidate.width, DEFAULT_WINDOW_WIDTH, MIN_WINDOW_WIDTH),
      height: readWindowDimension(windowCandidate.height, DEFAULT_WINDOW_HEIGHT, MIN_WINDOW_HEIGHT),
      isMaximized: windowCandidate.isMaximized === true,
    },
  }
}

export class AppStateStore {
  private cachedState: PersistedAppState | null = null
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    private readonly legacyFilePath?: string,
  ) {}

  async read() {
    if (!this.cachedState) {
      this.cachedState = await this.load()
    }

    return cloneState(this.cachedState)
  }

  async update(updater: (currentState: PersistedAppState) => PersistedAppState) {
    const nextState = normalizePersistedAppState(updater(await this.read()))
    this.cachedState = nextState

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        await writeFile(this.filePath, JSON.stringify(nextState, null, 2), 'utf8')
      })

    await this.writeQueue
    return cloneState(nextState)
  }

  private async load() {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizePersistedAppState(JSON.parse(raw))
    } catch {
      return this.loadLegacy()
    }
  }

  private async loadLegacy() {
    if (!this.legacyFilePath) {
      return cloneState(DEFAULT_APP_STATE)
    }

    try {
      const raw = await readFile(this.legacyFilePath, 'utf8')
      const nextState = normalizePersistedAppState(JSON.parse(raw))
      await writeFile(this.filePath, JSON.stringify(nextState, null, 2), 'utf8')
      return nextState
    } catch {
      return cloneState(DEFAULT_APP_STATE)
    }
  }
}

export function getWorkspaceEntry(state: PersistedAppState, workspacePath: string): PersistedWorkspaceEntry {
  return state.workspace.entries[workspacePath]
    ? structuredClone(state.workspace.entries[workspacePath])
    : {
      lastAgentSessionPath: null,
      lastFilePath: null,
    }
}

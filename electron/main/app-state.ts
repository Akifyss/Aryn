import { readFile, writeFile } from 'node:fs/promises'

export const DEFAULT_WINDOW_WIDTH = 1440
export const DEFAULT_WINDOW_HEIGHT = 900
export const MIN_WINDOW_WIDTH = 1080
export const MIN_WINDOW_HEIGHT = 720
export const DEFAULT_AGENT_COMPOSER_HEIGHT = 172

export type PersistedWorkspaceIconThemeSelection = {
  activeThemeId: string | null
  sourceKind: 'bundled' | 'external' | null
  sourceVsixPath: string | null
}

export type PersistedWorkspaceEntry = {
  lastAgentSessionPath: string | null
  lastFilePath: string | null
}

export type PersistedProjectRecord = {
  id: string
  name: string
  path: string
  addedAt: string
  lastOpenedAt: string
  lastFilePath: string | null
}

export type PersistedWorkspaceState = {
  activeProjectId: string | null
  entries: Record<string, PersistedWorkspaceEntry>
  lastWorkspacePath: string | null
  projects: PersistedProjectRecord[]
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
      sourceKind: 'bundled',
      sourceVsixPath: null,
    },
  },
  workspace: {
    activeProjectId: null,
    entries: {},
    lastWorkspacePath: null,
    projects: [],
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

function getPathBaseName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value
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

function readProjectRecord(value: unknown): PersistedProjectRecord | null {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const path = readNullableString(candidate.path)

  if (!path) {
    return null
  }

  const id = readNullableString(candidate.id) ?? path
  const name = readNullableString(candidate.name) ?? getPathBaseName(path)
  const now = new Date(0).toISOString()

  return {
    id,
    name,
    path,
    addedAt: readNullableString(candidate.addedAt) ?? now,
    lastOpenedAt: readNullableString(candidate.lastOpenedAt) ?? readNullableString(candidate.addedAt) ?? now,
    lastFilePath: readNullableString(candidate.lastFilePath),
  }
}

function createProjectRecordFromPath(projectPath: string, patch: Partial<PersistedProjectRecord> = {}): PersistedProjectRecord {
  const timestamp = new Date().toISOString()

  return {
    id: projectPath,
    name: getPathBaseName(projectPath),
    path: projectPath,
    addedAt: timestamp,
    lastOpenedAt: timestamp,
    lastFilePath: null,
    ...patch,
  }
}

function dedupeProjectRecords(projects: PersistedProjectRecord[]) {
  const recordsById = new Map<string, PersistedProjectRecord>()

  for (const project of projects) {
    const existing = recordsById.get(project.id)
    recordsById.set(project.id, existing ? { ...existing, ...project } : project)
  }

  return [...recordsById.values()]
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
  const sourceKind = candidate.sourceKind === 'bundled' || candidate.sourceKind === 'external'
    ? candidate.sourceKind
    : null
  const sourceVsixPath = readNullableString(candidate.sourceVsixPath)
  const normalizedSourceKind = sourceKind === 'external' && !sourceVsixPath
    ? 'bundled'
    : sourceKind ?? (sourceVsixPath ? null : 'bundled')

  return {
    activeThemeId: readNullableString(candidate.activeThemeId),
    sourceKind: normalizedSourceKind,
    sourceVsixPath: normalizedSourceKind === 'bundled' ? null : sourceVsixPath,
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
  const projectsCandidate = Array.isArray(workspaceCandidate.projects)
    ? workspaceCandidate.projects
    : []
  const entries = Object.fromEntries(
    Object.entries(entriesCandidate)
      .filter(([workspacePath]) => workspacePath.trim().length > 0)
      .map(([workspacePath, entry]) => [workspacePath, readWorkspaceEntry(entry)]),
  )
  const lastWorkspacePath = readNullableString(workspaceCandidate.lastWorkspacePath)
  const legacyLastFilePath = readNullableString(workspaceCandidate.lastFilePath)
  let normalizedProjects = dedupeProjectRecords(projectsCandidate
    .map(readProjectRecord)
    .filter((project): project is PersistedProjectRecord => Boolean(project)))

  if (lastWorkspacePath && !entries[lastWorkspacePath]) {
    entries[lastWorkspacePath] = readWorkspaceEntry({
      lastAgentSessionPath: null,
      lastFilePath: legacyLastFilePath,
    })
  }

  if (lastWorkspacePath && !normalizedProjects.some((project) => project.path === lastWorkspacePath)) {
    normalizedProjects = [
      ...normalizedProjects,
      createProjectRecordFromPath(lastWorkspacePath, {
        addedAt: new Date(0).toISOString(),
        lastFilePath: entries[lastWorkspacePath]?.lastFilePath ?? null,
        lastOpenedAt: new Date(0).toISOString(),
      }),
    ]
  }

  const requestedActiveProjectId = readNullableString(workspaceCandidate.activeProjectId)
  const activeProjectId = requestedActiveProjectId && normalizedProjects.some((project) => project.id === requestedActiveProjectId)
    ? requestedActiveProjectId
    : lastWorkspacePath
      ? normalizedProjects.find((project) => project.path === lastWorkspacePath)?.id ?? null
      : normalizedProjects[0]?.id ?? null

  return {
    ui: {
      agentComposerHeight: readAgentComposerHeight(uiCandidate.agentComposerHeight),
      workspaceIconTheme: readWorkspaceIconThemeSelection(uiCandidate.workspaceIconTheme),
    },
    workspace: {
      activeProjectId,
      entries,
      lastWorkspacePath,
      projects: normalizedProjects,
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

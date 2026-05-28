import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  AgentRightSidebarWidthMode,
  AppLayoutPreference,
  AppTheme,
  LeftSidebarTab,
  PersistedAgentSettings,
  PersistedAppSettings,
  PersistedLayoutState,
  PersistedMeoSettings,
  MeoOutlinePosition,
} from '../../src/features/persistence/types'

export const APP_STATE_SCHEMA_VERSION = 1
export const DEFAULT_WINDOW_WIDTH = 1440
export const DEFAULT_WINDOW_HEIGHT = 900
export const MIN_WINDOW_WIDTH = 1080
export const MIN_WINDOW_HEIGHT = 720
export const DEFAULT_AGENT_COMPOSER_HEIGHT = 172
export const DEFAULT_LEFT_SIDEBAR_WIDTH = 320
export const DEFAULT_EDITOR_RIGHT_SIDEBAR_WIDTH = 368
export const DEFAULT_AGENT_RIGHT_SIDEBAR_WIDTH = 520
export const DEFAULT_GIT_PANEL_HEIGHT = 292

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

export type PersistedMigrationState = {
  rendererLocalStorage: number
}

export type PersistedAppState = {
  version: number
  layout: PersistedLayoutState
  migrations: PersistedMigrationState
  settings: PersistedAppSettings
  ui: PersistedUiState
  workspace: PersistedWorkspaceState
  window: PersistedWindowState
}

const DEFAULT_AGENT_SETTINGS: PersistedAgentSettings = {
  runningPromptEnterBehavior: 'followUp',
}

const DEFAULT_MEO_SETTINGS: PersistedMeoSettings = {
  focusedLineHighlight: false,
  gitDiffLineHighlights: true,
  imageFolder: 'assets',
  outlinePosition: 'right',
}

const DEFAULT_APP_SETTINGS: PersistedAppSettings = {
  agent: DEFAULT_AGENT_SETTINGS,
  layoutPreference: 'agent',
  meo: DEFAULT_MEO_SETTINGS,
  theme: 'auto',
}

const DEFAULT_LAYOUT_STATE: PersistedLayoutState = {
  activeLeftSidebarTab: 'file',
  agentRightSidebarCollapsed: false,
  agentRightSidebarWidth: DEFAULT_AGENT_RIGHT_SIDEBAR_WIDTH,
  agentRightSidebarWidthMode: 'max',
  editorRightSidebarCollapsed: false,
  editorRightSidebarWidth: DEFAULT_EDITOR_RIGHT_SIDEBAR_WIDTH,
  gitPanelHeight: DEFAULT_GIT_PANEL_HEIGHT,
  gitPanelLayout: 'list',
  leftSidebarCollapsed: false,
  leftSidebarWidth: DEFAULT_LEFT_SIDEBAR_WIDTH,
}

const DEFAULT_APP_STATE: PersistedAppState = {
  version: APP_STATE_SCHEMA_VERSION,
  layout: DEFAULT_LAYOUT_STATE,
  migrations: {
    rendererLocalStorage: 0,
  },
  settings: DEFAULT_APP_SETTINGS,
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

export async function writeJsonFileAtomic(filePath: string, value: unknown) {
  const directoryPath = path.dirname(filePath)
  const temporaryFilePath = path.join(directoryPath, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`)

  await mkdir(directoryPath, { mode: 0o700, recursive: true })

  try {
    await writeFile(temporaryFilePath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporaryFilePath, filePath)
  } catch (error) {
    await rm(temporaryFilePath, { force: true }).catch(() => undefined)
    throw error
  }
}

function readNullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function readNumber(value: unknown, fallback: number, min = Number.NEGATIVE_INFINITY) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(min, Math.round(value))
}

function readAppTheme(value: unknown): AppTheme {
  return value === 'light' || value === 'dark' || value === 'auto' ? value : DEFAULT_APP_SETTINGS.theme
}

function readLayoutPreference(value: unknown): AppLayoutPreference {
  return value === 'editor' || value === 'agent' ? value : DEFAULT_APP_SETTINGS.layoutPreference
}

function readRunningPromptEnterBehavior(value: unknown) {
  return value === 'steer' || value === 'followUp'
    ? value
    : DEFAULT_AGENT_SETTINGS.runningPromptEnterBehavior
}

function sanitizeMeoImageFolder(imageFolder: unknown) {
  if (typeof imageFolder !== 'string') {
    return DEFAULT_MEO_SETTINGS.imageFolder
  }

  const segments = imageFolder
    .replace(/[\\/]+/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    return DEFAULT_MEO_SETTINGS.imageFolder
  }

  return segments.filter((segment) => segment !== '.').join('/')
}

function readMeoOutlinePosition(value: unknown): MeoOutlinePosition {
  return value === 'left' ? 'left' : DEFAULT_MEO_SETTINGS.outlinePosition
}

function readAgentRightSidebarWidthMode(value: unknown): AgentRightSidebarWidthMode {
  return value === 'fixed' ? 'fixed' : DEFAULT_LAYOUT_STATE.agentRightSidebarWidthMode
}

function readLeftSidebarTab(value: unknown): LeftSidebarTab {
  return value === 'git' ? 'git' : DEFAULT_LAYOUT_STATE.activeLeftSidebarTab
}

function readGitPanelLayout(value: unknown) {
  return value === 'tree' ? 'tree' : DEFAULT_LAYOUT_STATE.gitPanelLayout
}

function readNonNegativeInteger(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

export function normalizeMigrationState(value: unknown): PersistedMigrationState {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    rendererLocalStorage: readNonNegativeInteger(candidate.rendererLocalStorage),
  }
}

export function normalizeAppSettings(value: unknown): PersistedAppSettings {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const stateCandidate = candidate.state && typeof candidate.state === 'object'
    ? candidate.state as Record<string, unknown>
    : candidate
  const agentCandidate = stateCandidate.agent && typeof stateCandidate.agent === 'object'
    ? stateCandidate.agent as Record<string, unknown>
    : {}
  const meoCandidate = stateCandidate.meo && typeof stateCandidate.meo === 'object'
    ? stateCandidate.meo as Record<string, unknown>
    : {}

  return {
    agent: {
      runningPromptEnterBehavior: readRunningPromptEnterBehavior(agentCandidate.runningPromptEnterBehavior),
    },
    layoutPreference: readLayoutPreference(stateCandidate.layoutPreference),
    meo: {
      focusedLineHighlight: meoCandidate.focusedLineHighlight === true,
      gitDiffLineHighlights: readBoolean(meoCandidate.gitDiffLineHighlights, DEFAULT_MEO_SETTINGS.gitDiffLineHighlights),
      imageFolder: sanitizeMeoImageFolder(meoCandidate.imageFolder),
      outlinePosition: readMeoOutlinePosition(meoCandidate.outlinePosition),
    },
    theme: readAppTheme(stateCandidate.theme),
  }
}

export function normalizeLayoutState(value: unknown): PersistedLayoutState {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}

  return {
    activeLeftSidebarTab: readLeftSidebarTab(candidate.activeLeftSidebarTab),
    agentRightSidebarCollapsed: readBoolean(candidate.agentRightSidebarCollapsed, DEFAULT_LAYOUT_STATE.agentRightSidebarCollapsed),
    agentRightSidebarWidth: readNumber(candidate.agentRightSidebarWidth, DEFAULT_LAYOUT_STATE.agentRightSidebarWidth, 1),
    agentRightSidebarWidthMode: readAgentRightSidebarWidthMode(candidate.agentRightSidebarWidthMode),
    editorRightSidebarCollapsed: readBoolean(candidate.editorRightSidebarCollapsed, DEFAULT_LAYOUT_STATE.editorRightSidebarCollapsed),
    editorRightSidebarWidth: readNumber(candidate.editorRightSidebarWidth, DEFAULT_LAYOUT_STATE.editorRightSidebarWidth, 1),
    gitPanelHeight: readNumber(candidate.gitPanelHeight, DEFAULT_LAYOUT_STATE.gitPanelHeight, 1),
    gitPanelLayout: readGitPanelLayout(candidate.gitPanelLayout),
    leftSidebarCollapsed: readBoolean(candidate.leftSidebarCollapsed, DEFAULT_LAYOUT_STATE.leftSidebarCollapsed),
    leftSidebarWidth: readNumber(candidate.leftSidebarWidth, DEFAULT_LAYOUT_STATE.leftSidebarWidth, 1),
  }
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
  const recordsByPath = new Map<string, PersistedProjectRecord>()

  for (const project of projects) {
    const existing = recordsByPath.get(project.path)
    recordsByPath.set(project.path, existing ? { ...existing, ...project } : project)
  }

  return [...recordsByPath.values()]
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
  const layoutCandidate = candidate.layout && typeof candidate.layout === 'object'
    ? candidate.layout
    : {}
  const settingsCandidate = candidate.settings && typeof candidate.settings === 'object'
    ? candidate.settings
    : {}
  const migrationsCandidate = candidate.migrations && typeof candidate.migrations === 'object'
    ? candidate.migrations
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
    version: APP_STATE_SCHEMA_VERSION,
    layout: normalizeLayoutState(layoutCandidate),
    migrations: normalizeMigrationState(migrationsCandidate),
    settings: normalizeAppSettings(settingsCandidate),
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

function hasWorkspaceData(state: PersistedAppState) {
  return Boolean(state.workspace.lastWorkspacePath)
    || state.workspace.projects.length > 0
    || Object.keys(state.workspace.entries).length > 0
}

function mergeLegacyAppState(primary: PersistedAppState, fallback: PersistedAppState): PersistedAppState {
  if (!hasWorkspaceData(primary) && hasWorkspaceData(fallback)) {
    return {
      ...primary,
      workspace: fallback.workspace,
    }
  }

  const primaryProjectPaths = new Set(primary.workspace.projects.map((project) => project.path))
  const fallbackEntriesForKnownProjects = Object.fromEntries(
    Object.entries(fallback.workspace.entries)
      .filter(([workspacePath]) => primaryProjectPaths.has(workspacePath)),
  )
  const projects = primary.workspace.projects.map((project) => {
    const fallbackProject = fallback.workspace.projects.find((candidate) => candidate.path === project.path)
    return fallbackProject ? { ...fallbackProject, ...project } : project
  })

  return normalizePersistedAppState({
    ...primary,
    workspace: {
      activeProjectId: primary.workspace.activeProjectId,
      entries: {
        ...fallbackEntriesForKnownProjects,
        ...primary.workspace.entries,
      },
      lastWorkspacePath: primary.workspace.lastWorkspacePath,
      projects,
    },
  })
}

export class AppStateStore {
  private cachedState: PersistedAppState | null = null
  private readonly legacyFilePaths: string[]
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly filePath: string,
    legacyFilePaths?: string | string[],
  ) {
    this.legacyFilePaths = Array.isArray(legacyFilePaths)
      ? legacyFilePaths
      : legacyFilePaths
        ? [legacyFilePaths]
        : []
  }

  async read() {
    await this.writeQueue.catch(() => undefined)
    return cloneState(await this.getCachedState())
  }

  async update(updater: (currentState: PersistedAppState) => PersistedAppState) {
    let nextState: PersistedAppState | null = null

    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        nextState = normalizePersistedAppState(updater(cloneState(await this.getCachedState())))
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
    try {
      const raw = await readFile(this.filePath, 'utf8')
      return normalizePersistedAppState(JSON.parse(raw))
    } catch {
      return this.loadLegacy()
    }
  }

  private async loadLegacy() {
    let nextState: PersistedAppState | null = null

    for (const legacyFilePath of this.legacyFilePaths) {
      try {
        const raw = await readFile(legacyFilePath, 'utf8')
        const legacyState = normalizePersistedAppState(JSON.parse(raw))
        nextState = nextState
          ? mergeLegacyAppState(nextState, legacyState)
          : legacyState
      } catch {
        // Try the next legacy source.
      }
    }

    if (!nextState) {
      return cloneState(DEFAULT_APP_STATE)
    }

    try {
      await writeJsonFileAtomic(this.filePath, nextState)
    } catch {
      // Reading legacy state is more important than immediately persisting the migration.
    }

    return nextState
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

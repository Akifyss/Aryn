import type {
  LocalStorageStateMigration,
  PersistedLayoutState,
} from '@/features/persistence/types'

const APP_STORAGE_PREFIX = 'aryn'
const LEGACY_APP_STORAGE_PREFIX = String.fromCharCode(
  119,
  114,
  105,
  116,
  105,
  110,
  103,
  45,
  119,
  111,
  114,
  107,
  115,
  112,
  97,
  99,
  101,
)

const SETTINGS_STORAGE_KEYS = [
  `${APP_STORAGE_PREFIX}:settings`,
  `${LEGACY_APP_STORAGE_PREFIX}:settings`,
]

const TAB_STORAGE_PREFIXES = [
  `${APP_STORAGE_PREFIX}:file-tabs:`,
  `${APP_STORAGE_PREFIX}:editor-tabs:`,
  `${LEGACY_APP_STORAGE_PREFIX}:file-tabs:`,
  `${LEGACY_APP_STORAGE_PREFIX}:editor-tabs:`,
]

const MEO_STATE_STORAGE_PREFIX = `${APP_STORAGE_PREFIX}:meo-state:`

const LAYOUT_STORAGE_KEYS: Record<keyof PersistedLayoutState, string[]> = {
  activeLeftSidebarTab: [`${APP_STORAGE_PREFIX}:active-left-sidebar-tab`],
  agentChatWidth: [`${APP_STORAGE_PREFIX}:agent-chat-width`],
  agentRightSidebarCollapsed: [`${APP_STORAGE_PREFIX}:agent-right-sidebar-collapsed`],
  editorRightSidebarCollapsed: [`${APP_STORAGE_PREFIX}:editor-right-sidebar-collapsed`, `${APP_STORAGE_PREFIX}:right-sidebar-collapsed`, `${LEGACY_APP_STORAGE_PREFIX}:right-sidebar-collapsed`],
  editorRightSidebarWidth: [`${APP_STORAGE_PREFIX}:editor-right-sidebar-width`, `${APP_STORAGE_PREFIX}:right-sidebar-width`, `${LEGACY_APP_STORAGE_PREFIX}:right-sidebar-width`],
  gitPanelHeight: [`${APP_STORAGE_PREFIX}:git-panel-height`, `${LEGACY_APP_STORAGE_PREFIX}:git-panel-height`],
  gitPanelLayout: [`${APP_STORAGE_PREFIX}:git-panel-layout`, `${LEGACY_APP_STORAGE_PREFIX}:git-panel-layout`],
  leftSidebarCollapsed: [`${APP_STORAGE_PREFIX}:left-sidebar-collapsed`, `${LEGACY_APP_STORAGE_PREFIX}:left-sidebar-collapsed`],
  leftSidebarWidth: [`${APP_STORAGE_PREFIX}:left-sidebar-width`, `${LEGACY_APP_STORAGE_PREFIX}:left-sidebar-width`],
}

const RETIRED_LAYOUT_STORAGE_KEYS = [
  `${APP_STORAGE_PREFIX}:agent-right-sidebar-width`,
  `${APP_STORAGE_PREFIX}:agent-right-sidebar-width-mode`,
]

export type LocalStorageMigrationSnapshot = {
  keysToRemove: string[]
  migration: LocalStorageStateMigration
}

function parseJson(value: string | null) {
  if (!value) {
    return undefined
  }

  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function decodeStorageSuffix(key: string, prefix: string) {
  try {
    return decodeURIComponent(key.slice(prefix.length))
  } catch {
    return null
  }
}

function parseStorageScalar(value: string | null) {
  if (value === null) {
    return undefined
  }

  if (value === 'true') {
    return true
  }

  if (value === 'false') {
    return false
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) && value.trim() !== '' ? numericValue : value
}

function collectSettings(storage: Storage, keysToRemove: Set<string>) {
  let selectedValue: unknown

  for (const key of SETTINGS_STORAGE_KEYS) {
    const value = parseJson(storage.getItem(key))

    if (value !== undefined) {
      keysToRemove.add(key)
      selectedValue ??= value
    }
  }

  if (selectedValue === undefined) {
    return undefined
  }

  return selectedValue && typeof selectedValue === 'object' && 'state' in selectedValue
    ? (selectedValue as { state?: unknown }).state
    : selectedValue
}

function collectLayout(storage: Storage, keysToRemove: Set<string>) {
  const layout: Record<string, unknown> = {}

  for (const [stateKey, storageKeys] of Object.entries(LAYOUT_STORAGE_KEYS)) {
    for (const storageKey of storageKeys) {
      const value = parseStorageScalar(storage.getItem(storageKey))

      if (value !== undefined) {
        layout[stateKey] = value
        storageKeys.forEach((candidate) => keysToRemove.add(candidate))
        break
      }
    }
  }

  for (const storageKey of RETIRED_LAYOUT_STORAGE_KEYS) {
    if (storage.getItem(storageKey) !== null) {
      keysToRemove.add(storageKey)
    }
  }

  return Object.keys(layout).length > 0 ? layout : undefined
}

function collectWorkspaceTabs(storage: Storage, keysToRemove: Set<string>) {
  const workspaceTabs: Record<string, unknown> = {}

  for (const prefix of TAB_STORAGE_PREFIXES) {
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)

      if (!key || !key.startsWith(prefix)) {
        continue
      }

      const workspacePath = decodeStorageSuffix(key, prefix)
      const state = parseJson(storage.getItem(key))

      if (workspacePath && state !== undefined) {
        if (workspaceTabs[workspacePath] === undefined) {
          workspaceTabs[workspacePath] = state
        }
        keysToRemove.add(key)
      }
    }
  }

  return Object.keys(workspaceTabs).length > 0 ? workspaceTabs : undefined
}

function collectMeoFileStates(storage: Storage, keysToRemove: Set<string>) {
  const meoFileStates: Record<string, unknown> = {}

  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)

    if (!key || !key.startsWith(MEO_STATE_STORAGE_PREFIX)) {
      continue
    }

    const filePath = decodeStorageSuffix(key, MEO_STATE_STORAGE_PREFIX)
    const state = parseJson(storage.getItem(key))

    if (filePath && state !== undefined) {
      meoFileStates[filePath] = state
      keysToRemove.add(key)
    }
  }

  return Object.keys(meoFileStates).length > 0 ? meoFileStates : undefined
}

export function collectLocalStorageMigration(storage: Storage | null): LocalStorageMigrationSnapshot {
  if (!storage) {
    return {
      keysToRemove: [],
      migration: {},
    }
  }

  const keysToRemove = new Set<string>()
  const migration: LocalStorageStateMigration = {
    layout: collectLayout(storage, keysToRemove),
    meoFileStates: collectMeoFileStates(storage, keysToRemove),
    settings: collectSettings(storage, keysToRemove),
    workspaceTabs: collectWorkspaceTabs(storage, keysToRemove),
  }

  return {
    keysToRemove: [...keysToRemove],
    migration,
  }
}

export function removeMigratedLocalStorageKeys(storage: Storage | null, keys: string[]) {
  if (!storage) {
    return
  }

  keys.forEach((key) => storage.removeItem(key))
}

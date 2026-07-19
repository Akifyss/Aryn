import type { GitPanelLayout } from '@/features/git/types'
import type {
  LeftSidebarTab,
  PersistedLayoutState,
  PersistedWorkspaceTabState,
  PersistentClientStateSnapshot,
} from '@/features/persistence/types'

let initialLayoutState: PersistedLayoutState | null = null
let persistedWorkspaceTabState = new Map<string, PersistedWorkspaceTabState>()

export function initializeRendererPersistentState(snapshot: PersistentClientStateSnapshot) {
  initialLayoutState = snapshot.app.layout
  persistedWorkspaceTabState = new Map(Object.entries(snapshot.workspace.workspaceTabs))
}

export function readStoredLayoutNumber(
  key: keyof PersistedLayoutState,
  fallback: number,
) {
  const value = initialLayoutState?.[key]
  const parsedValue = typeof value === 'number' ? value : NaN

  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

export function readStoredLayoutBoolean(
  key: keyof PersistedLayoutState,
  fallback: boolean,
) {
  const value = initialLayoutState?.[key]

  return typeof value === 'boolean' ? value : fallback
}

export function readStoredGitPanelLayout(fallback: GitPanelLayout) {
  const value = initialLayoutState?.gitPanelLayout

  return value === 'list' || value === 'tree' ? value : fallback
}

export function readStoredLeftSidebarTab(): LeftSidebarTab {
  return initialLayoutState?.activeLeftSidebarTab === 'git' ? 'git' : 'file'
}

export function getPersistedWorkspaceTabState(workspacePath: string) {
  return persistedWorkspaceTabState.get(workspacePath)
}

export function updatePersistedWorkspaceTabState(
  workspacePath: string,
  state: PersistedWorkspaceTabState,
) {
  persistedWorkspaceTabState.set(workspacePath, state)
  void window.appApi.updateWorkspaceTabState(workspacePath, state).catch(() => undefined)
}

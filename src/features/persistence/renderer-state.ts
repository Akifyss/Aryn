import type { GitPanelLayout } from '@/features/git/types'
import type {
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

export function readStoredGitPanelLayout(fallback: GitPanelLayout) {
  const value = initialLayoutState?.gitPanelLayout

  return value === 'list' || value === 'tree' ? value : fallback
}

export function readStoredLegacyWorkspaceLayout() {
  return initialLayoutState?.legacyWorkspaceLayout
}

export function readStoredProjectWorkspaces() {
  return initialLayoutState?.projectWorkspaces
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

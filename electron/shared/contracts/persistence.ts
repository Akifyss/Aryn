import type { AgentRunningPromptBehavior } from '../agent-contracts/types'
import type { GitPanelLayout } from './git'
import type { WorkspaceFileSystemState } from './workspace'
import type { LegacyWorkspaceFileViewMode } from './workspace-files'
import type { PersistedWorkbenchLayout, PersistedProjectWorkspaces } from './workbench-layout'

export type AppTheme = 'light' | 'dark' | 'auto'
export type AgentRunningPromptEnterBehavior = AgentRunningPromptBehavior
export type MeoOutlinePosition = 'left' | 'right'

export type PersistedAgentSettings = {
  runningPromptEnterBehavior: AgentRunningPromptEnterBehavior
}

export type PersistedMeoSettings = {
  focusedLineHighlight: boolean
  gitDiffLineHighlights: boolean
  imageFolder: string
  outlinePosition: MeoOutlinePosition
}

export type PersistedAppSettings = {
  agent: PersistedAgentSettings
  meo: PersistedMeoSettings
  theme: AppTheme
}

export type PersistedLayoutState = {
  legacyWorkspaceLayout?: PersistedWorkbenchLayout
  projectWorkspaces?: PersistedProjectWorkspaces
  gitPanelLayout: GitPanelLayout
}

export type PersistedWorkspaceTabState = {
  activePath: string | null
  entries: Array<{
    path: string
    viewMode?: LegacyWorkspaceFileViewMode
  }>
  fileSystem?: WorkspaceFileSystemState
  paths: string[]
}

export type PersistedMeoStoredMode = 'diff-split' | 'diff-unified' | 'live' | 'source'

export type PersistedMeoStoredViewPosition = {
  topLine: number
  topLineOffset: number
}

export type PersistedMeoStoredState = {
  findOptions?: {
    caseSensitive: boolean
    wholeWord: boolean
  }
  gitChangesGutter?: boolean
  gitChangesGutterConfigured?: boolean
  lineNumbers?: boolean
  mode?: PersistedMeoStoredMode
  outlineVisible?: boolean
  topLine?: number
  topLineOffset?: number
  viewPositions?: Partial<Record<PersistedMeoStoredMode, PersistedMeoStoredViewPosition>>
}

export type LocalStorageStateMigration = {
  layout?: unknown
  meoFileStates?: Record<string, unknown>
  settings?: unknown
  workspaceTabs?: Record<string, unknown>
}

export type PersistentClientStateSnapshot = {
  app: {
    layout: PersistedLayoutState
    settings: PersistedAppSettings
  }
  workspace: {
    meoFileStates: Record<string, PersistedMeoStoredState>
    workspaceTabs: Record<string, PersistedWorkspaceTabState>
  }
}

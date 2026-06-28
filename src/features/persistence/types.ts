import type { AgentRunningPromptBehavior } from '@/features/agent/types'
import type { LegacyWorkspaceFileViewMode } from '@/features/workspace/lib/file-types'
import type { GitPanelLayout } from '@/features/git/types'
import type { WorkspaceFileSystemState } from '@/features/workspace/types'

export type AppTheme = 'light' | 'dark' | 'auto'
export type AppLayoutPreference = 'agent' | 'editor'
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
  layoutPreference: AppLayoutPreference
  meo: PersistedMeoSettings
  theme: AppTheme
}

export type LeftSidebarTab = 'file' | 'git'

export type PersistedLayoutState = {
  activeLeftSidebarTab: LeftSidebarTab
  agentChatWidth: number
  agentRightSidebarCollapsed: boolean
  editorRightSidebarCollapsed: boolean
  editorRightSidebarWidth: number
  gitPanelHeight: number
  gitPanelLayout: GitPanelLayout
  leftSidebarCollapsed: boolean
  leftSidebarWidth: number
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

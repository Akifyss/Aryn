import type { AgentClientEvent, AgentWorkspaceState } from '@/features/agent/types'
import type {
  GitChangeItem,
  GitChangeScope,
  GitDiffBlockAction,
  GitDiffSelection,
  GitFileDiffResult,
  GitRepositoryState,
} from '@/features/git/types'
import type {
  WorkspaceChangeEvent,
  WorkspaceIconTheme,
  WorkspaceIconThemeCatalogOption,
  WorkspaceNode,
} from '@/features/workspace/types'
import type { AppIconCatalogOption } from '@/features/settings/types'

/// <reference types="vite/client" />

declare global {
  interface Window {
    appApi: {
      platform: NodeJS.Platform
      pickWorkspace: () => Promise<string | null>
      getWorkspaceRestoreState: () => Promise<{ workspacePath: string | null, filePath: string | null, agentSessionPath: string | null }>
      getWorkspaceState: (workspacePath: string) => Promise<{ lastFilePath: string | null, lastAgentSessionPath: string | null }>
      updateWorkspaceState: (workspacePath: string, patch: { lastFilePath?: string | null, lastAgentSessionPath?: string | null, markAsLastOpened?: boolean }) => Promise<{ ok: boolean }>
      loadWorkspaceTree: (rootPath: string) => Promise<WorkspaceNode[]>
      resolveWorkspaceEditorKind: (filePath: string) => Promise<'rich-text' | 'code' | null>
      readWorkspaceFile: (filePath: string) => Promise<string>
      saveWorkspaceFile: (filePath: string, content: string) => Promise<{ ok: boolean }>
      createWorkspaceFile: (rootPath: string, relativeFilePath: string) => Promise<{ filePath: string }>
      createWorkspaceDirectory: (rootPath: string, relativeDirPath: string) => Promise<{ dirPath: string }>
      moveWorkspaceEntry: (rootPath: string, entryPath: string, nextRelativePath: string) => Promise<{ filePath: string }>
      deleteWorkspaceFile: (rootPath: string, filePath: string) => Promise<{ ok: boolean }>
      getGitRepositoryState: (workspacePath: string) => Promise<GitRepositoryState>
      initializeGitRepository: (workspacePath: string) => Promise<GitRepositoryState>
      stageGitPaths: (workspacePath: string, filePaths: string[]) => Promise<GitRepositoryState>
      unstageGitPaths: (workspacePath: string, filePaths: string[]) => Promise<GitRepositoryState>
      discardGitChange: (workspacePath: string, change: GitChangeItem) => Promise<GitRepositoryState>
      applyGitDiffSelection: (
        workspacePath: string,
        filePath: string,
        scope: GitChangeScope,
        selection: GitDiffSelection,
        action: GitDiffBlockAction,
      ) => Promise<GitRepositoryState>
      discardAllGitChanges: (workspacePath: string) => Promise<GitRepositoryState>
      commitGitChanges: (workspacePath: string, message: string) => Promise<GitRepositoryState>
      commitAndSyncGitChanges: (workspacePath: string, message: string) => Promise<GitRepositoryState>
      pullGitChanges: (workspacePath: string) => Promise<GitRepositoryState>
      pushGitChanges: (workspacePath: string) => Promise<GitRepositoryState>
      getGitFileDiff: (workspacePath: string, filePath: string, scope: GitChangeScope) => Promise<GitFileDiffResult>
      getWorkspaceIconTheme: () => Promise<WorkspaceIconTheme | null>
      getWorkspaceIconThemeCatalog: () => Promise<WorkspaceIconThemeCatalogOption[]>
      pickWorkspaceIconTheme: () => Promise<WorkspaceIconTheme | null>
      setWorkspaceIconTheme: (selection: { sourceVsixPath: string, themeId: string }) => Promise<WorkspaceIconTheme | null>
      getAppIconCatalog: () => Promise<AppIconCatalogOption[]>
      getAppIconSelection: () => Promise<string>
      setAppIconSelection: (appIconId: string) => Promise<string>
      getUiState: () => Promise<{ agentComposerHeight: number }>
      updateUiState: (patch: { agentComposerHeight?: number }) => Promise<{ ok: boolean }>
      startWorkspaceWatch: (rootPath: string) => Promise<{ ok: boolean }>
      stopWorkspaceWatch: () => Promise<{ ok: boolean }>
      loadAgentWorkspace: (rootPath: string, preferredSessionPath?: string | null) => Promise<AgentWorkspaceState>
      createAgentSession: (rootPath: string, name?: string) => Promise<AgentWorkspaceState>
      openAgentSession: (rootPath: string, sessionPath: string) => Promise<AgentWorkspaceState>
      deleteAgentSession: (rootPath: string, sessionPath: string) => Promise<AgentWorkspaceState>
      renameAgentSession: (name: string) => Promise<AgentWorkspaceState>
      sendAgentPrompt: (prompt: string, streamingBehavior?: 'steer' | 'followUp') => Promise<{ ok: boolean }>
      selectAgentModel: (modelKey: string) => Promise<AgentWorkspaceState>
      updateAgentProviderAuth: (rootPath: string, provider: string, apiKey: string | null) => Promise<AgentWorkspaceState>
      abortAgentPrompt: () => Promise<AgentWorkspaceState>
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<{ isMaximized: boolean }>
      closeWindow: () => Promise<void>
      isWindowMaximized: () => Promise<{ isMaximized: boolean }>
      refreshWindowInteractionRegions: (mode?: 'soft' | 'hard') => Promise<{ ok: boolean }>
      onWindowCloseRequested: (listener: () => void) => () => void
      onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => () => void
      onAgentEvent: (listener: (event: AgentClientEvent) => void) => () => void
    }
  }
}

declare module 'monaco-editor/esm/vs/editor/editor.worker?worker' {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/css/css.worker?worker' {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/html/html.worker?worker' {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/json/json.worker?worker' {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}

declare module 'monaco-editor/esm/vs/language/typescript/ts.worker?worker' {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}

export {}

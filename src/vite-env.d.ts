import type { AgentClientEvent, AgentPromptAttachment, AgentProviderAuthUiEvent, AgentRunningPromptBehavior, AgentThinkingLevel, AgentWorkspaceState } from '@/features/agent/types'
import type {
  GitBaselinePayload,
  GitBlameResult,
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
      resolveWorkspaceEditorKind: (filePath: string) => Promise<'prose' | 'code' | null>
      readWorkspaceFile: (filePath: string) => Promise<string>
      saveWorkspaceFile: (filePath: string, content: string) => Promise<{ ok: boolean }>
      workspaceFileExists: (rootPath: string, filePath: string) => Promise<{ exists: boolean }>
      saveWorkspaceImage: (
        rootPath: string,
        relativeDirectoryPath: string,
        fileName: string,
        imageData: string,
      ) => Promise<{ filePath: string }>
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
      getGitBaseline: (workspacePath: string, filePath: string) => Promise<GitBaselinePayload>
      getGitLineBlame: (
        workspacePath: string,
        filePath: string,
        lineNumber: number,
        contentText?: string,
      ) => Promise<GitBlameResult>
      getWorkspaceIconTheme: () => Promise<WorkspaceIconTheme | null>
      getWorkspaceIconThemeCatalog: () => Promise<WorkspaceIconThemeCatalogOption[]>
      pickWorkspaceIconTheme: () => Promise<WorkspaceIconTheme | null>
      setWorkspaceIconTheme: (selection: { sourceVsixPath: string, themeId: string }) => Promise<WorkspaceIconTheme | null>
      getUiState: () => Promise<{ agentComposerHeight: number }>
      updateUiState: (patch: { agentComposerHeight?: number }) => Promise<{ ok: boolean }>
      startWorkspaceWatch: (rootPath: string) => Promise<{ ok: boolean }>
      stopWorkspaceWatch: () => Promise<{ ok: boolean }>
      loadAgentWorkspace: (rootPath: string, preferredSessionPath?: string | null) => Promise<AgentWorkspaceState>
      createAgentSession: (rootPath: string, name?: string) => Promise<AgentWorkspaceState>
      openAgentSession: (rootPath: string, sessionPath: string) => Promise<AgentWorkspaceState>
      deleteAgentSession: (rootPath: string, sessionPath: string) => Promise<AgentWorkspaceState>
      renameAgentSession: (name: string) => Promise<AgentWorkspaceState>
      pickAgentAttachments: () => Promise<AgentPromptAttachment[]>
      getFilePath: (file: File) => string
      sendAgentPrompt: (prompt: string, streamingBehavior?: AgentRunningPromptBehavior, attachments?: AgentPromptAttachment[]) => Promise<{ ok: boolean }>
      selectAgentModel: (modelKey: string) => Promise<AgentWorkspaceState>
      selectAgentThinkingLevel: (level: AgentThinkingLevel, modelKey?: string) => Promise<AgentWorkspaceState>
      updateAgentProviderAuth: (rootPath: string, provider: string, apiKey: string | null) => Promise<AgentWorkspaceState>
      loginAgentProviderAuth: (rootPath: string, provider: string) => Promise<AgentWorkspaceState>
      logoutAgentProviderAuth: (rootPath: string, provider: string) => Promise<AgentWorkspaceState>
      cancelAgentProviderAuth: (provider: string) => Promise<{ ok: boolean }>
      respondAgentProviderAuthPrompt: (requestId: string, value: string | null) => Promise<{ ok: boolean }>
      abortAgentPrompt: () => Promise<AgentWorkspaceState>
      notifyRendererReady: () => void
      openExternalLink: (href: string) => Promise<{ ok: boolean }>
      setWindowTheme: (
        theme: { appearanceTheme: 'light' | 'dark' | 'system'; backgroundTheme?: 'light' | 'dark' },
      ) => Promise<{ ok: boolean; resolvedTheme?: 'light' | 'dark' }>
      onWindowThemeChanged: (listener: (state: { resolvedTheme: 'light' | 'dark' }) => void) => () => void
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<{ isFullScreen: boolean, isMaximized: boolean }>
      closeWindow: () => Promise<void>
      isWindowMaximized: () => Promise<{ isFullScreen: boolean, isMaximized: boolean }>
      refreshWindowInteractionRegions: (mode?: 'soft' | 'hard') => Promise<{ ok: boolean }>
      onWindowStateChanged: (listener: (state: { isFullScreen: boolean, isMaximized: boolean }) => void) => () => void
      onWindowCloseRequested: (listener: () => void) => () => void
      onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => () => void
      onAgentEvent: (listener: (event: AgentClientEvent) => void) => () => void
      onAgentProviderAuthUiEvent: (listener: (event: AgentProviderAuthUiEvent) => void) => () => void
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

declare module 'mermaid/dist/mermaid.min.js?url' {
  const src: string
  export default src
}

export {}

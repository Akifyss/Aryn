import type { AgentClientEvent, AgentInteractionResponse, AgentPromptAttachment, AgentPromptSendOptions, AgentProviderAuthUiEvent, AgentQueuedMessageUpdate, AgentRequestScope, AgentRunningPromptBehavior, AgentSessionCreateOptions, AgentSessionSnapshot, AgentThinkingLevel, AgentWorkspaceState, OpenCodeSurfaceRequest, OpenCodeSurfaceResponse } from '@/features/agent/types'
import type { AgentAvailability } from '@/features/agent/agent-definition'
import type { ActiveWorkspaceContext, ConversationRecord, ConversationState, CreateConversationWorkspaceRequest, UpdateConversationRequest } from '@/features/conversations/types'
import type {
  GitBaselinePayload,
  GitBlameResult,
  GitChangeItem,
  GitChangeScope,
  GitCommitDetails,
  GitCommitHistoryResult,
  GitDiffBlockAction,
  GitDiffSelection,
  GitFileDiffResult,
  GitRepositoryState,
} from '@/features/git/types'
import type {
  ProjectState,
  WorkspaceChangeEvent,
  WorkspaceIconTheme,
  WorkspaceIconThemeCatalogOption,
  WorkspaceIconThemeMode,
  WorkspaceIconThemeSelection,
  WorkspaceNode,
} from '@/features/workspace/types'
import type {
  LocalStorageStateMigration,
  PersistedAppSettings,
  PersistedLayoutState,
  PersistedMeoStoredState,
  PersistedWorkspaceTabState,
  PersistentClientStateSnapshot,
} from '@/features/persistence/types'

/// <reference types="vite/client" />

declare global {
  interface Window {
    appApi: {
      platform: NodeJS.Platform
      getAgentCatalog: (options?: { force?: boolean }) => Promise<AgentAvailability[]>
      pickWorkspace: () => Promise<string | null>
      getProjectState: () => Promise<ProjectState>
      getActiveWorkspaceContext: () => Promise<ActiveWorkspaceContext>
      setActiveWorkspaceContext: (context: ActiveWorkspaceContext) => Promise<ActiveWorkspaceContext>
      createEmptyProject: (name: string) => Promise<ProjectState>
      addExistingProject: () => Promise<ProjectState | null>
      setActiveProject: (projectId: string) => Promise<ProjectState>
      removeProject: (projectId: string) => Promise<ProjectState>
      getConversationState: () => Promise<ConversationState>
      createConversationWorkspace: (request?: CreateConversationWorkspaceRequest) => Promise<ConversationRecord>
      updateConversation: (conversationId: string, patch: UpdateConversationRequest) => Promise<ConversationRecord>
      removeDraftConversation: (conversationId: string) => Promise<ConversationState>
      removeConversation: (conversationId: string) => Promise<ConversationState>
      openPath: (path: string) => Promise<{ ok: boolean }>
      showItemInFolder: (path: string) => Promise<{ ok: boolean }>
      getWorkspaceRestoreState: () => Promise<{ workspacePath: string | null, filePath: string | null, agentSessionPath: string | null }>
      getWorkspaceState: (workspacePath: string) => Promise<{ lastFilePath: string | null, lastAgentSessionPath: string | null, prefersNewAgentSession: boolean }>
      updateWorkspaceState: (workspacePath: string, patch: { lastFilePath?: string | null, lastAgentSessionPath?: string | null, markAsLastOpened?: boolean, prefersNewAgentSession?: boolean }) => Promise<{ ok: boolean }>
      initializePersistentState: (migration: LocalStorageStateMigration) => Promise<PersistentClientStateSnapshot>
      updateSettingsState: (patch: Partial<PersistedAppSettings>) => Promise<{ ok: boolean }>
      updateLayoutState: (patch: Partial<PersistedLayoutState>) => Promise<{ ok: boolean }>
      getWorkspaceTabState: (workspacePath: string) => Promise<PersistedWorkspaceTabState | null>
      updateWorkspaceTabState: (workspacePath: string, state: PersistedWorkspaceTabState) => Promise<{ ok: boolean }>
      updateMeoFileState: (filePath: string, state: PersistedMeoStoredState) => Promise<{ ok: boolean }>
      workspacePathExists: (workspacePath: string) => Promise<{ exists: boolean }>
      loadWorkspaceTree: (rootPath: string) => Promise<WorkspaceNode[]>
      loadWorkspaceDirectory: (rootPath: string, directoryPath?: string) => Promise<WorkspaceNode[]>
      resolveWorkspaceEditorKind: (filePath: string) => Promise<'prose' | 'code' | 'file' | null>
      readWorkspaceFile: (filePath: string) => Promise<string>
      saveWorkspaceFile: (filePath: string, content: string) => Promise<{ ok: boolean }>
      workspaceFileExists: (rootPath: string, filePath: string) => Promise<{ exists: boolean }>
      getWorkspaceFileUrl: (rootPath: string, filePath: string) => Promise<{ url: string }>
      getWorkspaceFileDataUrl: (rootPath: string, filePath: string, contentType?: string) => Promise<{ url: string }>
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
      revertGitCommit: (workspacePath: string, commitHash: string) => Promise<GitRepositoryState>
      getGitFileDiff: (workspacePath: string, filePath: string, scope: GitChangeScope) => Promise<GitFileDiffResult>
      getGitCommitHistory: (workspacePath: string, limit?: number) => Promise<GitCommitHistoryResult>
      getGitCommitDetails: (workspacePath: string, commitHash: string) => Promise<GitCommitDetails>
      getGitCommitFileDiff: (workspacePath: string, commitHash: string, filePath: string) => Promise<GitFileDiffResult>
      getGitBaseline: (workspacePath: string, filePath: string) => Promise<GitBaselinePayload>
      getGitLineBlame: (
        workspacePath: string,
        filePath: string,
        lineNumber: number,
        contentText?: string,
      ) => Promise<GitBlameResult>
      getWorkspaceIconTheme: (mode?: WorkspaceIconThemeMode) => Promise<WorkspaceIconTheme | null>
      getWorkspaceIconThemeCatalog: () => Promise<WorkspaceIconThemeCatalogOption[]>
      pickWorkspaceIconTheme: (mode?: WorkspaceIconThemeMode) => Promise<WorkspaceIconTheme | null>
      setWorkspaceIconTheme: (mode: WorkspaceIconThemeMode, selection: WorkspaceIconThemeSelection) => Promise<WorkspaceIconTheme | null>
      getUiState: () => Promise<{ agentComposerHeight: number }>
      updateUiState: (patch: { agentComposerHeight?: number }) => Promise<{ ok: boolean }>
      startWorkspaceWatch: (rootPath: string) => Promise<{ ok: boolean }>
      stopWorkspaceWatch: () => Promise<{ ok: boolean }>
      loadAgentWorkspace: (scope: AgentRequestScope, preferredSessionPath?: string | null, options?: { restoreSession?: boolean }) => Promise<AgentWorkspaceState>
      loadAgentDraftState: (agentId?: AgentRequestScope['agentId']) => Promise<AgentWorkspaceState>
      listAgentSessions: (scope: AgentRequestScope) => Promise<AgentWorkspaceState['sessions']>
      readAgentSession: (scope: AgentRequestScope, sessionPath: string) => Promise<AgentSessionSnapshot>
      requestOpenCodeSurface: (scope: AgentRequestScope, request: OpenCodeSurfaceRequest) => Promise<OpenCodeSurfaceResponse>
      agentSessionExists: (scope: AgentRequestScope, sessionPath: string) => Promise<{ exists: boolean }>
      createAgentSession: (scope: AgentRequestScope, options?: string | AgentSessionCreateOptions) => Promise<AgentWorkspaceState>
      openAgentSession: (scope: AgentRequestScope, sessionPath: string) => Promise<AgentWorkspaceState>
      deleteAgentSession: (scope: AgentRequestScope, sessionPath: string) => Promise<AgentWorkspaceState>
      renameAgentSession: (scope: AgentRequestScope, sessionPath: string, name: string) => Promise<AgentWorkspaceState>
      pickAgentAttachments: () => Promise<AgentPromptAttachment[]>
      getFilePath: (file: File) => string
      sendAgentPrompt: (scope: AgentRequestScope, prompt: string, streamingBehavior?: AgentRunningPromptBehavior, attachments?: AgentPromptAttachment[], options?: AgentPromptSendOptions) => Promise<{ ok: boolean }>
      updateAgentQueuedMessage: (scope: AgentRequestScope, update: AgentQueuedMessageUpdate) => Promise<AgentWorkspaceState>
      selectAgentModel: (scope: AgentRequestScope, modelKey: string) => Promise<AgentWorkspaceState>
      selectAgentThinkingLevel: (scope: AgentRequestScope, level: AgentThinkingLevel, modelKey?: string) => Promise<AgentWorkspaceState>
      updateAgentProviderAuth: (rootPath: string | null, provider: string, apiKey: string | null) => Promise<AgentWorkspaceState>
      loginAgentProviderAuth: (rootPath: string | null, provider: string) => Promise<AgentWorkspaceState>
      logoutAgentProviderAuth: (rootPath: string | null, provider: string) => Promise<AgentWorkspaceState>
      cancelAgentProviderAuth: (provider: string) => Promise<{ ok: boolean }>
      respondAgentProviderAuthPrompt: (requestId: string, value: string | null) => Promise<{ ok: boolean }>
      abortAgentPrompt: (scope: AgentRequestScope) => Promise<AgentWorkspaceState>
      respondAgentInteraction: (response: AgentInteractionResponse) => Promise<{ ok: boolean }>
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
      onWindowDevToolsOpened: (listener: () => void) => () => void
      onWindowDevToolsClosed: (listener: () => void) => () => void
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

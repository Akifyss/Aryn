import { ipcRenderer, contextBridge, webUtils } from 'electron'
import type { AgentClientEvent, AgentInteractionResponse, AgentPromptAttachment, AgentPromptSendOptions, AgentProviderAuthUiEvent, AgentQueuedMessageUpdate, AgentRequestScope, AgentRunningPromptBehavior, AgentSessionCreateOptions, AgentSessionSnapshot, AgentThinkingLevel, AgentWorkspaceState, OpenCodeSurfaceRequest, OpenCodeSurfaceResponse } from '../../src/features/agent/types'
import type { AgentAvailability } from '../../src/features/agent/agent-definition'
import type { ActiveWorkspaceContext, ConversationRecord, ConversationState, CreateConversationWorkspaceRequest, UpdateConversationRequest } from '../../src/features/conversations/types'
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
} from '../../src/features/git/types'
import type {
  ProjectState,
  WorkspaceChangeEvent,
  WorkspaceIconTheme,
  WorkspaceIconThemeCatalogOption,
  WorkspaceIconThemeMode,
  WorkspaceIconThemeSelection,
  WorkspaceNode,
} from '../../src/features/workspace/types'
import type {
  LocalStorageStateMigration,
  PersistedAppSettings,
  PersistedLayoutState,
  PersistedMeoStoredState,
  PersistedWorkspaceTabState,
  PersistentClientStateSnapshot,
} from '../../src/features/persistence/types'

type WindowLifecycleChannel = 'window:close-requested' | 'window:devtools-closed' | 'window:devtools-opened'

function subscribeWindowLifecycle(channel: WindowLifecycleChannel, listener: () => void) {
  const wrappedListener = () => {
    listener()
  }

  ipcRenderer.on(channel, wrappedListener)

  return () => {
    ipcRenderer.off(channel, wrappedListener)
  }
}

contextBridge.exposeInMainWorld('appApi', {
  platform: process.platform,
  getAgentCatalog: (options?: { force?: boolean }) => (
    ipcRenderer.invoke('agent:get-catalog', options) as Promise<AgentAvailability[]>
  ),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick-directory') as Promise<string | null>,
  getProjectState: () => ipcRenderer.invoke('project:get-state') as Promise<ProjectState>,
  getActiveWorkspaceContext: () => ipcRenderer.invoke('workspace:get-active-context') as Promise<ActiveWorkspaceContext>,
  setActiveWorkspaceContext: (context: ActiveWorkspaceContext) => ipcRenderer.invoke('workspace:set-active-context', context) as Promise<ActiveWorkspaceContext>,
  createEmptyProject: (name: string) => ipcRenderer.invoke('project:create-empty', name) as Promise<ProjectState>,
  addExistingProject: () => ipcRenderer.invoke('project:add-existing') as Promise<ProjectState | null>,
  setActiveProject: (projectId: string) => ipcRenderer.invoke('project:set-active', projectId) as Promise<ProjectState>,
  removeProject: (projectId: string) => ipcRenderer.invoke('project:remove', projectId) as Promise<ProjectState>,
  getConversationState: () => ipcRenderer.invoke('conversation:get-state') as Promise<ConversationState>,
  createConversationWorkspace: (request?: CreateConversationWorkspaceRequest) => (
    ipcRenderer.invoke('conversation:create-workspace', request) as Promise<ConversationRecord>
  ),
  updateConversation: (conversationId: string, patch: UpdateConversationRequest) => (
    ipcRenderer.invoke('conversation:update', conversationId, patch) as Promise<ConversationRecord>
  ),
  removeDraftConversation: (conversationId: string) => ipcRenderer.invoke('conversation:remove-draft', conversationId) as Promise<ConversationState>,
  removeConversation: (conversationId: string) => ipcRenderer.invoke('conversation:remove', conversationId) as Promise<ConversationState>,
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path) as Promise<{ ok: boolean }>,
  showItemInFolder: (path: string) => ipcRenderer.invoke('shell:show-item-in-folder', path) as Promise<{ ok: boolean }>,
  getWorkspaceRestoreState: () => ipcRenderer.invoke('workspace:get-restore-state') as Promise<{ workspacePath: string | null, filePath: string | null, agentSessionPath: string | null }>,
  getWorkspaceState: (workspacePath: string) => ipcRenderer.invoke('workspace:get-state', workspacePath) as Promise<{ lastFilePath: string | null, lastAgentSessionPath: string | null, prefersNewAgentSession: boolean }>,
  updateWorkspaceState: (workspacePath: string, patch: { lastFilePath?: string | null, lastAgentSessionPath?: string | null, markAsLastOpened?: boolean, prefersNewAgentSession?: boolean }) => ipcRenderer.invoke('workspace:update-state', workspacePath, patch) as Promise<{ ok: boolean }>,
  initializePersistentState: (migration: LocalStorageStateMigration) => ipcRenderer.invoke('persistence:initialize', migration) as Promise<PersistentClientStateSnapshot>,
  updateSettingsState: (patch: Partial<PersistedAppSettings>) => ipcRenderer.invoke('settings:update-state', patch) as Promise<{ ok: boolean }>,
  updateLayoutState: (patch: Partial<PersistedLayoutState>) => ipcRenderer.invoke('layout:update-state', patch) as Promise<{ ok: boolean }>,
  getWorkspaceTabState: (workspacePath: string) => ipcRenderer.invoke('workspace-tabs:get-state', workspacePath) as Promise<PersistedWorkspaceTabState | null>,
  updateWorkspaceTabState: (workspacePath: string, state: PersistedWorkspaceTabState) => ipcRenderer.invoke('workspace-tabs:update-state', workspacePath, state) as Promise<{ ok: boolean }>,
  updateMeoFileState: (filePath: string, state: PersistedMeoStoredState) => ipcRenderer.invoke('meo-state:update', filePath, state) as Promise<{ ok: boolean }>,
  workspacePathExists: (workspacePath: string) => ipcRenderer.invoke('workspace:path-exists', workspacePath) as Promise<{ exists: boolean }>,
  loadWorkspaceTree: (rootPath: string) => ipcRenderer.invoke('workspace:load-tree', rootPath) as Promise<WorkspaceNode[]>,
  loadWorkspaceDirectory: (rootPath: string, directoryPath?: string) => (
    ipcRenderer.invoke('workspace:load-directory', rootPath, directoryPath) as Promise<WorkspaceNode[]>
  ),
  resolveWorkspaceEditorKind: (filePath: string) => ipcRenderer.invoke('workspace:resolve-editor-kind', filePath) as Promise<'prose' | 'code' | 'file' | null>,
  readWorkspaceFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath) as Promise<string>,
  saveWorkspaceFile: (filePath: string, content: string) => ipcRenderer.invoke('workspace:save-file', filePath, content) as Promise<{ ok: boolean }>,
  workspaceFileExists: (rootPath: string, filePath: string) => ipcRenderer.invoke('workspace:file-exists', rootPath, filePath) as Promise<{ exists: boolean }>,
  getWorkspaceFileUrl: (rootPath: string, filePath: string) => ipcRenderer.invoke('workspace:get-file-url', rootPath, filePath) as Promise<{ url: string }>,
  getWorkspaceFileDataUrl: (rootPath: string, filePath: string, contentType?: string) => ipcRenderer.invoke('workspace:get-file-data-url', rootPath, filePath, contentType) as Promise<{ url: string }>,
  saveWorkspaceImage: (
    rootPath: string,
    relativeDirectoryPath: string,
    fileName: string,
    imageData: string,
  ) => ipcRenderer.invoke('workspace:save-image', rootPath, relativeDirectoryPath, fileName, imageData) as Promise<{ filePath: string }>,
  createWorkspaceFile: (rootPath: string, relativeFilePath: string) => ipcRenderer.invoke('workspace:create-file', rootPath, relativeFilePath) as Promise<{ filePath: string }>,
  createWorkspaceDirectory: (rootPath: string, relativeDirPath: string) => ipcRenderer.invoke('workspace:create-directory', rootPath, relativeDirPath) as Promise<{ dirPath: string }>,
  moveWorkspaceEntry: (rootPath: string, entryPath: string, nextRelativePath: string) => ipcRenderer.invoke('workspace:move-entry', rootPath, entryPath, nextRelativePath) as Promise<{ filePath: string }>,
  deleteWorkspaceFile: (rootPath: string, filePath: string) => ipcRenderer.invoke('workspace:delete-file', rootPath, filePath) as Promise<{ ok: boolean }>,
  getGitRepositoryState: (workspacePath: string) => ipcRenderer.invoke('git:get-state', workspacePath) as Promise<GitRepositoryState>,
  initializeGitRepository: (workspacePath: string) => ipcRenderer.invoke('git:init', workspacePath) as Promise<GitRepositoryState>,
  stageGitPaths: (workspacePath: string, filePaths: string[]) => ipcRenderer.invoke('git:stage-paths', workspacePath, filePaths) as Promise<GitRepositoryState>,
  unstageGitPaths: (workspacePath: string, filePaths: string[]) => ipcRenderer.invoke('git:unstage-paths', workspacePath, filePaths) as Promise<GitRepositoryState>,
  discardGitChange: (workspacePath: string, change: GitChangeItem) => ipcRenderer.invoke('git:discard-change', workspacePath, change) as Promise<GitRepositoryState>,
  applyGitDiffSelection: (
    workspacePath: string,
    filePath: string,
    scope: GitChangeScope,
    selection: GitDiffSelection,
    action: GitDiffBlockAction,
  ) => ipcRenderer.invoke('git:apply-selection', workspacePath, filePath, scope, selection, action) as Promise<GitRepositoryState>,
  discardAllGitChanges: (workspacePath: string) => ipcRenderer.invoke('git:discard-all', workspacePath) as Promise<GitRepositoryState>,
  commitGitChanges: (workspacePath: string, message: string) => ipcRenderer.invoke('git:commit', workspacePath, message) as Promise<GitRepositoryState>,
  commitAndSyncGitChanges: (workspacePath: string, message: string) => ipcRenderer.invoke('git:commit-and-sync', workspacePath, message) as Promise<GitRepositoryState>,
  pullGitChanges: (workspacePath: string) => ipcRenderer.invoke('git:pull', workspacePath) as Promise<GitRepositoryState>,
  pushGitChanges: (workspacePath: string) => ipcRenderer.invoke('git:push', workspacePath) as Promise<GitRepositoryState>,
  revertGitCommit: (workspacePath: string, commitHash: string) => ipcRenderer.invoke('git:revert-commit', workspacePath, commitHash) as Promise<GitRepositoryState>,
  getGitFileDiff: (workspacePath: string, filePath: string, scope: GitChangeScope) => ipcRenderer.invoke('git:get-file-diff', workspacePath, filePath, scope) as Promise<GitFileDiffResult>,
  getGitCommitHistory: (workspacePath: string, limit?: number) => ipcRenderer.invoke('git:get-commit-history', workspacePath, limit) as Promise<GitCommitHistoryResult>,
  getGitCommitDetails: (workspacePath: string, commitHash: string) => ipcRenderer.invoke('git:get-commit-details', workspacePath, commitHash) as Promise<GitCommitDetails>,
  getGitCommitFileDiff: (workspacePath: string, commitHash: string, filePath: string) => ipcRenderer.invoke('git:get-commit-file-diff', workspacePath, commitHash, filePath) as Promise<GitFileDiffResult>,
  getGitBaseline: (
    workspacePath: string,
    filePath: string,
  ) => ipcRenderer.invoke('git:get-baseline', workspacePath, filePath) as Promise<GitBaselinePayload>,
  getGitLineBlame: (
    workspacePath: string,
    filePath: string,
    lineNumber: number,
    contentText?: string,
  ) => ipcRenderer.invoke('git:get-line-blame', workspacePath, filePath, lineNumber, contentText) as Promise<GitBlameResult>,
  getWorkspaceIconTheme: (mode?: WorkspaceIconThemeMode) => ipcRenderer.invoke('workspace-icons:get-theme', mode) as Promise<WorkspaceIconTheme | null>,
  getWorkspaceIconThemeCatalog: () => ipcRenderer.invoke('workspace-icons:catalog') as Promise<WorkspaceIconThemeCatalogOption[]>,
  pickWorkspaceIconTheme: (mode?: WorkspaceIconThemeMode) => ipcRenderer.invoke('workspace-icons:pick-theme', mode) as Promise<WorkspaceIconTheme | null>,
  setWorkspaceIconTheme: (mode: WorkspaceIconThemeMode, selection: WorkspaceIconThemeSelection) => ipcRenderer.invoke('workspace-icons:select-theme', mode, selection) as Promise<WorkspaceIconTheme | null>,
  getUiState: () => ipcRenderer.invoke('ui:get-state') as Promise<{ agentComposerHeight: number }>,
  updateUiState: (patch: { agentComposerHeight?: number }) => ipcRenderer.invoke('ui:update-state', patch) as Promise<{ ok: boolean }>,
  startWorkspaceWatch: (rootPath: string) => ipcRenderer.invoke('workspace:start-watch', rootPath) as Promise<{ ok: boolean }>,
  stopWorkspaceWatch: () => ipcRenderer.invoke('workspace:stop-watch') as Promise<{ ok: boolean }>,
  loadAgentWorkspace: (scope: AgentRequestScope, preferredSessionPath?: string | null, options?: { restoreSession?: boolean }) => ipcRenderer.invoke('agent:load-workspace', scope, preferredSessionPath, options) as Promise<AgentWorkspaceState>,
  loadAgentDraftState: (agentId?: AgentRequestScope['agentId']) => ipcRenderer.invoke('agent:load-draft-state', agentId) as Promise<AgentWorkspaceState>,
  listAgentSessions: (scope: AgentRequestScope) => ipcRenderer.invoke('agent:list-sessions', scope) as Promise<AgentWorkspaceState['sessions']>,
  readAgentSession: (scope: AgentRequestScope, sessionPath: string) => ipcRenderer.invoke('agent:read-session', scope, sessionPath) as Promise<AgentSessionSnapshot>,
  requestOpenCodeSurface: (scope: AgentRequestScope, request: OpenCodeSurfaceRequest) => (
    ipcRenderer.invoke('agent:opencode-surface-request', scope, request) as Promise<OpenCodeSurfaceResponse>
  ),
  agentSessionExists: (scope: AgentRequestScope, sessionPath: string) => ipcRenderer.invoke('agent:session-exists', scope, sessionPath) as Promise<{ exists: boolean }>,
  createAgentSession: (scope: AgentRequestScope, options?: string | AgentSessionCreateOptions) => ipcRenderer.invoke('agent:create-session', scope, options) as Promise<AgentWorkspaceState>,
  openAgentSession: (scope: AgentRequestScope, sessionPath: string) => ipcRenderer.invoke('agent:open-session', scope, sessionPath) as Promise<AgentWorkspaceState>,
  deleteAgentSession: (scope: AgentRequestScope, sessionPath: string) => ipcRenderer.invoke('agent:delete-session', scope, sessionPath) as Promise<AgentWorkspaceState>,
  renameAgentSession: (scope: AgentRequestScope, sessionPath: string, name: string) => (
    ipcRenderer.invoke('agent:rename-session', scope, sessionPath, name) as Promise<AgentWorkspaceState>
  ),
  pickAgentAttachments: () => ipcRenderer.invoke('agent:pick-attachments') as Promise<AgentPromptAttachment[]>,
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  sendAgentPrompt: (scope: AgentRequestScope, prompt: string, streamingBehavior?: AgentRunningPromptBehavior, attachments?: AgentPromptAttachment[], options?: AgentPromptSendOptions) => ipcRenderer.invoke('agent:send-prompt', scope, prompt, streamingBehavior, attachments, options) as Promise<{ ok: boolean }>,
  updateAgentQueuedMessage: (scope: AgentRequestScope, update: AgentQueuedMessageUpdate) => ipcRenderer.invoke('agent:update-queued-message', scope, update) as Promise<AgentWorkspaceState>,
  selectAgentModel: (scope: AgentRequestScope, modelKey: string) => ipcRenderer.invoke('agent:select-model', scope, modelKey) as Promise<AgentWorkspaceState>,
  selectAgentThinkingLevel: (scope: AgentRequestScope, level: AgentThinkingLevel, modelKey?: string) => ipcRenderer.invoke('agent:select-thinking-level', scope, level, modelKey) as Promise<AgentWorkspaceState>,
  updateAgentProviderAuth: (rootPath: string | null, provider: string, apiKey: string | null) => ipcRenderer.invoke('agent:update-provider-auth', rootPath, provider, apiKey) as Promise<AgentWorkspaceState>,
  loginAgentProviderAuth: (rootPath: string | null, provider: string) => ipcRenderer.invoke('agent:login-provider-auth', rootPath, provider) as Promise<AgentWorkspaceState>,
  logoutAgentProviderAuth: (rootPath: string | null, provider: string) => ipcRenderer.invoke('agent:logout-provider-auth', rootPath, provider) as Promise<AgentWorkspaceState>,
  cancelAgentProviderAuth: (provider: string) => ipcRenderer.invoke('agent:cancel-provider-auth', provider) as Promise<{ ok: boolean }>,
  respondAgentProviderAuthPrompt: (requestId: string, value: string | null) => ipcRenderer.invoke('agent:respond-provider-auth-prompt', requestId, value) as Promise<{ ok: boolean }>,
  abortAgentPrompt: (scope: AgentRequestScope) => ipcRenderer.invoke('agent:abort', scope) as Promise<AgentWorkspaceState>,
  respondAgentInteraction: (response: AgentInteractionResponse) => ipcRenderer.invoke('agent:respond-interaction', response) as Promise<{ ok: boolean }>,
  notifyRendererReady: () => {
    ipcRenderer.send('app:renderer-ready')
  },
  openExternalLink: (href: string) => ipcRenderer.invoke('shell:open-external', href) as Promise<{ ok: boolean }>,
  setWindowTheme: (
    theme: { appearanceTheme: 'light' | 'dark' | 'system'; backgroundTheme?: 'light' | 'dark' },
  ) => ipcRenderer.invoke('window:set-theme', theme) as Promise<{ ok: boolean; resolvedTheme?: 'light' | 'dark' }>,
  onWindowThemeChanged: (listener: (state: { resolvedTheme: 'light' | 'dark' }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { resolvedTheme: 'light' | 'dark' }) => listener(state)
    ipcRenderer.on('window:theme-changed', handler)
    return () => ipcRenderer.removeListener('window:theme-changed', handler)
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize') as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize') as Promise<{ isFullScreen: boolean, isMaximized: boolean }>,
  closeWindow: () => ipcRenderer.invoke('window:close') as Promise<void>,
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized') as Promise<{ isFullScreen: boolean, isMaximized: boolean }>,
  refreshWindowInteractionRegions: (mode?: 'soft' | 'hard') => ipcRenderer.invoke('window:refresh-interaction-regions', mode) as Promise<{ ok: boolean }>,
  onWindowStateChanged: (listener: (state: { isFullScreen: boolean, isMaximized: boolean }) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: { isFullScreen: boolean, isMaximized: boolean }) => {
      listener(state)
    }

    ipcRenderer.on('window:state-changed', wrappedListener)

    return () => {
      ipcRenderer.off('window:state-changed', wrappedListener)
    }
  },
  onWindowDevToolsOpened: (listener: () => void) => subscribeWindowLifecycle('window:devtools-opened', listener),
  onWindowDevToolsClosed: (listener: () => void) => subscribeWindowLifecycle('window:devtools-closed', listener),
  onWindowCloseRequested: (listener: () => void) => subscribeWindowLifecycle('window:close-requested', listener),
  onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: WorkspaceChangeEvent) => {
      listener(payload)
    }

    ipcRenderer.on('workspace:changed', wrappedListener)

    return () => {
      ipcRenderer.off('workspace:changed', wrappedListener)
    }
  },
  onAgentEvent: (listener: (event: AgentClientEvent) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: AgentClientEvent) => {
      listener(payload)
    }

    ipcRenderer.on('agent:event', wrappedListener)

    return () => {
      ipcRenderer.off('agent:event', wrappedListener)
    }
  },
  onAgentProviderAuthUiEvent: (listener: (event: AgentProviderAuthUiEvent) => void) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, payload: AgentProviderAuthUiEvent) => {
      listener(payload)
    }

    ipcRenderer.on('agent:provider-auth-ui-event', wrappedListener)

    return () => {
      ipcRenderer.off('agent:provider-auth-ui-event', wrappedListener)
    }
  },
})

// --------- Preload scripts loading ---------
function domReady(condition: DocumentReadyState[] = ['complete', 'interactive']) {
  return new Promise(resolve => {
    if (condition.includes(document.readyState)) {
      resolve(true)
    } else {
      document.addEventListener('readystatechange', () => {
        if (condition.includes(document.readyState)) {
          resolve(true)
        }
      })
    }
  })
}

const safeDOM = {
  append(parent: HTMLElement, child: HTMLElement) {
    if (!Array.from(parent.children).find(e => e === child)) {
      return parent.appendChild(child)
    }
  },
  remove(parent: HTMLElement, child: HTMLElement) {
    if (Array.from(parent.children).find(e => e === child)) {
      return parent.removeChild(child)
    }
  },
}

/**
 * https://tobiasahlin.com/spinkit
 * https://connoratherton.com/loaders
 * https://projects.lukehaas.me/css-loaders
 * https://matejkustec.github.io/SpinThatShit
 */
function useLoading() {
  const className = `loaders-css__square-spin`
  const styleContent = `
@keyframes square-spin {
  25% { transform: perspective(100px) rotateX(180deg) rotateY(0); }
  50% { transform: perspective(100px) rotateX(180deg) rotateY(180deg); }
  75% { transform: perspective(100px) rotateX(0) rotateY(180deg); }
  100% { transform: perspective(100px) rotateX(0) rotateY(0); }
}
.${className} > div {
  animation-fill-mode: both;
  width: 50px;
  height: 50px;
  background: #fff;
  animation: square-spin 3s 0s cubic-bezier(0.09, 0.57, 0.49, 0.9) infinite;
}
.app-loading-wrap {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #282c34;
  z-index: 9;
}
    `
  const oStyle = document.createElement('style')
  const oDiv = document.createElement('div')

  oStyle.id = 'app-loading-style'
  oStyle.innerHTML = styleContent
  oDiv.className = 'app-loading-wrap'
  oDiv.innerHTML = `<div class="${className}"><div></div></div>`

  return {
    appendLoading() {
      safeDOM.append(document.head, oStyle)
      safeDOM.append(document.body, oDiv)
    },
    removeLoading() {
      safeDOM.remove(document.head, oStyle)
      safeDOM.remove(document.body, oDiv)
    },
  }
}

// ----------------------------------------------------------------------

const { appendLoading, removeLoading } = useLoading()
domReady().then(appendLoading)

window.onmessage = (ev) => {
  ev.data.payload === 'removeLoading' && removeLoading()
}

setTimeout(removeLoading, 4999)

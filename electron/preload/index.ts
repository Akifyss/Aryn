import { ipcRenderer, contextBridge, webUtils } from 'electron'
import type { AgentClientEvent, AgentPromptAttachment, AgentProviderAuthUiEvent, AgentQueuedMessageUpdate, AgentRunningPromptBehavior, AgentSessionCreateOptions, AgentThinkingLevel, AgentWorkspaceState } from '../../src/features/agent/types'
import type {
  GitBaselinePayload,
  GitBlameResult,
  GitChangeItem,
  GitChangeScope,
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

contextBridge.exposeInMainWorld('appApi', {
  platform: process.platform,
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick-directory') as Promise<string | null>,
  getProjectState: () => ipcRenderer.invoke('project:get-state') as Promise<ProjectState>,
  createEmptyProject: (name: string) => ipcRenderer.invoke('project:create-empty', name) as Promise<ProjectState>,
  addExistingProject: () => ipcRenderer.invoke('project:add-existing') as Promise<ProjectState | null>,
  setActiveProject: (projectId: string) => ipcRenderer.invoke('project:set-active', projectId) as Promise<ProjectState>,
  removeProject: (projectId: string) => ipcRenderer.invoke('project:remove', projectId) as Promise<ProjectState>,
  openPath: (path: string) => ipcRenderer.invoke('shell:open-path', path) as Promise<{ ok: boolean }>,
  showItemInFolder: (path: string) => ipcRenderer.invoke('shell:show-item-in-folder', path) as Promise<{ ok: boolean }>,
  getWorkspaceRestoreState: () => ipcRenderer.invoke('workspace:get-restore-state') as Promise<{ workspacePath: string | null, filePath: string | null, agentSessionPath: string | null }>,
  getWorkspaceState: (workspacePath: string) => ipcRenderer.invoke('workspace:get-state', workspacePath) as Promise<{ lastFilePath: string | null, lastAgentSessionPath: string | null }>,
  updateWorkspaceState: (workspacePath: string, patch: { lastFilePath?: string | null, lastAgentSessionPath?: string | null, markAsLastOpened?: boolean }) => ipcRenderer.invoke('workspace:update-state', workspacePath, patch) as Promise<{ ok: boolean }>,
  initializePersistentState: (migration: LocalStorageStateMigration) => ipcRenderer.invoke('persistence:initialize', migration) as Promise<PersistentClientStateSnapshot>,
  updateSettingsState: (patch: Partial<PersistedAppSettings>) => ipcRenderer.invoke('settings:update-state', patch) as Promise<{ ok: boolean }>,
  updateLayoutState: (patch: Partial<PersistedLayoutState>) => ipcRenderer.invoke('layout:update-state', patch) as Promise<{ ok: boolean }>,
  getWorkspaceTabState: (workspacePath: string) => ipcRenderer.invoke('workspace-tabs:get-state', workspacePath) as Promise<PersistedWorkspaceTabState | null>,
  updateWorkspaceTabState: (workspacePath: string, state: PersistedWorkspaceTabState) => ipcRenderer.invoke('workspace-tabs:update-state', workspacePath, state) as Promise<{ ok: boolean }>,
  updateMeoFileState: (filePath: string, state: PersistedMeoStoredState) => ipcRenderer.invoke('meo-state:update', filePath, state) as Promise<{ ok: boolean }>,
  loadWorkspaceTree: (rootPath: string) => ipcRenderer.invoke('workspace:load-tree', rootPath) as Promise<WorkspaceNode[]>,
  resolveWorkspaceEditorKind: (filePath: string) => ipcRenderer.invoke('workspace:resolve-editor-kind', filePath) as Promise<'prose' | 'code' | null>,
  readWorkspaceFile: (filePath: string) => ipcRenderer.invoke('workspace:read-file', filePath) as Promise<string>,
  saveWorkspaceFile: (filePath: string, content: string) => ipcRenderer.invoke('workspace:save-file', filePath, content) as Promise<{ ok: boolean }>,
  workspaceFileExists: (rootPath: string, filePath: string) => ipcRenderer.invoke('workspace:file-exists', rootPath, filePath) as Promise<{ exists: boolean }>,
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
  getGitFileDiff: (workspacePath: string, filePath: string, scope: GitChangeScope) => ipcRenderer.invoke('git:get-file-diff', workspacePath, filePath, scope) as Promise<GitFileDiffResult>,
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
  getWorkspaceIconTheme: () => ipcRenderer.invoke('workspace-icons:get-theme') as Promise<WorkspaceIconTheme | null>,
  getWorkspaceIconThemeCatalog: () => ipcRenderer.invoke('workspace-icons:catalog') as Promise<WorkspaceIconThemeCatalogOption[]>,
  pickWorkspaceIconTheme: () => ipcRenderer.invoke('workspace-icons:pick-theme') as Promise<WorkspaceIconTheme | null>,
  setWorkspaceIconTheme: (selection: { sourceVsixPath: string, themeId: string }) => ipcRenderer.invoke('workspace-icons:select-theme', selection) as Promise<WorkspaceIconTheme | null>,
  getUiState: () => ipcRenderer.invoke('ui:get-state') as Promise<{ agentComposerHeight: number }>,
  updateUiState: (patch: { agentComposerHeight?: number }) => ipcRenderer.invoke('ui:update-state', patch) as Promise<{ ok: boolean }>,
  startWorkspaceWatch: (rootPath: string) => ipcRenderer.invoke('workspace:start-watch', rootPath) as Promise<{ ok: boolean }>,
  stopWorkspaceWatch: () => ipcRenderer.invoke('workspace:stop-watch') as Promise<{ ok: boolean }>,
  loadAgentWorkspace: (rootPath: string, preferredSessionPath?: string | null, options?: { restoreSession?: boolean }) => ipcRenderer.invoke('agent:load-workspace', rootPath, preferredSessionPath, options) as Promise<AgentWorkspaceState>,
  listAgentSessions: (rootPath: string) => ipcRenderer.invoke('agent:list-sessions', rootPath) as Promise<AgentWorkspaceState['sessions']>,
  createAgentSession: (rootPath: string, options?: string | AgentSessionCreateOptions) => ipcRenderer.invoke('agent:create-session', rootPath, options) as Promise<AgentWorkspaceState>,
  openAgentSession: (rootPath: string, sessionPath: string) => ipcRenderer.invoke('agent:open-session', rootPath, sessionPath) as Promise<AgentWorkspaceState>,
  deleteAgentSession: (rootPath: string, sessionPath: string) => ipcRenderer.invoke('agent:delete-session', rootPath, sessionPath) as Promise<AgentWorkspaceState>,
  renameAgentSession: (name: string) => ipcRenderer.invoke('agent:rename-session', name) as Promise<AgentWorkspaceState>,
  pickAgentAttachments: () => ipcRenderer.invoke('agent:pick-attachments') as Promise<AgentPromptAttachment[]>,
  getFilePath: (file: File) => webUtils.getPathForFile(file),
  sendAgentPrompt: (prompt: string, streamingBehavior?: AgentRunningPromptBehavior, attachments?: AgentPromptAttachment[]) => ipcRenderer.invoke('agent:send-prompt', prompt, streamingBehavior, attachments) as Promise<{ ok: boolean }>,
  updateAgentQueuedMessage: (update: AgentQueuedMessageUpdate) => ipcRenderer.invoke('agent:update-queued-message', update) as Promise<AgentWorkspaceState>,
  selectAgentModel: (modelKey: string) => ipcRenderer.invoke('agent:select-model', modelKey) as Promise<AgentWorkspaceState>,
  selectAgentThinkingLevel: (level: AgentThinkingLevel, modelKey?: string) => ipcRenderer.invoke('agent:select-thinking-level', level, modelKey) as Promise<AgentWorkspaceState>,
  updateAgentProviderAuth: (rootPath: string, provider: string, apiKey: string | null) => ipcRenderer.invoke('agent:update-provider-auth', rootPath, provider, apiKey) as Promise<AgentWorkspaceState>,
  loginAgentProviderAuth: (rootPath: string, provider: string) => ipcRenderer.invoke('agent:login-provider-auth', rootPath, provider) as Promise<AgentWorkspaceState>,
  logoutAgentProviderAuth: (rootPath: string, provider: string) => ipcRenderer.invoke('agent:logout-provider-auth', rootPath, provider) as Promise<AgentWorkspaceState>,
  cancelAgentProviderAuth: (provider: string) => ipcRenderer.invoke('agent:cancel-provider-auth', provider) as Promise<{ ok: boolean }>,
  respondAgentProviderAuthPrompt: (requestId: string, value: string | null) => ipcRenderer.invoke('agent:respond-provider-auth-prompt', requestId, value) as Promise<{ ok: boolean }>,
  abortAgentPrompt: () => ipcRenderer.invoke('agent:abort') as Promise<AgentWorkspaceState>,
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
  onWindowCloseRequested: (listener: () => void) => {
    const wrappedListener = () => {
      listener()
    }

    ipcRenderer.on('window:close-requested', wrappedListener)

    return () => {
      ipcRenderer.off('window:close-requested', wrappedListener)
    }
  },
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

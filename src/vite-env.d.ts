import type { AgentClientEvent, AgentWorkspaceState } from '@/features/agent/types'
import type { WorkspaceChangeEvent, WorkspaceNode } from '@/features/workspace/types'

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
      readWorkspaceFile: (filePath: string) => Promise<string>
      saveWorkspaceFile: (filePath: string, content: string) => Promise<{ ok: boolean }>
      createWorkspaceFile: (rootPath: string, relativeFilePath: string) => Promise<{ filePath: string }>
      renameWorkspaceFile: (rootPath: string, filePath: string, nextRelativeFilePath: string) => Promise<{ filePath: string }>
      deleteWorkspaceFile: (rootPath: string, filePath: string) => Promise<{ ok: boolean }>
      getUiState: () => Promise<{ agentComposerHeight: number }>
      updateUiState: (patch: { agentComposerHeight?: number }) => Promise<{ ok: boolean }>
      startWorkspaceWatch: (rootPath: string) => Promise<{ ok: boolean }>
      stopWorkspaceWatch: () => Promise<{ ok: boolean }>
      loadAgentWorkspace: (rootPath: string, preferredSessionPath?: string | null) => Promise<AgentWorkspaceState>
      createAgentSession: (rootPath: string, name?: string) => Promise<AgentWorkspaceState>
      openAgentSession: (rootPath: string, sessionPath: string) => Promise<AgentWorkspaceState>
      deleteAgentSession: (rootPath: string, sessionPath: string) => Promise<AgentWorkspaceState>
      renameAgentSession: (name: string) => Promise<AgentWorkspaceState>
      sendAgentPrompt: (prompt: string) => Promise<{ ok: boolean }>
      selectAgentModel: (modelKey: string) => Promise<AgentWorkspaceState>
      updateOpenRouterAuth: (rootPath: string, apiKey: string | null) => Promise<AgentWorkspaceState>
      abortAgentPrompt: () => Promise<AgentWorkspaceState>
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<{ isMaximized: boolean }>
      closeWindow: () => Promise<void>
      isWindowMaximized: () => Promise<{ isMaximized: boolean }>
      onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => () => void
      onAgentEvent: (listener: (event: AgentClientEvent) => void) => () => void
    }
  }
}

export {}

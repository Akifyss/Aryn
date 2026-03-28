import type { AgentClientEvent, AgentWorkspaceState } from '@/features/agent/types'
import type { WorkspaceChangeEvent, WorkspaceNode } from '@/features/workspace/types'

/// <reference types="vite/client" />

declare global {
  interface Window {
    appApi: {
      pickWorkspace: () => Promise<string | null>
      getLastWorkspace: () => Promise<string | null>
      loadWorkspaceTree: (rootPath: string) => Promise<WorkspaceNode[]>
      readWorkspaceFile: (filePath: string) => Promise<string>
      saveWorkspaceFile: (filePath: string, content: string) => Promise<{ ok: boolean }>
      createWorkspaceFile: (rootPath: string, relativeFilePath: string) => Promise<{ filePath: string }>
      renameWorkspaceFile: (rootPath: string, filePath: string, nextRelativeFilePath: string) => Promise<{ filePath: string }>
      deleteWorkspaceFile: (rootPath: string, filePath: string) => Promise<{ ok: boolean }>
      startWorkspaceWatch: (rootPath: string) => Promise<{ ok: boolean }>
      stopWorkspaceWatch: () => Promise<{ ok: boolean }>
      loadAgentWorkspace: (rootPath: string) => Promise<AgentWorkspaceState>
      createAgentSession: (rootPath: string, name?: string) => Promise<AgentWorkspaceState>
      openAgentSession: (rootPath: string, sessionPath: string) => Promise<AgentWorkspaceState>
      renameAgentSession: (name: string) => Promise<AgentWorkspaceState>
      sendAgentPrompt: (prompt: string) => Promise<{ ok: boolean }>
      selectAgentModel: (modelKey: string) => Promise<AgentWorkspaceState>
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

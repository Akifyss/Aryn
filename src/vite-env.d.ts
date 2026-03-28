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
      minimizeWindow: () => Promise<void>
      toggleMaximizeWindow: () => Promise<{ isMaximized: boolean }>
      closeWindow: () => Promise<void>
      isWindowMaximized: () => Promise<{ isMaximized: boolean }>
      onWorkspaceChanged: (listener: (event: WorkspaceChangeEvent) => void) => () => void
    }
  }
}

export {}
